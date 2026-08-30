from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.security import create_access_token, verify_password


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