import json

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.schemas.practica import PracticaCreate
from app.services.push_service import enviar_push_notificacion


class PerfilEstudianteNoEncontradoError(Exception):
    pass


class PracticaActivaError(Exception):
    pass


class EstadoInicialNoEncontradoError(Exception):
    pass


def registrar_practica(
    db: Session,
    id_usuario: int,
    datos: PracticaCreate,
) -> dict:
    resultado = db.execute(text("""
        SELECT public.fn_registrar_practica(
            :id_usuario, CAST(:datos AS JSONB)
        )
    """), {
        "id_usuario": id_usuario,
        "datos": json.dumps(datos.model_dump(mode="json"), ensure_ascii=False),
    }).scalar_one()
    error = resultado.get("error")
    if error == "PERFIL_ESTUDIANTE_NO_ENCONTRADO":
        raise PerfilEstudianteNoEncontradoError
    if error == "PRACTICA_ACTIVA":
        raise PracticaActivaError
    if error == "ESTADO_INICIAL_NO_ENCONTRADO":
        raise EstadoInicialNoEncontradoError
    db.commit()
    # Newly registered practices notify active managers and administrators.
    try:
        ids = db.execute(text("""
            SELECT n.id_notificacion, n.id_usuario
            FROM public.notificacion n
            WHERE n.id_practica = :practica AND n.tipo = 'NUEVA_PRACTICA'
            ORDER BY n.id_notificacion DESC
        """), {"practica": resultado.get("id_practica")}).all()
        for id_notificacion, id_destinatario in ids:
            enviar_push_notificacion(db, id_notificacion, id_destinatario)
    except Exception:
        # Push is best effort and cannot roll back the successfully registered practice.
        pass
    return resultado
