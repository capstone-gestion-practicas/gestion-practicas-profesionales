from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.incidencias.schemas import IncidenciaCreate, IncidenciaCreateResponse


class RegistroIncidenciaError(Exception):
    def __init__(self, codigo: str):
        self.codigo = codigo


def registrar_incidencia(
    db: Session, id_practica: int, id_usuario: int, datos: IncidenciaCreate,
) -> IncidenciaCreateResponse:
    try:
        resultado = db.execute(text('''
            SELECT incidencias_privadas.fn_registrar_incidencia(
                :id_practica, :id_usuario, :tipo, :descripcion
            )
        '''), {
            'id_practica': id_practica, 'id_usuario': id_usuario,
            'tipo': datos.tipo, 'descripcion': datos.descripcion,
        }).scalar_one()
        if isinstance(resultado, dict) and 'error' in resultado:
            # No permitir que una respuesta malformada se use como clave HTTP.
            codigo = resultado['error'] if set(resultado) == {'error'} else None
            raise RegistroIncidenciaError(codigo if isinstance(codigo, str) else 'FALLO_INESPERADO')
        respuesta = IncidenciaCreateResponse.model_validate(resultado)
        if (respuesta.id_practica != id_practica or respuesta.id_usuario != id_usuario
                or respuesta.tipo != datos.tipo
                or respuesta.descripcion != datos.descripcion):
            raise RegistroIncidenciaError('FALLO_INESPERADO')
        db.commit()
        return respuesta
    except Exception as error:
        try:
            db.rollback()
        except SQLAlchemyError:
            pass  # Mantener el error original sin exponer detalles de limpieza.
        if isinstance(error, RegistroIncidenciaError):
            raise
        if isinstance(error, DBAPIError):
            codigo_sql = getattr(error.orig, 'sqlstate', None)
            if error.connection_invalidated or (isinstance(codigo_sql, str) and codigo_sql.startswith('08')):
                raise RegistroIncidenciaError('CONEXION_NO_DISPONIBLE') from None
            if codigo_sql in ('40001', '40P01', '55P03'):
                raise RegistroIncidenciaError('CONFLICTO_CONCURRENTE') from None
        raise RegistroIncidenciaError('FALLO_INESPERADO') from None


class ConsultaIncidenciasError(Exception):
    def __init__(self, codigo: str):
        self.codigo = codigo


def consultar_resumen_incidencias_pendientes(db: Session, id_usuario: int, limit: int, offset: int):
    """HU017: prácticas con incidencias PENDIENTE. Una sola consulta de solo lectura.

    Reutiliza ConsultaIncidenciasError porque los códigos de negocio son los del
    contrato SQL EP06-08 (USUARIO_NO_AUTORIZADO, PAGINACION_INVALIDA).
    """
    from app.incidencias.schemas import ResumenIncidenciasPendientesResponse

    try:
        # Primera sentencia de la sesión nueva: toda la transacción es de solo lectura.
        db.execute(text('SET TRANSACTION READ ONLY'))
        resultado = db.execute(text('''
            SELECT incidencias_privadas.fn_resumen_incidencias_pendientes(
                :id_usuario, CAST(:limit AS INTEGER), CAST(:offset AS BIGINT)
            )
        '''), {'id_usuario': id_usuario, 'limit': limit, 'offset': offset}).scalar_one()
        if isinstance(resultado, dict) and 'error' in resultado:
            codigo = resultado['error']
            if set(resultado) != {'error'} or not isinstance(codigo, str):
                codigo = 'FALLO_INESPERADO'
            raise ConsultaIncidenciasError(codigo)
        respuesta = ResumenIncidenciasPendientesResponse.model_validate(resultado)
        ids = [item.id_practica for item in respuesta.items]
        claves = [(item.fecha_pendiente_antigua, item.id_practica) for item in respuesta.items]
        if (respuesta.limit != limit or respuesta.offset != offset or len(respuesta.items) > limit
                or (respuesta.hay_mas and len(respuesta.items) != limit)
                or len(set(ids)) != len(ids) or claves != sorted(claves)):
            raise ConsultaIncidenciasError('FALLO_INESPERADO')
        return respuesta  # Sin commit: cerrar la sesión termina la transacción.
    except Exception as error:
        try:
            db.rollback()
        except SQLAlchemyError:
            pass
        if isinstance(error, ConsultaIncidenciasError):
            raise
        if isinstance(error, DBAPIError):
            codigo_sql = getattr(error.orig, 'sqlstate', None)
            if error.connection_invalidated or (isinstance(codigo_sql, str) and codigo_sql.startswith('08')):
                raise ConsultaIncidenciasError('CONEXION_NO_DISPONIBLE') from None
        raise ConsultaIncidenciasError('FALLO_INESPERADO') from None


def consultar_incidencias(db: Session, id_practica: int, id_usuario: int,
                         limit: int, offset: int):
    from app.incidencias.schemas import IncidenciasHistorialResponse

    try:
        # Misma conexión restringida HU015, pero solo esta transacción es read-only.
        # Debe ser la primera sentencia: la sesión es nueva por solicitud.
        db.execute(text('SET TRANSACTION READ ONLY'))
        resultado = db.execute(text('''
            SELECT incidencias_privadas.fn_consultar_incidencias(
                :id_practica, :id_usuario, CAST(:limit AS INTEGER), CAST(:offset AS BIGINT)
            )
        '''), {'id_practica': id_practica, 'id_usuario': id_usuario,
               'limit': limit, 'offset': offset}).scalar_one()
        if isinstance(resultado, dict) and 'error' in resultado:
            codigo = resultado['error']
            if set(resultado) != {'error'} or not isinstance(codigo, str):
                codigo = 'FALLO_INESPERADO'
            raise ConsultaIncidenciasError(codigo)
        respuesta = IncidenciasHistorialResponse.model_validate(resultado)
        if (respuesta.id_practica != id_practica or respuesta.limit != limit
                or respuesta.offset != offset or len(respuesta.items) > limit
                or (respuesta.hay_mas and len(respuesta.items) != limit)
                or any(item.id_practica != id_practica for item in respuesta.items)):
            raise ConsultaIncidenciasError('FALLO_INESPERADO')
        return respuesta  # Sin commit: cerrar la sesión termina la transacción.
    except Exception as error:
        try:
            db.rollback()
        except SQLAlchemyError:
            pass
        if isinstance(error, ConsultaIncidenciasError):
            raise
        if isinstance(error, DBAPIError):
            codigo_sql = getattr(error.orig, 'sqlstate', None)
            if error.connection_invalidated or (isinstance(codigo_sql, str) and codigo_sql.startswith('08')):
                raise ConsultaIncidenciasError('CONEXION_NO_DISPONIBLE') from None
        raise ConsultaIncidenciasError('FALLO_INESPERADO') from None


class GestionEstadoIncidenciaError(Exception):
    def __init__(self, codigo: str):
        self.codigo = codigo


def _error_estado(resultado):
    if isinstance(resultado, dict) and 'error' in resultado:
        codigo = resultado['error']
        if set(resultado) != {'error'} or not isinstance(codigo, str):
            codigo = 'FALLO_INESPERADO'
        raise GestionEstadoIncidenciaError(codigo)


def _revertir_estado(db, error, escritura=False):
    try:
        db.rollback()
    except SQLAlchemyError:
        pass
    if isinstance(error, GestionEstadoIncidenciaError):
        raise error
    if isinstance(error, DBAPIError):
        codigo = getattr(error.orig, 'sqlstate', None)
        if error.connection_invalidated or (isinstance(codigo, str) and codigo.startswith('08')):
            raise GestionEstadoIncidenciaError('CONEXION_NO_DISPONIBLE') from None
        if escritura and codigo in ('40001', '40P01', '55P03'):
            raise GestionEstadoIncidenciaError('CONFLICTO_CONCURRENTE') from None
    raise GestionEstadoIncidenciaError('FALLO_INESPERADO') from None


def cambiar_estado_incidencia(db: Session, id_practica: int, id_incidencia: int,
                              id_usuario: int, datos):
    from app.incidencias.schemas import IncidenciaEstadoResponse
    try:
        resultado = db.execute(text("""
            SELECT incidencias_privadas.fn_cambiar_estado_incidencia(
                :id_practica, :id_incidencia, :id_usuario,
                :estado_esperado, :estado_nuevo, :comentario)
        """), {'id_practica': id_practica, 'id_incidencia': id_incidencia,
               'id_usuario': id_usuario, **datos.model_dump()}).scalar_one()
        _error_estado(resultado)
        respuesta = IncidenciaEstadoResponse.model_validate(resultado)
        if (respuesta.id_practica != id_practica or respuesta.id_incidencia != id_incidencia
                or respuesta.id_usuario != id_usuario
                or respuesta.estado_anterior != datos.estado_esperado
                or respuesta.estado_nuevo != datos.estado_nuevo
                or respuesta.comentario != datos.comentario
                or (respuesta.estado_anterior, respuesta.estado_nuevo) not in {
                    ('PENDIENTE', 'EN_ATENCION'), ('PENDIENTE', 'RESUELTA'),
                    ('EN_ATENCION', 'RESUELTA')}):
            raise GestionEstadoIncidenciaError('FALLO_INESPERADO')
        db.commit()
        return respuesta
    except Exception as error:
        _revertir_estado(db, error, escritura=True)


def consultar_historial_incidencia(db: Session, id_practica: int, id_incidencia: int,
                                  id_usuario: int, limit: int, offset: int):
    from app.incidencias.schemas import IncidenciaEstadosHistorialResponse
    try:
        db.execute(text('SET TRANSACTION READ ONLY'))
        resultado = db.execute(text("""
            SELECT incidencias_privadas.fn_consultar_historial_incidencia(
                :id_practica, :id_incidencia, :id_usuario,
                CAST(:limit AS INTEGER), CAST(:offset AS BIGINT))
        """), {'id_practica': id_practica, 'id_incidencia': id_incidencia,
               'id_usuario': id_usuario, 'limit': limit, 'offset': offset}).scalar_one()
        _error_estado(resultado)
        respuesta = IncidenciaEstadosHistorialResponse.model_validate(resultado)
        ids = [item.id_historial for item in respuesta.items]
        if (respuesta.id_practica != id_practica or respuesta.id_incidencia != id_incidencia
                or respuesta.limit != limit or respuesta.offset != offset
                or len(ids) > limit or (respuesta.hay_mas and len(ids) != limit)
                or any(a <= b for a, b in zip(ids, ids[1:]))):
            raise GestionEstadoIncidenciaError('FALLO_INESPERADO')
        return respuesta  # Sin commit; el cierre revierte la transacción de lectura.
    except Exception as error:
        _revertir_estado(db, error)
