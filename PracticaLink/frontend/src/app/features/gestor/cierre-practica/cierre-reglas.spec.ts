import { ContextoUsuarioResponse } from '../../../core/models/auth.models';
import { EstadoAcademico } from '../../evaluaciones/evaluacion.service';
import {
  PracticaCandidataCierre,
  esCandidataCierre,
  fechaTerminoCumplida,
  mensajeAprobacionAcademica,
  mensajeErrorConsultaAcademica
} from './cierre-reglas';

/** Fecha fija local (15 de marzo de 2026, 10:00 hora del navegador): pruebas deterministas. */
const HOY = new Date(2026, 2, 15, 10, 0, 0);

const contextoCon = (roles: string[], idUsuario = 1): ContextoUsuarioResponse => ({
  usuario: { id_usuario: idUsuario, nombre: 'Cuenta', apellido: 'Sintética', correo: 'cuenta@example.test' },
  roles, perfil: null, practica_actual: null
});

const practica = (cambios: Partial<PracticaCandidataCierre> = {}): PracticaCandidataCierre => ({
  estado: 'EN_CURSO', fecha_termino: '2026-03-01', id_gestor: 1, ...cambios
});

const aprobado = (cambios: Partial<EstadoAcademico> = {}): EstadoAcademico => ({
  id_practica: 7, id_documento: 9, version: 2, estado_informe: 'ENTREGADO', evaluacion_pendiente: null,
  resultado_vigente: {
    id_evaluacion: 'uuid-sintetico', id_practica: 7, id_documento: 9, version: 2, id_docente: 20,
    estado: 'RESUELTA', resultado: 'APROBADO', observaciones: null, motivo: null,
    inicio: '2026-03-10T12:00:00Z', termino: '2026-03-10T13:00:00Z'
  },
  ...cambios
});

describe('cierre-reglas', () => {
  describe('fechaTerminoCumplida (fecha local del navegador)', () => {
    it('sin fecha nunca está cumplida', () => {
      expect(fechaTerminoCumplida(null, HOY)).toBeFalse();
      expect(fechaTerminoCumplida('', HOY)).toBeFalse();
    });

    it('incluye el mismo día y excluye el día siguiente', () => {
      expect(fechaTerminoCumplida('2026-03-14', HOY)).toBeTrue();
      expect(fechaTerminoCumplida('2026-03-15', HOY)).toBeTrue();
      expect(fechaTerminoCumplida('2026-03-16', HOY)).toBeFalse();
    });

    it('usa solo los 10 primeros caracteres y rellena mes y día con ceros', () => {
      expect(fechaTerminoCumplida('2026-03-15T23:59:59Z', HOY)).toBeTrue();
      expect(fechaTerminoCumplida('2026-01-05', new Date(2026, 0, 5))).toBeTrue();
      expect(fechaTerminoCumplida('2026-01-06', new Date(2026, 0, 5))).toBeFalse();
    });

    it('documenta el riesgo conocido: decide con el día local, no con el de Chile', () => {
      // 23:30 del día 15 en el navegador: el término del 16 aún no se cumple localmente,
      // aunque en otra zona horaria ya pudiera ser 16. El servidor decide con America/Santiago.
      expect(fechaTerminoCumplida('2026-03-16', new Date(2026, 2, 15, 23, 30))).toBeFalse();
      expect(fechaTerminoCumplida('2026-03-16', new Date(2026, 2, 16, 0, 5))).toBeTrue();
    });

    it('usa la fecha actual por defecto', () => {
      expect(fechaTerminoCumplida('2000-01-01')).toBeTrue();
      expect(fechaTerminoCumplida('2999-01-01')).toBeFalse();
    });
  });

  describe('esCandidataCierre', () => {
    it('es candidata con GESTOR responsable, EN_CURSO y término cumplido', () => {
      expect(esCandidataCierre(practica(), contextoCon(['GESTOR']), HOY)).toBeTrue();
      expect(esCandidataCierre(practica({ fecha_termino: '2026-03-15' }), contextoCon(['GESTOR']), HOY)).toBeTrue();
    });

    it('rechaza cada condición incumplida por separado', () => {
      const gestor = contextoCon(['GESTOR']);
      const casos: [string, PracticaCandidataCierre][] = [
        ['término futuro', practica({ fecha_termino: '2026-03-16' })],
        ['sin término', practica({ fecha_termino: null })],
        ['APROBADA', practica({ estado: 'APROBADA' })],
        ['FINALIZADA', practica({ estado: 'FINALIZADA' })],
        ['RECHAZADA', practica({ estado: 'RECHAZADA' })],
        ['estado en minúsculas', practica({ estado: 'en_curso' })],
        ['sin gestor', practica({ id_gestor: null })],
        ['gestor ajeno', practica({ id_gestor: 2 })]
      ];
      for (const [caso, datos] of casos) {
        expect(esCandidataCierre(datos, gestor, HOY)).withContext(caso).toBeFalse();
      }
    });

    it('exige el rol GESTOR exacto; ADMINISTRADOR no basta', () => {
      for (const roles of [['ADMINISTRADOR'], ['DOCENTE'], ['ESTUDIANTE'], ['gestor'], []]) {
        expect(esCandidataCierre(practica(), contextoCon(roles), HOY)).withContext(roles.join()).toBeFalse();
      }
      expect(esCandidataCierre(practica(), null, HOY)).toBeFalse();
      expect(esCandidataCierre(practica(), undefined, HOY)).toBeFalse();
    });

    it('GESTOR + ADMINISTRADOR es candidato solo como gestor responsable', () => {
      expect(esCandidataCierre(practica(), contextoCon(['GESTOR', 'ADMINISTRADOR']), HOY)).toBeTrue();
      expect(esCandidataCierre(practica({ id_gestor: 2 }), contextoCon(['GESTOR', 'ADMINISTRADOR']), HOY)).toBeFalse();
    });
  });

  describe('mensajeAprobacionAcademica', () => {
    it('prioriza la consulta en curso', () => {
      expect(mensajeAprobacionAcademica(true, aprobado())).toBe('Consultando aprobación académica…');
    });

    it('pide consultar si no hay estado', () => {
      expect(mensajeAprobacionAcademica(false, undefined)).toBe('Consulta la evaluación antes de cerrar.');
      expect(mensajeAprobacionAcademica(false, null)).toBe('Consulta la evaluación antes de cerrar.');
    });

    it('informa la versión vigente aprobada', () => {
      expect(mensajeAprobacionAcademica(false, aprobado())).toBe(
        'Aprobación académica vigente de la versión 2. El servidor verificará las demás condiciones de cierre.');
    });

    it('sin aprobación vigente (otra versión, pendiente o no entregado) impide cerrar', () => {
      const sin = 'Sin aprobación académica vigente: no se puede cerrar la práctica.';
      expect(mensajeAprobacionAcademica(false, aprobado({ version: 3 }))).toBe(sin);
      expect(mensajeAprobacionAcademica(false, aprobado({ estado_informe: 'EN_EVALUACION' }))).toBe(sin);
      expect(mensajeAprobacionAcademica(false, aprobado({ resultado_vigente: null }))).toBe(sin);
    });
  });

  describe('mensajeErrorConsultaAcademica', () => {
    it('401, 403 y 404 indican falta de acceso', () => {
      for (const status of [401, 403, 404]) {
        expect(mensajeErrorConsultaAcademica(status)).withContext(String(status))
          .toBe('Sin acceso a la evaluación. Revisa tu sesión y asignación.');
      }
    });

    it('otros códigos piden actualizar antes de cerrar', () => {
      for (const status of [0, 409, 500, 503]) {
        expect(mensajeErrorConsultaAcademica(status)).withContext(String(status))
          .toBe('No se pudo verificar la aprobación. Actualiza antes de cerrar.');
      }
    });
  });
});
