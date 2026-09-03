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
