import { Notificacion } from '../../models/notificacion.models';

/** Sección del espacio de gestión a la que pertenece una notificación. */
export type SeccionNotificacion = 'solicitudes' | 'estados' | 'seguimientos' | 'incidencias' | 'general';

export interface PresentacionNotificacion {
  seccion: SeccionNotificacion;
  etiqueta: string;
  /** Nombre de ícono de Ionicons; el trazo es el mismo del portal del estudiante. */
  icono: string;
  /** Acción principal. Sin acción cuando la notificación no apunta a una entidad. */
  accion: { etiqueta: string; ruta: (idPractica: number) => unknown[] } | null;
}

const SOLICITUD = { seccion: 'solicitudes' as const, etiqueta: 'Solicitudes' };
const ESTADO = { seccion: 'estados' as const, etiqueta: 'Estados' };
const GENERAL = { seccion: 'general' as const, etiqueta: 'General' };

/**
 * Tipos de notificación que genera el backend y cómo se presentan al gestor.
 * Los tipos sin entrada usan la presentación general, sin acción.
 */
const PRESENTACION_POR_TIPO: Readonly<Record<string, PresentacionNotificacion>> = {
  NUEVA_PRACTICA: {
    ...SOLICITUD, icono: 'document-text-outline',
    accion: { etiqueta: 'Ver solicitud', ruta: id => ['/revisiones', id] }
  },
  RESPUESTA_OBSERVACION: {
    ...SOLICITUD, icono: 'chatbubble-ellipses-outline',
    accion: { etiqueta: 'Revisar respuesta', ruta: id => ['/revisiones', id] }
  },
  CIERRE_PRACTICA_PENDIENTE: {
    ...ESTADO, icono: 'flag-outline',
    accion: { etiqueta: 'Ver práctica', ruta: id => ['/practicas', id] }
  },
  CAMBIO_ESTADO: {
    ...ESTADO, icono: 'swap-horizontal-outline',
    accion: { etiqueta: 'Ver práctica', ruta: id => ['/practicas', id] }
  },
  PRACTICA_FINALIZADA: {
    ...ESTADO, icono: 'checkmark-done-outline',
    accion: { etiqueta: 'Ver práctica', ruta: id => ['/practicas', id] }
  },
  PRACTICA_INICIADA: {
    ...ESTADO, icono: 'swap-horizontal-outline',
    accion: { etiqueta: 'Ver práctica', ruta: () => ['/estudiante/mi-practica'] }
  },
  INCIDENCIA_ALTA: {
    ...ESTADO, icono: 'flag-outline',
    accion: { etiqueta: 'Ver práctica', ruta: id => ['/practicas', id] }
  },
  INCIDENCIA_CRITICA: {
    ...ESTADO, icono: 'flag-outline',
    accion: { etiqueta: 'Ver práctica', ruta: id => ['/practicas', id] }
  },
  GESTOR_ASIGNADO: {
    ...ESTADO, icono: 'swap-horizontal-outline',
    accion: { etiqueta: 'Ver práctica', ruta: id => ['/practicas', id] }
  },
  GESTOR_REASIGNADO: { ...ESTADO, icono: 'swap-horizontal-outline', accion: null },
  // La acción de la práctica depende del espacio (gestor o docente): la resuelve la página, no esta tabla.
  PRACTICA_ASIGNADA: { ...ESTADO, icono: 'document-text-outline', accion: null },
  MENSAJE_GESTOR: { ...GENERAL, icono: 'megaphone-outline', accion: null }
};

const PRESENTACION_GENERAL: PresentacionNotificacion = {
  ...GENERAL, icono: 'notifications-outline', accion: null
};

export function presentarNotificacion(tipo: string): PresentacionNotificacion {
  return PRESENTACION_POR_TIPO[tipo] ?? PRESENTACION_GENERAL;
}

/** Secciones de filtro del gestor, en el orden de la pantalla. */
export const FILTROS_SECCION: ReadonlyArray<{ valor: SeccionNotificacion; etiqueta: string }> = [
  { valor: 'solicitudes', etiqueta: 'Solicitudes' },
  { valor: 'seguimientos', etiqueta: 'Seguimientos' },
  { valor: 'incidencias', etiqueta: 'Incidencias' }
];

/** Zona horaria de la aplicación; los días y grupos se calculan en Santiago. */
const ZONA = 'America/Santiago';
const DIA_MS = 86_400_000;

function diaSantiago(instante: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(instante));
}

export type GrupoFecha = 'Hoy' | 'Esta semana' | 'Anteriores';

/** Grupo de una notificación según su fecha de creación. */
export function grupoFecha(fechaCreacion: string, ahora = Date.now()): GrupoFecha {
  const instante = Date.parse(fechaCreacion);
  if (Number.isNaN(instante)) return 'Anteriores';
  if (diaSantiago(instante) === diaSantiago(ahora)) return 'Hoy';
  return ahora - instante < 7 * DIA_MS ? 'Esta semana' : 'Anteriores';
}

/** Fecha relativa en español; la exacta se muestra en el atributo title. */
export function fechaRelativa(fechaCreacion: string, ahora = Date.now()): string {
  const instante = Date.parse(fechaCreacion);
  if (Number.isNaN(instante)) return '';
  const minutos = Math.floor((ahora - instante) / 60_000);
  if (minutos < 1) return 'justo ahora';
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `hace ${horas} ${horas === 1 ? 'hora' : 'horas'}`;
  const dias = Math.floor(horas / 24);
  if (dias < 7) return `hace ${dias} ${dias === 1 ? 'día' : 'días'}`;
  return fechaExacta(fechaCreacion);
}

/** Fecha exacta en dd/mm/aaaa HH:mm, zona de Santiago. */
export function fechaExacta(fechaCreacion: string): string {
  const instante = Date.parse(fechaCreacion);
  if (Number.isNaN(instante)) return '';
  return new Intl.DateTimeFormat('es-CL', {
    timeZone: ZONA, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  }).format(new Date(instante));
}

/** Filtra por sección; «todas» y «no leídas» se resuelven en el componente. */
export function perteneceASeccion(notificacion: Notificacion, seccion: SeccionNotificacion): boolean {
  return presentarNotificacion(notificacion.tipo).seccion === seccion;
}
