export interface CentroPracticaCreate {
  nombre: string;
  rut_empresa: string | null;
  direccion: string | null;
  telefono: string | null;
  correo: string | null;
  contacto_nombre: string | null;
  contacto_cargo: string | null;
}

export interface PracticaCreate {
  centro: CentroPracticaCreate;
  fecha_inicio: string | null;
  fecha_termino: string | null;
  horas: number | null;
  horas_semanales: number | null;
  cargo_funcion: string | null;
  descripcion: string | null;
}

export interface PracticaCreateResponse {
  id_practica: number;
  id_centro: number;
  estado: string;
  mensaje: string;
}

export interface EstadoPracticaDetalle {
  id_estado: number;
  nombre: string;
  descripcion?: string | null;
  es_final: boolean;
}

export interface CentroPracticaDetalle {
  id_centro: number;
  nombre: string;
  rut_empresa: string | null;
  direccion: string | null;
  telefono: string | null;
  correo: string | null;
  contacto_nombre: string | null;
  contacto_cargo: string | null;
}

export interface PracticaDetalleResponse {
  id_practica: number;
  fecha_registro: string;
  fecha_actualizacion: string;
  estado: EstadoPracticaDetalle;
  centro_practica: CentroPracticaDetalle;
  fecha_inicio: string | null;
  fecha_termino: string | null;
  horas: number | null;
  horas_semanales: number | null;
  cargo_funcion: string | null;
  descripcion: string | null;
}

export interface PracticaEstadoResumen {
  id_practica: number;
  fecha_registro: string;
  fecha_actualizacion: string;
  id_estado: number;
  estado: string;
  descripcion_estado: string | null;
  es_final: boolean;
  estudiante: string;
  rut_estudiante: string;
  centro_practica: string;
  fecha_inicio: string | null;
  fecha_termino: string | null;
  horas_semanales: number | null;
}

export interface EstudianteSinPractica {
  id_usuario: number;
  nombre: string;
  apellido: string;
  tiene_perfil: boolean;
  tiene_practica: boolean;
  recordatorio_enviado_hoy: boolean;
}

export interface RecordatorioEstudianteResponse {
  id_usuario: number;
  mensaje: string;
  correo_enviado: boolean;
  recordatorio_enviado_hoy: boolean;
}

export interface HistorialEstadoPractica {
  id_historial: number;
  id_practica: number;
  id_estado: number;
  estado: string;
  es_final: boolean;
  id_usuario: number;
  usuario: string;
  fecha_cambio: string;
  observacion: string | null;
}

export interface SeguimientoPractica {
  id_seguimiento: number;
  id_practica: number;
  id_usuario: number;
  usuario: string;
  fecha: string;
  observacion: string;
}

export type PrioridadIncidencia = 'BAJA' | 'MEDIA' | 'ALTA' | 'CRITICA';
export type EstadoIncidencia = 'ABIERTA' | 'EN_REVISION' | 'RESUELTA' | 'CERRADA';

export interface IncidenciaPractica {
  id_incidencia: number;
  id_practica: number;
  id_usuario: number;
  usuario: string;
  fecha: string;
  descripcion: string;
  prioridad: PrioridadIncidencia;
  estado: EstadoIncidencia;
  fecha_resolucion: string | null;
  alerta: boolean;
  estudiante: string | null;
  correo_estudiante: string | null;
  centro_practica: string | null;
}

export interface ActualizarEstadoIncidenciaResponse {
  id_incidencia: number;
  estado: EstadoIncidencia;
  mensaje: string;
}

export interface ActualizarEstadoPracticaResponse {
  id_practica: number;
  id_estado: number;
  estado: string;
  mensaje: string;
}

export interface EmpresaLookup {
  found: boolean;
  rut: string;
  dv: string | null;
  razon_social: string;
  fecha_inicio_actividades: string | null;
  giro: string | null;
  rubro: string | null;
  subrubro: string | null;
  categoria_tributaria: string | null;
  afecta_iva: string | null;
  actividades: ActividadEmpresa[];
  comuna: string | null;
  region: string | null;
  num_trabajadores: string | null;
  fuente: string;
  consultado_en: string | null;
  cache_vigente: boolean;
}

export interface ActividadEmpresa {
  codigo: string;
  descripcion: string;
  afecta_iva: string | null;
  categoria: string | null;
}
