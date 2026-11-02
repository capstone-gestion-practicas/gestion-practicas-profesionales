import os
import unittest
from unittest.mock import MagicMock, patch

os.environ.setdefault('SUPABASE_DATABASE_URL', 'postgresql+psycopg://user:synthetic@localhost/test')
os.environ.setdefault('JWT_SECRET_KEY', 'unit-test-secret')

from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from app.core.database import get_db
from app.core.inicio_practica_database import get_inicio_practica_db
from app.core.security import get_current_user_id
from app.main import app
from app.practicas.schemas import IniciarPracticaRequest
from app.practicas.service import iniciar_practica, InicioPracticaError


def exito():
    return {
        'id_practica': 15,
        'estado_anterior': {'id_estado': 3, 'nombre': 'APROBADA'},
        'estado': {'id_estado': 4, 'nombre': 'EN_CURSO', 'es_final': False},
        'fecha_ultimo_cambio_estado': '2026-10-17T15:00:00Z',
        'id_historial': 90,
    }


class InicioPracticaTests(unittest.TestCase):
    def setUp(self):
        previous = dict(app.dependency_overrides)
        self.addCleanup(self.restore_overrides, previous)
        self.db = MagicMock()
        self.main_db = MagicMock()
        self.db.execute.return_value.scalar_one.return_value = exito()
        self.restricted_dependency = MagicMock(return_value=self.db)
        # FastAPI necesita una firma sin *args/**kwargs para el override.
        def restricted_dependency():
            return self.restricted_dependency()
        app.dependency_overrides[get_inicio_practica_db] = restricted_dependency
        app.dependency_overrides[get_db] = lambda: self.main_db
        app.dependency_overrides[get_current_user_id] = lambda: 123
        self.roles = self.enterContext(patch(
            'app.core.permissions.obtener_contexto_usuario', return_value={'roles': ['GESTOR']},
        ))
        self.enterContext(patch('app.core.database.SessionLocal', side_effect=AssertionError('Fallback prohibido')))
        self.enterContext(patch('sqlalchemy.engine.Engine.connect', side_effect=AssertionError('Conexión real prohibida')))
        self.enterContext(patch('socket.create_connection', side_effect=AssertionError('Red prohibida')))
        self.client = self.enterContext(TestClient(app))

    @staticmethod
    def restore_overrides(previous):
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous)

    def request(self, body=None, identifier='15'):
        return self.client.patch(f'/practicas/{identifier}/estado', json=body if body is not None else {'estado': 'EN_CURSO'})

    def test_success_for_both_roles_and_authenticated_identity(self):
        for rol in ['GESTOR', 'ADMINISTRADOR']:
            with self.subTest(rol=rol):
                self.db.reset_mock()
                self.roles.return_value = {'roles': [rol]}
                response = self.request({'estado': 'EN_CURSO', 'observacion': '  Sintética  '})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json(), {**exito(), 'mensaje': 'La práctica se inició correctamente'})
                self.roles.assert_called_with(db=self.main_db, id_usuario=123)
                sql, parameters = self.db.execute.call_args.args
                self.assertEqual(parameters, {'id_practica': 15, 'id_usuario': 123, 'observacion': 'Sintética'})
                self.assertIn('SELECT practicas_privadas.fn_iniciar_practica(', str(sql))
                self.assertIn(':id_usuario', str(sql))
                self.assertNotIn('Sintética', str(sql))
                self.assertNotIn('UPDATE ', str(sql))
                self.assertNotIn('INSERT ', str(sql))
                self.db.execute.assert_called_once()
                self.db.commit.assert_called_once()
                self.db.rollback.assert_not_called()
                self.main_db.execute.assert_not_called()
                self.main_db.commit.assert_not_called()

    def test_student_denied_before_restricted_connection(self):
        self.roles.return_value = {'roles': ['ESTUDIANTE']}
        self.assertEqual(self.request().status_code, 403)
        self.restricted_dependency.assert_not_called()
        self.db.execute.assert_not_called()

    def test_missing_and_invalid_authentication_match_existing(self):
        del app.dependency_overrides[get_current_user_id]
        for headers in [{}, {'Authorization': 'Bearer invalid-token'}]:
            with self.subTest(headers=headers):
                existing = self.client.get('/practicas/me', headers=headers)
                response = self.client.patch('/practicas/15/estado', headers=headers, json={'estado': 'EN_CURSO'})
                self.assertIn(response.status_code, (401, 403))
                self.assertEqual(response.status_code, existing.status_code)
                self.assertEqual(response.json(), existing.json())
        self.restricted_dependency.assert_not_called()
        self.db.execute.assert_not_called()

    def test_invalid_identifiers(self):
        for identifier in ['abc', '0', '-1', '9223372036854775808']:
            with self.subTest(identifier=identifier):
                self.assertEqual(self.request(identifier=identifier).status_code, 422)
        self.db.execute.assert_not_called()
        self.db.commit.assert_not_called()

    def test_invalid_requests_and_no_client_identity(self):
        for body in [{}, {'estado': 'APROBADA'}, {'estado': None},
                     {'estado': 'EN_CURSO', 'id_usuario': 999},
                     {'estado': 'EN_CURSO', 'extra': True},
                     {'estado': 'EN_CURSO', 'observacion': 'a' * 501},
                     {'estado': 'EN_CURSO', 'observacion': 12}]:
            with self.subTest(fields=list(body)):
                self.assertEqual(self.request(body).status_code, 422)
        self.db.execute.assert_not_called()
        self.db.commit.assert_not_called()

    def test_observation_normalization_before_limit_and_null(self):
        for value, expected in [(None, None), ('   ', None), (' a ', 'a'), (' ' + 'a' * 500 + ' ', 'a' * 500)]:
            with self.subTest(length=None if value is None else len(value)):
                self.assertEqual(self.request({'estado': 'EN_CURSO', 'observacion': value}).status_code, 200)
                self.assertEqual(self.db.execute.call_args.args[1]['observacion'], expected)

    def test_business_errors_rollback_without_commit(self):
        errors = {'USUARIO_NO_AUTORIZADO': 403, 'PRACTICA_NO_ENCONTRADA': 404,
                  'ESTADO_FINAL': 409, 'TRANSICION_NO_PERMITIDA': 409,
                  'HISTORIAL_INCONSISTENTE': 409, 'OBSERVACION_INVALIDA': 422,
                  'ESTADO_DESTINO_NO_VALIDO': 500, 'UNKNOWN_INTERNAL_SECRET': 500}
        for code, expected in errors.items():
            with self.subTest(code=code):
                self.db.reset_mock()
                self.db.execute.return_value.scalar_one.return_value = {'error': code}
                response = self.request()
                self.assertEqual(response.status_code, expected)
                self.assertNotIn(code, response.text)
                self.db.rollback.assert_called_once()
                self.db.commit.assert_not_called()

    def test_sql_failure_rolls_back_is_safe_and_does_not_retry(self):
        self.db.execute.side_effect = OperationalError('secret SQL', {}, Exception('secret credentials'))
        response = self.request()
        self.assertEqual(response.status_code, 500)
        self.assertNotIn('secret', response.text)
        self.db.execute.assert_called_once()
        self.db.rollback.assert_called_once()
        self.db.commit.assert_not_called()

    def test_lost_connection_returns_503_and_rolls_back(self):
        self.db.execute.side_effect = OperationalError('synthetic', {}, Exception('synthetic'), connection_invalidated=True)
        self.assertEqual(self.request().status_code, 503)
        self.db.rollback.assert_called_once()
        self.db.commit.assert_not_called()

    def test_commit_failure_rolls_back_without_retry(self):
        self.db.commit.side_effect = OperationalError('synthetic', {}, Exception('synthetic'))
        self.assertEqual(self.request().status_code, 500)
        self.db.commit.assert_called_once()
        self.db.rollback.assert_called_once()
        self.db.execute.assert_called_once()

    def test_malformed_result_rolls_back_before_commit(self):
        for result in [None, {}, {'id_practica': 15}]:
            with self.subTest(result=result):
                self.db.reset_mock()
                self.db.execute.return_value.scalar_one.return_value = result
                self.assertEqual(self.request().status_code, 500)
                self.db.rollback.assert_called_once()
                self.db.commit.assert_not_called()

    def test_rollback_failure_does_not_replace_business_conflict(self):
        self.db.execute.return_value.scalar_one.return_value = {'error': 'TRANSICION_NO_PERMITIDA'}
        self.db.rollback.side_effect = OperationalError('synthetic', {}, Exception('synthetic'))
        self.assertEqual(self.request().status_code, 409)
        self.db.rollback.assert_called_once()
        self.db.commit.assert_not_called()

    def test_real_dependency_missing_configuration_returns_503_without_fallback(self):
        del app.dependency_overrides[get_inicio_practica_db]
        with patch('app.core.inicio_practica_database._factory', None), patch(
            'app.core.inicio_practica_database.settings',
        ) as settings:
            settings.inicio_practica_database_url = None
            self.assertEqual(self.request().status_code, 503)
        self.db.execute.assert_not_called()

    def test_real_dependency_connection_failure_closes_session(self):
        del app.dependency_overrides[get_inicio_practica_db]
        self.db.connection.side_effect = OperationalError('secret', {}, Exception('secret'))
        with patch('app.core.inicio_practica_database._get_session_factory', return_value=MagicMock(return_value=self.db)):
            response = self.request()
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('secret', response.text)
        self.db.close.assert_called_once()
        self.db.execute.assert_not_called()

    def test_http_conflict_survives_close_failure_in_real_dependency(self):
        del app.dependency_overrides[get_inicio_practica_db]
        self.db.execute.return_value.scalar_one.return_value = {'error': 'TRANSICION_NO_PERMITIDA'}
        self.db.close.side_effect = OperationalError('secret', {}, Exception('secret'))
        with patch('app.core.inicio_practica_database._get_session_factory', return_value=MagicMock(return_value=self.db)):
            response = self.request()
        self.assertEqual(response.status_code, 409)
        self.db.close.assert_called_once()
        self.db.rollback.assert_called_once()
        self.db.commit.assert_not_called()

    def test_service_directly_uses_bound_parameters_and_rolls_back(self):
        self.db.execute.return_value.scalar_one.return_value = {'error': 'PRACTICA_NO_ENCONTRADA'}
        with self.assertRaises(InicioPracticaError) as error:
            iniciar_practica(self.db, 19, 456, IniciarPracticaRequest(estado='EN_CURSO'))
        self.assertEqual(error.exception.codigo, 'PRACTICA_NO_ENCONTRADA')
        self.assertEqual(self.db.execute.call_args.args[1], {'id_practica': 19, 'id_usuario': 456, 'observacion': None})
        self.db.rollback.assert_called_once()
        self.db.commit.assert_not_called()
