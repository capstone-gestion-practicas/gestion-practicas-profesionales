from sqlalchemy import text
from sqlalchemy.orm import Session

from app.schemas.incidencia import IncidenciaCreate


class PracticaIncidenciaNoDisponibleError(Exception):
    pass


class IncidenciaNoEncontradaError(Exception):
    pass


def registrar_incidencia(
    db: Session,
    id_practica: int,
    id_usuario: int,
    datos: IncidenciaCreate,
) -> dict:
    resultado = db.execute(text("""
        SELECT public.fn_registrar_incidencia(
            :id_practica, :id_usuario, :fecha, :descripcion, :prioridad
        )
    """), {
        "id_practica": id_practica,
        "id_usuario": id_usuario,
        "fecha": datos.fecha,
        "descripcion": datos.descripcion,
        "prioridad": datos.prioridad,
    }).scalar_one()
    if resultado.get("error") == "PRACTICA_NO_DISPONIBLE":
        raise PracticaIncidenciaNoDisponibleError
    db.commit()
    return resultado


def listar_incidencias(db: Session) -> list[dict]:
    return db.execute(text("SELECT public.fn_listar_incidencias()")).scalar_one()


def actualizar_estado_incidencia(db: Session, id_incidencia: int, estado: str) -> dict:
    resultado = db.execute(text("""
        SELECT public.fn_actualizar_estado_incidencia(:id_incidencia, :estado)
    """), {"id_incidencia": id_incidencia, "estado": estado}).scalar_one()
    if resultado.get("error") == "INCIDENCIA_NO_ENCONTRADA":
        raise IncidenciaNoEncontradaError
    db.commit()
    return resultado
