import os
import unittest
from unittest.mock import MagicMock, patch

os.environ.setdefault("SUPABASE_DATABASE_URL", "postgresql+psycopg://localhost/practicalink_test")
os.environ.setdefault("JWT_SECRET_KEY", "unit-test-secret")

from fastapi.testclient import TestClient

from app.core.database import get_db
from app.core.incidencias_database import get_incidencias_db
from app.core.security import get_current_user_id
from app.main import app


def incidencia():
    return {
        "id_incidencia": 41,
        "id_practica": 15,
        "id_usuario": 23,
        "usuario": "Gestor Sintético",
        "fecha": "2026-11-02T12:00:00Z",
        "descripcion": "Situación sintética",
        "prioridad": "ALTA",
        "estado": "ABIERTA",
        "fecha_resolucion": None,
        "alerta": True,
        "estudiante": "Estudiante Sintético",
        "correo_estudiante": "estudiante@example.invalid",
        "centro_practica": "Centro Sintético",
    }


class IncidenciasEp06Tests(unittest.TestCase):
    def setUp(self):
        self.overrides = dict(app.dependency_overrides)
        self.addCleanup(self.restore_overrides)
        self.db = MagicMock()
        self.db.execute.return_value.scalar_one.return_value = [incidencia()]
        app.dependency_overrides[get_db] = lambda: self.db
        app.dependency_overrides[get_current_user_id] = lambda: 23
        self.contexto = self.enterContext(patch(
            "app.core.permissions.obtener_contexto_usuario",
            return_value={"roles": ["GESTOR"]},
        ))
        self.enterContext(patch(
            "sqlalchemy.engine.Engine.connect",
            side_effect=AssertionError("Conexión real prohibida"),
        ))
        self.client = self.enterContext(TestClient(app))

    def restore_overrides(self):
        app.dependency_overrides.clear()
        app.dependency_overrides.update(self.overrides)

    def test_legacy_create_contract_is_rejected_before_database(self):
        # Contrato EP06 retirado (fecha/prioridad). La creación canónica (tipo, descripcion), la
        # persistencia y el autor autenticado están cubiertos en test_incidencias_routes.py.
        self.contexto.return_value = {"usuario": {"id_usuario": 23}, "roles": ["GESTOR"]}
        # La conexión restringida de incidencias no está configurada aquí; se sustituye por un mock.
        app.dependency_overrides[get_incidencias_db] = lambda: MagicMock()
        for body in [
            {"fecha": "2026-11-02", "descripcion": "Situación sintética", "prioridad": "ALTA"},
            {"descripcion": "Incidente", "prioridad": "URGENTE"},
        ]:
            with self.subTest(body=body):
                self.assertEqual(self.client.post("/practicas/15/incidencias", json=body).status_code, 422)
        self.db.execute.assert_not_called()
        self.db.commit.assert_not_called()

    def test_legacy_state_patch_is_retired_and_canonical_route_remains(self):
        # PATCH /incidencias/{id}/estado fue retirado porque permitía saltarse HU016.
        # El flujo canónico está cubierto en test_incidencias_estados.py.
        response = self.client.patch("/incidencias/41/estado", json={"estado": "RESUELTA"})
        self.assertEqual(response.status_code, 404)
        self.db.execute.assert_not_called()
        self.db.commit.assert_not_called()
        paths = app.openapi()["paths"]
        self.assertNotIn("/incidencias/{id_incidencia}/estado", paths)
        self.assertIn("patch", paths["/practicas/{id_practica}/incidencias/{id_incidencia}/estado"])

    def test_incident_list_exposes_associated_practice_and_pending_state(self):
        response = self.client.get("/incidencias")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()[0]["id_practica"], 15)
        self.assertEqual(response.json()[0]["estado"], "ABIERTA")
        self.assertTrue(response.json()[0]["alerta"])
        self.assertIn("fn_listar_incidencias", str(self.db.execute.call_args.args[0]))

    def test_student_is_denied_list_and_retired_state_patch(self):
        self.contexto.return_value = {"roles": ["ESTUDIANTE"]}
        self.assertEqual(self.client.get("/incidencias").status_code, 403)
        self.assertEqual(self.client.patch("/incidencias/41/estado", json={"estado": "CERRADA"}).status_code, 404)
        self.db.execute.assert_not_called()
