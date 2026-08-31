import json

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
    password: str,
    rut: str,
    carrera: str,
    sede: str
):
    correo_normalizado = correo.strip().lower()
    resultado = db.execute(
        text("""
            SELECT fn_registrar_usuario_estudiante(
                CAST(:datos AS JSONB),
                :password_hash
            )
        """),
        {
            "datos": json.dumps({
                "nombre": nombre.strip(),
                "apellido": apellido.strip(),
                "correo": correo_normalizado,
                "rut": rut.strip(),
                "carrera": carrera.strip(),
                "sede": sede.strip(),
            }),
            "password_hash": hash_password(password),
        },
    ).scalar_one()

    if resultado.get("error") in {"CORREO_EXISTENTE", "RUT_EXISTENTE"}:
        db.rollback()
        return None

    if resultado.get("error") == "ROL_ESTUDIANTE_NO_CONFIGURADO":
        db.rollback()
        raise RuntimeError("El rol ESTUDIANTE no está configurado")

    db.commit()
    return resultado


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
