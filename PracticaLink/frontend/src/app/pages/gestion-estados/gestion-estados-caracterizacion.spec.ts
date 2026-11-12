import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of, throwError } from 'rxjs';

import { ContextoUsuarioResponse } from '../../core/models/auth.models';
import {
  ActualizarEstadoPracticaResponse,
  CerrarPracticaResponse,
  EstadoPracticaDetalle,
  IniciarPracticaResponse,
  PracticaEstadoResumen
} from '../../core/models/practica.models';
import { PracticaService } from '../../core/services/practica.service';
import { AuthStore } from '../../core/store/auth.store';
import { EstadoAcademico, EvaluacionService } from '../../features/evaluaciones/evaluacion.service';
import { GestionEstados } from './gestion-estados';

/**
 * Etapa 0 · caracterización. Documenta el comportamiento ACTUAL de GestionEstados antes de
 * reorganizar el espacio del gestor. No valida reglas de negocio deseadas: si una prueba
 * falla tras un cambio, el cambio de comportamiento debe ser explícito y aprobado.
 * El servidor (fn_actualizar_estado_practica, fn_cerrar_practica) es la autoridad final;
 * estos mocks no acreditan SQL, bloqueos ni atomicidad.
 * Seguridad de transiciones: la sección de cambio genérico incorpora el bloqueo
 * autorizado de decisiones de revisión; ya no caracteriza el bypass anterior.
 */
describe('GestionEstados · caracterización (etapa 0)', () => {
  let fixture: ComponentFixture<GestionEstados>;
  let component: GestionEstados;
  let practicaService: jasmine.SpyObj<PracticaService>;
  let academico: jasmine.SpyObj<EvaluacionService>;
  let authStore: AuthStore;

  const ID_USUARIO = 1;

  const contextoCon = (roles: string[]): ContextoUsuarioResponse => ({
    usuario: { id_usuario: ID_USUARIO, nombre: 'Gestor', apellido: 'Sintético', correo: 'gestor@example.test' },
    roles,
    perfil: null,
    practica_actual: null
  });

  const estados: EstadoPracticaDetalle[] = [
    { id_estado: 1, nombre: 'REGISTRADA', es_final: false },
    { id_estado: 2, nombre: 'EN_REVISION', es_final: false },
    { id_estado: 3, nombre: 'OBSERVADA', es_final: false },
    { id_estado: 4, nombre: 'APROBADA', es_final: false },
    { id_estado: 5, nombre: 'EN_CURSO', es_final: false },
    { id_estado: 6, nombre: 'FINALIZADA', es_final: true },
    { id_estado: 7, nombre: 'RECHAZADA', es_final: true }
  ];

  const hoyIso = (desplazamientoDias = 0): string => {
    const fecha = new Date();
    fecha.setDate(fecha.getDate() + desplazamientoDias);
    return [fecha.getFullYear(), fecha.getMonth() + 1, fecha.getDate()]
      .map((parte, indice) => indice === 0 ? String(parte) : String(parte).padStart(2, '0'))
      .join('-');
  };

  const practica = (cambios: Partial<PracticaEstadoResumen> = {}): PracticaEstadoResumen => ({
    id_practica: 7,
    fecha_registro: '2026-01-01T00:00:00Z',
    fecha_actualizacion: '2026-01-01T00:00:00Z',
    id_estado: 5,
    estado: 'EN_CURSO',
    descripcion_estado: null,
    es_final: false,
    estudiante: 'Estudiante sintético',
    rut_estudiante: '11111111-1',
    centro_practica: 'Centro sintético',
    fecha_inicio: '2026-01-02',
    fecha_termino: '2020-01-01',
    horas_semanales: 40,
    id_gestor: ID_USUARIO,
    gestor: null,
    ...cambios
  });

  const aprobado: EstadoAcademico = {
    id_practica: 7, id_documento: 9, version: 1, estado_informe: 'ENTREGADO', evaluacion_pendiente: null,
    resultado_vigente: {
      id_evaluacion: 'uuid-sintetico', id_practica: 7, id_documento: 9, version: 1, id_docente: 20,
      estado: 'RESUELTA', resultado: 'APROBADO', observaciones: null, motivo: null,
      inicio: '2026-11-09T12:00:00Z', termino: '2026-11-09T13:00:00Z'
    }
  };

  const botones = (etiqueta: string): HTMLElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll('ion-button') as NodeListOf<HTMLElement>)
      .filter(boton => boton.textContent?.replace(/\s+/g, ' ').trim() === etiqueta);

  function crear(roles: string[], practicas: PracticaEstadoResumen[]): void {
    practicaService.listarPracticasParaGestion.and.returnValue(of(practicas));
    authStore.setContexto(contextoCon(roles));
    fixture = TestBed.createComponent(GestionEstados);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(async () => {
    practicaService = jasmine.createSpyObj<PracticaService>('PracticaService', [
      'listarPracticasParaGestion', 'listarEstados', 'listarGestores', 'cerrarPractica',
      'iniciarPractica', 'actualizarEstado', 'obtenerHistorialEstados', 'asignarGestor'
    ]);
    practicaService.listarEstados.and.returnValue(of(estados));
    practicaService.listarGestores.and.returnValue(of([]));
    academico = jasmine.createSpyObj<EvaluacionService>('EvaluacionService', ['vigente']);

    await TestBed.configureTestingModule({
      imports: [GestionEstados],
      providers: [
        AuthStore,
        { provide: EvaluacionService, useValue: academico },
        { provide: PracticaService, useValue: practicaService },
        { provide: Router, useValue: jasmine.createSpyObj<Router>('Router', ['navigate']) },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) } } }
      ]
    }).compileComponents();
    authStore = TestBed.inject(AuthStore);
  });

  afterEach(() => fixture?.destroy());

  describe('cierre académico: candidatura del GESTOR responsable', () => {
    it('es candidata solo con GESTOR responsable, EN_CURSO y término cumplido (hoy incluido)', () => {
      crear(['GESTOR'], []);
      const casos: [string, Partial<PracticaEstadoResumen>, boolean][] = [
        ['término vencido', {}, true],
        ['término hoy', { fecha_termino: hoyIso() }, true],
        ['término mañana', { fecha_termino: hoyIso(1) }, false],
        ['sin fecha de término', { fecha_termino: null }, false],
        ['APROBADA', { estado: 'APROBADA', id_estado: 4 }, false],
        ['FINALIZADA', { estado: 'FINALIZADA', id_estado: 6, es_final: true }, false],
        ['sin gestor asignado', { id_gestor: null }, false],
        ['gestor ajeno', { id_gestor: ID_USUARIO + 1 }, false]
      ];
      for (const [caso, cambios, esperado] of casos) {
        expect(component.candidataCierre(practica(cambios))).withContext(caso).toBe(esperado);
      }
    });

    it('ESTUDIANTE o ADMINISTRADOR sin GESTOR nunca son candidatos aunque figuren como id_gestor', () => {
      for (const roles of [['ESTUDIANTE'], ['ADMINISTRADOR'], ['DOCENTE']]) {
        crear(roles, []);
        expect(component.candidataCierre(practica())).withContext(roles.join()).toBeFalse();
        fixture.destroy();
      }
    });

    it('muestra las acciones de cierre solo en la práctica candidata del listado', () => {
      crear(['GESTOR'], [
        practica(),
        practica({ id_practica: 8, fecha_termino: hoyIso(30) }),
        practica({ id_practica: 9, id_gestor: ID_USUARIO + 1 })
      ]);
      expect(botones('Consultar aprobación académica').length).toBe(1);
      expect(component.practicasVencidas().map(item => item.id_practica)).toEqual([7, 9]);
      expect(component.practicasEnSeguimiento().map(item => item.id_practica)).toEqual([8]);
    });

    it('un cierre exitoso usa el endpoint existente, informa el mensaje y recarga el listado', () => {
      const item = practica();
      crear(['GESTOR'], [item]);
      academico.vigente.and.returnValue(of(aprobado));
      component.consultarAprobacion(item);
      const respuesta = { id_practica: 7, mensaje: 'Práctica finalizada' } as CerrarPracticaResponse;
      practicaService.cerrarPractica.and.returnValue(of(respuesta));
      component.finalizarPractica(item);
      expect(practicaService.cerrarPractica).toHaveBeenCalledOnceWith(7, null);
      expect(component.mensaje).toBe('Práctica finalizada');
      expect(practicaService.listarPracticasParaGestion).toHaveBeenCalledTimes(2);
      expect(component.puedeFinalizar(item)).toBeFalse();
    });

    it('muestra el detalle del servidor cuando rechaza el cierre (p. ej. GESTOR_NO_RESPONSABLE)', () => {
      const item = practica();
      crear(['GESTOR'], [item]);
      academico.vigente.and.returnValue(of(aprobado));
      component.consultarAprobacion(item);
      practicaService.cerrarPractica.and.returnValue(throwError(() => new HttpErrorResponse({
        status: 403, error: { detail: 'No eres el gestor responsable de esta práctica.' }
      })));
      component.finalizarPractica(item);
      expect(component.error).toBe('No eres el gestor responsable de esta práctica.');
      expect(component.puedeFinalizar(item)).toBeFalse();
    });

    it('la verificación académica no se solicita para prácticas que no son candidatas', () => {
      crear(['GESTOR'], []);
      component.consultarAprobacion(practica({ fecha_termino: hoyIso(1) }));
      component.consultarAprobacion(practica({ id_gestor: null }));
      expect(academico.vigente).not.toHaveBeenCalled();
    });
  });

  describe('cambio genérico de estado: seguridad de transiciones', () => {
    const respuestaActualizar = (idEstado: number, estado: string): ActualizarEstadoPracticaResponse =>
      ({ id_practica: 7, id_estado: idEstado, estado, mensaje: `Estado ${estado}` });

    it('conserva el catálogo de consulta pero no ofrece decisiones de revisión ni cierre', () => {
      const item = practica({ estado: 'APROBADA', id_estado: 4, fecha_termino: null });
      crear(['GESTOR'], [item]);
      component.abrirCambio(item);
      expect(component.estados.map(estado => estado.nombre)).toEqual(estados.map(estado => estado.nombre));
      expect(component.estadosDisponibles().map(estado => estado.nombre))
        .toEqual(['REGISTRADA', 'EN_REVISION', 'EN_CURSO']);
      expect(component.idEstadoSeleccionado).toBeNull();
    });

    it('enruta EN_CURSO al inicio restringido (PATCH /estado) y no al cambio genérico', () => {
      const item = practica({ estado: 'APROBADA', id_estado: 4, fecha_termino: null });
      crear(['GESTOR'], [item]);
      practicaService.iniciarPractica.and.returnValue(of({
        id_practica: 7, mensaje: 'Iniciada' } as IniciarPracticaResponse));
      component.abrirCambio(item);
      component.idEstadoSeleccionado = 5;
      component.observacion = '  inicio  ';
      component.guardarCambio();
      expect(practicaService.iniciarPractica).toHaveBeenCalledOnceWith(7, 'inicio');
      expect(practicaService.actualizarEstado).not.toHaveBeenCalled();
    });

    it('envía únicamente destinos genéricos legítimos', () => {
      const item = practica({ estado: 'EN_CURSO', id_estado: 5, fecha_termino: null });
      crear(['GESTOR'], [item]);
      for (const destino of estados.filter(estado => ['REGISTRADA', 'EN_REVISION'].includes(estado.nombre))) {
        practicaService.actualizarEstado.calls.reset();
        practicaService.actualizarEstado.and.returnValue(of(respuestaActualizar(destino.id_estado, destino.nombre)));
        component.abrirCambio(item);
        component.idEstadoSeleccionado = destino.id_estado;
        component.observacion = '   ';
        component.guardarCambio();
        expect(practicaService.actualizarEstado)
          .withContext(destino.nombre)
          .toHaveBeenCalledOnceWith(7, destino.id_estado, null);
      }
      expect(practicaService.iniciarPractica).not.toHaveBeenCalled();
    });

    for (const roles of [['GESTOR'], ['ADMINISTRADOR'], ['GESTOR', 'ADMINISTRADOR']]) {
      it(`rechaza selección manipulada de revisión para ${roles.join('+')}`, () => {
        const item = practica();
        crear(roles, [item]);
        component.abrirCambio(item);
        expect(component.estadosDisponibles().map(estado => estado.nombre)).toEqual(['REGISTRADA', 'EN_REVISION']);
        for (const id of [3, 4, 7, 6, 5, 999]) {
          component.idEstadoSeleccionado = id;
          component.guardarCambio();
          expect(component.error).toContain('Selecciona un estado disponible');
        }
        expect(practicaService.actualizarEstado).not.toHaveBeenCalled();
        expect(practicaService.iniciarPractica).not.toHaveBeenCalled();
      });
    }

    it('ofrece «Actualizar estado» también en prácticas finales y muestra el rechazo del servidor', () => {
      const final = practica({ id_practica: 11, estado: 'RECHAZADA', id_estado: 7, es_final: true, fecha_termino: null });
      crear(['GESTOR'], [final]);
      expect(botones('Actualizar estado').length).toBe(1);
      practicaService.actualizarEstado.and.returnValue(throwError(() => new HttpErrorResponse({
        status: 409, error: { detail: 'La práctica no admite este cambio.' }
      })));
      component.abrirCambio(final);
      component.idEstadoSeleccionado = 1;
      component.guardarCambio();
      expect(practicaService.actualizarEstado).toHaveBeenCalledOnceWith(11, 1, null);
      expect(component.error).toBe('La práctica no admite este cambio.');
      expect(component.modalAbierto).toBeTrue();
      expect(component.guardando).toBeFalse();
    });

    it('sin detalle del servidor usa el mensaje genérico y no cierra el modal', () => {
      const item = practica({ fecha_termino: null });
      crear(['GESTOR'], [item]);
      practicaService.actualizarEstado.and.returnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
      component.abrirCambio(item);
      component.idEstadoSeleccionado = 2;
      component.guardarCambio();
      expect(component.error).toBe('No fue posible actualizar el estado.');
      expect(component.modalAbierto).toBeTrue();
    });

    it('tras un cambio exitoso cierra el modal, informa y recarga', () => {
      const item = practica({ fecha_termino: null });
      crear(['GESTOR'], [item]);
      practicaService.actualizarEstado.and.returnValue(of(respuestaActualizar(2, 'EN_REVISION')));
      component.abrirCambio(item);
      component.idEstadoSeleccionado = 2;
      component.guardarCambio();
      expect(component.modalAbierto).toBeFalse();
      expect(component.mensaje).toBe('Estado EN_REVISION');
      expect(practicaService.listarPracticasParaGestion).toHaveBeenCalledTimes(2);
    });
  });

  describe('cuenta con GESTOR y ADMINISTRADOR simultáneos', () => {
    it('se comporta como administrador para asignar gestores y como gestor responsable para cerrar', () => {
      crear(['GESTOR', 'ADMINISTRADOR'], [practica(), practica({ id_practica: 8, id_gestor: ID_USUARIO + 1 })]);
      expect(component.esAdministrador).toBeTrue();
      expect(practicaService.listarGestores).toHaveBeenCalledTimes(1);
      expect(component.candidataCierre(practica())).toBeTrue();
      expect(component.candidataCierre(practica({ id_practica: 8, id_gestor: ID_USUARIO + 1 }))).toBeFalse();
      expect(botones('Consultar aprobación académica').length).toBe(1);
      expect(fixture.nativeElement.querySelectorAll('ion-select').length).toBeGreaterThan(0);
    });

    it('ADMINISTRADOR sin GESTOR asigna gestores pero no ve acciones de cierre', () => {
      crear(['ADMINISTRADOR'], [practica()]);
      expect(component.esAdministrador).toBeTrue();
      expect(botones('Consultar aprobación académica').length).toBe(0);
    });

    it('GESTOR sin ADMINISTRADOR no carga gestores ni asigna', () => {
      const item = practica();
      crear(['GESTOR'], [item]);
      expect(component.esAdministrador).toBeFalse();
      expect(practicaService.listarGestores).not.toHaveBeenCalled();
      component.guardarAsignacion(item);
      expect(practicaService.asignarGestor).not.toHaveBeenCalled();
    });
  });
});
