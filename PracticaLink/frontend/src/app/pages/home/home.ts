import { Component, OnInit, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { switchMap } from 'rxjs';

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
  IonModal,
  IonSpinner
} from '@ionic/angular';

import { AuthService } from '../../core/services/auth.service';
import { AuthStore } from '../../core/store/auth.store';
import { EstudianteService } from '../../core/services/estudiante.service';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonContent,
    IonCard,
    IonCardHeader,
    IonCardTitle,
    IonCardContent,
    IonButton,
    IonInput,
    IonItem,
    IonLabel,
    IonModal,
    IonSpinner
  ],
  templateUrl: './home.html',
  styleUrl: './home.scss'
})
export class Home implements OnInit {

  private readonly authService = inject(AuthService);
  private readonly authStore = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly estudianteService = inject(EstudianteService);

  readonly contexto = this.authStore.contexto;
  readonly saludo = computed(() => {
    const contexto = this.contexto();

    if (!contexto) {
      return '';
    }

    const nombre = contexto.usuario.nombre;
    const roles = contexto.roles.length > 0
      ? contexto.roles.join(', ')
      : 'sin rol asignado';

    return `Hola, ${nombre}. Estás logueado como ${roles}.`;
  });
  readonly puedeRegistrarPractica = computed(() => {
    const contexto = this.contexto();
    return contexto?.roles.includes('ESTUDIANTE') === true
      && contexto.perfil !== null
      && contexto.practica_actual === null;
  });
  readonly esEstudiante = computed(
    () => this.contexto()?.roles.includes('ESTUDIANTE') === true
  );

  cargando = true;
  modalPerfilAbierto = false;
  guardandoPerfil = false;
  errorPerfil = '';
  rutPerfil = '';
  carreraPerfil = '';
  sedePerfil = '';
  telefonoPerfil = '';
  direccionPerfil = '';

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

  registrarPractica(): void {
    this.router.navigate(['/practicas/nueva']);
  }

  completarPerfil(): void {
    this.errorPerfil = '';
    this.modalPerfilAbierto = true;
  }

  cerrarModalPerfil(): void {
    if (!this.guardandoPerfil) {
      this.modalPerfilAbierto = false;
      this.errorPerfil = '';
    }
  }

  guardarPerfil(): void {
    if (
      !this.rutPerfil.trim()
      || !this.carreraPerfil.trim()
      || !this.sedePerfil.trim()
    ) {
      this.errorPerfil = 'RUT, carrera y sede son obligatorios.';
      return;
    }

    this.errorPerfil = '';
    this.guardandoPerfil = true;
    this.estudianteService.completarPerfil({
      rut: this.rutPerfil.trim(),
      carrera: this.carreraPerfil.trim(),
      sede: this.sedePerfil.trim(),
      telefono: this.opcional(this.telefonoPerfil),
      direccion: this.opcional(this.direccionPerfil)
    }).pipe(
      switchMap(() => this.authService.obtenerContexto())
    ).subscribe({
      next: contexto => {
        this.authStore.setContexto(contexto);
        this.guardandoPerfil = false;
        this.modalPerfilAbierto = false;
      },
      error: (error: HttpErrorResponse) => {
        this.guardandoPerfil = false;
        this.errorPerfil = typeof error.error?.detail === 'string'
          ? error.error.detail
          : 'No fue posible completar el perfil.';
      }
    });
  }

  private opcional(valor: string): string | null {
    return valor.trim() || null;
  }
}
