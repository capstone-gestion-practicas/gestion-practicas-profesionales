import json

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.estudiantes.schemas import PerfilEstudianteCreate


class PerfilEstudianteExistenteError(Exception):
    pass


class UsuarioEstudianteNoValidoError(Exception):
    pass


class RutEstudianteExistenteError(Exception):
    pass


def completar_perfil_estudiante(
    db: Session,
    id_usuario: int,
    datos: PerfilEstudianteCreate,
) -> dict:
    resultado = db.execute(text("""
        SELECT public.fn_completar_perfil_estudiante(
            :id_usuario, CAST(:datos AS JSONB)
        )
    """), {
        "id_usuario": id_usuario,
        "datos": json.dumps(datos.model_dump(mode="json"), ensure_ascii=False),
    }).scalar_one()
    error = resultado.get("error")
    if error == "USUARIO_ESTUDIANTE_NO_VALIDO":
        raise UsuarioEstudianteNoValidoError
    if error == "PERFIL_EXISTENTE":
        raise PerfilEstudianteExistenteError
    if error == "RUT_EXISTENTE":
        raise RutEstudianteExistenteError
    db.commit()
    return resultado
