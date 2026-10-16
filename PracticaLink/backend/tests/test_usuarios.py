import json
import os
import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient
from pydantic import ValidationError


os.environ.setdefault(
    "SUPABASE_DATABASE_URL",
    "postgresql+psycopg://user:password@localhost:5432/practicalink_test",
)
os.environ.setdefault("JWT_SECRET_KEY", "unit-test-secret")

from app.core.database import engine, get_db  # noqa: E402
from app.core.security import get_current_user_id  # noqa: E402
from app.main import app  # noqa: E402
from app.usuarios.schemas import (  # noqa: E402
    UsuarioActualizarRequest, UsuarioCrearRequest,
)
from app.usuarios.service import (  # noqa: E402
    AutogestionNoPermitidaError, RolesInvalidosError, UsuarioDuplicadoError,
    UsuarioNoEncontradoError, actualizar_usuario, crear_usuario, listar_roles,
    listar_usuarios,
)


def crear_payload():
    return {
        "nombre": " Ana ", "apellido": " Prueba ",
        "correo": " ANA@EXAMPLE.ORG ", "password": "synthetic-password",
        "roles": [" gestor ", "ESTUDIANTE", "gestor", " "],
    }


def actualizar_payload(activo=True):
    return {
        "nombre": " Ana ", "apellido": " Prueba ", "activo": activo,
        "roles": [" gestor ", "ESTUDIANTE", "gestor"],
    }


def operacion(mensaje="Usuario creado correctamente"):
    return {"id_usuario": 9, "mensaje": mensaje}


def usuario():
    return {
        "id_usuario": 9, "nombre": "Ana", "apellido": "Prueba",
        "correo": "ana@example.org", "activo": False, "roles": ["ESTUDIANTE"],
    }


class UsuariosAisladosTests(unittest.TestCase):
    def setUp(self):
        self.db = MagicMock(name="db")
        # Protección adicional: cualquier intento de conexión real falla la prueba.
        conexion_patch = patch.object(
            engine, "connect", side_effect=AssertionError("Conexión real no permitida")
        )
        self.conexion_mock = conexion_patch.start()
        self.addCleanup(conexion_patch.stop)
        self.addCleanup(self.conexion_mock.assert_not_called)
        hash_patch = patch(
            "app.usuarios.service.hash_password", return_value="synthetic-hash"
        )
        self.hash_mock = hash_patch.start()
        self.addCleanup(hash_patch.stop)


class UsuariosServiceTests(UsuariosAisladosTests):
    def test_lists_users_with_roles_and_without_committing(self):
        self.db.execute.return_value.mappings.return_value.all.return_value = [usuario()]

        self.assertEqual(listar_usuarios(self.db), [usuario()])

        self.db.execute.assert_called_once()
        sql = " ".join(str(self.db.execute.call_args.args[0]).split())
        for fragmento in (
            "FROM usuario u", "LEFT JOIN usuario_rol", "LEFT JOIN rol",
            "GROUP BY u.id_usuario", "ORDER BY u.apellido, u.nombre",
        ):
            self.assertIn(fragmento, sql)
        self.db.commit.assert_not_called()
        self.db.rollback.assert_not_called()

    def test_lists_only_active_roles_ordered_by_name(self):
        roles = [{"id_rol": 1, "nombre": "ESTUDIANTE", "descripcion": None}]
        self.db.execute.return_value.mappings.return_value.all.return_value = roles

        self.assertEqual(listar_roles(self.db), roles)

        self.db.execute.assert_called_once()
        sql = " ".join(str(self.db.execute.call_args.args[0]).split())
        self.assertIn("FROM rol WHERE activo = TRUE ORDER BY nombre", sql)
        self.db.commit.assert_not_called()
        self.db.rollback.assert_not_called()

    def test_empty_queries_return_empty_lists(self):
        self.db.execute.return_value.mappings.return_value.all.return_value = []
        self.assertEqual(listar_usuarios(self.db), [])
        self.assertEqual(listar_roles(self.db), [])
        self.db.commit.assert_not_called()
        self.db.rollback.assert_not_called()

    def test_create_passes_normalized_data_and_separate_hash_then_commits(self):
        self.db.execute.return_value.scalar_one.return_value = operacion()

        result = crear_usuario(self.db, 55, UsuarioCrearRequest(**crear_payload()))

        self.assertEqual(result, operacion())
        self.db.execute.assert_called_once()
        sql, params = self.db.execute.call_args.args
        self.assertIn("fn_crear_usuario_admin", str(sql))
        self.assertIn("CAST(:datos AS JSONB)", str(sql))
        self.assertEqual(set(params), {"id_admin", "datos", "password_hash"})
        self.assertEqual(params["id_admin"], 55)
        self.assertEqual(params["password_hash"], "synthetic-hash")
        self.assertEqual(json.loads(params["datos"]), {
            "nombre": "Ana", "apellido": "Prueba", "correo": "ana@example.org",
            "roles": ["ESTUDIANTE", "GESTOR"],
        })
        self.hash_mock.assert_called_once_with("synthetic-password")
        self.db.execute.return_value.scalar_one.assert_called_once_with()
        self.db.commit.assert_called_once_with()
        self.db.rollback.assert_not_called()

    def test_update_passes_admin_target_roles_and_activation_then_commits(self):
        for activo in (True, False):
            with self.subTest(activo=activo):
                self.db.reset_mock()
                esperado = operacion("Usuario actualizado correctamente")
                self.db.execute.return_value.scalar_one.return_value = esperado

                result = actualizar_usuario(
                    self.db, 55, 9, UsuarioActualizarRequest(**actualizar_payload(activo))
                )

                self.assertEqual(result, esperado)
                self.db.execute.assert_called_once()
                sql, params = self.db.execute.call_args.args
                self.assertIn("fn_actualizar_usuario_admin", str(sql))
                self.assertIn("CAST(:datos AS JSONB)", str(sql))
                self.assertEqual(set(params), {"id_admin", "id_usuario", "datos"})
                self.assertEqual(params["id_admin"], 55)
                self.assertEqual(params["id_usuario"], 9)
                self.assertEqual(json.loads(params["datos"]), {
                    "nombre": "Ana", "apellido": "Prueba", "activo": activo,
                    "roles": ["ESTUDIANTE", "GESTOR"],
                })
                self.hash_mock.assert_not_called()
                self.db.commit.assert_called_once_with()
                self.db.rollback.assert_not_called()

    def test_known_create_errors_raise_without_commit_or_service_rollback(self):
        for codigo, error in (
            ("CORREO_EXISTENTE", UsuarioDuplicadoError),
            ("ROLES_INVALIDOS", RolesInvalidosError), ("SIN_ROLES", RolesInvalidosError),
        ):
            with self.subTest(codigo=codigo):
                self.db.reset_mock()
                self.db.execute.return_value.scalar_one.return_value = {"error": codigo}
                with self.assertRaises(error):
                    crear_usuario(self.db, 55, UsuarioCrearRequest(**crear_payload()))
                self.db.execute.assert_called_once()
                self.db.commit.assert_not_called()
                self.db.rollback.assert_not_called()

    def test_known_update_errors_raise_without_commit_or_service_rollback(self):
        for codigo, error in (
            ("USUARIO_NO_ENCONTRADO", UsuarioNoEncontradoError),
            ("ROLES_INVALIDOS", RolesInvalidosError), ("SIN_ROLES", RolesInvalidosError),
            ("AUTOGESTION_NO_PERMITIDA", AutogestionNoPermitidaError),
        ):
            with self.subTest(codigo=codigo):
                self.db.reset_mock()
                self.db.execute.return_value.scalar_one.return_value = {"error": codigo}
                with self.assertRaises(error):
                    actualizar_usuario(
                        self.db, 55, 9, UsuarioActualizarRequest(**actualizar_payload())
                    )
                self.db.execute.assert_called_once()
                self.db.commit.assert_not_called()
                self.db.rollback.assert_not_called()

    def test_unhandled_admin_error_is_currently_returned_and_committed(self):
        # Caracteriza una limitación existente; no la establece como conducta deseable.
        for crear in (True, False):
            with self.subTest(crear=crear):
                self.db.reset_mock()
                self.db.execute.return_value.scalar_one.return_value = {"error": "ADMIN_NO_VALIDO"}
                result = (
                    crear_usuario(self.db, 55, UsuarioCrearRequest(**crear_payload()))
                    if crear else actualizar_usuario(
                        self.db, 55, 9, UsuarioActualizarRequest(**actualizar_payload())
                    )
                )
                self.assertEqual(result, {"error": "ADMIN_NO_VALIDO"})
                self.db.commit.assert_called_once_with()
                self.db.rollback.assert_not_called()


class UsuariosRouteTests(UsuariosAisladosTests):
    def setUp(self):
        super().setUp()
        overrides = patch.dict(app.dependency_overrides, {
            get_db: lambda: self.db, get_current_user_id: lambda: 55,
        })
        overrides.start()
        self.addCleanup(overrides.stop)
        contexto_patch = patch(
            "app.core.permissions.obtener_contexto_usuario",
            return_value={"roles": ["ADMINISTRADOR"]},
        )
        self.contexto_mock = contexto_patch.start()
        self.addCleanup(contexto_patch.stop)

    def _request(self, method, path, payload=None, params=None):
        with TestClient(app, raise_server_exceptions=False) as client:
            response = client.request(method, path, json=payload, params=params)
        self.contexto_mock.assert_called_with(db=self.db, id_usuario=55)
        return response

    def test_admin_lists_users_with_current_response(self):
        self.db.execute.return_value.mappings.return_value.all.return_value = [usuario()]
        response = self._request("GET", "/usuarios")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [usuario()])
        self.db.execute.assert_called_once()
        self.db.commit.assert_not_called()
        self.db.rollback.assert_not_called()

    def test_admin_lists_roles_with_current_response(self):
        roles = [{"id_rol": 1, "nombre": "ESTUDIANTE", "descripcion": None}]
        self.db.execute.return_value.mappings.return_value.all.return_value = roles
        response = self._request("GET", "/usuarios/roles")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), roles)
        self.db.execute.assert_called_once()
        self.db.commit.assert_not_called()
        self.db.rollback.assert_not_called()

    def test_admin_creates_user_with_201_using_authenticated_admin(self):
        self.db.execute.return_value.scalar_one.return_value = operacion()
        response = self._request(
            "POST", "/usuarios", {**crear_payload(), "id_admin": 999},
            params={"id_admin": 888},
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json(), operacion())
        self.db.execute.assert_called_once()
        params = self.db.execute.call_args.args[1]
        self.assertEqual(params["id_admin"], 55)
        self.assertEqual(json.loads(params["datos"])["roles"], ["ESTUDIANTE", "GESTOR"])
        self.assertNotIn("id_admin", json.loads(params["datos"]))
        self.assertNotIn("password", json.loads(params["datos"]))
        self.hash_mock.assert_called_once_with("synthetic-password")
        self.db.commit.assert_called_once_with()
        self.db.rollback.assert_not_called()

    def test_admin_updates_target_and_activation_using_authenticated_admin(self):
        for activo in (True, False):
            with self.subTest(activo=activo):
                self.db.reset_mock()
                esperado = operacion("Usuario actualizado correctamente")
                self.db.execute.return_value.scalar_one.return_value = esperado
                response = self._request(
                    "PATCH", "/usuarios/9",
                    {**actualizar_payload(activo), "id_admin": 999, "id_usuario": 777},
                    params={"id_admin": 888},
                )
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json(), esperado)
                self.db.execute.assert_called_once()
                params = self.db.execute.call_args.args[1]
                self.assertEqual(params["id_admin"], 55)
                self.assertEqual(params["id_usuario"], 9)
                datos = json.loads(params["datos"])
                self.assertEqual(datos["activo"], activo)
                self.assertEqual(datos["roles"], ["ESTUDIANTE", "GESTOR"])
                self.assertNotIn("id_admin", datos)
                self.assertNotIn("id_usuario", datos)
                self.db.commit.assert_called_once_with()
                self.db.rollback.assert_not_called()

    def test_all_endpoints_deny_non_admin_roles_before_sql(self):
        for roles in (["ESTUDIANTE"], ["GESTOR"], ["ESTUDIANTE", "GESTOR"], []):
            for method, path, payload in (
                ("GET", "/usuarios", None), ("GET", "/usuarios/roles", None),
                ("POST", "/usuarios", crear_payload()),
                ("PATCH", "/usuarios/9", actualizar_payload()),
            ):
                with self.subTest(roles=roles, method=method, path=path):
                    self.contexto_mock.return_value = {"roles": roles}
                    response = self._request(method, path, payload)
                    self.assertEqual(response.status_code, 403)
                    self.assertEqual(response.json(), {
                        "detail": "No tiene permisos para acceder a esta funcionalidad."
                    })
                    self.db.execute.assert_not_called()
                    self.hash_mock.assert_not_called()
                    self.db.commit.assert_not_called()
                    self.db.rollback.assert_not_called()

    def test_admin_with_additional_roles_is_allowed(self):
        self.contexto_mock.return_value = {"roles": ["ESTUDIANTE", "ADMINISTRADOR"]}
        self.db.execute.return_value.mappings.return_value.all.return_value = []
        response = self._request("GET", "/usuarios")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])

    def _assert_error(self, method, path, payload, codigo, status, mensaje):
        self.db.execute.return_value.scalar_one.return_value = {"error": codigo}
        response = self._request(method, path, payload)
        self.assertEqual(response.status_code, status)
        self.assertEqual(response.json(), {"detail": mensaje})
        self.db.execute.assert_called_once()
        self.db.commit.assert_not_called()
        self.db.rollback.assert_called_once_with()

    def test_duplicate_email_returns_409_and_rolls_back(self):
        self._assert_error(
            "POST", "/usuarios", crear_payload(), "CORREO_EXISTENTE", 409,
            "El correo ya está registrado",
        )

    def test_create_invalid_or_missing_roles_returns_400_and_rolls_back(self):
        for codigo in ("ROLES_INVALIDOS", "SIN_ROLES"):
            with self.subTest(codigo=codigo):
                self.db.reset_mock()
                self._assert_error(
                    "POST", "/usuarios", crear_payload(), codigo, 400,
                    "Debe seleccionar roles válidos",
                )

    def test_missing_update_target_returns_404_and_rolls_back(self):
        self._assert_error(
            "PATCH", "/usuarios/9", actualizar_payload(), "USUARIO_NO_ENCONTRADO",
            404, "Usuario no encontrado",
        )

    def test_update_invalid_or_missing_roles_returns_400_and_rolls_back(self):
        for codigo in ("ROLES_INVALIDOS", "SIN_ROLES"):
            with self.subTest(codigo=codigo):
                self.db.reset_mock()
                self._assert_error(
                    "PATCH", "/usuarios/9", actualizar_payload(), codigo, 400,
                    "Debe seleccionar roles válidos",
                )

    def test_self_deactivation_or_admin_removal_returns_409_and_rolls_back(self):
        # El código de error lo decide SQL; aquí se protege su traducción HTTP.
        for cambios in (
            {"activo": False, "roles": ["ADMINISTRADOR"]},
            {"activo": True, "roles": ["GESTOR"]},
        ):
            with self.subTest(cambios=cambios):
                self.db.reset_mock()
                self._assert_error(
                    "PATCH", "/usuarios/55", {**actualizar_payload(), **cambios},
                    "AUTOGESTION_NO_PERMITIDA", 409,
                    "No puedes desactivar tu cuenta ni quitarte el rol administrador",
                )
                params = self.db.execute.call_args.args[1]
                self.assertEqual(params["id_admin"], params["id_usuario"])

    def test_unhandled_admin_error_currently_causes_500_after_commit(self):
        for method, path, payload in (
            ("POST", "/usuarios", crear_payload()),
            ("PATCH", "/usuarios/9", actualizar_payload()),
        ):
            with self.subTest(method=method):
                self.db.reset_mock()
                self.db.execute.return_value.scalar_one.return_value = {"error": "ADMIN_NO_VALIDO"}
                response = self._request(method, path, payload)
                self.assertEqual(response.status_code, 500)
                self.db.commit.assert_called_once_with()
                self.db.rollback.assert_not_called()

    def test_invalid_requests_return_422_without_sql(self):
        for method, path, payload in (
            ("POST", "/usuarios", {**crear_payload(), "correo": "invalid"}),
            ("POST", "/usuarios", {**crear_payload(), "password": "short"}),
            ("POST", "/usuarios", {**crear_payload(), "roles": []}),
            ("PATCH", "/usuarios/9", {"nombre": "Ana", "apellido": "Prueba", "roles": ["GESTOR"]}),
            ("PATCH", "/usuarios/not-an-id", actualizar_payload()),
        ):
            with self.subTest(method=method, path=path, payload_fields=list(payload)):
                response = self._request(method, path, payload)
                self.assertEqual(response.status_code, 422)
                self.db.execute.assert_not_called()
                self.hash_mock.assert_not_called()
                self.db.commit.assert_not_called()
                self.db.rollback.assert_not_called()


class UsuariosSchemasTests(unittest.TestCase):
    def test_create_normalizes_names_email_and_unique_sorted_roles(self):
        datos = UsuarioCrearRequest(**crear_payload())
        self.assertEqual(datos.nombre, "Ana")
        self.assertEqual(datos.apellido, "Prueba")
        self.assertEqual(str(datos.correo), "ana@example.org")
        self.assertEqual(datos.roles, ["ESTUDIANTE", "GESTOR"])

    def test_create_rejects_invalid_lengths_email_password_and_empty_roles(self):
        for campo, valor in (
            ("nombre", " "), ("apellido", "A"), ("nombre", "A" * 101),
            ("apellido", "A" * 101), ("correo", "invalid"),
            ("password", "x" * 7), ("password", "x" * 129),
            ("roles", []), ("roles", [" ", ""]),
        ):
            with self.subTest(campo=campo, length=len(valor)):
                with self.assertRaises(ValidationError):
                    UsuarioCrearRequest(**{**crear_payload(), campo: valor})

    def test_password_boundaries_are_accepted_by_schema_only(self):
        # No verifica compatibilidad con bcrypt ni ejecuta hashing real.
        for length in (8, 128):
            with self.subTest(length=length):
                datos = UsuarioCrearRequest(**{**crear_payload(), "password": "x" * length})
                self.assertEqual(len(datos.password), length)

    def test_update_requires_name_surname_activation_and_roles(self):
        for campo in ("nombre", "apellido", "activo", "roles"):
            with self.subTest(campo=campo):
                payload = actualizar_payload()
                del payload[campo]
                with self.assertRaises(ValidationError):
                    UsuarioActualizarRequest(**payload)

    def test_update_normalizes_names_roles_and_accepts_both_activation_states(self):
        for activo in (True, False):
            with self.subTest(activo=activo):
                datos = UsuarioActualizarRequest(**actualizar_payload(activo))
                self.assertEqual(datos.nombre, "Ana")
                self.assertEqual(datos.apellido, "Prueba")
                self.assertEqual(datos.roles, ["ESTUDIANTE", "GESTOR"])
                self.assertEqual(datos.activo, activo)

    def test_update_rejects_blank_names_and_roles(self):
        for campo, valor in (("nombre", " "), ("apellido", " "), ("roles", []), ("roles", [" "])):
            with self.subTest(campo=campo):
                with self.assertRaises(ValidationError):
                    UsuarioActualizarRequest(**{**actualizar_payload(), campo: valor})

    def test_role_membership_is_not_validated_by_schemas(self):
        for schema, payload in (
            (UsuarioCrearRequest, crear_payload()),
            (UsuarioActualizarRequest, actualizar_payload()),
        ):
            with self.subTest(schema=schema.__name__):
                datos = schema(**{**payload, "roles": [" rol_inexistente "]})
                self.assertEqual(datos.roles, ["ROL_INEXISTENTE"])

    def test_update_ignores_email_and_password_extra_fields(self):
        datos = UsuarioActualizarRequest(**{
            **actualizar_payload(), "correo": "other@example.org", "password": "synthetic-password",
        })
        self.assertEqual(set(datos.model_dump()), {"nombre", "apellido", "activo", "roles"})


if __name__ == "__main__":
    unittest.main()
