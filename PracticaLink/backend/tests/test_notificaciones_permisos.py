import os
import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient


os.environ.setdefault(
    "SUPABASE_DATABASE_URL",
    "postgresql+psycopg://user:password@localhost:5432/practicalink_test",
)
os.environ.setdefault("JWT_SECRET_KEY", "unit-test-secret")

from app.core.database import get_db  # noqa: E402
from app.core.security import get_current_user_id  # noqa: E402
from app.main import app  # noqa: E402


RESUMEN_VACIO = {"no_leidas": 0, "notificaciones": []}


class NotificacionesPermisosTests(unittest.TestCase):
    def _override_dependencies(self, db: MagicMock, user_id: int) -> dict:
        original_overrides = dict(app.dependency_overrides)
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[get_current_user_id] = lambda: user_id
        return original_overrides

    def test_docente_puede_listar_sus_notificaciones(self) -> None:
        db = MagicMock(name="db")
        original_overrides = self._override_dependencies(db, user_id=33)
        try:
            with patch(
                "app.core.permissions.obtener_contexto_usuario",
                return_value={"roles": ["DOCENTE"]},
            ), patch(
                "app.api.routes.notificaciones.listar_notificaciones",
                return_value=RESUMEN_VACIO,
            ) as listar_mock:
                with TestClient(app) as client:
                    response = client.get("/notificaciones")

                self.assertEqual(response.status_code, 200)
                listar_mock.assert_called_once_with(db, 33)
        finally:
            app.dependency_overrides.clear()
            app.dependency_overrides.update(original_overrides)

    def test_usuario_sin_roles_validos_recibe_403(self) -> None:
        db = MagicMock(name="db")
        original_overrides = self._override_dependencies(db, user_id=44)
        try:
            with patch(
                "app.core.permissions.obtener_contexto_usuario",
                return_value={"roles": []},
            ), patch(
                "app.api.routes.notificaciones.listar_notificaciones",
            ) as listar_mock:
                with TestClient(app) as client:
                    response = client.get("/notificaciones")

                self.assertEqual(response.status_code, 403)
                listar_mock.assert_not_called()
        finally:
            app.dependency_overrides.clear()
            app.dependency_overrides.update(original_overrides)

    def test_docente_sigue_sin_acceso_a_destinatarios_push(self) -> None:
        db = MagicMock(name="db")
        original_overrides = self._override_dependencies(db, user_id=33)
        try:
            with patch(
                "app.core.permissions.obtener_contexto_usuario",
                return_value={"roles": ["DOCENTE"]},
            ), patch(
                "app.api.routes.notificaciones.listar_destinatarios_mensaje_push",
            ) as destinatarios_mock:
                with TestClient(app) as client:
                    response = client.get("/notificaciones/destinatarios-push")

                self.assertEqual(response.status_code, 403)
                destinatarios_mock.assert_not_called()
        finally:
            app.dependency_overrides.clear()
            app.dependency_overrides.update(original_overrides)


if __name__ == "__main__":
    unittest.main()
