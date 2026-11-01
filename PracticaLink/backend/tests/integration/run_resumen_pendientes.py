"""HU017 SQL real: PostgreSQL 18.6 Docker exclusivo, sin .env ni servicios externos.

Cada prueba trabaja dentro de una transacción que se revierte. Las aserciones
globales se comparan contra el listado completo, porque otras suites pueden
dejar filas confirmadas en el mismo contenedor.
"""
import argparse
import signal
import sys
import unittest

import psycopg

from run_inicio_practica import ROOT
from run_historial_seguimiento import connection, suite as read_suite, SafeResult
from run_registro_seguimiento import SeguimientoPostgres, make_suite as write_suite
from run_registro_incidencia import suite as incidence_suite
from run_consulta_incidencias import suite as consulta_suite, snapshot
from run_estado_incidencia import suite as estado_suite

SQL = ROOT / 'scripts/BD/fixes/ep06-08-resumen-pendientes.sql'
CALL = 'SELECT incidencias_privadas.fn_resumen_incidencias_pendientes(%s,%s,%s)'
REGISTER = 'SELECT incidencias_privadas.fn_registrar_incidencia(%s,%s,%s,%s)'
FUNCTION = "incidencias_privadas.fn_resumen_incidencias_pendientes(bigint,integer,bigint)"


def suite(pg):
    with connection(pg) as admin:
        before = snapshot(admin)
        functions = admin.execute("""SELECT oid,pg_get_functiondef(oid),proacl::text FROM pg_proc
            WHERE pronamespace IN ('incidencias_privadas'::regnamespace,'seguimientos_privados'::regnamespace,
            'practicas_privadas'::regnamespace) ORDER BY oid""").fetchall()
        # Preflight: cada entorno incompatible debe rechazarse; cada cambio se revierte.
        # El script incluye BEGIN/COMMIT propios: un error deja la transacción abortada.
        for setup, undo in [
            ('GRANT SELECT(descripcion) ON incidencia TO pl_ep06_executor',
             'REVOKE SELECT(descripcion) ON incidencia FROM pl_ep06_executor'),
            ('REVOKE SELECT(estado) ON incidencia FROM pl_ep06_read_owner',
             'GRANT SELECT(estado) ON incidencia TO pl_ep06_read_owner'),
        ]:
            admin.execute(setup)
            try:
                try:
                    admin.execute(SQL.read_text())
                except psycopg.errors.RaiseException:
                    admin.execute('ROLLBACK')
                else:
                    raise AssertionError('Preflight aceptó un entorno incompatible')
                assert not admin.execute("SELECT to_regprocedure(%s) IS NOT NULL", (FUNCTION,)).fetchone()[0]
            finally:
                admin.execute(undo)
        admin.execute('ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO ep05_test_client')
        try:
            admin.execute(SQL.read_text())
        finally:
            admin.execute('ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM ep05_test_client')
        assert before == snapshot(admin)
        assert functions == admin.execute("SELECT oid,pg_get_functiondef(oid),proacl::text FROM pg_proc WHERE oid=ANY(%s) ORDER BY oid",
                                          ([r[0] for r in functions],)).fetchall()

    class ResumenPendientesTests(unittest.TestCase):
        def setUp(self):
            self.admin = connection(pg)
            self.admin.execute('BEGIN')
            self.db = connection(pg, 'ep06_test_login')
            self.addCleanup(self.db.close)

        def tearDown(self):
            self.admin.execute('ROLLBACK')
            self.admin.close()

        # ---------- fixtures y llamadas (dentro de la transacción de la prueba) ----------
        def practice(self, state='EN_CURSO'):
            return self.admin.execute('INSERT INTO practica(id_estudiante,id_centro,id_estado_actual) '
                                      'SELECT 100,100,id_estado FROM estado_practica WHERE nombre=%s RETURNING id_practica',
                                      (state,)).fetchone()[0]

        def incidence(self, practice_id, estado, day, actor=101, resolved=None):
            return self.admin.execute("""INSERT INTO incidencia(id_practica,id_usuario,id_tipo_incidencia,fecha,descripcion,estado,fecha_resolucion)
                SELECT %s,%s,id_tipo_incidencia,%s,'Texto',%s,%s FROM tipo_incidencia WHERE codigo='OTRO'
                RETURNING id_incidencia""", (practice_id, actor, day, estado, resolved)).fetchone()[0]

        def call(self, actor=101, limit=100, offset=0):
            return self.admin.execute(CALL, (actor, limit, offset)).fetchone()[0]

        def everything(self, actor=101):
            items, offset = [], 0
            while True:
                page = self.call(actor, 100, offset)
                self.assertNotIn('error', page)
                items.extend(page['items'])
                if not page['hay_mas']:
                    return items
                offset += 100

        def rows_for(self, practices):
            return [row for row in self.everything() if row['id_practica'] in practices]

        # ---------- autorización ----------
        def test_authorization_precedes_pagination_and_data(self):
            practice_id = self.practice()
            self.incidence(practice_id, 'PENDIENTE', '2026-01-01T12:00:00Z')
            for actor in (101, 102):
                self.assertNotIn('error', self.call(actor))
            for actor in (100, 999999, None):
                self.assertEqual(self.call(actor), {'error': 'USUARIO_NO_AUTORIZADO'})
            self.assertEqual(self.call(100, 0, -1), {'error': 'USUARIO_NO_AUTORIZADO'})
            self.admin.execute('UPDATE usuario SET activo=false WHERE id_usuario=101')
            self.assertEqual(self.call(101), {'error': 'USUARIO_NO_AUTORIZADO'})
            self.admin.execute('UPDATE usuario SET activo=true WHERE id_usuario=101')
            self.admin.execute("UPDATE rol SET activo=false WHERE nombre='GESTOR'")
            self.assertEqual(self.call(101), {'error': 'USUARIO_NO_AUTORIZADO'})
            self.admin.execute("UPDATE rol SET activo=true WHERE nombre='GESTOR'")

        # ---------- conteo ----------
        def test_counts_only_pending_and_reports_attention_separately(self):
            p1 = self.practice(); self.incidence(p1, 'PENDIENTE', '2026-01-01T12:00:00Z')
            p2 = self.practice()
            self.incidence(p2, 'PENDIENTE', '2026-01-02T12:00:00Z')
            self.incidence(p2, 'PENDIENTE', '2026-01-03T12:00:00Z')
            self.incidence(p2, 'EN_ATENCION', '2026-01-04T12:00:00Z')
            self.incidence(p2, 'RESUELTA', '2026-01-05T12:00:00Z', resolved='2026-01-05T12:00:00Z')
            p3 = self.practice(); self.incidence(p3, 'EN_ATENCION', '2026-01-01T12:00:00Z')
            p4 = self.practice(); self.incidence(p4, 'RESUELTA', '2026-01-01T12:00:00Z', resolved='2026-01-01T12:00:00Z')
            p5 = self.practice()
            rows = {r['id_practica']: r for r in self.rows_for([p1, p2, p3, p4, p5])}
            self.assertEqual({k: (v['pendientes'], v['en_atencion']) for k, v in rows.items()}, {p1: (1, 0), p2: (2, 1)})
            self.assertEqual(set(rows[p2].keys()), {'id_practica', 'pendientes', 'en_atencion', 'fecha_pendiente_antigua'})
            self.assertEqual(rows[p2]['fecha_pendiente_antigua'], '2026-01-02T12:00:00+00:00')

        # ---------- históricos ----------
        def test_historical_states_never_count_as_pending(self):
            # Solo dentro de la transacción: retirar el CHECK moderno permite sembrar históricos.
            self.admin.execute('ALTER TABLE public.incidencia DROP CONSTRAINT chk_ep06_estado')
            only_legacy = self.practice()
            for estado in ('ABIERTA', 'EN_REVISION', 'CERRADA'):
                self.incidence(only_legacy, estado, '2025-06-01T12:00:00Z', resolved='2025-06-02T12:00:00Z' if estado == 'CERRADA' else None)
            mixed = self.practice()
            self.incidence(mixed, 'EN_REVISION', '2025-01-01T12:00:00Z')
            self.incidence(mixed, 'PENDIENTE', '2026-03-01T12:00:00Z')
            before = snapshot(self.admin)
            rows = {r['id_practica']: r for r in self.rows_for([only_legacy, mixed])}
            self.assertNotIn(only_legacy, rows)
            self.assertEqual((rows[mixed]['pendientes'], rows[mixed]['en_atencion']), (1, 0))
            self.assertEqual(rows[mixed]['fecha_pendiente_antigua'], '2026-03-01T12:00:00+00:00')
            self.assertEqual(before, snapshot(self.admin))

        # ---------- prácticas finalizadas ----------
        def test_finalized_practice_with_pending_is_listed_and_registration_stays_blocked(self):
            f1 = self.practice('FINALIZADA'); self.incidence(f1, 'PENDIENTE', '2026-02-01T12:00:00Z')
            f2 = self.practice('FINALIZADA'); self.incidence(f2, 'RESUELTA', '2026-02-01T12:00:00Z', resolved='2026-02-02T12:00:00Z')
            rows = {r['id_practica']: r for r in self.rows_for([f1, f2])}
            self.assertEqual(set(rows), {f1})
            self.assertEqual(rows[f1]['pendientes'], 1)
            self.assertEqual(self.admin.execute(REGISTER, (f1, 101, 'OTRO', 'Alta nueva')).fetchone()[0],
                             {'error': 'PRACTICA_NO_EN_CURSO'})

        # ---------- orden determinista ----------
        def test_order_by_oldest_pending_then_practice_id(self):
            a = self.practice(); self.incidence(a, 'PENDIENTE', '2026-02-01T12:00:00Z')
            b = self.practice(); self.incidence(b, 'PENDIENTE', '2026-01-15T12:00:00Z')
            c = self.practice(); self.incidence(c, 'PENDIENTE', '2026-01-15T12:00:00Z')
            d = self.practice()
            self.incidence(d, 'EN_ATENCION', '2025-01-01T00:00:00Z')
            self.incidence(d, 'PENDIENTE', '2026-03-01T00:00:00Z')
            rows = self.rows_for([a, b, c, d])
            self.assertEqual([r['id_practica'] for r in rows], [b, c, a, d])
            self.assertEqual({r['id_practica']: r['fecha_pendiente_antigua'] for r in rows}[d],
                             '2026-03-01T00:00:00+00:00')

        # ---------- paginación ----------
        def test_pagination_matches_full_listing(self):
            for day in ('2027-01-01', '2027-01-02', '2027-01-03'):
                self.incidence(self.practice(), 'PENDIENTE', day + 'T12:00:00Z')
            full = self.everything()
            n = len(full)
            self.assertGreaterEqual(n, 3)
            for limit in (1, 2):
                collected = []
                for offset in range(0, n, limit):
                    page = self.call(101, limit, offset)
                    collected.extend(page['items'])
                    self.assertEqual(page['hay_mas'], offset + limit < n)
                    self.assertEqual((page['limit'], page['offset']), (limit, offset))
                self.assertEqual(collected, full)
            self.assertEqual(self.call(101, 100, n), {'items': [], 'limit': 100, 'offset': n, 'hay_mas': False})
            for limit, offset in [(0, 0), (101, 0), (None, 0), (50, -1), (50, None)]:
                self.assertEqual(self.call(101, limit, offset), {'error': 'PAGINACION_INVALIDA'})

        # ---------- solo lectura y zona horaria ----------
        def test_output_independent_of_session_timezone(self):
            p = self.practice(); self.incidence(p, 'PENDIENTE', '2026-04-01T12:00:00Z')
            expected = self.rows_for([p])
            self.assertEqual(expected[0]['fecha_pendiente_antigua'], '2026-04-01T12:00:00+00:00')
            for zone in ('America/Santiago', 'Pacific/Kiritimati'):
                self.admin.execute("SELECT set_config('TimeZone',%s,false)", (zone,))
                self.assertEqual(self.rows_for([p]), expected)

        def test_read_only_snapshot_unchanged(self):
            p = self.practice(); self.incidence(p, 'PENDIENTE', '2026-04-01T12:00:00Z')
            # to_jsonb(timestamptz) depende de TimeZone: se compara siempre en UTC.
            self.admin.execute("SELECT set_config('TimeZone','UTC',false)")
            before = snapshot(self.admin)
            self.rows_for([p])
            self.call(101, 1, 0)
            self.assertEqual(before, snapshot(self.admin))

        # ---------- RLS y SECURITY DEFINER ----------
        def test_rls_restrictive_policy_is_enforced_inside_definer(self):
            p = self.practice(); self.incidence(p, 'PENDIENTE', '2026-04-01T12:00:00Z')
            self.assertEqual(self.rows_for([p])[0]['pendientes'], 1)
            self.admin.execute('CREATE POLICY ep06_hu017_deny ON public.incidencia AS RESTRICTIVE '
                               'FOR SELECT TO pl_ep06_read_owner USING(false)')
            self.assertEqual(self.rows_for([p]), [])

        def test_definer_volatility_search_path_and_owner(self):
            self.assertEqual(self.admin.execute(
                "SELECT prosecdef, provolatile, proconfig, pg_get_userbyid(proowner) FROM pg_proc WHERE oid=%s::regprocedure",
                (FUNCTION,)).fetchone(),
                (True, 's', ['search_path=pg_catalog, pg_temp', 'TimeZone=UTC'], 'pl_ep06_read_owner'))

        def test_acl_grants_only_owner_and_executor(self):
            grants = self.admin.execute("""SELECT COALESCE(r.rolname,'PUBLIC'), a.privilege_type
                FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
                LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE p.oid=%s::regprocedure""", (FUNCTION,)).fetchall()
            self.assertEqual(set(grants), {('pl_ep06_read_owner', 'EXECUTE'), ('pl_ep06_executor', 'EXECUTE')})

        # ---------- ejecutor: EXECUTE sí, lectura y escritura directas no ----------
        def test_executor_can_execute_but_cannot_read_or_write_directly(self):
            self.assertNotIn('error', self.db.execute(CALL, (101, 50, 0)).fetchone()[0])
            for table in ('incidencia', 'historial_estado_incidencia', 'usuario', 'practica'):
                for operation in (f'SELECT * FROM {table}', f'DELETE FROM {table}', f'TRUNCATE {table} CASCADE'):
                    with self.assertRaises(psycopg.errors.InsufficientPrivilege):
                        self.db.execute(operation)
            with self.assertRaises(psycopg.errors.InsufficientPrivilege):
                self.db.execute("UPDATE incidencia SET estado='RESUELTA'")
            with self.assertRaises(psycopg.errors.InsufficientPrivilege):
                self.db.execute('SET ROLE pl_ep06_read_owner')

        def test_other_roles_cannot_execute(self):
            for user in ('ep05_test_client', 'ep05_test_login', 'ep04_integration_login'):
                with connection(pg, user) as other:
                    with self.assertRaises(psycopg.errors.InsufficientPrivilege):
                        other.execute(CALL, (101, 50, 0))

    return unittest.defaultTestLoader.loadTestsFromTestCase(ResumenPendientesTests)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--docker-local', action='store_true', required=True)
    parser.parse_args()
    pg = SeguimientoPostgres('postgres:18.6')
    pg.name = 'ep06-hu017-' + pg.run_id
    pg.network, pg.volume = pg.name + '-net', pg.name + '-data'

    def interrupted(*_):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, interrupted)
    code = 1
    try:
        pg.start()
        with connection(pg) as db:
            legacy = db.execute("INSERT INTO practica(id_estudiante,id_centro,id_estado_actual) SELECT 100,100,id_estado FROM estado_practica WHERE nombre='FINALIZADA' RETURNING id_practica").fetchone()[0]
            for medium, description in [(None, ''), ('Antiguo', 'x' * 2001)]:
                db.execute("INSERT INTO seguimiento(id_practica,id_usuario,fecha,tipo,observacion) VALUES(%s,102,'2026-07-01 02:30:00+00',%s,%s)",
                           (legacy, medium, description))
        # Orden de construcción: cada suite aplica sus DDL versionados antes de la siguiente.
        hu013 = write_suite(pg)
        hu014 = read_suite(pg, legacy)
        hu015 = incidence_suite(pg)
        consulta = consulta_suite(pg)
        hu016 = estado_suite(pg)
        hu017 = suite(pg)
        result = unittest.TextTestRunner(verbosity=2, resultclass=SafeResult).run(
            unittest.TestSuite([hu017, hu016, consulta, hu015, hu014, hu013]))
        code = 0 if result.wasSuccessful() else 1
    except (Exception, KeyboardInterrupt) as error:
        print('HU017 no completada:', type(error).__name__, file=sys.stderr)
    finally:
        try:
            pg.close()
        except Exception:
            print('Limpieza pendiente: revisar solo candidatos enumerados.', file=sys.stderr)
            code = 1
    return code


if __name__ == '__main__':
    sys.exit(main())
