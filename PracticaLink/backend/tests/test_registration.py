import os
import unittest
from unittest.mock import MagicMock, patch


os.environ.setdefault(
    "SUPABASE_DATABASE_URL",
    "postgresql+psycopg://user:password@localhost:5432/practicalink_test"
)
os.environ.setdefault("JWT_SECRET_KEY", "unit-test-secret")

from app.services.auth_service import registrar_usuario  # noqa: E402


class RegisterUserTests(unittest.TestCase):
    @patch("app.services.auth_service.hash_password")
    def test_registers_user_with_student_role(
        self,
        hash_password: MagicMock
    ) -> None:
        hash_password.return_value = "hashed-password"
        db = MagicMock()

        existing_result = MagicMock()
        existing_result.scalar_one_or_none.return_value = None
        role_result = MagicMock()
        role_result.scalar_one_or_none.return_value = 7
        insert_result = MagicMock()
        insert_result.mappings.return_value.one.return_value = {
            "id_usuario": 10,
            "nombre": "Ana",
            "apellido": "Pérez",
            "correo": "ana@practicalink.cl"
        }
        assignment_result = MagicMock()
        db.execute.side_effect = [
            existing_result,
            role_result,
            insert_result,
            assignment_result
        ]

        result = registrar_usuario(
            db=db,
            nombre=" Ana ",
            apellido=" Pérez ",
            correo="ANA@PRACTICALINK.CL",
            password="123456.abc"
        )

        self.assertEqual(result["id_usuario"], 10)
        self.assertEqual(result["rol"], "ESTUDIANTE")
        hash_password.assert_called_once_with("123456.abc")
        db.commit.assert_called_once_with()
        db.rollback.assert_not_called()

    def test_rejects_an_existing_email(self) -> None:
        db = MagicMock()
        existing_result = MagicMock()
        existing_result.scalar_one_or_none.return_value = 10
        db.execute.return_value = existing_result

        result = registrar_usuario(
            db=db,
            nombre="Ana",
            apellido="Pérez",
            correo="ana@practicalink.cl",
            password="123456.abc"
        )

        self.assertIsNone(result)
        db.commit.assert_not_called()

    def test_fails_when_student_role_is_not_configured(self) -> None:
        db = MagicMock()
        existing_result = MagicMock()
        existing_result.scalar_one_or_none.return_value = None
        role_result = MagicMock()
        role_result.scalar_one_or_none.return_value = None
        db.execute.side_effect = [existing_result, role_result]

        with self.assertRaises(RuntimeError):
            registrar_usuario(
                db=db,
                nombre="Ana",
                apellido="Pérez",
                correo="ana@practicalink.cl",
                password="123456.abc"
            )


if __name__ == "__main__":
    unittest.main()
