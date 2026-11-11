import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';

import { CerrarPracticaResponse } from '../../../core/models/practica.models';
import { PracticaService } from '../../../core/services/practica.service';
import { EstadoAcademico, EvaluacionService } from '../../evaluaciones/evaluacion.service';
import { CierrePractica } from './cierre-practica';

const aprobado = (idPractica = 7, cambios: Partial<EstadoAcademico> = {}): EstadoAcademico => ({
  id_practica: idPractica, id_documento: 9, version: 1, estado_informe: 'ENTREGADO', evaluacion_pendiente: null,
  resultado_vigente: {
    id_evaluacion: 'uuid-sintetico', id_practica: idPractica, id_documento: 9, version: 1, id_docente: 20,
    estado: 'RESUELTA', resultado: 'APROBADO', observaciones: null, motivo: null,
    inicio: '2026-11-09T12:00:00Z', termino: '2026-11-09T13:00:00Z'
  },
  ...cambios
});

const cierreOk = (idPractica = 7): CerrarPracticaResponse => ({
  id_practica: idPractica, id_cierre: 1, id_historial: 2, estado: 'FINALIZADA',
  fecha_cierre: '2026-11-11', mensaje: 'Práctica finalizada correctamente.'
});

const errorHttp = (status: number, detail?: string) =>
  throwError(() => new HttpErrorResponse({ status, error: detail === undefined ? null : { detail } }));

describe('CierrePractica', () => {
  let fixture: ComponentFixture<CierrePractica>;
  let componente: CierrePractica;
  let evaluaciones: jasmine.SpyObj<EvaluacionService>;
  let practicas: jasmine.SpyObj<PracticaService>;
  let emitidos: CerrarPracticaResponse[];

  const raiz = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const texto = (): string => (raiz().textContent ?? '').replace(/\s+/g, ' ');
  const boton = (etiqueta: string): HTMLElement | undefined =>
    Array.from(raiz().querySelectorAll('ion-button') as NodeListOf<HTMLElement>)
      .find(item => item.textContent?.replace(/\s+/g, ' ').trim() === etiqueta);
  const deshabilitado = (etiqueta: string): boolean =>
    (boton(etiqueta) as unknown as { disabled: boolean } | undefined)?.disabled === true;

  function crear(idPractica = 7, candidata = true): void {
    fixture = TestBed.createComponent(CierrePractica);
    componente = fixture.componentInstance;
    fixture.componentRef.setInput('idPractica', idPractica);
    fixture.componentRef.setInput('candidata', candidata);
    componente.cerrada.subscribe(respuesta => emitidos.push(respuesta));
    fixture.detectChanges();
  }

  function cambiar(entradas: { idPractica?: number; candidata?: boolean }): void {
    if (entradas.idPractica !== undefined) fixture.componentRef.setInput('idPractica', entradas.idPractica);
    if (entradas.candidata !== undefined) fixture.componentRef.setInput('candidata', entradas.candidata);
    fixture.detectChanges();
  }

  function consultarConAprobacion(estado: EstadoAcademico = aprobado()): void {
    evaluaciones.vigente.and.returnValue(of(estado));
    componente.consultarAprobacion();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    emitidos = [];
    evaluaciones = jasmine.createSpyObj<EvaluacionService>('EvaluacionService', ['vigente']);
    practicas = jasmine.createSpyObj<PracticaService>('PracticaService', ['cerrarPractica']);
    await TestBed.configureTestingModule({
      imports: [CierrePractica],
      providers: [
        { provide: EvaluacionService, useValue: evaluaciones },
        { provide: PracticaService, useValue: practicas }
      ]
    }).compileComponents();
  });

  afterEach(() => fixture?.destroy());

  describe('candidatura', () => {
    it('no muestra nada ni consulta si la práctica no es candidata', () => {
      crear(7, false);
      expect(raiz().querySelector('section')).toBeNull();
      componente.consultarAprobacion();
      componente.finalizar();
      expect(evaluaciones.vigente).not.toHaveBeenCalled();
      expect(practicas.cerrarPractica).not.toHaveBeenCalled();
    });

    it('candidata: muestra la sección con Finalizar deshabilitado hasta consultar', () => {
      crear();
      expect(raiz().querySelector('#cierre-titulo')?.textContent?.trim()).toBe('Cierre de práctica');
      expect(boton('Consultar aprobación académica')).toBeDefined();
      expect(deshabilitado('Finalizar práctica')).toBeTrue();
      expect(componente.puedeFinalizar()).toBeFalse();
      expect(texto()).toContain('Consulta la evaluación antes de cerrar.');
      componente.finalizar();
      expect(practicas.cerrarPractica).not.toHaveBeenCalled();
    });
  });

  describe('consulta de aprobación académica', () => {
    it('consulta la evaluación vigente de la práctica y habilita Finalizar con aprobación válida', () => {
      crear();
      evaluaciones.vigente.and.returnValue(of(aprobado()));
      boton('Consultar aprobación académica')?.click();
      fixture.detectChanges();
      expect(evaluaciones.vigente).toHaveBeenCalledWith(7);
      expect(componente.puedeFinalizar()).toBeTrue();
      expect(deshabilitado('Finalizar práctica')).toBeFalse();
      expect(texto()).toContain('Aprobación académica vigente de la versión 1');
    });

    it('muestra el estado de carga e impide consultas simultáneas', () => {
      crear();
      const pendiente = new Subject<EstadoAcademico>();
      evaluaciones.vigente.and.returnValue(pendiente);
      componente.consultarAprobacion();
      componente.consultarAprobacion();
      fixture.detectChanges();
      expect(evaluaciones.vigente).toHaveBeenCalledTimes(1);
      expect(texto()).toContain('Consultando aprobación académica…');
      expect(raiz().querySelector('section')?.getAttribute('aria-busy')).toBe('true');
      expect(deshabilitado('Consultar aprobación académica')).toBeTrue();
      expect(componente.puedeFinalizar()).toBeFalse();
    });

    it('no habilita Finalizar con evaluación pendiente, con observaciones o inexistente', () => {
      const pendiente = aprobado(7).resultado_vigente!;
      const casos: [string, EstadoAcademico][] = [
        ['evaluación pendiente', aprobado(7, { evaluacion_pendiente: { ...pendiente, estado: 'EN_CURSO', resultado: null } })],
        ['resultado con observaciones', aprobado(7, { resultado_vigente: { ...pendiente, resultado: 'CON_OBSERVACIONES' } })],
        ['sin evaluación', aprobado(7, { resultado_vigente: null })],
        ['sin informe', aprobado(7, { id_documento: null, estado_informe: 'SIN_ENTREGAR', resultado_vigente: null })],
        ['otra versión', aprobado(7, { version: 2 })]
      ];
      crear();
      for (const [caso, estado] of casos) {
        consultarConAprobacion(estado);
        expect(componente.puedeFinalizar()).withContext(caso).toBeFalse();
        expect(texto()).withContext(caso).toContain('Sin aprobación académica vigente');
      }
    });

    it('401, 403 y 404 informan falta de acceso; otros errores piden actualizar', () => {
      crear();
      for (const [status, mensaje] of [
        [401, 'Sin acceso a la evaluación'], [403, 'Sin acceso a la evaluación'], [404, 'Sin acceso a la evaluación'],
        [500, 'No se pudo verificar la aprobación'], [503, 'No se pudo verificar la aprobación']
      ] as const) {
        evaluaciones.vigente.and.returnValue(errorHttp(status));
        componente.consultarAprobacion();
        fixture.detectChanges();
        expect(raiz().querySelector('[role="alert"]')?.textContent).withContext(String(status)).toContain(mensaje);
        expect(componente.puedeFinalizar()).withContext(String(status)).toBeFalse();
      }
    });

    it('una consulta nueva borra la aprobación anterior antes de responder', () => {
      crear();
      consultarConAprobacion();
      evaluaciones.vigente.and.returnValue(new Subject<EstadoAcademico>());
      componente.consultarAprobacion();
      expect(componente.puedeFinalizar()).toBeFalse();
    });
  });

  describe('finalizar', () => {
    it('cierra con el endpoint existente y emite una sola vez tras la confirmación del backend', () => {
      crear();
      consultarConAprobacion();
      practicas.cerrarPractica.and.returnValue(of(cierreOk()));
      boton('Finalizar práctica')?.click();
      fixture.detectChanges();
      expect(practicas.cerrarPractica).toHaveBeenCalledOnceWith(7, null);
      expect(emitidos).toEqual([cierreOk()]);
      expect(texto()).toContain('Práctica finalizada correctamente.');
      expect(boton('Finalizar práctica')).toBeUndefined();
      componente.finalizar();
      componente.consultarAprobacion();
      expect(practicas.cerrarPractica).toHaveBeenCalledTimes(1);
      expect(emitidos.length).toBe(1);
    });

    it('doble clic: una sola solicitud y botón deshabilitado durante el envío', () => {
      crear();
      consultarConAprobacion();
      const envio = new Subject<CerrarPracticaResponse>();
      practicas.cerrarPractica.and.returnValue(envio);
      componente.finalizar();
      componente.finalizar();
      fixture.detectChanges();
      expect(practicas.cerrarPractica).toHaveBeenCalledTimes(1);
      expect(boton('Finalizando...')).toBeDefined();
      expect(deshabilitado('Finalizando...')).toBeTrue();
      expect(deshabilitado('Consultar aprobación académica')).toBeTrue();
      expect(emitidos).toEqual([]);
      envio.next(cierreOk());
      envio.complete();
      expect(emitidos.length).toBe(1);
    });

    for (const [status, detalle] of [
      [401, 'Autenticación requerida'],
      [403, 'No tienes autorización académica para esta operación.'],
      [409, 'La práctica debe estar EN_CURSO y haber alcanzado su fecha de término'],
      [503, 'No fue posible cerrar la práctica.']
    ] as const) {
      it(`error ${status}: muestra el detalle del servidor, invalida la aprobación y no reintenta`, () => {
        crear();
        consultarConAprobacion();
        practicas.cerrarPractica.and.returnValue(errorHttp(status, detalle));
        componente.finalizar();
        fixture.detectChanges();
        expect(raiz().querySelector('[role="alert"]')?.textContent?.trim()).toBe(detalle);
        expect(componente.puedeFinalizar()).toBeFalse();
        expect(texto()).toContain('Consulta la evaluación antes de cerrar.');
        expect(deshabilitado('Consultar aprobación académica')).toBeFalse();
        expect(practicas.cerrarPractica).toHaveBeenCalledTimes(1);
        expect(emitidos).toEqual([]);
      });
    }

    it('sin detalle del servidor usa el mensaje existente de GestionEstados', () => {
      crear();
      consultarConAprobacion();
      practicas.cerrarPractica.and.returnValue(errorHttp(500));
      componente.finalizar();
      fixture.detectChanges();
      expect(raiz().querySelector('[role="alert"]')?.textContent?.trim()).toBe('No fue posible finalizar la práctica.');
    });

    it('tras un rechazo exige volver a consultar antes de reintentar manualmente', () => {
      crear();
      consultarConAprobacion();
      practicas.cerrarPractica.and.returnValue(errorHttp(409, 'Conflicto'));
      componente.finalizar();
      componente.finalizar();
      expect(practicas.cerrarPractica).toHaveBeenCalledTimes(1);
      consultarConAprobacion();
      practicas.cerrarPractica.and.returnValue(of(cierreOk()));
      componente.finalizar();
      expect(practicas.cerrarPractica).toHaveBeenCalledTimes(2);
      expect(emitidos.length).toBe(1);
    });
  });

  describe('concurrencia y cambios de entrada', () => {
    it('cambiar de práctica durante la consulta la cancela e ignora su respuesta', () => {
      crear(7);
      const vieja = new Subject<EstadoAcademico>();
      evaluaciones.vigente.and.returnValue(vieja);
      componente.consultarAprobacion();
      cambiar({ idPractica: 8 });
      expect(vieja.observed).toBeFalse();
      vieja.next(aprobado(7));
      fixture.detectChanges();
      expect(componente.puedeFinalizar()).toBeFalse();
      expect(texto()).toContain('Consulta la evaluación antes de cerrar.');
    });

    it('una respuesta tardía de otra práctica no habilita acciones aunque llegue antes del refresco', () => {
      crear(7);
      const vieja = new Subject<EstadoAcademico>();
      evaluaciones.vigente.and.returnValue(vieja);
      componente.consultarAprobacion();
      // La entrada cambia y la respuesta llega antes de la detección de cambios (ngOnChanges).
      fixture.componentRef.setInput('idPractica', 8);
      vieja.next(aprobado(7));
      fixture.detectChanges();
      expect(componente.puedeFinalizar()).toBeFalse();

      const nueva = new Subject<EstadoAcademico>();
      evaluaciones.vigente.and.returnValue(nueva);
      componente.consultarAprobacion();
      expect(evaluaciones.vigente).toHaveBeenCalledWith(8);
      nueva.next(aprobado(8));
      fixture.detectChanges();
      expect(componente.puedeFinalizar()).toBeTrue();
    });

    it('cambiar de práctica durante el cierre no cancela el POST, pero ignora su resultado y no emite', () => {
      crear(7);
      consultarConAprobacion();
      const envio = new Subject<CerrarPracticaResponse>();
      practicas.cerrarPractica.and.returnValue(envio);
      componente.finalizar();
      cambiar({ idPractica: 8 });
      expect(envio.observed).toBeTrue();
      expect(componente.puedeFinalizar()).toBeFalse();
      expect(deshabilitado('Consultar aprobación académica')).toBeFalse();
      envio.next(cierreOk(7));
      envio.complete();
      fixture.detectChanges();
      expect(emitidos).toEqual([]);
      expect(texto()).not.toContain('Práctica finalizada correctamente.');
    });

    it('un error tardío del cierre anterior no se muestra en la práctica nueva', () => {
      crear(7);
      consultarConAprobacion();
      const envio = new Subject<CerrarPracticaResponse>();
      practicas.cerrarPractica.and.returnValue(envio);
      componente.finalizar();
      cambiar({ idPractica: 8 });
      envio.error(new HttpErrorResponse({ status: 409, error: { detail: 'Conflicto anterior' } }));
      fixture.detectChanges();
      expect(texto()).not.toContain('Conflicto anterior');
    });

    it('invalida la aprobación cuando cambia la condición de candidata', () => {
      crear();
      consultarConAprobacion();
      expect(componente.puedeFinalizar()).toBeTrue();
      cambiar({ candidata: false });
      expect(raiz().querySelector('section')).toBeNull();
      cambiar({ candidata: true });
      expect(componente.puedeFinalizar()).toBeFalse();
      expect(texto()).toContain('Consulta la evaluación antes de cerrar.');
    });

    it('si deja de ser candidata y la respuesta llega antes del refresco, se ignora', () => {
      crear();
      const pendiente = new Subject<EstadoAcademico>();
      evaluaciones.vigente.and.returnValue(pendiente);
      componente.consultarAprobacion();
      fixture.componentRef.setInput('candidata', false);
      pendiente.next(aprobado());
      fixture.componentRef.setInput('candidata', true);
      fixture.detectChanges();
      expect(componente.puedeFinalizar()).toBeFalse();
    });

    it('si deja de ser candidata durante la consulta, la respuesta se ignora', () => {
      crear();
      const pendiente = new Subject<EstadoAcademico>();
      evaluaciones.vigente.and.returnValue(pendiente);
      componente.consultarAprobacion();
      cambiar({ candidata: false });
      cambiar({ candidata: true });
      pendiente.next(aprobado());
      expect(componente.puedeFinalizar()).toBeFalse();
    });
  });

  describe('destrucción con solicitudes pendientes', () => {
    it('cancela la consulta en curso', () => {
      crear();
      const pendiente = new Subject<EstadoAcademico>();
      evaluaciones.vigente.and.returnValue(pendiente);
      componente.consultarAprobacion();
      fixture.destroy();
      expect(pendiente.observed).toBeFalse();
    });

    it('no emite ni actualiza estado si el cierre termina después de destruir el componente', () => {
      crear();
      consultarConAprobacion();
      const envio = new Subject<CerrarPracticaResponse>();
      practicas.cerrarPractica.and.returnValue(envio);
      componente.finalizar();
      fixture.destroy();
      expect(() => { envio.next(cierreOk()); envio.complete(); }).not.toThrow();
      expect(emitidos).toEqual([]);
    });
  });
});
