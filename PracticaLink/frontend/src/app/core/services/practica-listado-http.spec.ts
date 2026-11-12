import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { PracticasListadoResponse } from '../models/practica.models';
import { PracticaService } from './practica.service';
import { environment } from '../../../environments/environment';

describe('PracticaService · listado paginado 4b', () => {
  let service: PracticaService;
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(PracticaService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('envía ambos filtros junto a limit y offset, sin identidad ni espacio de trabajo', () => {
    service.listar(50, 100, '12345678-5', 'EN_CURSO').subscribe();
    const req = http.expectOne(r => r.url === `${environment.apiUrl}/practicas`);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.keys().sort()).toEqual(['estado', 'limit', 'offset', 'rut']);
    expect(req.request.params.get('estado')).toBe('EN_CURSO');
    expect(req.request.params.get('rut')).toBe('12345678-5');
    expect(req.request.params.get('offset')).toBe('100');
    expect(req.request.params.get('limit')).toBe('50');
    req.flush({ items: [], limit: 50, offset: 100, hay_mas: false });
  });

  it('omite filtros vacíos y conserva el contrato ampliado y su nulabilidad', () => {
    const data: PracticasListadoResponse = {
      items: [{ id_practica: 1, estudiante: { id_estudiante: 2, nombre: 'Estudiante sintético' },
        centro_practica: 'Centro sintético', fecha_registro: '2026-01-01T00:00:00Z',
        estado: { id_estado: 1, nombre: 'REGISTRADA', es_final: false }, fecha_ultimo_cambio_estado: null,
        rut_estudiante: '11.111.111-1', fecha_inicio: '2026-03-01', fecha_termino: null,
        id_gestor: null, gestor: null }], limit: 50, offset: 0, hay_mas: false
    };
    let respuesta: PracticasListadoResponse | undefined;
    service.listar().subscribe(value => respuesta = value);
    const req = http.expectOne(r => r.url === `${environment.apiUrl}/practicas`);
    expect(req.request.params.keys().sort()).toEqual(['limit', 'offset']);
    req.flush(data);
    expect(respuesta).toEqual(data);
  });
});
