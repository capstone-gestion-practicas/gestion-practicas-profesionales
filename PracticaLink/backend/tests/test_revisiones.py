import os
import unittest
from datetime import datetime
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient


os.environ.setdefault(
    "SUPABASE_DATABASE_URL",
    "postgresql+psycopg://user:password@localhost:5432/practicalink_test",
)
os.environ.setdefault("JWT_SECRET_KEY", "unit-test-secret")

from app.services.revision_service import listar_solicitudes  # noqa: E402
from app.core.database import get_db  # noqa: E402
from app.core.security import get_current_user_id  # noqa: E402
from app.main import app  # noqa: E402


class ListarSolicitudesTests(unittest.TestCase):
    def test_returns_minimal_data_for_each_solicitud(self) -> None:
        db = MagicMock(name="db")
        db.execute.return_value.mappings.return_value.all.return_value = [
            {
                "id_practica": 101,
                "fecha_registro": datetime(2026, 9, 1, 10, 30, 0),
                "estado": "REGISTRADA",
                "estudiante": "Ana Perez",
                "rut_estudiante": "12.345.678-5",
                "centro_practica": "Centro de prueba",
            },
            {
                "id_practica": 202,
                "fecha_registro": datetime(2026, 9, 2, 9, 15, 0),
                "estado": "EN_REVISION",
                "estudiante": "Bruno Soto",
                "rut_estudiante": "11.222.333-4",
                "centro_practica": "Centro Norte",
            },
        ]

        resultado = listar_solicitudes(db)

        self.assertEqual(
            resultado,
            [
                {
                    "id_practica": 101,
                    "fecha_registro": datetime(2026, 9, 1, 10, 30, 0),
                    "estado": "REGISTRADA",
                    "estudiante": "Ana Perez",
                    "rut_estudiante": "12.345.678-5",
                    "centro_practica": "Centro de prueba",
                },
                {
                    "id_practica": 202,
                    "fecha_registro": datetime(2026, 9, 2, 9, 15, 0),
                    "estado": "EN_REVISION",
                    "estudiante": "Bruno Soto",
                    "rut_estudiante": "11.222.333-4",
                    "centro_practica": "Centro Norte",
                },
            ],
        )

        db.execute.assert_called_once()
        sql = str(db.execute.call_args.args[0])
        self.assertIn("SELECT p.id_practica", sql)
        self.assertIn("CONCAT(u.nombre, ' ', u.apellido) AS estudiante", sql)
        self.assertIn("ep.nombre AS estado", sql)
        self.assertIn("WHERE ep.nombre IN ('REGISTRADA', 'EN_REVISION', 'OBSERVADA')", sql)

    def test_returns_empty_list_when_there_are_no_solicitudes(self) -> None:
        db = MagicMock(name="db")
        db.execute.return_value.mappings.return_value.all.return_value = []

        resultado = listar_solicitudes(db)

        self.assertEqual(resultado, [])
        db.execute.assert_called_once()


class ListarSolicitudesRouteTests(unittest.TestCase):
    def _override_dependencies(self, db: MagicMock, user_id: int) -> dict:
        original_overrides = dict(app.dependency_overrides)
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[get_current_user_id] = lambda: user_id
        return original_overrides

    def test_allows_gestor_to_access_listado(self) -> None:
        db = MagicMock(name="db")
        expected_response = [
            {
                "id_practica": 101,
                "fecha_registro": "2026-09-01T10:30:00",
                "estado": "REGISTRADA",
                "estudiante": "Ana Perez",
                "rut_estudiante": "12.345.678-5",
                "centro_practica": "Centro de prueba",
            }
        ]

        original_overrides = self._override_dependencies(db, user_id=55)

        try:
            with patch(
                "app.core.permissions.obtener_contexto_usuario",
                return_value={"roles": ["GESTOR"]},
            ) as contexto_mock, patch(
                "app.api.routes.revisiones.listar_solicitudes",
                return_value=expected_response,
            ) as listar_mock:
                with TestClient(app) as client:
                    response = client.get("/revisiones/solicitudes")

                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json(), expected_response)
                contexto_mock.assert_called_once_with(db=db, id_usuario=55)
                listar_mock.assert_called_once_with(db)
        finally:
            app.dependency_overrides.clear()
            app.dependency_overrides.update(original_overrides)

    def test_allows_administrador_to_access_listado(self) -> None:
        db = MagicMock(name="db")
        expected_response = [
            {
                "id_practica": 202,
                "fecha_registro": "2026-09-02T09:15:00",
                "estado": "EN_REVISION",
                "estudiante": "Bruno Soto",
                "rut_estudiante": "11.222.333-4",
                "centro_practica": "Centro Norte",
            }
        ]

        original_overrides = self._override_dependencies(db, user_id=77)

        try:
            with patch(
                "app.core.permissions.obtener_contexto_usuario",
                return_value={"roles": ["ADMINISTRADOR"]},
            ) as contexto_mock, patch(
                "app.api.routes.revisiones.listar_solicitudes",
                return_value=expected_response,
            ) as listar_mock:
                with TestClient(app) as client:
                    response = client.get("/revisiones/solicitudes")

                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json(), expected_response)
                contexto_mock.assert_called_once_with(db=db, id_usuario=77)
                listar_mock.assert_called_once_with(db)
        finally:
            app.dependency_overrides.clear()
            app.dependency_overrides.update(original_overrides)

    def test_rejects_unauthorized_role(self) -> None:
        db = MagicMock(name="db")
        original_overrides = self._override_dependencies(db, user_id=99)

        try:
            with patch(
                "app.core.permissions.obtener_contexto_usuario",
                return_value={"roles": ["ESTUDIANTE"]},
            ) as contexto_mock, patch(
                "app.api.routes.revisiones.listar_solicitudes"
            ) as listar_mock:
                with TestClient(app) as client:
                    response = client.get("/revisiones/solicitudes")

                self.assertEqual(response.status_code, 403)
                listar_mock.assert_not_called()
                contexto_mock.assert_called_once_with(db=db, id_usuario=99)
        finally:
            app.dependency_overrides.clear()
            app.dependency_overrides.update(original_overrides)

    def test_endpoint_keeps_expected_list_contract(self) -> None:
        db = MagicMock(name="db")
        expected_response = [
            {
                "id_practica": 303,
                "fecha_registro": "2026-09-03T08:45:00",
                "estado": "OBSERVADA",
                "estudiante": "Carla Rojas",
                "rut_estudiante": "10.111.222-3",
                "centro_practica": "Centro Sur",
            },
            {
                "id_practica": 404,
                "fecha_registro": "2026-09-04T11:00:00",
                "estado": "REGISTRADA",
                "estudiante": "Daniela Silva",
                "rut_estudiante": "9.888.777-6",
                "centro_practica": "Centro Oriente",
            },
        ]

        original_overrides = self._override_dependencies(db, user_id=88)

        try:
            with patch(
                "app.core.permissions.obtener_contexto_usuario",
                return_value={"roles": ["GESTOR"]},
            ), patch(
                "app.api.routes.revisiones.listar_solicitudes",
                return_value=expected_response,
            ):
                with TestClient(app) as client:
                    response = client.get("/revisiones/solicitudes")

                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json(), expected_response)
                self.assertEqual(len(response.json()), 2)
                self.assertEqual(
                    set(response.json()[0].keys()),
                    {
                        "id_practica",
                        "fecha_registro",
                        "estado",
                        "estudiante",
                        "rut_estudiante",
                        "centro_practica",
                    },
                )
        finally:
            app.dependency_overrides.clear()
            app.dependency_overrides.update(original_overrides)


if __name__ == "__main__":
    unittest.main()
