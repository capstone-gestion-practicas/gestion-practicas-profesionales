import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Subject, of, throwError } from 'rxjs';
import { EvaluacionPanel } from './evaluacion-panel';
import { ConsultaAcademica, Evaluacion, EvaluacionService } from './evaluacion.service';

const pendiente: Evaluacion = {
  id_evaluacion: '11111111-1111-4111-8111-111111111111', id_practica: 7, id_documento: 9,
  version: 1, id_docente: 20, estado: 'EN_CURSO', resultado: null, observaciones: null,
  motivo: null, inicio: '2026-11-09T12:00:00Z', termino: null
};
const inicial = (): ConsultaAcademica => ({ id_practica: 7, id_documento: 9, version: 1,
  estado_informe: 'ENTREGADO', evaluacion_pendiente: null, resultado_vigente: null, historial: [] });
const enCurso = (): ConsultaAcademica => ({ ...inicial(), estado_informe: 'EN_EVALUACION',
  evaluacion_pendiente: pendiente, historial: [{ ...pendiente, eventos: [] }] });
const aprobada: Evaluacion = { ...pendiente, estado: 'RESUELTA', resultado: 'APROBADO', termino: '2026-11-09T13:00:00Z' };

describe('EvaluacionPanel: flujo académico', () => {
  let fixture: ComponentFixture<EvaluacionPanel>;
  let panel: EvaluacionPanel;
  let api: jasmine.SpyObj<EvaluacionService>;
  beforeEach(async () => {
    api = jasmine.createSpyObj<EvaluacionService>('EvaluacionService', ['consultar', 'iniciar', 'resolver']);
    api.consultar.and.returnValue(of(inicial()));
    await TestBed.configureTestingModule({ imports: [EvaluacionPanel],
      providers: [{ provide: EvaluacionService, useValue: api }] }).compileComponents();
    fixture = TestBed.createComponent(EvaluacionPanel); panel = fixture.componentInstance;
    fixture.componentRef.setInput('idPractica', 7); fixture.componentRef.setInput('docente', true);
    fixture.detectChanges();
  });
  afterEach(() => fixture.destroy());
  const error = (status: number) => new HttpErrorResponse({ status });
  function cargarEnCurso(): void { api.consultar.and.returnValue(of(enCurso())); panel.cargar(); fixture.detectChanges(); }

  it('carga versión e historial sin iniciar automáticamente', () => {
    expect(api.consultar).toHaveBeenCalledOnceWith(7); expect(api.iniciar).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Versión vigente: 1');
    expect(fixture.nativeElement.textContent).toContain('Iniciar evaluación');
    expect(fixture.nativeElement.textContent).toContain('Todavía no hay evaluaciones');
  });
  it('muestra carga y no permite actuar hasta recibir la consulta', () => {
    const consulta = new Subject<ConsultaAcademica>(); api.consultar.and.returnValue(consulta);
    panel.cargar(); panel.iniciar(); fixture.detectChanges();
    expect(panel.cargando()).toBeTrue(); expect(api.iniciar).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Consultando evaluación');
    consulta.next(inicial()); expect(panel.cargando()).toBeFalse();
  });
  it('inicio explícito conserva clave al reintentar y evita doble envío', () => {
    api.iniciar.and.returnValue(throwError(() => error(503))); panel.iniciar();
    const primero = api.iniciar.calls.mostRecent().args;
    const envio = new Subject<Evaluacion>(); api.iniciar.and.returnValue(envio);
    panel.iniciar(); panel.iniciar();
    expect(api.iniciar).toHaveBeenCalledTimes(2); expect(api.iniciar.calls.mostRecent().args).toEqual(primero);
    expect(primero.slice(0, 3)).toEqual([7, 9, 1]); expect(primero[3]).toMatch(/^[0-9a-f-]{36}$/);
    api.consultar.and.returnValue(of(enCurso())); envio.next(pendiente); fixture.detectChanges();
    expect(panel.enviando()).toBeFalse(); expect(panel.datos()?.evaluacion_pendiente).toEqual(pendiente);
    expect(fixture.nativeElement.textContent).toContain('El PDF queda bloqueado');
  });
  it('resuelve APROBADO y actualiza resultado e historial', () => {
    cargarEnCurso();
    api.resolver.and.returnValue(of(aprobada));
    api.consultar.and.returnValue(of({ ...inicial(), resultado_vigente: aprobada, historial: [{ ...aprobada, eventos: [] }] }));
    panel.resolver(); fixture.detectChanges();
    expect(api.resolver.calls.mostRecent().args.slice(0, 3)).toEqual([7, pendiente.id_evaluacion, { resultado: 'APROBADO', observaciones: null }]);
    expect(panel.puedeIniciar()).toBeFalse(); expect(panel.puedeResolver()).toBeFalse();
    expect(fixture.nativeElement.textContent).toContain('Existe aprobación académica vigente');
    expect(fixture.nativeElement.textContent).toContain('El reemplazo está bloqueado');
    expect(fixture.nativeElement.textContent).toContain('no cierra la práctica');
  });
  it('exige observaciones no vacías sin invocar HTTP', () => {
    cargarEnCurso(); panel.resultado = 'CON_OBSERVACIONES'; panel.observaciones = '\u2003 \n'; panel.resolver();
    expect(api.resolver).not.toHaveBeenCalled(); expect(panel.error()).toContain('no vacías');
  });
  it('rechaza 2001 caracteres y caracteres nulos antes de resolver', () => {
    cargarEnCurso(); panel.observaciones = 'x'.repeat(2001); panel.resolver();
    panel.observaciones = 'texto\0'; panel.resolver(); expect(api.resolver).not.toHaveBeenCalled();
  });
  it('admite 2000 caracteres y normaliza CON_OBSERVACIONES', () => {
    cargarEnCurso(); panel.resultado = 'CON_OBSERVACIONES'; panel.observaciones = 'x'.repeat(2000);
    api.resolver.and.returnValue(throwError(() => error(503))); panel.resolver();
    expect(api.resolver.calls.mostRecent().args[2].observaciones?.length).toBe(2000);
    panel.observaciones = '  Corrige las conclusiones  '; panel.resolver();
    expect(api.resolver.calls.mostRecent().args[2]).toEqual({ resultado: 'CON_OBSERVACIONES', observaciones: 'Corrige las conclusiones' });
  });
  it('conserva la clave de resolución para el mismo contenido y crea otra si cambia', () => {
    cargarEnCurso(); api.resolver.and.returnValue(throwError(() => error(503)));
    panel.resultado = 'CON_OBSERVACIONES'; panel.observaciones = 'A'; panel.resolver();
    const primero = api.resolver.calls.mostRecent().args;
    panel.resolver(); expect(api.resolver.calls.mostRecent().args).toEqual(primero);
    panel.observaciones = 'B'; panel.resolver(); expect(api.resolver.calls.mostRecent().args[3]).not.toBe(primero[3]);
    panel.observaciones = 'A'; panel.resolver(); expect(api.resolver.calls.mostRecent().args).toEqual(primero);
  });
  it('no envía una segunda resolución mientras la primera está pendiente', () => {
    cargarEnCurso(); const envio = new Subject<Evaluacion>(); api.resolver.and.returnValue(envio);
    panel.resolver(); panel.resolver(); expect(api.resolver).toHaveBeenCalledTimes(1);
    expect(panel.enviando()).toBeTrue();
  });
  it('muestra observaciones y orientación de reentrega solo en espacio estudiante', () => {
    fixture.componentRef.setInput('docente', false); fixture.componentRef.setInput('estudiante', true);
    const observada: Evaluacion = { ...aprobada, resultado: 'CON_OBSERVACIONES', observaciones: 'Corrige el análisis' };
    api.consultar.and.returnValue(of({ ...inicial(), resultado_vigente: observada, historial: [{ ...observada, eventos: [] }] }));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Corrige el análisis');
    expect(fixture.nativeElement.textContent).toContain('entrega una nueva versión');
    panel.iniciar(); panel.resolver(); expect(api.iniciar).not.toHaveBeenCalled(); expect(api.resolver).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('select')).toBeNull();
  });
  it('confirma CON_OBSERVACIONES, termina la evaluación y anuncia reentrega', () => {
    cargarEnCurso(); fixture.componentRef.setInput('estudiante', true); fixture.detectChanges();
    panel.resultado = 'CON_OBSERVACIONES'; panel.observaciones = 'Corregir análisis';
    const observada: Evaluacion = { ...aprobada, resultado: 'CON_OBSERVACIONES', observaciones: 'Corregir análisis' };
    api.resolver.and.returnValue(of(observada));
    api.consultar.and.returnValue(of({ ...inicial(), resultado_vigente: observada, historial: [{ ...observada, eventos: [] }] }));
    const cambio = jasmine.createSpy('cambio'); panel.cambio.subscribe(cambio);
    panel.resolver(); fixture.detectChanges();
    expect(cambio).toHaveBeenCalledTimes(1); expect(panel.datos()?.evaluacion_pendiente).toBeNull();
    expect(panel.puedeIniciar()).toBeFalse(); expect(panel.puedeResolver()).toBeFalse();
    expect(fixture.nativeElement.textContent).toContain('entrega una nueva versión');
    expect(fixture.nativeElement.textContent).toContain('Corregir análisis');
  });
  it('no inicia evaluación sin PDF confirmado visible', () => {
    api.consultar.and.returnValue(of({ ...inicial(), id_documento: null, version: 0, estado_informe: 'SIN_ENTREGAR' }));
    panel.cargar(); panel.iniciar(); expect(api.iniciar).not.toHaveBeenCalled();
  });
  it('no hereda aprobación de una versión anterior y conserva el historial', () => {
    api.consultar.and.returnValue(of({ ...inicial(), id_documento: 10, version: 2,
      historial: [{ ...aprobada, eventos: [{ id_evento: 1, id_evaluacion: aprobada.id_evaluacion, id_actor: 20,
        tipo: 'RESUELTA', fecha: aprobada.termino!, detalle: 'Resultado registrado' }] }] }));
    panel.cargar(); fixture.detectChanges();
    expect(panel.puedeIniciar()).toBeTrue(); expect(panel.aprobacionVigente(panel.datos())).toBeFalse();
    expect(fixture.nativeElement.textContent).toContain('Versión vigente: 2');
    expect(fixture.nativeElement.textContent).toContain('Resultado registrado');
  });
  for (const status of [401, 403, 404, 409]) {
    it(`invalida información y bloquea acciones ante ${status}, sin reintento automático`, () => {
      cargarEnCurso(); api.resolver.and.returnValue(throwError(() => error(status))); panel.resolver();
      panel.resolver(); fixture.detectChanges();
      expect(api.resolver).toHaveBeenCalledTimes(1); expect(panel.datos()).toBeNull();
      expect(fixture.nativeElement.querySelector('[role=alert]')).not.toBeNull();
      expect(fixture.nativeElement.querySelector('select')).toBeNull();
      api.consultar.and.returnValue(of(inicial())); panel.cargar(); expect(panel.puedeIniciar()).toBeTrue();
    });
  }
  it('gestor consulta sin controles docentes y sin operaciones de cierre nuevas', () => {
    fixture.componentRef.setInput('docente', false); fixture.detectChanges();
    panel.iniciar(); panel.resolver(); expect(api.iniciar).not.toHaveBeenCalled(); expect(api.resolver).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Sin aprobación académica vigente');
    expect(fixture.nativeElement.querySelector('select')).toBeNull();
  });
  it('cancela consultas anteriores al cambiar práctica o destruir el panel', () => {
    const consulta = new Subject<ConsultaAcademica>(); api.consultar.and.returnValue(consulta); panel.cargar();
    fixture.componentRef.setInput('idPractica', 8); fixture.detectChanges();
    expect(consulta.observers.length).toBe(1); fixture.destroy(); expect(consulta.observed).toBeFalse();
  });
});
