import { TestBed } from '@angular/core/testing';
import {
  HttpClientTestingModule,
  HttpTestingController
} from '@angular/common/http/testing';

import {
  EmpresaLookup,
  PracticaCreate,
  PracticaCreateResponse,
  PracticaDetalleResponse
} from '../models/practica.models';
import { PracticaService } from './practica.service';

describe('PracticaService', () => {
  let service: PracticaService;
  let httpMock: HttpTestingController;

  it('starts a practice with PATCH, exact body and no automatic retry', () => {
    service.iniciar('15', { estado: 'EN_CURSO', observacion: null }).subscribe({
      error: error => expect(error.status).toBe(503)
    });
    const request = httpMock.expectOne('http://127.0.0.1:8000/practicas/15/estado');
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ estado: 'EN_CURSO', observacion: null });
    request.flush({}, { status: 503, statusText: 'Unavailable' });
    httpMock.expectNone('http://127.0.0.1:8000/practicas/15/estado');
  });

  const practicaDetalle: PracticaDetalleResponse = {
    id_practica: 101,
    fecha_registro: '2026-09-01T10:30:00',
    fecha_ultimo_cambio_estado: null,
    estado: {
      id_estado: 1,
      nombre: 'REGISTRADA',
      es_final: false
    },
    centro_practica: {
      id_centro: 22,
      nombre: 'Centro de prueba',
      rut_empresa: '12.345.678-5',
      direccion: 'Av. Siempre Viva 123',
      telefono: '+56 9 1234 5678',
      correo: 'contacto@empresa.cl',
      contacto_nombre: 'Maria Perez',
      contacto_cargo: 'Jefa de practica'
    },
    fecha_inicio: '2026-03-02',
    fecha_termino: '2026-06-30',
    horas: 360,
    cargo_funcion: 'Desarrollador',
    descripcion: 'Practica de caracterizacion'
  };

  const practicaCreate: PracticaCreate = {
    centro: {
      nombre: 'Centro de prueba',
      rut_empresa: '12.345.678-5',
      direccion: 'Av. Siempre Viva 123',
      telefono: '+56 9 1234 5678',
      correo: 'contacto@empresa.cl',
      contacto_nombre: 'Maria Perez',
      contacto_cargo: 'Jefa de practica'
    },
    fecha_inicio: '2026-03-02',
    fecha_termino: '2026-06-30',
    horas: 360,
    cargo_funcion: 'Desarrollador',
    descripcion: 'Practica de caracterizacion'
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule]
    });

    service = TestBed.inject(PracticaService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('uses GET against /practicas/me when obtaining the student practice', () => {
    let respuesta: PracticaDetalleResponse | undefined;

    service.obtenerMiPractica().subscribe((data) => {
      respuesta = data;
    });

    const request = httpMock.expectOne('http://127.0.0.1:8000/practicas/me');
    expect(request.request.method).toBe('GET');

    request.flush(practicaDetalle);

    expect(respuesta).toEqual(practicaDetalle);
  });

  it('keeps registrar using POST /practicas', () => {
    let respuesta: PracticaCreateResponse | undefined;

    service.registrar(practicaCreate).subscribe((data) => {
      respuesta = data;
    });

    const request = httpMock.expectOne('http://127.0.0.1:8000/practicas');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual(practicaCreate);

    request.flush({
      id_practica: 101,
      id_centro: 22,
      estado: 'REGISTRADA',
      mensaje: 'Practica registrada correctamente'
    });

    expect(respuesta).toEqual({
      id_practica: 101,
      id_centro: 22,
      estado: 'REGISTRADA',
      mensaje: 'Practica registrada correctamente'
    });
  });

  it('keeps consultarEmpresa using GET against the company lookup endpoint', () => {
    let respuesta: EmpresaLookup | undefined;

    service.consultarEmpresa('12.345.678-5').subscribe((data) => {
      respuesta = data;
    });

    const request = httpMock.expectOne(
      'http://127.0.0.1:8000/empresas/consulta/12.345.678-5'
    );
    expect(request.request.method).toBe('GET');

    const empresa: EmpresaLookup = {
      found: true,
      rut: '12.345.678-5',
      dv: '5',
      razon_social: 'Centro de prueba',
      fecha_inicio_actividades: null,
      giro: null,
      rubro: null,
      subrubro: null,
      categoria_tributaria: null,
      afecta_iva: null,
      actividades: [],
      comuna: null,
      region: null,
      num_trabajadores: null,
      fuente: 'SII',
      consultado_en: null,
      cache_vigente: false
    };

    request.flush(empresa);

    expect(respuesta).toEqual(empresa);
  });
  it('lists practices with pagination and omits an absent RUT', () => {
    service.listar(50, 0).subscribe();
    const request = httpMock.expectOne(req => req.url === 'http://127.0.0.1:8000/practicas');
    expect(request.request.method).toBe('GET');
    expect(request.request.params.keys()).toEqual(['limit', 'offset']);
    expect(request.request.params.get('limit')).toBe('50');
    expect(request.request.params.get('offset')).toBe('0');
    request.flush({ items: [], limit: 50, offset: 0, hay_mas: false });
  });

  it('sends an exact RUT only as an HTTP query parameter', () => {
    service.listar(50, 100, '12345678-5').subscribe();
    const request = httpMock.expectOne(req => req.url === 'http://127.0.0.1:8000/practicas');
    expect(request.request.params.get('rut')).toBe('12345678-5');
    expect(request.request.params.get('offset')).toBe('100');
    request.flush({ items: [], limit: 50, offset: 100, hay_mas: false });
  });
  it('obtains management detail using the selected identifier', () => {
    const detalle = {
      id_practica: 101, estudiante: { id_estudiante: 1, nombre: 'Estudiante sintético' },
      centro_practica: { id_centro: 22, nombre: 'Centro sintético' },
      fecha_registro: '2026-10-17T12:30:00Z', estado: { id_estado: 6, nombre: 'FINALIZADA', es_final: true },
      fecha_ultimo_cambio_estado: null, fecha_inicio: null, fecha_termino: null,
      horas: null, cargo_funcion: null, descripcion: null
    };
    service.obtenerDetalle('101').subscribe(respuesta => expect(respuesta).toEqual(detalle));
    const request = httpMock.expectOne('http://127.0.0.1:8000/practicas/101');
    expect(request.request.method).toBe('GET');
    expect(request.request.params.keys()).toEqual([]);
    request.flush(detalle);
  });
  it('requests history with the selected identifier and default pagination', () => {
    service.obtenerHistorial('15').subscribe(data => expect(data.items).toEqual([]));
    const request = httpMock.expectOne(req => req.url === 'http://127.0.0.1:8000/practicas/15/historial');
    expect(request.request.method).toBe('GET');
    expect(request.request.params.keys()).toEqual(['limit', 'offset']);
    expect(request.request.params.get('limit')).toBe('50');
    expect(request.request.params.get('offset')).toBe('0');
    request.flush({ id_practica: 15, items: [], limit: 50, offset: 0, hay_mas: false });
  });

  it('sends history pagination without changing detail requests', () => {
    service.obtenerHistorial('15', 10, 20).subscribe();
    const request = httpMock.expectOne(req => req.url.endsWith('/practicas/15/historial'));
    expect(request.request.params.get('limit')).toBe('10');
    expect(request.request.params.get('offset')).toBe('20');
    request.flush({ id_practica: 15, items: [], limit: 10, offset: 20, hay_mas: false });
  });
});
