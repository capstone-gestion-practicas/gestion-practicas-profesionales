import { Component, DestroyRef, computed, inject } from '@angular/core';
import type { OutputEmitterRef } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { IonIcon, ModalController } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  briefcaseOutline,
  homeOutline,
  logOutOutline,
  notificationsOutline
} from 'ionicons/icons';

import { AuthStore } from '../../../core/store/auth.store';
import { BrandMark } from '../../../shared/components/brand-mark/brand-mark';
import { StudentAccount } from './student-account/student-account';
import { NotificacionService } from '../../notificaciones/services/notificacion.service';
import { Subscription } from 'rxjs';

interface StudentActionSource {
  solicitarCompletarPerfil: OutputEmitterRef<void>;
  solicitarRegistroPractica: OutputEmitterRef<void>;
}

function isStudentActionSource(value: unknown): value is StudentActionSource {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<StudentActionSource>;
  return typeof candidate.solicitarCompletarPerfil?.subscribe === 'function'
    && typeof candidate.solicitarRegistroPractica?.subscribe === 'function';
}

@Component({
  selector: 'app-student-layout',
  standalone: true,
  imports: [BrandMark, IonIcon, RouterLink, RouterLinkActive, RouterOutlet, StudentAccount],
  templateUrl: './student-layout.html',
  styleUrl: './student-layout.scss'
})
export class StudentLayout {
  private readonly authStore = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly notificacionService = inject(NotificacionService);
  private readonly modalController = inject(ModalController);
  private readonly destroyRef = inject(DestroyRef);
  private accionesRuta = new Subscription();
  readonly contexto = this.authStore.contexto;
  readonly noLeidas = this.notificacionService.noLeidas;
  readonly nombreUsuario = computed(() => {
    const usuario = this.contexto()?.usuario;
    return usuario ? `${usuario.nombre} ${usuario.apellido}`.trim() : 'Cuenta';
  });
  readonly inicialUsuario = computed(() => this.contexto()?.usuario.nombre.trim().charAt(0) || '?');
  readonly puedeCambiarAEspacioGestion = computed(() => {
    const roles = this.contexto()?.roles ?? [];
    return roles.includes('ESTUDIANTE')
      && (roles.includes('GESTOR') || roles.includes('ADMINISTRADOR'));
  });

  constructor() {
    addIcons({
      homeOutline, briefcaseOutline, notificationsOutline, logOutOutline });
    this.destroyRef.onDestroy(() => this.accionesRuta.unsubscribe());
  }

  vincularAcciones(componente: unknown): void {
    this.accionesRuta.unsubscribe();
    this.accionesRuta = new Subscription();
    if (isStudentActionSource(componente)) {
      this.accionesRuta.add(componente.solicitarCompletarPerfil.subscribe(() => void this.abrirCompletarPerfil()));
      this.accionesRuta.add(componente.solicitarRegistroPractica.subscribe(() => void this.abrirRegistroPractica()));
    }
  }

  async abrirRegistroPractica(): Promise<void> {
    const { PracticaForm } = await import('../../../pages/practica-form/practica-form');
    const modal = await this.modalController.create({
      component: PracticaForm,
      cssClass: 'practice-registration-modal',
      backdropDismiss: false
    });
    await modal.present();
  }

  async abrirCompletarPerfil(): Promise<void> {
    const { CompletarPerfilModal } = await import('../components/completar-perfil-modal/completar-perfil-modal');
    const modal = await this.modalController.create({
      component: CompletarPerfilModal,
      cssClass: 'student-profile-modal',
      backdropDismiss: false
    });
    await modal.present();
  }

  abrirEspacioGestion(): void {
    void this.router.navigate(['/home']);
  }

  cerrarSesion(): void {
    sessionStorage.removeItem('access_token');
    this.authStore.limpiar();
    void this.router.navigate(['/login']);
  }
}
