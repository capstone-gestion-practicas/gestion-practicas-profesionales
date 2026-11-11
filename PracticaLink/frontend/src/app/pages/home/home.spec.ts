import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router } from '@angular/router';
import { ModalController, NavController } from '@ionic/angular';
import { HttpErrorResponse } from '@angular/common/http';
import { Subject, of, throwError } from 'rxjs';

import { ContextoUsuarioResponse } from '../../core/models/auth.models';
import { EstadoPracticaDetalle } from '../../core/models/practica.models';
import { UsuarioAdministrable } from '../../core/models/usuario.models';
import { AuthService } from '../../core/services/auth.service';
import { NotificacionService } from '../../features/notificaciones/services/notificacion.service';
import { PracticaService } from '../../core/services/practica.service';
import { RevisionService } from '../../core/services/revision.service';
import { UsuarioService } from '../../core/services/usuario.service';
import { AuthStore } from '../../core/store/auth.store';
import { Home } from './home';

/** Router simulado con eventos de navegación y URL inicial, para que la cabecera pueda marcar la sección activa. */
function routerSimulado(): Router {
  return Object.assign(jasmine.createSpyObj<Router>('Router', ['navigate']), {
    events: new Subject<Event>(),
    url: '/home'
  });
}

describe('Home (administración y enrutamiento de espacios)', () => {
  let component: Home;
  let fixture: ComponentFixture<Home>;
  let authStore: AuthStore;
  let router: Router;
  let navController: jasmine.SpyObj<NavController>;

  const contextoCon = (roles: string[]): ContextoUsuarioResponse => ({
    usuario: { id_usuario: 1, nombre: 'Usuario', apellido: 'Demo', correo: 'demo@practicalink.cl' },
    roles,
    perfil: null,
    practica_actual: null
  });

  function crear(roles: string[]): void {
    fixture?.destroy();
    authStore.setContexto(contextoCon(roles));
    fixture = TestBed.createComponent(Home);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  const texto = (): string => fixture.nativeElement.textContent as string;

  beforeEach(async () => {
    const authService = jasmine.createSpyObj<AuthService>('AuthService', ['obtenerContexto']);
    authService.obtenerContexto.and.returnValue(of(contextoCon(['GESTOR'])));
    const practicaService = jasmine.createSpyObj<PracticaService>('PracticaService', [
      'listarEstados',
      'listarPracticasParaGestion',
      'listarEstudiantesSinPractica',
      'listarIncidencias',
      'enviarRecordatorioEstudiante'
    ]);
    practicaService.listarEstados.and.returnValue(of([]));
    practicaService.listarPracticasParaGestion.and.returnValue(of([]));
    practicaService.listarEstudiantesSinPractica.and.returnValue(of([]));
    practicaService.listarIncidencias.and.returnValue(of([]));
    const usuarioService = jasmine.createSpyObj<UsuarioService>('UsuarioService', ['listar']);
    usuarioService.listar.and.returnValue(of([]));
    const revisionService = jasmine.createSpyObj<RevisionService>('RevisionService', ['listar']);
    revisionService.listar.and.returnValue(of([]));

    await TestBed.configureTestingModule({
      imports: [Home],
      providers: [
        AuthStore,
        { provide: AuthService, useValue: authService },
        { provide: PracticaService, useValue: practicaService },
        { provide: NotificacionService, useValue: { noLeidas: signal(0) } },
        { provide: UsuarioService, useValue: usuarioService },
        { provide: RevisionService, useValue: revisionService },
        { provide: Router, useValue: routerSimulado() },
        { provide: NavController, useValue: jasmine.createSpyObj<NavController>('NavController', ['navigateRoot']) },
        { provide: ModalController, useValue: jasmine.createSpyObj<ModalController>('ModalController', ['create']) }
      ]
    }).compileComponents();

    authStore = TestBed.inject(AuthStore);
    router = TestBed.inject(Router);
    navController = TestBed.inject(NavController) as jasmine.SpyObj<NavController>;
    sessionStorage.setItem('access_token', 'test-token');
  });

  afterEach(() => sessionStorage.clear());

  describe('gestor sin administración', () => {
    beforeEach(() => crear(['GESTOR']));

    it('delega el espacio de gestión en GestorHome con su propia cabecera', () => {
      expect(fixture.nativeElement.querySelector('app-gestor-home')).not.toBeNull();
      expect(fixture.nativeElement.querySelector('.brand-header')).toBeNull();
    });

    it('no muestra el dashboard administrativo ni el cierre de sesión duplicado', () => {
      expect(texto()).not.toContain('Dashboard');
      expect(fixture.nativeElement.querySelector('.secondary-action')).toBeNull();
    });

    it('marca el espacio como dedicado al gestor', () => {
      expect(component.espacioGestorDedicado()).toBeTrue();
    });
  });

  describe('administrador', () => {
    beforeEach(() => crear(['ADMINISTRADOR']));

    it('muestra el dashboard administrativo y el encabezado compartido', () => {
      expect(texto()).toContain('Dashboard');
      expect(fixture.nativeElement.querySelector('.brand-header')).not.toBeNull();
      expect(fixture.nativeElement.querySelector('app-gestor-home')).toBeNull();
      expect(texto()).not.toContain('Tu espacio de práctica');
    });

    it('cierra sesión desde el cierre global', () => {
      sessionStorage.setItem('access_token', 'test-token');
      fixture.nativeElement.querySelector('.secondary-action ion-button')?.click();
      expect(sessionStorage.getItem('access_token')).toBeNull();
      expect(navController.navigateRoot).toHaveBeenCalledWith(['/login']);
    });
  });

  describe('usuarios con doble rol de administración', () => {
    it('ESTUDIANTE + ADMINISTRADOR: el selector abre el espacio V3 del estudiante', () => {
      crear(['ESTUDIANTE', 'ADMINISTRADOR']);
      expect(texto()).toContain('Dashboard');
      const selector = fixture.nativeElement.querySelector('.workspace-switch') as HTMLButtonElement;
      selector.click();
      expect(router.navigate).toHaveBeenCalledWith(['/estudiante/inicio']);
    });
  });

  describe('regresiones de navegación, permisos y métricas del administrador', () => {
    let usuarioService: jasmine.SpyObj<UsuarioService>;
    let revisionService: jasmine.SpyObj<RevisionService>;
    let practicaService: jasmine.SpyObj<PracticaService>;

    const estadoDemo = (id_estado: number, nombre: string): EstadoPracticaDetalle => ({
      id_estado, nombre, descripcion: null, es_final: false, orden: id_estado
    } as unknown as EstadoPracticaDetalle);
    const usuarioDemo = (activo: boolean, roles: string[]): UsuarioAdministrable => ({
      id_usuario: 9, nombre: 'Ana', apellido: 'Prueba', correo: 'ana@practicalink.cl', activo, roles
    });
    const botonesBarra = (): string[] =>
      Array.from(fixture.nativeElement.querySelectorAll('.quick-nav button') as NodeListOf<HTMLButtonElement>)
        .map(boton => boton.textContent?.trim() ?? '');
    const textoMetricaUsuarios = (): string =>
      (fixture.nativeElement.querySelector('.admin-metrics strong') as HTMLElement).textContent?.trim() ?? '';
    const tarjetaSolicitudes = (): HTMLElement | null =>
      fixture.nativeElement.querySelector('.metric-card.emphasis strong');

    beforeEach(() => {
      usuarioService = TestBed.inject(UsuarioService) as jasmine.SpyObj<UsuarioService>;
      revisionService = TestBed.inject(RevisionService) as jasmine.SpyObj<RevisionService>;
      practicaService = TestBed.inject(PracticaService) as jasmine.SpyObj<PracticaService>;
      usuarioService.listar.and.returnValue(of([usuarioDemo(true, ['ADMINISTRADOR'])]));
      revisionService.listar.and.returnValue(of([]));
      practicaService.listarEstados.and.returnValue(of([estadoDemo(1, 'REGISTRADA')]));
    });

    it('ADMINISTRADOR sin GESTOR ve Usuarios, sin Solicitudes, y no consulta /revisiones', () => {
      crear(['ADMINISTRADOR']);
      expect(botonesBarra()).toEqual(['Usuarios', 'Estados', 'Seguimientos', 'Incidencias', 'Enviar avisos']);
      expect(revisionService.listar).not.toHaveBeenCalled();
      expect(texto()).not.toContain('Solicitudes pendientes');
    });

    it('el botón Usuarios navega a /usuarios', () => {
      crear(['ADMINISTRADOR']);
      const usuarios = Array.from(fixture.nativeElement.querySelectorAll('.quick-nav button') as NodeListOf<HTMLButtonElement>)
        .find(boton => boton.textContent?.trim() === 'Usuarios');
      usuarios?.click();
      expect(router.navigate).toHaveBeenCalledWith(['/usuarios']);
    });

    it('ADMINISTRADOR + GESTOR conserva Usuarios y Solicitudes y consulta solicitudes', () => {
      crear(['ADMINISTRADOR', 'GESTOR']);
      expect(botonesBarra()).toContain('Usuarios');
      expect(botonesBarra()).toContain('Solicitudes');
      expect(revisionService.listar).toHaveBeenCalledTimes(1);
      expect(tarjetaSolicitudes()?.textContent?.trim()).toBe('0');
    });

    it('GESTOR sin administración no carga la lista de usuarios', () => {
      crear(['GESTOR']);
      expect(usuarioService.listar).not.toHaveBeenCalled();
    });

    it('muestra «No disponible» en vez de cero cuando falla la lista de usuarios', () => {
      usuarioService.listar.and.returnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
      crear(['ADMINISTRADOR']);
      expect(textoMetricaUsuarios()).toBe('No disponible');
      expect(texto()).not.toContain('No fue posible cargar todas las métricas');
    });

    it('un fallo de usuarios no invalida las prácticas por estado', () => {
      usuarioService.listar.and.returnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
      crear(['ADMINISTRADOR']);
      const tarjetasEstado = fixture.nativeElement.querySelectorAll('.state-metrics-section .metric-card');
      expect(tarjetasEstado.length).toBe(1);
      expect(texto()).toContain('REGISTRADA');
    });

    it('un fallo de estados muestra «No disponible» y conserva la métrica de usuarios', () => {
      practicaService.listarEstados.and.returnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
      crear(['ADMINISTRADOR']);
      expect(texto()).toContain('No disponible: no fue posible cargar las prácticas por estado.');
      expect(fixture.nativeElement.querySelectorAll('.state-metrics-section .metric-card').length).toBe(0);
      expect(textoMetricaUsuarios()).toBe('1');
    });

    it('un fallo de solicitudes de GESTOR muestra «No disponible» sin afectar a usuarios', () => {
      revisionService.listar.and.returnValue(throwError(() => new HttpErrorResponse({ status: 403 })));
      crear(['ADMINISTRADOR', 'GESTOR']);
      expect(tarjetaSolicitudes()?.textContent?.trim()).toBe('No disponible');
      expect(textoMetricaUsuarios()).toBe('1');
    });
  });

  describe('estudiante exclusivo que llega a /home', () => {
    it('no muestra gestión ni la vista antigua de estudiante', () => {
      crear(['ESTUDIANTE']);
      expect(texto()).not.toContain('Revisar solicitudes');
      expect(texto()).not.toContain('Tu espacio de práctica');
      expect(fixture.nativeElement.querySelector('app-gestor-home')).toBeNull();
      expect(fixture.nativeElement.querySelector('.workspace-switch')).toBeNull();
    });
  });
});
