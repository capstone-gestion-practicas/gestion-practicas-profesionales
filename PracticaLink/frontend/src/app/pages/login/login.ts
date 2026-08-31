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
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonSpinner
} from '@ionic/angular';

import { AuthService } from '../../core/services/auth.service';
import { AuthStore } from '../../core/store/auth.store';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonContent,
    IonCard,
    IonCardHeader,
    IonCardTitle,
    IonCardContent,
    IonItem,
    IonLabel,
    IonList,
    IonInput,
    IonButton,
    IonSpinner
  ],
  templateUrl: './login.html',
  styleUrl: './login.scss'
})
export class Login {
  modoRegistro = false;
  ocultandoOjos = false;
  mostrandoPassword = false;
  passwordRevelada = false;
  presionandoLogin = false;
  private temporizadorMono: ReturnType<typeof setTimeout> | null = null;
  private temporizadorRevelado: ReturnType<typeof setTimeout> | null = null;
  nombre = '';
  apellido = '';
  correo = '';
  password = '';
  confirmarPassword = '';

  cargando = false;
  error = '';
  mensaje = '';

  constructor(
    private readonly authService: AuthService,
    private readonly authStore: AuthStore,
    private readonly router: Router
  ) {}

  alEscribirPassword(): void {
    this.ocultandoOjos = true;
    if (this.temporizadorMono) {
      clearTimeout(this.temporizadorMono);
    }
    this.temporizadorMono = setTimeout(() => {
      this.ocultandoOjos = false;
      this.temporizadorMono = null;
    }, 650);
  }

  detenerAnimacionMono(): void {
    if (this.temporizadorMono) {
      clearTimeout(this.temporizadorMono);
      this.temporizadorMono = null;
    }
    this.ocultandoOjos = false;
  }

  alternarVisibilidadPassword(): void {
    this.detenerAnimacionMono();

    if (this.mostrandoPassword) {
      if (this.temporizadorRevelado) {
        clearTimeout(this.temporizadorRevelado);
        this.temporizadorRevelado = null;
      }
      this.passwordRevelada = false;
      this.mostrandoPassword = false;
      return;
    }

    this.mostrandoPassword = true;
    this.passwordRevelada = false;
    this.temporizadorRevelado = setTimeout(() => {
      this.passwordRevelada = true;
      this.temporizadorRevelado = null;
    }, 1450);
  }

  ejecutarAccionPrincipal(): void {
    if (this.modoRegistro) {
      this.registrarse();
      return;
    }

    if (this.presionandoLogin || !this.correo || !this.password) {
      return;
    }

    if (this.mostrandoPassword) {
      this.alternarVisibilidadPassword();
    }
    this.presionandoLogin = true;
    setTimeout(() => {
      this.iniciarSesion();
      this.presionandoLogin = false;
    }, 1800);
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
            this.authStore.setContexto(contexto);
            this.cargando = false;
            this.router.navigate(['/home']);
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

  private correoValido(correo: string): boolean {
    const limpio = correo.trim();
    return limpio.length <= 150
      && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(limpio);
  }

  private normalizarCorreo(correo: string): string {
    return correo.trim().toLowerCase();
  }
}
