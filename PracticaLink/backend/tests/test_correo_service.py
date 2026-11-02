import os
import unittest
from unittest.mock import MagicMock, patch

os.environ.setdefault("SUPABASE_DATABASE_URL", "postgresql+psycopg://localhost/test")
os.environ.setdefault("JWT_SECRET_KEY", "unit-test-secret")

from app.core.config import settings  # noqa: E402
from app.services.correo_service import (  # noqa: E402
    RecordatorioYaEnviadoHoyError,
    EstudianteYaTienePracticaError,
    enviar_recordatorio_sin_practica,
)


class RecordatorioEstudianteTests(unittest.TestCase):
    def setUp(self) -> None:
        self.db = MagicMock()
        estudiante = MagicMock()
        estudiante.mappings.return_value.one_or_none.return_value = {
            "correo": "estudiante@example.test",
            "nombre": "Ana",
            "activo": True,
            "es_estudiante": True,
            "tiene_perfil": True,
            "tiene_practica": False,
            "recordatorio_enviado_hoy": False,
        }
        reserva = MagicMock()
        reserva.scalar_one_or_none.return_value = 42
        self.db.execute.side_effect = [estudiante, reserva, MagicMock()]

    @patch("app.services.correo_service.smtplib.SMTP")
    def test_sends_generic_reminder_to_student_without_practice(
        self, smtp: MagicMock
    ) -> None:
        with (
            patch.object(settings, "smtp_host", "127.0.0.1"),
            patch.object(settings, "smtp_port", 54325),
            patch.object(settings, "smtp_username", None),
            patch.object(settings, "smtp_password", None),
            patch.object(settings, "smtp_use_tls", False),
        ):
            result = enviar_recordatorio_sin_practica(self.db, 42)

        message = smtp.return_value.__enter__.return_value.send_message.call_args.args[0]
        self.assertEqual(result["id_usuario"], 42)
        self.assertTrue(result["correo_enviado"])
        self.assertTrue(result["recordatorio_enviado_hoy"])
        self.assertIn("Correo y notificación", result["mensaje"])
        self.assertEqual(message["To"], "estudiante@example.test")
        self.assertIn("Hola Ana", message.get_content())
        self.assertIn("registrar tu práctica", message.get_content())
        self.assertNotIn("completa tu perfil", message.get_content())
        smtp.return_value.__enter__.return_value.send_message.assert_called_once()
        self.db.commit.assert_called_once()

    @patch("app.services.correo_service.smtplib.SMTP")
    def test_does_not_send_if_student_already_has_practice(
        self, smtp: MagicMock
    ) -> None:
        estudiante = MagicMock()
        estudiante.mappings.return_value.one_or_none.return_value = {
            "activo": True,
            "es_estudiante": True,
            "tiene_perfil": True,
            "tiene_practica": True,
            "recordatorio_enviado_hoy": False,
        }
        self.db.execute.side_effect = [estudiante]

        with self.assertRaises(EstudianteYaTienePracticaError):
            enviar_recordatorio_sin_practica(self.db, 42)

        smtp.assert_not_called()
        self.db.commit.assert_not_called()

    @patch("app.services.correo_service.smtplib.SMTP")
    def test_reminds_student_without_profile_to_complete_profile_and_register_practice(
        self, smtp: MagicMock
    ) -> None:
        estudiante = MagicMock()
        estudiante.mappings.return_value.one_or_none.return_value = {
            "correo": "estudiante@example.test",
            "nombre": "Ana",
            "activo": True,
            "es_estudiante": True,
            "tiene_perfil": False,
            "tiene_practica": False,
            "recordatorio_enviado_hoy": False,
        }
        reservation = MagicMock()
        reservation.scalar_one_or_none.return_value = 42
        self.db.execute.side_effect = [estudiante, reservation, MagicMock()]

        with (
            patch.object(settings, "smtp_host", "127.0.0.1"),
            patch.object(settings, "smtp_port", 54325),
            patch.object(settings, "smtp_username", None),
            patch.object(settings, "smtp_password", None),
            patch.object(settings, "smtp_use_tls", False),
        ):
            enviar_recordatorio_sin_practica(self.db, 42)

        message = smtp.return_value.__enter__.return_value.send_message.call_args.args[0]
        self.assertIn("completa tu perfil de estudiante", message.get_content())
        self.assertIn("registra tu práctica", message.get_content())

    @patch("app.services.correo_service.smtplib.SMTP")
    def test_does_not_resend_when_reminder_was_sent_today(self, smtp: MagicMock) -> None:
        estudiante = MagicMock()
        estudiante.mappings.return_value.one_or_none.return_value = {
            "activo": True,
            "es_estudiante": True,
            "tiene_practica": False,
            "recordatorio_enviado_hoy": True,
        }
        self.db.execute.side_effect = [estudiante]

        with self.assertRaises(RecordatorioYaEnviadoHoyError):
            enviar_recordatorio_sin_practica(self.db, 42)

        smtp.assert_not_called()

    @patch("app.services.correo_service.smtplib.SMTP")
    def test_persists_notification_if_email_delivery_fails(
        self, smtp: MagicMock
    ) -> None:
        smtp.side_effect = OSError("SMTP unavailable")

        with (
            patch.object(settings, "smtp_host", "127.0.0.1"),
            patch.object(settings, "smtp_port", 54325),
            patch.object(settings, "smtp_username", None),
            patch.object(settings, "smtp_password", None),
            patch.object(settings, "smtp_use_tls", False),
            self.assertLogs("app.services.correo_service", level="ERROR"),
        ):
            result = enviar_recordatorio_sin_practica(self.db, 42)

        self.db.execute.assert_called()
        self.db.commit.assert_called_once()
        self.db.rollback.assert_not_called()
        self.assertFalse(result["correo_enviado"])
        self.assertTrue(result["recordatorio_enviado_hoy"])
        self.assertIn("Notificación enviada", result["mensaje"])

    @patch("app.services.correo_service.smtplib.SMTP")
    def test_releases_daily_marker_when_another_request_won_race(
        self, smtp: MagicMock
    ) -> None:
        estudiante = MagicMock()
        estudiante.mappings.return_value.one_or_none.return_value = {
            "activo": True,
            "es_estudiante": True,
            "tiene_practica": False,
            "recordatorio_enviado_hoy": False,
        }
        reservation = MagicMock()
        reservation.scalar_one_or_none.return_value = None
        self.db.execute.side_effect = [estudiante, reservation]

        with self.assertRaises(RecordatorioYaEnviadoHoyError):
            enviar_recordatorio_sin_practica(self.db, 42)

        self.db.rollback.assert_called_once()
        smtp.assert_not_called()


if __name__ == "__main__":
    unittest.main()
