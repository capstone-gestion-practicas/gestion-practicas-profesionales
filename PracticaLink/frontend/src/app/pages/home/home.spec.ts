import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router } from '@angular/router';
import { ModalController } from '@ionic/angular';
import { of } from 'rxjs';

import { ContextoUsuarioResponse } from '../../core/models/auth.models';
import { AuthService } from '../../core/services/auth.service';
import { EstudianteService } from '../../core/services/estudiante.service';
import { NotificacionService } from '../../features/notificaciones/services/notificacion.service';
import { PracticaService } from '../../core/services/practica.service';
import { RevisionService } from '../../core/services/revision.service';
import { UsuarioService } from '../../core/services/usuario.service';
import { AuthStore } from '../../core/store/auth.store';
import { MENSAJE_RUT_INVALIDO } from '../../core/utils/mensajes-rut';
import { Home } from './home';

describe('Home', () => {
  let component: Home;
  let fixture: ComponentFixture<Home>;
  let authStore: AuthStore;
  let estudianteService: jasmine.SpyObj<EstudianteService>;

  const contexto: ContextoUsuarioResponse = {
    usuario: {
      id_usuario: 1,
      nombre: 'Usuario',
      apellido: 'Demo',
      correo: 'demo@practicalink.cl'
    },
    roles: ['ESTUDIANTE'],
    perfil: null,
    practica_actual: null
  };

  beforeEach(async () => {
    const authService = jasmine.createSpyObj<AuthService>(
      'AuthService',
      ['obtenerContexto']
    );
    authService.obtenerContexto.and.returnValue(of(contexto));
    const practicaService = jasmine.createSpyObj<PracticaService>(
      'PracticaService',
      [
        'obtenerMiPractica',
        'obtenerHistorialEstados',
        'listarEstados',
        'listarPracticasParaGestion',
        'listarEstudiantesSinPractica',
        'enviarRecordatorioEstudiante'
      ]
    );
    practicaService.listarEstudiantesSinPractica.and.returnValue(of([]));
    const usuarioService = jasmine.createSpyObj<UsuarioService>('UsuarioService', ['listar']);
    usuarioService.listar.and.returnValue(of([]));
    const revisionService = jasmine.createSpyObj<RevisionService>('RevisionService', ['listar']);
    revisionService.listar.and.returnValue(of([]));
    estudianteService = jasmine.createSpyObj<EstudianteService>(
      'EstudianteService',
      ['completarPerfil']
    );

    await TestBed.configureTestingModule({
      imports: [Home],
      providers: [
        AuthStore,
        { provide: AuthService, useValue: authService },
        { provide: EstudianteService, useValue: estudianteService },
        {
          provide: PracticaService,
          useValue: practicaService
        },
        {
          provide: NotificacionService,
          useValue: { noLeidas: signal(0) }
        },
        {
          provide: UsuarioService,
          useValue: usuarioService
        },
        {
          provide: RevisionService,
          useValue: revisionService
        },
        {
          provide: Router,
          useValue: jasmine.createSpyObj<Router>('Router', ['navigate'])
        },
        {
          provide: ModalController,
          useValue: jasmine.createSpyObj<ModalController>(
            'ModalController',
            ['create']
          )
        }
      ]
    })
    .compileComponents();

    authStore = TestBed.inject(AuthStore);
    authStore.setContexto(contexto);
    sessionStorage.setItem('access_token', 'test-token');

    fixture = TestBed.createComponent(Home);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('greets the user with roles from the context', () => {
    expect(component.saludo()).toBe(
      'Hola, Usuario. Estás logueado como ESTUDIANTE.'
    );
  });

  it('shows the registration module to students', () => {
    expect(component.esEstudiante()).toBeTrue();
    expect(
      fixture.nativeElement.textContent
    ).toContain('Completa tu perfil');
  });

  it('requires a student profile before navigating to work offers', () => {
    component.explorarOfertas();

    expect(component.modalPerfilAbierto).toBeTrue();
    expect(TestBed.inject(Router).navigate).not.toHaveBeenCalledWith(['/ofertas']);
  });

  it('blocks saving a profile with an invalid RUT and shows the shared message', () => {
    component.rutPerfil = '12.3';
    component.carreraPerfil = 'Informática';
    component.sedePerfil = 'Santiago';

    component.validarRutPerfil();
    component.guardarPerfil();

    expect(component.rutPerfilValido).toBeFalse();
    expect(component.toastRutAbierto).toBeTrue();
    expect(component.mensajeToastRut).toBe(MENSAJE_RUT_INVALIDO);
    expect(component.errorPerfil).toBe(MENSAJE_RUT_INVALIDO);
    expect(estudianteService.completarPerfil).not.toHaveBeenCalled();
  });

  it('shows a dedicated workflow dashboard to gestores', () => {
    fixture.destroy();
    authStore.setContexto({ ...contexto, roles: ['GESTOR'] });
    fixture = TestBed.createComponent(Home);
    component = fixture.componentInstance;
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Espacio de gestión');
    expect(text).toContain('Revisar solicitudes');
    expect(text).not.toContain('Tu espacio de práctica');
  });

  it('lets users with both roles switch between their workspaces', () => {
    fixture.destroy();
    authStore.setContexto({ ...contexto, roles: ['ESTUDIANTE', 'GESTOR'] });
    fixture = TestBed.createComponent(Home);
    component = fixture.componentInstance;
    fixture.detectChanges();

    const switchButton = fixture.nativeElement.querySelector('.workspace-switch') as HTMLButtonElement;
    expect(fixture.nativeElement.textContent).toContain('Espacio de gestión');
    expect(switchButton.textContent).toContain('Mi práctica');

    switchButton.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Tu espacio de práctica');

    const returnButton = fixture.nativeElement.querySelector('.workspace-switch') as HTMLButtonElement;
    returnButton.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Espacio de gestión');
  });

  it('navigates gestores to the dedicated notification sender', () => {
    const router = TestBed.inject(Router);

    component.enviarNotificaciones();

    expect(router.navigate).toHaveBeenCalledWith(['/envio-notificaciones']);
  });
});
