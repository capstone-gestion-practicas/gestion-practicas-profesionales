export interface LoginRequest {
  correo: string;
  password: string;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
}

export interface UsuarioContext {
  id_usuario: number;
  nombre: string;
  apellido: string;
  correo: string;
}

export interface PerfilEstudianteContext {
  id_estudiante: number;
  rut: string;
  carrera: string;
  sede: string;
}

export interface EstadoPracticaContext {
  id_estado: number;
  nombre: string;
  es_final: boolean;
}

export interface CentroPracticaContext {
  id_centro: number;
  nombre: string;
}

export interface PracticaActualContext {
  id_practica: number;
  estado: EstadoPracticaContext;
  centro_practica: CentroPracticaContext;
  fecha_inicio: string | null;
  fecha_termino: string | null;
  horas: number | null;
  cargo_funcion: string | null;
}

export interface ContextoUsuarioResponse {
  usuario: UsuarioContext;
  roles: string[];
  perfil: PerfilEstudianteContext | null;
  practica_actual: PracticaActualContext | null;
}

export interface RegistroRequest {
  nombre: string;
  apellido: string;
  correo: string;
  password: string;
}

export interface RegistroResponse {
  id_usuario: number;
  nombre: string;
  apellido: string;
  correo: string;
  rol: string;
}
