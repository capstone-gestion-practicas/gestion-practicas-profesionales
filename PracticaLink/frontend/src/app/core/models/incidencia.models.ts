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

// Contrato de lectura: conserva históricos sin aplicar validaciones de creación.
export interface ResolucionIncidencia {
  id_historial: number;
  id_usuario: number;
  fecha: string;
  comentario: string | null;
}

export interface IncidenciaHistorialItem {
  id_incidencia: number;
  id_practica: number;
  id_usuario: number;
  tipo: string | null;
  descripcion: string;
  estado: string;
  fecha: string;
  sin_tipo_registrado: boolean;
  fecha_resolucion: string | null;
  resolucion: ResolucionIncidencia | null;
}

export interface IncidenciasHistorialResponse {
  id_practica: number;
  items: IncidenciaHistorialItem[];
  limit: number;
  offset: number;
  hay_mas: boolean;
}

export type EstadoIncidencia = 'PENDIENTE' | 'EN_ATENCION' | 'RESUELTA';
export interface IncidenciaEstadoRequest {
  estado_esperado: EstadoIncidencia;
  estado_nuevo: EstadoIncidencia;
  comentario: string | null;
}
export interface IncidenciaEstadoResponse {
  id_incidencia: number;
  id_practica: number;
  id_historial: number;
  estado_anterior: EstadoIncidencia;
  estado_nuevo: EstadoIncidencia;
  id_usuario: number;
  comentario: string | null;
  fecha: string;
}
export interface IncidenciaEstadoEvento {
  id_historial: number;
  id_usuario: number;
  estado_anterior: string | null;
  estado_nuevo: string;
  fecha: string;
  comentario: string | null;
}
export interface IncidenciaEstadosHistorialResponse {
  id_practica: number;
  id_incidencia: number;
  items: IncidenciaEstadoEvento[];
  limit: number;
  offset: number;
  hay_mas: boolean;
}
