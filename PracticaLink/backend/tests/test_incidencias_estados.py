import os
import unittest
from unittest.mock import MagicMock, patch

os.environ.setdefault('SUPABASE_DATABASE_URL','postgresql+psycopg://principal:synthetic@localhost/test')
os.environ.setdefault('JWT_SECRET_KEY','synthetic-unit-secret')
from fastapi.testclient import TestClient
from pydantic import ValidationError
from app.main import app
from app.core.database import get_db
from app.core.incidencias_database import get_incidencias_db
from app.core.security import create_access_token
from app.incidencias.schemas import IncidenciaEstadoRequest
from tests.test_incidencias_service import fallo_sql

BASE='/practicas/15/incidencias/42'
BODY={'estado_esperado':'PENDIENTE','estado_nuevo':'EN_ATENCION'}
RESULT={'id_practica':15,'id_incidencia':42,'id_historial':9,'id_usuario':101,
        'estado_anterior':'PENDIENTE','estado_nuevo':'EN_ATENCION','comentario':None,
        'fecha':'2026-11-01T15:00:00Z'}
PAGE={'id_practica':15,'id_incidencia':42,'items':[
    {'id_historial':9,'id_usuario':102,'estado_anterior':'PENDIENTE','estado_nuevo':'EN_ATENCION',
     'fecha':'2026-11-01T15:00:00Z','comentario':'x'*2001},
    {'id_historial':8,'id_usuario':101,'estado_anterior':None,'estado_nuevo':'PENDIENTE',
     'fecha':'infinity','comentario':None}], 'limit':50,'offset':0,'hay_mas':False}


class EstadoTests(unittest.TestCase):
    def setUp(self):
        previous=dict(app.dependency_overrides)
        self.addCleanup(lambda: (app.dependency_overrides.clear(),app.dependency_overrides.update(previous)))
        self.db=MagicMock()
        self.main=MagicMock()
        self.open=MagicMock(return_value=self.db)
        app.dependency_overrides[get_db]=lambda:self.main
        app.dependency_overrides[get_incidencias_db]=lambda:self.open()
        self.context=self.enterContext(patch('app.core.permissions.obtener_contexto_usuario',
            return_value={'usuario':{'id_usuario':101},'roles':['GESTOR']}))
        self.enterContext(patch('sqlalchemy.engine.Engine.connect',side_effect=AssertionError('Red prohibida')))
        self.enterContext(patch('socket.create_connection',side_effect=AssertionError('Red prohibida')))
        self.client=self.enterContext(TestClient(app))
        self.headers={'Authorization':'Bearer '+create_access_token(101)}
        self.db.execute.return_value.scalar_one.return_value=RESULT

    def patch(self, body=None, headers=None, suffix=''):
        return self.client.patch(BASE+'/estado'+suffix,json=BODY if body is None else body,
                                 headers=self.headers if headers is None else headers)

    def get(self, suffix='', headers=None):
        return self.client.get(BASE+'/historial'+suffix,headers=self.headers if headers is None else headers)

    def test_roles_identity_bound_and_commit(self):
        for role in ('GESTOR','ADMINISTRADOR'):
            self.context.return_value['roles']=[role]
            self.assertEqual(self.patch().status_code,200)
        args=self.db.execute.call_args.args
        self.assertIn('fn_cambiar_estado_incidencia',str(args[0]))
        self.assertEqual(args[1],{'id_practica':15,'id_incidencia':42,'id_usuario':101,**BODY,'comentario':None})
        self.assertEqual(self.db.commit.call_count,2)
        self.main.execute.assert_not_called()
        self.db.rollback.assert_not_called()

    def test_denied_inactive_wrong_identity_and_jwt_before_connection(self):
        for ctx in (None,{'usuario':{'id_usuario':101},'roles':['ESTUDIANTE']},
                    {'usuario':{'id_usuario':999},'roles':['GESTOR']},
                    {'usuario':{'id_usuario':101},'roles':[]}):
            self.context.return_value=ctx
            self.assertEqual(self.patch().status_code,403)
            self.assertEqual(self.get().status_code,403)
        for headers in ({},{'Authorization':'Bearer invalid'}):
            self.assertIn(self.patch(headers=headers).status_code,(401,403))
            self.assertIn(self.get(headers=headers).status_code,(401,403))
        self.open.assert_not_called()

    def test_all_three_transitions_and_normalization(self):
        for origin,dest in [('PENDIENTE','EN_ATENCION'),('PENDIENTE','RESUELTA'),('EN_ATENCION','RESUELTA')]:
            self.db.execute.return_value.scalar_one.return_value={**RESULT,'estado_anterior':origin,
                'estado_nuevo':dest,'comentario':'Texto'}
            response=self.patch({'estado_esperado':origin,'estado_nuevo':dest,'comentario':'  Texto  '})
            self.assertEqual(response.status_code,200)
            self.assertEqual(response.json()['comentario'],'Texto')
            self.assertEqual(self.db.execute.call_args.args[1]['comentario'],'Texto')

    def test_comments_states_and_extra_fields_invalid(self):
        bodies=[{**BODY,'comentario':v} for v in (99,'x'*2001,'😀'*2001)]
        bodies += [{**BODY,'estado_nuevo':'RESUELTA','comentario':v} for v in (None,'','  ','\t\n')]
        bodies += [{**BODY,k:v} for k,v in [('estado_nuevo','ABIERTA'),('estado_esperado','INVALIDO'),
            ('id_usuario',102),('fecha','2026-01-01'),('prioridad','ALTA')]]
        for body in bodies:self.assertEqual(self.patch(body).status_code,422)
        self.assertEqual(self.patch(suffix='?id_usuario=102').status_code,422)
        self.db.execute.assert_not_called()

    def test_unicode_boundary_and_optional_whitespace(self):
        data=IncidenciaEstadoRequest(**BODY,comentario='  '+'😀'*2000+'  ')
        self.assertEqual(data.comentario,'😀'*2000)
        for value in (None,'','   ','\t\n'):
            self.assertIsNone(IncidenciaEstadoRequest(**BODY,comentario=value).comentario)
        with self.assertRaises(ValidationError):
            IncidenciaEstadoRequest(estado_esperado='PENDIENTE',estado_nuevo='RESUELTA')

    def test_all_sql_business_mappings(self):
        mappings={'USUARIO_NO_AUTORIZADO':403,'PRACTICA_NO_ENCONTRADA':404,
          'INCIDENCIA_NO_ENCONTRADA':404,'IDENTIFICADOR_INVALIDO':422,'ESTADO_INVALIDO':422,
          'COMENTARIO_INVALIDO':422,'INCIDENCIA_NO_GESTIONABLE':409,'ESTADO_DESACTUALIZADO':409,
          'TRANSICION_NO_PERMITIDA':409,'HISTORIAL_INCONSISTENTE':409,'internal-secret':500}
        for code,status in mappings.items():
            self.db.execute.return_value.scalar_one.return_value={'error':code}
            response=self.patch()
            self.assertEqual(response.status_code,status)
            self.assertNotIn(code,response.text)
        self.db.commit.assert_not_called()
        self.assertEqual(self.db.rollback.call_count,len(mappings))

    def test_invalid_sql_responses_rollback_before_commit(self):
        for response in (None,{},[],{'error':[]},{'error':'ESTADO_INVALIDO','extra':'secret'},
            *[{**RESULT,k:v} for k,v in [('id_usuario',102),('id_practica',16),('id_incidencia',43),
              ('id_historial',0),('estado_anterior','EN_ATENCION'),('estado_nuevo','RESUELTA'),
              ('comentario','unexpected'),('fecha','invalid'),('extra','secret')]]):
            self.db.execute.return_value.scalar_one.return_value=response
            self.assertEqual(self.patch().status_code,500)
        self.db.commit.assert_not_called()

    def test_commit_failure_no_success_and_no_retry(self):
        for code,status in [('08006',503),('40P01',409),(None,500)]:
            self.db.reset_mock()
            self.db.commit.side_effect=fallo_sql(code)
            response=self.patch()
            self.assertEqual(response.status_code,status)
            self.db.execute.assert_called_once()
            self.db.commit.assert_called_once()
            self.db.rollback.assert_called_once()
            self.assertNotIn('SQL interno',response.text)

    def test_sql_exception_concurrency_connection_and_rollback_failure(self):
        for code,status in [('40001',409),('40P01',409),('55P03',409),('08006',503),('42501',500)]:
            self.db.reset_mock()
            self.db.execute.side_effect=fallo_sql(code)
            self.db.rollback.side_effect=fallo_sql()
            self.assertEqual(self.patch().status_code,status)
            self.db.execute.assert_called_once()
            self.db.commit.assert_not_called()
            self.db.rollback.assert_called_once()

    def test_no_config_or_connection_and_no_fallback(self):
        del app.dependency_overrides[get_incidencias_db]
        with patch('app.core.incidencias_database._factory',None),patch('app.core.incidencias_database.settings') as config:
            config.incidencias_database_url=None
            self.assertEqual(self.patch().status_code,503)
            self.assertEqual(self.get().status_code,503)
        self.main.execute.assert_not_called()
        self.db.execute.assert_not_called()

    def test_context_connection_failure(self):
        self.context.side_effect=fallo_sql()
        self.assertEqual(self.patch().status_code,503)
        self.assertEqual(self.get().status_code,503)
        self.open.assert_not_called()

    def test_get_historical_fields_order_read_only(self):
        self.db.execute.return_value.scalar_one.return_value=PAGE
        self.assertEqual(self.get().json(),PAGE)
        calls=self.db.execute.call_args_list
        self.assertEqual(str(calls[0].args[0]),'SET TRANSACTION READ ONLY')
        self.assertIn('fn_consultar_historial_incidencia',str(calls[1].args[0]))
        self.assertEqual(calls[1].args[1],{'id_practica':15,'id_incidencia':42,'id_usuario':101,'limit':50,'offset':0})
        self.assertEqual(len(calls),2)
        self.db.commit.assert_not_called()

    def test_get_empty_and_pagination(self):
        self.db.execute.return_value.scalar_one.return_value={**PAGE,'items':[],'limit':100,'offset':10}
        self.assertEqual(self.get('?limit=100&offset=10').json()['items'],[])
        self.db.reset_mock()
        for query in ('?limit=0','?limit=101','?offset=-1','?offset=9223372036854775808','?limit=x','?id_usuario=102'):
            self.assertEqual(self.get(query).status_code,422)
        self.db.execute.assert_not_called()

    def test_invalid_paths(self):
        for invalid in ('0','-1','abc','9223372036854775808'):
            for base in (f'/practicas/{invalid}/incidencias/42',f'/practicas/15/incidencias/{invalid}'):
                self.assertEqual(self.client.patch(base+'/estado',json=BODY,headers=self.headers).status_code,422)
                self.assertEqual(self.client.get(base+'/historial',headers=self.headers).status_code,422)
        self.db.execute.assert_not_called()

    def test_get_errors_and_no_commit(self):
        for code,status in [('USUARIO_NO_AUTORIZADO',403),('PRACTICA_NO_ENCONTRADA',404),
            ('INCIDENCIA_NO_ENCONTRADA',404),('PAGINACION_INVALIDA',422),
            ('HISTORIAL_INCONSISTENTE',500),('secret',500)]:
            self.db.execute.return_value.scalar_one.return_value={'error':code}
            self.assertEqual(self.get().status_code,status)
        self.db.execute.side_effect=fallo_sql('08006')
        self.assertEqual(self.get().status_code,503)
        self.db.commit.assert_not_called()

    def test_get_malformed_or_mismatched_result(self):
        for value in (None,{}, {'error':[]},{**PAGE,'id_incidencia':43},{**PAGE,'id_practica':16},
            {**PAGE,'limit':1},{**PAGE,'offset':1},{**PAGE,'hay_mas':True},
            {**PAGE,'items':list(reversed(PAGE['items']))},
            {**PAGE,'items':[PAGE['items'][0],PAGE['items'][0]]},
            {**PAGE,'hay_mas':'false'},{**PAGE,'extra':'secret'}):
            self.db.execute.return_value.scalar_one.return_value=value
            self.assertEqual(self.get().status_code,500)
        self.db.commit.assert_not_called()
