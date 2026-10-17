from sqlalchemy import text
from sqlalchemy.orm import Session


def listar_notificaciones(db: Session, id_usuario: int) -> dict:
    no_leidas = db.execute(text("""
        SELECT COUNT(*) FROM notificacion
        WHERE id_usuario = :id_usuario AND fecha_leida IS NULL
    """), {"id_usuario": id_usuario}).scalar_one()
    filas = db.execute(text("""
        SELECT id_notificacion, id_practica, tipo, titulo, mensaje,
               fecha_creacion, fecha_leida
        FROM notificacion
        WHERE id_usuario = :id_usuario
        ORDER BY id_notificacion DESC
        LIMIT 100
    """), {"id_usuario": id_usuario}).mappings().all()
    return {"notificaciones": [dict(fila) for fila in filas], "no_leidas": no_leidas}


def marcar_notificacion_leida(
    db: Session, id_usuario: int, id_notificacion: int
) -> bool:
    resultado = db.execute(text("""
        UPDATE notificacion SET fecha_leida = COALESCE(fecha_leida, NOW())
        WHERE id_notificacion = :id_notificacion
          AND id_usuario = :id_usuario AND fecha_leida IS NULL
        RETURNING id_notificacion
    """), {"id_notificacion": id_notificacion, "id_usuario": id_usuario}).first()
    db.commit()
    return resultado is not None


def marcar_todas_leidas(db: Session, id_usuario: int) -> int:
    resultado = db.execute(text("""
        UPDATE notificacion SET fecha_leida = NOW()
        WHERE id_usuario = :id_usuario AND fecha_leida IS NULL
    """), {"id_usuario": id_usuario})
    db.commit()
    return resultado.rowcount or 0
