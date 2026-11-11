import { ParamMap, Params } from '@angular/router';

/**
 * Origen acotado del listado: nunca se interpreta como URL ni como destino de redirección.
 * El destino siempre es /practicas y solo se recuperan sus tres parámetros conocidos.
 * Sin almacenamiento adicional: el patrón es el mismo del retorno de RevisionDetalle.
 */
export function filtrosRetornoPracticas(parametros: ParamMap | undefined): Params | null {
  if (parametros?.get('origen') !== 'practicas') return null;
  const filtros: Params = {};
  for (const clave of ['origen', 'rut', 'estado', 'offset']) {
    if (parametros.getAll(clave).length > 1) return null;
  }
  const rut = parametros.get('rut');
  const estado = parametros.get('estado');
  const offset = parametros.get('offset');
  if (rut !== null) {
    if (!/^[0-9]{7,8}-[0-9Kk]$/.test(rut)) return null;
    filtros['rut'] = rut;
  }
  if (estado !== null) {
    if (!/^[A-Za-z_]{1,50}$/.test(estado)) return null;
    filtros['estado'] = estado.toUpperCase();
  }
  if (offset !== null) {
    const valor = Number(offset);
    if (!/^\d+$/.test(offset) || !Number.isSafeInteger(valor) || valor % 50 !== 0) return null;
    filtros['offset'] = valor;
  }
  return filtros;
}
