import os
import unittest
from unittest.mock import patch

os.environ.setdefault('SUPABASE_DATABASE_URL', 'postgresql+psycopg://principal:synthetic@localhost/test')
os.environ.setdefault('JWT_SECRET_KEY', 'unit-test-secret')

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from app.core import inicio_practica_database as restricted
from app.core.config import Settings


class RestrictedDatabaseTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch.object(restricted, '_factory', None))
        self.config = self.enterContext(patch.object(restricted, 'settings'))
        self.config.supabase_database_url = 'postgresql+psycopg://principal:synthetic@localhost/test'
        self.config.inicio_practica_database_url = 'postgresql+psycopg://executor:synthetic@localhost/test'
        self.engine = self.enterContext(patch.object(restricted, 'create_engine'))
        self.maker = self.enterContext(patch.object(restricted, 'sessionmaker'))
        self.factory = self.maker.return_value
        self.db = self.factory.return_value
        self.enterContext(patch('sqlalchemy.engine.Engine.connect', side_effect=AssertionError('Red prohibida')))
        self.enterContext(patch('socket.create_connection', side_effect=AssertionError('Red prohibida')))

    def test_settings_optional_and_environment_name(self):
        with patch.dict(os.environ, {'INICIO_PRACTICA_DATABASE_URL': 'synthetic'}, clear=True):
            settings = Settings(_env_file=None, supabase_database_url='synthetic', jwt_secret_key='synthetic')
        self.assertEqual(settings.inicio_practica_database_url, 'synthetic')
        with patch.dict(os.environ, {}, clear=True):
            settings = Settings(_env_file=None, supabase_database_url='synthetic', jwt_secret_key='synthetic')
        self.assertIsNone(settings.inicio_practica_database_url)

    def test_invalid_configuration_never_builds_engine_or_falls_back(self):
        invalid = [None, '', 'invalid', 'sqlite:///test',
                   self.config.supabase_database_url,
                   'postgresql+psycopg://principal:different@localhost/test?sslmode=require',
                   'postgresql+psycopg:///test',
                   'postgresql+psycopg://executor@localhost',
                   'postgresql+psycopg://executor@localhost/test?service=principal',
                   'postgresql+psycopg://executor@localhost/test?options=-crole=principal']
        with patch('app.core.database.SessionLocal', side_effect=AssertionError('Fallback prohibido')):
            for url in invalid:
                with self.subTest(url_index=invalid.index(url)):
                    self.config.inicio_practica_database_url = url
                    with self.assertRaises(restricted.HTTPException) as error:
                        next(restricted.get_inicio_practica_db())
                    self.assertEqual(error.exception.status_code, 503)
                    self.assertEqual(error.exception.detail, restricted._UNAVAILABLE)
        self.engine.assert_not_called()

    def test_lazy_initialization_reuses_independent_factory(self):
        dependency = restricted.get_inicio_practica_db()
        self.engine.assert_not_called()
        self.assertIs(next(dependency), self.db)
        dependency.close()
        second = restricted.get_inicio_practica_db()
        self.assertIs(next(second), self.db)
        second.close()
        self.engine.assert_called_once()
        self.maker.assert_called_once_with(autocommit=False, autoflush=False, bind=self.engine.return_value)
        self.assertEqual(self.factory.call_count, 2)
        self.assertEqual(self.db.close.call_count, 2)
        self.db.commit.assert_not_called()

    def test_connection_error_is_sanitized_and_session_closed(self):
        self.db.connection.side_effect = OperationalError('secret-url', {}, Exception('secret-password'))
        with self.assertRaises(restricted.HTTPException) as error:
            next(restricted.get_inicio_practica_db())
        self.assertEqual(error.exception.detail, restricted._UNAVAILABLE)
        self.db.close.assert_called_once()
        self.db.commit.assert_not_called()

    def test_engine_error_is_sanitized_and_retry_possible(self):
        self.engine.side_effect = OperationalError('secret-url', {}, Exception('secret'))
        with self.assertRaises(restricted.HTTPException):
            next(restricted.get_inicio_practica_db())
        self.assertIsNone(restricted._factory)
        self.engine.side_effect = None
        dependency = restricted.get_inicio_practica_db()
        self.assertIs(next(dependency), self.db)
        dependency.close()

    def test_factory_failure_disposes_unused_engine(self):
        self.maker.side_effect = OperationalError('synthetic', {}, Exception('synthetic'))
        with self.assertRaises(restricted.HTTPException):
            next(restricted.get_inicio_practica_db())
        self.engine.return_value.dispose.assert_called_once()
        self.assertIsNone(restricted._factory)

    def test_business_error_propagates_and_closes_without_commit(self):
        dependency = restricted.get_inicio_practica_db()
        next(dependency)
        with self.assertRaisesRegex(ValueError, 'business'):
            dependency.throw(ValueError('business'))
        self.db.close.assert_called_once()
        self.db.commit.assert_not_called()

    def test_close_failure_is_sanitized(self):
        dependency = restricted.get_inicio_practica_db()
        next(dependency)
        self.db.close.side_effect = OperationalError('secret-url', {}, Exception('secret'))
        with self.assertRaises(restricted.HTTPException) as error:
            dependency.close()
        self.assertEqual(error.exception.status_code, 503)
        self.assertEqual(error.exception.detail, restricted._UNAVAILABLE)
        self.db.close.assert_called_once()
        self.db.commit.assert_not_called()

    def test_http_conflict_is_preserved_when_close_also_fails(self):
        dependency = restricted.get_inicio_practica_db()
        next(dependency)
        original = restricted.HTTPException(status_code=409, detail='Conflicto sintetico')
        self.db.close.side_effect = OperationalError('secret-url', {}, Exception('secret'))
        with self.assertRaises(restricted.HTTPException) as error:
            dependency.throw(original)
        self.assertIs(error.exception, original)
        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(error.exception.detail, 'Conflicto sintetico')
        self.db.close.assert_called_once()
        self.db.commit.assert_not_called()

    def test_http_failure_does_not_expose_driver_details(self):
        app = FastAPI()

        @app.get('/synthetic')
        def synthetic(db=Depends(restricted.get_inicio_practica_db)):
            return {'ok': True}

        self.db.connection.side_effect = OperationalError('secret-url', {}, Exception('secret'))
        with TestClient(app) as client:
            response = client.get('/synthetic')
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json(), {'detail': restricted._UNAVAILABLE})


if __name__ == '__main__':
    unittest.main()
