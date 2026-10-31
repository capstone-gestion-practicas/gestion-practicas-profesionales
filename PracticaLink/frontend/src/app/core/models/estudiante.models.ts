export interface PerfilEstudianteCreate {
  rut: string;
  carrera: string;
  sede: string;
  telefono: string | null;
  direccion: string | null;
}

export interface PerfilEstudianteResponse {
  id_estudiante: number;
  mensaje: string;
}
