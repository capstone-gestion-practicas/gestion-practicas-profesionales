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
    filas = db.execute(text("""
        SELECT u.id_usuario, u.nombre, u.apellido, u.correo, u.activo,
               COALESCE(array_agg(r.nombre ORDER BY r.nombre)
                   FILTER (WHERE r.id_rol IS NOT NULL), ARRAY[]::VARCHAR[]) AS roles
        FROM usuario u
        LEFT JOIN usuario_rol ur ON ur.id_usuario = u.id_usuario
        LEFT JOIN rol r ON r.id_rol = ur.id_rol
        GROUP BY u.id_usuario
        ORDER BY u.apellido, u.nombre
    """)).mappings().all()
    return [dict(fila) for fila in filas]


def listar_roles(db: Session) -> list[dict]:
    return [dict(fila) for fila in db.execute(text("""
        SELECT id_rol, nombre, descripcion
        FROM rol WHERE activo = TRUE ORDER BY nombre
    """)).mappings().all()]


def crear_usuario(db: Session, id_admin: int, datos: UsuarioCrearRequest) -> dict:
    resultado = db.execute(text("""
        SELECT fn_crear_usuario_admin(
            :id_admin, CAST(:datos AS JSONB), :password_hash
        )
    """), {
        "id_admin": id_admin,
        "datos": json.dumps(datos.model_dump(exclude={"password"}), default=str),
        "password_hash": hash_password(datos.password),
    }).scalar_one()
    _validar_resultado(resultado)
    db.commit()
    return resultado


def actualizar_usuario(
    db: Session, id_admin: int, id_usuario: int, datos: UsuarioActualizarRequest
) -> dict:
    resultado = db.execute(text("""
        SELECT fn_actualizar_usuario_admin(
            :id_admin, :id_usuario, CAST(:datos AS JSONB)
        )
    """), {
        "id_admin": id_admin,
        "id_usuario": id_usuario,
        "datos": datos.model_dump_json(),
    }).scalar_one()
    _validar_resultado(resultado)
    db.commit()
    return resultado


def _validar_resultado(resultado: dict) -> None:
    error = resultado.get("error")
    if error == "CORREO_EXISTENTE":
        raise UsuarioDuplicadoError
    if error in {"ROLES_INVALIDOS", "SIN_ROLES"}:
        raise RolesInvalidosError
    if error == "USUARIO_NO_ENCONTRADO":
        raise UsuarioNoEncontradoError
    if error == "AUTOGESTION_NO_PERMITIDA":
        raise AutogestionNoPermitidaError
