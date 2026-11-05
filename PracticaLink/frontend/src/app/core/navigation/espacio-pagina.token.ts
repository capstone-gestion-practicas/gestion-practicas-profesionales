import { InjectionToken } from '@angular/core';

/**
 * Espacio de navegación en el que se renderiza una página reutilizada.
 * Se provee desde la configuración de rutas; no se deduce de la URL.
 */
export const ESPACIO_PAGINA = new InjectionToken<'estudiante'>('ESPACIO_PAGINA');
