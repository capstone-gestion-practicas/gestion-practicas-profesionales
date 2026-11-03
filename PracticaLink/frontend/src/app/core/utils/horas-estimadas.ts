const MILISEGUNDOS_POR_DIA = 24 * 60 * 60 * 1000;
const HORAS_MAXIMAS_POR_SEMANA = 45;

function diaUtc(fecha: string): number | null {
  const coincidencia = /^(\d{4})-(\d{2})-(\d{2})/.exec(fecha);
  if (!coincidencia) return null;

  const dia = Date.UTC(
    Number(coincidencia[1]),
    Number(coincidencia[2]) - 1,
    Number(coincidencia[3])
  );
  return Number.isNaN(dia) ? null : dia;
}

export function estimarHorasTranscurridas(
  fechaInicio: string | null | undefined,
  fechaTermino?: string | null,
  horasSemanales: number | null = 45
): number | null {
  if (!fechaInicio) return null;

  const inicio = diaUtc(fechaInicio);
  if (inicio === null) return null;

  const ahora = new Date();
  const hoy = Date.UTC(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
  const termino = fechaTermino ? diaUtc(fechaTermino) : null;
  const hasta = termino === null ? hoy : Math.min(hoy, termino);
  const diasTranscurridos = Math.max(0, (hasta - inicio) / MILISEGUNDOS_POR_DIA);

  const horasSemana = Math.min(HORAS_MAXIMAS_POR_SEMANA, Math.max(0, horasSemanales ?? 0));
  return Math.round((diasTranscurridos * horasSemana / 7) * 10) / 10;
}

export function formatoHorasEstimadas(
  fechaInicio: string | null | undefined,
  fechaTermino?: string | null,
  horasSemanales: number | null = 45
): string {
  if (horasSemanales === null) return 'Sin jornada semanal informada';
  const horas = estimarHorasTranscurridas(fechaInicio, fechaTermino, horasSemanales);
  return horas === null ? 'Sin fecha de inicio' : `${horas.toLocaleString('es-CL')} h aprox.`;
}
