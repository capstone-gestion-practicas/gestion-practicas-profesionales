"""HU014 HTTP real y regresión HU013/EP04 en Docker exclusivo."""
import argparse
from contextlib import ExitStack
import signal
import sys
import unittest
from unittest.mock import patch
from run_historial_seguimiento import connection, suite, SafeResult
from run_registro_seguimiento import SeguimientoPostgres, make_suite as registration_suite
from run_seguimiento_http import http_suite


def read_http_suite(pg, stack, legacy):
    from sqlalchemy.engine import URL
    from sqlalchemy import text
    from sqlalchemy.exc import DBAPIError
    from fastapi.testclient import TestClient
    from app.main import app
    from app.core.security import create_access_token
    from app.core import seguimientos_lectura_database as read
    url=URL.create('postgresql+psycopg',username='ep05_read_test',password=pg.executor_password,
        host=pg.host,port=5432,database='ep04_integration').render_as_string(hide_password=False)
    stack.enter_context(patch.object(read.settings,'seguimientos_lectura_database_url',url))
    def dispose():
        if read._factory is not None:
            read._factory.kw['bind'].dispose()
            read._factory=None
    stack.callback(dispose)

    class ReadHttpTests(unittest.TestCase):
        def setUp(self):
            self.admin=connection(pg)
            self.addCleanup(self.admin.close)
            self.client=self.enterContext(TestClient(app))
            self.identifier=self.admin.execute("INSERT INTO practica(id_estudiante,id_centro,id_estado_actual) SELECT 100,100,id_estado FROM estado_practica WHERE nombre='EN_CURSO' RETURNING id_practica").fetchone()[0]

        def headers(self,actor=101): return {'Authorization':'Bearer '+create_access_token(actor)}
        def get(self, actor=101, identifier=None, query=''):
            return self.client.get(f'/practicas/{self.identifier if identifier is None else identifier}/seguimientos'+query,headers=self.headers(actor))

        def test_post_then_get_independent_confirmation_and_no_writes(self):
            body={'fecha':'2026-01-01','tipo':'Otro','observacion':'Texto'}
            post=self.client.post(f'/practicas/{self.identifier}/seguimientos',json=body,headers=self.headers())
            self.assertEqual(post.status_code,201)
            before=self.admin.execute('SELECT * FROM seguimiento ORDER BY id_seguimiento').fetchall()
            response=self.get()
            self.assertEqual(response.status_code,200)
            self.assertEqual(response.json()['items'][0]['id_seguimiento'],post.json()['id_seguimiento'])
            self.assertEqual(before,self.admin.execute('SELECT * FROM seguimiento ORDER BY id_seguimiento').fetchall())
            self.assertEqual(self.get(actor=102).status_code,200)

        def test_authorization_and_inactive(self):
            for actor in (100,999999): self.assertEqual(self.get(actor).status_code,403)
            self.admin.execute('UPDATE usuario SET activo=false WHERE id_usuario=101')
            try: self.assertEqual(self.get().status_code,403)
            finally: self.admin.execute('UPDATE usuario SET activo=true WHERE id_usuario=101')
            self.assertIn(self.client.get(f'/practicas/{self.identifier}/seguimientos').status_code,(401,403))

        def test_empty_missing_and_parameters(self):
            self.assertEqual(self.get().json()['items'],[])
            self.assertEqual(self.get(identifier=9223372036854775807).status_code,404)
            for query in ('?limit=101','?offset=-1','?id_usuario=102'):
                self.assertEqual(self.get(query=query).status_code,422)

        def test_finalized_legacy_and_inactive_author(self):
            self.admin.execute('UPDATE usuario SET activo=false WHERE id_usuario=102')
            try:
                data=self.get(identifier=legacy).json()
                self.assertEqual([r['tipo'] for r in data['items']],['Antiguo',None])
                self.assertEqual([len(r['observacion']) for r in data['items']],[2001,0])
                page=self.get(identifier=legacy,query='?limit=1&offset=0').json()
                self.assertTrue(page['hay_mas'])
                self.assertEqual(page['items'][0]['responsable']['id_usuario'],102)
            finally: self.admin.execute('UPDATE usuario SET activo=true WHERE id_usuario=102')

        def test_connection_is_readonly_and_direct_select_denied(self):
            dependency=read.get_seguimientos_lectura_db()
            db=next(dependency)
            try:
                self.assertEqual(db.execute(text('SELECT current_user')).scalar_one(),'ep05_read_test')
                self.assertEqual(db.execute(text('SHOW transaction_read_only')).scalar_one(),'on')
                with self.assertRaises(DBAPIError) as error: db.execute(text('SELECT * FROM seguimiento'))
                self.assertEqual(error.exception.orig.sqlstate,'42501')
                db.rollback()
            finally: dependency.close()

        def test_no_fallback_when_read_url_missing(self):
            with patch.object(read,'_factory',None),patch.object(read.settings,'seguimientos_lectura_database_url',None):
                self.assertEqual(self.get().status_code,503)

    return unittest.defaultTestLoader.loadTestsFromTestCase(ReadHttpTests)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--docker-local',action='store_true',required=True)
    parser.add_argument('--image',default='postgres:18.6')
    args=parser.parse_args()
    pg=SeguimientoPostgres(args.image)
    pg.name='ep05-hu014-http-'+pg.run_id
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
        if result.wasSuccessful():
            with ExitStack() as stack:
                old_http = http_suite(pg, stack)
                new_http = read_http_suite(pg, stack, legacy)
                result = unittest.TextTestRunner(verbosity=2,resultclass=SafeResult).run(unittest.TestSuite([new_http, old_http]))
                code = 0 if result.wasSuccessful() else 1
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
