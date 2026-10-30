export const MEDIOS_CONTACTO = [
  'Reunión presencial', 'Videollamada', 'Llamada telefónica', 'Correo electrónico', 'Otro'
] as const;

export interface SeguimientoCreate {
  fecha: string;
  tipo: typeof MEDIOS_CONTACTO[number];
  observacion: string;
}

export interface SeguimientoResponse extends SeguimientoCreate {
  id_seguimiento: number;
  id_practica: number;
  id_usuario: number;
  fecha_creacion: string;
}

export function hoySantiago(instante = new Date()): string {
  const partes = new Intl.DateTimeFormat('en', {
    timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(instante);
  const parte = (tipo: string) => partes.find(item => item.type === tipo)!.value;
  return `${parte('year')}-${parte('month')}-${parte('day')}`;
}

export function fechaSeguimientoValida(fecha: string): boolean {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(fecha) || fecha < '0001-01-01') return false;
  const instante = new Date(`${fecha}T00:00:00Z`);
  return !Number.isNaN(instante.getTime()) && instante.toISOString().slice(0, 10) === fecha
    && fecha <= hoySantiago();
}

// Lectura histórica: no hereda el catálogo ni las validaciones de creación.
export interface SeguimientoHistorialItem {
  id_seguimiento: number;
  fecha: string;
  tipo: string | null;
  observacion: string;
  responsable: { id_usuario: number; nombre: string };
}

export interface SeguimientosHistorialResponse {
  id_practica: number;
  items: SeguimientoHistorialItem[];
  limit: number;
  offset: number;
  hay_mas: boolean;
}
