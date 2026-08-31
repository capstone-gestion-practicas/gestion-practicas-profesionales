from sqlalchemy import text
from sqlalchemy.orm import Session

from app.schemas.estudiante import PerfilEstudianteCreate


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
    resultado = db.execute(
        text("""
            SELECT fn_completar_perfil_estudiante(
                :id_usuario,
                CAST(:datos AS JSONB)
            )
        """),
        {
            "id_usuario": id_usuario,
            "datos": datos.model_dump_json(),
        },
    ).scalar_one()

    error = resultado.get("error")
    if error == "PERFIL_EXISTENTE":
        raise PerfilEstudianteExistenteError
    if error == "USUARIO_ESTUDIANTE_NO_VALIDO":
        raise UsuarioEstudianteNoValidoError
    if error == "RUT_EXISTENTE":
        raise RutEstudianteExistenteError

    db.commit()
    return resultado
