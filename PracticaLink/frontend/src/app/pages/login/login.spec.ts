import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { AuthStore } from '../../core/store/auth.store';
import { Login } from './login';

describe('Login', () => {
  let component: Login;
  let fixture: ComponentFixture<Login>;
  let authService: jasmine.SpyObj<AuthService>;

  beforeEach(async () => {
    authService = jasmine.createSpyObj<AuthService>('AuthService', ['login', 'registrar', 'obtenerContexto']);
    await TestBed.configureTestingModule({
      imports: [Login],
      providers: [
        AuthStore,
        { provide: AuthService, useValue: authService },
        { provide: Router, useValue: jasmine.createSpyObj<Router>('Router', ['navigate']) }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(Login);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => expect(component).toBeTruthy());

  it('does not register when passwords differ', () => {
    component.password = '123456.abc';
    component.confirmarPassword = 'otra-clave';
    component.registrarse();
    expect(component.error).toBe('Las contraseñas no coinciden.');
    expect(authService.registrar).not.toHaveBeenCalled();
  });

  it('registers an account without profile data', () => {
    authService.registrar.and.returnValue(of({
      id_usuario: 10, nombre: 'Ana', apellido: 'Pérez',
      correo: 'ana@practicalink.cl', rol: 'ESTUDIANTE'
    }));
    component.modoRegistro = true;
    component.nombre = 'Ana';
    component.apellido = 'Pérez';
    component.correo = 'ana@practicalink.cl';
    component.password = '123456.abc';
    component.confirmarPassword = '123456.abc';
    component.registrarse();
    expect(authService.registrar).toHaveBeenCalledWith({
      nombre: 'Ana', apellido: 'Pérez', correo: 'ana@practicalink.cl', password: '123456.abc'
    });
    expect(component.modoRegistro).toBeFalse();
  });
});
