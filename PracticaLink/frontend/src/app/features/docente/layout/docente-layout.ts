import { Component, computed, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { documentTextOutline, logOutOutline, notificationsOutline } from 'ionicons/icons';

import { AuthStore } from '../../../core/store/auth.store';
import { SesionService } from '../../../core/session/sesion.service';
import { BrandMark } from '../../../shared/components/brand-mark/brand-mark';
import { StudentAccount } from '../../estudiante/layout/student-account/student-account';
import { NotificacionService } from '../../notificaciones/services/notificacion.service';

/**
 * Contenedor del espacio docente. Reutiliza la presentación del espacio del estudiante
 * (student-layout.scss) y añade solo lo propio del docente.
 */
@Component({
  selector: 'app-docente-layout',
  standalone: true,
  imports: [BrandMark, IonIcon, RouterLink, RouterLinkActive, RouterOutlet, StudentAccount],
  templateUrl: './docente-layout.html',
  styleUrls: ['../../estudiante/layout/student-layout.scss', './docente-layout.scss']
})
export class DocenteLayout {
  private readonly authStore = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly sesion = inject(SesionService);
  private readonly notificacionService = inject(NotificacionService);
  readonly noLeidas = this.notificacionService.noLeidas;
  readonly nombreUsuario = computed(() => {
    const usuario = this.authStore.contexto()?.usuario;
    return usuario ? `${usuario.nombre} ${usuario.apellido}`.trim() : 'Cuenta';
  });
  readonly inicialUsuario = computed(() => this.authStore.contexto()?.usuario.nombre.trim().charAt(0) || '?');
  /** Solo con más de un espacio disponible: el selector lleva a /espacios. */
  readonly puedeCambiarEspacio = computed(() => {
    const roles = this.authStore.contexto()?.roles ?? [];
    return ['ESTUDIANTE', 'GESTOR', 'DOCENTE', 'ADMINISTRADOR']
      .filter(rol => roles.includes(rol)).length > 1;
  });

  constructor() {
    addIcons({ documentTextOutline, notificationsOutline, logOutOutline });
  }

  cambiarEspacio(): void {
    void this.router.navigate(['/espacios']);
  }

  cerrarSesion(): void {
    this.sesion.cerrar();
  }
}
