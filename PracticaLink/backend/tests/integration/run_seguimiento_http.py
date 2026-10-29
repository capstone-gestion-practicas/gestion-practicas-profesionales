"""HTTP + PostgreSQL 18.6 real, exclusivamente en Docker temporal local."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
from datetime import timedelta
import os
import secrets
import signal
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

from run_registro_seguimiento import SeguimientoPostgres, make_suite as sql_suite
from run_inicio_practica import ROOT


def http_suite(pg, stack):
    import psycopg
    from sqlalchemy.engine import URL

    def connection():
        return psycopg.connect(host=pg.host, hostaddr=pg.host, port=5432,
            dbname='ep04_integration', user='postgres', password=pg.admin_password,
            autocommit=True, connect_timeout=5, sslmode='disable',
            gssencmode='disable', passfile='/dev/null',
            options='-c statement_timeout=10000 -c lock_timeout=7000')

    # EmailStr rechaza el dominio reservado .invalid de las fixtures SQL.
    # Solo se ajustan datos sintéticos de este laboratorio para el contrato HTTP.
    with connection() as admin:
        admin.execute("UPDATE usuario SET correo=replace(correo, '@example.invalid', '@example.com') WHERE id_usuario IN (100,101,102)")

    def url(user, password):
        return URL.create('postgresql+psycopg', username=user, password=password,
            host=pg.host, port=5432, database='ep04_integration').render_as_string(hide_password=False)

    # Importar la aplicación solo después de aislar entorno y cwd: nunca .env.
    temporary = stack.enter_context(tempfile.TemporaryDirectory(prefix='hu013-http-'))
    previous = os.getcwd()
    stack.callback(os.chdir, previous)
    os.chdir(temporary)
    stack.enter_context(patch.dict(os.environ, {
        'SUPABASE_DATABASE_URL': url('postgres', pg.admin_password),
        'INICIO_PRACTICA_DATABASE_URL': url('ep04_integration_login', pg.executor_password),
        'SEGUIMIENTOS_DATABASE_URL': url('ep05_test_login', pg.executor_password),
        'JWT_SECRET_KEY': secrets.token_hex(32),
    }, clear=True))
    sys.path.insert(0, str(ROOT / 'PracticaLink/backend'))
    from fastapi.testclient import TestClient
    from app.main import app
    from app.core.security import create_access_token
    from app.core import database, seguimientos_database as restricted, inicio_practica_database as ep04

    def dispose():
        for module in (restricted, ep04):
            if module._factory is not None:
                module._factory.kw['bind'].dispose()
                module._factory = None
        database.engine.dispose()
    stack.callback(dispose)

    class HttpSeguimientoTests(unittest.TestCase):
        def setUp(self):
            self.admin = connection()
            self.addCleanup(self.admin.close)
            self.client = self.enterContext(TestClient(app))
            self.identifier = self.practice()
            self.today = self.admin.execute("SELECT (clock_timestamp() AT TIME ZONE 'America/Santiago')::date").fetchone()[0]
            self.body = {'fecha': self.today.isoformat(), 'tipo': 'Otro', 'observacion': ' Texto de prueba '}

        def practice(self, state='EN_CURSO'):
            return self.admin.execute('''INSERT INTO practica(id_estudiante,id_centro,id_estado_actual)
                SELECT 100,100,id_estado FROM estado_practica WHERE nombre=%s RETURNING id_practica''', (state,)).fetchone()[0]

        def headers(self, actor=101):
            return {'Authorization': 'Bearer ' + create_access_token(actor)}

        def post(self, actor=101, body=None, identifier=None, headers=None):
            return self.client.post(f'/practicas/{self.identifier if identifier is None else identifier}/seguimientos',
                json=self.body if body is None else body, headers=self.headers(actor) if headers is None else headers)

        def rows(self):
            return self.admin.execute('SELECT id_seguimiento,id_usuario,fecha_seguimiento,tipo,observacion FROM seguimiento WHERE id_practica=%s ORDER BY id_seguimiento', (self.identifier,)).fetchall()

        def test_201_committed_and_identity_for_both_roles(self):
            for actor in (101, 102):
                response = self.post(actor)
                self.assertEqual(response.status_code, 201)
                result = response.json()
                self.assertEqual(result['id_usuario'], actor)
                self.assertEqual(self.rows()[-1], (result['id_seguimiento'], actor, self.today, self.body['tipo'], self.body['observacion']))
            self.assertEqual(len(self.rows()), 2)

        def test_authentication_and_roles_real_context(self):
            import jwt
            from app.core.config import settings
            expired = jwt.encode({'sub': '101', 'exp': 1}, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)
            for headers in ({}, {'Authorization': 'Bearer invalid'}, {'Authorization': 'Bearer '+expired}):
                self.assertIn(self.post(headers=headers).status_code, (401, 403))
            for actor in (100, 999999):
                self.assertEqual(self.post(actor).status_code, 403)
            self.admin.execute('UPDATE usuario SET activo=false WHERE id_usuario=101')
            try:
                self.assertEqual(self.post().status_code, 403)
            finally:
                self.admin.execute('UPDATE usuario SET activo=true WHERE id_usuario=101')
            self.admin.execute("UPDATE rol SET activo=false WHERE nombre='GESTOR'")
            try:
                self.assertEqual(self.post().status_code, 403)
            finally:
                self.admin.execute("UPDATE rol SET activo=true WHERE nombre='GESTOR'")
            self.assertEqual(self.rows(), [])

        def test_invalid_input_never_writes(self):
            invalid = [{'fecha': (self.today+timedelta(days=1)).isoformat()}, {'fecha': self.today.isoformat()+'T00:00:00Z'},
                {'observacion': ''}, {'observacion': ' \t\n'}, {'observacion': 'á'*2001},
                {'tipo': 'invalid'}, {'id_usuario': 102}, {'id_autor': 102}]
            for change in invalid:
                with self.subTest(field=next(iter(change))):
                    self.assertEqual(self.post(body={**self.body, **change}).status_code, 422)
            self.assertEqual(self.rows(), [])

        def test_missing_practice_and_all_other_states(self):
            self.assertEqual(self.post(identifier=9223372036854775807).status_code, 404)
            for (state,) in self.admin.execute("SELECT nombre FROM estado_practica WHERE nombre<>'EN_CURSO'").fetchall():
                identifier = self.practice(state)
                self.assertEqual(self.post(identifier=identifier).status_code, 409)
                self.assertEqual(self.admin.execute('SELECT count(*) FROM seguimiento WHERE id_practica=%s',(identifier,)).fetchone()[0],0)
            self.assertEqual(self.post().status_code, 201)

        def test_insert_error_rolls_back_and_preserves_previous_rows(self):
            self.assertEqual(self.post().status_code, 201)
            before = self.rows()
            # Trigger falla después del INSERT real. No se sustituye la función HU013.
            self.admin.execute('''CREATE FUNCTION public.http_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN RAISE EXCEPTION 'synthetic internal error'; END $$;
                CREATE TRIGGER http_test_fail AFTER INSERT ON seguimiento FOR EACH ROW EXECUTE FUNCTION public.http_test_fail()''')
            try:
                response = self.post()
                self.assertEqual(response.status_code, 500)
                self.assertNotIn('synthetic internal error', response.text)
                self.assertEqual(self.rows(), before)
            finally:
                self.admin.execute('DROP TRIGGER http_test_fail ON seguimiento; DROP FUNCTION public.http_test_fail()')
            self.assertEqual(self.post().status_code, 201)
            self.assertEqual(len(self.rows()), 2)

        def test_deferred_commit_failure_rolls_back(self):
            self.assertEqual(self.post().status_code, 201)
            before = self.rows()
            self.admin.execute('''CREATE FUNCTION public.http_test_commit_fail() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN RAISE EXCEPTION 'synthetic deferred error'; END $$;
                CREATE CONSTRAINT TRIGGER http_test_commit_fail AFTER INSERT ON seguimiento
                DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.http_test_commit_fail()''')
            try:
                response = self.post()
                self.assertEqual(response.status_code, 500)
                self.assertNotIn('synthetic deferred error', response.text)
                self.assertEqual(self.rows(), before)
            finally:
                self.admin.execute('DROP TRIGGER http_test_commit_fail ON seguimiento; DROP FUNCTION public.http_test_commit_fail()')
            self.assertEqual(self.post().status_code, 201)
            self.assertEqual(len(self.rows()), 2)

        def test_privileges_and_no_main_connection_fallback(self):
            from sqlalchemy import text
            from sqlalchemy.exc import DBAPIError
            # Sesión creada por la misma factory que utiliza el endpoint.
            dependency = restricted.get_seguimientos_db()
            db = next(dependency)
            try:
                self.assertEqual(db.execute(text('SELECT current_user')).scalar_one(), 'ep05_test_login')
                for query in ["INSERT INTO seguimiento(id_practica,id_usuario) VALUES(1,101)",
                              'UPDATE seguimiento SET observacion=observacion', 'DELETE FROM seguimiento', 'TRUNCATE seguimiento']:
                    with self.assertRaises(DBAPIError) as error:
                        db.execute(text(query))
                    self.assertEqual(error.exception.orig.sqlstate, '42501')
                    db.rollback()
            finally:
                dependency.close()
            # La principal permanece disponible y privilegiada: un fallback escribiría.
            for unavailable in (None, url('ep05_test_client', pg.executor_password)):
                with patch.object(restricted, '_factory', None), patch.object(restricted.settings, 'seguimientos_database_url', unavailable):
                    try:
                        response = self.post()
                        self.assertEqual(response.status_code, 503 if unavailable is None else 500)
                        self.assertEqual(self.rows(), [])
                    finally:
                        if restricted._factory is not None:
                            restricted._factory.kw['bind'].dispose()

        def test_concurrent_state_commit_and_rollback(self):
            for commit in (True, False):
                self.identifier = self.practice()
                with connection() as transition:
                    transition.execute('BEGIN')
                    transition.execute("UPDATE practica SET id_estado_actual=(SELECT id_estado FROM estado_practica WHERE nombre='FINALIZADA') WHERE id_practica=%s", (self.identifier,))
                    with ThreadPoolExecutor(max_workers=1) as pool:
                        future = pool.submit(self.post)
                        try:
                            deadline = time.monotonic()+5
                            while time.monotonic()<deadline:
                                waiting = self.admin.execute("SELECT count(*) FROM pg_stat_activity WHERE usename='ep05_test_login' AND wait_event_type='Lock'").fetchone()[0]
                                if waiting:
                                    break
                                time.sleep(.05)
                            else:
                                self.fail('El endpoint no alcanzó el bloqueo PostgreSQL esperado')
                            self.assertFalse(future.done())
                        finally:
                            transition.execute('COMMIT' if commit else 'ROLLBACK')
                        response = future.result(timeout=12)
                    self.assertEqual(response.status_code, 409 if commit else 201)
                    self.assertEqual(len(self.rows()), 0 if commit else 1)

        def test_ep03_context_and_ep04_start_then_followup(self):
            response = self.client.get('/auth/context', headers=self.headers(100))
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()['usuario']['id_usuario'], 100)
            self.identifier = self.practice('APROBADA')
            self.admin.execute("INSERT INTO historial_estado(id_practica,id_usuario,id_estado) SELECT %s,101,id_estado FROM estado_practica WHERE nombre='APROBADA'", (self.identifier,))
            response = self.client.patch(f'/practicas/{self.identifier}/estado', json={'estado': 'EN_CURSO'}, headers=self.headers())
            self.assertEqual(response.status_code, 200)
            self.assertEqual(self.post().status_code, 201)
            self.assertEqual(len(self.rows()), 1)

    return unittest.defaultTestLoader.loadTestsFromTestCase(HttpSeguimientoTests)


class SafeResult(unittest.TextTestResult):
    def _exc_info_to_string(self, err, test):
        # Errores DB/SQLAlchemy pueden incluir DSN, SQL o parámetros. No volcarlos.
        from fastapi.exceptions import ResponseValidationError
        if isinstance(err[1], ResponseValidationError):
            fields = [(e['loc'], e['type']) for e in err[1].errors()]
            return f'ResponseValidationError (campos y tipos, sin valores): {fields}'
        return f'{err[0].__name__}: detalle omitido para no revelar parámetros; revisar {test.id()}'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--docker-local', action='store_true', required=True)
    parser.add_argument('--image', default='postgres:18.6', help='imagen local 18.6, sin descarga')
    args = parser.parse_args()
    pg = SeguimientoPostgres(args.image)
    pg.name = 'ep05-http-' + pg.run_id
    pg.network, pg.volume = pg.name+'-net', pg.name+'-data'
    def interrupted(*_):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, interrupted)
    code = 1
    try:
        pg.start()
        runner = unittest.TextTestRunner(verbosity=2, resultclass=SafeResult)
        sql_result = runner.run(sql_suite(pg))
        if sql_result.wasSuccessful():
            with ExitStack() as stack:
                http_result = runner.run(http_suite(pg, stack))
                code = 0 if http_result.wasSuccessful() else 1
    except (Exception, KeyboardInterrupt) as error:
        print('Integración no completada:', type(error).__name__, file=sys.stderr)
    finally:
        try:
            pg.close()
            print('Limpieza de recursos exclusivos completada.' if pg.candidates else 'No se crearon recursos Docker.')
        except Exception:
            print('Limpieza incompleta: revisar recursos candidatos enumerados.', file=sys.stderr)
            code = 1
    return code


if __name__ == '__main__':
    sys.exit(main())
