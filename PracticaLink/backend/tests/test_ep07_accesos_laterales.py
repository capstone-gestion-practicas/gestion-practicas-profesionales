import os
import unittest
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

os.environ.setdefault("SUPABASE_DATABASE_URL", "postgresql+psycopg://localhost/practicalink_test")
os.environ.setdefault("JWT_SECRET_KEY", "unit-test-secret")

from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from app.core.database import get_db
from app.core.incidencias_database import get_incidencias_db
from app.core.security import get_current_user_id
from app.core.seguimientos_database import get_seguimientos_db
from app.core.seguimientos_lectura_database import get_seguimientos_lectura_db
from app.incidencias.routes import router as incidencias_router
from app.main import app


GESTOR_ASIGNADO = 23   # gestor de las prácticas 9401/9405 en los mocks
GESTOR_AJENO = 22      # otro gestor
ADMIN = 99
ESTUDIANTE = 30


class AccesosLateralesBase(unittest.TestCase):
    """Mocks de base de datos y de contexto de roles. Nunca conecta a una base real."""

    uid = GESTOR_ASIGNADO

    def setUp(self):
        self.overrides = dict(app.dependency_overrides)
        self.addCleanup(self.restore_overrides)
        self.db = MagicMock()
        self.incidencias_db = MagicMock()
        app.dependency_overrides[get_db] = lambda: self.db
        app.dependency_overrides[get_incidencias_db] = lambda: self.incidencias_db
        app.dependency_overrides[get_current_user_id] = lambda: self.uid
        self.contexto = self.enterContext(patch(
            "app.core.permissions.obtener_contexto_usuario",
            return_value=self.contexto_de(["GESTOR"]),
        ))
        self.enterContext(patch(
            "sqlalchemy.engine.Engine.connect",
            side_effect=AssertionError("Conexión real prohibida"),
        ))
        self.client = self.enterContext(TestClient(app))

    def restore_overrides(self):
        app.dependency_overrides.clear()
        app.dependency_overrides.update(self.overrides)

    def contexto_de(self, roles):
        return {"usuario": {"id_usuario": self.uid, "nombre": "Sintetico"}, "roles": roles}

    def rol(self, roles, uid=None):
        if uid is not None:
            self.uid = uid
        self.contexto.return_value = self.contexto_de(roles)


class HistorialGeneralAccesoTests(AccesosLateralesBase):
    """H-A..H-E: GET /practicas/{id}/historial."""

    def test_H_A_gestor_asignado_is_allowed_with_scoped_query(self):
        self.rol(["GESTOR"], GESTOR_ASIGNADO)
        self.db.execute.return_value.mappings.return_value.first.return_value = {"id_practica": 9401}
        self.db.execute.return_value.mappings.return_value.all.return_value = []
        response = self.client.get("/practicas/9401/historial")
        self.assertEqual(response.status_code, 200)
        primera = self.db.execute.call_args_list[0].args[1]
        self.assertEqual(primera, {"id_practica": 9401, "id_gestor_asignado": GESTOR_ASIGNADO})

    def test_H_B_gestor_ajeno_is_403_without_history(self):
        self.rol(["GESTOR"], GESTOR_AJENO)
        # 1.ª consulta acotada: sin fila; 2.ª: la práctica existe.
        self.db.execute.return_value.mappings.return_value.first.side_effect = [None, {"id_practica": 9401}]
        response = self.client.get("/practicas/9401/historial")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["detail"], "No tiene permisos para consultar el historial de esta práctica")
        self.assertEqual(self.db.execute.call_count, 2)
        for llamada in self.db.execute.call_args_list:
            self.assertNotIn("historial_estado", str(llamada.args[0]))
        self.db.commit.assert_not_called()

    def test_H_C_practice_without_gestor_is_403_for_gestor(self):
        self.rol(["GESTOR"], GESTOR_ASIGNADO)
        self.db.execute.return_value.mappings.return_value.first.side_effect = [None, {"id_practica": 9403}]
        self.assertEqual(self.client.get("/practicas/9403/historial").status_code, 403)
        self.assertNotIn("historial_estado", str(self.db.execute.call_args_list[0].args[0]))

    def test_H_D_administrator_is_global_without_gestor_restriction(self):
        self.rol(["ADMINISTRADOR"], ADMIN)
        self.db.execute.return_value.mappings.return_value.first.return_value = {"id_practica": 9402}
        self.db.execute.return_value.mappings.return_value.all.return_value = []
        self.assertEqual(self.client.get("/practicas/9402/historial").status_code, 200)
        self.assertNotIn("id_gestor_asignado", self.db.execute.call_args_list[0].args[1])

    def test_H_E_estudiante_is_denied_before_any_query(self):
        self.rol(["ESTUDIANTE"], ESTUDIANTE)
        self.assertEqual(self.client.get("/practicas/9401/historial").status_code, 403)
        self.db.execute.assert_not_called()

    def test_nonexistent_practice_remains_404_for_gestor(self):
        self.rol(["GESTOR"], GESTOR_AJENO)
        self.db.execute.return_value.mappings.return_value.first.side_effect = [None, None]
        response = self.client.get("/practicas/9999/historial")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json(), {"detail": "La práctica no existe"})


class HistorialEstadosAccesoTests(AccesosLateralesBase):
    """H-A..H-E: GET /practicas/{id}/historial-estados (SQL con puede_gestionar calculado)."""

    def test_H_A_gestor_asignado_gets_history(self):
        self.rol(["GESTOR"], GESTOR_ASIGNADO)
        self.db.execute.return_value.scalar_one.return_value = True           # fn_puede_gestionar_practica
        self.db.execute.return_value.scalar_one_or_none.return_value = []     # fn_consultar_historial_estados
        self.assertEqual(self.client.get("/practicas/9401/historial-estados").status_code, 200)
        self.assertEqual(self.db.execute.call_args_list[1].args[1],
                         {"id_practica": 9401, "id_usuario": GESTOR_ASIGNADO, "puede_gestionar": True})

    def test_H_B_gestor_ajeno_is_403_and_history_is_not_returned(self):
        self.rol(["GESTOR"], GESTOR_AJENO)
        self.db.execute.return_value.scalar_one.return_value = False
        self.db.execute.return_value.scalar_one_or_none.return_value = None
        self.db.execute.return_value.mappings.return_value.first.return_value = {"id_practica": 9401}
        response = self.client.get("/practicas/9401/historial-estados")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.db.execute.call_args_list[1].args[1]["puede_gestionar"], False)

    def test_H_C_practice_without_gestor_is_403_for_gestor(self):
        self.rol(["GESTOR"], GESTOR_ASIGNADO)
        self.db.execute.return_value.scalar_one.return_value = False
        self.db.execute.return_value.scalar_one_or_none.return_value = None
        self.db.execute.return_value.mappings.return_value.first.return_value = {"id_practica": 9403}
        self.assertEqual(self.client.get("/practicas/9403/historial-estados").status_code, 403)

    def test_H_D_administrator_is_global(self):
        self.rol(["ADMINISTRADOR"], ADMIN)
        self.db.execute.return_value.scalar_one_or_none.return_value = []
        self.assertEqual(self.client.get("/practicas/9402/historial-estados").status_code, 200)
        self.assertEqual(self.db.execute.call_count, 1)  # sin consulta de asignación
        self.assertTrue(self.db.execute.call_args.args[1]["puede_gestionar"])

    def test_H_E_estudiante_owner_keeps_existing_sql_access(self):
        self.rol(["ESTUDIANTE"], ESTUDIANTE)
        self.db.execute.return_value.scalar_one_or_none.return_value = []
        self.assertEqual(self.client.get("/practicas/9401/historial-estados").status_code, 200)
        self.assertEqual(self.db.execute.call_count, 1)
        self.assertFalse(self.db.execute.call_args.args[1]["puede_gestionar"])

    def test_H_E_estudiante_non_owner_keeps_existing_404(self):
        self.rol(["ESTUDIANTE"], ESTUDIANTE)
        self.db.execute.return_value.scalar_one_or_none.return_value = None
        response = self.client.get("/practicas/9401/historial-estados")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json(), {"detail": "No se encontró la práctica solicitada"})


class SeguimientosCanonicosEp05Tests(AccesosLateralesBase):
    """S-A..S-K: contrato canónico EP05 (app/seguimientos) con autorización EP07.

    Usa las conexiones restringidas que usa el router real; la principal no se consulta.
    """

    def setUp(self):
        super().setUp()
        self.restringida = MagicMock()
        self.lectura = MagicMock()
        app.dependency_overrides[get_seguimientos_db] = lambda: self.restringida
        app.dependency_overrides[get_seguimientos_lectura_db] = lambda: self.lectura

    def _alta(self, id_practica=9401, observacion="Seguimiento sintetico"):
        return self.client.post(f"/practicas/{id_practica}/seguimientos",
                                json={"fecha": "2026-01-15", "tipo": "Videollamada", "observacion": observacion})

    def _registro_ok(self, id_practica=9401):
        return {"id_seguimiento": 7, "id_practica": id_practica, "id_usuario": self.uid,
                "fecha": "2026-01-15", "tipo": "Videollamada", "observacion": "Seguimiento sintetico",
                "fecha_creacion": "2026-01-15T12:00:00+00:00"}

    def _listado_ok(self, id_practica=9401):
        return {"id_practica": id_practica,
                "items": [{"id_seguimiento": 7, "fecha": "2026-01-15", "tipo": "Videollamada",
                           "observacion": "Seguimiento sintetico",
                           "responsable": {"id_usuario": self.uid, "nombre": "Sintetico Sintetico"}}],
                "limit": 50, "offset": 0, "hay_mas": False}

    # --- Alta (POST) ---
    def test_S_A_gestor_asignado_creates_with_tipo_and_commits_once(self):
        self.rol(["GESTOR"], GESTOR_ASIGNADO)
        self.restringida.execute.return_value.scalar_one.return_value = self._registro_ok()
        response = self._alta()
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["tipo"], "Videollamada")
        self.restringida.commit.assert_called_once()
        self.restringida.rollback.assert_not_called()
        self.assertEqual(self.restringida.execute.call_args.args[1]["id_usuario"], GESTOR_ASIGNADO)

    def test_S_B_gestor_ajeno_creates_is_403_without_commit(self):
        self.rol(["GESTOR"], GESTOR_AJENO)
        self.restringida.execute.return_value.scalar_one.return_value = {"error": "USUARIO_NO_AUTORIZADO"}
        self.assertEqual(self._alta().status_code, 403)
        self.restringida.rollback.assert_called_once()
        self.restringida.commit.assert_not_called()

    def test_S_C_practice_without_gestor_creation_is_403_for_gestor(self):
        self.rol(["GESTOR"], GESTOR_ASIGNADO)
        self.restringida.execute.return_value.scalar_one.return_value = {"error": "USUARIO_NO_AUTORIZADO"}
        self.assertEqual(self._alta(9403).status_code, 403)
        self.restringida.commit.assert_not_called()

    def test_S_D_nonexistent_practice_creation_is_404(self):
        self.rol(["GESTOR"], GESTOR_ASIGNADO)
        self.restringida.execute.return_value.scalar_one.return_value = {"error": "PRACTICA_NO_ENCONTRADA"}
        response = self._alta(999999)
        self.assertEqual(response.status_code, 404)
        self.restringida.commit.assert_not_called()

    def test_S_E_administrator_creates_on_any_practice(self):
        self.rol(["ADMINISTRADOR"], ADMIN)
        self.restringida.execute.return_value.scalar_one.return_value = self._registro_ok()
        self.assertEqual(self._alta().status_code, 201)
        self.restringida.commit.assert_called_once()

    def test_S_F_non_in_progress_practice_is_409_without_commit(self):
        self.rol(["GESTOR"], GESTOR_ASIGNADO)
        self.restringida.execute.return_value.scalar_one.return_value = {"error": "PRACTICA_NO_EN_CURSO"}
        self.assertEqual(self._alta().status_code, 409)
        self.restringida.commit.assert_not_called()

    def test_S_G_payload_without_tipo_is_rejected_before_database(self):
        self.rol(["GESTOR"], GESTOR_ASIGNADO)
        response = self.client.post("/practicas/9401/seguimientos",
                                    json={"fecha": "2026-01-15", "observacion": "Seguimiento sintetico"})
        self.assertEqual(response.status_code, 422)
        self.restringida.execute.assert_not_called()

    def test_S_G2_extra_fields_and_invalid_tipo_are_rejected_before_database(self):
        self.rol(["GESTOR"], GESTOR_ASIGNADO)
        extra = self.client.post("/practicas/9401/seguimientos",
                                 json={"fecha": "2026-01-15", "tipo": "Otro", "observacion": "x", "id_usuario": 999})
        invalid = self.client.post("/practicas/9401/seguimientos",
                                   json={"fecha": "2026-01-15", "tipo": "Fax", "observacion": "x"})
        self.assertEqual((extra.status_code, invalid.status_code), (422, 422))
        self.restringida.execute.assert_not_called()

    def test_S_H_unknown_or_malformed_result_is_500_without_commit(self):
        self.rol(["GESTOR"], GESTOR_ASIGNADO)
        for resultado in [{"error": "RESULTADO_DESCONOCIDO"}, "respuesta-no-diccionario"]:
            with self.subTest(resultado=resultado):
                self.restringida.reset_mock()
                self.restringida.execute.return_value.scalar_one.return_value = resultado
                self.assertEqual(self._alta().status_code, 500)
                self.restringida.commit.assert_not_called()

    def test_S_I_estudiante_cannot_create_or_list(self):
        self.rol(["ESTUDIANTE"], ESTUDIANTE)
        self.assertEqual(self._alta().status_code, 403)
        self.assertEqual(self.client.get("/practicas/9401/seguimientos").status_code, 403)
        self.restringida.execute.assert_not_called()
        self.lectura.execute.assert_not_called()

    # --- Lectura (GET paginado) ---
    def test_S_J_gestor_asignado_lists_paginated_items_with_tipo(self):
        self.rol(["GESTOR"], GESTOR_ASIGNADO)
        self.lectura.execute.return_value.scalar_one.return_value = self._listado_ok()
        response = self.client.get("/practicas/9401/seguimientos")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(set(body), {"id_practica", "items", "limit", "offset", "hay_mas"})
        self.assertEqual(body["items"][0]["tipo"], "Videollamada")
        self.assertEqual(self.lectura.execute.call_args.args[1],
                         {"id_practica": 9401, "id_usuario": GESTOR_ASIGNADO, "limit": 50, "offset": 0})

    def test_S_K_gestor_ajeno_lists_is_403_and_nonexistent_is_404(self):
        self.rol(["GESTOR"], GESTOR_AJENO)
        self.lectura.execute.return_value.scalar_one.return_value = {"error": "USUARIO_NO_AUTORIZADO"}
        self.assertEqual(self.client.get("/practicas/9401/seguimientos").status_code, 403)
        self.lectura.execute.return_value.scalar_one.return_value = {"error": "PRACTICA_NO_ENCONTRADA"}
        self.assertEqual(self.client.get("/practicas/999999/seguimientos").status_code, 404)

    def test_S_L_administrator_lists_any_practice(self):
        self.rol(["ADMINISTRADOR"], ADMIN)
        self.lectura.execute.return_value.scalar_one.return_value = self._listado_ok(9402)
        self.assertEqual(self.client.get("/practicas/9402/seguimientos").status_code, 200)

    def test_S_M_pagination_parameters_reach_the_authorized_query(self):
        self.rol(["GESTOR"], GESTOR_ASIGNADO)
        listado = self._listado_ok()
        listado.update(limit=2, offset=4)  # El servicio exige que la respuesta refleje la paginación pedida.
        self.lectura.execute.return_value.scalar_one.return_value = listado
        self.assertEqual(self.client.get("/practicas/9401/seguimientos",
                                         params={"limit": 2, "offset": 4}).status_code, 200)
        self.assertEqual(self.lectura.execute.call_args.args[1]["limit"], 2)
        self.assertEqual(self.lectura.execute.call_args.args[1]["offset"], 4)

    def test_S_N_client_cannot_inject_identity_or_filters_in_listing(self):
        self.rol(["GESTOR"], GESTOR_ASIGNADO)
        self.lectura.execute.return_value.scalar_one.return_value = self._listado_ok()
        response = self.client.get("/practicas/9401/seguimientos", params={"id_gestor": 999})
        self.assertEqual(response.status_code, 422)
        self.lectura.execute.assert_not_called()


class IncidenciasRegresionEp06Tests(AccesosLateralesBase):
    """I-A..I-E: política EP06 transversal. Solo se mockean servicios; el SQL EP06 no cambia."""

    def _historial_vacio(self, id_practica):
        return {"id_practica": id_practica, "items": [], "limit": 50, "offset": 0, "hay_mas": False}

    def test_I_A_gestor_lists_incidents_of_practice_assigned_to_another_gestor(self):
        self.rol(["GESTOR"], GESTOR_AJENO)
        with patch("app.incidencias.routes.consultar_incidencias",
                   return_value=self._historial_vacio(9401)) as consultar:
            self.assertEqual(self.client.get("/practicas/9401/incidencias").status_code, 200)
        self.assertEqual(consultar.call_args.args[2], GESTOR_AJENO)

    def test_I_B_gestor_registers_incident_on_practice_of_another_gestor(self):
        self.rol(["GESTOR"], GESTOR_AJENO)
        creada = {
            "tipo": "OTRO", "descripcion": "Incidencia sintetica", "id_incidencia": 5,
            "id_practica": 9401, "id_usuario": GESTOR_AJENO, "estado": "PENDIENTE",
            "fecha": datetime(2026, 11, 3, 12, tzinfo=timezone.utc),
        }
        with patch("app.incidencias.routes.registrar_incidencia", return_value=creada) as registrar:
            response = self.client.post("/practicas/9401/incidencias",
                                        json={"tipo": "OTRO", "descripcion": "Incidencia sintetica"})
        self.assertEqual(response.status_code, 201)
        self.assertEqual(registrar.call_args.args[2], GESTOR_AJENO)

    def test_I_C_administrator_lists_incidents(self):
        self.rol(["ADMINISTRADOR"], ADMIN)
        with patch("app.incidencias.routes.consultar_incidencias",
                   return_value=self._historial_vacio(9401)):
            self.assertEqual(self.client.get("/practicas/9401/incidencias").status_code, 200)

    def test_I_D_estudiante_is_denied_for_ep06_and_legacy_routes(self):
        self.rol(["ESTUDIANTE"], ESTUDIANTE)
        with patch("app.incidencias.routes.consultar_incidencias") as consultar:
            self.assertEqual(self.client.get("/practicas/9401/incidencias").status_code, 403)
            self.assertEqual(self.client.post("/practicas/9401/incidencias",
                                              json={"tipo": "OTRO", "descripcion": "x"}).status_code, 403)
            self.assertEqual(self.client.get("/incidencias").status_code, 403)
        consultar.assert_not_called()

    def test_I_E_inactive_or_roleless_user_is_denied(self):
        self.rol([], GESTOR_AJENO)  # fn_contexto_usuario no devuelve roles activos
        with patch("app.incidencias.routes.consultar_incidencias") as consultar:
            self.assertEqual(self.client.get("/practicas/9401/incidencias").status_code, 403)
            self.assertEqual(self.client.get("/practicas/con-incidencias-pendientes").status_code, 403)
        consultar.assert_not_called()

    def test_I_G_ep06_routes_are_registered_once_and_not_under_practicas_router(self):
        rutas = [(tuple(sorted(r.methods)), r.path) for r in incidencias_router.routes if isinstance(r, APIRoute)]
        self.assertEqual(len(rutas), len(set(rutas)))
        self.assertIn((("PATCH",), "/practicas/{id_practica}/incidencias/{id_incidencia}/estado"), rutas)
        self.assertIn((("GET",), "/practicas/con-incidencias-pendientes"), rutas)


class EstadoActualAccesoTests(AccesosLateralesBase):
    """E-A..E-H: GET /practicas/{id}/estado (EP07 2B.3)."""

    def _estado(self, id_practica):
        return {
            "id_practica": id_practica,
            "fecha_actualizacion": datetime(2026, 11, 3, 12, tzinfo=timezone.utc),
            "estado": {"id_estado": 4, "nombre": "APROBADA", "descripcion": "Aprobada", "es_final": False},
        }

    def test_E_A_gestor_asignado_gets_200_with_scoped_flag(self):
        self.rol(["GESTOR"], GESTOR_ASIGNADO)
        self.db.execute.return_value.scalar_one.return_value = True            # fn_puede_gestionar_practica
        self.db.execute.return_value.scalar_one_or_none.return_value = self._estado(9401)
        self.assertEqual(self.client.get("/practicas/9401/estado").status_code, 200)
        self.assertEqual(self.db.execute.call_args_list[1].args[1],
                         {"id_practica": 9401, "id_usuario": GESTOR_ASIGNADO, "puede_gestionar": True})

    def test_E_B_gestor_ajeno_gets_403_without_state(self):
        self.rol(["GESTOR"], GESTOR_AJENO)
        self.db.execute.return_value.scalar_one.return_value = False
        self.db.execute.return_value.scalar_one_or_none.return_value = None
        self.db.execute.return_value.mappings.return_value.first.return_value = {"id_practica": 9401}
        response = self.client.get("/practicas/9401/estado")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json(), {"detail": "No tiene permisos para consultar el estado de esta práctica"})
        self.assertEqual(self.db.execute.call_args_list[1].args[1]["puede_gestionar"], False)
        self.db.commit.assert_not_called()

    def test_E_C_practice_without_gestor_is_403_for_gestor(self):
        self.rol(["GESTOR"], GESTOR_ASIGNADO)
        self.db.execute.return_value.scalar_one.return_value = False
        self.db.execute.return_value.scalar_one_or_none.return_value = None
        self.db.execute.return_value.mappings.return_value.first.return_value = {"id_practica": 9403}
        self.assertEqual(self.client.get("/practicas/9403/estado").status_code, 403)

    def test_E_D_administrator_is_global_without_assignment_query(self):
        self.rol(["ADMINISTRADOR"], ADMIN)
        self.db.execute.return_value.scalar_one_or_none.return_value = self._estado(9403)
        self.assertEqual(self.client.get("/practicas/9403/estado").status_code, 200)
        self.assertEqual(self.db.execute.call_count, 1)
        self.assertTrue(self.db.execute.call_args.args[1]["puede_gestionar"])

    def test_E_E_nonexistent_practice_is_404_for_gestor_and_admin(self):
        for rol, uid in [(["GESTOR"], GESTOR_ASIGNADO), (["ADMINISTRADOR"], ADMIN)]:
            with self.subTest(rol=rol):
                self.rol(rol, uid)
                self.db.reset_mock()
                self.db.execute.return_value.scalar_one.return_value = False
                self.db.execute.return_value.scalar_one_or_none.return_value = None
                self.db.execute.return_value.mappings.return_value.first.return_value = None
                response = self.client.get("/practicas/999999/estado")
                self.assertEqual(response.status_code, 404)
                self.assertEqual(response.json(), {"detail": "No se encontró la práctica solicitada"})

    def test_E_F_estudiante_owner_keeps_existing_sql_access(self):
        self.rol(["ESTUDIANTE"], ESTUDIANTE)
        self.db.execute.return_value.scalar_one_or_none.return_value = self._estado(9401)
        self.assertEqual(self.client.get("/practicas/9401/estado").status_code, 200)
        self.assertEqual(self.db.execute.call_count, 1)
        self.assertFalse(self.db.execute.call_args.args[1]["puede_gestionar"])

    def test_E_G_estudiante_non_owner_keeps_existing_404(self):
        self.rol(["ESTUDIANTE"], ESTUDIANTE)
        self.db.execute.return_value.scalar_one_or_none.return_value = None
        self.assertEqual(self.client.get("/practicas/9401/estado").status_code, 404)

    def test_E_H_inactive_or_roleless_user_is_denied_before_query(self):
        self.rol([], GESTOR_AJENO)
        self.assertEqual(self.client.get("/practicas/9401/estado").status_code, 403)
        self.db.execute.assert_not_called()
