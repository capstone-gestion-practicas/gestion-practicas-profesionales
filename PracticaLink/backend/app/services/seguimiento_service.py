from sqlalchemy import text
from sqlalchemy.orm import Session

from app.schemas.seguimiento import SeguimientoCreate


class PracticaSeguimientoNoDisponibleError(Exception):
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
    if resultado.get("error") == "PRACTICA_NO_DISPONIBLE":
        raise PracticaSeguimientoNoDisponibleError
    db.commit()
    return resultado


def listar_seguimientos(db: Session, id_practica: int) -> list[dict]:
    return db.execute(text("""
        SELECT public.fn_listar_seguimientos(:id_practica)
    """), {"id_practica": id_practica}).scalar_one()
