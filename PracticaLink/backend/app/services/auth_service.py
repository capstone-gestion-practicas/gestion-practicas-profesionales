from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.security import (
    create_access_token,
    hash_password,
    verify_password
)


def registrar_usuario(
    db: Session,
    nombre: str,
    apellido: str,
    correo: str,
    password: str
):
    correo_normalizado = correo.strip().lower()
    rol = db.execute(text("""
        SELECT id_rol FROM rol
        WHERE nombre = 'ESTUDIANTE' AND activo = TRUE
    """)).scalar_one_or_none()
    if rol is None:
        raise RuntimeError("El rol ESTUDIANTE no está configurado")
    existente = db.execute(text("""
        SELECT 1 FROM usuario WHERE LOWER(correo) = :correo
    """), {"correo": correo_normalizado}).first()
    if existente:
        db.rollback()
        return None
    usuario = db.execute(text("""
        INSERT INTO usuario (nombre, apellido, correo, password_hash)
        VALUES (:nombre, :apellido, :correo, :password_hash)
        RETURNING id_usuario, nombre, apellido, correo
    """), {
        "nombre": nombre.strip(), "apellido": apellido.strip(),
        "correo": correo_normalizado, "password_hash": hash_password(password),
    }).mappings().one()
    db.execute(text("""
        INSERT INTO usuario_rol (id_usuario, id_rol)
        VALUES (:id_usuario, :id_rol)
    """), {"id_usuario": usuario["id_usuario"], "id_rol": rol})
    db.commit()
    return {**dict(usuario), "rol": "ESTUDIANTE"}


def autenticar_usuario(
    db: Session,
    correo: str,
    password: str
):
    query = text("""
        SELECT
            id_usuario,
            correo,
            password_hash,
            activo
        FROM usuario
        WHERE correo = :correo
        LIMIT 1
    """)

    usuario = db.execute(
        query,
        {"correo": correo.strip().lower()}
    ).mappings().first()

    if usuario is None:
        return None

    if not usuario["activo"]:
        return None

    if not verify_password(password, usuario["password_hash"]):
        return None

    access_token = create_access_token(
        usuario["id_usuario"]
    )

    return {
        "access_token": access_token,
        "token_type": "bearer"
    }


def obtener_contexto_usuario(
    db: Session,
    id_usuario: int
):
    usuario = db.execute(text("""
        SELECT id_usuario, nombre, apellido, correo
        FROM usuario WHERE id_usuario = :id_usuario AND activo = TRUE
    """), {"id_usuario": id_usuario}).mappings().first()
    if usuario is None:
        return None
    roles = list(db.execute(text("""
        SELECT r.nombre FROM usuario_rol ur
        JOIN rol r ON r.id_rol = ur.id_rol
        WHERE ur.id_usuario = :id_usuario AND r.activo = TRUE
        ORDER BY r.nombre
    """), {"id_usuario": id_usuario}).scalars().all())
    perfil = db.execute(text("""
        SELECT id_estudiante, rut, carrera, sede FROM estudiante
        WHERE id_usuario = :id_usuario
    """), {"id_usuario": id_usuario}).mappings().first()
    practica = None
    if perfil:
        practica = db.execute(text("""
            SELECT p.id_practica, ep.id_estado, ep.nombre AS estado,
                   ep.es_final, cp.id_centro, cp.nombre AS centro_practica,
                   p.fecha_inicio, p.fecha_termino, p.horas, p.cargo_funcion
            FROM practica p
            JOIN estado_practica ep ON ep.id_estado = p.id_estado_actual
            JOIN centro_practica cp ON cp.id_centro = p.id_centro
            WHERE p.id_estudiante = :id_estudiante
            ORDER BY CASE WHEN ep.es_final = FALSE THEN 0 ELSE 1 END,
                     p.fecha_registro DESC
            LIMIT 1
        """), {"id_estudiante": perfil["id_estudiante"]}).mappings().first()
    return {
        "usuario": dict(usuario), "roles": roles,
        "perfil": dict(perfil) if perfil else None,
        "practica_actual": ({
            "id_practica": practica["id_practica"],
            "estado": {"id_estado": practica["id_estado"], "nombre": practica["estado"], "es_final": practica["es_final"]},
            "centro_practica": {"id_centro": practica["id_centro"], "nombre": practica["centro_practica"]},
            "fecha_inicio": practica["fecha_inicio"], "fecha_termino": practica["fecha_termino"],
            "horas": practica["horas"], "cargo_funcion": practica["cargo_funcion"],
        } if practica else None),
    }
