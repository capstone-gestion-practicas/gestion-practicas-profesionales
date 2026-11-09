import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '../../../environments/environment';
import { EstadoAcademico, Evaluacion, EvaluacionService, aprobacionVigente } from './evaluacion.service';

describe('EvaluacionService: contratos HTTP', () => {
  let api: EvaluacionService; let http: HttpTestingController;
  const ruta = `${environment.apiUrl}/practicas/7/evaluaciones`;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    api = TestBed.inject(EvaluacionService); http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());
  it('consulta estado e historial exclusivamente a FastAPI', () => {
    api.consultar(7).subscribe(); const request = http.expectOne(ruta);
    expect(request.request.method).toBe('GET'); request.flush({});
    api.vigente(7).subscribe(); const vigente = http.expectOne(`${ruta}/vigente`);
    expect(vigente.request.method).toBe('GET'); vigente.flush({});
  });
  it('inicia con documento, versión y clave, sin actor del cliente', () => {
    api.iniciar(7, 9, 1, 'uuid-inicio').subscribe(); const request = http.expectOne(`${ruta}/inicio`);
    expect(request.request.method).toBe('POST'); expect(request.request.body).toEqual({ id_documento: 9, version: 1 });
    expect(request.request.headers.get('Idempotency-Key')).toBe('uuid-inicio'); request.flush({});
  });
  for (const resultado of ['APROBADO', 'CON_OBSERVACIONES'] as const) {
    it(`resuelve ${resultado} con UUID y clave sin identidad adicional`, () => {
      api.resolver(7, 'uuid-evaluacion', { resultado, observaciones: 'Texto' }, 'uuid-resolucion').subscribe();
      const request = http.expectOne(`${ruta}/uuid-evaluacion/resolucion`);
      expect(request.request.method).toBe('POST'); expect(request.request.body).toEqual({ resultado, observaciones: 'Texto' });
      expect(request.request.headers.get('Idempotency-Key')).toBe('uuid-resolucion'); request.flush({});
    });
  }
});

describe('Aprobación académica visual', () => {
  const resultado: Evaluacion = { id_evaluacion: 'uuid', id_practica: 7, id_documento: 9, version: 1,
    id_docente: 20, estado: 'RESUELTA', resultado: 'APROBADO', observaciones: null, motivo: null,
    inicio: '2026-11-09T12:00:00Z', termino: '2026-11-09T13:00:00Z' };
  const actual: EstadoAcademico = { id_practica: 7, id_documento: 9, version: 1, estado_informe: 'ENTREGADO',
    evaluacion_pendiente: null, resultado_vigente: resultado };
  it('exige aprobación de la versión exacta sin evaluación pendiente', () => {
    expect(aprobacionVigente(actual)).toBeTrue(); expect(aprobacionVigente(null)).toBeFalse();
    expect(aprobacionVigente({ ...actual, version: 2 })).toBeFalse();
    expect(aprobacionVigente({ ...actual, id_documento: 10 })).toBeFalse();
    expect(aprobacionVigente({ ...actual, evaluacion_pendiente: resultado })).toBeFalse();
    expect(aprobacionVigente({ ...actual, resultado_vigente: { ...resultado, resultado: 'CON_OBSERVACIONES' } })).toBeFalse();
  });
});
