import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { By } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { ContextoUsuarioResponse, LoginResponse, RegistroResponse } from '../../core/models/auth.models';
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

  it('dismisses the release notes before navigating home', () => {
    component.novedadesAbiertas = true;
    spyOn(localStorage, 'setItem');

    component.continuarDespuesDeNovedades();

    expect(component.novedadesAbiertas).toBeFalse();
    expect(localStorage.setItem).toHaveBeenCalledWith(
      'practicalink-version-novedades',
      component.appVersion
    );
    expect(TestBed.inject(Router).navigate).toHaveBeenCalledWith(['/home']);
  });

  it('does not register when passwords differ', () => {
    component.correo = 'usuario@practicalink.cl';
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

  describe('rediseño: formulario y accesibilidad', () => {
    function rellenarLogin(correo: string, password: string): void {
      component.correo = correo;
      component.password = password;
      fixture.detectChanges();
    }

    it('L1: enviar usa el mismo payload normalizado de login', () => {
      authService.login.and.returnValue(of({ access_token: 'token-sintetico' } as LoginResponse));
      authService.obtenerContexto.and.returnValue(of({} as ContextoUsuarioResponse));
      rellenarLogin(' Usuario@PracticaLink.cl ', '123456.abc');
      component.enviar();
      expect(authService.login).toHaveBeenCalledOnceWith({
        correo: 'usuario@practicalink.cl', password: '123456.abc'
      });
    });

    it('L2: el formulario se envía por ngSubmit una sola vez', () => {
      spyOn(component, 'enviar');
      const form = fixture.debugElement.query(By.css('form'));
      form.triggerEventHandler('ngSubmit', null);
      expect(component.enviar).toHaveBeenCalledTimes(1);
    });

    it('L3: durante la autenticación el botón mantiene texto accesible, deshabilitado y aria-busy', () => {
      component.correo = 'usuario@practicalink.cl';
      component.password = '123456.abc';
      component.cargando = true;
      fixture.detectChanges();
      const boton = fixture.debugElement.query(By.css('.login-submit')).nativeElement as HTMLElement & { disabled: boolean };
      expect(boton.textContent).toContain('Iniciando sesión…');
      expect(boton.disabled).toBeTrue();
      expect(fixture.debugElement.query(By.css('form')).nativeElement.getAttribute('aria-busy')).toBe('true');
    });

    it('L4: un error de autenticación se anuncia con role="alert"', () => {
      authService.login.and.returnValue(throwError(() => new HttpErrorResponse({ status: 401 })));
      rellenarLogin('usuario@practicalink.cl', 'incorrecta');
      component.enviar();
      fixture.detectChanges();
      const alerta = fixture.debugElement.query(By.css('[role="alert"]'));
      expect(alerta.nativeElement.textContent).toContain('Correo o contraseña incorrectos.');
    });

    it('L5: el éxito de registro se anuncia con role="status"', () => {
      authService.registrar.and.returnValue(of({ id_usuario: 10 } as RegistroResponse));
      component.modoRegistro = true;
      component.nombre = 'Ana';
      component.apellido = 'Pérez';
      component.correo = 'ana@practicalink.cl';
      component.password = '123456.abc';
      component.confirmarPassword = '123456.abc';
      component.enviar();
      fixture.detectChanges();
      const estado = fixture.debugElement.query(By.css('[role="status"]'));
      expect(estado.nativeElement.textContent).toContain('Cuenta creada. Ya puedes iniciar sesión.');
    });

    it('L6: mostrar/ocultar cambia solo la presentación del campo, no su valor', () => {
      rellenarLogin('usuario@practicalink.cl', 'secreto-sintetico');
      const campo = fixture.debugElement.query(By.css('.login-password')).nativeElement as HTMLElement & { type: string };
      expect(campo.type).toBe('password');
      component.alternarMostrarPassword();
      fixture.detectChanges();
      expect(campo.type).toBe('text');
      expect(component.password).toBe('secreto-sintetico');
    });

    it('L7: el control de mostrar contraseña tiene nombre accesible dinámico', () => {
      rellenarLogin('usuario@practicalink.cl', '123456.abc');
      const boton = fixture.debugElement.query(By.css('.login-toggle-password')).nativeElement as HTMLElement;
      expect(boton.getAttribute('aria-label')).toBe('Mostrar contraseña');
      component.alternarMostrarPassword();
      fixture.detectChanges();
      expect(boton.getAttribute('aria-label')).toBe('Ocultar contraseña');
    });

    it('L8: el registro conserva exactamente el mismo contrato enviado al backend', () => {
      authService.registrar.and.returnValue(of({ id_usuario: 11 } as RegistroResponse));
      component.modoRegistro = true;
      component.nombre = 'Luis';
      component.apellido = 'Soto';
      component.correo = ' Luis@PracticaLink.cl ';
      component.password = 'clave-sintetica';
      component.confirmarPassword = 'clave-sintetica';
      component.enviar();
      expect(authService.registrar).toHaveBeenCalledOnceWith({
        nombre: 'Luis', apellido: 'Soto', correo: 'luis@practicalink.cl', password: 'clave-sintetica'
      });
    });

    it('muestra el error de correo solo tras salir del campo y lo asocia al input', () => {
      component.correo = 'no-es-correo';
      component.correoTocado = true;
      fixture.detectChanges();
      const mensaje = fixture.debugElement.query(By.css('#login-correo-error'));
      expect(mensaje.nativeElement.textContent).toContain('Ingresa un correo válido');
    });
  });

  describe('credenciales en memoria', () => {
    const contexto: ContextoUsuarioResponse = {
      usuario: { id_usuario: 1, nombre: 'Ana', apellido: 'Pérez', correo: 'ana@example.test' },
      roles: ['ESTUDIANTE'],
      perfil: null,
      practica_actual: null
    };

    afterEach(() => sessionStorage.clear());

    it('limpia contraseña y confirmación tras un inicio de sesión exitoso', () => {
      authService.login.and.returnValue(of({ access_token: 'sintetico' } as LoginResponse));
      authService.obtenerContexto.and.returnValue(of(contexto));
      component.correo = 'ana@example.test';
      component.password = 'ClaveSintetica1';
      component.confirmarPassword = 'ClaveSintetica1';

      component.iniciarSesion();

      expect(component.password).toBe('');
      expect(component.confirmarPassword).toBe('');
    });

    it('ionViewWillEnter reinicia credenciales, mensajes y visibilidad', () => {
      component.correo = 'ana@example.test';
      component.nombre = 'Ana';
      component.apellido = 'Pérez';
      component.password = 'ClaveSintetica1';
      component.confirmarPassword = 'ClaveSintetica1';
      component.mostrarPassword = true;
      component.correoTocado = true;
      component.error = 'Correo o contraseña incorrectos.';
      component.mensaje = 'Algún mensaje';
      component.modoRegistro = true;

      component.ionViewWillEnter();

      expect(component.correo).toBe('');
      expect(component.nombre).toBe('');
      expect(component.apellido).toBe('');
      expect(component.password).toBe('');
      expect(component.confirmarPassword).toBe('');
      expect(component.mostrarPassword).toBeFalse();
      expect(component.correoTocado).toBeFalse();
      expect(component.error).toBe('');
      expect(component.mensaje).toBe('');
      expect(component.modoRegistro).toBeFalse();
    });
  });
});
