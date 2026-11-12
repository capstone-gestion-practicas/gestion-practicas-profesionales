import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { BehaviorSubject, of, throwError } from 'rxjs';

import { PracticaDetalleGestionResponse } from '../../core/models/practica.models';
import { CLAVE_ESPACIO_TRABAJO } from '../../core/navigation/espacio-gestor';
import { PracticaService } from '../../core/services/practica.service';
import { SesionService } from '../../core/session/sesion.service';
import { AuthStore } from '../../core/store/auth.store';
import { DocenteService } from '../../features/docente/docente.service';
import { EvaluacionService } from '../../features/evaluaciones/evaluacion.service';
import { PracticaDetalle } from './practica-detalle';

/** Fecha local del navegador desplazada en días (AAAA-MM-DD). */
function fechaLocal(desplazamientoDias: number): string {
  const fecha = new Date();
  fecha.setDate(fecha.getDate() + desplazamientoDias);
  return [fecha.getFullYear(), fecha.getMonth() + 1, fecha.getDate()]
    .map((parte, indice) => indice === 0 ? String(parte) : String(parte).padStart(2, '0')).join('-');
}

const detalleCon = (nombre: string, esFinal = false, fechaTermino: string | null = null): PracticaDetalleGestionResponse => ({
  id_practica: 15, estudiante: { id_estudiante: 7, nombre: 'Estudiante sintético' },
  centro_practica: { id_centro: 9, nombre: 'Centro sintético' },
  fecha_registro: '2026-01-10T12:00:00Z', estado: { id_estado: 5, nombre, es_final: esFinal },
  fecha_ultimo_cambio_estado: null, fecha_inicio: null, fecha_termino: fechaTermino,
  horas: null, cargo_funcion: null, descripcion: null
});

const historialVacio = { id_practica: 15, items: [], limit: 50, offset: 0, hay_mas: false };

/** Etapa 3e: la asignación DOCENTE solo aparece en APROBADA y EN_CURSO, con las reglas de rol previas. */
describe('PracticaDetalle · visibilidad de la asignación DOCENTE (etapa 3e)', () => {
  let fixture: ComponentFixture<PracticaDetalle>;
  let practicas: jasmine.SpyObj<PracticaService>;
  let docentes: jasmine.SpyObj<DocenteService>;
  let roles: string[];

  const raiz = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const asignacionVisible = (): boolean => raiz().querySelector('app-docente-asignacion') !== null;

  async function crear(detalle: PracticaDetalleGestionResponse | number, rolesUsuario: string[] = ['GESTOR'],
    espacio: string | null = null): Promise<void> {
    roles = rolesUsuario;
    if (espacio) sessionStorage.setItem(CLAVE_ESPACIO_TRABAJO, espacio);
    practicas.obtenerDetalle.and.returnValue(typeof detalle === 'number'
      ? throwError(() => new HttpErrorResponse({ status: detalle }))
      : of(detalle));
    await TestBed.configureTestingModule({ imports: [PracticaDetalle], providers: [
      { provide: PracticaService, useValue: practicas },
      { provide: DocenteService, useValue: docentes },
      { provide: EvaluacionService, useValue: jasmine.createSpyObj<EvaluacionService>('EvaluacionService', ['vigente', 'consultar']) },
      { provide: SesionService, useValue: jasmine.createSpyObj<SesionService>('SesionService', ['cerrar']) },
      { provide: AuthStore, useValue: {
        contexto: () => ({ roles, usuario: { id_usuario: 1, nombre: 'Gestor', apellido: 'Sintético' } })
      } },
      { provide: ActivatedRoute, useValue: { paramMap: new BehaviorSubject(convertToParamMap({ id: '15' })) } },
      { provide: Router, useValue: jasmine.createSpyObj<Router>('Router', ['navigate']) }
    ] }).compileComponents();
    fixture = TestBed.createComponent(PracticaDetalle);
    fixture.detectChanges();
  }

  beforeEach(() => {
    sessionStorage.removeItem(CLAVE_ESPACIO_TRABAJO);
    practicas = jasmine.createSpyObj<PracticaService>('PracticaService', [
      'obtenerDetalle', 'obtenerSeguimientos', 'obtenerHistorial', 'obtenerIncidencias'
    ]);
    practicas.obtenerSeguimientos.and.returnValue(of(historialVacio));
    practicas.obtenerHistorial.and.returnValue(of(historialVacio));
    practicas.obtenerIncidencias.and.returnValue(of(historialVacio));
    docentes = jasmine.createSpyObj<DocenteService>('DocenteService', ['consultarAsignacion', 'asignar']);
    docentes.consultarAsignacion.and.returnValue(of({ id_practica: 15, docente_actual: null, docentes_disponibles: [] }));
  });

  afterEach(() => {
    fixture?.destroy();
    sessionStorage.removeItem(CLAVE_ESPACIO_TRABAJO);
  });

  describe('por estado', () => {
    const casos: [string, boolean, boolean][] = [
      ['APROBADA', false, true],
      ['EN_CURSO', false, true],
      ['REGISTRADA', false, false],
      ['EN_REVISION', false, false],
      ['OBSERVADA', false, false],
      ['RECHAZADA', true, false],
      ['FINALIZADA', true, false]
    ];
    for (const [estado, esFinal, visible] of casos) {
      it(`${estado}: ${visible ? 'muestra' : 'no muestra ni consulta'} la asignación`, async () => {
        await crear(detalleCon(estado, esFinal));
        expect(asignacionVisible()).toBe(visible);
        expect(docentes.consultarAsignacion.calls.count()).toBe(visible ? 1 : 0);
      });
    }

    it('el informe final conserva su visibilidad previa fuera de APROBADA y EN_CURSO', async () => {
      await crear(detalleCon('FINALIZADA', true));
      expect(raiz().querySelector('app-informe-final')).not.toBeNull();
      expect(asignacionVisible()).toBeFalse();
    });
  });

  describe('por rol y espacio (sin cambios respecto de la regla previa)', () => {
    const casos: [string, string[], string | null, boolean][] = [
      ['GESTOR', ['GESTOR'], null, true],
      ['ESTUDIANTE + GESTOR', ['ESTUDIANTE', 'GESTOR'], null, true],
      ['GESTOR + ADMINISTRADOR sin espacio elegido', ['GESTOR', 'ADMINISTRADOR'], null, true],
      ['GESTOR + ADMINISTRADOR en espacio GESTOR', ['GESTOR', 'ADMINISTRADOR'], 'GESTOR', true],
      ['GESTOR + ADMINISTRADOR en espacio ADMINISTRADOR', ['GESTOR', 'ADMINISTRADOR'], 'ADMINISTRADOR', false],
      ['ADMINISTRADOR', ['ADMINISTRADOR'], null, false]
    ];
    for (const [caso, rolesCaso, espacio, visible] of casos) {
      it(`${caso}: ${visible ? 'muestra' : 'no muestra'} la asignación en EN_CURSO`, async () => {
        await crear(detalleCon('EN_CURSO'), rolesCaso, espacio);
        expect(asignacionVisible()).toBe(visible);
      });
    }
  });

  for (const status of [401, 403, 404]) {
    it(`detalle ${status}: no muestra ni consulta la asignación`, async () => {
      await crear(status);
      expect(asignacionVisible()).toBeFalse();
      expect(docentes.consultarAsignacion).not.toHaveBeenCalled();
    });
  }

  it('un error de carga de la asignación se ve dentro del detalle', async () => {
    docentes.consultarAsignacion.and.returnValue(throwError(() => new HttpErrorResponse({ status: 403 })));
    await crear(detalleCon('EN_CURSO'));
    expect(raiz().querySelector('app-docente-asignacion [role="alert"]')?.textContent?.trim())
      .toBe('Solo el GESTOR responsable puede gestionar esta asignación.');
  });

  it('convive con el cierre académico en EN_CURSO con término cumplido', async () => {
    await crear(detalleCon('EN_CURSO', false, fechaLocal(-1)));
    expect(asignacionVisible()).toBeTrue();
    expect(raiz().querySelector('app-cierre-practica')).not.toBeNull();
    expect(raiz().querySelector('app-informe-final')).not.toBeNull();
  });
});
