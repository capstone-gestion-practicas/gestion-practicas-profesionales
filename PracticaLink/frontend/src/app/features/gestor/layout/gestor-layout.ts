import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { esEspacioGestorDedicado } from '../../../core/navigation/espacio-gestor';
import { AuthStore } from '../../../core/store/auth.store';
import { GestorHeader } from '../../../pages/home/gestor-home/gestor-header/gestor-header';

/**
 * Contenedor persistente de los módulos del gestor. Las URL no cambian: las rutas
 * son hijas de este componente. La cabecera aparece solo en el espacio de gestión
 * dedicado; el administrador conserva su interfaz actual.
 */
@Component({
  selector: 'app-gestor-layout',
  standalone: true,
  imports: [RouterOutlet, GestorHeader],
  templateUrl: './gestor-layout.html',
  styleUrl: './gestor-layout.scss',
  changeDetection: ChangeDetectionStrategy.Default
})
export class GestorLayout {
  private readonly authStore = inject(AuthStore);

  protected readonly mostrarCabecera = computed(() => {
    const roles = this.authStore.contexto()?.roles ?? [];
    return esEspacioGestorDedicado(this.authStore.contexto())
      || (roles.includes('GESTOR') && sessionStorage.getItem('practicalink-workspace') === 'GESTOR');
  });
}
