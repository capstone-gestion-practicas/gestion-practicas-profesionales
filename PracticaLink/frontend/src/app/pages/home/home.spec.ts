import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';

import { ContextoUsuarioResponse } from '../../core/models/auth.models';
import { AuthService } from '../../core/services/auth.service';
import { EstudianteService } from '../../core/services/estudiante.service';
import { AuthStore } from '../../core/store/auth.store';
import { Home } from './home';

describe('Home', () => {
  let component: Home;
  let fixture: ComponentFixture<Home>;
  let authStore: AuthStore;

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

    await TestBed.configureTestingModule({
      imports: [Home],
      providers: [
        AuthStore,
        { provide: AuthService, useValue: authService },
        {
          provide: EstudianteService,
          useValue: jasmine.createSpyObj<EstudianteService>(
            'EstudianteService',
            ['completarPerfil']
          )
        },
        {
          provide: Router,
          useValue: jasmine.createSpyObj<Router>('Router', ['navigate'])
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
    ).toContain('Registro de práctica profesional');
  });
});
