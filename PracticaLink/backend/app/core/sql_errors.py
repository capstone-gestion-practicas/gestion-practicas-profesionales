"""Safe SQLSTATE translation shared by academic operations; never return DB messages."""
from fastapi import HTTPException


def sql_http_error(error: Exception, unavailable: str) -> HTTPException:
    code = getattr(getattr(error, 'orig', None), 'sqlstate', None)
    status = {
        '22023': 400, '22001': 400, '22003': 400, '22021': 400, '22P02': 400, '23502': 400,
        '42501': 403, 'P0404': 404, 'P0409': 409,
        '23503': 409, '23505': 409, '23514': 409,
        '40P01': 409, '40001': 409, '55P03': 409,
    }.get(code, 503)
    messages = {
        400: 'Datos académicos inválidos; revisa el resultado y las observaciones.',
        403: 'No tienes autorización académica para esta operación.',
        404: 'La práctica o evaluación no está disponible.',
        409: 'El estado, la asignación o la versión cambió. Actualiza y reintenta con la misma clave si corresponde.',
        503: unavailable,
    }
    return HTTPException(status, messages[status])
