import logging
import smtplib
import ssl
from email.message import EmailMessage

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import settings
from app.services.push_service import enviar_push_notificacion


logger = logging.getLogger(__name__)


class EstudianteNoEncontradoError(Exception):
    pass


class EstudianteYaTienePracticaError(Exception):
    pass


class RecordatorioYaEnviadoHoyError(Exception):
    pass


def enviar_recordatorio_sin_practica(db: Session, id_usuario: int) -> dict:
    estudiante = db.execute(text("""
        SELECT
            u.correo,
            u.nombre,
            u.activo,
            EXISTS (
                SELECT 1
                FROM usuario_rol ur
                JOIN rol r ON r.id_rol = ur.id_rol
                WHERE ur.id_usuario = u.id_usuario
                  AND r.nombre = 'ESTUDIANTE'
                  AND r.activo
            ) AS es_estudiante,
            EXISTS (
                SELECT 1
                FROM estudiante e
                WHERE e.id_usuario = u.id_usuario
            ) AS tiene_perfil,
            EXISTS (
                SELECT 1
                FROM estudiante e
                JOIN practica p ON p.id_estudiante = e.id_estudiante
                WHERE e.id_usuario = u.id_usuario
            ) AS tiene_practica,
            EXISTS (
                SELECT 1
                FROM recordatorio_estudiante re
                WHERE re.id_usuario = u.id_usuario
                  AND re.fecha = CURRENT_DATE
            ) AS recordatorio_enviado_hoy
        FROM usuario u
        WHERE u.id_usuario = :id_usuario
    """), {"id_usuario": id_usuario}).mappings().one_or_none()

    if estudiante is None or not estudiante["activo"] or not estudiante["es_estudiante"]:
        raise EstudianteNoEncontradoError
    if estudiante["tiene_practica"]:
        raise EstudianteYaTienePracticaError
    if estudiante["recordatorio_enviado_hoy"]:
        raise RecordatorioYaEnviadoHoyError

    reserva = db.execute(text("""
        INSERT INTO recordatorio_estudiante (id_usuario, fecha)
        VALUES (:id_usuario, CURRENT_DATE)
        ON CONFLICT (id_usuario, fecha) DO NOTHING
        RETURNING id_usuario
    """), {"id_usuario": id_usuario}).scalar_one_or_none()
    if reserva is None:
        db.rollback()
        raise RecordatorioYaEnviadoHoyError

    if estudiante["tiene_perfil"]:
        texto_recordatorio = (
            "Te recordamos que aún no tienes una práctica profesional registrada "
            "en PracticaLink. Ingresa a la plataforma para registrar tu práctica."
        )
    else:
        texto_recordatorio = (
            "Te recordamos que aún no tienes tu perfil de estudiante ni una práctica "
            "profesional registrada en PracticaLink. Ingresa a la plataforma, completa "
            "tu perfil de estudiante y luego registra tu práctica."
        )

    mensaje = EmailMessage()
    mensaje["Subject"] = "Recordatorio: registra tu práctica profesional"
    mensaje["From"] = settings.smtp_from_email
    mensaje["To"] = estudiante["correo"]
    mensaje.set_content(
        f"""Hola {estudiante["nombre"]},

{texto_recordatorio}

Si ya realizaste este proceso, puedes ignorar este mensaje.

Saludos,
Equipo PracticaLink
"""
    )

    try:
        id_notificacion = db.execute(text("""
            INSERT INTO notificacion (
                id_usuario, id_practica, tipo, titulo, mensaje
            ) VALUES (
                :id_usuario, NULL, 'RECORDATORIO_SIN_PRACTICA',
                'Recordatorio de práctica profesional',
                :mensaje
            ) RETURNING id_notificacion
        """), {
            "id_usuario": id_usuario,
            "mensaje": texto_recordatorio,
        }).scalar_one()
        db.commit()
    except Exception:
        db.rollback()
        raise

    try:
        enviar_push_notificacion(db, id_notificacion, id_usuario)
    except Exception:
        # Push is an auxiliary channel; persisted notification/email still succeed.
        logger.exception("No se pudo entregar la notificación push al usuario %s", id_usuario)

    correo_enviado = True
    if bool(settings.smtp_username) != bool(settings.smtp_password):
        logger.error(
            "La configuración SMTP requiere usuario y contraseña juntos."
        )
        correo_enviado = False
    else:
        try:
            with smtplib.SMTP(
                settings.smtp_host,
                settings.smtp_port,
                timeout=10,
            ) as servidor:
                if settings.smtp_use_tls:
                    servidor.starttls(context=ssl.create_default_context())
                if settings.smtp_username and settings.smtp_password:
                    servidor.login(settings.smtp_username, settings.smtp_password)
                servidor.send_message(mensaje)
        except (OSError, smtplib.SMTPException):
            correo_enviado = False
            logger.exception(
                "No fue posible enviar recordatorio por correo al usuario %s",
                id_usuario,
            )

    if correo_enviado:
        mensaje_resultado = "Correo y notificación enviados correctamente."
    else:
        mensaje_resultado = (
            "Notificación enviada; no fue posible enviar el correo."
        )

    return {
        "id_usuario": id_usuario,
        "mensaje": mensaje_resultado,
        "correo_enviado": correo_enviado,
        "recordatorio_enviado_hoy": True,
    }
