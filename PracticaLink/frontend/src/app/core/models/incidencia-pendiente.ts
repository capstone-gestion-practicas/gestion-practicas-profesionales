/** Ambos vocabularios vigentes: legado y EP06. No modifica transiciones ni permisos. */
export function esIncidenciaPendiente(incidencia: { estado: string }): boolean {
  return ['ABIERTA', 'EN_REVISION', 'PENDIENTE', 'EN_ATENCION'].includes(incidencia.estado);
}
