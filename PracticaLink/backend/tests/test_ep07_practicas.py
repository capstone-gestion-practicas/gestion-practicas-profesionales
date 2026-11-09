import os
import unittest
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

os.environ.setdefault("SUPABASE_DATABASE_URL", "postgresql+psycopg://localhost/practicalink_test")
os.environ.setdefault("JWT_SECRET_KEY", "unit-test-secret")

from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.database import get_db
from app.informes.database import get_informe_db
from app.core.security import get_current_user_id
from app.main import app


class Ep07PracticasTests(unittest.TestCase):
    def setUp(self):
        self.overrides = dict(app.dependency_overrides)
        self.addCleanup(self.restore_overrides)
        self.db = MagicMock()
        self.db.execute.return_value.scalar_one.return_value = []
        app.dependency_overrides[get_db] = lambda: self.db
        app.dependency_overrides[get_informe_db] = lambda: self.db
        app.dependency_overrides[get_current_user_id] = lambda: 23
        self.contexto = self.enterContext(patch(
            "app.core.permissions.obtener_contexto_usuario",
            return_value={"roles": ["GESTOR"]},
        ))
        self.enterContext(patch(
            "sqlalchemy.engine.Engine.connect",
            side_effect=AssertionError("Conexión real prohibida"),
        ))
        self.client = self.enterContext(TestClient(app, headers={"Authorization": "Bearer synthetic-unit-token"}))

    def restore_overrides(self):
        app.dependency_overrides.clear()
        app.dependency_overrides.update(self.overrides)

    def test_manager_listing_is_scoped_to_authenticated_identity(self):
        response = self.client.get("/practicas/gestion-estados")
        self.assertEqual(response.status_code, 200)
        sql, params = self.db.execute.call_args.args
        self.assertIn("fn_listar_practicas_gestion_usuario", str(sql))
        self.assertEqual(params, {"id_usuario": 23})

    def test_admin_listing_keeps_system_wide_practices(self):
        self.contexto.return_value = {"roles": ["ADMINISTRADOR"]}
        response = self.client.get("/practicas/gestion-estados")
        self.assertEqual(response.status_code, 200)
        self.assertIn("fn_listar_practicas_gestion()", str(self.db.execute.call_args.args[0]))
        self.db.execute.assert_called_once()
        self.assertEqual(len(self.db.execute.call_args.args), 1)

    def test_assignment_requires_admin_and_commits_only_success(self):
        self.contexto.return_value = {"roles": ["ADMINISTRADOR"]}
        self.db.execute.return_value.scalar_one.return_value = {
            "id_practica": 55, "id_gestor": 23, "gestor": "Gestor Sintético",
            "mensaje": "Gestor asignado correctamente",
        }
        response = self.client.patch(
            "/practicas/55/gestor", json={"id_gestor": 23}
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["id_gestor"], 23)
        self.db.commit.assert_called_once()
        self.assertEqual(
            self.db.execute.call_args.args[1],
            {"id_practica": 55, "id_admin": 23, "id_gestor": 23},
        )

        self.db.reset_mock()
        self.db.execute.return_value.scalar_one.return_value = {
            "error": "GESTOR_NO_DISPONIBLE"
        }
        response = self.client.patch(
            "/practicas/55/gestor", json={"id_gestor": 999}
        )
        self.assertEqual(response.status_code, 409)
        self.db.rollback.assert_called_once()
        self.db.commit.assert_not_called()

    def test_manual_closure_calls_atomic_database_function(self):
        self.contexto.return_value = {"roles": ["GESTOR"]}
        self.db.execute.return_value.scalar_one.return_value = {
            "id_practica": 55,
            "id_cierre": 4,
            "id_historial": 18,
            "estado": "FINALIZADA",
            "fecha_cierre": "2026-11-02T12:00:00Z",
            "mensaje": "La práctica se finalizó correctamente",
        }
        response = self.client.post(
            "/practicas/55/cierre", json={"observacion": "Cierre sintético"}
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["estado"], "FINALIZADA")
        self.assertIn("fn_cerrar_practica", str(self.db.execute.call_args.args[0]))
        self.assertEqual(
            self.db.execute.call_args.args[1],
            {
                "id_practica": 55,
                "id_usuario": 23,
                "observacion": "Cierre sintético",
            },
        )
        self.db.commit.assert_called_once()

    def test_closure_rejects_early_date_and_wrong_assignee(self):
        for error, expected_status in [
            ("PRACTICA_NO_CERRABLE", 409),
            ("USUARIO_NO_AUTORIZADO", 403),
        ]:
            with self.subTest(error=error):
                self.db.reset_mock()
                self.db.execute.return_value.scalar_one.return_value = {"error": error}
                response = self.client.post("/practicas/55/cierre", json={})
                self.assertEqual(response.status_code, expected_status)
                self.db.rollback.assert_called_once()
                self.db.commit.assert_not_called()

    def test_generic_status_update_cannot_bypass_assigned_start_flow(self):
        self.db.execute.return_value.scalar_one.return_value = {
            "error": "INICIO_RESTRINGIDO_REQUERIDO"
        }
        response = self.client.patch(
            "/practicas/55/estado/actualizacion", json={"id_estado": 5}
        )
        self.assertEqual(response.status_code, 409)
        self.assertIn("flujo de inicio", response.json()["detail"])
        self.db.rollback.assert_called_once()
        self.db.commit.assert_not_called()

    def test_finalized_practice_generic_change_is_409_without_commit(self):
        self.db.execute.return_value.scalar_one.return_value = {
            "error": "PRACTICA_FINALIZADA_NO_MODIFICABLE"
        }
        response = self.client.patch(
            "/practicas/9001/estado/actualizacion", json={"id_estado": 4}
        )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(
            response.json()["detail"], "La práctica está finalizada y no puede modificarse"
        )
        self.db.rollback.assert_called_once()
        self.db.commit.assert_not_called()

    def test_successful_generic_change_commits_once(self):
        self.db.execute.return_value.scalar_one.return_value = {
            "id_practica": 9002, "id_estado": 7, "estado": "RECHAZADA",
            "mensaje": "Estado actualizado y registrado en el historial",
        }
        response = self.client.patch(
            "/practicas/9002/estado/actualizacion", json={"id_estado": 7}
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["estado"], "RECHAZADA")
        self.db.commit.assert_called_once()
        self.db.rollback.assert_not_called()

    def test_existing_generic_errors_keep_status_and_never_commit(self):
        cases = [
            ("PRACTICA_NO_ENCONTRADA", 404),
            ("ESTADO_NO_DISPONIBLE", 422),
            ("CIERRE_MANUAL_REQUERIDO", 409),
            ("INICIO_RESTRINGIDO_REQUERIDO", 409),
        ]
        for error, expected_status in cases:
            with self.subTest(error=error):
                self.db.reset_mock()
                self.db.execute.return_value.scalar_one.return_value = {"error": error}
                response = self.client.patch(
                    "/practicas/9002/estado/actualizacion", json={"id_estado": 4}
                )
                self.assertEqual(response.status_code, expected_status)
                self.db.rollback.assert_called_once()
                self.db.commit.assert_not_called()

    def test_unknown_or_malformed_results_never_commit(self):
        for resultado in [
            {"error": "RESULTADO_DESCONOCIDO"},
            {"foo": "bar"},
            "respuesta-no-diccionario",
        ]:
            with self.subTest(resultado=resultado):
                self.db.reset_mock()
                self.db.execute.return_value.scalar_one.return_value = resultado
                response = self.client.patch(
                    "/practicas/9002/estado/actualizacion", json={"id_estado": 4}
                )
                self.assertEqual(response.status_code, 500)
                self.assertEqual(
                    response.json()["detail"], "No se pudo actualizar el estado de la práctica"
                )
                self.db.rollback.assert_called_once()
                self.db.commit.assert_not_called()

    def test_generic_change_by_unassigned_or_unauthorized_user_is_403_without_commit(self):
        for error in ["GESTOR_NO_ASIGNADO_A_PRACTICA", "USUARIO_NO_AUTORIZADO"]:
            with self.subTest(error=error):
                self.db.reset_mock()
                self.db.execute.return_value.scalar_one.return_value = {"error": error}
                response = self.client.patch(
                    "/practicas/9202/estado/actualizacion", json={"id_estado": 3}
                )
                self.assertEqual(response.status_code, 403)
                self.assertEqual(
                    response.json()["detail"],
                    "No tiene permisos para modificar el estado de esta práctica",
                )
                self.db.rollback.assert_called_once()
                self.db.commit.assert_not_called()

    def test_administrator_generic_change_is_allowed_and_commits_once(self):
        self.contexto.return_value = {"roles": ["ADMINISTRADOR"]}
        self.db.execute.return_value.scalar_one.return_value = {
            "id_practica": 9202, "id_estado": 3, "estado": "OBSERVADA",
            "mensaje": "Estado actualizado y registrado en el historial",
        }
        response = self.client.patch(
            "/practicas/9202/estado/actualizacion", json={"id_estado": 3}
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["estado"], "OBSERVADA")
        self.db.commit.assert_called_once()
        self.db.rollback.assert_not_called()

    def test_reminder_task_requires_configured_header_token(self):
        with (
            patch.object(settings, "ep07_reminder_task_token", "unit-test-task-token"),
            patch(
                "app.services.estado_practica_service.enviar_push_notificacion"
            ) as enviar_push,
        ):
            self.assertEqual(
                self.client.post("/practicas/tareas/recordatorios-cierre").status_code,
                403,
            )
            self.db.execute.assert_not_called()
            self.db.execute.return_value.scalar_one.return_value = [
                {"id_practica": 15, "id_notificacion": 44, "id_usuario": 23},
                {"id_practica": 15, "id_notificacion": 45, "id_usuario": 24},
            ]
            response = self.client.post(
                "/practicas/tareas/recordatorios-cierre",
                headers={"X-Task-Token": "unit-test-task-token"},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"practicas_notificadas": 1})
        self.assertIn("fn_procesar_recordatorios_cierre", str(self.db.execute.call_args.args[0]))
        self.assertEqual(enviar_push.call_count, 2)

    # --- Corrección 2B.1: listado y detalle de prácticas acotados por gestor asignado ---
    # Nota: estas pruebas verifican la consulta y las decisiones de FastAPI con mocks.
    # El resultado real (qué filas se devuelven) se verificó contra PostgreSQL de laboratorio.

    def _fila_listado(self, id_practica):
        return {
            "id_practica": id_practica, "id_estudiante": 7,
            "estudiante_nombre": "Estudiante Sintético", "centro_nombre": "Centro sintético",
            "fecha_registro": datetime(2026, 10, 17, 12, tzinfo=timezone.utc),
            "id_estado": 6, "estado_nombre": "APROBADA", "es_final": False,
            "fecha_ultimo_cambio_estado": None,
        }

    def _fila_detalle(self):
        return {
            "id_practica": 9301, "id_estudiante": 7, "estudiante_nombre": "Estudiante Sintético",
            "id_centro": 9, "centro_nombre": "Centro sintético",
            "fecha_registro": datetime(2025, 3, 1, 12, tzinfo=timezone.utc),
            "id_estado": 6, "estado_nombre": "APROBADA", "es_final": False,
            "fecha_ultimo_cambio_estado": None,
            "fecha_inicio": None, "fecha_termino": None,
            "horas": None, "cargo_funcion": None, "descripcion": None,
        }

    def test_L1_L2_L3_gestor_listing_is_scoped_to_authenticated_identity(self):
        self.contexto.return_value = {"roles": ["GESTOR"]}
        self.db.execute.return_value.mappings.return_value.all.return_value = []
        response = self.client.get("/practicas")
        self.assertEqual(response.status_code, 200)
        sql, params = self.db.execute.call_args.args
        self.assertIn("p.id_gestor = :id_gestor_asignado", " ".join(str(sql).split()))
        self.assertEqual(params["id_gestor_asignado"], 23)

    def test_L4_administrator_listing_has_no_gestor_restriction(self):
        self.contexto.return_value = {"roles": ["ADMINISTRADOR"]}
        self.db.execute.return_value.mappings.return_value.all.return_value = []
        self.assertEqual(self.client.get("/practicas").status_code, 200)
        sql, params = self.db.execute.call_args.args
        self.assertNotIn("id_gestor_asignado", str(sql))
        self.assertNotIn("id_gestor_asignado", params)

    def test_listing_client_cannot_choose_id_gestor(self):
        self.contexto.return_value = {"roles": ["GESTOR"]}
        self.db.execute.return_value.mappings.return_value.all.return_value = []
        response = self.client.get(
            "/practicas", params={"id_gestor": 999, "id_gestor_asignado": 999}
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.db.execute.call_args.args[1]["id_gestor_asignado"], 23)

    def test_L6_gestor_filter_is_applied_before_limit_so_paging_and_hay_mas_match_scope(self):
        from app.practicas.service import listar_practicas

        self.db.execute.return_value.mappings.return_value.all.return_value = [
            self._fila_listado(9301), self._fila_listado(9302), self._fila_listado(9303),
        ]
        result = listar_practicas(self.db, limit=2, offset=0, id_gestor_asignado=23)
        self.assertEqual([item["id_practica"] for item in result["items"]], [9301, 9302])
        self.assertTrue(result["hay_mas"])
        sql, params = self.db.execute.call_args.args
        sql = " ".join(str(sql).split())
        self.assertLess(sql.index("p.id_gestor = :id_gestor_asignado"), sql.index("LIMIT :limit"))
        self.assertEqual(params, {"limit": 3, "offset": 0, "id_gestor_asignado": 23})
        self.db.commit.assert_not_called()

    def test_D1_gestor_assigned_detail_is_200_with_scoped_single_query(self):
        self.contexto.return_value = {"roles": ["GESTOR"]}
        self.db.execute.return_value.mappings.return_value.first.return_value = self._fila_detalle()
        response = self.client.get("/practicas/9301")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["id_practica"], 9301)
        self.db.execute.assert_called_once()
        self.assertEqual(self.db.execute.call_args.args[1], {"id_practica": 9301, "id_gestor_asignado": 23})

    def test_D2_gestor_of_another_practice_is_403_without_detail(self):
        self.contexto.return_value = {"roles": ["GESTOR"]}
        # 1.ª consulta (acotada): sin fila; 2.ª consulta (solo existencia): la práctica existe.
        self.db.execute.return_value.mappings.return_value.first.side_effect = [None, {"existe": 1}]
        response = self.client.get("/practicas/9302")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["detail"], "No tiene permisos para consultar esta práctica")
        self.assertNotIn("estudiante", response.json())
        self.db.commit.assert_not_called()

    def test_D3_practice_without_gestor_is_rejected_for_gestor(self):
        self.contexto.return_value = {"roles": ["GESTOR"]}
        self.db.execute.return_value.mappings.return_value.first.side_effect = [None, {"existe": 1}]
        response = self.client.get("/practicas/9303")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.db.execute.call_args.args[1], {"id_practica": 9303})

    def test_D2_nonexistent_practice_remains_404_for_gestor(self):
        self.contexto.return_value = {"roles": ["GESTOR"]}
        self.db.execute.return_value.mappings.return_value.first.side_effect = [None, None]
        response = self.client.get("/practicas/9999")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json(), {"detail": "La práctica no existe"})

    def test_D4_administrator_detail_is_global_200(self):
        self.contexto.return_value = {"roles": ["ADMINISTRADOR"]}
        self.db.execute.return_value.mappings.return_value.first.return_value = self._fila_detalle()
        self.assertEqual(self.client.get("/practicas/9302").status_code, 200)
        self.db.execute.assert_called_once()
        self.assertEqual(self.db.execute.call_args.args[1], {"id_practica": 9302})

    def test_D5_estudiante_has_no_detail_access_and_no_query_runs(self):
        self.contexto.return_value = {"roles": ["ESTUDIANTE"]}
        self.db.execute.return_value.mappings.return_value.first.return_value = self._fila_detalle()
        self.assertEqual(self.client.get("/practicas/9301").status_code, 403)
        self.db.execute.assert_not_called()

    def test_detail_client_cannot_choose_id_gestor(self):
        self.contexto.return_value = {"roles": ["GESTOR"]}
        self.db.execute.return_value.mappings.return_value.first.return_value = self._fila_detalle()
        self.client.get("/practicas/9301", params={"id_gestor": 999})
        self.assertEqual(self.db.execute.call_args.args[1]["id_gestor_asignado"], 23)

    def test_inactive_or_roleless_user_is_denied_before_query(self):
        # fn_contexto_usuario devuelve roles vacíos para usuarios inactivos o sin rol activo.
        self.contexto.return_value = {"roles": []}
        self.assertEqual(self.client.get("/practicas").status_code, 403)
        self.assertEqual(self.client.get("/practicas/9301").status_code, 403)
        self.db.execute.assert_not_called()
