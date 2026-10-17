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
    roles = _obtener_roles_validos(db, datos.roles)
    if len(roles) != len(set(datos.roles)):
        raise RolesInvalidosError
    if db.execute(text("SELECT 1 FROM usuario WHERE LOWER(correo) = :correo"), {"correo": str(datos.correo).lower()}).first():
        raise UsuarioDuplicadoError
    usuario = db.execute(text("""
        INSERT INTO usuario (nombre, apellido, correo, password_hash)
        VALUES (:nombre, :apellido, :correo, :password_hash)
        RETURNING id_usuario
    """), {"nombre": datos.nombre.strip(), "apellido": datos.apellido.strip(),
           "correo": str(datos.correo).lower(), "password_hash": hash_password(datos.password)}).scalar_one()
    db.execute(text("""
        INSERT INTO usuario_rol (id_usuario, id_rol)
        SELECT :id_usuario, id_rol FROM rol WHERE nombre = ANY(:roles) AND activo = TRUE
    """), {"id_usuario": usuario, "roles": list(datos.roles)})
    db.commit()
    return {"id_usuario": usuario, "mensaje": "Usuario creado correctamente"}


def actualizar_usuario(
    db: Session, id_admin: int, id_usuario: int, datos: UsuarioActualizarRequest
) -> dict:
    usuario = db.execute(text("SELECT id_usuario FROM usuario WHERE id_usuario = :id_usuario FOR UPDATE"), {"id_usuario": id_usuario}).scalar_one_or_none()
    if usuario is None:
        raise UsuarioNoEncontradoError
    roles = _obtener_roles_validos(db, datos.roles)
    if len(roles) != len(set(datos.roles)):
        raise RolesInvalidosError
    if id_admin == id_usuario and (not datos.activo or "ADMINISTRADOR" not in datos.roles):
        raise AutogestionNoPermitidaError
    db.execute(text("""
        UPDATE usuario SET nombre = :nombre, apellido = :apellido,
            activo = :activo, fecha_actualizacion = NOW()
        WHERE id_usuario = :id_usuario
    """), {"nombre": datos.nombre.strip(), "apellido": datos.apellido.strip(), "activo": datos.activo, "id_usuario": id_usuario})
    db.execute(text("DELETE FROM usuario_rol WHERE id_usuario = :id_usuario"), {"id_usuario": id_usuario})
    db.execute(text("""
        INSERT INTO usuario_rol (id_usuario, id_rol)
        SELECT :id_usuario, id_rol FROM rol WHERE nombre = ANY(:roles) AND activo = TRUE
    """), {"id_usuario": id_usuario, "roles": list(datos.roles)})
    db.commit()
    return {"id_usuario": id_usuario, "mensaje": "Usuario actualizado correctamente"}


def _obtener_roles_validos(db: Session, roles: list[str]) -> list[str]:
    return list(db.execute(text("""
        SELECT nombre FROM rol WHERE activo = TRUE AND nombre = ANY(:roles)
    """), {"roles": roles}).scalars().all())
