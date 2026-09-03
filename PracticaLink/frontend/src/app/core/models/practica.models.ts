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
