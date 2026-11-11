import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { BehaviorSubject, of, throwError } from 'rxjs';

import { PracticaDetalleGestionResponse } from '../../core/models/practica.models';
import { PracticaService } from '../../core/services/practica.service';
import { SesionService } from '../../core/session/sesion.service';
import { AuthStore } from '../../core/store/auth.store';
import { DocenteService } from '../../features/docente/docente.service';
import { PracticaDetalle } from './practica-detalle';

/**
 * Etapa 0 · caracterización del acceso al detalle de gestión.
 * Backend (consultar_detalle_practica): un GESTOR sin ADMINISTRADOR solo recibe prácticas
 * asignadas; si la práctica existe pero es de otro gestor responde 403. Aquí se simula esa
 * respuesta y se documenta lo que la interfaz muestra y omite.
 */
describe('PracticaDetalle · acceso y roles (etapa 0)', () => {
  let fixture: ComponentFixture<PracticaDetalle>;
  let component: PracticaDetalle;
  let service: jasmine.SpyObj<PracticaService>;
  let docentes: jasmine.SpyObj<DocenteService>;
  let sesion: jasmine.SpyObj<SesionService>;
  let roles: string[];

  const detalle: PracticaDetalleGestionResponse = {
    id_practica: 15, estudiante: { id_estudiante: 7, nombre: 'Estudiante sintético' },
    centro_practica: { id_centro: 9, nombre: 'Centro sintético' },
    fecha_registro: '2026-10-17T12:30:00Z',
    estado: { id_estado: 4, nombre: 'APROBADA', es_final: false },
    fecha_ultimo_cambio_estado: null, fecha_inicio: null, fecha_termino: null,
    horas: null, cargo_funcion: null, descripcion: null
  };

  const denegado = () => throwError(() => new HttpErrorResponse({ status: 403 }));
  const texto = (): string => (fixture.nativeElement.textContent as string).replace(/\s+/g, ' ');
  const boton = (etiqueta: string): HTMLElement | undefined =>
    Array.from(fixture.nativeElement.querySelectorAll('ion-button') as NodeListOf<HTMLElement>)
      .find(item => item.textContent?.trim() === etiqueta);

  async function crear(rolesUsuario: string[]): Promise<void> {
    roles = rolesUsuario;
    await TestBed.configureTestingModule({ imports: [PracticaDetalle], providers: [
      { provide: PracticaService, useValue: service },
      { provide: DocenteService, useValue: docentes },
      { provide: SesionService, useValue: sesion },
      { provide: AuthStore, useValue: {
        contexto: () => ({ roles, usuario: { id_usuario: 1, nombre: 'Gestor', apellido: 'Sintético' } })
      } },
      { provide: ActivatedRoute, useValue: { paramMap: new BehaviorSubject(convertToParamMap({ id: '15' })) } },
      { provide: Router, useValue: jasmine.createSpyObj('Router', ['navigate']) }
    ] }).compileComponents();
    fixture = TestBed.createComponent(PracticaDetalle);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    sessionStorage.removeItem('practicalink-workspace');
    service = jasmine.createSpyObj<PracticaService>('PracticaService', [
      'obtenerDetalle', 'obtenerSeguimientos', 'obtenerHistorial', 'obtenerIncidencias'
    ]);
    service.obtenerDetalle.and.returnValue(of(detalle));
    service.obtenerSeguimientos.and.returnValue(of({ id_practica: 15, items: [], limit: 50, offset: 0, hay_mas: false }));
    service.obtenerHistorial.and.returnValue(of({ id_practica: 15, items: [], limit: 50, offset: 0, hay_mas: false }));
    service.obtenerIncidencias.and.returnValue(of({ id_practica: 15, items: [], limit: 50, offset: 0, hay_mas: false }));
    docentes = jasmine.createSpyObj<DocenteService>('DocenteService', ['consultarAsignacion']);
    docentes.consultarAsignacion.and.returnValue(of({ id_practica: 15, docente_actual: null, docentes_disponibles: [] }));
    sesion = jasmine.createSpyObj<SesionService>('SesionService', ['cerrar']);
  });

  afterEach(() => {
    fixture?.destroy();
    sessionStorage.removeItem('practicalink-workspace');
  });

  describe('GESTOR sobre una práctica no asignada (403)', () => {
    beforeEach(async () => {
      service.obtenerDetalle.and.returnValue(denegado());
      service.obtenerHistorial.and.returnValue(denegado());
      service.obtenerSeguimientos.and.returnValue(denegado());
      service.obtenerIncidencias.and.returnValue(denegado());
      await crear(['GESTOR']);
    });

    it('muestra acceso denegado, sin reintento ni datos de la práctica', () => {
      expect(component.detalle).toBeNull();
      expect(component.permiteReintentar).toBeFalse();
      expect(component.error).toBe('Acceso denegado. Revisa tu sesión y permisos.');
      expect(boton('Reintentar')).toBeUndefined();
      expect(texto()).not.toContain('Estudiante sintético');
    });

    it('no ofrece acciones de gestión ni monta docente o informe final', () => {
      for (const etiqueta of ['Iniciar práctica', 'Registrar seguimiento', 'Nueva incidencia']) {
        expect(boton(etiqueta)).withContext(etiqueta).toBeUndefined();
      }
      expect(fixture.nativeElement.querySelector('app-docente-asignacion')).toBeNull();
      expect(fixture.nativeElement.querySelector('app-informe-final')).toBeNull();
      expect(docentes.consultarAsignacion).not.toHaveBeenCalled();
    });

    it('consulta historial y seguimientos en paralelo y muestra un 403 independiente para cada uno', () => {
      expect(service.obtenerDetalle).toHaveBeenCalledOnceWith('15');
      expect(service.obtenerHistorial).toHaveBeenCalledTimes(1);
      expect(service.obtenerSeguimientos).toHaveBeenCalledTimes(1);
      expect(component.errorSeguimientos).toBe('Acceso denegado al historial de seguimientos.');
      expect(component.errorHistorial).toBe('Acceso denegado al historial. Revisa tu sesión y permisos.');
      // Las incidencias se piden solo al abrir su pestaña.
      expect(service.obtenerIncidencias).not.toHaveBeenCalled();
      component.seleccionarVista('incidencias');
      expect(component.errorIncidencias).toBe('Acceso denegado al historial de incidencias.');
    });

    it('conserva la sugerencia de registro y no cierra la sesión ante un 403', () => {
      expect(texto()).toContain('Los seguimientos se registran cuando la práctica está en curso.');
      expect(sesion.cerrar).not.toHaveBeenCalled();
    });
  });

  it('un 401 en seguimientos cierra la sesión; en el detalle solo informa', async () => {
    service.obtenerDetalle.and.returnValue(throwError(() => new HttpErrorResponse({ status: 401 })));
    service.obtenerSeguimientos.and.returnValue(throwError(() => new HttpErrorResponse({ status: 401 })));
    await crear(['GESTOR']);
    expect(component.error).toBe('Acceso denegado. Revisa tu sesión y permisos.');
    expect(sesion.cerrar).toHaveBeenCalledTimes(1);
  });

  describe('roles combinados', () => {
    it('GESTOR + ADMINISTRADOR sin espacio elegido: ve docente, informe e inicio', async () => {
      await crear(['GESTOR', 'ADMINISTRADOR']);
      expect(component.puedeAsignarDocente).toBeTrue();
      expect(component.puedeIniciar).toBeTrue();
      expect(fixture.nativeElement.querySelector('app-docente-asignacion')).not.toBeNull();
      expect(fixture.nativeElement.querySelector('app-informe-final')).not.toBeNull();
    });

    it('GESTOR + ADMINISTRADOR con espacio ADMINISTRADOR: oculta docente e informe, conserva inicio', async () => {
      sessionStorage.setItem('practicalink-workspace', 'ADMINISTRADOR');
      await crear(['GESTOR', 'ADMINISTRADOR']);
      expect(component.puedeAsignarDocente).toBeFalse();
      expect(component.puedeIniciar).toBeTrue();
      expect(fixture.nativeElement.querySelector('app-docente-asignacion')).toBeNull();
      expect(boton('Iniciar práctica')).toBeDefined();
    });

    it('GESTOR + ADMINISTRADOR con espacio GESTOR: igual que el gestor dedicado', async () => {
      sessionStorage.setItem('practicalink-workspace', 'GESTOR');
      await crear(['GESTOR', 'ADMINISTRADOR']);
      expect(component.puedeAsignarDocente).toBeTrue();
      expect(component.puedeConsultarIncidencias).toBeTrue();
    });

    it('ADMINISTRADOR sin GESTOR: inicia y consulta incidencias, sin docente ni informe', async () => {
      await crear(['ADMINISTRADOR']);
      expect(component.puedeAsignarDocente).toBeFalse();
      expect(component.puedeIniciar).toBeTrue();
      expect(component.puedeConsultarIncidencias).toBeTrue();
      expect(docentes.consultarAsignacion).not.toHaveBeenCalled();
    });
  });
});
