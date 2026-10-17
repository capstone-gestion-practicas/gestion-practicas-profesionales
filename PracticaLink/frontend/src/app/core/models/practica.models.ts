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
  fecha_ultimo_cambio_estado: string | null;
  estado: EstadoPracticaDetalle;
  centro_practica: CentroPracticaDetalle;
  fecha_inicio: string | null;
  fecha_termino: string | null;
  horas: number | null;
  cargo_funcion: string | null;
  descripcion: string | null;
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


export interface PracticaResumen {
  id_practica: number;
  estudiante: { id_estudiante: number; nombre: string };
  centro_practica: string;
  fecha_registro: string;
  estado: EstadoPracticaDetalle;
  fecha_ultimo_cambio_estado: string | null;
}

export interface PracticasListadoResponse {
  items: PracticaResumen[];
  limit: number;
  offset: number;
  hay_mas: boolean;
}


export interface PracticaDetalleGestionResponse {
  id_practica: number;
  estudiante: { id_estudiante: number; nombre: string };
  centro_practica: { id_centro: number; nombre: string };
  fecha_registro: string;
  estado: EstadoPracticaDetalle;
  fecha_ultimo_cambio_estado: string | null;
  fecha_inicio: string | null;
  fecha_termino: string | null;
  horas: number | null;
  cargo_funcion: string | null;
  descripcion: string | null;
}


export interface EstadoHistorial {
  id_estado: number;
  nombre: string;
}

export interface ResponsableHistorial {
  id_usuario: number;
  nombre: string;
}

export interface EventoHistorial {
  id_historial: number;
  estado_anterior: EstadoHistorial | null;
  estado_nuevo: EstadoHistorial;
  fecha_cambio: string;
  responsable: ResponsableHistorial;
  observacion: string | null;
}

export interface HistorialPracticaResponse {
  id_practica: number;
  items: EventoHistorial[];
  limit: number;
  offset: number;
  hay_mas: boolean;
}
