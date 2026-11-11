import { ContextoUsuarioResponse } from '../../../core/models/auth.models';
import { PracticaEstadoResumen } from '../../../core/models/practica.models';
import { EstadoAcademico, aprobacionVigente } from '../../evaluaciones/evaluacion.service';

/**
 * Reglas de presentación del cierre académico, extraídas sin cambios de GestionEstados.
 *
 * Son pistas de interfaz: deciden qué se muestra, no qué se permite. La autorización y
 * todas las condiciones de cierre las valida el servidor (POST /practicas/{id}/cierre →
 * fn_cerrar_practica → informes_privados.validar_cierre), que es la autoridad final.
 */

/** Datos mínimos de una práctica para evaluar si es candidata a cierre. */
export type PracticaCandidataCierre = Pick<PracticaEstadoResumen, 'estado' | 'fecha_termino' | 'id_gestor'>;

/** Fecha local del navegador en formato AAAA-MM-DD. */
function fechaLocalIso(hoy: Date): string {
  return [hoy.getFullYear(), hoy.getMonth() + 1, hoy.getDate()]
    .map((parte, indice) => indice === 0 ? String(parte) : String(parte).padStart(2, '0'))
    .join('-');
}

/**
 * true si la fecha de término ya se cumplió (hoy incluido); false sin fecha.
 *
 * RIESGO CONOCIDO (se conserva a propósito): compara con la fecha LOCAL del navegador,
 * mientras que el servidor usa la fecha de America/Santiago. Cerca de la medianoche, o con
 * un navegador en otra zona horaria, la interfaz puede ofrecer u ocultar el cierre un día
 * antes o después; el servidor responde 409 (PRACTICA_NO_CERRABLE) si no corresponde.
 */
export function fechaTerminoCumplida(fechaTermino: string | null, hoy: Date = new Date()): boolean {
  if (!fechaTermino) return false;
  return fechaTermino.slice(0, 10) <= fechaLocalIso(hoy);
}

/** Candidata a cierre: rol GESTOR, gestor responsable, EN_CURSO y término cumplido. */
export function esCandidataCierre(
  practica: PracticaCandidataCierre,
  contexto: ContextoUsuarioResponse | null | undefined,
  hoy: Date = new Date()
): boolean {
  return contexto?.roles.includes('GESTOR') === true
    && practica.id_gestor === contexto.usuario.id_usuario
    && practica.estado === 'EN_CURSO' && fechaTerminoCumplida(practica.fecha_termino, hoy);
}

/** Texto de estado de la verificación académica previa al cierre. */
export function mensajeAprobacionAcademica(consultando: boolean, estado: EstadoAcademico | null | undefined): string {
  if (consultando) return 'Consultando aprobación académica…';
  if (!estado) return 'Consulta la evaluación antes de cerrar.';
  return aprobacionVigente(estado)
    ? `Aprobación académica vigente de la versión ${estado.version}. El servidor verificará las demás condiciones de cierre.`
    : 'Sin aprobación académica vigente: no se puede cerrar la práctica.';
}

/** Mensaje para un error HTTP al consultar la evaluación vigente. */
export function mensajeErrorConsultaAcademica(status: number): string {
  return [401, 403, 404].includes(status)
    ? 'Sin acceso a la evaluación. Revisa tu sesión y asignación.'
    : 'No se pudo verificar la aprobación. Actualiza antes de cerrar.';
}
