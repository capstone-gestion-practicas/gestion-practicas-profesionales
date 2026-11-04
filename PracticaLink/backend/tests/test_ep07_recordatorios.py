import os
import unittest
from unittest.mock import MagicMock, patch

os.environ.setdefault("SUPABASE_DATABASE_URL", "postgresql+psycopg://localhost/practicalink_test")
os.environ.setdefault("JWT_SECRET_KEY", "unit-test-secret")

from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from app.core.config import settings
from app.core.database import get_db
from app.main import app
from app.services import push_service

RUTA = "/practicas/tareas/recordatorios-cierre"
TOKEN = "unit-test-task-token"


class RecordatorioTareaTests(unittest.TestCase):
    """Mocks de sesión y de FCM; nunca conecta a una base real ni a Firebase."""

    def setUp(self):
        self.overrides = dict(app.dependency_overrides)
        self.addCleanup(self.restore_overrides)
        self.db = MagicMock()
        self.db.execute.return_value.scalar_one.return_value = []
        app.dependency_overrides[get_db] = lambda: self.db
        self.enterContext(patch("sqlalchemy.engine.Engine.connect", side_effect=AssertionError("Conexión real prohibida")))
        self.enterContext(patch("socket.create_connection", side_effect=AssertionError("Red prohibida")))
        self.client = self.enterContext(TestClient(app, raise_server_exceptions=False))

    def restore_overrides(self):
        app.dependency_overrides.clear()
        app.dependency_overrides.update(self.overrides)

    def configurar_token(self, valor):
        return self.enterContext(patch.object(settings, "ep07_reminder_task_token", valor))

    def test_unconfigured_token_is_503_without_database(self):
        self.configurar_token(None)
        response = self.client.post(RUTA, headers={"X-Task-Token": TOKEN})
        self.assertEqual(response.status_code, 503)
        self.db.execute.assert_not_called()
        self.db.commit.assert_not_called()

    def test_missing_or_wrong_token_is_403_without_database(self):
        self.configurar_token(TOKEN)
        for headers in [{}, {"X-Task-Token": ""}, {"X-Task-Token": "otro-token"}]:
            with self.subTest(headers=headers):
                self.assertEqual(self.client.post(RUTA, headers=headers).status_code, 403)
        self.db.execute.assert_not_called()
        self.db.commit.assert_not_called()

    def test_correct_token_commits_before_any_push_and_counts_practices(self):
        self.configurar_token(TOKEN)
        orden = MagicMock()
        orden.attach_mock(self.db.commit, "commit")
        self.db.execute.return_value.scalar_one.return_value = [
            {"id_notificacion": 1, "id_usuario": 10, "id_practica": 15},
            {"id_notificacion": 2, "id_usuario": 11, "id_practica": 15},
        ]
        with patch("app.services.estado_practica_service.enviar_push_notificacion") as enviar:
            enviar.side_effect = lambda *args, **kwargs: orden.push(*args)
            response = self.client.post(RUTA, headers={"X-Task-Token": TOKEN})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"practicas_notificadas": 1})
        self.db.commit.assert_called_once()
        self.assertEqual(enviar.call_count, 2)
        self.assertEqual([c[0] for c in orden.mock_calls], ["commit", "push", "push"])

    def test_database_error_does_not_commit(self):
        self.configurar_token(TOKEN)
        self.db.execute.side_effect = OperationalError("SELECT", {}, Exception("sintetico"))
        response = self.client.post(RUTA, headers={"X-Task-Token": TOKEN})
        self.assertEqual(response.status_code, 500)
        self.db.commit.assert_not_called()

    def test_fcm_failure_is_contained_and_does_not_raise(self):
        # Firebase mal configurado: el envío devuelve 0 y no lanza excepción al procesamiento.
        with patch.object(settings, "firebase_service_account_json", "{no-es-json"):
            enviados = push_service.enviar_push_notificacion(self.db, 1, 10)
        self.assertEqual(enviados, 0)
        self.db.commit.assert_not_called()

    def test_no_candidates_returns_200_with_zero_and_no_push(self):
        # Sin prácticas candidatas la tarea responde 2xx válido con cero; no envía push.
        self.configurar_token(TOKEN)
        self.db.execute.return_value.scalar_one.return_value = []
        with patch("app.services.estado_practica_service.enviar_push_notificacion") as enviar:
            response = self.client.post(RUTA, headers={"X-Task-Token": TOKEN})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"practicas_notificadas": 0})
        self.db.commit.assert_called_once()
        enviar.assert_not_called()
