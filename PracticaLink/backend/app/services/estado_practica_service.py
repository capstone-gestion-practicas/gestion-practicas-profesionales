from sqlalchemy import text
from sqlalchemy.orm import Session

from app.schemas.practica import ActualizarEstadoPracticaRequest


class PracticaEstadoNoEncontradaError(Exception):
    pass


class EstadoPracticaNoDisponibleError(Exception):
    pass


class PracticaNoObservadaError(Exception):
    pass


def obtener_practica_estudiante(db: Session, id_usuario: int) -> dict | None:
    return db.execute(text("""
        SELECT public.fn_practica_estudiante(:id_usuario)
    """), {"id_usuario": id_usuario}).scalar_one_or_none()


def listar_estados_activos(db: Session) -> list[dict]:
    return db.execute(text("""
        SELECT public.fn_listar_estados_activos()
    """)).scalar_one()


def listar_practicas_para_gestion(db: Session) -> list[dict]:
    return db.execute(text("""
        SELECT public.fn_listar_practicas_gestion()
    """)).scalar_one()


def obtener_estado_actual(
    db: Session,
    id_practica: int,
    id_usuario: int,
    puede_gestionar: bool,
) -> dict | None:
    return db.execute(text("""
        SELECT public.fn_consultar_estado_practica(
            :id_practica, :id_usuario, :puede_gestionar
        )
    """), {
        "id_practica": id_practica,
        "id_usuario": id_usuario,
        "puede_gestionar": puede_gestionar,
    }).scalar_one_or_none()


def obtener_historial_estados(
    db: Session,
    id_practica: int,
    id_usuario: int,
    puede_gestionar: bool,
) -> list[dict] | None:
    historial = db.execute(text("""
        SELECT public.fn_consultar_historial_estados(
            :id_practica, :id_usuario, :puede_gestionar
        )
    """), {
        "id_practica": id_practica,
        "id_usuario": id_usuario,
        "puede_gestionar": puede_gestionar,
    }).scalar_one_or_none()
    return historial


def actualizar_estado_practica(
    db: Session,
    id_practica: int,
    id_usuario: int,
    datos: ActualizarEstadoPracticaRequest,
) -> dict:
    resultado = db.execute(text("""
        SELECT public.fn_actualizar_estado_practica(
            :id_practica, :id_usuario, :id_estado, :observacion
        )
    """), {
        "id_practica": id_practica,
        "id_usuario": id_usuario,
        "id_estado": datos.id_estado,
        "observacion": datos.observacion,
    }).scalar_one()
    error = resultado.get("error")
    if error == "PRACTICA_NO_ENCONTRADA":
        raise PracticaEstadoNoEncontradaError
    if error == "ESTADO_NO_DISPONIBLE":
        raise EstadoPracticaNoDisponibleError
    db.commit()
    return resultado


def responder_observacion_practica(
    db: Session,
    id_practica: int,
    id_usuario: int,
    respuesta: str,
) -> dict:
    resultado = db.execute(text("""
        SELECT public.fn_responder_observacion_practica(
            :id_practica, :id_usuario, :respuesta
        )
    """), {
        "id_practica": id_practica,
        "id_usuario": id_usuario,
        "respuesta": respuesta,
    }).scalar_one()
    error = resultado.get("error")
    if error == "PRACTICA_NO_ENCONTRADA":
        raise PracticaEstadoNoEncontradaError
    if error == "PRACTICA_NO_OBSERVADA":
        raise PracticaNoObservadaError
    if error == "ESTADO_REVISION_NO_DISPONIBLE":
        raise EstadoPracticaNoDisponibleError
    db.commit()
    return resultado
