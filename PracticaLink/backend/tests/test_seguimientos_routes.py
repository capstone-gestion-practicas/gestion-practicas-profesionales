import os
import unittest
from unittest.mock import MagicMock, patch

os.environ.setdefault('SUPABASE_DATABASE_URL', 'postgresql+psycopg://principal:synthetic@localhost/test')
os.environ.setdefault('JWT_SECRET_KEY', 'unit-test-secret')

from fastapi.testclient import TestClient
from app.core.database import get_db
from app.core.seguimientos_database import get_seguimientos_db
from app.core.security import create_access_token
from app.main import app
from tests.test_seguimientos_service import exito, fallo_sql


class SeguimientoRoutesTests(unittest.TestCase):
    def setUp(self):
        previous = dict(app.dependency_overrides)
        self.addCleanup(self.restore, previous)
        self.db = MagicMock()
        self.main_db = MagicMock()
        self.db.execute.return_value.scalar_one.return_value = exito()
        self.connection = MagicMock(return_value=self.db)
        def restricted():
            return self.connection()
        app.dependency_overrides[get_db] = lambda: self.main_db
        app.dependency_overrides[get_seguimientos_db] = restricted
        self.context = self.enterContext(patch('app.core.permissions.obtener_contexto_usuario',
            return_value={'usuario': {'id_usuario': 123}, 'roles': ['GESTOR']}))
        self.enterContext(patch('sqlalchemy.engine.Engine.connect', side_effect=AssertionError('BD real prohibida')))
        self.enterContext(patch('socket.create_connection', side_effect=AssertionError('Red prohibida')))
        self.client = self.enterContext(TestClient(app))
        self.headers = {'Authorization': 'Bearer ' + create_access_token(123)}
        self.body = {'fecha': '2026-01-01', 'tipo': 'Videollamada', 'observacion': ' Texto '}

    @staticmethod
    def restore(previous):
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous)

    def request(self, body=None, identifier='15', headers=None, query=''):
        return self.client.post(f'/practicas/{identifier}/seguimientos{query}',
            json=self.body if body is None else body,
            headers=self.headers if headers is None else headers)

    def test_real_jwt_roles_and_identity(self):
        for role in ['GESTOR', 'ADMINISTRADOR']:
            self.db.reset_mock()
            self.context.return_value = {'usuario': {'id_usuario': 123}, 'roles': [role]}
            result = self.request()
            self.assertEqual(result.status_code, 201, result.text)
            self.assertEqual(result.json(), exito())
            self.context.assert_called_with(id_usuario=123, db=self.main_db)
            self.assertEqual(self.db.execute.call_args.args[1]['id_usuario'], 123)
            self.db.commit.assert_called_once()
            self.main_db.commit.assert_not_called()
            self.main_db.execute.assert_not_called()

    def test_denied_inactive_missing_context_wrong_role_or_identity_before_connection(self):
        for context in [None, {'roles': []}, {'usuario': {'id_usuario': 123}, 'roles': ['ESTUDIANTE']},
                        {'usuario': None, 'roles': ['GESTOR']},
                        {'usuario': {'id_usuario': 999}, 'roles': ['GESTOR']}]:
            self.context.return_value = context
            self.assertEqual(self.request().status_code, 403)
        self.connection.assert_not_called()
        self.db.execute.assert_not_called()

    def test_missing_invalid_and_expired_jwt(self):
        import jwt
        from app.core.config import settings
        expired = jwt.encode({'sub': '123', 'exp': 1}, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)
        for headers in [{}, {'Authorization': 'Bearer invalid'}, {'Authorization': 'Bearer '+expired}]:
            current = self.client.get('/practicas/me', headers=headers)
            result = self.request(headers=headers)
            self.assertEqual(result.status_code, current.status_code)
            self.assertEqual(result.json(), current.json())
        self.context.assert_not_called()
        self.connection.assert_not_called()

    def test_request_rejects_author_extra_fields_dates_and_invalid_ids(self):
        for key in ['id_usuario', 'autor', 'id_autor', 'id_practica', 'proxima_fecha']:
            self.assertEqual(self.request({**self.body, key: 456}).status_code, 422)
        self.assertEqual(self.request(query='?id_usuario=456').status_code, 422)
        for body in [{}, {**self.body, 'fecha': '2099-01-01'}, {**self.body, 'observacion': ' '*4},
                     {**self.body, 'observacion': 'x'*2001}, {**self.body, 'tipo': 'Correo'}]:
            self.assertEqual(self.request(body).status_code, 422)
        for identifier in ['x', '0', '-1', '9223372036854775808']:
            self.assertEqual(self.request(identifier=identifier).status_code, 422)
        self.db.execute.assert_not_called()
        self.db.commit.assert_not_called()

    def test_business_errors_safe_and_rolled_back(self):
        for code, status in [('USUARIO_NO_AUTORIZADO',403), ('PRACTICA_NO_ENCONTRADA',404),
                             ('PRACTICA_NO_EN_CURSO',409), ('FECHA_INVALIDA',422),
                             ('MEDIO_INVALIDO',422), ('OBSERVACION_INVALIDA',422), ('SQL_SECRET',500)]:
            self.db.reset_mock()
            self.db.execute.return_value.scalar_one.return_value = {'error':code}
            result = self.request()
            self.assertEqual(result.status_code, status)
            self.assertNotIn(code, result.text)
            self.db.rollback.assert_called_once()
            self.db.commit.assert_not_called()

    def test_sql_concurrency_connection_and_commit_failures_safe(self):
        for stage, code, status in [('execute','40001',409), ('execute','40P01',409),
                                    ('execute','55P03',409), ('execute','08006',503), ('commit',None,500)]:
            self.db.reset_mock(side_effect=True)
            getattr(self.db,stage).side_effect = fallo_sql(code)
            result = self.request()
            self.assertEqual(result.status_code, status)
            self.assertNotIn('interno',result.text)
            self.db.execute.assert_called_once()
            self.db.rollback.assert_called_once()

    def test_context_connection_failure_is_safe(self):
        self.context.side_effect = fallo_sql()
        response = self.request()
        self.assertEqual(response.status_code,503)
        self.assertNotIn('interno',response.text)
        self.connection.assert_not_called()

    def test_missing_restricted_configuration_no_fallback(self):
        del app.dependency_overrides[get_seguimientos_db]
        with patch('app.core.seguimientos_database._factory',None), patch('app.core.seguimientos_database.settings') as config:
            config.seguimientos_database_url = None
            self.assertEqual(self.request().status_code,503)
        self.db.execute.assert_not_called()

    def test_openapi_only_post_and_closed_body(self):
        schema = app.openapi()
        endpoint = schema['paths']['/practicas/{id_practica}/seguimientos']
        self.assertEqual(set(endpoint), {'post', 'get'})
        self.assertIn('201',endpoint['post']['responses'])
        body = schema['components']['schemas']['SeguimientoCreate']
        self.assertFalse(body['additionalProperties'])
        self.assertEqual(set(body['properties']), {'fecha','tipo','observacion'})
