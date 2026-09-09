export interface SolicitudRevisionResumen {
  id_practica: number;
  fecha_registro: string;
  estado: string;
  estudiante: string;
  rut_estudiante: string;
  centro_practica: string;
}

export interface SolicitudRevisionDetalle extends SolicitudRevisionResumen {
  correo_estudiante: string;
  carrera: string;
  sede: string;
  rut_empresa: string | null;
  direccion_empresa: string | null;
  correo_empresa: string | null;
  contacto_nombre: string | null;
  contacto_cargo: string | null;
  fecha_inicio: string | null;
  fecha_termino: string | null;
  horas: number | null;
  cargo_funcion: string | null;
  descripcion: string | null;
}

export type DecisionRevision = 'APROBADA' | 'OBSERVADA' | 'RECHAZADA';

export interface DecisionRevisionResponse {
  id_practica: number;
  estado: string;
  mensaje: string;
}
