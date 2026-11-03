from sqlalchemy import text
from sqlalchemy.orm import Session

from app.schemas.seguimiento import SeguimientoCreate


class PracticaSeguimientoNoDisponibleError(Exception):
    pass


class PracticaSeguimientoNoEncontradaError(Exception):
    """La práctica no existe (EP07 2B.2): 404, sin escritura."""
    pass


class AccesoSeguimientoNoPermitidoError(Exception):
    """Usuario sin rol activo o GESTOR que no tiene asignada la práctica (EP07 2B.2)."""
    pass


class SeguimientoOperacionError(Exception):
    """Resultado no reconocido o inválido: nunca se confirma como éxito."""
    pass


def registrar_seguimiento(
    db: Session,
    id_practica: int,
    id_usuario: int,
    datos: SeguimientoCreate,
) -> dict:
    resultado = db.execute(text("""
        SELECT public.fn_registrar_seguimiento(
            :id_practica, :id_usuario, :fecha, :observacion
        )
    """), {
        "id_practica": id_practica,
        "id_usuario": id_usuario,
        "fecha": datos.fecha,
        "observacion": datos.observacion,
    }).scalar_one()
    if not isinstance(resultado, dict):
        raise SeguimientoOperacionError
    error = resultado.get("error")
    if error == "PRACTICA_NO_ENCONTRADA":
        raise PracticaSeguimientoNoEncontradaError
    if error == "PRACTICA_NO_DISPONIBLE":
        raise PracticaSeguimientoNoDisponibleError
    if error == "USUARIO_NO_AUTORIZADO":
        raise AccesoSeguimientoNoPermitidoError
    if error is not None:
        raise SeguimientoOperacionError
    db.commit()
    return resultado


def listar_seguimientos(db: Session, id_practica: int) -> list[dict]:
    return db.execute(text("""
        SELECT public.fn_listar_seguimientos(:id_practica)
    """), {"id_practica": id_practica}).scalar_one()
