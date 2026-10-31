from sqlalchemy import text
from sqlalchemy.orm import Session
from app.services.push_service import enviar_push_notificacion


def listar_destinatarios_mensaje_push(db: Session) -> list[dict]:
    return db.execute(text("""
        SELECT public.fn_listar_destinatarios_mensaje_push()
    """)).scalar_one()


def crear_mensaje_push_gestor(
    db: Session, id_usuario: int, titulo: str, mensaje: str
) -> tuple[int | None, int]:
    resultado = db.execute(text("""
        SELECT public.fn_crear_mensaje_push_gestor(
            :id_usuario, :titulo, :mensaje
        )
    """), {
        'id_usuario': id_usuario,
        'titulo': titulo,
        'mensaje': mensaje,
    }).scalar_one()
    if resultado.get('error') == 'DESTINATARIO_NO_DISPONIBLE':
        db.rollback()
        return None, 0

    id_notificacion = int(resultado['id_notificacion'])
    db.commit()
    dispositivos_enviados = enviar_push_notificacion(db, id_notificacion, id_usuario)
    return id_notificacion, dispositivos_enviados


def crear_broadcast_push_gestor(
    db: Session, titulo: str, mensaje: str
) -> tuple[int, int]:
    resultado = db.execute(text("""
        SELECT public.fn_crear_mensaje_push_broadcast(:titulo, :mensaje)
    """), {'titulo': titulo, 'mensaje': mensaje}).scalar_one()
    notificaciones = resultado.get('notificaciones', [])
    db.commit()

    dispositivos_enviados = 0
    for notificacion in notificaciones:
        dispositivos_enviados += enviar_push_notificacion(
            db,
            int(notificacion['id_notificacion']),
            int(notificacion['id_usuario']),
        )
    return len(notificaciones), dispositivos_enviados


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
