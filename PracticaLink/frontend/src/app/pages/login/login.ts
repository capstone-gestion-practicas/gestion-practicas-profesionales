import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';

import {
  IonButton,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonContent,
  IonModal,
  IonGrid,
  IonInput,
  IonItem,
  IonLabel,
  IonCol,
  IonRow,
  IonSpinner
} from '@ionic/angular';

import { EmpresaLookup } from '../../core/models/practica.models';
import { AuthService } from '../../core/services/auth.service';
import { LaboralService } from '../../core/services/laboral.service';
import { AuthStore } from '../../core/store/auth.store';
import { environment } from '../../../environments/environment';
import { formatearRut, rutValido } from '../../core/validators/rut.validator';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonContent,
    IonModal,
    IonGrid,
    IonRow,
    IonCol,
    IonCard,
    IonCardHeader,
    IonCardTitle,
    IonCardContent,
    IonItem,
    IonLabel,
    IonInput,
    IonButton,
    IonSpinner
  ],
  templateUrl: './login.html',
  styleUrl: './login.scss'
})
export class Login {
  readonly appVersion = environment.appVersion;
  readonly androidVersionCode = environment.androidVersionCode;
  readonly cambiosVersion = [
    'Recibe notificaciones push en Android cuando la app está en segundo plano.',
    'Consulta tus avisos desde el centro de notificaciones.',
    'Gestores pueden enviar mensajes personalizados a un estudiante o a todos los estudiantes activos.'
  ];
  novedadesAbiertas = false;
  modoEmpresa = false;
  modoRegistro = false;
  modoSolicitudEmpresa = false;
  nombre = '';
  apellido = '';
  correo = '';
  password = '';
  confirmarPassword = '';
  razonSocialSolicitud = '';
  rutEmpresaSolicitud = '';
  nombreContactoSolicitud = '';
  apellidoContactoSolicitud = '';
  correoSolicitud = '';
  telefonoSolicitud = '';
  cargoContactoSolicitud = '';
  passwordSolicitud = '';
  confirmarPasswordSolicitud = '';
  consultandoEmpresa = false;
  mensajeConsultaEmpresa = '';
  empresaVerificadaSolicitud: EmpresaLookup | null = null;
  rutEmpresaSolicitudSinCoincidencia: string | null = null;
  private consultaEmpresaSolicitudId = 0;

  cargando = false;
  error = '';
  mensaje = '';

  constructor(
    private readonly authService: AuthService,
    private readonly laboralService: LaboralService,
    private readonly authStore: AuthStore,
    private readonly router: Router
  ) {}

  alternarModo(): void {
    if (this.modoEmpresa) return;
    this.modoRegistro = !this.modoRegistro;
    this.password = '';
    this.confirmarPassword = '';
    this.error = '';
    this.mensaje = '';
  }

  alternarAccesoEmpresa(): void {
    this.modoEmpresa = !this.modoEmpresa;
    this.modoRegistro = false;
    this.modoSolicitudEmpresa = false;
    this.password = '';
    this.error = '';
    this.mensaje = '';
  }

  abrirSolicitudEmpresa(): void {
    this.modoSolicitudEmpresa = true;
    this.error = '';
    this.mensaje = '';
    this.mensajeConsultaEmpresa = '';
  }

  cancelarSolicitudEmpresa(): void {
    this.modoSolicitudEmpresa = false;
    this.error = '';
    this.mensajeConsultaEmpresa = '';
    this.consultandoEmpresa = false;
    this.consultaEmpresaSolicitudId += 1;
  }

  get puedeCompletarSolicitudEmpresa(): boolean {
    if (this.empresaVerificadaSolicitud) {
      return this.rutEmpresaSolicitud === this.empresaVerificadaSolicitud.rut;
    }
    return this.rutValidoSolicitudActual()
      && this.rutEmpresaSolicitudSinCoincidencia === formatearRut(this.rutEmpresaSolicitud);
  }

  actualizarRutEmpresaSolicitud(rut: string): void {
    if (rut === this.rutEmpresaSolicitud) return;
    this.rutEmpresaSolicitud = rut;
    this.empresaVerificadaSolicitud = null;
    this.rutEmpresaSolicitudSinCoincidencia = null;
    this.razonSocialSolicitud = '';
    this.mensajeConsultaEmpresa = '';
    this.error = '';
    this.consultandoEmpresa = false;
    this.consultaEmpresaSolicitudId += 1;
  }

  buscarEmpresaSolicitud(): void {
    this.error = '';
    this.mensajeConsultaEmpresa = '';
    this.empresaVerificadaSolicitud = null;
    this.rutEmpresaSolicitudSinCoincidencia = null;
    if (!rutValido(this.rutEmpresaSolicitud)) {
      this.error = 'Ingresa un RUT de empresa válido.';
      return;
    }

    this.rutEmpresaSolicitud = formatearRut(this.rutEmpresaSolicitud);
    this.consultandoEmpresa = true;
    const rutConsultado = this.rutEmpresaSolicitud;
    const consultaId = ++this.consultaEmpresaSolicitudId;
    this.laboralService.consultarEmpresaParaSolicitud(rutConsultado).subscribe({
      next: empresa => {
        if (consultaId !== this.consultaEmpresaSolicitudId) return;
        this.consultandoEmpresa = false;
        if (!empresa.found) {
          this.permitirSolicitudManual(rutConsultado);
          return;
        }
        this.empresaVerificadaSolicitud = empresa;
        this.razonSocialSolicitud = empresa.razon_social;
        this.mensajeConsultaEmpresa = empresa.cache_vigente
          ? 'RUT verificado. Confirma los datos de la empresa para continuar.'
          : 'Empresa encontrada, pero los datos de la consulta anterior están vencidos. La solicitud quedará sujeta a revisión.';
      },
      error: (error: HttpErrorResponse) => {
        if (consultaId !== this.consultaEmpresaSolicitudId) return;
        this.consultandoEmpresa = false;
        if (error.status === 404) {
          this.permitirSolicitudManual(rutConsultado);
          return;
        }
        this.mensajeConsultaEmpresa = 'No fue posible verificar el RUT. Inténtalo nuevamente para continuar.';
      }
    });
  }

  enviarSolicitudEmpresa(): void {
    this.error = '';
    this.mensaje = '';
    if (!this.puedeCompletarSolicitudEmpresa) {
      this.error = 'Verifica el RUT de la empresa antes de continuar. Si no se encuentra, completa la solicitud manual para revisión.';
      return;
    }
    if (!this.razonSocialSolicitud.trim()
      || !this.nombreContactoSolicitud.trim()
      || !this.apellidoContactoSolicitud.trim()
      || !this.telefonoSolicitud.trim()
      || !this.cargoContactoSolicitud.trim()) {
      this.error = 'Completa los datos de la empresa y de la persona de contacto.';
      return;
    }
    if (!this.correoValido(this.correoSolicitud)) {
      this.error = 'Ingresa un correo válido de máximo 150 caracteres.';
      return;
    }
    if (this.passwordSolicitud.length < 8 || this.passwordSolicitud.length > 128) {
      this.error = 'La contraseña debe tener entre 8 y 128 caracteres.';
      return;
    }
    if (this.passwordSolicitud !== this.confirmarPasswordSolicitud) {
      this.error = 'Las contraseñas no coinciden.';
      return;
    }

    this.cargando = true;
    this.laboralService.solicitarCuentaEmpresa({
      razon_social: this.razonSocialSolicitud.trim(),
      rut_empresa: formatearRut(this.rutEmpresaSolicitud),
      nombre_contacto: this.nombreContactoSolicitud.trim(),
      apellido_contacto: this.apellidoContactoSolicitud.trim(),
      correo: this.normalizarCorreo(this.correoSolicitud),
      telefono: this.telefonoSolicitud.trim(),
      cargo_contacto: this.cargoContactoSolicitud.trim(),
      password: this.passwordSolicitud
    }).subscribe({
      next: () => {
        this.cargando = false;
        this.modoSolicitudEmpresa = false;
        this.limpiarSolicitudEmpresa();
        this.mensaje = 'Solicitud enviada. Un administrador revisará los datos antes de crear la cuenta.';
      },
      error: (error: HttpErrorResponse) => {
        this.cargando = false;
        this.error = typeof error.error?.detail === 'string'
          ? error.error.detail
          : 'No fue posible enviar la solicitud.';
      }
    });
  }

  registrarse(): void {
    if (this.modoEmpresa) return;
    this.error = '';
    this.mensaje = '';

    if (!this.correoValido(this.correo)) {
      this.error = 'Ingresa un correo válido de máximo 150 caracteres.';
      return;
    }

    if (this.password !== this.confirmarPassword) {
      this.error = 'Las contraseñas no coinciden.';
      return;
    }

    if (this.password.length < 8) {
      this.error = 'La contraseña debe tener al menos 8 caracteres.';
      return;
    }

    this.cargando = true;

    this.authService.registrar({
      nombre: this.nombre,
      apellido: this.apellido,
      correo: this.normalizarCorreo(this.correo),
      password: this.password
    }).subscribe({
      next: () => {
        this.cargando = false;
        this.modoRegistro = false;
        this.nombre = '';
        this.apellido = '';
        this.password = '';
        this.confirmarPassword = '';
        this.mensaje = 'Cuenta creada. Ya puedes iniciar sesión.';
      },
      error: (error: HttpErrorResponse) => {
        this.cargando = false;
        this.error = error.status === 409
          ? 'El correo ya está registrado.'
          : 'No fue posible crear la cuenta.';
      }
    });
  }

  iniciarSesion(): void {
    this.error = '';
    this.mensaje = '';

    if (!this.correoValido(this.correo)) {
      this.error = 'Ingresa un correo válido de máximo 150 caracteres.';
      return;
    }
    this.cargando = true;

    this.authService.login({
      correo: this.normalizarCorreo(this.correo),
      password: this.password
    }).subscribe({
      next: (loginResponse) => {
        sessionStorage.setItem(
          'access_token',
          loginResponse.access_token
        );

        this.authService.obtenerContexto().subscribe({
          next: (contexto) => {
            const esEmpresa = contexto.roles.includes('EMPRESA');
            if (this.modoEmpresa && !esEmpresa) {
              sessionStorage.removeItem('access_token');
              this.cargando = false;
              this.error = 'Esta cuenta no está habilitada como empresa.';
              return;
            }
            this.authStore.setContexto(contexto);
            this.cargando = false;
            if (esEmpresa) {
              this.router.navigate(['/portal-empresa']);
              return;
            }
            const versionVista = localStorage.getItem('practicalink-version-novedades');
            if (versionVista === this.appVersion) {
              this.router.navigate(['/home']);
            } else {
              this.novedadesAbiertas = true;
            }
          },
          error: () => {
            this.cargando = false;
            this.error = 'No fue posible cargar el contexto del usuario.';
          }
        });
      },
      error: () => {
        this.cargando = false;
        this.error = 'Correo o contraseña incorrectos.';
      }
    });
  }

  continuarDespuesDeNovedades(): void {
    localStorage.setItem('practicalink-version-novedades', this.appVersion);
    this.novedadesAbiertas = false;
    this.router.navigate(['/home']);
  }

  private correoValido(correo: string): boolean {
    const limpio = correo.trim();
    return limpio.length <= 150
      && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(limpio);
  }

  private normalizarCorreo(correo: string): string {
    return correo.trim().toLowerCase();
  }

  private limpiarSolicitudEmpresa(): void {
    this.consultaEmpresaSolicitudId += 1;
    this.consultandoEmpresa = false;
    this.razonSocialSolicitud = '';
    this.rutEmpresaSolicitud = '';
    this.nombreContactoSolicitud = '';
    this.apellidoContactoSolicitud = '';
    this.correoSolicitud = '';
    this.telefonoSolicitud = '';
    this.cargoContactoSolicitud = '';
    this.passwordSolicitud = '';
    this.confirmarPasswordSolicitud = '';
    this.mensajeConsultaEmpresa = '';
    this.empresaVerificadaSolicitud = null;
    this.rutEmpresaSolicitudSinCoincidencia = null;
  }

  private rutValidoSolicitudActual(): boolean {
    return rutValido(this.rutEmpresaSolicitud);
  }

  private permitirSolicitudManual(rut: string): void {
    this.rutEmpresaSolicitudSinCoincidencia = rut;
    this.razonSocialSolicitud = '';
    this.mensajeConsultaEmpresa = 'No encontramos una empresa asociada a ese RUT. Completa los datos manualmente; la solicitud será revisada por un administrador.';
  }
}
