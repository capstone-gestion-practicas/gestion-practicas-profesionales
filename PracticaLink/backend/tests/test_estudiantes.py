import json
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
from app.estudiantes.schemas import PerfilEstudianteCreate  # noqa: E402
from app.estudiantes.service import (  # noqa: E402
    PerfilEstudianteExistenteError,
    RutEstudianteExistenteError,
    UsuarioEstudianteNoValidoError,
    completar_perfil_estudiante,
)


def perfil_payload() -> dict:
    return {
        "rut": "12345678-5",
        "carrera": " Ingeniería en Informática ",
        "sede": " Alameda ",
        "telefono": "+56 9 1234 5678",
        "direccion": "Dirección de prueba",
    }


def resultado_exitoso() -> dict:
    return {
        "id_estudiante": 9,
        "mensaje": "Perfil de estudiante completado correctamente",
    }


class CompletarPerfilEstudianteServiceTests(unittest.TestCase):
    def test_calls_sql_with_authenticated_id_and_normalized_json_and_commits(self):
        db = MagicMock(name="db")
        esperado = resultado_exitoso()
        db.execute.return_value.scalar_one.return_value = esperado
        datos = PerfilEstudianteCreate(**perfil_payload())

        resultado = completar_perfil_estudiante(db, 55, datos)

        self.assertEqual(resultado, esperado)
        db.execute.assert_called_once()
        sql, parametros = db.execute.call_args.args
        self.assertEqual(
            " ".join(str(sql).split()),
            "SELECT fn_completar_perfil_estudiante( :id_usuario, "
            "CAST(:datos AS JSONB) )",
        )
        self.assertEqual(set(parametros), {"id_usuario", "datos"})
        self.assertEqual(parametros["id_usuario"], 55)
        self.assertIsInstance(parametros["datos"], str)
        self.assertEqual(json.loads(parametros["datos"]), {
            "rut": "12.345.678-5",
            "carrera": "Ingeniería en Informática",
            "sede": "Alameda",
            "telefono": "+56 9 1234 5678",
            "direccion": "Dirección de prueba",
        })
        db.execute.return_value.scalar_one.assert_called_once_with()
        db.commit.assert_called_once_with()
        db.rollback.assert_not_called()

    def test_serializes_absent_optional_fields_as_null(self):
        db = MagicMock(name="db")
        db.execute.return_value.scalar_one.return_value = resultado_exitoso()
        datos = PerfilEstudianteCreate(
            rut="12345678-5", carrera="Ingeniería", sede="Alameda"
        )

        completar_perfil_estudiante(db, 55, datos)

        parametros = db.execute.call_args.args[1]
        self.assertEqual(json.loads(parametros["datos"]), {
            "rut": "12.345.678-5",
            "carrera": "Ingeniería",
            "sede": "Alameda",
            "telefono": None,
            "direccion": None,
        })

    def _assert_business_error(self, codigo, excepcion):
        db = MagicMock(name="db")
        db.execute.return_value.scalar_one.return_value = {"error": codigo}

        with self.assertRaises(excepcion):
            completar_perfil_estudiante(
                db, 55, PerfilEstudianteCreate(**perfil_payload())
            )

        db.execute.assert_called_once()
        db.commit.assert_not_called()
        # Actualmente el rollback pertenece a la ruta, no al servicio.
        db.rollback.assert_not_called()

    def test_translates_perfil_existente_without_committing(self):
        self._assert_business_error("PERFIL_EXISTENTE", PerfilEstudianteExistenteError)

    def test_translates_rut_existente_without_committing(self):
        self._assert_business_error("RUT_EXISTENTE", RutEstudianteExistenteError)

    def test_translates_usuario_no_valido_without_committing(self):
        self._assert_business_error(
            "USUARIO_ESTUDIANTE_NO_VALIDO", UsuarioEstudianteNoValidoError
        )


class CompletarPerfilEstudianteRouteTests(unittest.TestCase):
    def setUp(self):
        self.db = MagicMock(name="db")
        self.db.execute.return_value.scalar_one.return_value = resultado_exitoso()
        overrides = patch.dict(app.dependency_overrides, {
            get_db: lambda: self.db,
            get_current_user_id: lambda: 55,
        })
        overrides.start()
        self.addCleanup(overrides.stop)
        contexto_patch = patch(
            "app.core.permissions.obtener_contexto_usuario",
            return_value={"roles": ["ESTUDIANTE"]},
        )
        self.contexto_mock = contexto_patch.start()
        self.addCleanup(contexto_patch.stop)

    def _post(self, payload=None, params=None):
        # TestClient ejecuta ASGI en memoria; get_db siempre entrega un mock.
        with TestClient(app) as client:
            return client.post(
                "/estudiantes/perfil",
                json=perfil_payload() if payload is None else payload,
                params=params,
            )

    def test_allows_estudiante_and_returns_201_with_current_response(self):
        response = self._post()

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json(), resultado_exitoso())
        self.contexto_mock.assert_called_once_with(db=self.db, id_usuario=55)
        self.db.execute.assert_called_once()
        self.db.commit.assert_called_once_with()
        self.db.rollback.assert_not_called()

    def test_uses_authenticated_id_instead_of_body_or_query_id(self):
        payload = {**perfil_payload(), "id_usuario": 999}

        response = self._post(payload, params={"id_usuario": 888})

        self.assertEqual(response.status_code, 201)
        self.contexto_mock.assert_called_once_with(db=self.db, id_usuario=55)
        self.db.execute.assert_called_once()
        parametros = self.db.execute.call_args.args[1]
        self.assertEqual(parametros["id_usuario"], 55)
        self.assertNotIn("id_usuario", json.loads(parametros["datos"]))

    def test_denies_non_student_roles_before_calling_service_sql(self):
        for roles in (["GESTOR"], ["ADMINISTRADOR"], ["GESTOR", "ADMINISTRADOR"], []):
            with self.subTest(roles=roles):
                self.contexto_mock.reset_mock()
                self.contexto_mock.return_value = {"roles": roles}

                response = self._post()

                self.assertEqual(response.status_code, 403)
                self.assertEqual(response.json(), {
                    "detail": "No tiene permisos para acceder a esta funcionalidad."
                })
                self.contexto_mock.assert_called_once_with(db=self.db, id_usuario=55)
                self.db.execute.assert_not_called()
                self.db.commit.assert_not_called()
                self.db.rollback.assert_not_called()

    def _assert_sql_error_response(self, codigo, status_code, mensaje):
        self.db.execute.return_value.scalar_one.return_value = {"error": codigo}

        response = self._post()

        self.assertEqual(response.status_code, status_code)
        self.assertEqual(response.json(), {"detail": mensaje})
        self.db.execute.assert_called_once()
        self.db.commit.assert_not_called()
        self.db.rollback.assert_called_once_with()

    def test_perfil_existente_returns_409_and_rolls_back(self):
        self._assert_sql_error_response(
            "PERFIL_EXISTENTE", 409, "El usuario ya tiene un perfil de estudiante"
        )

    def test_rut_existente_returns_409_and_rolls_back(self):
        self._assert_sql_error_response(
            "RUT_EXISTENTE", 409, "El RUT ya está asociado a otro estudiante"
        )

    def test_usuario_no_valido_returns_403_and_rolls_back(self):
        self._assert_sql_error_response(
            "USUARIO_ESTUDIANTE_NO_VALIDO", 403,
            "El usuario no está habilitado como estudiante",
        )

    def test_invalid_rut_returns_422_without_writing(self):
        response = self._post({**perfil_payload(), "rut": "12345678-0"})

        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["detail"][0]["loc"], ["body", "rut"])
        self.db.execute.assert_not_called()
        self.db.commit.assert_not_called()
        self.db.rollback.assert_not_called()


if __name__ == "__main__":
    unittest.main()
