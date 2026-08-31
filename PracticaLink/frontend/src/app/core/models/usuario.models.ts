export interface Rol {
  id_rol: number;
  nombre: string;
  descripcion: string | null;
}

export interface UsuarioAdministrable {
  id_usuario: number;
  nombre: string;
  apellido: string;
  correo: string;
  activo: boolean;
  roles: string[];
}

export interface UsuarioCrear {
  nombre: string;
  apellido: string;
  correo: string;
  password: string;
  roles: string[];
}

export interface UsuarioActualizar {
  nombre: string;
  apellido: string;
  activo: boolean;
  roles: string[];
}

export interface OperacionUsuario {
  id_usuario: number;
  mensaje: string;
}
