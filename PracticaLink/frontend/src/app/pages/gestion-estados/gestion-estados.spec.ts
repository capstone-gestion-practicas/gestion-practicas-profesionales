import { EstadoAcademico, Evaluacion, EvaluacionService } from '../../features/evaluaciones/evaluacion.service';
import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';

import { ContextoUsuarioResponse } from '../../core/models/auth.models';
import { PracticaEstadoResumen } from '../../core/models/practica.models';
import { PracticaService } from '../../core/services/practica.service';
import { AuthStore } from '../../core/store/auth.store';
import { GestionEstados } from './gestion-estados';
import { codigosInternosVisibles } from '../../shared/testing/codigos-internos';

describe('GestionEstados (mensajes de lista y navegación de gestor)', () => {
  let fixture: ComponentFixture<GestionEstados>;
  let component: GestionEstados;
  let practicaService: jasmine.SpyObj<PracticaService>;
  let authStore: AuthStore;
  let academico: jasmine.SpyObj<EvaluacionService>;

  const contextoCon = (roles: string[]): ContextoUsuarioResponse => ({
    usuario: { id_usuario: 1, nombre: 'Gestor', apellido: 'Demo', correo: 'gestor@practicalink.cl' },
    roles,
    perfil: null,
    practica_actual: null
  });

  const practica = (): PracticaEstadoResumen => ({
    id_practica: 7,
    id_estado: 2,
    estado: 'EN_CURSO',
    fecha_termino: null,
    es_final: false,
    estudiante: 'Ana Soto',
    rut_estudiante: '12.345.678-5',
    centro_practica: 'Centro demostrativo',
    id_gestor: null
  } as unknown as PracticaEstadoResumen);

  const texto = (): string => (fixture.nativeElement.textContent as string).replace(/\s+/g, ' ');

  function crear(roles: string[], practicas: PracticaEstadoResumen[] | 'error'): void {
    if (practicas === 'error') {
      practicaService.listarPracticasParaGestion.and.returnValue(
        throwError(() => new HttpErrorResponse({ status: 500 }))
      );
    } else {
      practicaService.listarPracticasParaGestion.and.returnValue(of(practicas));
    }
    authStore.setContexto(contextoCon(roles));
    fixture = TestBed.createComponent(GestionEstados);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(async () => {
    practicaService = jasmine.createSpyObj<PracticaService>('PracticaService', [
      'listarPracticasParaGestion',
      'listarEstados',
      'listarGestores',
      'cerrarPractica'
    ]);
    academico = jasmine.createSpyObj<EvaluacionService>('EvaluacionService', ['vigente']);
    practicaService.listarEstados.and.returnValue(of([]));
    practicaService.listarGestores.and.returnValue(of([]));

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

  it('distingue un gestor sin prácticas asignadas de un filtro sin coincidencias', () => {
    crear(['GESTOR'], []);
    expect(texto()).toContain('Aún no tienes prácticas asignadas');
    expect(texto()).not.toContain('coincidan');
  });

  it('muestra el vacío por filtro cuando hay prácticas pero ninguna coincide', () => {
    crear(['GESTOR'], [practica()]);
    component.busqueda = 'texto-inexistente';
    fixture.detectChanges();
    expect(texto()).toContain('No hay prácticas que coincidan con la búsqueda o el filtro aplicado.');
    expect(texto()).not.toContain('Aún no tienes prácticas asignadas');
  });

  it('muestra error de carga y no un listado vacío', () => {
    crear(['GESTOR'], 'error');
    expect(texto()).toContain('No fue posible cargar las prácticas y los estados disponibles.');
    expect(texto()).not.toContain('Aún no tienes prácticas asignadas');
    expect(texto()).not.toContain('coincidan');
  });

  it('el administrador recibe el mensaje de ausencia total de prácticas', () => {
    crear(['ADMINISTRADOR'], []);
    expect(texto()).toContain('No hay prácticas registradas.');
  });

  it('el gestor dedicado no muestra el botón Volver, que sustituye la cabecera', () => {
    crear(['GESTOR'], [practica()]);
    expect(texto()).not.toContain('Volver');
  });

  it('el gestor abre el detalle de la práctica, donde asigna docente', () => {
    crear(['GESTOR'], [practica()]);
    const router = TestBed.inject(Router);
    const boton = Array.from(fixture.nativeElement.querySelectorAll('ion-button') as NodeListOf<HTMLElement>)
      .find(el => el.textContent?.trim() === 'Ver detalle');
    expect(boton).toBeDefined();
    boton?.click();
    expect(router.navigate).toHaveBeenCalledWith(['/practicas', 7]);
  });

  it('el administrador conserva el botón Volver', () => {
    crear(['ADMINISTRADOR'], [practica()]);
    expect(texto()).toContain('Volver');
  });

  it('no muestra códigos internos y usa la etiqueta del ciclo de las prácticas', () => {
    crear(['GESTOR'], [practica()]);
    expect(codigosInternosVisibles(fixture.nativeElement)).toEqual([]);
    expect(fixture.nativeElement.querySelector('.module-label')?.textContent?.trim()).toBe('CICLO DE LAS PRÁCTICAS');
  });
  const evaluacion: Evaluacion = { id_evaluacion: 'uuid', id_practica: 7, id_documento: 9, version: 1,
    id_docente: 20, estado: 'RESUELTA', resultado: 'APROBADO', observaciones: null, motivo: null,
    inicio: '2026-11-09T12:00:00Z', termino: '2026-11-09T13:00:00Z' };
  const aprobado: EstadoAcademico = { id_practica: 7, id_documento: 9, version: 1,
    estado_informe: 'ENTREGADO', evaluacion_pendiente: null, resultado_vigente: evaluacion };
  const candidata = (): PracticaEstadoResumen => ({ ...practica(), id_gestor: 1, fecha_termino: '2020-01-01' });

  it('mantiene cierre deshabilitado hasta verificar aprobación vigente', () => {
    const item = candidata(); crear(['GESTOR'], [item]); fixture.detectChanges();
    expect(component.puedeFinalizar(item)).toBeFalse();
    component.finalizarPractica(item); expect(practicaService.cerrarPractica).not.toHaveBeenCalled();
    academico.vigente.and.returnValue(of(aprobado)); component.consultarAprobacion(item); fixture.detectChanges();
    expect(academico.vigente).toHaveBeenCalledOnceWith(7); expect(component.puedeFinalizar(item)).toBeTrue();
    expect(texto()).toContain('Aprobación académica vigente de la versión 1');
  });
  it('no habilita cierre con aprobación de otro documento o versión', () => {
    const item = candidata(); crear(['GESTOR'], [item]);
    academico.vigente.and.returnValue(of({ ...aprobado, version: 2 })); component.consultarAprobacion(item);
    expect(component.puedeFinalizar(item)).toBeFalse();
    academico.vigente.and.returnValue(of({ ...aprobado, id_documento: 10 })); component.consultarAprobacion(item);
    component.finalizarPractica(item); expect(practicaService.cerrarPractica).not.toHaveBeenCalled();
  });
  it('ADMINISTRADOR solo y GESTOR ajeno no adquieren permisos de cierre', () => {
    const item = candidata(); crear(['ADMINISTRADOR'], [item]); component.consultarAprobacion(item);
    component.finalizarPractica(item); expect(academico.vigente).not.toHaveBeenCalled();
    authStore.setContexto(contextoCon(['GESTOR']));
    component.consultarAprobacion({ ...item, id_gestor: 2 }); component.finalizarPractica({ ...item, id_gestor: 2 });
    expect(practicaService.cerrarPractica).not.toHaveBeenCalled();
  });
  it('cuenta multirrol conserva permiso académico como GESTOR responsable', () => {
    const item = candidata(); crear(['ADMINISTRADOR', 'GESTOR'], [item]);
    academico.vigente.and.returnValue(of(aprobado)); component.consultarAprobacion(item);
    expect(component.puedeFinalizar(item)).toBeTrue();
  });
  it('cierre usa el endpoint existente, evita doble envío e invalida aprobación ante conflicto', () => {
    const item = candidata(); crear(['GESTOR'], [item]);
    academico.vigente.and.returnValue(of(aprobado)); component.consultarAprobacion(item);
    const cierre = new Subject<import('../../core/models/practica.models').CerrarPracticaResponse>();
    practicaService.cerrarPractica.and.returnValue(cierre); component.finalizarPractica(item); component.finalizarPractica(item);
    expect(practicaService.cerrarPractica).toHaveBeenCalledOnceWith(7, null);
    cierre.error(new HttpErrorResponse({ status: 409 })); expect(component.puedeFinalizar(item)).toBeFalse();
    expect(component.guardandoCierreId).toBeNull();
  });
  it('consulta fallida y recarga del listado invalidan cualquier autorización visual anterior', () => {
    const item = candidata(); crear(['GESTOR'], [item]);
    academico.vigente.and.returnValue(of(aprobado)); component.consultarAprobacion(item);
    component.cargar(); expect(component.puedeFinalizar(item)).toBeFalse();
    academico.vigente.and.returnValue(throwError(() => new HttpErrorResponse({ status: 403 })));
    component.consultarAprobacion(item); expect(component.puedeFinalizar(item)).toBeFalse();
    expect(component.erroresAcademicos.get(7)).toContain('Sin acceso');
  });

});
