import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

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
  correo = '';
  password = '';

  cargando = false;
  error = '';

  constructor(
    private readonly authService: AuthService,
    private readonly authStore: AuthStore,
    private readonly router: Router
  ) {}

  iniciarSesion(): void {
    this.error = '';
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