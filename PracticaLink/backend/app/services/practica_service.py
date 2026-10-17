import json

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.schemas.practica import PracticaCreate


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
    return resultado
