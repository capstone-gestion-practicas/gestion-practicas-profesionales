import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { AuthService } from '../../core/services/auth.service';
import { LaboralService } from '../../core/services/laboral.service';
import { AuthStore } from '../../core/store/auth.store';
import { MENSAJE_RUT_INVALIDO } from '../../core/utils/mensajes-rut';
import { Login } from './login';

describe('Login', () => {
  let component: Login;
  let fixture: ComponentFixture<Login>;
  let authService: jasmine.SpyObj<AuthService>;
  let laboralService: jasmine.SpyObj<LaboralService>;

  beforeEach(async () => {
    authService = jasmine.createSpyObj<AuthService>('AuthService', ['login', 'registrar', 'obtenerContexto']);
    laboralService = jasmine.createSpyObj<LaboralService>(
      'LaboralService',
      ['solicitarCuentaEmpresa', 'consultarEmpresaParaSolicitud']
    );
    await TestBed.configureTestingModule({
      imports: [Login],
      providers: [
        AuthStore,
        { provide: AuthService, useValue: authService },
        { provide: LaboralService, useValue: laboralService },
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

  it('routes an enabled company account to its portal', () => {
    authService.login.and.returnValue(of({
      access_token: 'synthetic-token',
      token_type: 'bearer'
    }));
    authService.obtenerContexto.and.returnValue(of({
      usuario: {
        id_usuario: 14,
        nombre: 'Empresa',
        apellido: 'Prueba',
        correo: 'empresa@example.invalid'
      },
      roles: ['EMPRESA'],
      perfil: null,
      practica_actual: null
    }));
    component.modoEmpresa = true;
    component.correo = 'empresa@example.invalid';
    component.password = 'synthetic-password';

    component.iniciarSesion();

    expect(TestBed.inject(Router).navigate).toHaveBeenCalledWith(['/portal-empresa']);
    expect(component.error).toBe('');
  });

  it('fills the company name from the RUT lookup and submits an approval request', () => {
    laboralService.consultarEmpresaParaSolicitud.and.returnValue(of({
      found: true,
      rut: '76.123.456-0',
      dv: '0',
      razon_social: 'Empresa Sintética',
      fecha_inicio_actividades: null,
      giro: null,
      rubro: null,
      subrubro: null,
      categoria_tributaria: null,
      afecta_iva: null,
      actividades: [],
      comuna: null,
      region: null,
      num_trabajadores: null,
      fuente: 'Chile RUT Empresa',
      consultado_en: null,
      cache_vigente: true
    }));
    laboralService.solicitarCuentaEmpresa.and.returnValue(of({
      id_solicitud: 41,
      estado: 'PENDIENTE',
      mensaje: 'Solicitud enviada para revisión'
    }));

    component.abrirSolicitudEmpresa();
    component.rutEmpresaSolicitud = '76123456-0';
    component.buscarEmpresaSolicitud();
    expect(component.razonSocialSolicitud).toBe('Empresa Sintética');

    component.nombreContactoSolicitud = 'Ana';
    component.apellidoContactoSolicitud = 'Prueba';
    component.correoSolicitud = 'ana@example.com';
    component.telefonoSolicitud = '+56912345678';
    component.cargoContactoSolicitud = 'Encargada';
    component.passwordSolicitud = 'synthetic-password';
    component.confirmarPasswordSolicitud = 'synthetic-password';
    component.enviarSolicitudEmpresa();

    expect(laboralService.solicitarCuentaEmpresa).toHaveBeenCalledWith({
      razon_social: 'Empresa Sintética',
      rut_empresa: '76.123.456-0',
      nombre_contacto: 'Ana',
      apellido_contacto: 'Prueba',
      correo: 'ana@example.com',
      telefono: '+56912345678',
      cargo_contacto: 'Encargada',
      password: 'synthetic-password'
    });

    expect(component.modoSolicitudEmpresa).toBeFalse();
    expect(component.mensaje).toContain('Un administrador revisará');
  });

  it('formats the company RUT while it is being entered', () => {
    component.actualizarRutEmpresaSolicitud('761234560');

    expect(component.rutEmpresaSolicitud).toBe('76.123.456-0');
  });

  it('blocks company requests and shows the shared message for an invalid RUT', () => {
    component.actualizarRutEmpresaSolicitud('123');
    component.validarRutEmpresaSolicitud();
    component.enviarSolicitudEmpresa();
    component.modoSolicitudEmpresa = true;
    fixture.detectChanges();

    expect(component.rutSolicitudValido).toBeFalse();
    expect(component.puedeCompletarSolicitudEmpresa).toBeFalse();
    expect(component.toastRutAbierto).toBeTrue();
    expect(component.mensajeToastRut).toBe(MENSAJE_RUT_INVALIDO);
    expect(laboralService.consultarEmpresaParaSolicitud).not.toHaveBeenCalled();
    expect(laboralService.solicitarCuentaEmpresa).not.toHaveBeenCalled();
    expect(
      (fixture.nativeElement.querySelector('.login-button') as HTMLIonButtonElement).disabled
    ).toBeTrue();
  });

  it('requires a verified company RUT before submitting an account request', () => {
    component.modoSolicitudEmpresa = true;
    component.rutEmpresaSolicitud = '76.123.456-0';

    component.enviarSolicitudEmpresa();

    expect(component.error).toBe(
      'Verifica el RUT de la empresa antes de continuar. Si no se encuentra, completa la solicitud manual para revisión.'
    );
    expect(laboralService.solicitarCuentaEmpresa).not.toHaveBeenCalled();
  });

  it('clears company verification when the RUT changes', () => {
    component.empresaVerificadaSolicitud = {
      found: true,
      rut: '76.123.456-0',
      dv: '0',
      razon_social: 'Empresa Sintética',
      fecha_inicio_actividades: null,
      giro: null,
      rubro: null,
      subrubro: null,
      categoria_tributaria: null,
      afecta_iva: null,
      actividades: [],
      comuna: null,
      region: null,
      num_trabajadores: null,
      fuente: 'Chile RUT Empresa',
      consultado_en: null,
      cache_vigente: true
    };
    component.razonSocialSolicitud = 'Empresa Sintética';

    component.actualizarRutEmpresaSolicitud('77.111.222-3');

    expect(component.empresaVerificadaSolicitud).toBeNull();
    expect(component.razonSocialSolicitud).toBe('');
  });

  it('allows a manually entered company request after the RUT is not found', () => {
    laboralService.consultarEmpresaParaSolicitud.and.returnValue(
      throwError(() => new HttpErrorResponse({ status: 404 }))
    );
    laboralService.solicitarCuentaEmpresa.and.returnValue(of({
      id_solicitud: 42,
      estado: 'PENDIENTE',
      mensaje: 'Solicitud enviada para revisión'
    }));

    component.modoSolicitudEmpresa = true;
    component.rutEmpresaSolicitud = '76.123.456-0';
    component.buscarEmpresaSolicitud();

    expect(component.puedeCompletarSolicitudEmpresa).toBeTrue();
    expect(component.mensajeConsultaEmpresa).toContain('revisada por un administrador');

    component.razonSocialSolicitud = 'Empresa Ingresada Manualmente';
    component.nombreContactoSolicitud = 'Ana';
    component.apellidoContactoSolicitud = 'Prueba';
    component.correoSolicitud = 'ana@example.com';
    component.telefonoSolicitud = '+56912345678';
    component.cargoContactoSolicitud = 'Encargada';
    component.passwordSolicitud = 'synthetic-password';
    component.confirmarPasswordSolicitud = 'synthetic-password';
    component.enviarSolicitudEmpresa();

    expect(laboralService.solicitarCuentaEmpresa).toHaveBeenCalledWith(
      jasmine.objectContaining({
        razon_social: 'Empresa Ingresada Manualmente',
        rut_empresa: '76.123.456-0'
      })
    );
  });
});
