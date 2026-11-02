"""HU013: SQL real en PostgreSQL exclusivo. Requiere --docker-local, sin API/env."""

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
import signal
import sys
import time
import unittest

# Reutiliza únicamente el ciclo de vida Docker ya existente y sus controles de
# propiedad. No llama make_suite(), no importa FastAPI ni carga configuración.
from run_inicio_practica import LocalPostgres, ROOT


SQL_FILES = [ROOT / 'scripts/BD/fixes' / name for name in (
    'ep05-01-seguimiento-calendario.sql',
    'ep05-02-permisos-seguimiento.sql',
    'ep05-03-registrar-seguimiento.sql',
)]
CALL = 'SELECT seguimientos_privados.fn_registrar_seguimiento(%s,%s,%s,%s,%s)'
MEDIA = ['Reunión presencial', 'Videollamada', 'Llamada telefónica', 'Correo electrónico', 'Otro']


class SeguimientoPostgres(LocalPostgres):
    def __init__(self, image):
        super().__init__(image)
        # El helper acredita propiedad por etiqueta y nombre exactos; nunca
        # inspecciona ni reutiliza db_lab u otro contenedor para ejecutar SQL.
        self.name = 'ep05-hu013-' + self.run_id
        self.network = self.name + '-net'
        self.volume = self.name + '-data'


def make_suite(pg):
    import psycopg
    from psycopg import sql

    def connection(user='postgres', password=None, autocommit=False):
        # Todos los parámetros de destino son explícitos, provenientes del
        # contenedor nuevo validado por LocalPostgres. Sin .env ni URL externa.
        return psycopg.connect(
            host=pg.host, hostaddr=pg.host, port=5432, dbname='ep04_integration', user=user,
            password=pg.admin_password if password is None else password,
            autocommit=autocommit, connect_timeout=5,
            sslmode='disable', gssencmode='disable', passfile='/dev/null',
            options='-c statement_timeout=10000 -c lock_timeout=7000',
        )

    admin = connection(autocommit=True)
    try:
        legacy_practice = admin.execute("""
            INSERT INTO public.practica(id_estudiante,id_centro,id_estado_actual)
            SELECT 100,100,id_estado FROM public.estado_practica WHERE nombre='EN_CURSO'
            RETURNING id_practica
        """).fetchone()[0]
        legacy_id = admin.execute("""
            INSERT INTO public.seguimiento(id_practica,id_usuario,fecha,tipo,observacion,fecha_creacion)
            VALUES (%s,101,'2026-07-01 02:30:00+00',NULL,'','2026-07-01 03:00:00+00')
            RETURNING id_seguimiento
        """, (legacy_practice,)).fetchone()[0]
        old_row = admin.execute('SELECT * FROM public.seguimiento WHERE id_seguimiento=%s', (legacy_id,)).fetchone()
        admin.execute(SQL_FILES[0].read_text())
        # Ensayos reales de preflight: cada fallo debe revertir roles/esquema y
        # políticas del bootstrap. No se llega a sustituir objetos preexistentes.
        for setup, cleanup in (
            ('ALTER TABLE public.seguimiento DISABLE ROW LEVEL SECURITY',
             'ALTER TABLE public.seguimiento ENABLE ROW LEVEL SECURITY'),
            ('GRANT INSERT(observacion) ON public.seguimiento TO PUBLIC',
             'REVOKE INSERT(observacion) ON public.seguimiento FROM PUBLIC'),
        ):
            admin.execute(setup)
            try:
                try:
                    admin.execute(SQL_FILES[1].read_text())
                except psycopg.errors.RaiseException:
                    admin.execute('ROLLBACK')
                else:
                    raise AssertionError('El bootstrap aceptó un entorno inseguro')
                if admin.execute("SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='pl_ep05_owner')").fetchone()[0]:
                    raise AssertionError('El bootstrap no revirtió los roles')
                if admin.execute("SELECT to_regnamespace('seguimientos_privados')").fetchone()[0] is not None:
                    raise AssertionError('El bootstrap no revirtió el esquema')
            finally:
                admin.execute(cleanup)
        admin.execute(SQL_FILES[1].read_text())
        # Una concesión heredada por defecto debe eliminarse de la función nueva.
        admin.execute('CREATE ROLE ep05_test_default NOLOGIN')
        admin.execute('ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO ep05_test_default')
        try:
            admin.execute(SQL_FILES[2].read_text())
        finally:
            admin.execute('ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM ep05_test_default')
        # Login sintético: probar privilegios efectivos sin SET ROLE del administrador.
        admin.execute(sql.SQL("CREATE ROLE ep05_test_login LOGIN INHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD {}").format(sql.Literal(pg.executor_password)))
        admin.execute('GRANT pl_ep05_executor TO ep05_test_login')
        admin.execute('CREATE ROLE ep05_test_client LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD {}'.format(sql.Literal(pg.executor_password).as_string(admin)))
    finally:
        admin.close()

    class RegistroSeguimientoTests(unittest.TestCase):
        def setUp(self):
            self.admin = connection(autocommit=True)
            self.addCleanup(self.admin.close)
            self.db = connection('ep05_test_login', pg.executor_password)
            self.addCleanup(self.db.close)
            self.today = self.admin.execute("SELECT (clock_timestamp() AT TIME ZONE 'America/Santiago')::date").fetchone()[0]
            self.identifier = self.practice()

        def practice(self, state='EN_CURSO'):
            return self.admin.execute("""
                INSERT INTO public.practica(id_estudiante,id_centro,id_estado_actual)
                SELECT 100,100,id_estado FROM public.estado_practica WHERE nombre=%s
                RETURNING id_practica
            """, (state,)).fetchone()[0]

        def record(self, identifier=None, actor=101, day=None, medium='Videollamada', observation='Avance sintético', db=None):
            return (db or self.db).execute(CALL, (
                self.identifier if identifier is None else identifier, actor,
                self.today if day is None else day, medium, observation,
            )).fetchone()[0]

        def count(self, identifier=None):
            return self.admin.execute('SELECT count(*) FROM public.seguimiento WHERE id_practica=%s',
                                      (self.identifier if identifier is None else identifier,)).fetchone()[0]

        def assert_rejected(self, code, **kwargs):
            identifier = kwargs.get('identifier', self.identifier)
            previous = self.count(identifier)
            self.assertEqual(self.record(**kwargs), {'error': code})
            self.db.rollback()
            self.assertEqual(self.count(identifier), previous)

        def wait_blocked(self, pid):
            deadline = time.monotonic() + 4
            while time.monotonic() < deadline:
                blockers = self.admin.execute('SELECT pg_blocking_pids(%s)', (pid,)).fetchone()[0]
                if blockers:
                    return
                time.sleep(.02)
            self.fail('No se observó espera por bloqueo PostgreSQL')

        def test_success_roles_media_and_association(self):
            for actor in (101, 102):
                for medium in MEDIA:
                    with self.subTest(actor=actor, medium=medium):
                        result = self.record(actor=actor, medium=medium, day=self.today-timedelta(days=1))
                        self.db.commit()
                        row = self.admin.execute('SELECT id_practica,id_usuario,fecha_seguimiento,tipo,observacion,fecha,fecha_creacion FROM public.seguimiento WHERE id_seguimiento=%s',
                                                 (result['id_seguimiento'],)).fetchone()
                        self.assertEqual(row[:5], (self.identifier, actor, self.today-timedelta(days=1), medium, 'Avance sintético'))
                        self.assertEqual(row[5], row[6])
                        self.assertEqual(result['fecha'], (self.today-timedelta(days=1)).isoformat())
            self.assertEqual(self.count(), 10)

        def test_every_other_state_rejected(self):
            states = self.admin.execute("SELECT nombre FROM public.estado_practica WHERE nombre<>'EN_CURSO'").fetchall()
            for (state,) in states:
                with self.subTest(state=state):
                    identifier = self.practice(state)
                    self.assert_rejected('PRACTICA_NO_EN_CURSO', identifier=identifier)
                    self.assertEqual(self.count(identifier), 0)

        def test_inactive_or_final_catalog_rejected(self):
            for column in ('activo', 'es_final'):
                value = column == 'es_final'
                try:
                    self.admin.execute(sql.SQL("UPDATE public.estado_practica SET {}=%s WHERE nombre='EN_CURSO'").format(sql.Identifier(column)), (value,))
                    self.assert_rejected('PRACTICA_NO_EN_CURSO')
                finally:
                    self.admin.execute(sql.SQL("UPDATE public.estado_practica SET {}=%s WHERE nombre='EN_CURSO'").format(sql.Identifier(column)), (not value,))

        def test_future_null_and_infinite_dates(self):
            self.assert_rejected('FECHA_INVALIDA', day=self.today+timedelta(days=1))
            for day in (None, 'infinity', '-infinity'):
                with self.subTest(day=day):
                    result = self.db.execute(CALL, (self.identifier,101,day,'Otro','Texto')).fetchone()[0]
                    self.assertEqual(result, {'error':'FECHA_INVALIDA'})
                    self.db.rollback()
            self.assertEqual(self.count(), 0)

        def test_calendar_independent_of_session_timezone(self):
            for zone in ('UTC', 'Pacific/Kiritimati', 'America/Los_Angeles'):
                with self.subTest(zone=zone):
                    self.db.execute('SELECT set_config(\'TimeZone\',%s,false)', (zone,))
                    result = self.record()
                    self.assertEqual(result['fecha'], self.today.isoformat())
                    self.db.commit()
                    self.assert_rejected('FECHA_INVALIDA', day=self.today+timedelta(days=1))

        def test_observation_validation_and_unicode_limit(self):
            for text in (None, '', ' ', '   ', '\t\r\n ', 'a'*2001, 'á'*2001, '📝'*2001):
                with self.subTest(length=None if text is None else len(text)):
                    self.assert_rejected('OBSERVACION_INVALIDA', observation=text)
            original = 'á'*1999 + '📝'
            result = self.record(observation=original)
            self.db.commit()
            self.assertEqual(result['observacion'], original)
            self.assertEqual(self.admin.execute('SELECT observacion FROM public.seguimiento WHERE id_seguimiento=%s', (result['id_seguimiento'],)).fetchone()[0], original)

        def test_invalid_media(self):
            for medium in (None, '', 'Correo', 'videollamada', 'Otro ', 'x'*51):
                with self.subTest(medium=medium):
                    self.assert_rejected('MEDIO_INVALIDO', medium=medium)

        def test_missing_practice_and_unauthorized_authors(self):
            self.assert_rejected('PRACTICA_NO_ENCONTRADA', identifier=9223372036854775807)
            for actor in (None, 0, 9223372036854775807, 100):
                with self.subTest(actor=actor):
                    self.assert_rejected('USUARIO_NO_AUTORIZADO', actor=actor)
            try:
                self.admin.execute('UPDATE public.usuario SET activo=false WHERE id_usuario=101')
                self.assert_rejected('USUARIO_NO_AUTORIZADO')
            finally:
                self.admin.execute('UPDATE public.usuario SET activo=true WHERE id_usuario=101')
            try:
                self.admin.execute("UPDATE public.rol SET activo=false WHERE nombre='GESTOR'")
                self.assert_rejected('USUARIO_NO_AUTORIZADO')
            finally:
                self.admin.execute("UPDATE public.rol SET activo=true WHERE nombre='GESTOR'")
            try:
                self.admin.execute('DELETE FROM public.usuario_rol WHERE id_usuario=101')
                self.assert_rejected('USUARIO_NO_AUTORIZADO')
            finally:
                self.admin.execute("INSERT INTO public.usuario_rol SELECT 101,id_rol FROM public.rol WHERE nombre='GESTOR'")

        def test_caller_rollback_and_insertion_failure(self):
            self.assertIn('id_seguimiento', self.record())
            self.db.rollback()
            self.assertEqual(self.count(), 0)
            self.admin.execute("""CREATE FUNCTION public.ep05_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN RAISE EXCEPTION 'fallo sintetico'; END; $$;
                CREATE TRIGGER ep05_test_fail AFTER INSERT ON public.seguimiento
                FOR EACH ROW EXECUTE FUNCTION public.ep05_test_fail();""")
            try:
                with self.assertRaises(psycopg.errors.RaiseException):
                    self.record()
                self.db.rollback()
                self.assertEqual(self.count(), 0)
            finally:
                self.admin.execute('DROP TRIGGER ep05_test_fail ON public.seguimiento; DROP FUNCTION public.ep05_test_fail()')
            self.assertIn('id_seguimiento', self.record())
            self.db.commit()
            self.assertEqual(self.count(), 1)

        def test_suppressed_insert_is_not_success(self):
            self.admin.execute("""CREATE FUNCTION public.ep05_test_suppress() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN RETURN NULL; END; $$;
                CREATE TRIGGER ep05_test_suppress BEFORE INSERT ON public.seguimiento
                FOR EACH ROW EXECUTE FUNCTION public.ep05_test_suppress();""")
            try:
                with self.assertRaises(psycopg.errors.RaiseException):
                    self.record()
                self.db.rollback()
                self.assertEqual(self.count(), 0)
            finally:
                self.admin.execute('DROP TRIGGER ep05_test_suppress ON public.seguimiento; DROP FUNCTION public.ep05_test_suppress()')

        def test_transition_first_register_waits_and_rejects(self):
            with connection() as transition, ThreadPoolExecutor(max_workers=1) as pool:
                transition.execute("UPDATE public.practica SET id_estado_actual=(SELECT id_estado FROM public.estado_practica WHERE nombre='FINALIZADA') WHERE id_practica=%s", (self.identifier,))
                future = pool.submit(self.record)
                try:
                    self.wait_blocked(self.db.info.backend_pid)
                finally:
                    transition.commit()
                self.assertEqual(future.result(timeout=12), {'error':'PRACTICA_NO_EN_CURSO'})
                self.db.rollback()
            self.assertEqual(self.count(), 0)

        def test_register_first_transition_waits_and_preserves_record(self):
            result = self.record()
            with connection() as transition, ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(transition.execute, "UPDATE public.practica SET id_estado_actual=(SELECT id_estado FROM public.estado_practica WHERE nombre='FINALIZADA') WHERE id_practica=%s", (self.identifier,))
                try:
                    self.wait_blocked(transition.info.backend_pid)
                finally:
                    self.db.commit()
                future.result(timeout=12)
                transition.commit()
            self.assertEqual(self.count(), 1)
            self.assertEqual(self.admin.execute('SELECT id_usuario FROM public.seguimiento WHERE id_seguimiento=%s', (result['id_seguimiento'],)).fetchone()[0], 101)

        def test_transition_rollback_allows_waiting_registration(self):
            with connection() as transition, ThreadPoolExecutor(max_workers=1) as pool:
                transition.execute("UPDATE public.practica SET id_estado_actual=(SELECT id_estado FROM public.estado_practica WHERE nombre='FINALIZADA') WHERE id_practica=%s", (self.identifier,))
                future = pool.submit(self.record)
                try:
                    self.wait_blocked(self.db.info.backend_pid)
                finally:
                    transition.rollback()
                self.assertIn('id_seguimiento', future.result(timeout=12))
                self.db.commit()
            self.assertEqual(self.count(), 1)

        def test_revocation_waits_for_registration(self):
            self.record()
            with connection() as other, ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(other.execute, 'UPDATE public.usuario SET activo=false WHERE id_usuario=101')
                try:
                    self.wait_blocked(other.info.backend_pid)
                finally:
                    self.db.commit()
                future.result(timeout=12)
                other.rollback()
            self.assertEqual(self.count(), 1)

        def test_restricted_login_and_untrusted_client(self):
            self.assertEqual(self.db.execute('SELECT current_user').fetchone()[0], 'ep05_test_login')
            operations = [
                "INSERT INTO public.seguimiento(id_practica,id_usuario,fecha_seguimiento,tipo,observacion) VALUES(1,101,CURRENT_DATE,'Otro','Texto')",
                'UPDATE public.seguimiento SET observacion=observacion',
                'DELETE FROM public.seguimiento', 'TRUNCATE public.seguimiento',
                'UPDATE public.practica SET id_estado_actual=id_estado_actual',
                'DELETE FROM public.practica', 'TRUNCATE public.practica CASCADE',
                'SET ROLE pl_ep05_owner',
                'CREATE TABLE seguimientos_privados.no_permitida(id integer)',
            ]
            for query in operations:
                with self.subTest(operation=query.split()[0]):
                    with self.assertRaises(psycopg.errors.InsufficientPrivilege):
                        self.db.execute(query)
                    self.db.rollback()
            with connection('ep05_test_client', pg.executor_password) as client:
                with self.assertRaises(psycopg.errors.InsufficientPrivilege):
                    self.record(db=client)
                client.rollback()
            roles = self.admin.execute("SELECT r.rolname FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid WHERE m.member='ep05_test_login'::regrole").fetchall()
            self.assertEqual(roles, [('pl_ep05_executor',)])
            self.assertEqual(self.admin.execute("SELECT rolsuper,rolbypassrls,rolcreaterole,rolcreatedb FROM pg_roles WHERE rolname='ep05_test_login'").fetchone(), (False,False,False,False))
            self.assertFalse(self.admin.execute("SELECT has_function_privilege('ep05_test_default','seguimientos_privados.fn_registrar_seguimiento(bigint,bigint,date,text,text)','EXECUTE')").fetchone()[0])

        def test_owner_rls_denies_updates_even_with_public_policy(self):
            # Comprueba RLS del DEFINER, además del rechazo ACL del ejecutor.
            try:
                self.admin.execute('CREATE POLICY ep05_test_public_update ON public.practica FOR UPDATE TO PUBLIC USING(true) WITH CHECK(true)')
                with connection() as owner:
                    owner.execute('SET ROLE pl_ep05_owner')
                    with self.assertRaises(psycopg.errors.InsufficientPrivilege):
                        owner.execute('UPDATE public.practica SET id_practica=id_practica WHERE id_practica=%s', (self.identifier,))
                    owner.rollback()
            finally:
                self.admin.execute('DROP POLICY ep05_test_public_update ON public.practica')

        def test_delete_practice_and_indirect_cascade_are_restricted(self):
            self.record()
            self.db.commit()
            # RESTRICT devuelve 23001, distinto de ForeignKeyViolation (23503).
            # admin usa autocommit: el DELETE fallido revierte su sentencia y
            # permite consultar inmediatamente la conservación de las filas.
            previous = self.admin.execute('SELECT * FROM public.seguimiento WHERE id_practica=%s ORDER BY id_seguimiento', (self.identifier,)).fetchall()
            practice_before = self.admin.execute('SELECT * FROM public.practica WHERE id_practica=%s', (self.identifier,)).fetchone()
            with self.assertRaises(psycopg.errors.RestrictViolation) as rejected:
                self.admin.execute('DELETE FROM public.practica WHERE id_practica=%s', (self.identifier,))
            self.assertEqual(rejected.exception.sqlstate, '23001')
            self.assertEqual(rejected.exception.diag.constraint_name, 'fk_seguimiento_practica')
            self.assertEqual(self.admin.execute('SELECT * FROM public.seguimiento WHERE id_practica=%s ORDER BY id_seguimiento', (self.identifier,)).fetchall(), previous)
            self.assertEqual(self.admin.execute('SELECT * FROM public.practica WHERE id_practica=%s', (self.identifier,)).fetchone(), practice_before)
            # Control positivo: la restricción depende de seguimientos existentes,
            # no de un error de permisos ni de que todo DELETE esté bloqueado.
            empty_practice = self.practice()
            self.assertEqual(self.count(empty_practice), 0)
            self.assertEqual(self.admin.execute('DELETE FROM public.practica WHERE id_practica=%s RETURNING id_practica', (empty_practice,)).fetchone(), (empty_practice,))
            self.assertIsNone(self.admin.execute('SELECT id_practica FROM public.practica WHERE id_practica=%s', (empty_practice,)).fetchone())
            # Relación sintética adicional solo en este laboratorio: una cascada
            # desde un padre tampoco debe poder borrar la práctica protegida.
            self.admin.execute('CREATE TABLE public.ep05_test_parent(id bigint PRIMARY KEY); INSERT INTO public.ep05_test_parent VALUES(1); ALTER TABLE public.practica ADD COLUMN ep05_test_parent_id bigint REFERENCES public.ep05_test_parent(id) ON DELETE CASCADE')
            try:
                self.admin.execute('UPDATE public.practica SET ep05_test_parent_id=1 WHERE id_practica=%s', (self.identifier,))
                with self.assertRaises(psycopg.errors.RestrictViolation) as rejected:
                    self.admin.execute('DELETE FROM public.ep05_test_parent WHERE id=1')
                self.assertEqual(rejected.exception.sqlstate, '23001')
                self.assertEqual(rejected.exception.diag.constraint_name, 'fk_seguimiento_practica')
                self.assertEqual(self.count(), 1)
                self.assertEqual(self.admin.execute('SELECT * FROM public.seguimiento WHERE id_practica=%s ORDER BY id_seguimiento', (self.identifier,)).fetchall(), previous)
                self.assertEqual(self.admin.execute('SELECT ep05_test_parent_id FROM public.practica WHERE id_practica=%s', (self.identifier,)).fetchone(), (1,))
                self.assertEqual(self.admin.execute('SELECT count(*) FROM public.ep05_test_parent').fetchone()[0], 1)
            finally:
                self.admin.execute('ALTER TABLE public.practica DROP COLUMN ep05_test_parent_id; DROP TABLE public.ep05_test_parent')
            self.assertEqual(self.admin.execute('SELECT * FROM public.practica WHERE id_practica=%s', (self.identifier,)).fetchone(), practice_before)
            self.assertEqual(self.admin.execute("SELECT confdeltype FROM pg_catalog.pg_constraint WHERE conrelid='public.seguimiento'::regclass AND conname='fk_seguimiento_practica'").fetchone(), ('r',))

        def test_legacy_rows_preserved_and_dates_backfilled(self):
            current = self.admin.execute('SELECT id_seguimiento,id_practica,id_usuario,fecha,tipo,observacion,fecha_creacion,fecha_seguimiento FROM public.seguimiento WHERE id_seguimiento=%s', (legacy_id,)).fetchone()
            self.assertEqual(current[:-1], old_row)
            self.assertEqual(current[-1], date(2026,6,30))
            practice_before = self.admin.execute('SELECT * FROM public.practica WHERE id_practica=%s', (legacy_practice,)).fetchone()
            with self.assertRaises(psycopg.errors.RestrictViolation) as rejected:
                self.admin.execute('DELETE FROM public.practica WHERE id_practica=%s', (legacy_practice,))
            self.assertEqual(rejected.exception.sqlstate, '23001')
            self.assertEqual(rejected.exception.diag.constraint_name, 'fk_seguimiento_practica')
            after = self.admin.execute('SELECT id_seguimiento,id_practica,id_usuario,fecha,tipo,observacion,fecha_creacion,fecha_seguimiento FROM public.seguimiento WHERE id_seguimiento=%s', (legacy_id,)).fetchone()
            self.assertEqual(after, current)
            self.assertEqual(after[:-1], old_row)
            self.assertEqual(self.admin.execute('SELECT * FROM public.practica WHERE id_practica=%s', (legacy_practice,)).fetchone(), practice_before)

        def test_search_path_cannot_redirect_writes(self):
            self.db.execute('CREATE TEMP TABLE seguimiento(id_seguimiento bigint)')
            self.db.execute('SET search_path=pg_temp,public')
            self.record()
            self.db.commit()
            self.assertEqual(self.count(), 1)
            self.assertEqual(self.db.execute('SELECT count(*) FROM pg_temp.seguimiento').fetchone()[0], 0)

        def test_ep04_start_remains_operational(self):
            identifier = self.practice('APROBADA')
            self.admin.execute("INSERT INTO public.historial_estado(id_practica,id_usuario,id_estado) SELECT %s,101,id_estado FROM public.estado_practica WHERE nombre='APROBADA'", (identifier,))
            with connection('ep04_integration_login', pg.executor_password) as ep04:
                result = ep04.execute('SELECT practicas_privadas.fn_iniciar_practica(%s,101,NULL)', (identifier,)).fetchone()[0]
                self.assertEqual(result['estado']['nombre'], 'EN_CURSO')
            self.assertIn('id_seguimiento', self.record(identifier=identifier))
            self.db.commit()

    return unittest.defaultTestLoader.loadTestsFromTestCase(RegistroSeguimientoTests)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--docker-local', action='store_true', required=True)
    parser.add_argument('--image', default='postgres:18', help='imagen local PostgreSQL 18.6, sin descarga')
    args = parser.parse_args()
    pg = SeguimientoPostgres(args.image)
    def interrupted(*_):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, interrupted)
    exit_code = 1
    try:
        pg.start()
        result = unittest.TextTestRunner(verbosity=2).run(make_suite(pg))
        exit_code = 0 if result.wasSuccessful() else 1
    except (Exception, KeyboardInterrupt) as error:
        # No volcar parámetros de conexión ni SQL ante errores de preparación.
        print('HU013 no completada:', type(error).__name__, file=sys.stderr)
        if isinstance(error, RuntimeError):
            print(str(error), file=sys.stderr)
    finally:
        try:
            pg.close()
        except Exception:
            print('Limpieza incompleta: revisar los recursos exclusivos enumerados.', file=sys.stderr)
            exit_code = 1
    return exit_code


if __name__ == '__main__':
    sys.exit(main())
