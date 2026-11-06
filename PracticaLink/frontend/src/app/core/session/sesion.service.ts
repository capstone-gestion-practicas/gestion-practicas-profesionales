import { Injectable, Injector, inject } from '@angular/core';
import { NavController } from '@ionic/angular';

import { AuthStore } from '../store/auth.store';

/**
 * Cierre de sesión centralizado: elimina el token, limpia el estado de autenticación
 * y navega a la raíz del Login. NavController.navigateRoot quita del stack de Ionic
 * las vistas anteriores, así que no vuelven a reactivarse con su estado previo.
 *
 * NavController se resuelve solo al cerrar sesión: así las páginas que inyectan este
 * servicio no lo instancian (ni se suscriben al Router) al cargarse.
 */
@Injectable({ providedIn: 'root' })
export class SesionService {
  private readonly authStore = inject(AuthStore);
  private readonly injector = inject(Injector);

  cerrar(): void {
    sessionStorage.removeItem('access_token');
    this.authStore.limpiar();
    void this.injector.get(NavController).navigateRoot(['/login']);
  }
}
