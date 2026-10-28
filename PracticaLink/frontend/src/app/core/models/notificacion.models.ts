export interface Notificacion {
  id_notificacion: number;
  id_practica: number | null;
  tipo: 'NUEVA_PRACTICA' | 'CAMBIO_ESTADO' | string;
  titulo: string;
  mensaje: string;
  fecha_creacion: string;
  fecha_leida: string | null;
}

export interface NotificacionesResumen {
  notificaciones: Notificacion[];
  no_leidas: number;
}
