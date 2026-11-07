import { Notificacion } from '../../models/notificacion.models';
import {
  FILTROS_SECCION,
  fechaExacta,
  fechaRelativa,
  grupoFecha,
  perteneceASeccion,
  presentarNotificacion
} from './presentacion-notificacion';

const ahora = Date.parse('2026-11-06T15:00:00-03:00');

const notificacion = (tipo: string, idPractica: number | null = 7): Notificacion => ({
  id_notificacion: 1, id_practica: idPractica, tipo, titulo: 't', mensaje: 'm',
  fecha_creacion: '2026-11-06T14:00:00-03:00', fecha_leida: null
});

describe('presentación de notificaciones del gestor', () => {
  describe('tipo → sección, icono y acción', () => {
    it('una nueva solicitud va a Solicitudes y abre la solicitud', () => {
      const presentacion = presentarNotificacion('NUEVA_PRACTICA');
      expect(presentacion.seccion).toBe('solicitudes');
      expect(presentacion.accion?.etiqueta).toBe('Ver solicitud');
      expect(presentacion.accion?.ruta(7)).toEqual(['/revisiones', 7]);
    });

    it('una respuesta a una observación va a Solicitudes con «Revisar respuesta»', () => {
      const presentacion = presentarNotificacion('RESPUESTA_OBSERVACION');
      expect(presentacion.seccion).toBe('solicitudes');
      expect(presentacion.accion?.etiqueta).toBe('Revisar respuesta');
      expect(presentacion.accion?.ruta(3)).toEqual(['/revisiones', 3]);
    });

    it('los cambios de estado van a Estados y abren la práctica', () => {
      const presentacion = presentarNotificacion('CAMBIO_ESTADO');
      expect(presentacion.seccion).toBe('estados');
      expect(presentacion.accion?.ruta(9)).toEqual(['/practicas', 9]);
    });

    it('un mensaje general no tiene acción', () => {
      expect(presentarNotificacion('MENSAJE_GESTOR').accion).toBeNull();
    });

    it('un tipo desconocido se presenta como general, sin acción ni error', () => {
      const presentacion = presentarNotificacion('TIPO_NUEVO');
      expect(presentacion.seccion).toBe('general');
      expect(presentacion.accion).toBeNull();
      expect(presentacion.icono).toBe('notifications-outline');
    });

    it('filtra por sección sin mezclar tipos', () => {
      expect(perteneceASeccion(notificacion('NUEVA_PRACTICA'), 'solicitudes')).toBeTrue();
      expect(perteneceASeccion(notificacion('NUEVA_PRACTICA'), 'estados')).toBeFalse();
    });

    it('expone Solicitudes, Seguimientos e Incidencias como filtros de sección', () => {
      expect(FILTROS_SECCION.map(item => item.etiqueta)).toEqual(['Solicitudes', 'Seguimientos', 'Incidencias']);
    });
  });

  describe('agrupación y fechas', () => {
    it('agrupa en Hoy, Esta semana y Anteriores según el día en Santiago', () => {
      expect(grupoFecha('2026-11-06T10:00:00-03:00', ahora)).toBe('Hoy');
      expect(grupoFecha('2026-11-03T10:00:00-03:00', ahora)).toBe('Esta semana');
      expect(grupoFecha('2026-10-01T10:00:00-03:00', ahora)).toBe('Anteriores');
    });

    it('una fecha no válida cae en Anteriores', () => {
      expect(grupoFecha('no-es-fecha', ahora)).toBe('Anteriores');
    });

    it('la fecha relativa usa minutos, horas y días en español', () => {
      expect(fechaRelativa('2026-11-06T14:59:30-03:00', ahora)).toBe('justo ahora');
      expect(fechaRelativa('2026-11-06T14:30:00-03:00', ahora)).toBe('hace 30 min');
      expect(fechaRelativa('2026-11-06T12:00:00-03:00', ahora)).toBe('hace 3 horas');
      expect(fechaRelativa('2026-11-04T15:00:00-03:00', ahora)).toBe('hace 2 días');
    });

    it('la fecha exacta se muestra en zona de Santiago para el atributo title', () => {
      expect(fechaExacta('2026-11-06T14:00:00-03:00')).toMatch(/06\D11\D2026/);
    });
  });
});
