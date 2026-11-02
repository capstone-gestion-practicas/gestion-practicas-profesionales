import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { PracticaService } from './practica.service';
import { authInterceptor } from '../interceptors/auth.interceptor';

describe('HU017 HTTP contract · resumen de incidencias pendientes', () => {
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

  it('sends a GET with only limit and offset, and the existing JWT interceptor', () => {
    let recibido: unknown;
    TestBed.inject(PracticaService).obtenerResumenIncidenciasPendientes(100, 200).subscribe(r => { recibido = r; });
    const req = http.expectOne(request => request.url === 'http://127.0.0.1:8000/practicas/con-incidencias-pendientes');
    expect(req.request.method).toBe('GET');
    expect(req.request.headers.get('Authorization')).toBe('Bearer synthetic-test-token');
    expect(req.request.params.keys().sort()).toEqual(['limit', 'offset']);
    expect(req.request.params.get('limit')).toBe('100');
    expect(req.request.params.get('offset')).toBe('200');
    const body = { items: [], limit: 100, offset: 200, hay_mas: false };
    req.flush(body);
    expect(recibido).toEqual(body);
  });

  it('uses the default page size of 100 and offset 0', () => {
    TestBed.inject(PracticaService).obtenerResumenIncidenciasPendientes().subscribe();
    const req = http.expectOne(request => request.url.endsWith('/practicas/con-incidencias-pendientes'));
    expect(req.request.params.get('limit')).toBe('100');
    expect(req.request.params.get('offset')).toBe('0');
    req.flush({ items: [], limit: 100, offset: 0, hay_mas: false });
  });

  it('never sends identity, roles or extra filters from the client', () => {
    TestBed.inject(PracticaService).obtenerResumenIncidenciasPendientes(50, 0).subscribe();
    const req = http.expectOne(request => request.url.endsWith('/practicas/con-incidencias-pendientes'));
    for (const forbidden of ['id_usuario', 'roles', 'rol', 'estado', 'rut', 'usuario']) {
      expect(req.request.params.has(forbidden)).toBeFalse();
    }
    expect(req.request.body).toBeNull();
    req.flush({ items: [], limit: 50, offset: 0, hay_mas: false });
  });

  it('propagates HTTP status so the list can show an error without zeros', () => {
    let status = 0;
    TestBed.inject(PracticaService).obtenerResumenIncidenciasPendientes().subscribe({ error: e => { status = e.status; } });
    const req = http.expectOne(request => request.url.endsWith('/practicas/con-incidencias-pendientes'));
    req.flush({ detail: 'No tiene permisos para consultar incidencias' }, { status: 403, statusText: 'Forbidden' });
    expect(status).toBe(403);
  });
});
