"""HU017 HTTP + PostgreSQL 18.6 exclusivo; incluye regresiones SQL y HTTP HU013–HU016.

Usa los mismos helpers de entorno que las suites HTTP existentes: principal de
laboratorio solo para validar roles, e INCIDENCIAS_DATABASE_URL restringido al
ejecutor HU016/HU017. Sin Supabase, sin .env, sin proveedores externos.
"""
import argparse
from contextlib import ExitStack
import signal
import sys
import unittest
from unittest.mock import patch

from run_historial_seguimiento import connection, suite as read_sql, SafeResult
from run_registro_seguimiento import SeguimientoPostgres, make_suite as write_sql
from run_registro_incidencia import suite as incidence_sql
from run_consulta_incidencias import suite as incidence_read_sql, snapshot
from run_estado_incidencia import suite as state_sql
from run_resumen_pendientes import suite as resumen_sql
from incidencias_lectura_http import read_http_suite as incidence_read_http
from run_seguimiento_http import http_suite as write_http
from run_historial_seguimiento_http import read_http_suite
from run_incidencia_http import http_suite as incidence_http
from run_estado_incidencia_http import http_suite as estado_http

RESUMEN = '/practicas/con-incidencias-pendientes'


def http_suite(pg, stack):
    from sqlalchemy.engine import URL
    from fastapi.testclient import TestClient
    from sqlalchemy import text  # noqa: F401  (documenta dependencia del harness)
    from app.main import app
    from app.core.security import create_access_token
    from app.core import incidencias_database as restricted

    def url(user):
        return URL.create('postgresql+psycopg', username=user, password=pg.executor_password,
                          host=pg.host, port=5432, database='ep04_integration').render_as_string(hide_password=False)

    stack.enter_context(patch.object(restricted.settings, 'incidencias_database_url', url('ep06_test_login')))

    def dispose():
        if restricted._factory is not None:
            restricted._factory.kw['bind'].dispose()
            restricted._factory = None
    stack.callback(dispose)

    class ResumenHttpTests(unittest.TestCase):
        def setUp(self):
            self.admin = connection(pg)
            self.addCleanup(self.admin.close)
            self.client = self.enterContext(TestClient(app))

        def headers(self, actor=101):
            return {'Authorization': 'Bearer ' + create_access_token(actor)}

        def get(self, query='', actor=101, headers=None):
            return self.client.get(RESUMEN + query, headers=self.headers(actor) if headers is None else headers)

        def practice(self, state='EN_CURSO'):
            return self.admin.execute('INSERT INTO practica(id_estudiante,id_centro,id_estado_actual) '
                                      'SELECT 100,100,id_estado FROM estado_practica WHERE nombre=%s RETURNING id_practica',
                                      (state,)).fetchone()[0]

        def incidence(self, practice_id, estado, day, resolved=None):
            return self.admin.execute("""INSERT INTO incidencia(id_practica,id_usuario,id_tipo_incidencia,fecha,descripcion,estado,fecha_resolucion)
                SELECT %s,101,id_tipo_incidencia,%s,'Texto sintético HU017',%s,%s FROM tipo_incidencia WHERE codigo='OTRO'
                RETURNING id_incidencia""", (practice_id, day, estado, resolved)).fetchone()[0]

        def everything(self, actor=101):
            # Listado completo por HTTP con páginas de 100: base de comparación.
            items, offset = [], 0
            while True:
                response = self.get(f'?limit=100&offset={offset}', actor)
                self.assertEqual(response.status_code, 200, response.text)
                body = response.json()
                items.extend(body['items'])
                if not body['hay_mas']:
                    return items
                offset += 100

        def by_practice(self, identifiers):
            return {row['id_practica']: row for row in self.everything() if row['id_practica'] in identifiers}

        # ---------- autorización ----------
        def test_gestor_and_administrador_allowed_estudiante_and_inactive_denied(self):
            self.assertEqual(self.get(actor=101).status_code, 200)
            self.assertEqual(self.get(actor=102).status_code, 200)
            self.assertEqual(self.get(actor=100).status_code, 403)
            self.admin.execute('UPDATE usuario SET activo=false WHERE id_usuario=101')
            try:
                self.assertEqual(self.get(actor=101).status_code, 403)
            finally:
                self.admin.execute('UPDATE usuario SET activo=true WHERE id_usuario=101')
            self.assertEqual(self.get(actor=101).status_code, 200)

        def test_identity_only_from_jwt_and_no_client_parameters(self):
            self.assertEqual(self.get('?id_usuario=102').status_code, 422)
            self.assertEqual(self.get('?limit=5&estado=PENDIENTE').status_code, 422)
            self.assertEqual(self.get(headers={}).status_code, 401)

        # ---------- conteo y definición ----------
        def test_pending_counted_attention_separate_resolved_excluded(self):
            p1 = self.practice(); self.incidence(p1, 'PENDIENTE', '2026-01-01T12:00:00Z')
            p2 = self.practice()
            self.incidence(p2, 'PENDIENTE', '2026-01-02T12:00:00Z')
            self.incidence(p2, 'PENDIENTE', '2026-01-03T12:00:00Z')
            self.incidence(p2, 'EN_ATENCION', '2026-01-04T12:00:00Z')
            self.incidence(p2, 'RESUELTA', '2026-01-05T12:00:00Z', '2026-01-05T12:00:00Z')
            p3 = self.practice(); self.incidence(p3, 'EN_ATENCION', '2026-01-01T12:00:00Z')
            p4 = self.practice(); self.incidence(p4, 'RESUELTA', '2026-01-01T12:00:00Z', '2026-01-01T12:00:00Z')
            rows = self.by_practice([p1, p2, p3, p4])
            # DEFECTO-001 corregido: p3 (solo EN_ATENCION) aparece con pendientes 0; p4 (solo RESUELTA) no.
            self.assertEqual({k: (v['pendientes'], v['en_atencion']) for k, v in rows.items()},
                             {p1: (1, 0), p2: (2, 1), p3: (0, 1)})
            self.assertEqual(rows[p2]['fecha_pendiente_antigua'], '2026-01-02T12:00:00Z')
            self.assertIsNone(rows[p3]['fecha_pendiente_antigua'])

        def test_historical_states_excluded_and_rows_unchanged(self):
            legacy_practice = self.practice()
            definition = self.admin.execute("SELECT pg_get_constraintdef(oid) FROM pg_constraint "
                                            "WHERE conname='chk_ep06_estado' AND conrelid='public.incidencia'::regclass").fetchone()[0]
            self.admin.execute('BEGIN')
            try:
                self.admin.execute('ALTER TABLE public.incidencia DROP CONSTRAINT chk_ep06_estado')
                for estado in ('ABIERTA', 'EN_REVISION', 'CERRADA'):
                    self.incidence(legacy_practice, estado, '2025-06-01T12:00:00Z')
                mixed = self.practice()
                self.incidence(mixed, 'EN_REVISION', '2025-01-01T12:00:00Z')
                self.incidence(mixed, 'PENDIENTE', '2026-03-01T12:00:00Z')
                self.admin.execute(f'ALTER TABLE public.incidencia ADD CONSTRAINT chk_ep06_estado {definition}')
                self.admin.execute('COMMIT')
            except Exception:
                self.admin.execute('ROLLBACK')
                raise
            before = snapshot(self.admin)
            rows = self.by_practice([legacy_practice, mixed])
            self.assertNotIn(legacy_practice, rows)
            self.assertEqual((rows[mixed]['pendientes'], rows[mixed]['en_atencion']), (1, 0))
            self.assertEqual(before, snapshot(self.admin))

        def test_finalized_practice_with_pending_included_and_without_pending_absent(self):
            f1 = self.practice('FINALIZADA'); self.incidence(f1, 'PENDIENTE', '2026-02-01T12:00:00Z')
            f2 = self.practice('FINALIZADA'); self.incidence(f2, 'RESUELTA', '2026-02-01T12:00:00Z', '2026-02-02T12:00:00Z')
            rows = self.by_practice([f1, f2])
            self.assertEqual(set(rows), {f1})

        # ---------- orden y paginación ----------
        def test_order_pages_and_hay_mas_match_full_listing(self):
            for day in ('2027-01-01', '2027-01-02', '2027-01-03'):
                self.incidence(self.practice(), 'PENDIENTE', day + 'T12:00:00Z')
            full = self.everything()
            n = len(full)
            self.assertGreaterEqual(n, 3)
            # Prácticas con pendientes primero, ordenadas por antigüedad; luego las solo EN_ATENCION.
            first_sin_pendiente = next((i for i, r in enumerate(full) if r['pendientes'] == 0), len(full))
            self.assertTrue(all(r['pendientes'] > 0 for r in full[:first_sin_pendiente]))
            self.assertTrue(all(r['pendientes'] == 0 and r['fecha_pendiente_antigua'] is None
                                for r in full[first_sin_pendiente:]))
            keys = [(r['fecha_pendiente_antigua'], r['id_practica']) for r in full[:first_sin_pendiente]]
            self.assertEqual(keys, sorted(keys))
            for limit in (1, 2):
                collected = []
                for offset in range(0, n, limit):
                    body = self.get(f'?limit={limit}&offset={offset}').json()
                    self.assertEqual(body['hay_mas'], offset + limit < n)
                    collected.extend(body['items'])
                self.assertEqual(collected, full)
            self.assertEqual(self.get(f'?limit=100&offset={n}').json()['items'], [])

        def test_invalid_pagination_422(self):
            for query in ('?limit=0', '?limit=101', '?offset=-1', '?limit=x', '?offset=9223372036854775808'):
                self.assertEqual(self.get(query).status_code, 422)

        # ---------- lectura restringida ----------
        def test_restricted_executor_has_no_direct_select_or_dml(self):
            from psycopg import errors
            with connection(pg, 'ep06_test_login') as executor:
                with self.assertRaises(errors.InsufficientPrivilege):
                    executor.execute('SELECT * FROM incidencia')
                with self.assertRaises(errors.InsufficientPrivilege):
                    executor.execute("UPDATE incidencia SET estado='RESUELTA'")
                with self.assertRaises(errors.InsufficientPrivilege):
                    executor.execute('DELETE FROM incidencia')

        def test_requests_are_read_only_and_leave_data_unchanged(self):
            p = self.practice(); self.incidence(p, 'PENDIENTE', '2026-04-01T12:00:00Z')
            before = snapshot(self.admin)
            for _ in range(3):
                self.assertEqual(self.get().status_code, 200)
            self.assertEqual(before, snapshot(self.admin))

    return unittest.defaultTestLoader.loadTestsFromTestCase(ResumenHttpTests)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--docker-local', action='store_true', required=True)
    parser.parse_args()
    pg = SeguimientoPostgres('postgres:18.6')
    pg.name = 'ep06-hu017-http-' + pg.run_id
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
        # Misma cadena de construcción SQL que run_estado_incidencia_http.
        old = write_sql(pg); read = read_sql(pg, legacy); new = incidence_sql(pg)
        new_read = incidence_read_sql(pg); states = state_sql(pg); resumen = resumen_sql(pg)
        runner = unittest.TextTestRunner(verbosity=2, resultclass=SafeResult)
        if runner.run(unittest.TestSuite([resumen, states, new_read, new, read, old])).wasSuccessful():
            with ExitStack() as stack:
                # write_http aísla entorno/cwd antes de importar FastAPI; debe ir primero.
                old_http = write_http(pg, stack)
                read_http = read_http_suite(pg, stack, legacy)
                new_http = incidence_http(pg, stack)
                states_http = estado_http(pg, stack)
                new_read_http = incidence_read_http(pg)
                resumen_http = http_suite(pg, stack)
                result = runner.run(unittest.TestSuite([resumen_http, states_http, new_read_http, new_http,
                                                        read_http, old_http]))
                code = 0 if result.wasSuccessful() else 1
    except (Exception, KeyboardInterrupt) as error:
        print('Integración HU017 HTTP no completada:', type(error).__name__, file=sys.stderr)
    finally:
        try:
            pg.close()
        except Exception:
            print('Limpieza pendiente: revisar solo candidatos enumerados.', file=sys.stderr)
            code = 1
    return code


if __name__ == '__main__':
    sys.exit(main())
