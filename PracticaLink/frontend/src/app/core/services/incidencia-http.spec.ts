import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { PracticaService } from './practica.service';
import { authInterceptor } from '../interceptors/auth.interceptor';
import { routes } from '../../app.routes';
import { authGuard } from '../guards/auth.guard';
import { roleGuard } from '../guards/role.guard';

describe('HU015 HTTP contract', () => {
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

  it('sends only allowed fields and JWT, preserving HTTP status', () => {
    const datos = { tipo: 'OTRO' as const, descripcion: ' Texto ', id_usuario: 999 };
    TestBed.inject(PracticaService).registrarIncidencia('15', datos).subscribe(response => {
      expect(response.status).toBe(201);
    });
    const req = http.expectOne('http://127.0.0.1:8000/practicas/15/incidencias');
    expect(req.request.method).toBe('POST');
    expect(req.request.headers.get('Authorization')).toBe('Bearer synthetic-test-token');
    expect(req.request.body).toEqual({ tipo: 'OTRO', descripcion: datos.descripcion });
    req.flush({}, { status: 201, statusText: 'Created' });
  });

  it('queries the selected practice with pagination and the existing JWT interceptor', () => {
    const page = { id_practica: 16, items: [], limit: 50, offset: 50, hay_mas: false };
    TestBed.inject(PracticaService).obtenerIncidencias('16', 50, 50)
      .subscribe(response => expect(response).toEqual(page));
    const req = http.expectOne('http://127.0.0.1:8000/practicas/16/incidencias?limit=50&offset=50');
    expect(req.request.method).toBe('GET');
    expect(req.request.headers.get('Authorization')).toBe('Bearer synthetic-test-token');
    expect(req.request.body).toBeNull();
    req.flush(page);
  });

  it('does not retry a failed write', () => {
    TestBed.inject(PracticaService).registrarIncidencia('15', {
      tipo: 'OTRO', descripcion: 'Texto'
    }).subscribe({ error: error => expect(error.status).toBe(503) });
    http.expectOne('http://127.0.0.1:8000/practicas/15/incidencias')
      .flush({}, { status: 503, statusText: 'Unavailable' });
  });

  it('preserves authentication and management role guards', () => {
    const route = routes.find(item => item.path === 'practicas/:id/incidencias/nueva')!;
    expect(route.canActivate).toEqual([authGuard, roleGuard]);
    expect(route.data?.['roles']).toEqual(['GESTOR', 'ADMINISTRADOR']);
  });
});
