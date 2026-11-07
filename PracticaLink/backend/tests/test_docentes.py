import os
import unittest
from unittest.mock import MagicMock, patch

os.environ.setdefault("SUPABASE_DATABASE_URL", "postgresql+psycopg://user:synthetic@localhost/test")
os.environ.setdefault("JWT_SECRET_KEY", "unit-test-secret")

from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError
from app.core.database import get_db, get_docente_assignment_db
from app.core.security import get_current_user_id
from app.main import app
from app.docentes.service import (
    GestionAsignacionDocenteError, gestionar_asignacion_docente, listar_practicas_docente,
)


class DocenteServiceTests(unittest.TestCase):
    def test_assignment_uses_authenticated_actor_and_commits_only_success(self):
        db = MagicMock()
        db.execute.return_value.scalar_one.return_value = {
            "id_practica": 8, "id_docente": 30, "id_docente_anterior": None, "mensaje": "ok"
        }
        result = gestionar_asignacion_docente(db, 8, 15, 30, None)
        self.assertEqual(result["id_docente"], 30)
        self.assertEqual(db.execute.call_args.args[1]["id_actor"], 15)
        db.commit.assert_called_once()
        db.rollback.assert_not_called()

    def test_assignment_rolls_back_function_conflict(self):
        db = MagicMock()
        db.execute.return_value.scalar_one.return_value = {"error": "GESTOR_NO_RESPONSABLE"}
        with self.assertRaises(GestionAsignacionDocenteError):
            gestionar_asignacion_docente(db, 8, 15, 30, None)
        db.rollback.assert_called_once()
        db.commit.assert_not_called()

    def test_docente_list_is_returned_from_database_function(self):
        db = MagicMock()
        db.execute.return_value.scalar_one.return_value = [{"id_practica": 8}]
        self.assertEqual(listar_practicas_docente(db, 30), [{"id_practica": 8}])
        self.assertIn("fn_listar_practicas_asignadas", str(db.execute.call_args.args[0]))
        self.assertEqual(db.execute.call_args.args[1]["id_docente"], 30)


class DocenteRoutesTests(unittest.TestCase):
    def setUp(self):
        self.previous = dict(app.dependency_overrides)
        self.db = MagicMock()
        self.auth_db = MagicMock()
        app.dependency_overrides[get_db] = lambda: self.auth_db
        app.dependency_overrides[get_docente_assignment_db] = lambda: self.db
        app.dependency_overrides[get_current_user_id] = lambda: 30
        self.roles = patch("app.core.permissions.obtener_contexto_usuario", return_value={"roles": ["DOCENTE"]})
        self.roles.start()
        self.addCleanup(self.roles.stop)
        self.addCleanup(self._restore)

    def _restore(self):
        app.dependency_overrides.clear()
        app.dependency_overrides.update(self.previous)

    def test_docente_can_read_assigned_practice_list(self):
        self.db.execute.return_value.scalar_one.return_value = [{"id_practica": 8, "estado": "APROBADA", "estudiante": "E", "centro_practica": "C"}]
        with TestClient(app) as client:
            response = client.get("/docente/practicas")
        self.assertEqual(response.status_code, 200)
        self.assertEqual([row["id_practica"] for row in response.json()], [8])

    def test_gestor_assignment_requires_gestor_role_even_for_admin(self):
        patcher = patch("app.core.permissions.obtener_contexto_usuario", return_value={"roles": ["ADMINISTRADOR"]})
        patcher.start()
        self.addCleanup(patcher.stop)
        with TestClient(app) as client:
            response = client.put("/docente/practicas/8/asignacion", json={"id_docente": 30})
        self.assertEqual(response.status_code, 403)
        self.db.execute.assert_not_called()

    def test_docente_role_is_required_for_teacher_routes(self):
        patcher = patch("app.core.permissions.obtener_contexto_usuario", return_value={"roles": ["GESTOR"]})
        patcher.start()
        self.addCleanup(patcher.stop)
        with TestClient(app) as client:
            response = client.get("/docente/practicas")
        self.assertEqual(response.status_code, 403)
        self.db.execute.assert_not_called()

    def test_foreign_practice_is_not_returned_by_docente_detail(self):
        self.db.execute.return_value.scalar_one.return_value = [{"id_practica": 9}]
        with TestClient(app) as client:
            response = client.get("/docente/practicas/8")
        self.assertEqual(response.status_code, 404)

    def test_invalid_teacher_from_database_becomes_conflict(self):
        self.db.execute.return_value.scalar_one.return_value = {"error": "DOCENTE_NO_VALIDO"}
        with patch(
            "app.core.permissions.obtener_contexto_usuario",
            return_value={"roles": ["GESTOR"]},
        ):
            with TestClient(app) as client:
                response = client.put("/docente/practicas/8/asignacion", json={"id_docente": 999})
        self.assertEqual(response.status_code, 409)
        self.db.rollback.assert_called_once()

    def test_admin_manager_reassignment_conflict_is_http_409(self):
        patcher = patch("app.core.permissions.obtener_contexto_usuario", return_value={"roles": ["ADMINISTRADOR"]})
        patcher.start()
        self.addCleanup(patcher.stop)
        class Diagnostic:
            constraint_name = "practica_docente_distinto_gestor"
        class OriginalError(RuntimeError):
            diag = Diagnostic()
        failure = IntegrityError("update", {}, OriginalError("check constraint"))
        with patch("app.practicas.routes.asignar_gestor_practica", side_effect=failure):
            with TestClient(app) as client:
                response = client.patch("/practicas/8/gestor", json={"id_gestor": 30})
        self.assertEqual(response.status_code, 409)
        self.assertIn("DOCENTE", response.json()["detail"])
        self.auth_db.rollback.assert_called_once()

    def test_dual_role_can_use_gestor_assignment_route(self):
        patcher = patch("app.core.permissions.obtener_contexto_usuario", return_value={"roles": ["ADMINISTRADOR", "GESTOR"]})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.db.execute.return_value.scalar_one.return_value = {"id_practica": 8, "id_docente": 31, "id_docente_anterior": None, "mensaje": "ok"}
        with TestClient(app) as client:
            response = client.put("/docente/practicas/8/asignacion", json={"id_docente": 31})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.db.execute.call_args.args[1]["id_actor"], 30)


if __name__ == "__main__":
    unittest.main()
