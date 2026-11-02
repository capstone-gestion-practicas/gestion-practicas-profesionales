export type EstadoOferta = 'BORRADOR' | 'PUBLICADA' | 'CERRADA';
export type ModalidadOferta = 'PRESENCIAL' | 'HIBRIDA' | 'REMOTA';
export type JornadaOferta = 'COMPLETA' | 'PARCIAL' | 'PROYECTO' | 'PRACTICA';
export type EstadoPostulacion = 'RECIBIDA' | 'EN_REVISION' | 'SELECCIONADA' | 'RECHAZADA';

export interface OfertaLaboral {
  id_oferta: number;
  rut_empresa: string;
  empresa: string;
  cargo: string;
  descripcion: string;
  ubicacion: string;
  modalidad: ModalidadOferta;
  requisitos: string;
  jornada: JornadaOferta;
  fecha_publicacion: string | null;
  fecha_cierre: string | null;
  estado: EstadoOferta;
  total_postulaciones: number;
}

export interface OfertaLaboralInput {
  rut_empresa?: string | null;
  cargo: string;
  descripcion: string;
  ubicacion: string;
  modalidad: ModalidadOferta;
  requisitos: string;
  jornada: JornadaOferta;
  fecha_cierre: string | null;
  estado: EstadoOferta;
}

export interface OfertaGuardada {
  id_oferta: number;
  rut_empresa: string;
  cargo: string;
  estado: EstadoOferta;
  mensaje: string;
}

export interface CuentaEmpresa {
  rut_empresa: string;
}

export interface PracticaEmpresa {
  id_practica: number;
  rut_empresa: string;
  centro_practica: string;
  estado: string;
  fecha_inicio: string | null;
  fecha_termino: string | null;
  cargo_funcion: string | null;
  estudiante: {
    nombre: string;
    apellido: string;
    correo: string;
    rut: string;
    carrera: string;
    sede: string;
    telefono: string | null;
  };
}

export interface PostulacionEstudiante {
  id_postulacion: number;
  id_oferta: number;
  empresa: string;
  cargo: string;
  ubicacion: string;
  modalidad: ModalidadOferta;
  fecha_postulacion: string;
  estado: EstadoPostulacion;
  carta_presentacion: string | null;
}

export interface PostulacionEmpresa {
  id_postulacion: number;
  id_oferta: number;
  id_estudiante: number;
  nombre: string;
  apellido: string;
  correo: string;
  rut: string;
  carrera: string;
  sede: string;
  carta_presentacion: string | null;
  estado: EstadoPostulacion;
  fecha_postulacion: string;
}

export interface OperacionPostulacion {
  id_postulacion: number;
  estado: EstadoPostulacion;
  mensaje: string;
}

export interface HistorialPostulacion {
  estado_anterior: EstadoPostulacion | null;
  estado_nuevo: EstadoPostulacion;
  observacion: string | null;
  fecha_cambio: string;
  usuario: string;
}

export interface SolicitudCuentaEmpresaInput {
  razon_social: string;
  rut_empresa: string;
  nombre_contacto: string;
  apellido_contacto: string;
  correo: string;
  telefono: string;
  cargo_contacto: string;
  password: string;
}

export interface SolicitudCuentaEmpresa {
  id_solicitud: number;
  razon_social: string;
  rut_empresa: string;
  nombre_contacto: string;
  apellido_contacto: string;
  correo: string;
  telefono: string;
  cargo_contacto: string;
  estado: 'PENDIENTE' | 'APROBADA' | 'RECHAZADA';
  observacion_revision: string | null;
  fecha_solicitud: string;
  fecha_revision: string | null;
}

export interface SolicitudCuentaEmpresaCreada {
  id_solicitud: number;
  estado: 'PENDIENTE';
  mensaje: string;
}

export interface ResolverSolicitudCuentaEmpresa {
  estado: 'APROBADA' | 'RECHAZADA';
  observacion: string | null;
}

export interface SolicitudCuentaEmpresaResuelta {
  id_solicitud: number;
  id_usuario: number | null;
  estado: 'APROBADA' | 'RECHAZADA';
  mensaje: string;
}
