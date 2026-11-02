"""Integración optativa HTTP/SQL: ejecutar directamente con --docker-local."""

import argparse
from contextlib import ExitStack
import io
import json
import os
from pathlib import Path
import secrets
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import MagicMock, patch


ROOT = Path(__file__).resolve().parents[4]
LABEL = 'practicalink.ep04.integration'
DOCKER_BINARY = shutil.which('docker') or 'docker'
docker_endpoint = None


def docker(*args, source=None, check=True):
    result = subprocess.run(
        [DOCKER_BINARY, *(['--host',docker_endpoint] if docker_endpoint else []), *args],
        input=source, text=True, capture_output=True, timeout=45,
    )
    if check and result.returncode:
        # No imprimir stderr, SQL, URLs ni parámetros potencialmente sensibles.
        raise RuntimeError(f'Docker: falló {args[0]}; comprobar daemon/imagen/permisos locales')
    return result


class LocalPostgres:
    def __init__(self, image):
        self.image = image
        self.run_id = secrets.token_hex(12)
        self.name = 'ep04-integration-' + self.run_id
        self.network = self.name + '-net'
        self.volume = self.name + '-data'
        self.admin_password = secrets.token_hex(24)
        self.executor_password = secrets.token_hex(24)
        self.candidates = []

    def inspect_resource(self, kind, name):
        result = docker(kind, 'inspect', name, check=False)
        if result.returncode:
            # Un error de inspect también puede ser un daemon inaccesible.
            # Solo una enumeración exitosa que no contiene el nombre prueba ausencia.
            field = '{{.Names}}' if kind == 'container' else '{{.Name}}'
            args = (kind, 'ls', '--all') if kind == 'container' else (kind, 'ls')
            listing = docker(*args, '--format', field, check=False)
            if listing.returncode:
                raise RuntimeError('Inspección y enumeración fallidas')
            if name in listing.stdout.splitlines():
                raise RuntimeError('Recurso presente pero no inspeccionable')
            return None
        try:
            entries = json.loads(result.stdout)
            if not isinstance(entries,list) or len(entries) != 1:
                raise ValueError
            info = entries[0]
            actual_name = info['Name'].removeprefix('/') if kind == 'container' else info['Name']
            if actual_name != name:
                raise ValueError
            return info
        except (ValueError,KeyError,TypeError,AttributeError):
            raise RuntimeError('Resultado de inspección ambiguo') from None

    def owned_resource(self, kind, name):
        info = self.inspect_resource(kind,name)
        if info is None:
            return None
        labels = info.get('Config',{}).get('Labels') if kind == 'container' else info.get('Labels')
        if not isinstance(labels,dict) or labels.get(LABEL) != self.run_id:
            raise RuntimeError('Recurso ajeno o propiedad no acreditada; no se elimina')
        # Fijar el objeto inspeccionado por ID siempre que Docker lo permita.
        identifier = name if kind == 'volume' else info.get('Id')
        if not isinstance(identifier,str) or not identifier:
            raise RuntimeError('Identificador de recurso ambiguo')
        return identifier

    def create_resource(self, kind, name, *args):
        # Registrar antes de invocar al daemon, incluso si el cliente se interrumpe.
        self.candidates.append((kind,name))
        print('Recurso candidato exclusivo:',kind,name,flush=True)
        docker(*args)
        identifier = self.owned_resource(kind,name)
        if identifier is None:
            raise RuntimeError('Creación no confirmada; recurso no observado')
        return identifier

    def start(self):
        global docker_endpoint
        # Rechazar contextos remotos, incluido un daemon TCP en localhost.
        if os.environ.get('DOCKER_HOST'):
            raise RuntimeError('Eliminar DOCKER_HOST: solo se admite Docker local por socket Unix')
        context = json.loads(docker('context', 'inspect').stdout)[0]
        endpoint = context['Endpoints']['docker']['Host']
        if not endpoint.startswith('unix://'):
            raise RuntimeError('El contexto Docker no usa un socket Unix local')
        docker_endpoint = endpoint
        docker('image', 'inspect', self.image)  # Nunca descarga imágenes.
        for kind, name in [('network', self.network), ('volume', self.volume), ('container', self.name)]:
            if self.inspect_resource(kind,name) is not None:
                raise RuntimeError('Colisión con recurso existente; no se reutiliza')
        self.create_resource('network',self.network,'network','create','--internal',
                             '--label',f'{LABEL}={self.run_id}',self.network)
        self.create_resource('volume',self.volume,'volume','create',
                             '--label',f'{LABEL}={self.run_id}',self.volume)
        container_id = self.create_resource('container',self.name,
            'create', '--pull=never', '--name', self.name, '--label', f'{LABEL}={self.run_id}',
            '--network', self.network, '--mount', f'type=volume,source={self.volume},target=/var/lib/postgresql',
            '-e', f'POSTGRES_PASSWORD={self.admin_password}', '-e', 'POSTGRES_DB=ep04_integration', self.image,
        )
        self.container_id = container_id
        docker('start', container_id)
        for _ in range(100):
            if self.sql('SELECT 1', check=False).returncode == 0:
                break
            time.sleep(.2)
        else:
            raise RuntimeError('PostgreSQL local no quedó disponible')
        version = self.sql('SHOW server_version_num').stdout.strip()
        if version != '180006':
            raise RuntimeError('Esta suite requiere PostgreSQL 18.6; usar una imagen local compatible')
        print('PostgreSQL 18.6; recursos exclusivos:', self.name, flush=True)
        self.host = json.loads(docker('inspect', container_id).stdout)[0]['NetworkSettings']['Networks'][self.network]['IPAddress']
        info = json.loads(docker('network', 'inspect', self.network).stdout)[0]
        bindings = json.loads(docker('inspect', container_id).stdout)[0]['HostConfig']['PortBindings']
        if not info['Internal'] or bindings or not self.host:
            raise RuntimeError('El aislamiento Docker no cumple las condiciones requeridas')
        for path in ['scripts/BD/schema.sql', 'scripts/BD/fixes/ep04-01-permisos-iniciar-practica.sql',
                     'scripts/BD/fixes/ep04-fn-iniciar-practica.sql']:
            self.sql((ROOT / path).read_text())
        self.sql(f"""
            CREATE ROLE ep04_integration_login LOGIN INHERIT NOSUPERUSER NOBYPASSRLS
                NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '{self.executor_password}';
            GRANT pl_ep04_executor TO ep04_integration_login;
            INSERT INTO usuario(id_usuario,nombre,apellido,correo,password_hash) VALUES
                (100,'Estudiante','Sintetico','student@example.invalid','synthetic-hash'),
                (101,'Gestor','Sintetico','manager@example.invalid','synthetic-hash'),
                (102,'Admin','Sintetico','admin@example.invalid','synthetic-hash');
            INSERT INTO usuario_rol SELECT 100,id_rol FROM rol WHERE nombre='ESTUDIANTE';
            INSERT INTO usuario_rol SELECT 101,id_rol FROM rol WHERE nombre='GESTOR';
            INSERT INTO usuario_rol SELECT 102,id_rol FROM rol WHERE nombre='ADMINISTRADOR';
            INSERT INTO estudiante(id_estudiante,id_usuario,rut,carrera,sede)
                VALUES(100,100,'12345678-5','Carrera sintetica','Sede sintetica');
            INSERT INTO centro_practica(id_centro,nombre) VALUES(100,'Centro sintetico');
        """)

    def sql(self, source, check=True):
        return docker('exec', '-i', self.container_id, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
                      '-U', 'postgres', '-d', 'ep04_integration', source=source, check=check)

    def close(self):
        failures = []
        for kind, name in reversed(self.candidates):
            try:
                identifier = self.owned_resource(kind,name)
                if identifier is None:
                    print('Recurso candidato no existente:',kind,name,flush=True)
                    continue
                args = ('rm', '-f', identifier) if kind == 'container' else (kind, 'rm', identifier)
                docker(*args)
                print('Eliminado recurso exclusivo:', kind, identifier, flush=True)
            except Exception as error:
                reason = str(error) if isinstance(error,RuntimeError) else type(error).__name__
                failures.append((kind,name,reason))
        if failures:
            raise RuntimeError(f'Limpieza pendiente; no se eliminan recursos de propiedad no acreditada: {failures}')


class CleanupSafetyTests(unittest.TestCase):
    @staticmethod
    def resource_info(pg,kind,name,owner=None):
        labels = {LABEL:pg.run_id if owner is None else owner}
        info = {'Name':'/'+name if kind == 'container' else name,'Id':'id-'+name}
        info['Config' if kind == 'container' else 'Labels'] = {'Labels':labels} if kind == 'container' else labels
        return info

    def test_interruptions_and_timeouts_during_each_creation(self):
        for kind in ['network','volume','container']:
            for exception_type in [KeyboardInterrupt,subprocess.TimeoutExpired]:
                for completed in [False,True]:
                    with self.subTest(kind=kind,error=exception_type.__name__,created=completed):
                        pg = LocalPostgres('synthetic-image')
                        name = {'network':pg.network,'volume':pg.volume,'container':pg.name}[kind]
                        removed = []
                        error = KeyboardInterrupt() if exception_type is KeyboardInterrupt else subprocess.TimeoutExpired('docker',45)
                        def fake(*args,**kwargs):
                            if 'create' in args:
                                self.assertIn((kind,name),pg.candidates)
                                raise error
                            if 'inspect' in args:
                                return subprocess.CompletedProcess(args,0 if completed else 1,
                                    json.dumps([self.resource_info(pg,kind,name)]) if completed else '', '')
                            if 'ls' in args:
                                return subprocess.CompletedProcess(args,0,'','')
                            if 'rm' in args:
                                removed.append(args[-1])
                            return subprocess.CompletedProcess(args,0,'','')
                        with patch(f'{__name__}.docker',side_effect=fake), patch('sys.stdout',new_callable=io.StringIO):
                            with self.assertRaises(exception_type) as observed:
                                pg.create_resource(kind,name,kind,'create',name)
                            self.assertIs(observed.exception,error)
                            pg.close()
                        expected = name if kind == 'volume' else 'id-'+name
                        self.assertEqual(removed,[expected] if completed else [])

    def test_foreign_resource_is_never_removed(self):
        for kind in ['network','volume','container']:
            with self.subTest(kind=kind):
                pg = LocalPostgres('synthetic-image')
                name = {'network':pg.network,'volume':pg.volume,'container':pg.name}[kind]
                pg.candidates.append((kind,name))
                response = subprocess.CompletedProcess([],0,json.dumps([self.resource_info(pg,kind,name,'other-run')]),'')
                with patch(f'{__name__}.docker',return_value=response) as mocked:
                    with self.assertRaisesRegex(RuntimeError,'Limpieza pendiente'):
                        pg.close()
                self.assertFalse(any('rm' in call.args for call in mocked.call_args_list))

    def test_inspect_and_listing_failure_never_deletes(self):
        pg = LocalPostgres('synthetic-image')
        pg.candidates.append(('volume',pg.volume))
        result = subprocess.CompletedProcess([],1,'','synthetic daemon failure')
        with patch(f'{__name__}.docker',return_value=result) as mocked:
            with self.assertRaisesRegex(RuntimeError,'Inspección y enumeración fallidas'):
                pg.close()
        self.assertFalse(any('rm' in call.args for call in mocked.call_args_list))

    def test_existing_but_uninspectable_is_not_absent(self):
        pg = LocalPostgres('synthetic-image')
        pg.candidates.append(('network',pg.network))
        with patch(f'{__name__}.docker',side_effect=[
            subprocess.CompletedProcess([],1,'',''),
            subprocess.CompletedProcess([],0,pg.network+'\n',''),
        ]) as mocked:
            with self.assertRaisesRegex(RuntimeError,'presente pero no inspeccionable'):
                pg.close()
        self.assertEqual(mocked.call_count,2)

    def test_ambiguous_inspection_is_not_deleted(self):
        for payload in ['not-json','[]','[{},{}]',json.dumps([{'Name':'another-name'}])]:
            with self.subTest(payload=payload):
                pg = LocalPostgres('synthetic-image')
                pg.candidates.append(('volume',pg.volume))
                with patch(f'{__name__}.docker',return_value=subprocess.CompletedProcess([],0,payload,'')) as mocked:
                    with self.assertRaisesRegex(RuntimeError,'ambiguo'):
                        pg.close()
                self.assertEqual(mocked.call_count,1)

    def test_cleanup_failure_keeps_original_error_and_reports_candidates(self):
        fake = MagicMock()
        fake.start.side_effect = RuntimeError('PREPARACION_ORIGINAL')
        fake.close.side_effect = RuntimeError('LIMPIEZA_SECUNDARIA')
        with patch(f'{__name__}.LocalPostgres',return_value=fake), \
             patch.object(sys,'argv',['runner','--docker-local']), \
             patch('signal.signal'), patch('sys.stderr',new_callable=io.StringIO) as output:
            self.assertEqual(main(),1)
        self.assertLess(output.getvalue().index('PREPARACION_ORIGINAL'),output.getvalue().index('LIMPIEZA_SECUNDARIA'))
        fake.close.assert_called_once()

    def test_cleanup_continues_after_one_resource_fails(self):
        pg = LocalPostgres('synthetic-image')
        pg.candidates = [('network',pg.network),('volume',pg.volume)]
        def fake(*args,**kwargs):
            if 'inspect' in args:
                kind,name = args[0],args[2]
                return subprocess.CompletedProcess(args,0,json.dumps([self.resource_info(pg,kind,name)]),'')
            if args[0] == 'volume':
                raise RuntimeError('Eliminación fallida')
            return subprocess.CompletedProcess(args,0,'','')
        with patch(f'{__name__}.docker',side_effect=fake) as mocked, patch('sys.stdout',new_callable=io.StringIO):
            with self.assertRaises(RuntimeError) as error:
                pg.close()
        self.assertIn(pg.volume,str(error.exception))
        self.assertTrue(any(call.args[:2] == ('network','rm') for call in mocked.call_args_list))

    def test_parallel_runs_have_independent_candidates_and_ownership(self):
        instances = [LocalPostgres('synthetic-image'),LocalPostgres('synthetic-image')]
        self.assertEqual(len({pg.run_id for pg in instances}),2)
        self.assertEqual(len({name for pg in instances for name in [pg.name,pg.network,pg.volume]}),6)
        removed = []
        def fake(*args,**kwargs):
            if 'inspect' in args:
                kind,name = args[0],args[2]
                pg = next(pg for pg in instances if name in [pg.name,pg.volume,pg.network])
                return subprocess.CompletedProcess(args,0,json.dumps([self.resource_info(pg,kind,name)]),'')
            if 'rm' in args:
                removed.append(args[-1])
            return subprocess.CompletedProcess(args,0,'','')
        def lifecycle(pg):
            for kind,name in [('network',pg.network),('volume',pg.volume),('container',pg.name)]:
                pg.create_resource(kind,name,kind,'create',name)
            pg.close()
        with patch(f'{__name__}.docker',side_effect=fake), patch('sys.stdout',new_callable=io.StringIO):
            with ThreadPoolExecutor(max_workers=2) as executor:
                list(executor.map(lifecycle,instances))
        self.assertEqual(len(removed),6)
        self.assertEqual(len(set(removed)),6)


def make_suite(pg):
    # Importar la aplicación solo después de fijar entorno sintético y cwd sin .env.
    from fastapi.testclient import TestClient
    from sqlalchemy import text
    from sqlalchemy.exc import DBAPIError
    from app.main import app
    from app.core.database import get_db
    from app.core.security import get_current_user_id
    from app.core import inicio_practica_database as restricted

    class InicioPracticaIntegrationTests(unittest.TestCase):
        def setUp(self):
            self.stack = ExitStack()
            self.addCleanup(self.stack.close)
            previous = dict(app.dependency_overrides)
            self.addCleanup(self.restore_overrides, previous)
            self.actor = 101
            self.roles = ['GESTOR']
            app.dependency_overrides[get_current_user_id] = lambda: self.actor
            app.dependency_overrides[get_db] = lambda: MagicMock()
            self.stack.enter_context(patch('app.core.permissions.obtener_contexto_usuario', side_effect=lambda **kwargs: {'roles': self.roles}))
            self.stack.enter_context(patch('app.core.database.SessionLocal', side_effect=AssertionError('Fallback prohibido')))
            self.client = self.stack.enter_context(TestClient(app))

        @staticmethod
        def restore_overrides(previous):
            app.dependency_overrides.clear()
            app.dependency_overrides.update(previous)

        def fixture(self, state='APROBADA', history='APROBADA'):
            allowed = {'REGISTRADA', 'EN_REVISION', 'OBSERVADA', 'APROBADA', 'EN_CURSO', 'FINALIZADA', 'RECHAZADA'}
            self.assertIn(state, allowed)
            self.assertTrue(history is None or history in allowed)
            identifier = int(pg.sql(f"INSERT INTO practica(id_estudiante,id_centro,id_estado_actual) SELECT 100,100,id_estado FROM estado_practica WHERE nombre='{state}' RETURNING id_practica").stdout.strip())
            if history:
                pg.sql(f"INSERT INTO historial_estado(id_practica,id_estado,id_usuario,fecha_cambio) SELECT {identifier},id_estado,101,clock_timestamp()-interval '1 minute' FROM estado_practica WHERE nombre='{history}'")
            return identifier

        def snapshot(self, identifier):
            return json.loads(pg.sql(f"""SELECT json_build_object('estado',s.nombre,'eventos',
                (SELECT count(*) FROM historial_estado WHERE id_practica=p.id_practica))
                FROM practica p JOIN estado_practica s ON s.id_estado=p.id_estado_actual
                WHERE p.id_practica={int(identifier)}""").stdout)

        def request(self, identifier, body=None, client=None):
            return (client or self.client).patch(f'/practicas/{identifier}/estado', json=body if body is not None else {'estado':'EN_CURSO'})

        def test_success_roles_commit_and_history(self):
            for role, actor in [('GESTOR',101), ('ADMINISTRADOR',102)]:
                with self.subTest(role=role):
                    self.roles, self.actor = [role], actor
                    identifier = self.fixture()
                    response = self.request(identifier)
                    self.assertEqual(response.status_code, 200)
                    body = response.json()
                    self.assertEqual(body['id_practica'], identifier)
                    self.assertEqual(body['estado_anterior']['nombre'], 'APROBADA')
                    self.assertEqual(body['estado']['nombre'], 'EN_CURSO')
                    self.assertEqual(self.snapshot(identifier), {'estado':'EN_CURSO','eventos':2})
                    actual = json.loads(pg.sql(f"""SELECT json_build_object('responsable',h.id_usuario,
                        'compartido',h.fecha_cambio=p.fecha_actualizacion,'fecha',h.fecha_cambio)
                        FROM historial_estado h JOIN practica p ON p.id_practica=h.id_practica
                        WHERE h.id_historial={int(body['id_historial'])}""").stdout)
                    from datetime import datetime
                    self.assertEqual(actual['responsable'], actor)
                    self.assertTrue(actual['compartido'])
                    self.assertEqual(datetime.fromisoformat(actual['fecha']), datetime.fromisoformat(body['fecha_ultimo_cambio_estado'].replace('Z','+00:00')))

        def test_authentication_and_roles(self):
            identifier = self.fixture()
            for roles in [['ESTUDIANTE'], []]:
                self.roles = roles
                self.assertEqual(self.request(identifier).status_code, 403)
            del app.dependency_overrides[get_current_user_id]
            for headers in [{}, {'Authorization':'Bearer invalid-synthetic'}]:
                reference = self.client.get('/practicas/me', headers=headers)
                response = self.client.patch(f'/practicas/{identifier}/estado', json={'estado':'EN_CURSO'}, headers=headers)
                self.assertIn(response.status_code, (401,403))
                self.assertEqual(response.status_code, reference.status_code)
            self.assertEqual(self.snapshot(identifier), {'estado':'APROBADA','eventos':1})

        def test_sql_second_authorization_barrier(self):
            self.actor, self.roles = 100, ['GESTOR']
            identifier = self.fixture()
            self.assertEqual(self.request(identifier).status_code, 403)
            self.assertEqual(self.snapshot(identifier), {'estado':'APROBADA','eventos':1})

        def test_invalid_transitions_history_and_repetition(self):
            for state, history in [('FINALIZADA','FINALIZADA'), ('RECHAZADA','RECHAZADA'),
                                   ('EN_REVISION','EN_REVISION'), ('APROBADA',None), ('APROBADA','OBSERVADA')]:
                with self.subTest(state=state, history=history):
                    identifier = self.fixture(state,history)
                    previous = self.snapshot(identifier)
                    self.assertEqual(self.request(identifier).status_code,409)
                    self.assertEqual(self.snapshot(identifier),previous)
            identifier = self.fixture()
            self.assertEqual(self.request(identifier).status_code,200)
            self.assertEqual(self.request(identifier).status_code,409)
            self.assertEqual(self.snapshot(identifier),{'estado':'EN_CURSO','eventos':2})

        def test_missing_and_invalid_requests(self):
            self.assertEqual(self.request(999999).status_code,404)
            for identifier in ['x','0','-1','9223372036854775808']:
                self.assertEqual(self.request(identifier).status_code,422)
            identifier = self.fixture()
            for body in [{'estado':'FINALIZADA'}, {'estado':'EN_CURSO','id_usuario':102},
                         {'estado':'EN_CURSO','observacion':'a'*501}]:
                self.assertEqual(self.request(identifier,body).status_code,422)
            self.assertEqual(self.snapshot(identifier),{'estado':'APROBADA','eventos':1})

        def test_sql_error_rolls_back_update_and_history(self):
            identifier = self.fixture()
            pg.sql("""CREATE FUNCTION public.ep04_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN RAISE EXCEPTION 'SYNTHETIC_INTERNAL_SQL_SECRET'; END; $$;
                CREATE TRIGGER ep04_test_fail BEFORE INSERT ON public.historial_estado
                FOR EACH ROW EXECUTE FUNCTION public.ep04_test_fail();""")
            try:
                response = self.request(identifier)
                self.assertEqual(response.status_code,500)
                self.assertNotIn('SYNTHETIC',response.text)
                self.assertNotIn(pg.executor_password,response.text)
                self.assertEqual(self.snapshot(identifier),{'estado':'APROBADA','eventos':1})
            finally:
                pg.sql('DROP TRIGGER ep04_test_fail ON public.historial_estado; DROP FUNCTION public.ep04_test_fail();')
            self.assertEqual(self.request(identifier).status_code,200)

        def test_effective_login_privileges_and_no_direct_writes(self):
            db = restricted._get_session_factory()()
            try:
                self.assertEqual(db.execute(text('SELECT current_user')).scalar_one(),'ep04_integration_login')
                for query in ['UPDATE public.practica SET id_estado_actual=id_estado_actual',
                              'INSERT INTO public.historial_estado(id_practica,id_estado,id_usuario) VALUES(1,1,101)',
                              'SET ROLE pl_ep04_owner']:
                    with self.subTest(operation=query.split()[0]):
                        try:
                            with self.assertRaises(DBAPIError) as error:
                                db.execute(text(query))
                            self.assertEqual(error.exception.orig.sqlstate,'42501')
                        finally:
                            db.rollback()
            finally:
                db.close()
            privileges = json.loads(pg.sql("""SELECT json_build_object('roles',
                (SELECT json_agg(r.rolname) FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid
                 WHERE m.member='ep04_integration_login'::regrole), 'super',rolsuper,'bypass',rolbypassrls,
                 'createrole',rolcreaterole,'createdb',rolcreatedb)
                FROM pg_roles WHERE rolname='ep04_integration_login'""").stdout)
            self.assertEqual(privileges,{'roles':['pl_ep04_executor'],'super':False,'bypass':False,'createrole':False,'createdb':False})

        def test_missing_configuration_is_503_without_fallback(self):
            identifier = self.fixture()
            with patch.object(restricted,'_factory',None), patch.object(restricted.settings,'inicio_practica_database_url',None):
                response = self.request(identifier)
            self.assertEqual(response.status_code,503)
            self.assertNotIn(pg.executor_password,response.text)
            self.assertEqual(self.snapshot(identifier),{'estado':'APROBADA','eventos':1})

        def test_two_concurrent_http_requests(self):
            identifier = self.fixture()
            from threading import Barrier
            barrier = Barrier(2)
            def start(_):
                with TestClient(app) as client:
                    barrier.wait(timeout=10)
                    return self.request(identifier,client=client).status_code
            with ThreadPoolExecutor(max_workers=2) as executor:
                statuses = list(executor.map(start,range(2)))
            self.assertEqual(sorted(statuses),[200,409])
            self.assertEqual(self.snapshot(identifier),{'estado':'EN_CURSO','eventos':2})

    return unittest.defaultTestLoader.loadTestsFromTestCase(InicioPracticaIntegrationTests)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--docker-local', action='store_true',
                        help='autoriza recursos Docker temporales exclusivos y SQL sintético local')
    mode.add_argument('--unit-cleanup',action='store_true',help='solo pruebas de limpieza con mocks, sin Docker ni SQL')
    parser.add_argument('--image',default='postgres:18',help='imagen local PostgreSQL 18.6; nunca se descarga')
    args = parser.parse_args()
    if args.unit_cleanup:
        suite = unittest.defaultTestLoader.loadTestsFromTestCase(CleanupSafetyTests)
        return 0 if unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful() else 1
    sys.path.insert(0,str(ROOT/'PracticaLink/backend'))
    pg = LocalPostgres(args.image)
    exit_code = 1
    def interrupted(*_):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM,interrupted)
    try:
        pg.start()
        # Sin .env, opciones libpq ni credenciales heredadas; solo valores sintéticos.
        with tempfile.TemporaryDirectory(prefix='ep04-integration-') as directory, patch.dict(os.environ,{},clear=True):
            previous = Path.cwd()
            os.chdir(directory)
            try:
                os.environ.update(
                    SUPABASE_DATABASE_URL='postgresql+psycopg://unused:synthetic@127.0.0.1:1/unavailable',
                    INICIO_PRACTICA_DATABASE_URL=f'postgresql+psycopg://ep04_integration_login:{pg.executor_password}@{pg.host}:5432/ep04_integration',
                    JWT_SECRET_KEY=secrets.token_hex(32),
                )
                result = unittest.TextTestRunner(verbosity=2).run(make_suite(pg))
                exit_code = 0 if result.wasSuccessful() else 1
            finally:
                original_error = sys.exception()
                cleanup_errors = []
                try:
                    # No importar la aplicación de nuevo si su preparación falló.
                    restricted = sys.modules.get('app.core.inicio_practica_database')
                    database = sys.modules.get('app.core.database')
                    engines = []
                    if restricted is not None and restricted._factory is not None:
                        engines.append(restricted._factory.kw['bind'])
                    if database is not None:
                        engines.append(database.engine)
                    for engine in engines:
                        try:
                            engine.dispose()
                        except Exception:
                            cleanup_errors.append('engine')
                finally:
                    os.chdir(previous)
                if cleanup_errors:
                    print('Liberación de engine incompleta; sin detalles de conexión',file=sys.stderr)
                    if original_error is None:
                        raise RuntimeError('No se pudo completar la limpieza de engines')
    except (Exception,KeyboardInterrupt) as error:
        exit_code = 1
        print('Integración interrumpida:',str(error) if isinstance(error,RuntimeError) else type(error).__name__,file=sys.stderr)
    finally:
        try:
            pg.close()
        except RuntimeError as error:
            print(str(error),file=sys.stderr)
            exit_code = 1
    return exit_code


if __name__ == '__main__':
    sys.exit(main())
