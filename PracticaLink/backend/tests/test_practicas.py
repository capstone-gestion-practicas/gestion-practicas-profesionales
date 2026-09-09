import os
import unittest
from datetime import date
from unittest.mock import MagicMock, patch

from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from pydantic import ValidationError


os.environ.setdefault(
    "SUPABASE_DATABASE_URL",
    "postgresql+psycopg://user:password@localhost:5432/practicalink_test",
)
os.environ.setdefault("JWT_SECRET_KEY", "unit-test-secret")

from app.core.database import get_db  # noqa: E402
from app.core.security import get_current_user_id  # noqa: E402
from app.main import app  # noqa: E402
from app.practicas.routes import router as practicas_router  # noqa: E402
from app.practicas.schemas import (  # noqa: E402
    PracticaCreate,
    PracticaCreateResponse,
    PracticaDetalleResponse,
)
from app.practicas.service import (  # noqa: E402
    PracticaActivaError,
    PracticaNoEncontradaError,
    PerfilEstudianteNoEncontradoError,
    obtener_practica_del_estudiante,
    registrar_practica,
)


class PracticaCreateTests(unittest.TestCase):
    def test_accepts_representative_payload(self) -> None:
        model = PracticaCreate(
            centro={
                "nombre": "Centro de prueba",
                "rut_empresa": "12.345.678-5",
                "direccion": "Av. Siempre Viva 123",
                "telefono": "+56 9 1234 5678",
                "correo": " contacto@empresa.cl ",
                "contacto_nombre": "Maria Perez",
                "contacto_cargo": "Jefa de practica",
            },
            fecha_inicio=date(2026, 3, 2),
            fecha_termino=date(2026, 6, 30),
            horas=360,
            cargo_funcion="Desarrollador",
            descripcion="Practica de caracterizacion",
        )

        self.assertEqual(model.centro.nombre, "Centro de prueba")
        self.assertEqual(model.centro.correo, "contacto@empresa.cl")
        self.assertEqual(model.horas, 360)

    def test_rejects_end_date_before_start_date(self) -> None:
        with self.assertRaises(ValidationError):
            PracticaCreate(
                centro={"nombre": "Centro de prueba"},
                fecha_inicio=date(2026, 6, 30),
                fecha_termino=date(2026, 3, 2),
            )

    def test_horas_accepts_none_and_rejects_non_positive_values(self) -> None:
        model = PracticaCreate(
            centro={"nombre": "Centro de prueba"},
            horas=None,
        )
        self.assertIsNone(model.horas)

        with self.assertRaises(ValidationError):
            PracticaCreate(
                centro={"nombre": "Centro de prueba"},
                horas=0,
            )


class RegistrarPracticaTests(unittest.TestCase):
    def test_executes_current_sql_and_serializes_payload(self) -> None:
        db = MagicMock()
        db.execute.return_value.scalar_one.return_value = {
            "id_practica": 101,
            "id_centro": 202,
            "estado": "REGISTRADA",
            "mensaje": "Practica registrada correctamente",
        }
        datos = PracticaCreate(
            centro={"nombre": "Centro de prueba"},
            fecha_inicio=date(2026, 3, 2),
            fecha_termino=date(2026, 6, 30),
            horas=360,
            cargo_funcion="Desarrollador",
            descripcion="Practica de caracterizacion",
        )

        resultado = registrar_practica(db, 55, datos)

        self.assertEqual(resultado["estado"], "REGISTRADA")
        db.execute.assert_called_once()
        sql = db.execute.call_args.args[0]
        params = db.execute.call_args.args[1]
        self.assertIn("fn_registrar_practica", str(sql))
        self.assertEqual(params["id_usuario"], 55)
        self.assertEqual(params["datos"], datos.model_dump_json())
        db.commit.assert_called_once_with()

    def test_raises_existing_business_error_without_committing(self) -> None:
        db = MagicMock()
        db.execute.return_value.scalar_one.return_value = {
            "error": "PRACTICA_ACTIVA"
        }
        datos = PracticaCreate(
            centro={"nombre": "Centro de prueba"},
        )

        with self.assertRaises(PracticaActivaError):
            registrar_practica(db, 55, datos)

        db.execute.assert_called_once()
        db.commit.assert_not_called()


class PracticasRouteTests(unittest.TestCase):
    def _get_practicas_get_route(self) -> APIRoute:
        for route in practicas_router.routes:
            if not isinstance(route, APIRoute):
                continue

            if "GET" not in route.methods:
                continue

            if route.endpoint.__name__ == "obtener_mi_practica":
                return route

        raise AssertionError("No se encontro el endpoint GET /practicas/me en practicas_router")

    def _get_practicas_post_route(self) -> APIRoute:
        for route in practicas_router.routes:
            if not isinstance(route, APIRoute):
                continue

            if "POST" not in route.methods:
                continue

            if route.endpoint.__name__ == "crear_practica":
                return route

        raise AssertionError("No se encontro el endpoint POST /practicas en practicas_router")

    def _valid_payload(self) -> dict:
        return {
            "centro": {
                "nombre": "Centro de prueba",
                "rut_empresa": "12.345.678-5",
                "direccion": "Av. Siempre Viva 123",
                "telefono": "+56 9 1234 5678",
                "correo": "contacto@empresa.cl",
                "contacto_nombre": "Maria Perez",
                "contacto_cargo": "Jefa de practica",
            },
            "fecha_inicio": "2026-03-02",
            "fecha_termino": "2026-06-30",
            "horas": 360,
            "cargo_funcion": "Desarrollador",
            "descripcion": "Practica de caracterizacion",
        }

    def test_route_is_registered_with_expected_contract(self) -> None:
        route = self._get_practicas_post_route()

        self.assertIn("POST", route.methods)
        self.assertEqual(route.path.rstrip("/") or "/", "/practicas")
        self.assertEqual(route.endpoint.__name__, "crear_practica")
        self.assertIs(route.response_model, PracticaCreateResponse)

        dependency_calls = []

        def collect(dependant):
            for child in dependant.dependencies:
                dependency_calls.append(child.call)
                collect(child)

        collect(route.dependant)

        self.assertIn(get_current_user_id, dependency_calls)

        roles_dependency = next(
            dep.call
            for dep in route.dependant.dependencies
            if getattr(dep.call, "__name__", "") == "verificar_roles"
        )
        closure_values = [
            cell.cell_contents
            for cell in (roles_dependency.__closure__ or ())
        ]
        self.assertIn({"ESTUDIANTE"}, closure_values)

    def test_get_my_practice_route_is_registered_with_expected_contract(self) -> None:
        route = self._get_practicas_get_route()

        self.assertIn("GET", route.methods)
        self.assertEqual(route.path.rstrip("/") or "/", "/practicas/me")
        self.assertEqual(route.endpoint.__name__, "obtener_mi_practica")
        self.assertIs(route.response_model, PracticaDetalleResponse)

        dependency_calls = []

        def collect(dependant):
            for child in dependant.dependencies:
                dependency_calls.append(child.call)
                collect(child)

        collect(route.dependant)

        self.assertIn(get_current_user_id, dependency_calls)

        roles_dependency = next(
            dep.call
            for dep in route.dependant.dependencies
            if getattr(dep.call, "__name__", "") == "verificar_roles"
        )
        closure_values = [
            cell.cell_contents
            for cell in (roles_dependency.__closure__ or ())
        ]
        self.assertIn({"ESTUDIANTE"}, closure_values)

    def test_crear_practica_success_with_overrides_and_mocks(self) -> None:
        db = MagicMock(name="db")
        expected_response = {
            "id_practica": 777,
            "id_centro": 888,
            "estado": "REGISTRADA",
            "mensaje": "Practica registrada correctamente",
        }

        original_overrides = dict(app.dependency_overrides)
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[get_current_user_id] = lambda: 123

        try:
            with patch(
                "app.core.permissions.obtener_contexto_usuario",
                return_value={"roles": ["ESTUDIANTE"]},
            ) as obtener_contexto_usuario, patch(
                "app.practicas.routes.registrar_practica",
                return_value=expected_response,
            ) as registrar_mock:
                with TestClient(app) as client:
                    response = client.post(
                        "/practicas",
                        json=self._valid_payload(),
                    )

                self.assertEqual(response.status_code, 201)
                self.assertEqual(response.json(), expected_response)
                registrar_mock.assert_called_once()
                obtener_contexto_usuario.assert_called()
        finally:
            app.dependency_overrides.clear()
            app.dependency_overrides.update(original_overrides)

    def test_rejects_non_student_role(self) -> None:
        db = MagicMock(name="db")
        original_overrides = dict(app.dependency_overrides)
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[get_current_user_id] = lambda: 123

        try:
            with patch(
                "app.core.permissions.obtener_contexto_usuario",
                return_value={"roles": ["ADMINISTRADOR"]},
            ), patch("app.practicas.routes.registrar_practica") as registrar_mock:
                with TestClient(app) as client:
                    response = client.post(
                        "/practicas",
                        json=self._valid_payload(),
                    )

                self.assertEqual(response.status_code, 403)
                registrar_mock.assert_not_called()
        finally:
            app.dependency_overrides.clear()
            app.dependency_overrides.update(original_overrides)

    def test_get_my_practice_success_with_overrides_and_mocks(self) -> None:
        db = MagicMock(name="db")
        expected_response = {
            "id_practica": 777,
            "fecha_registro": "2026-09-01T10:30:00",
            "estado": {
                "id_estado": 1,
                "nombre": "REGISTRADA",
                "es_final": False,
            },
            "centro_practica": {
                "id_centro": 888,
                "nombre": "Centro de prueba",
                "rut_empresa": "12.345.678-5",
                "direccion": "Av. Siempre Viva 123",
                "telefono": "+56 9 1234 5678",
                "correo": "contacto@empresa.cl",
                "contacto_nombre": "Maria Perez",
                "contacto_cargo": "Jefa de practica",
            },
            "fecha_inicio": "2026-03-02",
            "fecha_termino": "2026-06-30",
            "horas": 360,
            "cargo_funcion": "Desarrollador",
            "descripcion": "Practica de caracterizacion",
        }

        original_overrides = dict(app.dependency_overrides)
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[get_current_user_id] = lambda: 123

        try:
            with patch(
                "app.core.permissions.obtener_contexto_usuario",
                return_value={"roles": ["ESTUDIANTE"]},
            ) as obtener_contexto_usuario, patch(
                "app.practicas.routes.obtener_practica_del_estudiante",
                return_value=expected_response,
            ) as obtener_mock:
                with TestClient(app) as client:
                    response = client.get(
                        "/practicas/me?id_practica=999",
                    )

                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json(), expected_response)
                obtener_mock.assert_called_once_with(db, 123)
                obtener_contexto_usuario.assert_called()
        finally:
            app.dependency_overrides.clear()
            app.dependency_overrides.update(original_overrides)

    def test_get_my_practice_rejects_missing_student_profile(self) -> None:
        db = MagicMock(name="db")
        original_overrides = dict(app.dependency_overrides)
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[get_current_user_id] = lambda: 123

        try:
            with patch(
                "app.core.permissions.obtener_contexto_usuario",
                return_value={"roles": ["ESTUDIANTE"]},
            ), patch(
                "app.practicas.routes.obtener_practica_del_estudiante",
                side_effect=PerfilEstudianteNoEncontradoError,
            ):
                with TestClient(app) as client:
                    response = client.get("/practicas/me")

                self.assertEqual(response.status_code, 404)
                self.assertEqual(
                    response.json()["detail"],
                    "El usuario no tiene un perfil de estudiante",
                )
        finally:
            app.dependency_overrides.clear()
            app.dependency_overrides.update(original_overrides)

    def test_get_my_practice_rejects_missing_practice(self) -> None:
        db = MagicMock(name="db")
        original_overrides = dict(app.dependency_overrides)
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[get_current_user_id] = lambda: 123

        try:
            with patch(
                "app.core.permissions.obtener_contexto_usuario",
                return_value={"roles": ["ESTUDIANTE"]},
            ), patch(
                "app.practicas.routes.obtener_practica_del_estudiante",
                side_effect=PracticaNoEncontradaError,
            ):
                with TestClient(app) as client:
                    response = client.get("/practicas/me")

                self.assertEqual(response.status_code, 404)
                self.assertEqual(
                    response.json()["detail"],
                    "El estudiante no tiene una práctica registrada",
                )
        finally:
            app.dependency_overrides.clear()
            app.dependency_overrides.update(original_overrides)

    def test_get_my_practice_rejects_non_student_role(self) -> None:
        db = MagicMock(name="db")
        original_overrides = dict(app.dependency_overrides)
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[get_current_user_id] = lambda: 123

        try:
            with patch(
                "app.core.permissions.obtener_contexto_usuario",
                return_value={"roles": ["ADMINISTRADOR"]},
            ), patch(
                "app.practicas.routes.obtener_practica_del_estudiante"
            ) as obtener_mock:
                with TestClient(app) as client:
                    response = client.get("/practicas/me")

                self.assertEqual(response.status_code, 403)
                obtener_mock.assert_not_called()
        finally:
            app.dependency_overrides.clear()
            app.dependency_overrides.update(original_overrides)

    def test_get_my_practice_does_not_accept_external_practice_id(self) -> None:
        db = MagicMock(name="db")
        original_overrides = dict(app.dependency_overrides)
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[get_current_user_id] = lambda: 123

        try:
            with patch(
                "app.core.permissions.obtener_contexto_usuario",
                return_value={"roles": ["ESTUDIANTE"]},
            ), patch(
                "app.practicas.routes.obtener_practica_del_estudiante",
                return_value={
                    "id_practica": 777,
                    "fecha_registro": "2026-09-01T10:30:00",
                    "estado": {
                        "id_estado": 1,
                        "nombre": "REGISTRADA",
                        "es_final": False,
                    },
                    "centro_practica": {
                        "id_centro": 888,
                        "nombre": "Centro de prueba",
                        "rut_empresa": "12.345.678-5",
                        "direccion": "Av. Siempre Viva 123",
                        "telefono": "+56 9 1234 5678",
                        "correo": "contacto@empresa.cl",
                        "contacto_nombre": "Maria Perez",
                        "contacto_cargo": "Jefa de practica",
                    },
                    "fecha_inicio": "2026-03-02",
                    "fecha_termino": "2026-06-30",
                    "horas": 360,
                    "cargo_funcion": "Desarrollador",
                    "descripcion": "Practica de caracterizacion",
                },
            ) as obtener_mock:
                with TestClient(app) as client:
                    response = client.get("/practicas/me?id_practica=999")

                self.assertEqual(response.status_code, 200)
                obtener_mock.assert_called_once_with(db, 123)
                self.assertEqual(response.json()["id_practica"], 777)
        finally:
            app.dependency_overrides.clear()
            app.dependency_overrides.update(original_overrides)


if __name__ == "__main__":
    unittest.main()
