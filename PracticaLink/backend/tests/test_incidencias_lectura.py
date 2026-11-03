import os
import unittest
from unittest.mock import MagicMock, patch
os.environ.setdefault('SUPABASE_DATABASE_URL','postgresql+psycopg://principal:synthetic@localhost/test')
os.environ.setdefault('JWT_SECRET_KEY','synthetic-unit-secret')
from fastapi.testclient import TestClient
from app.main import app
from app.core.database import get_db
from app.core.incidencias_database import get_incidencias_db
from app.core.security import create_access_token
from app.incidencias.service import consultar_incidencias, ConsultaIncidenciasError
from tests.test_incidencias_service import fallo_sql


def item(identifier=9):
    return {'id_incidencia':identifier,'id_practica':15,'id_usuario':102,
            'fecha':'2026-01-02T12:00:00Z','tipo':None,'descripcion':'',
            'estado':'ABIERTA','sin_tipo_registrado':True,
            'fecha_resolucion':None,'resolucion':None}


def result():
    return {'id_practica':15,'items':[item(),{**item(8),'descripcion':'x'*2001,'estado':'CERRADA'}],
            'limit':50,'offset':0,'hay_mas':False}


class LecturaTests(unittest.TestCase):
    def setUp(self):
        previous=dict(app.dependency_overrides)
        self.addCleanup(lambda: (app.dependency_overrides.clear(),app.dependency_overrides.update(previous)))
        self.db=MagicMock()
        self.main=MagicMock()
        self.db.execute.return_value.scalar_one.return_value=result()
        self.open=MagicMock(return_value=self.db)
        def read(): return self.open()
        app.dependency_overrides[get_db]=lambda:self.main
        app.dependency_overrides[get_incidencias_db]=read
        self.context=self.enterContext(patch('app.core.permissions.obtener_contexto_usuario',return_value={'usuario':{'id_usuario':101},'roles':['GESTOR']}))
        self.enterContext(patch('sqlalchemy.engine.Engine.connect',side_effect=AssertionError('Red prohibida')))
        self.enterContext(patch('socket.create_connection',side_effect=AssertionError('Red prohibida')))
        self.client=self.enterContext(TestClient(app))
        self.headers={'Authorization':'Bearer '+create_access_token(101)}

    def get(self, query='', headers=None):
        return self.client.get('/practicas/15/incidencias'+query,headers=self.headers if headers is None else headers)

    def test_roles_historical_contract_order_and_bound_identity(self):
        for role in ('GESTOR','ADMINISTRADOR'):
            self.context.return_value['roles']=[role]
            response=self.get()
            self.assertEqual(response.status_code,200)
            self.assertEqual(response.json(),result())
        self.assertEqual(self.db.execute.call_args.args[1],{'id_practica':15,'id_usuario':101,'limit':50,'offset':0})
        self.db.commit.assert_not_called()
        self.main.execute.assert_not_called()

    def test_denied_and_invalid_jwt_before_open(self):
        for context in (None,{'roles':['ESTUDIANTE']},{'usuario':{'id_usuario':999},'roles':['GESTOR']}):
            self.context.return_value=context
            self.assertEqual(self.get().status_code,403)
        for headers in ({},{'Authorization':'Bearer invalid'}):
            self.assertIn(self.get(headers=headers).status_code,(401,403))
        self.open.assert_not_called()

    def test_limits_and_no_client_identity(self):
        for query in ('?limit=0','?limit=101','?offset=-1','?offset=9223372036854775808','?limit=x','?id_usuario=102'):
            self.assertEqual(self.get(query).status_code,422)
        self.db.execute.assert_not_called()
        self.db.execute.return_value.scalar_one.return_value={**result(),'items':[],'limit':100,'offset':10}
        self.assertEqual(self.get('?limit=100&offset=10').status_code,200)

    def test_empty_history(self):
        self.db.execute.return_value.scalar_one.return_value={**result(),'items':[]}
        self.assertEqual(self.get().json()['items'],[])

    def test_sql_errors_and_rollback(self):
        for code,status in [('USUARIO_NO_AUTORIZADO',403),('PRACTICA_NO_ENCONTRADA',404),('PAGINACION_INVALIDA',422),('secret',500)]:
            self.db.execute.return_value.scalar_one.return_value={'error':code}
            response=self.get()
            self.assertEqual(response.status_code,status)
            self.assertNotIn(code,response.text)
        self.db.execute.side_effect=fallo_sql('08006')
        self.assertEqual(self.get().status_code,503)
        self.db.execute.side_effect=fallo_sql('42501')
        self.assertEqual(self.get().status_code,500)
        self.db.commit.assert_not_called()
        self.assertEqual(self.db.rollback.call_count,6)

    def test_malformed_response_sanitized(self):
        for data in (None,{}, {'error':[]}, {**result(),'id_practica':16},
                     {**result(),'hay_mas':'false'}, {**result(),'offset':1},
                     {**result(),'extra':'secret'}, {**result(),'items':[{**item(),'id_practica':16}]},
                     {**result(),'items':[{**item(),'fecha':'invalid'}]},
                     {**result(),'limit':1}, {**result(),'hay_mas':True},
                     {'error':'PRACTICA_NO_ENCONTRADA','extra':'secret'}):
            self.db.execute.return_value.scalar_one.return_value=data
            self.assertEqual(self.get().status_code,500)
        self.db.commit.assert_not_called()

    def test_no_configuration_no_fallback(self):
        del app.dependency_overrides[get_incidencias_db]
        with patch('app.core.incidencias_database._factory',None), patch('app.core.incidencias_database.settings') as config:
            config.incidencias_database_url=None
            self.assertEqual(self.get().status_code,503)
        self.db.execute.assert_not_called()

    def test_context_connection_failure(self):
        self.context.side_effect=fallo_sql()
        self.assertEqual(self.get().status_code,503)
        self.open.assert_not_called()

    def test_failed_rollback_preserves_business_error(self):
        self.db.execute.return_value.scalar_one.return_value={'error':'PRACTICA_NO_ENCONTRADA'}
        self.db.rollback.side_effect=fallo_sql()
        with self.assertRaises(ConsultaIncidenciasError) as error:
            consultar_incidencias(self.db,15,101,50,0)
        self.assertEqual(error.exception.codigo,'PRACTICA_NO_ENCONTRADA')


    def test_read_only_before_function_no_commit_or_reordering(self):
        response=self.get()
        self.assertEqual(response.status_code,200)
        queries=[str(call.args[0]) for call in self.db.execute.call_args_list]
        self.assertEqual(queries[0],'SET TRANSACTION READ ONLY')
        self.assertIn('incidencias_privadas.fn_consultar_incidencias(',queries[1])
        self.assertEqual(len(queries),2)
        self.assertEqual([r['id_incidencia'] for r in response.json()['items']],[9,8])
        self.db.commit.assert_not_called()

    def test_resolution_nullable_and_original_dates(self):
        original={**item(),'fecha_resolucion':'2026-01-03T12:00:00Z',
                  'resolucion':{'id_historial':1,'id_usuario':101,'fecha':'2026-01-04T12:00:00Z','comentario':'Texto'}}
        self.db.execute.return_value.scalar_one.return_value={**result(),'items':[original]}
        self.assertEqual(self.get().json()['items'],[original])
        self.db.execute.return_value.scalar_one.return_value={**result(),'items':[{**item(),'fecha':'infinity'}]}
        self.assertEqual(self.get().json()['items'][0]['fecha'],'infinity')

    def test_invalid_path_before_sql(self):
        for identifier in ('0','-1','abc','9223372036854775808'):
            response=self.client.get(f'/practicas/{identifier}/incidencias',headers=self.headers)
            self.assertEqual(response.status_code,422)
        self.db.execute.assert_not_called()
