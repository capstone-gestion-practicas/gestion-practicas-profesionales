import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';

import {
  IonButton,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonContent,
  IonSpinner
} from '@ionic/angular';

import { AuthService } from '../../core/services/auth.service';
import { AuthStore } from '../../core/store/auth.store';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [
    CommonModule,
    IonContent,
    IonCard,
    IonCardHeader,
    IonCardTitle,
    IonCardContent,
    IonButton,
    IonSpinner
  ],
  templateUrl: './home.html',
  styleUrl: './home.scss'
})
export class Home implements OnInit {

  private readonly authService = inject(AuthService);
  private readonly authStore = inject(AuthStore);
  private readonly router = inject(Router);

  readonly contexto = this.authStore.contexto;

  cargando = true;

  ngOnInit(): void {
    const token = sessionStorage.getItem('access_token');

    if (!token) {
      this.cargando = false;
      this.router.navigate(['/login']);
      return;
    }

    if (this.contexto()) {
      this.cargando = false;
      return;
    }

    this.authService.obtenerContexto().subscribe({
      next: (contexto) => {
        this.authStore.setContexto(contexto);
        this.cargando = false;
      },
      error: () => {
        this.cerrarSesion();
      }
    });
  }

  cerrarSesion(): void {
    sessionStorage.removeItem('access_token');
    this.authStore.limpiar();
    this.router.navigate(['/login']);
  }
}