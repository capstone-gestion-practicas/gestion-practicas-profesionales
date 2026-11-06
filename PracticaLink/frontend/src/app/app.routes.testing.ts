import { Route, Routes } from '@angular/router';

/**
 * Aplana la configuración de rutas (incluidos los hijos) para pruebas que buscan una ruta por path.
 * Solo se usa en specs; no forma parte del código de producción.
 */
export function aplanarRutas(configuracion: Routes): Route[] {
  return configuracion.flatMap(ruta => [ruta, ...aplanarRutas(ruta.children ?? [])]);
}
