from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.seguimientos.schemas import SeguimientoCreate, SeguimientoCreateResponse


class RegistroSeguimientoError(Exception):
    def __init__(self, codigo: str):
        self.codigo = codigo


def registrar_seguimiento(
    db: Session, id_practica: int, id_usuario: int, datos: SeguimientoCreate,
) -> SeguimientoCreateResponse:
    try:
        resultado = db.execute(text('''
            SELECT seguimientos_privados.fn_registrar_seguimiento(
                :id_practica, :id_usuario, CAST(:fecha AS DATE), :tipo, :observacion
            )
        '''), {
            'id_practica': id_practica, 'id_usuario': id_usuario,
            'fecha': datos.fecha, 'tipo': datos.tipo, 'observacion': datos.observacion,
        }).scalar_one()
        if isinstance(resultado, dict) and 'error' in resultado:
            # No permitir que una respuesta malformada se use como clave HTTP.
            codigo = resultado['error']
            raise RegistroSeguimientoError(codigo if isinstance(codigo, str) else 'FALLO_INESPERADO')
        respuesta = SeguimientoCreateResponse.model_validate(resultado)
        if (respuesta.id_practica != id_practica or respuesta.id_usuario != id_usuario
                or respuesta.fecha != datos.fecha or respuesta.tipo != datos.tipo
                or respuesta.observacion != datos.observacion):
            raise RegistroSeguimientoError('FALLO_INESPERADO')
        db.commit()
        return respuesta
    except Exception as error:
        try:
            db.rollback()
        except SQLAlchemyError:
            pass  # Mantener el error original sin exponer detalles de limpieza.
        if isinstance(error, RegistroSeguimientoError):
            raise
        if isinstance(error, DBAPIError):
            codigo_sql = getattr(error.orig, 'sqlstate', None)
            if error.connection_invalidated or (isinstance(codigo_sql, str) and codigo_sql.startswith('08')):
                raise RegistroSeguimientoError('CONEXION_NO_DISPONIBLE') from None
            if codigo_sql in ('40001', '40P01', '55P03'):
                raise RegistroSeguimientoError('CONFLICTO_CONCURRENTE') from None
        raise RegistroSeguimientoError('FALLO_INESPERADO') from None


class ConsultaSeguimientosError(Exception):
    def __init__(self, codigo: str):
        self.codigo = codigo


def consultar_seguimientos(db: Session, id_practica: int, id_usuario: int,
                           limit: int, offset: int):
    from app.seguimientos.schemas import SeguimientosHistorialResponse

    try:
        resultado = db.execute(text('''
            SELECT seguimientos_privados.fn_consultar_seguimientos(
                :id_practica, :id_usuario, CAST(:limit AS INTEGER), CAST(:offset AS BIGINT)
            )
        '''), {'id_practica': id_practica, 'id_usuario': id_usuario,
               'limit': limit, 'offset': offset}).scalar_one()
        if isinstance(resultado, dict) and 'error' in resultado:
            codigo = resultado['error']
            if set(resultado) != {'error'} or not isinstance(codigo, str):
                codigo = 'FALLO_INESPERADO'
            raise ConsultaSeguimientosError(codigo)
        respuesta = SeguimientosHistorialResponse.model_validate(resultado)
        if (respuesta.id_practica != id_practica or respuesta.limit != limit
                or respuesta.offset != offset or len(respuesta.items) > limit
                or (respuesta.hay_mas and len(respuesta.items) != limit)):
            raise ConsultaSeguimientosError('FALLO_INESPERADO')
        return respuesta  # Sin commit; el cierre de sesión termina la lectura.
    except Exception as error:
        try:
            db.rollback()
        except SQLAlchemyError:
            pass
        if isinstance(error, ConsultaSeguimientosError):
            raise
        if isinstance(error, DBAPIError):
            code = getattr(error.orig, 'sqlstate', None)
            if error.connection_invalidated or (isinstance(code, str) and code.startswith('08')):
                raise ConsultaSeguimientosError('CONEXION_NO_DISPONIBLE') from None
        raise ConsultaSeguimientosError('FALLO_INESPERADO') from None
