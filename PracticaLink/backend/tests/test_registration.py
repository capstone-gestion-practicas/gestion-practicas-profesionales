import os
import unittest
from unittest.mock import MagicMock, patch

os.environ.setdefault("SUPABASE_DATABASE_URL", "postgresql+psycopg://user:password@localhost:5432/test")
os.environ.setdefault("JWT_SECRET_KEY", "unit-test-secret")

from app.auth.service import registrar_usuario  # noqa: E402


class RegisterUserTests(unittest.TestCase):
    @patch("app.auth.service.hash_password")
    def test_registers_account_without_profile(self, hash_password: MagicMock) -> None:
        hash_password.return_value = "hashed-password"
        db = MagicMock()
        db.execute.return_value.scalar_one.return_value = {
            "id_usuario": 10, "nombre": "Ana", "apellido": "Pérez",
            "correo": "ana@practicalink.cl", "rol": "ESTUDIANTE",
        }
        result = registrar_usuario(db, " Ana ", " Pérez ", "ANA@PRACTICALINK.CL", "123456.abc")
        self.assertEqual(result["id_usuario"], 10)
        hash_password.assert_called_once_with("123456.abc")
        db.commit.assert_called_once_with()

    def test_rejects_an_existing_email(self) -> None:
        db = MagicMock()
        db.execute.return_value.scalar_one.return_value = {"error": "CORREO_EXISTENTE"}
        result = registrar_usuario(db, "Ana", "Pérez", "ana@practicalink.cl", "123456.abc")
        self.assertIsNone(result)
        db.rollback.assert_called_once_with()

    def test_fails_when_student_role_is_not_configured(self) -> None:
        db = MagicMock()
        db.execute.return_value.scalar_one.return_value = {"error": "ROL_ESTUDIANTE_NO_CONFIGURADO"}
        with self.assertRaises(RuntimeError):
            registrar_usuario(db, "Ana", "Pérez", "ana@practicalink.cl", "123456.abc")


if __name__ == "__main__":
    unittest.main()
