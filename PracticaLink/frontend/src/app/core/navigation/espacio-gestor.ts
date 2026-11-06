import { ContextoUsuarioResponse } from '../models/auth.models';

/**
 * Espacio de gestión dedicado: el usuario tiene rol GESTOR y no ADMINISTRADOR.
 * Solo este espacio muestra GestorLayout y oculta los botones «Volver» que la
 * cabecera persistente sustituye. El administrador conserva su interfaz actual.
 */
export function esEspacioGestorDedicado(contexto: ContextoUsuarioResponse | null | undefined): boolean {
  const roles = contexto?.roles ?? [];
  return roles.includes('GESTOR') && !roles.includes('ADMINISTRADOR');
}
