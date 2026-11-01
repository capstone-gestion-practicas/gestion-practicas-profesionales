"""HU015 HTTP + PostgreSQL 18.6 exclusivo; incluye regresión SQL y HTTP EP04/EP05."""
import argparse
from contextlib import ExitStack
from datetime import datetime
import signal
import sys
import unittest
from unittest.mock import patch
from run_historial_seguimiento import connection, suite as read_sql, SafeResult
from run_registro_seguimiento import SeguimientoPostgres, make_suite as write_sql
from run_registro_incidencia import suite as incidence_sql
from run_consulta_incidencias import suite as incidence_read_sql
from incidencias_lectura_http import read_http_suite as incidence_read_http
from run_seguimiento_http import http_suite as write_http
from run_historial_seguimiento_http import read_http_suite


def http_suite(pg, stack):
    from sqlalchemy.engine import URL
    from sqlalchemy import text
    from sqlalchemy.exc import DBAPIError
    from fastapi.testclient import TestClient
    from app.main import app
    from app.core.security import create_access_token
    from app.core import incidencias_database as restricted

    def url(user):
        return URL.create('postgresql+psycopg',username=user,password=pg.executor_password,
            host=pg.host,port=5432,database='ep04_integration').render_as_string(hide_password=False)
    stack.enter_context(patch.object(restricted.settings,'incidencias_database_url',url('ep06_test_login')))
    def dispose():
        if restricted._factory is not None:
            restricted._factory.kw['bind'].dispose(); restricted._factory=None
    stack.callback(dispose)

    class IncidenciaHttpTests(unittest.TestCase):
        def setUp(self):
            self.admin=connection(pg); self.addCleanup(self.admin.close)
            self.client=self.enterContext(TestClient(app))
            self.identifier=self.practice()
            self.body={'tipo':'SALUD','descripcion':' Texto sintético '}

        def practice(self,state='EN_CURSO'):
            return self.admin.execute('INSERT INTO practica(id_estudiante,id_centro,id_estado_actual) SELECT 100,100,id_estado FROM estado_practica WHERE nombre=%s RETURNING id_practica',(state,)).fetchone()[0]

        def post(self,actor=101,body=None,identifier=None,headers=None):
            return self.client.post(f'/practicas/{self.identifier if identifier is None else identifier}/incidencias',json=self.body if body is None else body,
                headers={'Authorization':'Bearer '+create_access_token(actor)} if headers is None else headers)

        def rows(self):
            return self.admin.execute('SELECT id_incidencia,id_practica,id_usuario,estado,fecha,descripcion,prioridad FROM incidencia WHERE id_practica=%s ORDER BY id_incidencia',(self.identifier,)).fetchall()

        def test_201_confirmed_by_independent_connection_and_history(self):
            for actor in (101,102):
                before=self.admin.execute('SELECT clock_timestamp()').fetchone()[0]
                response=self.post(actor)
                self.assertEqual(response.status_code,201)
                body=response.json(); row=self.rows()[-1]
                self.assertEqual(row[:4],(body['id_incidencia'],self.identifier,actor,'PENDIENTE'))
                self.assertEqual(row[4],datetime.fromisoformat(body['fecha']))
                self.assertTrue(before<=row[4]<=self.admin.execute('SELECT clock_timestamp()').fetchone()[0])
                self.assertEqual(row[5:],(self.body['descripcion'],'MEDIA'))
                self.assertEqual(self.admin.execute('SELECT id_usuario,estado_anterior,estado_nuevo,fecha FROM historial_estado_incidencia WHERE id_incidencia=%s',(row[0],)).fetchall(),[(actor,None,'PENDIENTE',row[4])])

        def test_authentication_real_context_and_active_roles(self):
            for headers in ({},{'Authorization':'Bearer invalid'}):
                self.assertIn(self.post(headers=headers).status_code,(401,403))
            for actor in (100,999999): self.assertEqual(self.post(actor).status_code,403)
            for setup,undo in [('UPDATE usuario SET activo=false WHERE id_usuario=101','UPDATE usuario SET activo=true WHERE id_usuario=101'),("UPDATE rol SET activo=false WHERE nombre='GESTOR'","UPDATE rol SET activo=true WHERE nombre='GESTOR'")]:
                self.admin.execute(setup)
                try: self.assertEqual(self.post().status_code,403)
                finally: self.admin.execute(undo)
            self.assertEqual(self.rows(),[])

        def test_validation_state_and_missing(self):
            for change in [{'tipo':'Salud'},{'descripcion':' \t\n'},{'descripcion':'😀'*2001},{'id_usuario':102},{'fecha':'2026-01-01'},{'estado':'RESUELTA'},{'prioridad':'ALTA'}]:
                self.assertEqual(self.post(body={**self.body,**change}).status_code,422)
            self.assertEqual(self.post(identifier=999999).status_code,404)
            for state, in self.admin.execute("SELECT nombre FROM estado_practica WHERE nombre<>'EN_CURSO'"):
                self.assertEqual(self.post(identifier=self.practice(state)).status_code,409)
            self.admin.execute("UPDATE tipo_incidencia SET activo=false WHERE codigo='SALUD'")
            try: self.assertEqual(self.post().status_code,422)
            finally: self.admin.execute("UPDATE tipo_incidencia SET activo=true WHERE codigo='SALUD'")
            self.assertEqual(self.rows(),[])

        def test_failure_between_inserts_and_deferred_commit(self):
            self.assertEqual(self.post().status_code,201)
            before=self.rows()
            for deferred in (False,True):
                self.admin.execute("CREATE FUNCTION public.ep06_http_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic internal detail'; END $$")
                trigger=('CREATE CONSTRAINT TRIGGER ep06_http_fail AFTER INSERT ON historial_estado_incidencia DEFERRABLE INITIALLY DEFERRED' if deferred else 'CREATE TRIGGER ep06_http_fail BEFORE INSERT ON historial_estado_incidencia')
                self.admin.execute(trigger+' FOR EACH ROW EXECUTE FUNCTION public.ep06_http_fail()')
                try:
                    response=self.post()
                    self.assertEqual(response.status_code,500)
                    self.assertNotIn('synthetic internal detail',response.text)
                    self.assertEqual(self.rows(),before)
                    self.assertEqual(self.admin.execute('SELECT count(*) FROM historial_estado_incidencia h JOIN incidencia i USING(id_incidencia) WHERE i.id_practica=%s',(self.identifier,)).fetchone()[0],1)
                finally: self.admin.execute('DROP TRIGGER ep06_http_fail ON historial_estado_incidencia; DROP FUNCTION public.ep06_http_fail()')

        def test_effective_privileges_and_no_fallback(self):
            dependency=restricted.get_incidencias_db(); db=next(dependency)
            try:
                self.assertEqual(db.execute(text('SELECT current_user')).scalar_one(),'ep06_test_login')
                for query in ['SELECT * FROM incidencia',"INSERT INTO incidencia(id_practica,id_usuario,descripcion) VALUES(1,101,'x')",'UPDATE incidencia SET descripcion=descripcion','DELETE FROM incidencia','TRUNCATE incidencia CASCADE']:
                    with self.assertRaises(DBAPIError) as error: db.execute(text(query))
                    self.assertEqual(error.exception.orig.sqlstate,'42501'); db.rollback()
            finally: dependency.close()
            for value in (None,url('ep05_test_client')):
                with patch.object(restricted,'_factory',None),patch.object(restricted.settings,'incidencias_database_url',value):
                    try:
                        self.assertEqual(self.post().status_code,503 if value is None else 500)
                        self.assertEqual(self.rows(),[])
                    finally:
                        if restricted._factory is not None: restricted._factory.kw['bind'].dispose()

    return unittest.defaultTestLoader.loadTestsFromTestCase(IncidenciaHttpTests)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--docker-local',action='store_true',required=True); parser.parse_args()
    pg=SeguimientoPostgres('postgres:18.6'); pg.name='ep06-http-'+pg.run_id
    pg.network,pg.volume=pg.name+'-net',pg.name+'-data'
    def interrupted(*_): raise KeyboardInterrupt
    signal.signal(signal.SIGTERM,interrupted)
    code=1
    try:
        pg.start()
        with connection(pg) as db:
            legacy=db.execute("INSERT INTO practica(id_estudiante,id_centro,id_estado_actual) SELECT 100,100,id_estado FROM estado_practica WHERE nombre='FINALIZADA' RETURNING id_practica").fetchone()[0]
            for medium,description in [(None,''),('Antiguo','x'*2001)]:
                db.execute("INSERT INTO seguimiento(id_practica,id_usuario,fecha,tipo,observacion) VALUES(%s,102,'2026-07-01 02:30:00+00',%s,%s)",(legacy,medium,description))
        old=write_sql(pg); read=read_sql(pg,legacy); new=incidence_sql(pg); new_read=incidence_read_sql(pg)
        runner=unittest.TextTestRunner(verbosity=2,resultclass=SafeResult)
        if runner.run(unittest.TestSuite([new_read,new,read,old])).wasSuccessful():
            with ExitStack() as stack:
                # Este helper aísla entorno/cwd antes de importar FastAPI.
                old_http=write_http(pg,stack)
                read_http=read_http_suite(pg,stack,legacy)
                new_http=http_suite(pg,stack)
                new_read_http=incidence_read_http(pg)
                result=runner.run(unittest.TestSuite([new_read_http,new_http,read_http,old_http]))
                code=0 if result.wasSuccessful() else 1
    except (Exception,KeyboardInterrupt) as error:
        print('Integración HU015 no completada:',type(error).__name__,file=sys.stderr)
    finally:
        try: pg.close()
        except Exception:
            print('Limpieza pendiente: revisar solo candidatos enumerados.',file=sys.stderr);code=1
    return code

if __name__=='__main__': sys.exit(main())
