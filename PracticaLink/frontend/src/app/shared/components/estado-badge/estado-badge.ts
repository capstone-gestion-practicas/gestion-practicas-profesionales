import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type VarianteEstado = 'neutral' | 'info' | 'warning' | 'primary' | 'success' | 'danger';

export interface PresentacionEstado {
  etiqueta: string;
  variante: VarianteEstado;
}

/** Mapa único de estados de práctica: mismo significado, mismo color en toda la aplicación. */
export const PRESENTACION_ESTADOS_PRACTICA: Readonly<Record<string, PresentacionEstado>> = {
  REGISTRADA: { etiqueta: 'Registrada', variante: 'neutral' },
  EN_REVISION: { etiqueta: 'En revisión', variante: 'info' },
  OBSERVADA: { etiqueta: 'Observada', variante: 'warning' },
  APROBADA: { etiqueta: 'Aprobada', variante: 'info' },
  EN_CURSO: { etiqueta: 'En curso', variante: 'primary' },
  FINALIZADA: { etiqueta: 'Finalizada', variante: 'success' },
  RECHAZADA: { etiqueta: 'Rechazada', variante: 'danger' }
};

/**
 * Presentación segura de un estado. Un código desconocido no rompe la pantalla:
 * se muestra el texto recibido con variante neutral.
 */
export function presentarEstado(estado: string | null | undefined): PresentacionEstado {
  const texto = (estado ?? '').trim();
  const clave = texto.toUpperCase();
  if (Object.prototype.hasOwnProperty.call(PRESENTACION_ESTADOS_PRACTICA, clave)) {
    return PRESENTACION_ESTADOS_PRACTICA[clave];
  }
  return { etiqueta: texto || 'Sin estado', variante: 'neutral' };
}

@Component({
  selector: 'app-estado-badge',
  standalone: true,
  templateUrl: './estado-badge.html',
  styleUrl: './estado-badge.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class EstadoBadge {
  readonly estado = input<string | null>(null);
  protected readonly presentacion = computed(() => presentarEstado(this.estado()));
}
