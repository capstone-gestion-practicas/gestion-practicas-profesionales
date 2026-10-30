"""Consulta EP06: PostgreSQL 18.6 exclusivo y regresiones SQL EP04/EP05/HU015."""
import argparse
import signal
import sys
import unittest
from run_inicio_practica import ROOT
from run_historial_seguimiento import connection, suite as read_suite, SafeResult
from run_registro_seguimiento import SeguimientoPostgres, make_suite as write_suite
from run_registro_incidencia import suite as incidence_suite

SQL = ROOT / 'scripts/BD/fixes/ep06-04-consultar-incidencias.sql'
CALL = 'SELECT incidencias_privadas.fn_consultar_incidencias(%s,%s,%s,%s)'


def suite(pg):
    import psycopg
    with connection(pg) as admin:
        before = snapshot(admin)
        functions = admin.execute("SELECT oid,pg_get_functiondef(oid),proacl::text FROM pg_proc WHERE pronamespace IN ('incidencias_privadas'::regnamespace,'seguimientos_privados'::regnamespace,'practicas_privadas'::regnamespace) ORDER BY oid").fetchall()
        for setup, undo in [
            ('ALTER TABLE incidencia DISABLE ROW LEVEL SECURITY','ALTER TABLE incidencia ENABLE ROW LEVEL SECURITY'),
            ('GRANT SELECT(correo) ON usuario TO PUBLIC','REVOKE SELECT(correo) ON usuario FROM PUBLIC'),
            ('GRANT UPDATE(descripcion) ON incidencia TO PUBLIC','REVOKE UPDATE(descripcion) ON incidencia FROM PUBLIC')]:
            admin.execute(setup)
            try:
                try: admin.execute(SQL.read_text())
                except psycopg.errors.RaiseException: admin.execute('ROLLBACK')
                else: raise AssertionError('Preflight aceptó entorno incompatible')
                assert not admin.execute("SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='pl_ep06_read_owner')").fetchone()[0]
            finally: admin.execute(undo)
        admin.execute('ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO ep05_test_client')
        try: admin.execute(SQL.read_text())
        finally: admin.execute('ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM ep05_test_client')
        assert before == snapshot(admin)
        assert functions == admin.execute("SELECT oid,pg_get_functiondef(oid),proacl::text FROM pg_proc WHERE oid=ANY(%s) ORDER BY oid",([r[0] for r in functions],)).fetchall()

    class ConsultaIncidenciasTests(unittest.TestCase):
        def setUp(self):
            self.admin=connection(pg); self.addCleanup(self.admin.close)
            self.db=connection(pg,'ep06_test_login'); self.addCleanup(self.db.close)
            self.identifier=self.practice()

        def practice(self,state='EN_CURSO'):
            return self.admin.execute('INSERT INTO practica(id_estudiante,id_centro,id_estado_actual) SELECT 100,100,id_estado FROM estado_practica WHERE nombre=%s RETURNING id_practica',(state,)).fetchone()[0]

        def read(self,actor=101,identifier=None,limit=50,offset=0):
            return self.db.execute(CALL,(self.identifier if identifier is None else identifier,actor,limit,offset)).fetchone()[0]

        def record(self,day='2026-01-01T12:00:00Z',actor=101,identifier=None):
            return self.admin.execute("INSERT INTO incidencia(id_practica,id_usuario,id_tipo_incidencia,fecha,descripcion) SELECT %s,%s,id_tipo_incidencia,%s,'Texto' FROM tipo_incidencia WHERE codigo='OTRO' RETURNING id_incidencia",(self.identifier if identifier is None else identifier,actor,day)).fetchone()[0]

        def test_roles_empty_and_defaults(self):
            expected={'id_practica':self.identifier,'items':[],'limit':50,'offset':0,'hay_mas':False}
            for actor in (101,102): self.assertEqual(self.read(actor),expected)
            self.assertEqual(self.db.execute('SELECT incidencias_privadas.fn_consultar_incidencias(%s,101)',(self.identifier,)).fetchone()[0],expected)

        def test_unauthorized_precedes_existence(self):
            for actor in (100,999999,None):
                for identifier in (self.identifier,999999):
                    self.assertEqual(self.read(actor,identifier),{'error':'USUARIO_NO_AUTORIZADO'})
            for setup,undo in [('UPDATE usuario SET activo=false WHERE id_usuario=101','UPDATE usuario SET activo=true WHERE id_usuario=101'),("UPDATE rol SET activo=false WHERE nombre='GESTOR'","UPDATE rol SET activo=true WHERE nombre='GESTOR'")]:
                self.admin.execute(setup)
                try: self.assertEqual(self.read(),{'error':'USUARIO_NO_AUTORIZADO'})
                finally: self.admin.execute(undo)

        def test_missing_and_invalid_pagination(self):
            self.assertEqual(self.read(identifier=999999),{'error':'PRACTICA_NO_ENCONTRADA'})
            for limit,offset in [(0,0),(101,0),(None,0),(50,-1),(50,None)]:
                self.assertEqual(self.read(limit=limit,offset=offset),{'error':'PAGINACION_INVALIDA'})

        def test_order_pages_and_practice_isolation(self):
            old=self.record(); first=self.record('2026-02-01T12:00:00Z'); last=self.record('2026-02-01T12:00:00Z')
            other=self.practice(); self.record(identifier=other)
            self.assertEqual([r['id_incidencia'] for r in self.read()['items']],[last,first,old])
            page=self.read(limit=2); self.assertTrue(page['hay_mas'])
            self.assertEqual([r['id_incidencia'] for r in page['items']],[last,first])
            self.assertEqual([r['id_incidencia'] for r in self.read(limit=2,offset=2)['items']],[old])
            self.assertFalse(self.read(limit=3)['hay_mas'])
            self.assertEqual(self.read(offset=3)['items'],[])
            self.assertTrue(all(r['id_practica']==self.identifier for r in self.read()['items']))

        def test_historical_finalized_null_type_and_unchanged_content(self):
            before=snapshot(self.admin)
            legacy=self.admin.execute('SELECT id_practica FROM incidencia WHERE id_tipo_incidencia IS NULL LIMIT 1').fetchone()[0]
            rows=self.read(identifier=legacy)['items']
            self.assertEqual({r['estado'] for r in rows},{'ABIERTA','EN_REVISION','RESUELTA','CERRADA'})
            self.assertTrue(all(r['tipo'] is None and r['sin_tipo_registrado'] for r in rows))
            self.assertIn('',[r['descripcion'] for r in rows]);self.assertIn(2001,[len(r['descripcion']) for r in rows])
            self.assertTrue(all(r['resolucion'] is None for r in rows))
            self.assertEqual(before,snapshot(self.admin))

        def test_inactive_author_and_type_still_visible(self):
            self.record(actor=102)
            self.admin.execute("UPDATE usuario SET activo=false WHERE id_usuario=102; UPDATE tipo_incidencia SET activo=false WHERE codigo='OTRO'")
            try:
                row=self.read()['items'][0]
                self.assertEqual(row['id_usuario'],102);self.assertEqual(row['tipo'],'OTRO')
                self.assertFalse(row['sin_tipo_registrado'])
            finally:
                self.admin.execute("UPDATE usuario SET activo=true WHERE id_usuario=102; UPDATE tipo_incidencia SET activo=true WHERE codigo='OTRO'")

        def test_resolution_data_without_invention(self):
            identifier=self.record()
            self.admin.execute("UPDATE incidencia SET estado='RESUELTA',fecha_resolucion='2026-02-01T12:00:00Z' WHERE id_incidencia=%s",(identifier,))
            row=self.read()['items'][0]
            self.assertIsNotNone(row['fecha_resolucion']);self.assertIsNone(row['resolucion'])
            event=self.admin.execute("INSERT INTO historial_estado_incidencia(id_incidencia,id_usuario,estado_anterior,estado_nuevo,fecha,comentario) VALUES(%s,102,'PENDIENTE','RESUELTA','2026-02-01T12:00:00Z','Comentario sintético') RETURNING id_historial",(identifier,)).fetchone()[0]
            self.assertEqual(self.read()['items'][0]['resolucion'],{'id_historial':event,'id_usuario':102,'fecha':'2026-02-01T12:00:00+00:00','comentario':'Comentario sintético'})

        def test_read_only_and_timezone_independence(self):
            self.record()
            before=snapshot(self.admin)
            expected=self.read()
            for zone in ('UTC','America/Santiago','Pacific/Kiritimati'):
                self.db.execute("SELECT set_config('TimeZone',%s,false)",(zone,))
                self.db.execute('BEGIN READ ONLY')
                try:self.assertEqual(self.read(),expected)
                finally:self.db.execute('ROLLBACK')
            self.assertEqual(before,snapshot(self.admin))

        def test_rls_security_definer_and_shadowing(self):
            self.record()
            self.db.execute('CREATE TEMP TABLE incidencia(id_incidencia bigint); CREATE TEMP TABLE usuario(id_usuario bigint); SET search_path=pg_temp,public')
            self.assertEqual(len(self.read()['items']),1)
            self.admin.execute('CREATE POLICY ep06_read_test_deny ON incidencia AS RESTRICTIVE FOR SELECT TO pl_ep06_read_owner USING(false)')
            try:self.assertEqual(self.read()['items'],[])
            finally:self.admin.execute('DROP POLICY ep06_read_test_deny ON incidencia')
            self.assertEqual(self.admin.execute("SELECT prosecdef,provolatile,proconfig FROM pg_proc WHERE oid='incidencias_privadas.fn_consultar_incidencias(bigint,bigint,integer,bigint)'::regprocedure").fetchone(),(True,'s',['search_path=pg_catalog, pg_temp','TimeZone=UTC']))

        def test_no_direct_select_or_new_write_privileges(self):
            for table in ('incidencia','historial_estado_incidencia','tipo_incidencia','usuario','practica'):
                for operation in (f'SELECT * FROM {table}',f'DELETE FROM {table}',f'TRUNCATE {table} CASCADE'):
                    with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.db.execute(operation)
            with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.db.execute('SET ROLE pl_ep06_read_owner')
            self.admin.execute('BEGIN; SET LOCAL ROLE pl_ep06_read_owner')
            try:
                with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.admin.execute("UPDATE incidencia SET descripcion='No permitido'")
            finally:self.admin.execute('ROLLBACK')
            for user in ('ep05_test_client','ep05_test_login','ep05_read_test','ep04_integration_login'):
                with connection(pg,user) as other:
                    with self.assertRaises(psycopg.errors.InsufficientPrivilege):other.execute(CALL,(self.identifier,101,50,0))

    return unittest.defaultTestLoader.loadTestsFromTestCase(ConsultaIncidenciasTests)


def snapshot(db):
    return [db.execute(f'SELECT to_jsonb(t) FROM public.{table} t ORDER BY {identifier}').fetchall()
            for table,identifier in [('incidencia','id_incidencia'),('historial_estado_incidencia','id_historial'),('alerta','id_alerta'),('tipo_incidencia','id_tipo_incidencia')]]


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--docker-local',action='store_true',required=True);parser.parse_args()
    pg=SeguimientoPostgres('postgres:18.6');pg.name='ep06-read-'+pg.run_id
    pg.network,pg.volume=pg.name+'-net',pg.name+'-data'
    def interrupted(*_):raise KeyboardInterrupt
    signal.signal(signal.SIGTERM,interrupted)
    code=1
    try:
        pg.start()
        with connection(pg) as db:
            legacy=db.execute("INSERT INTO practica(id_estudiante,id_centro,id_estado_actual) SELECT 100,100,id_estado FROM estado_practica WHERE nombre='FINALIZADA' RETURNING id_practica").fetchone()[0]
            for medium,description in [(None,''),('Antiguo','x'*2001)]:
                db.execute("INSERT INTO seguimiento(id_practica,id_usuario,fecha,tipo,observacion) VALUES(%s,102,'2026-07-01 02:30:00+00',%s,%s)",(legacy,medium,description))
        hu013=write_suite(pg);hu014=read_suite(pg,legacy);hu015=incidence_suite(pg);read=suite(pg)
        result=unittest.TextTestRunner(verbosity=2,resultclass=SafeResult).run(unittest.TestSuite([read,hu015,hu014,hu013]))
        code=0 if result.wasSuccessful() else 1
    except (Exception,KeyboardInterrupt) as error:
        print('Consulta incidencias no completada:',type(error).__name__,file=sys.stderr)
    finally:
        try:pg.close()
        except Exception:
            print('Limpieza pendiente: revisar solo candidatos enumerados.',file=sys.stderr);code=1
    return code

if __name__=='__main__':sys.exit(main())
