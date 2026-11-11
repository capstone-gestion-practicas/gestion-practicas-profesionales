import { InjectionToken } from '@angular/core';

/**
 * Espacio de navegación en el que se renderiza una página reutilizada.
 * Se provee desde la configuración de rutas; no se deduce de la URL.
 */
export type EspacioPagina = 'estudiante' | 'docente';

export const ESPACIO_PAGINA = new InjectionToken<EspacioPagina>('ESPACIO_PAGINA');
