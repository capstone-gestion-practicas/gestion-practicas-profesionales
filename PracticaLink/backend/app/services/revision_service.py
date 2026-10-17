from sqlalchemy import text
from sqlalchemy.orm import Session

from app.schemas.revision import DecisionRevisionRequest


class SolicitudNoEncontradaError(Exception):
    pass


class SolicitudNoRevisableError(Exception):
    pass


def listar_solicitudes(db: Session) -> list[dict]:
    return db.execute(text("""
        SELECT public.fn_listar_solicitudes_revision()
    """)).scalar_one()


def obtener_solicitud(db: Session, id_practica: int) -> dict | None:
    return db.execute(text("""
        SELECT public.fn_obtener_solicitud_revision(:id_practica)
    """), {"id_practica": id_practica}).scalar_one_or_none()


def resolver_solicitud(
    db: Session,
    id_practica: int,
    id_usuario: int,
    datos: DecisionRevisionRequest,
) -> dict:
    resultado = db.execute(text("""
        SELECT public.fn_revisar_practica(
            :id_practica, :id_usuario, :decision, :observacion
        )
    """), {
        "id_practica": id_practica,
        "id_usuario": id_usuario,
        "decision": datos.decision,
        "observacion": datos.observacion.strip() if datos.observacion else None,
    }).scalar_one()
    error = resultado.get("error")
    if error == "SOLICITUD_NO_ENCONTRADA":
        raise SolicitudNoEncontradaError
    if error in {"SOLICITUD_NO_REVISABLE", "DECISION_INVALIDA"}:
        raise SolicitudNoRevisableError
    db.commit()
    return resultado
