from sqlalchemy import text
from sqlalchemy.orm import Session

from sqlalchemy.exc import IntegrityError

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
    password: str,
    rut: str,
    carrera: str,
    sede: str
):
    correo_normalizado = correo.strip().lower()

    usuario_existente = db.execute(
        text("""
            SELECT id_usuario
            FROM usuario
            WHERE LOWER(correo) = :correo
            LIMIT 1
        """),
        {"correo": correo_normalizado}
    ).scalar_one_or_none()

    if usuario_existente is not None:
        return None

    id_rol = db.execute(
        text("""
            SELECT id_rol
            FROM rol
            WHERE nombre = 'ESTUDIANTE'
              AND activo = TRUE
            LIMIT 1
        """)
    ).scalar_one_or_none()

    if id_rol is None:
        raise RuntimeError("El rol ESTUDIANTE no está configurado")

    try:
        usuario = db.execute(
            text("""
                INSERT INTO usuario (
                    nombre,
                    apellido,
                    correo,
                    password_hash
                )
                VALUES (
                    :nombre,
                    :apellido,
                    :correo,
                    :password_hash
                )
                RETURNING id_usuario, nombre, apellido, correo
            """),
            {
                "nombre": nombre.strip(),
                "apellido": apellido.strip(),
                "correo": correo_normalizado,
                "password_hash": hash_password(password)
            }
        ).mappings().one()

        db.execute(
            text("""
                INSERT INTO usuario_rol (id_usuario, id_rol)
                VALUES (:id_usuario, :id_rol)
            """),
            {
                "id_usuario": usuario["id_usuario"],
                "id_rol": id_rol
            }
        )
        estudiante = db.execute(
            text("""
                INSERT INTO estudiante (
                    id_usuario,
                    rut,
                    carrera,
                    sede
                )
                VALUES (
                    :id_usuario,
                    :rut,
                    :carrera,
                    :sede
                )
                RETURNING id_estudiante
            """),
            {
                "id_usuario": usuario["id_usuario"],
                "rut": rut.strip(),
                "carrera": carrera.strip(),
                "sede": sede.strip()
            }
        ).mappings().one()
        db.commit()
    except IntegrityError:
        db.rollback()
        return None
    except Exception:
        db.rollback()
        raise

    return {
        **dict(usuario),
        "rol": "ESTUDIANTE",
        "id_estudiante": estudiante["id_estudiante"]
    }


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
        {"correo": correo}
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
    query = text("""
        SELECT fn_contexto_usuario(:id_usuario)
    """)

    return db.execute(
        query,
        {"id_usuario": id_usuario}
    ).scalar_one_or_none()
