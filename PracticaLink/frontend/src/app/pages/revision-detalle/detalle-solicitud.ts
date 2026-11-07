import { DecisionRevision } from '../../core/models/revision.models';

/** Estados en los que el backend acepta una decisión (fn_revisar_practica). */
export const ESTADOS_REVISABLES: readonly string[] = ['REGISTRADA', 'EN_REVISION', 'OBSERVADA'];

/** Longitud máxima de la observación, igual que el límite de la pantalla. */
export const LONGITUD_MAXIMA_OBSERVACION = 500;

/** Texto para datos que llegan vacíos. No inventa información. */
export const NO_INFORMADO = 'No informado';

export function esRevisable(estado: string): boolean {
  return ESTADOS_REVISABLES.includes(estado.trim().toUpperCase());
}

/** Causa visible cuando la solicitud no admite decisiones; null si sí las admite. */
export function motivoSinDecision(estado: string): string | null {
  const clave = estado.trim().toUpperCase();
  if (ESTADOS_REVISABLES.includes(clave)) return null;
  switch (clave) {
    case 'APROBADA':
      return 'La solicitud ya fue aprobada. No admite nuevas decisiones desde esta pantalla.';
    case 'RECHAZADA':
      return 'La solicitud ya fue rechazada. No admite nuevas decisiones desde esta pantalla.';
    case 'EN_CURSO':
      return 'La práctica está en curso. Las decisiones de revisión ya no aplican.';
    case 'FINALIZADA':
      return 'La práctica está finalizada. No admite decisiones de revisión.';
    default:
      return 'El estado actual no permite registrar decisiones de revisión.';
  }
}

/** Observar y Rechazar exigen observación; Aprobar no. */
export function requiereObservacion(decision: DecisionRevision): boolean {
  return decision !== 'APROBADA';
}

/** Fecha ISO (AAAA-MM-DD o con hora) a dd/mm/aaaa, sin pasar por zona horaria. */
export function fechaCorta(valor: string | null | undefined): string {
  const coincidencia = /^(\d{4})-(\d{2})-(\d{2})/.exec((valor ?? '').trim());
  if (!coincidencia) return NO_INFORMADO;
  const [, anio, mes, dia] = coincidencia;
  return `${dia}/${mes}/${anio}`;
}

/** Texto para un campo de texto; vacío o solo espacios se muestra como no informado. */
export function valorOInformado(valor: string | null | undefined): string {
  const texto = (valor ?? '').trim();
  return texto === '' ? NO_INFORMADO : texto;
}

export function horasTexto(horas: number | null | undefined): string {
  return horas === null || horas === undefined ? NO_INFORMADO : `${horas} h`;
}

export function jornadaTexto(horasSemanales: number | null | undefined): string {
  return horasSemanales === null || horasSemanales === undefined ? NO_INFORMADO : `${horasSemanales} h/semana`;
}

export function tituloDecision(decision: DecisionRevision): string {
  switch (decision) {
    case 'APROBADA': return 'Aprobar la solicitud';
    case 'OBSERVADA': return 'Observar la solicitud';
    case 'RECHAZADA': return 'Rechazar la solicitud';
  }
}
