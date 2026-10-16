import json
import os
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import httpx
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
from app.schemas.empresa import EmpresaLookupResponse  # noqa: E402
from app.services.empresa_service import (  # noqa: E402
    EmpresaApiNoConfiguradaError, EmpresaApiNoDisponibleError,
    EmpresaNoEncontradaError, _consultar_api, consultar_empresa,
)


RUT = "12.345.678-5"
URL = "https://provider.example/api/lookup/" + RUT


def datos_proveedor():
    return {
        "found": True, "rut": "rut-ignorado", "dv": "5",
        "razon_social": "Empresa de Prueba SpA",
        "fecha_inicio_actividades": "2020-01-02", "giro": "Informática",
        "rubro": "Servicios", "subrubro": "Software", "categoria_tributaria": "1",
        "afecta_iva": "S", "actividades": [{"codigo": "123", "descripcion": "Pruebas"}],
        "comuna": "Santiago", "region": "Metropolitana", "num_trabajadores": "10",
    }


def datos_cache(vigente=True):
    return {
        **datos_proveedor(), "rut": RUT, "fuente": "Chile RUT Empresa",
        "consultado_en": "2026-01-02T10:00:00Z", "cache_vigente": vigente,
    }


def respuesta(status=200, datos=None):
    return httpx.Response(
        status, json=datos_proveedor() if datos is None else datos,
        request=httpx.Request("GET", URL),
    )


class EmpresasAisladasTests(unittest.TestCase):
    def setUp(self):
        self.db = MagicMock(name="db")
        self.db.execute.return_value.scalar_one_or_none.return_value = None
        self.db.execute.return_value.scalar_one.return_value = datos_cache()
        # TestClient usa transporte ASGI en memoria, no HTTPTransport.
        # Estas barreras impiden conexiones reales SQL y HTTP del proveedor.
        for target, attribute in ((engine, "connect"), (httpx.HTTPTransport, "handle_request")):
            barrera = patch.object(
                target, attribute, side_effect=AssertionError("Conexión real no permitida")
            )
            mock = barrera.start()
            self.addCleanup(barrera.stop)
            self.addCleanup(mock.assert_not_called)
        config_patch = patch(
            "app.services.empresa_service.settings",
            SimpleNamespace(
                chile_rut_empresa_api_key="synthetic-key",
                chile_rut_empresa_api_url="https://provider.example/api///",
            ),
        )
        self.settings = config_patch.start()
        self.addCleanup(config_patch.stop)
        http_patch = patch("app.services.empresa_service.httpx.get", return_value=respuesta())
        self.http_mock = http_patch.start()
        self.addCleanup(http_patch.stop)

    def assert_no_writes(self):
        self.assertLessEqual(self.db.execute.call_count, 1)
        self.db.commit.assert_not_called()
        self.db.rollback.assert_not_called()


class EmpresasServiceTests(EmpresasAisladasTests):
    def test_current_cache_uses_normalized_rut_and_skips_provider(self):
        cache = datos_cache()
        self.db.execute.return_value.scalar_one_or_none.return_value = cache

        self.assertEqual(consultar_empresa(self.db, " 12345678-5 "), cache)

        self.db.execute.assert_called_once()
        sql, params = self.db.execute.call_args.args
        self.assertEqual(str(sql), "SELECT fn_obtener_empresa_cache(:rut)")
        self.assertEqual(params, {"rut": RUT})
        self.http_mock.assert_not_called()
        self.assert_no_writes()

    def test_invalid_rut_rejected_before_sql_or_http(self):
        for rut, mensaje in (
            ("invalid", "El RUT no tiene un formato válido"),
            ("12345678-0", "El dígito verificador del RUT no es válido"),
        ):
            with self.subTest(rut=rut):
                with self.assertRaises(ValueError) as error:
                    consultar_empresa(self.db, rut)
                self.assertEqual(str(error.exception), mensaje)
                self.db.execute.assert_not_called()
                self.http_mock.assert_not_called()
                self.assert_no_writes()

    def test_cache_miss_queries_provider_persists_json_and_commits(self):
        guardada = datos_cache()
        self.db.execute.return_value.scalar_one.return_value = guardada

        self.assertEqual(consultar_empresa(self.db, RUT), guardada)

        self.assertEqual(self.db.execute.call_count, 2)
        lectura, escritura = self.db.execute.call_args_list
        self.assertEqual(str(lectura.args[0]), "SELECT fn_obtener_empresa_cache(:rut)")
        self.assertEqual(lectura.args[1], {"rut": RUT})
        self.assertEqual(
            str(escritura.args[0]),
            "SELECT fn_guardar_empresa_cache(CAST(:datos AS JSONB))",
        )
        self.assertEqual(set(escritura.args[1]), {"datos"})
        esperado = {**datos_proveedor(), "rut": RUT, "fuente": "Chile RUT Empresa"}
        serializado = escritura.args[1]["datos"]
        self.assertEqual(json.loads(serializado), esperado)
        self.assertIn("Informática", serializado)
        self.db.execute.return_value.scalar_one.assert_called_once_with()
        self.http_mock.assert_called_once_with(
            URL, headers={"x-api-key": "synthetic-key"}, timeout=8.0
        )
        self.db.commit.assert_called_once_with()
        self.db.rollback.assert_not_called()

    def test_stale_cache_is_refreshed_and_saved_on_provider_success(self):
        anterior = datos_cache(False)
        self.db.execute.return_value.scalar_one_or_none.return_value = anterior
        result = consultar_empresa(self.db, RUT)
        self.assertEqual(result, datos_cache())
        self.assertIsNot(result, anterior)
        self.assertEqual(self.db.execute.call_count, 2)
        self.http_mock.assert_called_once()
        self.db.commit.assert_called_once_with()
        self.db.rollback.assert_not_called()

    def test_stale_cache_is_returned_when_provider_is_unconfigured(self):
        cache = datos_cache(False)
        self.db.execute.return_value.scalar_one_or_none.return_value = cache
        self.settings.chile_rut_empresa_api_key = None
        self.assertEqual(consultar_empresa(self.db, RUT), cache)
        self.http_mock.assert_not_called()
        self.assert_no_writes()

    def test_stale_cache_is_returned_on_timeout_or_non_200_response(self):
        for timeout in (True, False):
            with self.subTest(timeout=timeout):
                self.db.reset_mock()
                cache = datos_cache(False)
                self.db.execute.return_value.scalar_one_or_none.return_value = cache
                self.http_mock.side_effect = httpx.ReadTimeout("synthetic-timeout") if timeout else None
                self.http_mock.return_value = respuesta(503)
                self.assertEqual(consultar_empresa(self.db, RUT), cache)
                self.assert_no_writes()

    def test_stale_cache_is_returned_for_invalid_json(self):
        self.db.execute.return_value.scalar_one_or_none.return_value = datos_cache(False)
        self.http_mock.return_value = httpx.Response(200, content=b"not-json")
        self.assertFalse(consultar_empresa(self.db, RUT)["cache_vigente"])
        self.assert_no_writes()

    def test_not_found_does_not_fall_back_to_stale_cache(self):
        for response in (respuesta(404), respuesta(datos={"found": False})):
            with self.subTest(status=response.status_code):
                self.db.reset_mock()
                self.db.execute.return_value.scalar_one_or_none.return_value = datos_cache(False)
                self.http_mock.return_value = response
                with self.assertRaises(EmpresaNoEncontradaError):
                    consultar_empresa(self.db, RUT)
                self.assert_no_writes()

    def test_missing_key_without_cache_raises_configuration_error(self):
        self.settings.chile_rut_empresa_api_key = None
        with self.assertRaises(EmpresaApiNoConfiguradaError):
            consultar_empresa(self.db, RUT)
        self.http_mock.assert_not_called()
        self.assert_no_writes()

    def test_saved_cache_is_reused_on_next_lookup_without_second_http_call(self):
        self.db.execute.return_value.scalar_one_or_none.side_effect = [None, datos_cache()]
        self.assertEqual(consultar_empresa(self.db, RUT), datos_cache())
        self.assertEqual(consultar_empresa(self.db, RUT), datos_cache())
        self.assertEqual(self.db.execute.call_count, 3)
        self.http_mock.assert_called_once()
        self.db.commit.assert_called_once_with()
        self.db.rollback.assert_not_called()

    def test_unexpected_provider_shape_does_not_use_stale_fallback(self):
        self.db.execute.return_value.scalar_one_or_none.return_value = datos_cache(False)
        self.http_mock.return_value = respuesta(datos=[])
        with self.assertRaises(AttributeError):
            consultar_empresa(self.db, RUT)
        self.assert_no_writes()

    def test_save_failure_propagates_without_explicit_rollback(self):
        self.db.execute.side_effect = [self.db.execute.return_value, RuntimeError("synthetic-db-error")]
        with self.assertRaisesRegex(RuntimeError, "synthetic-db-error"):
            consultar_empresa(self.db, RUT)
        self.db.commit.assert_not_called()
        self.db.rollback.assert_not_called()


class EmpresaProveedorTests(EmpresasAisladasTests):
    def test_maps_provider_fields_and_uses_requested_rut(self):
        self.assertEqual(
            _consultar_api(RUT),
            {**datos_proveedor(), "rut": RUT, "fuente": "Chile RUT Empresa"},
        )
        self.http_mock.assert_called_once_with(
            URL, headers={"x-api-key": "synthetic-key"}, timeout=8.0
        )
        self.db.execute.assert_not_called()

    def test_optional_fields_default_to_none_and_activities_to_empty_list(self):
        self.http_mock.return_value = respuesta(datos={"found": True, "razon_social": "Empresa"})
        datos = _consultar_api(RUT)
        self.assertEqual(datos["actividades"], [])
        for campo in ("dv", "fecha_inicio_actividades", "giro", "rubro", "subrubro",
                      "categoria_tributaria", "afecta_iva", "comuna", "region", "num_trabajadores"):
            self.assertIsNone(datos[campo])

    def test_http_errors_other_than_404_become_unavailable_without_retry(self):
        for status in (301, 400, 401, 403, 429, 500, 503):
            with self.subTest(status=status):
                self.http_mock.reset_mock()
                self.http_mock.return_value = respuesta(status)
                with self.assertRaises(EmpresaApiNoDisponibleError):
                    _consultar_api(RUT)
                self.http_mock.assert_called_once()

    def test_timeouts_and_connection_errors_become_unavailable(self):
        for error in (httpx.ReadTimeout, httpx.ConnectTimeout, httpx.ConnectError):
            with self.subTest(error=error.__name__):
                self.http_mock.side_effect = error("synthetic-error")
                with self.assertRaises(EmpresaApiNoDisponibleError) as raised:
                    _consultar_api(RUT)
                self.assertIsInstance(raised.exception.__cause__, error)

    def test_404_or_missing_found_or_name_become_not_found(self):
        for response in (
            respuesta(404), respuesta(datos={}), respuesta(datos={"found": False}),
            respuesta(datos={"found": True}), respuesta(datos={"found": True, "razon_social": ""}),
        ):
            with self.subTest(status=response.status_code, content=response.text):
                self.http_mock.return_value = response
                with self.assertRaises(EmpresaNoEncontradaError):
                    _consultar_api(RUT)

    def test_invalid_json_becomes_unavailable(self):
        self.http_mock.return_value = httpx.Response(200, content=b"not-json")
        with self.assertRaises(EmpresaApiNoDisponibleError):
            _consultar_api(RUT)

    def test_non_object_json_currently_raises_attribute_error(self):
        for datos in ([], "unexpected", 42, None):
            with self.subTest(kind=type(datos).__name__):
                self.http_mock.return_value = httpx.Response(200, content=json.dumps(datos).encode())
                with self.assertRaises(AttributeError):
                    _consultar_api(RUT)

    def test_provider_field_types_are_not_validated_here(self):
        self.http_mock.return_value = respuesta(datos={
            "found": "false", "razon_social": 123, "actividades": {"unexpected": True},
        })
        datos = _consultar_api(RUT)
        self.assertTrue(datos["found"])
        self.assertEqual(datos["razon_social"], 123)
        self.assertEqual(datos["actividades"], {"unexpected": True})


class EmpresasRouteTests(EmpresasAisladasTests):
    def setUp(self):
        super().setUp()
        overrides = patch.dict(app.dependency_overrides, {
            get_db: lambda: self.db, get_current_user_id: lambda: 55,
        })
        overrides.start()
        self.addCleanup(overrides.stop)
        contexto = patch(
            "app.core.permissions.obtener_contexto_usuario",
            return_value={"roles": ["ESTUDIANTE"]},
        )
        self.contexto_mock = contexto.start()
        self.addCleanup(contexto.stop)

    def _get(self, rut=RUT):
        with TestClient(app, raise_server_exceptions=False) as client:
            response = client.get("/empresas/consulta/" + rut)
        self.contexto_mock.assert_called_with(db=self.db, id_usuario=55)
        return response

    def test_student_admin_and_combined_roles_receive_200_from_cache(self):
        for roles in (["ESTUDIANTE"], ["ADMINISTRADOR"], ["GESTOR", "ESTUDIANTE"]):
            with self.subTest(roles=roles):
                self.db.reset_mock()
                self.contexto_mock.return_value = {"roles": roles}
                self.db.execute.return_value.scalar_one_or_none.return_value = datos_cache()
                response = self._get("12345678-5")
                self.assertEqual(response.status_code, 200)
                expected = datos_cache()
                expected["actividades"] = [{
                    "codigo": "123", "descripcion": "Pruebas", "afecta_iva": None, "categoria": None,
                }]
                self.assertEqual(response.json(), expected)
                self.db.execute.assert_called_once()
                self.assertEqual(self.db.execute.call_args.args[1], {"rut": RUT})
                self.http_mock.assert_not_called()
                self.assert_no_writes()

    def test_gestor_or_missing_roles_receive_403_before_sql_or_http(self):
        for contexto in ({"roles": ["GESTOR"]}, {"roles": []}, None):
            with self.subTest(contexto=contexto):
                self.contexto_mock.return_value = contexto
                response = self._get()
                self.assertEqual(response.status_code, 403)
                self.assertEqual(response.json(), {
                    "detail": "No tiene permisos para acceder a esta funcionalidad."
                })
                self.db.execute.assert_not_called()
                self.http_mock.assert_not_called()
                self.assert_no_writes()

    def test_invalid_rut_returns_422_with_current_messages(self):
        for rut, message in (
            ("invalid", "El RUT no tiene un formato válido"),
            ("12345678-0", "El dígito verificador del RUT no es válido"),
        ):
            with self.subTest(rut=rut):
                response = self._get(rut)
                self.assertEqual(response.status_code, 422)
                self.assertEqual(response.json(), {"detail": message})
                self.db.execute.assert_not_called()
                self.http_mock.assert_not_called()
                self.assert_no_writes()

    def test_missing_key_returns_503_without_cache(self):
        self.settings.chile_rut_empresa_api_key = None
        response = self._get()
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json(), {"detail": "La consulta de empresas no está configurada"})
        self.http_mock.assert_not_called()
        self.assert_no_writes()

    def test_not_found_returns_404_even_with_stale_cache(self):
        self.db.execute.return_value.scalar_one_or_none.return_value = datos_cache(False)
        self.http_mock.return_value = respuesta(404)
        response = self._get()
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json(), {"detail": "Empresa no encontrada"})
        self.assert_no_writes()

    def test_timeout_http_error_and_invalid_json_return_502_without_cache(self):
        for kind in ("timeout", "http", "json"):
            with self.subTest(kind=kind):
                self.db.reset_mock()
                self.http_mock.side_effect = httpx.ReadTimeout("synthetic-error") if kind == "timeout" else None
                self.http_mock.return_value = (
                    httpx.Response(200, content=b"not-json") if kind == "json" else respuesta(500)
                )
                response = self._get()
                self.assertEqual(response.status_code, 502)
                self.assertEqual(response.json(), {"detail": "El servicio de empresas no está disponible"})
                self.assert_no_writes()

    def test_stale_fallback_returns_200_without_commit(self):
        self.db.execute.return_value.scalar_one_or_none.return_value = datos_cache(False)
        self.http_mock.side_effect = httpx.ReadTimeout("synthetic-error")
        response = self._get()
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["cache_vigente"])
        self.assert_no_writes()

    def test_cache_miss_returns_saved_company_and_commits(self):
        response = self._get()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["rut"], RUT)
        self.assertEqual(response.json()["razon_social"], "Empresa de Prueba SpA")
        self.assertEqual(self.db.execute.call_count, 2)
        self.http_mock.assert_called_once()
        self.db.commit.assert_called_once_with()
        self.db.rollback.assert_not_called()

    def test_non_object_provider_json_currently_returns_500(self):
        self.http_mock.return_value = respuesta(datos=[])
        response = self._get()
        self.assertEqual(response.status_code, 500)
        self.assert_no_writes()

    def test_invalid_cached_response_currently_returns_500(self):
        self.db.execute.return_value.scalar_one_or_none.return_value = {
            **datos_cache(), "actividades": [{"descripcion": "Falta codigo"}],
        }
        response = self._get()
        self.assertEqual(response.status_code, 500)
        self.http_mock.assert_not_called()
        self.assert_no_writes()


class EmpresaSchemasTests(unittest.TestCase):
    def test_defaults_and_independent_activity_lists(self):
        primero = EmpresaLookupResponse(found=True, rut=RUT, razon_social="Empresa")
        segundo = EmpresaLookupResponse(found=True, rut=RUT, razon_social="Empresa")
        self.assertEqual(primero.actividades, [])
        self.assertIsNot(primero.actividades, segundo.actividades)
        self.assertTrue(primero.cache_vigente)
        self.assertEqual(primero.fuente, "Chile RUT Empresa")
        self.assertIsNone(primero.consultado_en)
        self.assertIsNone(primero.num_trabajadores)

    def test_required_company_and_activity_fields_are_enforced(self):
        for campo in ("found", "rut", "razon_social"):
            with self.subTest(campo=campo):
                datos = datos_cache()
                del datos[campo]
                with self.assertRaises(ValidationError):
                    EmpresaLookupResponse(**datos)
        with self.assertRaises(ValidationError):
            EmpresaLookupResponse(**{**datos_cache(), "actividades": [{"codigo": "123"}]})

    def test_lookup_response_does_not_validate_rut_checksum(self):
        datos = EmpresaLookupResponse(found=True, rut="not-a-rut", razon_social="Empresa")
        self.assertEqual(datos.rut, "not-a-rut")


if __name__ == "__main__":
    unittest.main()
