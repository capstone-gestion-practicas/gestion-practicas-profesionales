import { Component, OnInit, computed, effect, inject } from '@angular/core';
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
  IonSpinner,
  ModalController
} from '@ionic/angular';

import { AuthService } from '../../core/services/auth.service';
import { PracticaService } from '../../core/services/practica.service';
import { AuthStore } from '../../core/store/auth.store';
import { ContextoUsuarioResponse } from '../../core/models/auth.models';
import { PracticaDetalleResponse } from '../../core/models/practica.models';
import { EstudianteService } from '../../core/services/estudiante.service';
import { formatearRut, rutValido } from '../../core/validators/rut.validator';
import { PracticaForm } from '../practica-form/practica-form';

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
  private readonly practicaService = inject(PracticaService);
  private readonly authStore = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly estudianteService = inject(EstudianteService);
  private readonly modalController = inject(ModalController);

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
  readonly puedeRevisarPracticas = computed(() => {
    const roles = this.contexto()?.roles ?? [];
    return roles.includes('GESTOR') || roles.includes('ADMINISTRADOR');
  });
  readonly esAdministrador = computed(
    () => this.contexto()?.roles.includes('ADMINISTRADOR') === true
  );

  cargando = true;
  errorPractica = '';
  practicaDetalle: PracticaDetalleResponse | null = null;
  modalPerfilAbierto = false;
  guardandoPerfil = false;
  errorPerfil = '';
  rutPerfil = '';
  carreraPerfil = '';
  sedePerfil = '';
  telefonoPerfil = '';
  direccionPerfil = '';
  private firmaContextoPracticaProcesada = '';

  private readonly sincronizarPracticaConContexto = effect(() => {
    const contexto = this.contexto();

    if (!contexto) {
      return;
    }

    this.cargarPracticaRegistrada(contexto);
  });

  ngOnInit(): void {
    const token = sessionStorage.getItem('access_token');

    if (!token) {
      this.cargando = false;
      this.router.navigate(['/login']);
      return;
    }

    if (this.contexto()) {
      this.cargando = false;
      this.cargarPracticaRegistrada(this.contexto() as ContextoUsuarioResponse);
      return;
    }

    this.authService.obtenerContexto().subscribe({
      next: (contexto) => {
        this.authStore.setContexto(contexto);
        this.cargando = false;
        this.cargarPracticaRegistrada(contexto);
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

  async registrarPractica(): Promise<void> {
    const modal = await this.modalController.create({
      component: PracticaForm,
      cssClass: 'practice-registration-modal',
      backdropDismiss: false
    });
    await modal.present();
  }

  revisarPracticas(): void {
    this.router.navigate(['/revisiones']);
  }

  gestionarUsuarios(): void {
    this.router.navigate(['/usuarios']);
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

    if (!rutValido(this.rutPerfil)) {
      this.errorPerfil = 'Ingresa un RUT válido con dígito verificador.';
      return;
    }

    this.rutPerfil = formatearRut(this.rutPerfil);

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

  private cargarPracticaRegistrada(contexto: ContextoUsuarioResponse): void {
    const firmaContexto = this.firmaContexto(contexto);

    if (firmaContexto === this.firmaContextoPracticaProcesada) {
      return;
    }

    this.firmaContextoPracticaProcesada = firmaContexto;
    this.errorPractica = '';

    if (
      contexto.roles.includes('ESTUDIANTE') !== true
      || contexto.practica_actual === null
    ) {
      this.practicaDetalle = null;
      return;
    }

    this.practicaService.obtenerMiPractica().subscribe({
      next: (practica) => {
        this.practicaDetalle = practica;
      },
      error: (error: HttpErrorResponse) => {
        if (error.status === 404) {
          this.practicaDetalle = null;
          return;
        }

        this.practicaDetalle = null;
        this.errorPractica = 'No fue posible cargar los antecedentes de tu práctica.';
      }
    });
  }

  private firmaContexto(contexto: ContextoUsuarioResponse): string {
    const idPractica = contexto.practica_actual?.id_practica ?? 'sin-practica';
    const roles = contexto.roles.join('|');

    return `${contexto.usuario.id_usuario}:${roles}:${idPractica}`;
  }

  formatearCampo(valor: string | number | null | undefined): string {
    if (valor === null || valor === undefined || valor === '') {
      return 'No informado';
    }

    return String(valor);
  }
}
