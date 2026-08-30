import os
import unittest
from unittest.mock import MagicMock, patch

from fastapi import HTTPException, status


os.environ.setdefault(
    "SUPABASE_DATABASE_URL",
    "postgresql+psycopg://user:password@localhost:5432/practicalink_test"
)
os.environ.setdefault("JWT_SECRET_KEY", "unit-test-secret")

from app.core.permissions import require_roles  # noqa: E402


class RequireRolesTests(unittest.TestCase):
    @patch("app.core.permissions.obtener_contexto_usuario")
    def test_allows_user_with_an_allowed_role(
        self,
        obtener_contexto_usuario: MagicMock
    ) -> None:
        dependency = require_roles("ADMINISTRADOR", "ESTUDIANTE")
        contexto = {"roles": ["ESTUDIANTE"]}
        obtener_contexto_usuario.return_value = contexto
        db = MagicMock()

        result = dependency(user_id=1, db=db)

        self.assertEqual(result, contexto)
        obtener_contexto_usuario.assert_called_once_with(
            db=db,
            id_usuario=1
        )

    @patch("app.core.permissions.obtener_contexto_usuario")
    def test_normalizes_roles_before_comparing(
        self,
        obtener_contexto_usuario: MagicMock
    ) -> None:
        dependency = require_roles(" gestor ")
        contexto = {"roles": ["gestor"]}
        obtener_contexto_usuario.return_value = contexto

        result = dependency(user_id=2, db=MagicMock())

        self.assertEqual(result, contexto)

    @patch("app.core.permissions.obtener_contexto_usuario")
    def test_rejects_user_without_an_allowed_role(
        self,
        obtener_contexto_usuario: MagicMock
    ) -> None:
        dependency = require_roles("ADMINISTRADOR")
        obtener_contexto_usuario.return_value = {
            "roles": ["ESTUDIANTE"]
        }

        with self.assertRaises(HTTPException) as raised:
            dependency(user_id=3, db=MagicMock())

        self.assertEqual(
            raised.exception.status_code,
            status.HTTP_403_FORBIDDEN
        )

    def test_requires_at_least_one_role(self) -> None:
        with self.assertRaises(ValueError):
            require_roles()


if __name__ == "__main__":
    unittest.main()
