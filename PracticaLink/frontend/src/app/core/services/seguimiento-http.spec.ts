import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { PracticaService } from './practica.service';
import { authInterceptor } from '../interceptors/auth.interceptor';
import { routes } from '../../app.routes';
import { authGuard } from '../guards/auth.guard';
import { roleGuard } from '../guards/role.guard';

describe('HU013 HTTP contract', () => {
  let http: HttpTestingController;
  let token: string | null;
  beforeEach(() => {
    token = sessionStorage.getItem('access_token');
    sessionStorage.setItem('access_token', 'synthetic-test-token');
    TestBed.configureTestingModule({ providers: [
      provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting()
    ] });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    http.verify();
    if (token === null) sessionStorage.removeItem('access_token');
    else sessionStorage.setItem('access_token', token);
  });

  it('reads HU014 with pagination and existing JWT interceptor, without retries', () => {
    TestBed.inject(PracticaService).obtenerSeguimientos('15', 50, 100).subscribe({
      error: error => expect(error.status).toBe(503)
    });
    const req = http.expectOne(request => request.url === 'http://127.0.0.1:8000/practicas/15/seguimientos');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.keys()).toEqual(['limit', 'offset']);
    expect(req.request.params.get('limit')).toBe('50');
    expect(req.request.params.get('offset')).toBe('100');
    expect(req.request.headers.get('Authorization')).toBe('Bearer synthetic-test-token');
    req.flush({}, { status: 503, statusText: 'Unavailable' });
  });

  it('sends only allowed fields and JWT, preserving HTTP status', () => {
    const datos = { fecha: '2026-01-01', tipo: 'Otro' as const, observacion: ' Texto ', id_usuario: 999 };
    TestBed.inject(PracticaService).registrarSeguimiento('15', datos).subscribe(response => {
      expect(response.status).toBe(201);
    });
    const req = http.expectOne('http://127.0.0.1:8000/practicas/15/seguimientos');
    expect(req.request.method).toBe('POST');
    expect(req.request.headers.get('Authorization')).toBe('Bearer synthetic-test-token');
    expect(req.request.body).toEqual({ fecha: datos.fecha, tipo: 'Otro', observacion: datos.observacion });
    req.flush({}, { status: 201, statusText: 'Created' });
  });

  it('does not retry a failed write', () => {
    TestBed.inject(PracticaService).registrarSeguimiento('15', {
      fecha: '2026-01-01', tipo: 'Otro', observacion: 'Texto'
    }).subscribe({ error: error => expect(error.status).toBe(503) });
    http.expectOne('http://127.0.0.1:8000/practicas/15/seguimientos')
      .flush({}, { status: 503, statusText: 'Unavailable' });
  });

  it('preserves authentication and management role guards', () => {
    const route = routes.find(item => item.path === 'practicas/:id/seguimiento/nuevo')!;
    expect(route.canActivate).toEqual([authGuard, roleGuard]);
    expect(route.data?.['roles']).toEqual(['GESTOR', 'ADMINISTRADOR']);
  });
});
