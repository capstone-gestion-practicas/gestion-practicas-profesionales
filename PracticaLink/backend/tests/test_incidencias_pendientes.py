import os
import unittest
from unittest.mock import MagicMock, patch
os.environ.setdefault('SUPABASE_DATABASE_URL','postgresql+psycopg://principal:synthetic@localhost/test')
os.environ.setdefault('JWT_SECRET_KEY','synthetic-unit-secret')
from fastapi.testclient import TestClient
from app.main import app
from app.core.database import get_db
from app.core.incidencias_database import get_incidencias_db
from app.core.security import create_access_token
from app.incidencias.service import consultar_resumen_incidencias_pendientes, ConsultaIncidenciasError
from tests.test_incidencias_service import fallo_sql

PATH = '/practicas/con-incidencias-pendientes'


def pendiente(identifier=15, pendientes=3, en_atencion=1, fecha='2026-10-20T15:10:00+00:00'):
    return {'id_practica': identifier, 'pendientes': pendientes, 'en_atencion': en_atencion,
            'fecha_pendiente_antigua': fecha}


def result(items=None, limit=50, offset=0, hay_mas=False):
    return {'items': [pendiente()] if items is None else items, 'limit': limit, 'offset': offset, 'hay_mas': hay_mas}


class ResumenPendientesTests(unittest.TestCase):
    def setUp(self):
        previous = dict(app.dependency_overrides)
        self.addCleanup(lambda: (app.dependency_overrides.clear(), app.dependency_overrides.update(previous)))
        self.db = MagicMock()
        self.principal = MagicMock()
        self.db.execute.return_value.scalar_one.return_value = result()
        self.open = MagicMock(return_value=self.db)
        app.dependency_overrides[get_db] = lambda: self.principal
        app.dependency_overrides[get_incidencias_db] = lambda: self.open()
        # La identidad se verifica con el contexto del JWT; el principal solo valida roles.
        self.context = self.enterContext(patch('app.core.permissions.obtener_contexto_usuario',
            return_value={'usuario': {'id_usuario': 101}, 'roles': ['GESTOR']}))
        self.enterContext(patch('sqlalchemy.engine.Engine.connect', side_effect=AssertionError('Red prohibida')))
        self.enterContext(patch('socket.create_connection', side_effect=AssertionError('Red prohibida')))
        self.client = self.enterContext(TestClient(app))
        self.headers = {'Authorization': 'Bearer ' + create_access_token(101)}

    def get(self, query='', headers=None):
        return self.client.get(PATH + query, headers=self.headers if headers is None else headers)

    # ---------- autorización e identidad ----------
    def test_gestor_and_administrador_bound_to_jwt_identity(self):
        for role in ('GESTOR', 'ADMINISTRADOR'):
            self.context.return_value = {'usuario': {'id_usuario': 101}, 'roles': [role]}
            response = self.get()
            self.assertEqual(response.status_code, 200)
            # Pydantic serializa UTC como 'Z', igual que las respuestas HU015/HU016.
            self.assertEqual(response.json(), result(items=[pendiente(fecha='2026-10-20T15:10:00Z')]))
        self.assertEqual(self.db.execute.call_args.args[1], {'id_usuario': 101, 'limit': 50, 'offset': 0})
        self.db.commit.assert_not_called()
        self.principal.execute.assert_not_called()

    def test_denied_roles_and_identity_mismatch_before_connection(self):
        for context in (None, {'roles': ['ESTUDIANTE']}, {'usuario': {'id_usuario': 999}, 'roles': ['GESTOR']}):
            self.context.return_value = context
            self.assertEqual(self.get().status_code, 403)
        self.open.assert_not_called()

    def test_invalid_or_missing_jwt_before_connection(self):
        for headers in ({}, {'Authorization': 'Bearer invalid'}):
            self.assertIn(self.get(headers=headers).status_code, (401, 403))
        self.open.assert_not_called()

    def test_no_client_identity_or_extra_query(self):
        for query in ('?id_usuario=102', '?limit=5&id_usuario=102', '?estado=PENDIENTE', '?offset=0&extra=1'):
            self.assertEqual(self.get(query).status_code, 422)
        self.db.execute.assert_not_called()

    # ---------- paginación ----------
    def test_defaults_and_limit_bounds(self):
        self.assertEqual(self.get().status_code, 200)
        self.assertEqual(self.db.execute.call_args.args[1], {'id_usuario': 101, 'limit': 50, 'offset': 0})
        for limit in (1, 100):
            self.db.execute.return_value.scalar_one.return_value = result(limit=limit)
            self.assertEqual(self.get(f'?limit={limit}').status_code, 200)
        for query in ('?limit=0', '?limit=101', '?limit=x', '?offset=-1', '?offset=9223372036854775808'):
            self.assertEqual(self.get(query).status_code, 422)

    def test_offset_is_passed_to_function(self):
        self.db.execute.return_value.scalar_one.return_value = result(items=[], limit=100, offset=10)
        self.assertEqual(self.get('?limit=100&offset=10').status_code, 200)
        self.assertEqual(self.db.execute.call_args.args[1], {'id_usuario': 101, 'limit': 100, 'offset': 10})

    def test_invalid_pagination_from_sql_maps_to_422(self):
        self.db.execute.return_value.scalar_one.return_value = {'error': 'PAGINACION_INVALIDA'}
        self.assertEqual(self.get().status_code, 422)

    def test_hay_mas_reported_consistently(self):
        full = [pendiente(i, 1, 0, f'2026-01-0{i}T00:00:00+00:00') for i in range(1, 3)]
        self.db.execute.return_value.scalar_one.return_value = result(items=full, limit=2, hay_mas=True)
        body = self.get('?limit=2').json()
        self.assertTrue(body['hay_mas'])
        self.assertEqual(len(body['items']), 2)

    # ---------- contenido ----------
    def test_empty_list(self):
        self.db.execute.return_value.scalar_one.return_value = result(items=[])
        self.assertEqual(self.get().json(), result(items=[]))

    def test_single_and_multiple_practices_ordered(self):
        multiple = [pendiente(7, 2, 0, '2026-01-01T00:00:00+00:00'), pendiente(3, 1, 4, '2026-01-02T00:00:00+00:00')]
        self.db.execute.return_value.scalar_one.return_value = result(items=multiple)
        self.assertEqual([i['id_practica'] for i in self.get().json()['items']], [7, 3])

    def test_en_atencion_reported_separately_and_no_extra_fields(self):
        only_attention = {**pendiente(), 'pendientes': 1, 'en_atencion': 9}
        self.db.execute.return_value.scalar_one.return_value = result(items=[only_attention])
        item = self.get().json()['items'][0]
        self.assertEqual((item['pendientes'], item['en_atencion']), (1, 9))
        self.assertEqual(set(item), {'id_practica', 'pendientes', 'en_atencion', 'fecha_pendiente_antigua'})

    def test_finalized_practice_with_pending_is_returned_as_sql_provides(self):
        self.db.execute.return_value.scalar_one.return_value = result(items=[pendiente(42, 1, 0)])
        self.assertEqual(self.get().json()['items'][0]['id_practica'], 42)

    def test_zero_pending_row_is_rejected_so_historical_states_never_leak(self):
        # Un resultado con pendientes=0 significaría que SQL contó un estado no moderno.
        self.db.execute.return_value.scalar_one.return_value = result(items=[pendiente(pendientes=0)])
        self.assertEqual(self.get().status_code, 500)

    # ---------- errores y resultados inesperados ----------
    def test_sql_business_errors_mapped_without_internal_codes(self):
        for code, status in [('USUARIO_NO_AUTORIZADO', 403), ('PAGINACION_INVALIDA', 422), ('secret', 500)]:
            self.db.execute.return_value.scalar_one.return_value = {'error': code}
            response = self.get()
            self.assertEqual(response.status_code, status)
            self.assertNotIn(code, response.text)

    def test_malformed_or_inconsistent_results_are_500(self):
        ok = pendiente(1); other = pendiente(2, fecha='2026-01-05T00:00:00+00:00')
        bad_results = (
            None, {}, {'error': []}, {'error': 'PAGINACION_INVALIDA', 'extra': 'secret'},
            {**result(), 'extra': 'secret'},
            {**result(), 'limit': 1},                       # limit no coincide
            {**result(), 'offset': 5},                      # offset no coincide
            {**result(), 'hay_mas': True},                  # hay_mas sin página completa
            {**result(items=[ok, other], limit=1)},          # más filas que limit
            {**result(items=[pendiente(1, fecha='2026-01-05T00:00:00+00:00'),
                             pendiente(1, fecha='2026-02-01T00:00:00+00:00')])},  # id duplicado, orden válido
            {**result(items=[ok, other])},                  # orden incorrecto: 2026-10-20 antes que 2026-01-05
            {**result(items=[pendiente(pendientes=0)])},    # sin pendientes
            {**result(items=[pendiente(en_atencion=-1)])},  # contador negativo
            {**result(items=[{**ok, 'fecha_pendiente_antigua': '2026-01-01T00:00:00'}])},  # sin zona horaria
            {**result(items=[{**ok, 'fecha_pendiente_antigua': 'invalid'}])},
        )
        for data in bad_results:
            self.db.execute.return_value.scalar_one.return_value = data
            self.assertEqual(self.get().status_code, 500, data)
        self.db.commit.assert_not_called()

    # ---------- conexión y transacción ----------
    def test_database_connection_failure_is_503(self):
        self.db.execute.side_effect = fallo_sql('08006')
        self.assertEqual(self.get().status_code, 503)

    def test_unexpected_database_error_is_sanitized_500(self):
        self.db.execute.side_effect = fallo_sql('42501')
        response = self.get()
        self.assertEqual(response.status_code, 500)
        self.assertNotIn('42501', response.text)

    def test_context_connection_failure_is_503_without_opening_restricted(self):
        self.context.side_effect = fallo_sql()
        self.assertEqual(self.get().status_code, 503)
        self.open.assert_not_called()

    def test_no_configuration_no_fallback(self):
        del app.dependency_overrides[get_incidencias_db]
        with patch('app.core.incidencias_database._factory', None), \
                patch('app.core.incidencias_database.settings') as config:
            config.incidencias_database_url = None
            self.assertEqual(self.get().status_code, 503)
        self.db.execute.assert_not_called()
        self.principal.execute.assert_not_called()

    def test_read_only_single_function_call_no_commit_no_retry(self):
        self.assertEqual(self.get().status_code, 200)
        queries = [str(call.args[0]) for call in self.db.execute.call_args_list]
        self.assertEqual(queries[0], 'SET TRANSACTION READ ONLY')
        self.assertIn('incidencias_privadas.fn_resumen_incidencias_pendientes(', queries[1])
        self.assertEqual(len(queries), 2)  # una sola llamada a la función: sin N+1 ni reintentos
        self.db.commit.assert_not_called()

    def test_failure_rolls_back_and_does_not_retry(self):
        self.db.execute.side_effect = [None, fallo_sql('08006')]
        self.assertEqual(self.get().status_code, 503)
        self.assertEqual(self.db.execute.call_count, 2)
        self.db.rollback.assert_called()
        self.db.commit.assert_not_called()

    def test_failed_rollback_preserves_business_error(self):
        self.db.execute.return_value.scalar_one.return_value = {'error': 'USUARIO_NO_AUTORIZADO'}
        self.db.rollback.side_effect = fallo_sql()
        with self.assertRaises(ConsultaIncidenciasError) as error:
            consultar_resumen_incidencias_pendientes(self.db, 101, 50, 0)
        self.assertEqual(error.exception.codigo, 'USUARIO_NO_AUTORIZADO')

    # ---------- enrutamiento ----------
    def test_route_is_not_captured_by_practice_detail(self):
        # Con el router de prácticas antes, esta ruta respondía 422. Debe responder 200.
        self.assertEqual(self.get().status_code, 200)
        self.db.execute.return_value.scalar_one.return_value = result(limit=1)
        self.assertEqual(self.get('?limit=1').status_code, 200)
