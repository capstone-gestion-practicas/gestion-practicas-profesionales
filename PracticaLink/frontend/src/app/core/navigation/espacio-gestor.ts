import { ContextoUsuarioResponse } from '../models/auth.models';

/** Clave de sessionStorage donde /espacios guarda el espacio de trabajo elegido. */
export const CLAVE_ESPACIO_TRABAJO = 'practicalink-workspace';

/**
 * Espacio de gestión dedicado: el usuario tiene rol GESTOR y no ADMINISTRADOR.
 * Solo este espacio muestra GestorLayout y oculta los botones «Volver» que la
 * cabecera persistente sustituye. El administrador conserva su interfaz actual.
 */
export function esEspacioGestorDedicado(contexto: ContextoUsuarioResponse | null | undefined): boolean {
  const roles = contexto?.roles ?? [];
  return roles.includes('GESTOR') && !roles.includes('ADMINISTRADOR');
}

/**
 * Interfaz de gestión efectiva: gestor dedicado, o cuenta con rol GESTOR que eligió
 * explícitamente el espacio GESTOR (p. ej. GESTOR + ADMINISTRADOR). Regla única para la
 * cabecera de GestorLayout y la navegación interna del gestor.
 * sessionStorage solo se lee cuando hace falta (cuenta con GESTOR que no es gestor dedicado).
 */
export function muestraEspacioGestor(
  contexto: ContextoUsuarioResponse | null | undefined,
  espacioElegido?: string | null
): boolean {
  if (esEspacioGestorDedicado(contexto)) return true;
  if (!(contexto?.roles ?? []).includes('GESTOR')) return false;
  const espacio = espacioElegido === undefined ? sessionStorage.getItem(CLAVE_ESPACIO_TRABAJO) : espacioElegido;
  return espacio === 'GESTOR';
}
