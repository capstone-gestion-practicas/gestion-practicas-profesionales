import os
import unittest
from datetime import date, datetime
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient


os.environ.setdefault(
    "SUPABASE_DATABASE_URL",
    "postgresql+psycopg://user:password@localhost:5432/practicalink_test",
)
os.environ.setdefault("JWT_SECRET_KEY", "unit-test-secret")

from app.services.revision_service import listar_solicitudes, obtener_solicitud  # noqa: E402
from app.services.revision_service import (  # noqa: E402
    SolicitudNoEncontradaError,
    SolicitudNoRevisableError,
    resolver_solicitud,
)
from app.core.database import get_db  # noqa: E402
from app.core.security import get_current_user_id  # noqa: E402
from app.main import app  # noqa: E402
from app.revisiones.schemas import (  # noqa: E402
    DecisionRevisionRequest,
    DecisionRevisionResponse,
    SolicitudRevisionDetalle,
)


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


class ObtenerSolicitudTests(unittest.TestCase):
    def test_returns_expected_antecedents(self) -> None:
        db = MagicMock(name="db")
        db.execute.return_value.mappings.return_value.first.return_value = {
            "id_practica": 101,
            "fecha_registro": datetime(2026, 9, 1, 10, 30, 0),
            "estado": "REGISTRADA",
            "estudiante": "Ana Perez",
            "rut_estudiante": "12.345.678-5",
            "correo_estudiante": "ana@practicalink.cl",
            "carrera": "Ingenieria",
            "sede": "Santiago",
            "centro_practica": "Centro de prueba",
            "rut_empresa": "76.123.456-7",
            "direccion_empresa": "Av. Siempre Viva 123",
            "correo_empresa": "contacto@empresa.cl",
            "contacto_nombre": "Maria Perez",
            "contacto_cargo": "Jefa de practica",
            "fecha_inicio": date(2026, 3, 2),
            "fecha_termino": date(2026, 6, 30),
            "horas": 360,
            "cargo_funcion": "Desarrollador",
            "descripcion": "Practica de caracterizacion",
        }

        resultado = obtener_solicitud(db, 101)

        self.assertIsNotNone(resultado)
        self.assertEqual(resultado["id_practica"], 101)
        self.assertEqual(resultado["estudiante"], "Ana Perez")
        self.assertEqual(resultado["estado"], "REGISTRADA")
        db.execute.assert_called_once()
        sql = str(db.execute.call_args.args[0])
        self.assertIn("WHERE p.id_practica = :id_practica", sql)

    def test_returns_none_when_request_does_not_exist(self) -> None:
        db = MagicMock(name="db")
        db.execute.return_value.mappings.return_value.first.return_value = None

        resultado = obtener_solicitud(db, 999)

        self.assertIsNone(resultado)
        db.execute.assert_called_once()


class ObtenerSolicitudRouteTests(unittest.TestCase):
    def _override_dependencies(self, db: MagicMock, user_id: int) -> dict:
        original_overrides = dict(app.dependency_overrides)
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[get_current_user_id] = lambda: user_id
        return original_overrides

    def test_allows_gestor_to_access_detail(self) -> None:
        db = MagicMock(name="db")
        expected_response = {
            "id_practica": 101,
            "fecha_registro": "2026-09-01T10:30:00",
            "estado": "REGISTRADA",
            "estudiante": "Ana Perez",
            "rut_estudiante": "12.345.678-5",
            "correo_estudiante": "ana@practicalink.cl",
            "carrera": "Ingenieria",
            "sede": "Santiago",
            "centro_practica": "Centro de prueba",
            "rut_empresa": "76.123.456-7",
            "direccion_empresa": "Av. Siempre Viva 123",
            "correo_empresa": "contacto@empresa.cl",
            "contacto_nombre": "Maria Perez",
            "contacto_cargo": "Jefa de practica",
            "fecha_inicio": "2026-03-02",
            "fecha_termino": "2026-06-30",
            "horas": 360,
            "cargo_funcion": "Desarrollador",
            "descripcion": "Practica de caracterizacion",
        }

        original_overrides = self._override_dependencies(db, user_id=55)

        try:
            with patch(
                "app.core.permissions.obtener_contexto_usuario",
                return_value={"roles": ["GESTOR"]},
            ) as contexto_mock, patch(
                "app.api.routes.revisiones.obtener_solicitud",
                return_value=expected_response,
            ) as obtener_mock:
                with TestClient(app) as client:
                    response = client.get("/revisiones/solicitudes/101")

                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json(), expected_response)
                contexto_mock.assert_called_once_with(db=db, id_usuario=55)
                obtener_mock.assert_called_once_with(db, 101)
        finally:
            app.dependency_overrides.clear()
            app.dependency_overrides.update(original_overrides)

    def test_allows_administrador_to_access_detail(self) -> None:
        db = MagicMock(name="db")
        expected_response = {
            "id_practica": 202,
            "fecha_registro": "2026-09-02T11:00:00",
            "estado": "EN_REVISION",
            "estudiante": "Bruno Soto",
            "rut_estudiante": "11.222.333-4",
            "correo_estudiante": "bruno@practicalink.cl",
            "carrera": "Ingenieria",
            "sede": "Valparaiso",
            "centro_practica": "Centro Norte",
            "rut_empresa": None,
            "direccion_empresa": None,
            "correo_empresa": None,
            "contacto_nombre": None,
            "contacto_cargo": None,
            "fecha_inicio": None,
            "fecha_termino": None,
            "horas": None,
            "cargo_funcion": None,
            "descripcion": None,
        }

        original_overrides = self._override_dependencies(db, user_id=77)

        try:
            with patch(
                "app.core.permissions.obtener_contexto_usuario",
                return_value={"roles": ["ADMINISTRADOR"]},
            ) as contexto_mock, patch(
                "app.api.routes.revisiones.obtener_solicitud",
                return_value=expected_response,
            ) as obtener_mock:
                with TestClient(app) as client:
                    response = client.get("/revisiones/solicitudes/202")

                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json(), expected_response)
                contexto_mock.assert_called_once_with(db=db, id_usuario=77)
                obtener_mock.assert_called_once_with(db, 202)
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
                "app.api.routes.revisiones.obtener_solicitud"
            ) as obtener_mock:
                with TestClient(app) as client:
                    response = client.get("/revisiones/solicitudes/101")

                self.assertEqual(response.status_code, 403)
                obtener_mock.assert_not_called()
                contexto_mock.assert_called_once_with(db=db, id_usuario=99)
        finally:
            app.dependency_overrides.clear()
            app.dependency_overrides.update(original_overrides)

    def test_returns_404_for_missing_request(self) -> None:
        db = MagicMock(name="db")
        original_overrides = self._override_dependencies(db, user_id=55)

        try:
            with patch(
                "app.core.permissions.obtener_contexto_usuario",
                return_value={"roles": ["GESTOR"]},
            ), patch(
                "app.api.routes.revisiones.obtener_solicitud",
                return_value=None,
            ) as obtener_mock:
                with TestClient(app) as client:
                    response = client.get("/revisiones/solicitudes/999")

                self.assertEqual(response.status_code, 404)
                self.assertEqual(response.json()["detail"], "La solicitud no existe")
                obtener_mock.assert_called_once_with(db, 999)
        finally:
            app.dependency_overrides.clear()
            app.dependency_overrides.update(original_overrides)

    def test_response_keeps_expected_contract(self) -> None:
        db = MagicMock(name="db")
        payload = {
            "id_practica": 303,
            "fecha_registro": "2026-09-03T08:45:00",
            "estado": "OBSERVADA",
            "estudiante": "Carla Rojas",
            "rut_estudiante": "10.111.222-3",
            "correo_estudiante": "carla@practicalink.cl",
            "carrera": "Ingenieria",
            "sede": "Santiago",
            "centro_practica": "Centro Sur",
            "rut_empresa": "76.987.654-3",
            "direccion_empresa": "Calle Uno 123",
            "correo_empresa": "contacto@centrosur.cl",
            "contacto_nombre": "Luis Perez",
            "contacto_cargo": "Supervisor",
            "fecha_inicio": "2026-03-02",
            "fecha_termino": "2026-06-30",
            "horas": 360,
            "cargo_funcion": "Desarrollador",
            "descripcion": "Practica de caracterizacion",
        }

        original_overrides = self._override_dependencies(db, user_id=88)

        try:
            with patch(
                "app.core.permissions.obtener_contexto_usuario",
                return_value={"roles": ["GESTOR"]},
            ), patch(
                "app.api.routes.revisiones.obtener_solicitud",
                return_value=payload,
            ):
                with TestClient(app) as client:
                    response = client.get("/revisiones/solicitudes/303")

                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json(), payload)
                model = SolicitudRevisionDetalle(**response.json())
                self.assertEqual(model.id_practica, 303)
                self.assertEqual(model.estudiante, "Carla Rojas")
                self.assertEqual(model.estado, "OBSERVADA")
                self.assertEqual(model.carrera, "Ingenieria")
                self.assertEqual(model.centro_practica, "Centro Sur")
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


class ResolverSolicitudTests(unittest.TestCase):
    def test_resolver_aprobada_commits_and_uses_current_contract(self) -> None:
        db = MagicMock(name="db")
        db.execute.return_value.scalar_one.return_value = {
            "id_practica": 101,
            "estado": "APROBADA",
            "mensaje": "Solicitud revisada correctamente",
        }
        datos = DecisionRevisionRequest(decision="APROBADA")

        resultado = resolver_solicitud(db, 101, 55, datos)

        self.assertEqual(resultado["estado"], "APROBADA")
        db.execute.assert_called_once()
        sql = str(db.execute.call_args.args[0])
        params = db.execute.call_args.args[1]
        self.assertIn("fn_revisar_practica", sql)
        self.assertEqual(params["id_practica"], 101)
        self.assertEqual(params["id_usuario"], 55)
        self.assertEqual(params["decision"], "APROBADA")
        self.assertIsNone(params["observacion"])
        db.commit.assert_called_once_with()

    def test_resolver_observada_requires_observation_in_request(self) -> None:
        with self.assertRaises(ValueError):
            DecisionRevisionRequest(decision="OBSERVADA")

    def test_resolver_rechazada_requires_observation_in_request(self) -> None:
        with self.assertRaises(ValueError):
            DecisionRevisionRequest(decision="RECHAZADA")

    def test_resolver_observada_commits_with_observation(self) -> None:
        db = MagicMock(name="db")
        db.execute.return_value.scalar_one.return_value = {
            "id_practica": 202,
            "estado": "OBSERVADA",
            "mensaje": "Solicitud revisada correctamente",
        }
        datos = DecisionRevisionRequest(
            decision="OBSERVADA",
            observacion="Faltan antecedentes"
        )

        resultado = resolver_solicitud(db, 202, 77, datos)

        self.assertEqual(resultado["estado"], "OBSERVADA")
        params = db.execute.call_args.args[1]
        self.assertEqual(params["decision"], "OBSERVADA")
        self.assertEqual(params["observacion"], "Faltan antecedentes")
        db.commit.assert_called_once_with()

    def test_resolver_rechazada_commits_with_observation(self) -> None:
        db = MagicMock(name="db")
        db.execute.return_value.scalar_one.return_value = {
            "id_practica": 303,
            "estado": "RECHAZADA",
            "mensaje": "Solicitud revisada correctamente",
        }
        datos = DecisionRevisionRequest(
            decision="RECHAZADA",
            observacion="No cumple requisitos"
        )

        resultado = resolver_solicitud(db, 303, 88, datos)

        self.assertEqual(resultado["estado"], "RECHAZADA")
        params = db.execute.call_args.args[1]
        self.assertEqual(params["decision"], "RECHAZADA")
        self.assertEqual(params["observacion"], "No cumple requisitos")
        db.commit.assert_called_once_with()

    def test_resolver_raises_when_request_does_not_exist(self) -> None:
        db = MagicMock(name="db")
        db.execute.return_value.scalar_one.return_value = {
            "error": "SOLICITUD_NO_ENCONTRADA"
        }
        datos = DecisionRevisionRequest(decision="APROBADA")

        with self.assertRaises(SolicitudNoEncontradaError):
            resolver_solicitud(db, 999, 55, datos)

        db.commit.assert_not_called()

    def test_resolver_raises_when_request_is_not_revisable(self) -> None:
        db = MagicMock(name="db")
        db.execute.return_value.scalar_one.return_value = {
            "error": "SOLICITUD_NO_REVISABLE"
        }
        datos = DecisionRevisionRequest(decision="APROBADA")

        with self.assertRaises(SolicitudNoRevisableError):
            resolver_solicitud(db, 999, 55, datos)

        db.commit.assert_not_called()


class ResolverSolicitudRouteTests(unittest.TestCase):
    def _override_dependencies(self, db: MagicMock, user_id: int) -> dict:
        original_overrides = dict(app.dependency_overrides)
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[get_current_user_id] = lambda: user_id
        return original_overrides

    def test_allows_gestor_to_resolve(self) -> None:
        db = MagicMock(name="db")
        expected_response = {
            "id_practica": 101,
            "estado": "APROBADA",
            "mensaje": "Solicitud revisada correctamente",
        }

        original_overrides = self._override_dependencies(db, user_id=55)

        try:
            with patch(
                "app.core.permissions.obtener_contexto_usuario",
                return_value={"roles": ["GESTOR"]},
            ) as contexto_mock, patch(
                "app.api.routes.revisiones.resolver_solicitud",
                return_value=expected_response,
            ) as resolver_mock:
                with TestClient(app) as client:
                    response = client.patch(
                        "/revisiones/solicitudes/101",
                        json={"decision": "APROBADA"},
                    )

                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json(), expected_response)
                contexto_mock.assert_called_once_with(db=db, id_usuario=55)
                resolver_mock.assert_called_once()
        finally:
            app.dependency_overrides.clear()
            app.dependency_overrides.update(original_overrides)

    def test_allows_administrador_to_resolve(self) -> None:
        db = MagicMock(name="db")
        expected_response = {
            "id_practica": 202,
            "estado": "OBSERVADA",
            "mensaje": "Solicitud revisada correctamente",
        }

        original_overrides = self._override_dependencies(db, user_id=77)

        try:
            with patch(
                "app.core.permissions.obtener_contexto_usuario",
                return_value={"roles": ["ADMINISTRADOR"]},
            ) as contexto_mock, patch(
                "app.api.routes.revisiones.resolver_solicitud",
                return_value=expected_response,
            ) as resolver_mock:
                with TestClient(app) as client:
                    response = client.patch(
                        "/revisiones/solicitudes/202",
                        json={
                            "decision": "OBSERVADA",
                            "observacion": "Faltan antecedentes",
                        },
                    )

                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json(), expected_response)
                contexto_mock.assert_called_once_with(db=db, id_usuario=77)
                resolver_mock.assert_called_once()
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
                "app.api.routes.revisiones.resolver_solicitud"
            ) as resolver_mock:
                with TestClient(app) as client:
                    response = client.patch(
                        "/revisiones/solicitudes/101",
                        json={"decision": "APROBADA"},
                    )

                self.assertEqual(response.status_code, 403)
                resolver_mock.assert_not_called()
                contexto_mock.assert_called_once_with(db=db, id_usuario=99)
        finally:
            app.dependency_overrides.clear()
            app.dependency_overrides.update(original_overrides)

    def test_returns_404_for_missing_request(self) -> None:
        db = MagicMock(name="db")
        original_overrides = self._override_dependencies(db, user_id=55)

        try:
            with patch(
                "app.core.permissions.obtener_contexto_usuario",
                return_value={"roles": ["GESTOR"]},
            ), patch(
                "app.api.routes.revisiones.resolver_solicitud",
                side_effect=SolicitudNoEncontradaError,
            ):
                with TestClient(app) as client:
                    response = client.patch(
                        "/revisiones/solicitudes/999",
                        json={"decision": "APROBADA"},
                    )

                self.assertEqual(response.status_code, 404)
                self.assertEqual(response.json()["detail"], "La solicitud no existe")
        finally:
            app.dependency_overrides.clear()
            app.dependency_overrides.update(original_overrides)

    def test_returns_409_for_not_revisable_request(self) -> None:
        db = MagicMock(name="db")
        original_overrides = self._override_dependencies(db, user_id=55)

        try:
            with patch(
                "app.core.permissions.obtener_contexto_usuario",
                return_value={"roles": ["GESTOR"]},
            ), patch(
                "app.api.routes.revisiones.resolver_solicitud",
                side_effect=SolicitudNoRevisableError,
            ):
                with TestClient(app) as client:
                    response = client.patch(
                        "/revisiones/solicitudes/999",
                        json={"decision": "APROBADA"},
                    )

                self.assertEqual(response.status_code, 409)
                self.assertEqual(
                    response.json()["detail"],
                    "La solicitud ya no se encuentra en revisión",
                )
        finally:
            app.dependency_overrides.clear()
            app.dependency_overrides.update(original_overrides)

    def test_response_keeps_expected_contract(self) -> None:
        db = MagicMock(name="db")
        expected_response = {
            "id_practica": 303,
            "estado": "RECHAZADA",
            "mensaje": "Solicitud revisada correctamente",
        }

        original_overrides = self._override_dependencies(db, user_id=88)

        try:
            with patch(
                "app.core.permissions.obtener_contexto_usuario",
                return_value={"roles": ["GESTOR"]},
            ), patch(
                "app.api.routes.revisiones.resolver_solicitud",
                return_value=expected_response,
            ):
                with TestClient(app) as client:
                    response = client.patch(
                        "/revisiones/solicitudes/303",
                        json={
                            "decision": "RECHAZADA",
                            "observacion": "No cumple requisitos",
                        },
                    )

                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json(), expected_response)
                model = DecisionRevisionResponse(**response.json())
                self.assertEqual(model.id_practica, 303)
                self.assertEqual(model.estado, "RECHAZADA")
                self.assertEqual(model.mensaje, "Solicitud revisada correctamente")
        finally:
            app.dependency_overrides.clear()
            app.dependency_overrides.update(original_overrides)


if __name__ == "__main__":
    unittest.main()
