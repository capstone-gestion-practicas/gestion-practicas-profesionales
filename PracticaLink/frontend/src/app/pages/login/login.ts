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
    IonInput,
    IonButton,
    IonSpinner
  ],
  templateUrl: './login.html',
  styleUrl: './login.scss'
})
export class Login {
  modoRegistro = false;
  nombre = '';
  apellido = '';
  rut = '';
  carrera = '';
  sede = '';
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
      correo: this.correo,
      password: this.password,
      rut: this.rut,
      carrera: this.carrera,
      sede: this.sede
    }).subscribe({
      next: () => {
        this.cargando = false;
        this.modoRegistro = false;
        this.nombre = '';
        this.apellido = '';
        this.rut = '';
        this.carrera = '';
        this.sede = '';
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
    this.cargando = true;

    this.authService.login({
      correo: this.correo,
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
}
