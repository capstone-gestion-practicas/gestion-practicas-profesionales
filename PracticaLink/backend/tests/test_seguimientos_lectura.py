import os
import unittest
from unittest.mock import MagicMock, patch
os.environ.setdefault('SUPABASE_DATABASE_URL','postgresql+psycopg://principal:synthetic@localhost/test')
os.environ.setdefault('JWT_SECRET_KEY','synthetic-unit-secret')
from fastapi.testclient import TestClient
from app.main import app
from app.core.database import get_db
from app.core.seguimientos_lectura_database import get_seguimientos_lectura_db
from app.core.security import create_access_token
from app.seguimientos.service import consultar_seguimientos, ConsultaSeguimientosError
from tests.test_seguimientos_service import fallo_sql


def result():
    return {'id_practica':15,'items':[
        {'id_seguimiento':9,'fecha':'2026-01-02','tipo':None,'observacion':'',
         'responsable':{'id_usuario':102,'nombre':'Responsable inactivo'}},
        {'id_seguimiento':8,'fecha':'2026-01-01','tipo':'Antiguo','observacion':'x'*2001,
         'responsable':{'id_usuario':101,'nombre':'Nombre actual'}}],
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
        app.dependency_overrides[get_seguimientos_lectura_db]=read
        self.context=self.enterContext(patch('app.core.permissions.obtener_contexto_usuario',return_value={'usuario':{'id_usuario':101},'roles':['GESTOR']}))
        self.client=self.enterContext(TestClient(app))
        self.headers={'Authorization':'Bearer '+create_access_token(101)}

    def get(self, query='', headers=None):
        return self.client.get('/practicas/15/seguimientos'+query,headers=self.headers if headers is None else headers)

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
                     {**result(),'extra':'secret'}):
            self.db.execute.return_value.scalar_one.return_value=data
            self.assertEqual(self.get().status_code,500)
        self.db.commit.assert_not_called()

    def test_no_configuration_no_fallback(self):
        del app.dependency_overrides[get_seguimientos_lectura_db]
        with patch('app.core.seguimientos_lectura_database._factory',None), patch('app.core.seguimientos_lectura_database.settings') as config:
            config.seguimientos_lectura_database_url=None
            self.assertEqual(self.get().status_code,503)
        self.db.execute.assert_not_called()

    def test_context_connection_failure(self):
        self.context.side_effect=fallo_sql()
        self.assertEqual(self.get().status_code,503)
        self.open.assert_not_called()

    def test_failed_rollback_preserves_business_error(self):
        self.db.execute.return_value.scalar_one.return_value={'error':'PRACTICA_NO_ENCONTRADA'}
        self.db.rollback.side_effect=fallo_sql()
        with self.assertRaises(ConsultaSeguimientosError) as error:
            consultar_seguimientos(self.db,15,101,50,0)
        self.assertEqual(error.exception.codigo,'PRACTICA_NO_ENCONTRADA')
