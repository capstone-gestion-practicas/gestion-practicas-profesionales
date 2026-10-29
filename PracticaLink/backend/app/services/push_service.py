import json
import logging

import httpx
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import settings

logger = logging.getLogger(__name__)


def enviar_push_notificacion(db: Session, id_notificacion: int, id_usuario: int) -> None:
    """Send a persisted notification to all active FCM registrations for its user."""
    if not settings.firebase_service_account_json:
        return

    try:
        import firebase_admin
        from firebase_admin import credentials, messaging

        cuenta = json.loads(settings.firebase_service_account_json)

        try:
            app = firebase_admin.get_app()
        except ValueError:
            app = firebase_admin.initialize_app(credentials.Certificate(cuenta))
        notificacion = db.execute(text("""
            SELECT titulo, mensaje FROM public.notificacion
            WHERE id_notificacion = :id AND id_usuario = :usuario
        """), {"id": id_notificacion, "usuario": id_usuario}).mappings().one_or_none()
        if not notificacion:
            return

        tokens = db.execute(text("""
            SELECT token FROM public.dispositivo_push
            WHERE id_usuario = :usuario AND activo
        """), {"usuario": id_usuario}).scalars().all()
        for token in tokens:
            try:
                messaging.send(messaging.Message(
                    token=token,
                    notification=messaging.Notification(
                        title=notificacion["titulo"], body=notificacion["mensaje"]
                    ),
                    data={"id_notificacion": str(id_notificacion)},
                ), app=app)
            except Exception as error:
                logger.exception("No se pudo enviar push a un dispositivo registrado.")
                if "registration-token-not-registered" in str(error) or "invalid-registration-token" in str(error):
                    db.execute(text("""
                        UPDATE public.dispositivo_push SET activo = FALSE
                        WHERE token = :token
                    """), {"token": token})
        db.commit()
    except Exception:
        logger.exception("No se pudo inicializar Firebase Cloud Messaging.")
