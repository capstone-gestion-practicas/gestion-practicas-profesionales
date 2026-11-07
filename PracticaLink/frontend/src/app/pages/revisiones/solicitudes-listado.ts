import { SolicitudRevisionResumen } from '../../core/models/revision.models';

/** Solicitudes por página en la paginación local (no es paginación de base de datos). */
export const TAMANO_PAGINA = 10;

/** Estados que devuelve el listado de solicitudes (fn_listar_solicitudes_revision). */
export type EstadoSolicitud = 'REGISTRADA' | 'EN_REVISION' | 'OBSERVADA';

export const ESTADOS_SOLICITUD: readonly EstadoSolicitud[] = ['REGISTRADA', 'EN_REVISION', 'OBSERVADA'];

export type OrdenSolicitudes = 'ANTIGUAS' | 'RECIENTES' | 'ESTUDIANTE';

export const ORDENES_SOLICITUDES: ReadonlyArray<{ valor: OrdenSolicitudes; etiqueta: string }> = [
  { valor: 'ANTIGUAS', etiqueta: 'Más antiguas primero' },
  { valor: 'RECIENTES', etiqueta: 'Más recientes primero' },
  { valor: 'ESTUDIANTE', etiqueta: 'Estudiante A–Z' }
];

/** Resultado de leer el parámetro `estado` de la URL. */
export interface FiltroUrl {
  estados: EstadoSolicitud[];
  /** Códigos recibidos que no corresponden a un estado de solicitud; se ignoran y se informan. */
  desconocidos: string[];
}

/** Minúsculas, sin tildes, espacios colapsados. Base de comparación insensible. */
export function normalizarTexto(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Lee el parámetro `estado` (p. ej. `registrada`, `en_revision`, `registrada,observada`).
 * Sin parámetro o sin códigos válidos, no hay filtro (todas). Los códigos desconocidos se
 * ignoran y se devuelven para informarlos en pantalla.
 */
export function estadosDesdeParametro(valor: string | null): FiltroUrl {
  if (!valor || valor.trim() === '') {
    return { estados: [], desconocidos: [] };
  }
  const reconocidos = new Set<EstadoSolicitud>();
  const desconocidos: string[] = [];
  for (const token of valor.split(',')) {
    if (token.trim() === '') continue;
    const clave = normalizarTexto(token).replace(/ /g, '_').toUpperCase();
    const estado = ESTADOS_SOLICITUD.find(item => item === clave);
    if (estado) {
      reconocidos.add(estado);
    } else {
      desconocidos.push(token.trim());
    }
  }
  return {
    estados: ESTADOS_SOLICITUD.filter(estado => reconocidos.has(estado)),
    desconocidos
  };
}

/** Valor canónico del parámetro para la URL; null cuando no hay filtro. */
export function parametroDesdeEstados(estados: readonly EstadoSolicitud[]): string | null {
  return estados.length === 0 ? null : estados.map(estado => estado.toLowerCase()).join(',');
}

/** Cuenta solicitudes por estado sobre el listado completo (no sobre el filtro activo). */
export function contarPorEstado(solicitudes: readonly SolicitudRevisionResumen[]): Record<EstadoSolicitud | 'total', number> {
  const conteo: Record<EstadoSolicitud | 'total', number> = { REGISTRADA: 0, EN_REVISION: 0, OBSERVADA: 0, total: solicitudes.length };
  for (const solicitud of solicitudes) {
    const estado = estadoDe(solicitud);
    if (estado) conteo[estado] += 1;
  }
  return conteo;
}

/** Solicitudes que cuentan como «por revisar»: REGISTRADA + EN_REVISION. */
export function contarPorRevisar(solicitudes: readonly SolicitudRevisionResumen[]): number {
  const conteo = contarPorEstado(solicitudes);
  return conteo.REGISTRADA + conteo.EN_REVISION;
}

/** Filtra por estado (vacío = todos) y por texto en estudiante o centro de práctica. */
export function filtrarSolicitudes(
  solicitudes: readonly SolicitudRevisionResumen[],
  estados: readonly EstadoSolicitud[],
  busqueda: string
): SolicitudRevisionResumen[] {
  const termino = normalizarTexto(busqueda);
  return solicitudes.filter(solicitud => {
    const estado = estadoDe(solicitud);
    if (estados.length > 0 && (estado === null || !estados.includes(estado))) return false;
    if (termino === '') return true;
    return normalizarTexto(solicitud.estudiante).includes(termino)
      || normalizarTexto(solicitud.centro_practica).includes(termino);
  });
}

/** Ordena una copia; nunca altera el arreglo recibido del servicio. */
export function ordenarSolicitudes(
  solicitudes: readonly SolicitudRevisionResumen[],
  orden: OrdenSolicitudes
): SolicitudRevisionResumen[] {
  const copia = [...solicitudes];
  switch (orden) {
    case 'ANTIGUAS':
      return copia.sort((a, b) => tiempo(a) - tiempo(b) || a.id_practica - b.id_practica);
    case 'RECIENTES':
      return copia.sort((a, b) => tiempo(b) - tiempo(a) || b.id_practica - a.id_practica);
    case 'ESTUDIANTE':
      return copia.sort((a, b) =>
        normalizarTexto(a.estudiante).localeCompare(normalizarTexto(b.estudiante), 'es')
        || a.id_practica - b.id_practica);
  }
}

export interface PaginaSolicitudes<T> {
  elementos: T[];
  pagina: number;
  paginas: number;
  /** Índices (base 1) del primer y último elemento mostrados; 0 si no hay elementos. */
  desde: number;
  hasta: number;
}

/** Paginación local. La página solicitada se acota al rango válido. */
export function paginar<T>(lista: readonly T[], paginaSolicitada: number, tamano = TAMANO_PAGINA): PaginaSolicitudes<T> {
  const paginas = Math.max(1, Math.ceil(lista.length / tamano));
  const pagina = Math.min(Math.max(1, Math.trunc(paginaSolicitada) || 1), paginas);
  const inicio = (pagina - 1) * tamano;
  const elementos = lista.slice(inicio, inicio + tamano);
  return {
    elementos,
    pagina,
    paginas,
    desde: elementos.length === 0 ? 0 : inicio + 1,
    hasta: inicio + elementos.length
  };
}

/** Fecha de envío en formato chileno, en la zona horaria de Santiago como el resto de la aplicación. */
export function fechaEnvio(solicitud: SolicitudRevisionResumen): string {
  const instante = tiempo(solicitud);
  if (instante === 0) return 'Sin fecha';
  return new Intl.DateTimeFormat('es-CL', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Santiago'
  }).format(new Date(instante));
}

/** Antigüedad en días completos desde el envío; null si la fecha no es válida. */
export function antiguedadDias(solicitud: SolicitudRevisionResumen, ahora = Date.now()): number | null {
  const instante = tiempo(solicitud);
  if (Number.isNaN(instante) || instante === 0) return null;
  return Math.max(0, Math.floor((ahora - instante) / 86_400_000));
}

/** Valor de la URL para el orden. Desconocido o ausente = orden por defecto (más antiguas). */
export function ordenDesdeParametro(valor: string | null): OrdenSolicitudes {
  switch ((valor ?? '').trim().toLowerCase()) {
    case 'recientes': return 'RECIENTES';
    case 'estudiante': return 'ESTUDIANTE';
    default: return 'ANTIGUAS';
  }
}

/** Valor canónico para la URL; null cuando es el orden por defecto (no se escribe). */
export function parametroDesdeOrden(orden: OrdenSolicitudes): string | null {
  switch (orden) {
    case 'RECIENTES': return 'recientes';
    case 'ESTUDIANTE': return 'estudiante';
    default: return null;
  }
}

/** Página desde la URL. No válida o menor que 1 = página 1. */
export function paginaDesdeParametro(valor: string | null): number {
  const numero = Number((valor ?? '').trim());
  return Number.isInteger(numero) && numero >= 1 ? numero : 1;
}

function estadoDe(solicitud: SolicitudRevisionResumen): EstadoSolicitud | null {
  const clave = solicitud.estado.trim().toUpperCase();
  return ESTADOS_SOLICITUD.find(estado => estado === clave) ?? null;
}

function tiempo(solicitud: SolicitudRevisionResumen): number {
  const instante = Date.parse(solicitud.fecha_registro);
  return Number.isNaN(instante) ? 0 : instante;
}
