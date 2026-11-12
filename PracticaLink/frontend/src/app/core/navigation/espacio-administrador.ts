import { ContextoUsuarioResponse } from '../models/auth.models';
import { muestraEspacioGestor } from './espacio-gestor';

/** Solo presentación. Los guards y el servidor siguen comprobando los roles reales. */
export function muestraEspacioAdministrador(contexto: ContextoUsuarioResponse | null | undefined): boolean {
  return (contexto?.roles ?? []).includes('ADMINISTRADOR') && !muestraEspacioGestor(contexto);
}
