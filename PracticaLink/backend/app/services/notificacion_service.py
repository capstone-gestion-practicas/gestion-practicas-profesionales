from sqlalchemy import text
from sqlalchemy.orm import Session


def listar_notificaciones(db: Session, id_usuario: int) -> dict:
    return db.execute(text("""
        SELECT public.fn_listar_notificaciones(:id_usuario)
    """), {"id_usuario": id_usuario}).scalar_one()


def marcar_notificacion_leida(
    db: Session, id_usuario: int, id_notificacion: int
) -> bool:
    resultado = db.execute(text("""
        SELECT public.fn_marcar_notificacion_leida(
            :id_usuario, :id_notificacion
        )
    """), {
        "id_usuario": id_usuario,
        "id_notificacion": id_notificacion,
    }).scalar_one()
    db.commit()
    return resultado


def marcar_todas_leidas(db: Session, id_usuario: int) -> int:
    resultado = db.execute(text("""
        SELECT public.fn_marcar_todas_notificaciones_leidas(:id_usuario)
    """), {"id_usuario": id_usuario}).scalar_one()
    db.commit()
    return resultado
