import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';

import { CerrarPracticaResponse, PracticaDetalleGestionResponse } from '../../core/models/practica.models';
import { CLAVE_ESPACIO_TRABAJO } from '../../core/navigation/espacio-gestor';
import { PracticaService } from '../../core/services/practica.service';
import { SesionService } from '../../core/session/sesion.service';
import { AuthStore } from '../../core/store/auth.store';
import { DocenteService } from '../../features/docente/docente.service';
import { EstadoAcademico, EvaluacionService } from '../../features/evaluaciones/evaluacion.service';
import { CierrePractica } from '../../features/gestor/cierre-practica/cierre-practica';
import { PracticaDetalle } from './practica-detalle';

/** Fecha local del navegador desplazada en días, en formato AAAA-MM-DD. */
function fechaLocal(desplazamientoDias = 0): string {
  const fecha = new Date();
  fecha.setDate(fecha.getDate() + desplazamientoDias);
  return [fecha.getFullYear(), fecha.getMonth() + 1, fecha.getDate()]
    .map((parte, indice) => indice === 0 ? String(parte) : String(parte).padStart(2, '0')).join('-');
}

const detalleCon = (
  idPractica = 15,
  nombre = 'EN_CURSO',
  fechaTermino: string | null = fechaLocal(-1),
  esFinal = false
): PracticaDetalleGestionResponse => ({
  id_practica: idPractica, estudiante: { id_estudiante: 7, nombre: 'Estudiante sintético' },
  centro_practica: { id_centro: 9, nombre: 'Centro sintético' },
  fecha_registro: '2026-01-10T12:00:00Z', estado: { id_estado: 5, nombre, es_final: esFinal },
  fecha_ultimo_cambio_estado: null, fecha_inicio: '2026-02-01', fecha_termino: fechaTermino,
  horas: 360, cargo_funcion: null, descripcion: null
});

const aprobado = (idPractica = 15): EstadoAcademico => ({
  id_practica: idPractica, id_documento: 9, version: 1, estado_informe: 'ENTREGADO', evaluacion_pendiente: null,
  resultado_vigente: {
    id_evaluacion: 'uuid-sintetico', id_practica: idPractica, id_documento: 9, version: 1, id_docente: 20,
    estado: 'RESUELTA', resultado: 'APROBADO', observaciones: null, motivo: null,
    inicio: '2026-11-09T12:00:00Z', termino: '2026-11-09T13:00:00Z'
  }
});

const cierreOk = (idPractica = 15): CerrarPracticaResponse => ({
  id_practica: idPractica, id_cierre: 1, id_historial: 2, estado: 'FINALIZADA',
  fecha_cierre: '2026-11-11', mensaje: 'Práctica finalizada correctamente.'
});

const historialVacio = { id_practica: 15, items: [], limit: 50, offset: 0, hay_mas: false };

describe('PracticaDetalle · cierre académico integrado (etapa 3d)', () => {
  let fixture: ComponentFixture<PracticaDetalle>;
  let componente: PracticaDetalle;
  let practicas: jasmine.SpyObj<PracticaService>;
  let evaluaciones: jasmine.SpyObj<EvaluacionService>;
  let docentes: jasmine.SpyObj<DocenteService>;
  let parametros: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let roles: string[];

  const raiz = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const texto = (): string => (raiz().textContent ?? '').replace(/\s+/g, ' ');
  const cierre = (): CierrePractica | null =>
    fixture.debugElement.query(By.directive(CierrePractica))?.componentInstance ?? null;
  const boton = (etiqueta: string): HTMLElement | undefined =>
    Array.from(raiz().querySelectorAll('ion-button') as NodeListOf<HTMLElement>)
      .find(item => item.textContent?.replace(/\s+/g, ' ').trim() === etiqueta);

  async function crear(rolesUsuario: string[] = ['GESTOR'], espacio: string | null = null): Promise<void> {
    roles = rolesUsuario;
    if (espacio) sessionStorage.setItem(CLAVE_ESPACIO_TRABAJO, espacio);
    await TestBed.configureTestingModule({ imports: [PracticaDetalle], providers: [
      { provide: PracticaService, useValue: practicas },
      { provide: EvaluacionService, useValue: evaluaciones },
      { provide: DocenteService, useValue: docentes },
      { provide: SesionService, useValue: jasmine.createSpyObj<SesionService>('SesionService', ['cerrar']) },
      { provide: AuthStore, useValue: {
        contexto: () => ({ roles, usuario: { id_usuario: 1, nombre: 'Gestor', apellido: 'Sintético' } })
      } },
      { provide: ActivatedRoute, useValue: { paramMap: parametros } },
      { provide: Router, useValue: jasmine.createSpyObj<Router>('Router', ['navigate']) }
    ] }).compileComponents();
    fixture = TestBed.createComponent(PracticaDetalle);
    componente = fixture.componentInstance;
    fixture.detectChanges();
  }

  /** Consulta la aprobación vigente y finaliza mediante el componente integrado. */
  function consultarYFinalizar(): void {
    evaluaciones.vigente.and.returnValue(of(aprobado(Number(componente.idPractica))));
    cierre()!.consultarAprobacion();
    fixture.detectChanges();
    cierre()!.finalizar();
    fixture.detectChanges();
  }

  beforeEach(() => {
    sessionStorage.removeItem(CLAVE_ESPACIO_TRABAJO);
    parametros = new BehaviorSubject(convertToParamMap({ id: '15' }));
    practicas = jasmine.createSpyObj<PracticaService>('PracticaService', [
      'obtenerDetalle', 'obtenerSeguimientos', 'obtenerHistorial', 'obtenerIncidencias', 'cerrarPractica', 'iniciar'
    ]);
    practicas.obtenerDetalle.and.callFake(id => of(detalleCon(Number(id))));
    practicas.obtenerSeguimientos.and.returnValue(of(historialVacio));
    practicas.obtenerHistorial.and.returnValue(of(historialVacio));
    practicas.obtenerIncidencias.and.returnValue(of(historialVacio));
    evaluaciones = jasmine.createSpyObj<EvaluacionService>('EvaluacionService', ['vigente', 'consultar']);
    docentes = jasmine.createSpyObj<DocenteService>('DocenteService', ['consultarAsignacion']);
    docentes.consultarAsignacion.and.returnValue(of({ id_practica: 15, docente_actual: null, docentes_disponibles: [] }));
  });

  afterEach(() => {
    fixture?.destroy();
    sessionStorage.removeItem(CLAVE_ESPACIO_TRABAJO);
  });

  describe('visibilidad según estado y fecha de término', () => {
    const casos: [string, PracticaDetalleGestionResponse, boolean][] = [
      ['EN_CURSO con término vencido', detalleCon(15, 'EN_CURSO', fechaLocal(-10)), true],
      ['EN_CURSO con término hoy', detalleCon(15, 'EN_CURSO', fechaLocal(0)), true],
      ['EN_CURSO con término mañana', detalleCon(15, 'EN_CURSO', fechaLocal(1)), false],
      ['EN_CURSO sin fecha de término', detalleCon(15, 'EN_CURSO', null), false],
      ['EN_CURSO marcado como final', detalleCon(15, 'EN_CURSO', fechaLocal(-1), true), false],
      ['APROBADA', detalleCon(15, 'APROBADA'), false],
      ['OBSERVADA', detalleCon(15, 'OBSERVADA'), false],
      ['FINALIZADA', detalleCon(15, 'FINALIZADA', fechaLocal(-1), true), false],
      ['RECHAZADA', detalleCon(15, 'RECHAZADA', fechaLocal(-1), true), false]
    ];
    for (const [caso, detalle, visible] of casos) {
      it(`${caso}: ${visible ? 'muestra' : 'no muestra'} el cierre`, async () => {
        practicas.obtenerDetalle.and.returnValue(of(detalle));
        await crear();
        expect(componente.puedeCerrar).toBe(visible);
        expect(raiz().querySelector('app-cierre-practica') !== null).toBe(visible);
        expect(evaluaciones.vigente).not.toHaveBeenCalled();
      });
    }
  });

  describe('roles y espacio de trabajo', () => {
    const casos: [string, string[], string | null, boolean][] = [
      ['GESTOR dedicado', ['GESTOR'], null, true],
      ['ESTUDIANTE + GESTOR', ['ESTUDIANTE', 'GESTOR'], null, true],
      ['GESTOR + ADMINISTRADOR en espacio GESTOR', ['GESTOR', 'ADMINISTRADOR'], 'GESTOR', true],
      ['GESTOR + ADMINISTRADOR sin espacio elegido', ['GESTOR', 'ADMINISTRADOR'], null, false],
      ['GESTOR + ADMINISTRADOR en espacio ADMINISTRADOR', ['GESTOR', 'ADMINISTRADOR'], 'ADMINISTRADOR', false],
      ['ADMINISTRADOR', ['ADMINISTRADOR'], null, false],
      ['ADMINISTRADOR con espacio GESTOR guardado', ['ADMINISTRADOR'], 'GESTOR', false]
    ];
    for (const [caso, rolesCaso, espacio, visible] of casos) {
      it(`${caso}: ${visible ? 'muestra' : 'no muestra'} el cierre`, async () => {
        await crear(rolesCaso, espacio);
        expect(raiz().querySelector('app-cierre-practica') !== null).toBe(visible);
      });
    }

    it('GESTOR + ADMINISTRADOR no responsable: el servidor rechaza la consulta y Finalizar no se habilita', async () => {
      await crear(['GESTOR', 'ADMINISTRADOR'], 'GESTOR');
      evaluaciones.vigente.and.returnValue(throwError(() => new HttpErrorResponse({ status: 403 })));
      cierre()!.consultarAprobacion();
      fixture.detectChanges();
      expect(texto()).toContain('Sin acceso a la evaluación. Revisa tu sesión y asignación.');
      expect(cierre()!.puedeFinalizar()).toBeFalse();
      expect(practicas.cerrarPractica).not.toHaveBeenCalled();
    });
  });

  describe('errores de acceso al detalle', () => {
    for (const status of [401, 403, 404]) {
      it(`${status}: no muestra el cierre ni consulta la evaluación`, async () => {
        practicas.obtenerDetalle.and.returnValue(throwError(() => new HttpErrorResponse({ status })));
        await crear();
        expect(componente.detalle).toBeNull();
        expect(componente.puedeCerrar).toBeFalse();
        expect(raiz().querySelector('app-cierre-practica')).toBeNull();
        expect(evaluaciones.vigente).not.toHaveBeenCalled();
      });
    }
  });

  describe('cierre exitoso', () => {
    it('pasa la práctica al componente, usa el endpoint existente y recarga detalle y antecedentes', async () => {
      await crear();
      expect(cierre()!.idPractica()).toBe(15);
      expect(cierre()!.candidata()).toBeTrue();
      practicas.obtenerDetalle.calls.reset();
      practicas.obtenerHistorial.calls.reset();
      practicas.obtenerDetalle.and.returnValue(of(detalleCon(15, 'FINALIZADA', fechaLocal(-1), true)));
      practicas.cerrarPractica.and.returnValue(of(cierreOk()));
      consultarYFinalizar();
      expect(evaluaciones.vigente).toHaveBeenCalledOnceWith(15);
      expect(practicas.cerrarPractica).toHaveBeenCalledOnceWith(15, null);
      expect(practicas.obtenerDetalle).toHaveBeenCalledOnceWith('15');
      expect(practicas.obtenerHistorial).toHaveBeenCalledOnceWith('15', 50, 0);
    });

    it('el mensaje de éxito persiste tras pasar a FINALIZADA, aunque el componente de cierre desaparezca', async () => {
      await crear();
      practicas.obtenerDetalle.and.returnValue(of(detalleCon(15, 'FINALIZADA', fechaLocal(-1), true)));
      practicas.cerrarPractica.and.returnValue(of(cierreOk()));
      consultarYFinalizar();
      expect(componente.detalle?.estado.nombre).toBe('FINALIZADA');
      expect(raiz().querySelector('app-cierre-practica')).toBeNull();
      expect(raiz().querySelector('.mensaje-cierre')?.textContent?.trim()).toBe('Práctica finalizada correctamente.');
      expect(boton('Registrar seguimiento')).toBeUndefined();
      expect(boton('Nueva incidencia')).toBeUndefined();
    });

    it('un cierre rechazado no recarga ni muestra mensaje de éxito', async () => {
      await crear();
      practicas.obtenerDetalle.calls.reset();
      practicas.cerrarPractica.and.returnValue(throwError(() => new HttpErrorResponse({
        status: 409, error: { detail: 'La práctica debe estar EN_CURSO y haber alcanzado su fecha de término' }
      })));
      consultarYFinalizar();
      expect(practicas.obtenerDetalle).not.toHaveBeenCalled();
      expect(componente.mensajeCierre).toBe('');
      expect(texto()).toContain('La práctica debe estar EN_CURSO y haber alcanzado su fecha de término');
    });
  });

  describe('cambios de ruta y resultados obsoletos', () => {
    it('un cierre que termina después de cambiar de práctica no muestra mensaje ni recarga la nueva', async () => {
      await crear();
      const envio = new Subject<CerrarPracticaResponse>();
      practicas.cerrarPractica.and.returnValue(envio);
      consultarYFinalizar();
      parametros.next(convertToParamMap({ id: '16' }));
      fixture.detectChanges();
      expect(componente.idPractica).toBe('16');
      expect(cierre()!.idPractica()).toBe(16);
      practicas.obtenerDetalle.calls.reset();
      envio.next(cierreOk(15));
      envio.complete();
      fixture.detectChanges();
      expect(componente.mensajeCierre).toBe('');
      expect(raiz().querySelector('.mensaje-cierre')).toBeNull();
      expect(practicas.obtenerDetalle).not.toHaveBeenCalled();
    });

    it('el contenedor ignora una confirmación de otra práctica', async () => {
      await crear();
      parametros.next(convertToParamMap({ id: '16' }));
      fixture.detectChanges();
      practicas.obtenerDetalle.calls.reset();
      componente.alCerrarPractica(cierreOk(15));
      expect(componente.mensajeCierre).toBe('');
      expect(practicas.obtenerDetalle).not.toHaveBeenCalled();
    });

    it('cambiar de práctica borra el mensaje de cierre anterior', async () => {
      await crear();
      practicas.obtenerDetalle.and.returnValue(of(detalleCon(15, 'FINALIZADA', fechaLocal(-1), true)));
      practicas.cerrarPractica.and.returnValue(of(cierreOk()));
      consultarYFinalizar();
      expect(componente.mensajeCierre).not.toBe('');
      practicas.obtenerDetalle.and.callFake(id => of(detalleCon(Number(id))));
      parametros.next(convertToParamMap({ id: '16' }));
      fixture.detectChanges();
      expect(componente.mensajeCierre).toBe('');
      expect(raiz().querySelector('.mensaje-cierre')).toBeNull();
    });
  });

  describe('funcionalidades conservadas', () => {
    it('EN_CURSO candidata conserva seguimiento, incidencia, docente, informe y pestañas', async () => {
      await crear();
      expect(boton('Registrar seguimiento')).toBeDefined();
      expect(boton('Nueva incidencia')).toBeDefined();
      expect(raiz().querySelector('app-docente-asignacion')).not.toBeNull();
      expect(raiz().querySelector('app-informe-final')).not.toBeNull();
      expect(raiz().querySelector('[role="tablist"]')).not.toBeNull();
      expect(practicas.obtenerSeguimientos).toHaveBeenCalled();
      expect(practicas.obtenerHistorial).toHaveBeenCalled();
    });

    it('APROBADA conserva Iniciar práctica y no muestra el cierre', async () => {
      practicas.obtenerDetalle.and.returnValue(of(detalleCon(15, 'APROBADA', null)));
      await crear();
      expect(boton('Iniciar práctica')).toBeDefined();
      expect(raiz().querySelector('app-cierre-practica')).toBeNull();
    });

    it('no ofrece cambio genérico de estado ni decisiones de revisión', async () => {
      await crear();
      for (const etiqueta of ['Actualizar estado', 'Revisar y actualizar estado', 'Cambiar estado', 'Guardar cambio',
        'Aprobar', 'Observar', 'Rechazar']) {
        expect(boton(etiqueta)).withContext(etiqueta).toBeUndefined();
      }
      expect(raiz().querySelector('ion-select, ion-modal')).toBeNull();
      expect(texto()).not.toContain('Nuevo estado');
    });
  });
});
