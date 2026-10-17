export function formatearFechaHoraChile(fecha: string | null): string {
  if (fecha === null) return 'Fecha no disponible';
  const partes = new Intl.DateTimeFormat('es-CL', {
    timeZone: 'America/Santiago', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(fecha));
  const valor = (tipo: Intl.DateTimeFormatPartTypes): string =>
    partes.find(parte => parte.type === tipo)?.value ?? '';
  return `${valor('day')}/${valor('month')}/${valor('year')}, ${valor('hour')}:${valor('minute')}`;
}

export function formatearFechaCalendario(fecha: string | null): string {
  if (fecha === null) return 'No disponible';
  const [anio, mes, dia] = fecha.split('-');
  return `${dia}/${mes}/${anio}`;
}
