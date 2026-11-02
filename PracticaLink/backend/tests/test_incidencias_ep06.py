import os
import unittest
from unittest.mock import MagicMock, patch

os.environ.setdefault("SUPABASE_DATABASE_URL", "postgresql+psycopg://localhost/practicalink_test")
os.environ.setdefault("JWT_SECRET_KEY", "unit-test-secret")

from fastapi.testclient import TestClient

from app.core.database import get_db
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

    def test_create_incident_persists_date_description_practice_and_authenticated_author(self):
        self.db.execute.return_value.scalar_one.return_value = incidencia()
        response = self.client.post(
            "/practicas/15/incidencias",
            json={
                "fecha": "2026-11-02",
                "descripcion": "  Situación sintética  ",
                "prioridad": "ALTA",
                "id_usuario": 999,
            },
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["id_practica"], 15)
        self.assertEqual(response.json()["id_usuario"], 23)
        self.assertEqual(response.json()["fecha"][:10], "2026-11-02")
        self.assertEqual(response.json()["descripcion"], "Situación sintética")
        self.assertEqual(response.json()["estado"], "ABIERTA")
        self.assertTrue(response.json()["alerta"])
        sql, params = self.db.execute.call_args.args
        self.assertIn("fn_registrar_incidencia", str(sql))
        self.assertEqual(params, {
            "id_practica": 15,
            "id_usuario": 23,
            "fecha": unittest.mock.ANY,
            "descripcion": "Situación sintética",
            "prioridad": "ALTA",
        })
        self.assertEqual(str(params["fecha"]), "2026-11-02")
        self.db.commit.assert_called_once()

    def test_create_rejects_empty_description_invalid_priority_and_extra_fields(self):
        for body in [
            {"descripcion": "   "},
            {"descripcion": "Incidente", "prioridad": "URGENTE"},
        ]:
            with self.subTest(body=body):
                response = self.client.post("/practicas/15/incidencias", json=body)
                self.assertEqual(response.status_code, 422)
        self.db.execute.assert_not_called()

    def test_closed_practice_rejects_incident_and_rolls_back(self):
        self.db.execute.return_value.scalar_one.return_value = {
            "error": "PRACTICA_NO_DISPONIBLE"
        }
        response = self.client.post(
            "/practicas/15/incidencias", json={"descripcion": "Situación"}
        )
        self.assertEqual(response.status_code, 404)
        self.db.rollback.assert_called_once()
        self.db.commit.assert_not_called()

    def test_update_state_persists_and_returns_updated_state(self):
        self.db.execute.return_value.scalar_one.return_value = {
            "id_incidencia": 41,
            "estado": "RESUELTA",
            "mensaje": "Estado de la incidencia actualizado",
        }
        response = self.client.patch(
            "/incidencias/41/estado", json={"estado": "RESUELTA"}
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["estado"], "RESUELTA")
        sql, params = self.db.execute.call_args.args
        self.assertIn("fn_actualizar_estado_incidencia", str(sql))
        self.assertEqual(params, {"id_incidencia": 41, "estado": "RESUELTA"})
        self.db.commit.assert_called_once()

    def test_incident_list_exposes_associated_practice_and_pending_state(self):
        response = self.client.get("/incidencias")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()[0]["id_practica"], 15)
        self.assertEqual(response.json()[0]["estado"], "ABIERTA")
        self.assertTrue(response.json()[0]["alerta"])
        self.assertIn("fn_listar_incidencias", str(self.db.execute.call_args.args[0]))

    def test_student_cannot_list_or_change_incidents(self):
        self.contexto.return_value = {"roles": ["ESTUDIANTE"]}
        for response in [
            self.client.get("/incidencias"),
            self.client.patch("/incidencias/41/estado", json={"estado": "CERRADA"}),
        ]:
            self.assertEqual(response.status_code, 403)
        self.db.execute.assert_not_called()
