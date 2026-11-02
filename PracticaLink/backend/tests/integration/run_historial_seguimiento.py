"""HU014 SQL real, PostgreSQL 18.6 exclusivo. Sin FastAPI, .env ni URLs externas."""
import argparse
import signal
import sys
import unittest
from run_registro_seguimiento import SeguimientoPostgres, make_suite as registration_suite
from run_inicio_practica import ROOT

READ = ROOT / 'scripts/BD/fixes/ep05-04-consultar-seguimientos.sql'
INDEX = ROOT / 'scripts/BD/fixes/ep05-05-indice-lectura-seguimientos.sql'
CALL = 'SELECT seguimientos_privados.fn_consultar_seguimientos(%s,%s,%s,%s)'


def connection(pg, user='postgres'):
    import psycopg
    return psycopg.connect(host=pg.host, hostaddr=pg.host, dbname='ep04_integration',
        port=5432, user=user, password=pg.admin_password if user=='postgres' else pg.executor_password,
        autocommit=True, connect_timeout=5, sslmode='disable', gssencmode='disable',
        passfile='/dev/null', options='-c statement_timeout=10000 -c lock_timeout=7000')


def suite(pg, legacy):
    import psycopg
    from psycopg import sql
    with connection(pg) as admin:
        # Rechazo y rollback integral ante permisos ambientales/RLS incompatibles.
        for setup, cleanup in [
            ('ALTER TABLE seguimiento DISABLE ROW LEVEL SECURITY','ALTER TABLE seguimiento ENABLE ROW LEVEL SECURITY'),
            ('GRANT SELECT(correo) ON usuario TO PUBLIC','REVOKE SELECT(correo) ON usuario FROM PUBLIC'),
            ('GRANT UPDATE(observacion) ON seguimiento TO PUBLIC','REVOKE UPDATE(observacion) ON seguimiento FROM PUBLIC')]:
            admin.execute(setup)
            try:
                try:
                    admin.execute(READ.read_text())
                except psycopg.errors.RaiseException:
                    admin.execute('ROLLBACK')
                else:
                    raise AssertionError('Preflight inseguro aceptado')
                assert not admin.execute("SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='pl_ep05_read_owner')").fetchone()[0]
            finally:
                admin.execute(cleanup)
        before = admin.execute('SELECT * FROM seguimiento ORDER BY id_seguimiento').fetchall()
        functions = admin.execute("SELECT oid,pg_get_functiondef(oid),proacl::text FROM pg_proc WHERE proname IN ('fn_registrar_seguimiento','fn_iniciar_practica') ORDER BY oid").fetchall()
        admin.execute('ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO ep05_test_client')
        try:
            admin.execute(READ.read_text())
        finally:
            admin.execute('ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM ep05_test_client')
        admin.execute(INDEX.read_text())
        assert before == admin.execute('SELECT * FROM seguimiento ORDER BY id_seguimiento').fetchall()
        assert functions == admin.execute("SELECT oid,pg_get_functiondef(oid),proacl::text FROM pg_proc WHERE proname IN ('fn_registrar_seguimiento','fn_iniciar_practica') ORDER BY oid").fetchall()
        admin.execute(sql.SQL('CREATE ROLE ep05_read_test LOGIN INHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD {}').format(sql.Literal(pg.executor_password)))
        admin.execute('GRANT pl_ep05_read_executor TO ep05_read_test')

    class HistorialTests(unittest.TestCase):
        def setUp(self):
            self.admin = connection(pg)
            self.addCleanup(self.admin.close)
            self.db = connection(pg, 'ep05_read_test')
            self.addCleanup(self.db.close)
            self.identifier = self.practice()

        def practice(self, state='EN_CURSO'):
            return self.admin.execute('''INSERT INTO practica(id_estudiante,id_centro,id_estado_actual)
                SELECT 100,100,id_estado FROM estado_practica WHERE nombre=%s RETURNING id_practica''',(state,)).fetchone()[0]

        def record(self, day='2026-01-01', actor=101):
            return self.admin.execute("INSERT INTO seguimiento(id_practica,id_usuario,fecha_seguimiento,tipo,observacion) VALUES(%s,%s,%s,'Otro','Texto') RETURNING id_seguimiento",(self.identifier,actor,day)).fetchone()[0]

        def read(self, actor=101, identifier=None, limit=50, offset=0):
            return self.db.execute(CALL,(self.identifier if identifier is None else identifier,actor,limit,offset)).fetchone()[0]

        def test_roles_and_empty_history_defaults(self):
            for actor in (101,102):
                self.assertEqual(self.read(actor), {'id_practica':self.identifier,'items':[],'limit':50,'offset':0,'hay_mas':False})
            self.assertEqual(self.db.execute('SELECT seguimientos_privados.fn_consultar_seguimientos(%s,101)',(self.identifier,)).fetchone()[0], self.read())

        def test_unauthorized_never_discloses_existence(self):
            for actor in (100,999999,None):
                for identifier in (self.identifier,999999):
                    self.assertEqual(self.read(actor,identifier),{'error':'USUARIO_NO_AUTORIZADO'})
            for query, undo in [
                ('UPDATE usuario SET activo=false WHERE id_usuario=101','UPDATE usuario SET activo=true WHERE id_usuario=101'),
                ("UPDATE rol SET activo=false WHERE nombre='GESTOR'","UPDATE rol SET activo=true WHERE nombre='GESTOR'")]:
                self.admin.execute(query)
                try:
                    self.assertEqual(self.read(),{'error':'USUARIO_NO_AUTORIZADO'})
                finally:
                    self.admin.execute(undo)

        def test_missing_and_pagination_validation(self):
            self.assertEqual(self.read(identifier=999999),{'error':'PRACTICA_NO_ENCONTRADA'})
            for limit,offset in [(0,0),(-1,0),(101,0),(None,0),(1,-1),(1,None)]:
                self.assertEqual(self.read(limit=limit,offset=offset),{'error':'PAGINACION_INVALIDA'})
            self.assertEqual(self.read(limit=100,offset=9223372036854775807)['items'],[])

        def test_finalized_practice_and_no_cross_practice_rows(self):
            self.identifier=self.practice('FINALIZADA')
            expected=self.record()
            self.assertEqual(self.read()['items'][0]['id_seguimiento'],expected)
            self.assertEqual(self.read(identifier=self.practice())['items'],[])

        def test_order_ties_pages_and_exact_contract(self):
            old=self.record('2026-01-01')
            first=self.record('2026-03-01')
            last=self.record('2026-03-01')
            self.assertEqual([r['id_seguimiento'] for r in self.read()['items']],[last,first,old])
            page=self.read(limit=2)
            self.assertTrue(page['hay_mas'])
            self.assertEqual(len(page['items']),2)
            self.assertEqual([r['id_seguimiento'] for r in self.read(limit=2,offset=2)['items']],[old])
            self.assertFalse(self.read(limit=3)['hay_mas'])
            self.assertFalse(self.read(offset=3)['hay_mas'])
            self.assertEqual(set(page['items'][0]),{'id_seguimiento','fecha','tipo','observacion','responsable'})
            self.assertEqual(set(page['items'][0]['responsable']),{'id_usuario','nombre'})
            self.assertEqual(page['items'][0]['fecha'],'2026-03-01')

        def test_legacy_null_empty_long_and_timezone(self):
            result=self.read(identifier=legacy)
            self.assertEqual([r['tipo'] for r in result['items']],['Antiguo',None])
            self.assertEqual([len(r['observacion']) for r in result['items']],[2001,0])
            for zone in ('UTC','Pacific/Kiritimati','America/Santiago'):
                self.db.execute("SELECT set_config('TimeZone',%s,false)",(zone,))
                self.assertEqual(self.read(identifier=legacy),result)
            self.assertEqual(result['items'][0]['fecha'],'2026-06-30')

        def test_current_name_even_inactive_author(self):
            self.record(actor=102)
            self.admin.execute("UPDATE usuario SET nombre='Actual',activo=false WHERE id_usuario=102")
            try:
                self.assertEqual(self.read()['items'][0]['responsable'],{'id_usuario':102,'nombre':'Actual Sintetico'})
                self.assertEqual(self.read(actor=102),{'error':'USUARIO_NO_AUTORIZADO'})
            finally:
                self.admin.execute("UPDATE usuario SET nombre='Admin',activo=true WHERE id_usuario=102")

        def test_effective_privileges_and_separate_capabilities(self):
            self.assertEqual(self.db.execute('SELECT current_user').fetchone()[0],'ep05_read_test')
            for table in ('usuario','usuario_rol','rol','practica','seguimiento'):
                for operation in (f'SELECT * FROM {table}', f'DELETE FROM {table}',f'TRUNCATE {table} CASCADE'):
                    with self.assertRaises(psycopg.errors.InsufficientPrivilege): self.db.execute(operation)
            for operation in ["UPDATE seguimiento SET observacion='x'", "INSERT INTO seguimiento(id_practica,id_usuario) VALUES(1,101)",
                              'SET ROLE pl_ep05_read_owner', "SELECT seguimientos_privados.fn_registrar_seguimiento(1,101,CURRENT_DATE,'Otro','Texto')"]:
                with self.assertRaises(psycopg.errors.InsufficientPrivilege): self.db.execute(operation)
            for user in ('ep05_test_login','ep05_test_client','ep04_integration_login'):
                with connection(pg,user) as other:
                    with self.assertRaises(psycopg.errors.InsufficientPrivilege): other.execute(CALL,(self.identifier,101,50,0))
            self.assertEqual(self.admin.execute("SELECT r.rolname FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid WHERE m.member='ep05_read_test'::regrole").fetchall(),[('pl_ep05_read_executor',)])
            self.assertEqual(self.admin.execute("SELECT rolsuper,rolbypassrls,rolcreaterole,rolcreatedb FROM pg_roles WHERE rolname='ep05_read_test'").fetchone(),(False,False,False,False))

        def test_security_definer_rls_and_search_path(self):
            self.record()
            self.db.execute('CREATE TEMP TABLE seguimiento(id_seguimiento bigint); CREATE TEMP TABLE usuario(id_usuario bigint); SET search_path=pg_temp,public')
            self.assertEqual(len(self.read()['items']),1)
            self.db.execute('BEGIN READ ONLY')
            self.assertEqual(len(self.read()['items']),1)
            self.db.execute('ROLLBACK')
            self.admin.execute('CREATE POLICY hu014_test_deny ON seguimiento AS RESTRICTIVE FOR SELECT TO pl_ep05_read_owner USING(false)')
            try:
                self.assertEqual(self.read()['items'],[]) # demuestra que DEFINER no evita RLS
            finally:
                self.admin.execute('DROP POLICY hu014_test_deny ON seguimiento')
            flags=self.admin.execute("SELECT prosecdef,provolatile,proconfig FROM pg_proc WHERE oid='seguimientos_privados.fn_consultar_seguimientos(bigint,bigint,integer,bigint)'::regprocedure").fetchone()
            self.assertEqual(flags,(True,'s',['search_path=pg_catalog, pg_temp']))

        def test_equivalent_index_is_reused(self):
            before=self.admin.execute("SELECT indexrelid FROM pg_index WHERE indrelid='seguimiento'::regclass ORDER BY indexrelid").fetchall()
            self.admin.execute(INDEX.read_text())
            self.assertEqual(before,self.admin.execute("SELECT indexrelid FROM pg_index WHERE indrelid='seguimiento'::regclass ORDER BY indexrelid").fetchall())
            self.admin.execute('BEGIN')
            try:
                self.admin.execute('DROP INDEX idx_ep05_seguimiento_historial; CREATE INDEX hu014_equivalent ON seguimiento(id_practica,fecha_seguimiento,id_seguimiento)')
                # Strip outer transaction only for this rollback-contained index experiment.
                source=INDEX.read_text().replace('BEGIN;','',1).rsplit('COMMIT;',1)[0]
                self.admin.execute(source)
                self.assertIsNone(self.admin.execute("SELECT to_regclass('idx_ep05_seguimiento_historial')").fetchone()[0])
            finally:
                self.admin.execute('ROLLBACK')

    return unittest.defaultTestLoader.loadTestsFromTestCase(HistorialTests)


class SafeResult(unittest.TextTestResult):
    def _exc_info_to_string(self,err,test):
        # No imprimir DSN, parámetros, credenciales ni filas.
        return f'{err[0].__name__}: revisar {test.id()} (detalle sensible omitido)'


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--docker-local',action='store_true',required=True)
    parser.add_argument('--image',default='postgres:18.6')
    args=parser.parse_args()
    pg=SeguimientoPostgres(args.image)
    pg.name='ep05-hu014-'+pg.run_id
    pg.network,pg.volume=pg.name+'-net',pg.name+'-data'
    def interrupted(*_): raise KeyboardInterrupt
    signal.signal(signal.SIGTERM,interrupted)
    code=1
    try:
        pg.start()
        # Históricos reales ANTES de instalar restricciones HU013, sin debilitarlas.
        with connection(pg) as admin:
            legacy=admin.execute("INSERT INTO practica(id_estudiante,id_centro,id_estado_actual) SELECT 100,100,id_estado FROM estado_practica WHERE nombre='FINALIZADA' RETURNING id_practica").fetchone()[0]
            for medium,observation in [(None,''),('Antiguo','x'*2001)]:
                admin.execute("INSERT INTO seguimiento(id_practica,id_usuario,fecha,tipo,observacion) VALUES(%s,102,'2026-07-01 02:30:00+00',%s,%s)",(legacy,medium,observation))
        old=registration_suite(pg) # prepara HU013 y sus pruebas sin ejecutarlas todavía
        new=suite(pg,legacy)
        result=unittest.TextTestRunner(verbosity=2,resultclass=SafeResult).run(unittest.TestSuite([new,old]))
        code=0 if result.wasSuccessful() else 1
    except (Exception,KeyboardInterrupt) as error:
        print('HU014 no completada:',type(error).__name__,file=sys.stderr)
    finally:
        try:
            pg.close()
            print('Limpieza exclusiva completada.' if pg.candidates else 'No se crearon recursos Docker.')
        except Exception:
            print('Limpieza pendiente: revisar exclusivamente candidatos enumerados.',file=sys.stderr)
            code=1
    return code


if __name__=='__main__': sys.exit(main())
