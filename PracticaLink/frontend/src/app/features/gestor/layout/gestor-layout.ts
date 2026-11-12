import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { muestraEspacioGestor } from '../../../core/navigation/espacio-gestor';
import { AuthStore } from '../../../core/store/auth.store';
import { GestorHeader } from '../../../pages/home/gestor-home/gestor-header/gestor-header';
import { AdminLayout } from '../../administrador/layout/admin-layout';
import { muestraEspacioAdministrador } from '../../../core/navigation/espacio-administrador';

/**
 * Contenedor persistente de los módulos del gestor. Las URL no cambian: las rutas
 * son hijas de este componente. La cabecera aparece solo en el espacio de gestión
 * dedicado; el administrador usa su propio shell sin duplicar páginas.
 */
@Component({
  selector: 'app-gestor-layout',
  standalone: true,
   imports: [RouterOutlet, GestorHeader, AdminLayout],
  templateUrl: './gestor-layout.html',
  styleUrl: './gestor-layout.scss',
  changeDetection: ChangeDetectionStrategy.Default
})
export class GestorLayout {
  private readonly authStore = inject(AuthStore);

  protected readonly mostrarCabecera = computed(() => muestraEspacioGestor(this.authStore.contexto()));
  protected readonly mostrarAdministracion = computed(() => muestraEspacioAdministrador(this.authStore.contexto()));
}
