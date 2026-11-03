import os
import sys
import types
import unittest
from unittest.mock import MagicMock, patch

os.environ.setdefault("SUPABASE_DATABASE_URL", "postgresql+psycopg://localhost/test")
os.environ.setdefault("JWT_SECRET_KEY", "unit-test-secret")

from app.core.config import settings  # noqa: E402
from app.services.push_service import enviar_push_notificacion  # noqa: E402


class UnregisteredError(Exception):
    pass


class PushServiceTests(unittest.TestCase):
    def test_deactivates_fcm_token_when_it_is_unregistered(self) -> None:
        db = MagicMock()
        notification_result = MagicMock()
        notification_result.mappings.return_value.one_or_none.return_value = {
            "titulo": "Aviso",
            "mensaje": "Mensaje",
        }
        tokens_result = MagicMock()
        tokens_result.scalars.return_value.all.return_value = ["expired-token"]
        db.execute.side_effect = [notification_result, tokens_result, MagicMock()]

        firebase_admin = types.ModuleType("firebase_admin")
        credentials = types.ModuleType("credentials")
        messaging = types.ModuleType("messaging")
        firebase_admin.get_app = MagicMock(return_value=object())
        firebase_admin.credentials = credentials
        firebase_admin.messaging = messaging
        messaging.Message = MagicMock()
        messaging.Notification = MagicMock()
        messaging.send = MagicMock(side_effect=UnregisteredError("NotRegistered"))

        with (
            patch.object(settings, "firebase_service_account_json", "{}"),
            patch.dict(sys.modules, {"firebase_admin": firebase_admin}),
            self.assertLogs("app.services.push_service", level="WARNING"),
        ):
            enviados = enviar_push_notificacion(db, 17, 23)

        self.assertEqual(enviados, 0)
        update = db.execute.call_args_list[2]
        self.assertIn("UPDATE public.dispositivo_push SET activo = FALSE", str(update.args[0]))
        self.assertEqual(update.args[1], {"token": "expired-token"})
        db.commit.assert_called_once()


if __name__ == "__main__":
    unittest.main()
