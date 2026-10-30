export const TIPOS_INCIDENCIA = [
  { codigo: 'ABANDONO', nombre: 'Abandono' },
  { codigo: 'PROBLEMA_CENTRO', nombre: 'Problema con el centro' },
  { codigo: 'SALUD', nombre: 'Salud' },
  { codigo: 'OTRO', nombre: 'Otro' }
] as const;

export type TipoIncidencia = typeof TIPOS_INCIDENCIA[number]['codigo'];
export interface IncidenciaCreate {
  tipo: TipoIncidencia;
  descripcion: string;
}
export interface IncidenciaResponse extends IncidenciaCreate {
  id_incidencia: number;
  id_practica: number;
  id_usuario: number;
  estado: 'PENDIENTE';
  fecha: string;
}
