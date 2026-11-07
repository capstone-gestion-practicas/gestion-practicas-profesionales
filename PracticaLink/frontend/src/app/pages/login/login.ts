import { Component } from '@angular/core';
import { addIcons } from 'ionicons';
import { eyeOffOutline, eyeOutline } from 'ionicons/icons';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';

import {
  IonButton,
  IonContent,
  IonModal,
  IonInput,
  IonItem,
  IonLabel,
  IonSpinner,
  IonIcon
} from '@ionic/angular';

import { AuthService } from '../../core/services/auth.service';
import { AuthStore } from '../../core/store/auth.store';
import { environment } from '../../../environments/environment';

const MENSAJE_CORREO_INVALIDO = 'Ingresa un correo válido de máximo 150 caracteres.';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonContent,
    IonModal,
    IonItem,
    IonLabel,
    IonInput,
    IonButton,
    IonIcon,
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
  modoRegistro = false;
  nombre = '';
  apellido = '';
  correo = '';
  password = '';
  confirmarPassword = '';

  cargando = false;
  error = '';
  mensaje = '';
  mostrarPassword = false;
  correoTocado = false;
  private destinoDespuesDeLogin = '/home';

  constructor(
    private readonly authService: AuthService,
    private readonly authStore: AuthStore,
    private readonly router: Router
  ) {
    addIcons({ eyeOutline, eyeOffOutline });
  }

  /** Envío único del formulario: Enter o el botón principal, nunca ambos. */
  enviar(): void {
    if (this.modoRegistro) {
      this.registrarse();
    } else {
      this.iniciarSesion();
    }
  }

  alternarMostrarPassword(): void {
    this.mostrarPassword = !this.mostrarPassword;
  }

  /** Error de correo solo visible tras salir del campo; usa la misma regla que el envío. */
  get errorCorreo(): string {
    const texto = this.correo.trim();
    return this.correoTocado && texto !== '' && !this.correoValido(texto)
      ? MENSAJE_CORREO_INVALIDO
      : '';
  }

  alternarModo(): void {
    this.modoRegistro = !this.modoRegistro;
    this.password = '';
    this.confirmarPassword = '';
    this.error = '';
    this.mensaje = '';
  }

  registrarse(): void {
    this.error = '';
    this.mensaje = '';

    if (!this.correoValido(this.correo)) {
      this.error = MENSAJE_CORREO_INVALIDO;
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
      this.error = MENSAJE_CORREO_INVALIDO;
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
        // La contraseña ya no se necesita: no debe permanecer en memoria tras la autenticación.
        this.password = '';
        this.confirmarPassword = '';

        this.authService.obtenerContexto().subscribe({
          next: (contexto) => {
            this.authStore.setContexto(contexto);
            this.cargando = false;
            const roles = new Set(contexto.roles);
            const espacios = ['ESTUDIANTE', 'GESTOR', 'DOCENTE', 'ADMINISTRADOR'].filter(rol => roles.has(rol));
            this.destinoDespuesDeLogin = espacios.length > 1 ? '/espacios'
              : roles.has('DOCENTE') && !roles.has('GESTOR') && !roles.has('ADMINISTRADOR') && !roles.has('ESTUDIANTE')
                ? '/docente/practicas' : '/home';
            sessionStorage.setItem('practicalink-workspace', espacios.length > 1 ? '' : (espacios[0] ?? 'ESTUDIANTE'));
            const versionVista = localStorage.getItem('practicalink-version-novedades');
            if (versionVista === this.appVersion) {
              this.router.navigate([this.destinoDespuesDeLogin]);
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

  /**
   * Ionic reactiva esta página al volver a mostrarla (p. ej., tras cerrar sesión).
   * El formulario no debe conservar credenciales ni mensajes de una sesión anterior.
   */
  ionViewWillEnter(): void {
    this.correo = '';
    this.password = '';
    this.confirmarPassword = '';
    this.nombre = '';
    this.apellido = '';
    this.mostrarPassword = false;
    this.correoTocado = false;
    this.error = '';
    this.mensaje = '';
    this.modoRegistro = false;
  }

  continuarDespuesDeNovedades(): void {
    localStorage.setItem('practicalink-version-novedades', this.appVersion);
    this.novedadesAbiertas = false;
    this.router.navigate([this.destinoDespuesDeLogin]);
  }

  private correoValido(correo: string): boolean {
    const limpio = correo.trim();
    return limpio.length <= 150
      && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(limpio);
  }

  private normalizarCorreo(correo: string): string {
    return correo.trim().toLowerCase();
  }
}
