import json

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.security import create_access_token, hash_password, verify_password


def registrar_usuario(
    db: Session,
    nombre: str,
    apellido: str,
    correo: str,
    password: str,
):
    datos = {
        "nombre": nombre,
        "apellido": apellido,
        "correo": correo,
    }
    resultado = db.execute(text("""
        SELECT public.fn_registrar_usuario_estudiante(
            CAST(:datos AS JSONB), :password_hash
        )
    """), {
        "datos": json.dumps(datos, ensure_ascii=False),
        "password_hash": hash_password(password),
    }).scalar_one()
    if resultado.get("error") == "CORREO_EXISTENTE":
        db.rollback()
        return None
    if resultado.get("error"):
        db.rollback()
        raise RuntimeError("No fue posible registrar el usuario")
    db.commit()
    return resultado


def autenticar_usuario(db: Session, correo: str, password: str):
    usuario = db.execute(text("""
        SELECT public.fn_obtener_datos_login(:correo)
    """), {"correo": correo.strip().lower()}).scalar_one_or_none()
    if not usuario or not usuario.get("activo"):
        return None
    if not verify_password(password, usuario["password_hash"]):
        return None
    return {
        "access_token": create_access_token(usuario["id_usuario"]),
        "token_type": "bearer",
    }


def obtener_contexto_usuario(db: Session, id_usuario: int):
    return db.execute(text("""
        SELECT public.fn_contexto_usuario(:id_usuario)
    """), {"id_usuario": id_usuario}).scalar_one_or_none()
