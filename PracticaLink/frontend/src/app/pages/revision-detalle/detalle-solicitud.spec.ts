import {
  LONGITUD_MAXIMA_OBSERVACION,
  NO_INFORMADO,
  esRevisable,
  fechaCorta,
  horasTexto,
  jornadaTexto,
  motivoSinDecision,
  requiereObservacion,
  tituloDecision,
  valorOInformado
} from './detalle-solicitud';

describe('detalle-solicitud', () => {
  describe('disponibilidad de decisiones por estado', () => {
    it('admite decisiones en REGISTRADA, EN_REVISION y OBSERVADA', () => {
      for (const estado of ['REGISTRADA', 'EN_REVISION', 'OBSERVADA']) {
        expect(esRevisable(estado)).toBeTrue();
        expect(motivoSinDecision(estado)).toBeNull();
      }
    });

    it('explica por qué no admite decisiones en APROBADA, RECHAZADA, EN_CURSO y FINALIZADA', () => {
      for (const estado of ['APROBADA', 'RECHAZADA', 'EN_CURSO', 'FINALIZADA']) {
        expect(esRevisable(estado)).toBeFalse();
        expect(motivoSinDecision(estado)).toEqual(jasmine.any(String));
      }
    });

    it('un estado desconocido no admite decisiones y lo dice', () => {
      expect(esRevisable('OTRO')).toBeFalse();
      expect(motivoSinDecision('OTRO')).toContain('no permite registrar decisiones');
    });

    it('compara sin distinguir mayúsculas ni espacios', () => {
      expect(esRevisable('  observada ')).toBeTrue();
    });
  });

  describe('observación', () => {
    it('Observar y Rechazar la exigen; Aprobar no', () => {
      expect(requiereObservacion('OBSERVADA')).toBeTrue();
      expect(requiereObservacion('RECHAZADA')).toBeTrue();
      expect(requiereObservacion('APROBADA')).toBeFalse();
    });

    it('el límite coincide con la pantalla', () => {
      expect(LONGITUD_MAXIMA_OBSERVACION).toBe(500);
    });

    it('títulos de decisión en lenguaje del gestor', () => {
      expect(tituloDecision('APROBADA')).toBe('Aprobar la solicitud');
      expect(tituloDecision('OBSERVADA')).toBe('Observar la solicitud');
      expect(tituloDecision('RECHAZADA')).toBe('Rechazar la solicitud');
    });
  });

  describe('formato de datos', () => {
    it('convierte fechas ISO a dd/mm/aaaa sin desplazar el día', () => {
      expect(fechaCorta('2026-03-02')).toBe('02/03/2026');
      expect(fechaCorta('2026-10-12T23:30:00')).toBe('12/10/2026');
    });

    it('fechas vacías o no válidas quedan como no informadas', () => {
      expect(fechaCorta(null)).toBe(NO_INFORMADO);
      expect(fechaCorta('')).toBe(NO_INFORMADO);
      expect(fechaCorta('no-es-fecha')).toBe(NO_INFORMADO);
    });

    it('texto vacío o solo espacios no inventa contenido', () => {
      expect(valorOInformado('   ')).toBe(NO_INFORMADO);
      expect(valorOInformado(null)).toBe(NO_INFORMADO);
      expect(valorOInformado(' Santiago ')).toBe('Santiago');
    });

    it('horas con unidad y jornada semanal', () => {
      expect(horasTexto(360)).toBe('360 h');
      expect(horasTexto(0)).toBe('0 h');
      expect(horasTexto(null)).toBe(NO_INFORMADO);
      expect(jornadaTexto(20)).toBe('20 h/semana');
      expect(jornadaTexto(undefined)).toBe(NO_INFORMADO);
    });
  });
});
