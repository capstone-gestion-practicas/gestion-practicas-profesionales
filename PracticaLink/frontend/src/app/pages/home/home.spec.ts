import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router } from '@angular/router';
import { ModalController, NavController } from '@ionic/angular';
import { Subject, of } from 'rxjs';

import { ContextoUsuarioResponse } from '../../core/models/auth.models';
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
