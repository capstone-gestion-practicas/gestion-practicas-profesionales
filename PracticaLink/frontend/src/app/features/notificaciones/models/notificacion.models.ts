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

export interface DestinatarioMensajePush {
  id_usuario: number;
  nombre: string;
}

export interface EnviarMensajePushResponse {
  id_notificacion: number;
  dispositivos_enviados: number;
  mensaje: string;
}

export interface EnviarBroadcastPushResponse {
  destinatarios: number;
  dispositivos_enviados: number;
  mensaje: string;
}
