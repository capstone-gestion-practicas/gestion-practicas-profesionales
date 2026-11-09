from uuid import UUID
from pydantic import TypeAdapter
from sqlalchemy import text
from sqlalchemy.orm import Session
from app.core.sql_errors import sql_http_error
from app.evaluaciones.schemas import (
    ConsultaAcademicaResponse, EvaluacionResponse, HistorialEvaluacionResponse,
    IniciarEvaluacionRequest, ResolverEvaluacionRequest,
)

_INICIO = text('''SELECT informes_privados.iniciar_evaluacion(
    :p, :a, CAST(:k AS uuid), :d, :v)''')
_RESOLUCION = text('''SELECT informes_privados.resolver_evaluacion(
    :p, :a, CAST(:k AS uuid), CAST(:eid AS uuid), :res, :obs)''')
_HISTORIAL = text('SELECT informes_privados.historial_evaluacion(:p, :a)')
_ACTUAL = text('SELECT informes_privados.consultar(:p, :a)')


class Evaluaciones:
    def __init__(self, db: Session):
        self.db = db

    def _fallo(self, error: Exception):
        try:
            self.db.rollback()
        except Exception:
            pass
        return sql_http_error(error, 'No fue posible completar la operación de evaluación.')

    def _mutar(self, statement, params: dict) -> EvaluacionResponse:
        try:
            raw = self.db.execute(statement, params).scalar_one()
            result = EvaluacionResponse.model_validate(raw)
            if (result.id_practica != params['p']
                    or result.id_docente != params['a']
                    or str(result.id_evaluacion) != params.get('eid', params['k'])):
                raise ValueError('Respuesta académica incoherente')
            if 'd' in params and (result.id_documento != params['d'] or result.version != params['v']):
                raise ValueError('Versión de inicio incoherente')
            if 'res' in params and (result.estado != 'RESUELTA' or result.resultado != params['res'] or result.observaciones != params['obs']):
                raise ValueError('Resultado de resolución incoherente')
            # SQL owns events/notifications/idempotency; the API commits once only.
            self.db.commit()
            return result
        except Exception as error:
            raise self._fallo(error) from None

    def iniciar(self, practica: int, actor: int, key: UUID, datos: IniciarEvaluacionRequest):
        return self._mutar(_INICIO, {'p': practica, 'a': actor, 'k': str(key),
                                    'd': datos.id_documento, 'v': datos.version})

    def resolver(self, practica: int, actor: int, key: UUID, evaluacion: UUID, datos: ResolverEvaluacionRequest):
        return self._mutar(_RESOLUCION, {'p': practica, 'a': actor, 'k': str(key),
            'eid': str(evaluacion), 'res': datos.resultado, 'obs': datos.observaciones})

    def consultar(self, practica: int, actor: int) -> ConsultaAcademicaResponse:
        try:
            params = {'p': practica, 'a': actor}
            # Both SQL functions share a session/transaction and the S4.3 practice gate.
            actual = self.db.execute(_ACTUAL, params).scalar_one()
            raw = self.db.execute(_HISTORIAL, params).scalar_one()
            historial = TypeAdapter(list[HistorialEvaluacionResponse]).validate_python(raw)
            if actual['id_practica'] != practica or any(e.id_practica != practica for e in historial):
                raise ValueError('Práctica incoherente')
            documento, version, estado = actual['id_documento'], actual['version'], actual['estado']
            if ((estado == 'SIN_ENTREGAR' and (documento is not None or version != 0))
                    or (estado != 'SIN_ENTREGAR' and (not isinstance(documento, int) or documento < 1 or version < 1))):
                raise ValueError('Informe incoherente')
            if any(event.id_evaluacion != e.id_evaluacion for e in historial for event in e.eventos):
                raise ValueError('Evento académico incoherente')
            actuales = [e for e in historial if e.id_documento == documento and e.version == version]
            pendientes = [e for e in actuales if e.estado == 'EN_CURSO']
            resueltas = [e for e in actuales if e.estado == 'RESUELTA']
            if len(pendientes) > 1 or len(resueltas) > 1 or (estado == 'EN_EVALUACION') != bool(pendientes):
                raise ValueError('Estado académico incoherente')
            result = ConsultaAcademicaResponse(
                id_practica=practica, id_documento=documento, version=version, estado_informe=estado,
                evaluacion_pendiente=pendientes[0] if pendientes else None,
                resultado_vigente=resueltas[0] if resueltas else None, historial=historial)
            self.db.commit()
            return result
        except Exception as error:
            raise self._fallo(error) from None
