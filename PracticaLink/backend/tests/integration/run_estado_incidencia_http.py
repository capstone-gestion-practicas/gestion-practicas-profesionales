"""HU016 HTTP + PostgreSQL 18.6 exclusivo; incluye regresión SQL y HTTP EP04/EP05."""
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


from run_estado_incidencia import suite as state_sql
from run_incidencia_http import http_suite as incidence_http

def http_suite(pg, stack):
    from concurrent.futures import ThreadPoolExecutor
    from datetime import datetime
    from fastapi.testclient import TestClient
    from sqlalchemy import text
    from sqlalchemy.exc import DBAPIError
    from app.main import app
    from app.core.security import create_access_token
    from app.core import incidencias_database as restricted

    class EstadoHttpTests(unittest.TestCase):
        def setUp(self):
            self.admin=connection(pg)
            self.addCleanup(self.admin.close)
            self.client=self.enterContext(TestClient(app))
            self.practice=self.admin.execute("INSERT INTO practica(id_estudiante,id_centro,id_estado_actual) SELECT 100,100,id_estado FROM estado_practica WHERE nombre='EN_CURSO' RETURNING id_practica").fetchone()[0]
            response=self.client.post(f'/practicas/{self.practice}/incidencias',
                json={'tipo':'SALUD','descripcion':'Sintética HU016'},headers=self.headers())
            self.assertEqual(response.status_code,201)
            self.incidence=response.json()['id_incidencia']
            self.base=f'/practicas/{self.practice}/incidencias/{self.incidence}'
            self.body={'estado_esperado':'PENDIENTE','estado_nuevo':'EN_ATENCION'}

        def headers(self, actor=101):
            return {'Authorization':'Bearer '+create_access_token(actor)}

        def change(self, body=None, actor=101, base=None):
            return self.client.patch((base or self.base)+'/estado',json=self.body if body is None else body,headers=self.headers(actor))

        def read(self, actor=101, suffix='', base=None):
            return self.client.get((base or self.base)+'/historial'+suffix,headers=self.headers(actor))

        def snapshot(self):
            return (self.admin.execute('SELECT to_jsonb(i) FROM incidencia i WHERE id_incidencia=%s',(self.incidence,)).fetchone(),
                self.admin.execute('SELECT to_jsonb(h) FROM historial_estado_incidencia h WHERE id_incidencia=%s ORDER BY id_historial',(self.incidence,)).fetchall())

        def test_patch_commit_two_roles_resolution_and_full_get(self):
            original=self.snapshot()
            first=self.change()
            self.assertEqual(first.status_code,200)
            before=self.admin.execute('SELECT clock_timestamp()').fetchone()[0]
            response=self.change({'estado_esperado':'EN_ATENCION','estado_nuevo':'RESUELTA','comentario':'  Resuelto  '},actor=102)
            self.assertEqual(response.status_code,200)
            body=response.json()
            self.assertEqual(body['id_usuario'],102)
            self.assertEqual(body['comentario'],'Resuelto')
            after=self.admin.execute('SELECT clock_timestamp()').fetchone()[0]
            self.assertTrue(before<=datetime.fromisoformat(body['fecha'])<=after)
            current=self.snapshot()
            self.assertEqual(current[0][0]['estado'],'RESUELTA')
            self.assertEqual(current[1][:1],original[1])
            self.assertEqual(len(current[1]),3)
            self.assertEqual(datetime.fromisoformat(current[0][0]['fecha_resolucion']),datetime.fromisoformat(body['fecha']))
            history=self.read(actor=102).json()
            self.assertEqual([i['estado_nuevo'] for i in history['items']],['RESUELTA','EN_ATENCION','PENDIENTE'])
            self.assertEqual(history['items'][0]['id_usuario'],102)
            self.assertIsNone(history['items'][-1]['estado_anterior'])
            self.assertEqual(self.read(suffix='?limit=2').json()['hay_mas'],True)
            self.assertEqual(len(self.read(suffix='?limit=2&offset=2').json()['items']),1)
            self.assertEqual(self.snapshot(),current)

        def test_direct_resolution_finalized_and_post_still_rejected(self):
            self.admin.execute("UPDATE practica SET id_estado_actual=(SELECT id_estado FROM estado_practica WHERE nombre='FINALIZADA') WHERE id_practica=%s",(self.practice,))
            self.assertEqual(self.change({**self.body,'estado_nuevo':'RESUELTA','comentario':'Solución'}).status_code,200)
            self.assertEqual(self.read().status_code,200)
            self.assertEqual(self.client.post(f'/practicas/{self.practice}/incidencias',
                json={'tipo':'SALUD','descripcion':'No crear'},headers=self.headers()).status_code,409)

        def test_repeated_regression_reopening_and_stale(self):
            self.assertEqual(self.change({**self.body,'estado_nuevo':'PENDIENTE'}).status_code,409)
            self.assertEqual(self.change().status_code,200)
            self.assertEqual(self.change().status_code,409)
            self.assertEqual(self.change({'estado_esperado':'EN_ATENCION','estado_nuevo':'PENDIENTE'}).status_code,409)
            self.assertEqual(self.change({'estado_esperado':'EN_ATENCION','estado_nuevo':'RESUELTA','comentario':'Fin'}).status_code,200)
            for state in ('PENDIENTE','EN_ATENCION','RESUELTA'):
                self.assertEqual(self.change({'estado_esperado':'RESUELTA','estado_nuevo':state,'comentario':'No'}).status_code,409)
            self.assertEqual(len(self.snapshot()[1]),3)

        def test_validation_and_authorization_no_partial_writes(self):
            original=self.snapshot()
            for value in ({'id_usuario':102},{'fecha':'2026-01-01'}, {'estado_nuevo':'ABIERTA'},
                          {'comentario':'x'*2001},{'comentario':123}):
                self.assertEqual(self.change({**self.body,**value}).status_code,422)
            for value in ('','   ',None,'\t\n'):
                self.assertEqual(self.change({**self.body,'estado_nuevo':'RESUELTA','comentario':value}).status_code,422)
            for actor in (100,999999):
                self.assertEqual(self.change(actor=actor).status_code,403)
                self.assertEqual(self.read(actor=actor).status_code,403)
            for setup,undo in [('UPDATE usuario SET activo=false WHERE id_usuario=101','UPDATE usuario SET activo=true WHERE id_usuario=101'),
                ("UPDATE rol SET activo=false WHERE nombre='GESTOR'","UPDATE rol SET activo=true WHERE nombre='GESTOR'")]:
                self.admin.execute(setup)
                try:
                    self.assertEqual(self.change().status_code,403)
                    self.assertEqual(self.read().status_code,403)
                finally:self.admin.execute(undo)
            self.assertIn(self.client.get(self.base+'/historial',headers={'Authorization':'Bearer invalid'}).status_code,(401,403))
            self.assertEqual(self.snapshot(),original)

        def test_missing_association_historical_and_empty_history(self):
            for base in (f'/practicas/999999/incidencias/{self.incidence}',f'/practicas/{self.practice}/incidencias/999999'):
                self.assertEqual(self.change(base=base).status_code,404)
                self.assertEqual(self.read(base=base).status_code,404)
            legacy,practice=self.admin.execute('SELECT id_incidencia,id_practica FROM incidencia WHERE id_tipo_incidencia IS NULL LIMIT 1').fetchone()
            wrong=f'/practicas/{self.practice}/incidencias/{legacy}'
            self.assertEqual(self.change(base=wrong).status_code,404)
            self.assertEqual(self.read(base=wrong).status_code,404)
            old=f'/practicas/{practice}/incidencias/{legacy}'
            self.assertEqual(self.change(base=old).status_code,409)
            self.assertEqual(self.read(base=old).json()['items'],[])

        def test_incomplete_history_conflict(self):
            identifier=self.admin.execute("INSERT INTO incidencia(id_practica,id_usuario,id_tipo_incidencia,descripcion) SELECT %s,101,id_tipo_incidencia,'Sin evento' FROM tipo_incidencia WHERE codigo='SALUD' RETURNING id_incidencia",(self.practice,)).fetchone()[0]
            self.assertEqual(self.change(base=f'/practicas/{self.practice}/incidencias/{identifier}').status_code,409)

        def test_failure_between_writes_and_commit_failure(self):
            original=self.snapshot()
            for deferred in (False,True):
                self.admin.execute("CREATE FUNCTION public.hu016_http_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic internal detail'; END $$")
                trigger=('CREATE CONSTRAINT TRIGGER hu016_http_fail AFTER INSERT ON historial_estado_incidencia DEFERRABLE INITIALLY DEFERRED' if deferred else 'CREATE TRIGGER hu016_http_fail BEFORE INSERT ON historial_estado_incidencia')
                self.admin.execute(trigger+' FOR EACH ROW EXECUTE FUNCTION public.hu016_http_fail()')
                try:
                    response=self.change()
                    self.assertEqual(response.status_code,500)
                    self.assertNotIn('synthetic internal detail',response.text)
                    self.assertEqual(self.snapshot(),original)
                finally:self.admin.execute('DROP TRIGGER hu016_http_fail ON historial_estado_incidencia; DROP FUNCTION public.hu016_http_fail()')

        def test_two_concurrent_http_managers(self):
            with ThreadPoolExecutor(2) as pool:
                responses=list(pool.map(lambda actor:self.change(actor=actor),[101,102]))
            self.assertEqual(sorted(r.status_code for r in responses),[200,409])
            self.assertEqual(len(self.snapshot()[1]),2)

        def test_read_only_effective_privileges_and_no_fallback(self):
            dep=restricted.get_incidencias_db()
            db=next(dep)
            try:
                self.assertEqual(db.execute(text('SELECT current_user')).scalar_one(),'ep06_test_login')
                for q in ('SELECT * FROM historial_estado_incidencia',"UPDATE incidencia SET estado='RESUELTA'",
                          "INSERT INTO historial_estado_incidencia(id_incidencia) VALUES(1)"):
                    with self.assertRaises(DBAPIError):db.execute(text(q))
                    db.rollback()
            finally:dep.close()
            original=self.snapshot()
            for _ in range(2):self.assertEqual(self.read().status_code,200)
            self.assertEqual(self.snapshot(),original)
            # Misma conexión restringida; sin configuración debe fallar, no recurrir a principal.
            with patch.object(restricted,'_factory',None),patch.object(restricted.settings,'incidencias_database_url',None):
                self.assertEqual(self.change().status_code,503)
                self.assertEqual(self.read().status_code,503)
            self.assertEqual(self.snapshot(),original)
            self.assertEqual(self.change().status_code,200)  # GET no dejó read-only en el pool.

    return unittest.defaultTestLoader.loadTestsFromTestCase(EstadoHttpTests)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--docker-local',action='store_true',required=True); parser.parse_args()
    pg=SeguimientoPostgres('postgres:18.6'); pg.name='ep06-hu016-http-'+pg.run_id
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
        old=write_sql(pg); read=read_sql(pg,legacy); new=incidence_sql(pg); new_read=incidence_read_sql(pg); states=state_sql(pg)
        runner=unittest.TextTestRunner(verbosity=2,resultclass=SafeResult)
        if runner.run(unittest.TestSuite([states,new_read,new,read,old])).wasSuccessful():
            with ExitStack() as stack:
                # Este helper aísla entorno/cwd antes de importar FastAPI.
                old_http=write_http(pg,stack)
                read_http=read_http_suite(pg,stack,legacy)
                new_http=incidence_http(pg,stack); states_http=http_suite(pg,stack)
                new_read_http=incidence_read_http(pg)
                result=runner.run(unittest.TestSuite([states_http,new_read_http,new_http,read_http,old_http]))
                code=0 if result.wasSuccessful() else 1
    except (Exception,KeyboardInterrupt) as error:
        print('Integración HU016 no completada:',type(error).__name__,file=sys.stderr)
    finally:
        try: pg.close()
        except Exception:
            print('Limpieza pendiente: revisar solo candidatos enumerados.',file=sys.stderr);code=1
    return code

if __name__=='__main__': sys.exit(main())
