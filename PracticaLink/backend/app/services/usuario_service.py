import json

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.schemas.usuario import UsuarioActualizarRequest, UsuarioCrearRequest


class UsuarioDuplicadoError(Exception):
    pass


class RolesInvalidosError(Exception):
    pass


class UsuarioNoEncontradoError(Exception):
    pass


class AutogestionNoPermitidaError(Exception):
    pass


def listar_usuarios(db: Session) -> list[dict]:
    return db.execute(text("""
        SELECT public.fn_listar_usuarios()
    """)).scalar_one()


def listar_roles(db: Session) -> list[dict]:
    return db.execute(text("""
        SELECT public.fn_listar_roles()
    """)).scalar_one()


def crear_usuario(db: Session, id_admin: int, datos: UsuarioCrearRequest) -> dict:
    campos = datos.model_dump(mode="json", exclude={"password"})
    resultado = db.execute(text("""
        SELECT public.fn_crear_usuario_admin(
            :id_admin, CAST(:datos AS JSONB), :password_hash
        )
    """), {
        "id_admin": id_admin,
        "datos": json.dumps(campos, ensure_ascii=False),
        "password_hash": hash_password(datos.password),
    }).scalar_one()
    _validar_resultado_admin(resultado)
    db.commit()
    return resultado


def actualizar_usuario(
    db: Session, id_admin: int, id_usuario: int, datos: UsuarioActualizarRequest
) -> dict:
    resultado = db.execute(text("""
        SELECT public.fn_actualizar_usuario_admin(
            :id_admin, :id_usuario, CAST(:datos AS JSONB)
        )
    """), {
        "id_admin": id_admin,
        "id_usuario": id_usuario,
        "datos": json.dumps(datos.model_dump(mode="json"), ensure_ascii=False),
    }).scalar_one()
    _validar_resultado_admin(resultado)
    db.commit()
    return resultado


def _validar_resultado_admin(resultado: dict) -> None:
    error = resultado.get("error")
    if error == "CORREO_EXISTENTE":
        raise UsuarioDuplicadoError
    if error == "ROLES_INVALIDOS":
        raise RolesInvalidosError
    if error == "USUARIO_NO_ENCONTRADO":
        raise UsuarioNoEncontradoError
    if error == "AUTOGESTION_NO_PERMITIDA":
        raise AutogestionNoPermitidaError
