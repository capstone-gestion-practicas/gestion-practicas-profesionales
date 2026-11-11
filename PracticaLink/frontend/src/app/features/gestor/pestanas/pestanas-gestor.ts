import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';

import { muestraEspacioGestor } from '../../../core/navigation/espacio-gestor';
import { AuthStore } from '../../../core/store/auth.store';

/** Destino de una pestaña interna del espacio de gestión. */
export interface PestanaGestor {
  readonly etiqueta: string;
  /** URL existente; la pestaña no crea rutas ni cambia guards. */
  readonly ruta: string;
  /** Roles exigidos por el backend para el destino. Sin ellos la pestaña no se ofrece. */
  readonly rolesRequeridos?: readonly string[];
}

/** Prácticas: /revisiones exige GESTOR en el router y en la API (un ADMINISTRADOR solo recibiría 403). */
export const PESTANAS_PRACTICAS: readonly PestanaGestor[] = [
  { etiqueta: 'Solicitudes', ruta: '/revisiones', rolesRequeridos: ['GESTOR'] },
  { etiqueta: 'Mis prácticas', ruta: '/practicas' }
];

export const PESTANAS_ACOMPANAMIENTO: readonly PestanaGestor[] = [
  { etiqueta: 'Seguimientos', ruta: '/seguimientos' },
  { etiqueta: 'Incidencias', ruta: '/incidencias' }
];

/**
 * Navegación interna entre páginas hermanas del espacio de gestión.
 *
 * - Cada página anfitriona corresponde a una sola ruta e indica su pestaña con `activa`;
 *   no se escuchan eventos del router (mismo patrón de botones + router.navigate que el
 *   sidebar de GestorHeader). Atrás/Adelante funcionan porque cada cambio es una navegación
 *   normal del router.
 * - Botones nativos dentro de <nav>: Tab/Intro/Espacio funcionan sin código adicional; la
 *   activa lleva aria-current="page".
 * - Solo se muestra en la interfaz de gestión (misma regla que la cabecera de GestorLayout),
 *   así el ADMINISTRADOR conserva su navegación, y solo si quedan al menos dos destinos
 *   permitidos para los roles del usuario.
 */
@Component({
  selector: 'app-pestanas-gestor',
  standalone: true,
  templateUrl: './pestanas-gestor.html',
  styleUrl: './pestanas-gestor.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PestanasGestor {
  private readonly authStore = inject(AuthStore);
  private readonly router = inject(Router);

  readonly pestanas = input.required<readonly PestanaGestor[]>();
  /** Ruta de la página anfitriona (p. ej. '/revisiones'). */
  readonly activa = input.required<string>();
  /** Nombre accesible del grupo de pestañas (p. ej. «Secciones de Prácticas»). */
  readonly etiqueta = input.required<string>();

  protected readonly visibles = computed<readonly PestanaGestor[]>(() => {
    const contexto = this.authStore.contexto();
    if (!muestraEspacioGestor(contexto)) return [];
    const roles = contexto?.roles ?? [];
    const permitidas = this.pestanas().filter(pestana =>
      (pestana.rolesRequeridos ?? []).every(rol => roles.includes(rol)));
    return permitidas.length > 1 ? permitidas : [];
  });

  protected ir(pestana: PestanaGestor): void {
    if (pestana.ruta === this.activa()) return;
    void this.router.navigate([pestana.ruta]);
  }
}
