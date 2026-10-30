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
