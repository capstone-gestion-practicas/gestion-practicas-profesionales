"""Casos GET con SQL real; ejecutados por run_incidencia_http.py."""
import unittest
from unittest.mock import patch
from run_historial_seguimiento import connection
from run_consulta_incidencias import snapshot


def read_http_suite(pg):
    from fastapi.testclient import TestClient
    from sqlalchemy import text
    from sqlalchemy.exc import DBAPIError
    from app.main import app
    from app.core.security import create_access_token
    from app.core import incidencias_database as restricted
    from app.incidencias.service import consultar_incidencias

    class ConsultaHttpTests(unittest.TestCase):
        def setUp(self):
            self.admin=connection(pg);self.addCleanup(self.admin.close)
            self.client=self.enterContext(TestClient(app))
            self.identifier=self.practice()

        def practice(self,state='EN_CURSO'):
            return self.admin.execute('INSERT INTO practica(id_estudiante,id_centro,id_estado_actual) SELECT 100,100,id_estado FROM estado_practica WHERE nombre=%s RETURNING id_practica',(state,)).fetchone()[0]

        def headers(self,actor=101):return {'Authorization':'Bearer '+create_access_token(actor)}
        def get(self,actor=101,identifier=None,query='',headers=None):
            return self.client.get(f'/practicas/{self.identifier if identifier is None else identifier}/incidencias'+query,
                headers=self.headers(actor) if headers is None else headers)
        def post(self):
            return self.client.post(f'/practicas/{self.identifier}/incidencias',json={'tipo':'OTRO','descripcion':'Texto'},headers=self.headers())

        def test_post_get_roles_no_writes_and_pool_reuse(self):
            created=self.post();self.assertEqual(created.status_code,201)
            before=snapshot(self.admin)
            for actor in (101,102):
                response=self.get(actor);self.assertEqual(response.status_code,200)
                item=response.json()['items'][0]
                self.assertEqual(item['id_incidencia'],created.json()['id_incidencia'])
                self.assertEqual(item['id_usuario'],101);self.assertEqual(item['id_practica'],self.identifier)
                self.assertIsNone(item['resolucion'])
            self.assertEqual(before,snapshot(self.admin))
            self.assertEqual(self.post().status_code,201)

        def test_real_auth_context_denials(self):
            for actor in (100,999999):
                self.assertEqual(self.get(actor,identifier=999999).status_code,403)
            for headers in ({},{'Authorization':'Bearer invalid'}):
                reference=self.client.get('/auth/context',headers=headers)
                response=self.get(headers=headers)
                self.assertEqual(response.status_code,reference.status_code)
                self.assertEqual(response.json(),reference.json())
            for setup,undo in [('UPDATE usuario SET activo=false WHERE id_usuario=101','UPDATE usuario SET activo=true WHERE id_usuario=101'),("UPDATE rol SET activo=false WHERE nombre='GESTOR'","UPDATE rol SET activo=true WHERE nombre='GESTOR'")]:
                self.admin.execute(setup)
                try:self.assertEqual(self.get().status_code,403)
                finally:self.admin.execute(undo)

        def test_empty_missing_and_pagination(self):
            self.assertEqual(self.get().json(),{'id_practica':self.identifier,'items':[],'limit':50,'offset':0,'hay_mas':False})
            self.assertEqual(self.get(identifier=999999).status_code,404)
            for query in ('?limit=0','?limit=101','?offset=-1','?offset=9223372036854775808','?id_usuario=102'):
                self.assertEqual(self.get(query=query).status_code,422)
            identifiers=[self.post().json()['id_incidencia'] for _ in range(3)]
            # Fechas iguales para verificar desempate real por ID.
            self.admin.execute("UPDATE incidencia SET fecha='2026-01-01T12:00:00Z' WHERE id_practica=%s",(self.identifier,))
            page=self.get(query='?limit=2').json()
            self.assertEqual([r['id_incidencia'] for r in page['items']],identifiers[:0:-1]);self.assertTrue(page['hay_mas'])
            last=self.get(query='?limit=2&offset=2').json()
            self.assertEqual([r['id_incidencia'] for r in last['items']],identifiers[:1]);self.assertFalse(last['hay_mas'])
            self.assertEqual(self.get(identifier=self.practice()).json()['items'],[])

        def test_finalized_legacy_preserves_values_and_resolution(self):
            legacy=self.admin.execute('SELECT id_practica FROM incidencia WHERE id_tipo_incidencia IS NULL LIMIT 1').fetchone()[0]
            before=snapshot(self.admin)
            rows=self.get(identifier=legacy).json()['items']
            self.assertEqual({r['estado'] for r in rows},{'ABIERTA','EN_REVISION','RESUELTA','CERRADA'})
            self.assertTrue(all(r['tipo'] is None and r['sin_tipo_registrado'] for r in rows))
            self.assertIn(2001,[len(r['descripcion']) for r in rows]);self.assertIn('',[r['descripcion'] for r in rows])
            self.assertTrue(all(r['resolucion'] is None for r in rows))
            self.assertEqual(before,snapshot(self.admin))
            identifier=self.post().json()['id_incidencia']
            self.admin.execute("UPDATE incidencia SET estado='RESUELTA',fecha_resolucion='2026-02-01T12:00:00Z' WHERE id_incidencia=%s",(identifier,))
            self.admin.execute("INSERT INTO historial_estado_incidencia(id_incidencia,id_usuario,estado_anterior,estado_nuevo,fecha,comentario) VALUES(%s,102,'PENDIENTE','RESUELTA','2026-02-02T12:00:00Z','Resolución sintética')",(identifier,))
            row=self.get().json()['items'][0]
            self.assertEqual(row['resolucion']['id_usuario'],102)
            self.assertEqual(row['resolucion']['comentario'],'Resolución sintética')
            self.assertNotEqual(row['fecha_resolucion'],row['resolucion']['fecha'])

        def test_transaction_read_only_blocks_authorized_write_function(self):
            dependency=restricted.get_incidencias_db();db=next(dependency)
            try:
                consultar_incidencias(db,self.identifier,101,50,0)
                self.assertEqual(db.execute(text('SHOW transaction_read_only')).scalar_one(),'on')
                with self.assertRaises(DBAPIError) as failure:
                    db.execute(text("SELECT incidencias_privadas.fn_registrar_incidencia(:id,101,'OTRO','Texto')"),{'id':self.identifier})
                self.assertEqual(failure.exception.orig.sqlstate,'25006');db.rollback()
            finally:dependency.close()
            self.assertEqual(self.get().json()['items'],[])
            self.assertEqual(self.post().status_code,201)

        def test_missing_configuration_and_denied_execute_no_fallback(self):
            with patch.object(restricted,'_factory',None),patch.object(restricted.settings,'incidencias_database_url',None):
                self.assertEqual(self.get().status_code,503)
            self.admin.execute('REVOKE EXECUTE ON FUNCTION incidencias_privadas.fn_consultar_incidencias(bigint,bigint,integer,bigint) FROM pl_ep06_executor')
            try:
                response=self.get();self.assertEqual(response.status_code,500)
                self.assertNotIn('permission denied',response.text)
            finally:self.admin.execute('GRANT EXECUTE ON FUNCTION incidencias_privadas.fn_consultar_incidencias(bigint,bigint,integer,bigint) TO pl_ep06_executor')
            self.assertEqual(self.get().status_code,200)

    return unittest.defaultTestLoader.loadTestsFromTestCase(ConsultaHttpTests)
