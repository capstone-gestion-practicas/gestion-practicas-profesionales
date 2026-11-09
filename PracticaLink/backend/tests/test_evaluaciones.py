import os
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import UUID
from unittest.mock import MagicMock, patch

os.environ.setdefault('SUPABASE_DATABASE_URL', 'postgresql+psycopg://synthetic:synthetic@localhost/synthetic')
os.environ.setdefault('JWT_SECRET_KEY', 'synthetic-unit-test-key')
from fastapi import HTTPException
from fastapi.testclient import TestClient
import jwt
from app.main import app
from app.core.config import settings
from app.core.database import get_db
from app.core.security import create_access_token
from app.informes.database import get_informe_db
from app.evaluaciones.schemas import IniciarEvaluacionRequest, ResolverEvaluacionRequest
from app.evaluaciones.service import Evaluaciones

START = '43000000-0000-0000-0000-000000000001'
RESOLVE = '43000000-0000-0000-0000-000000000002'
NOW = '2026-11-08T12:00:00+00:00'


def evaluation(**changes):
    value = {'id_evaluacion': START, 'id_practica': 430, 'id_documento': 10,
        'version': 1, 'id_docente': 432, 'estado': 'EN_CURSO', 'resultado': None,
        'observaciones': None, 'motivo': None, 'inicio': NOW, 'termino': None,
        'id_entrega': START, 'sha256': 'a' * 64, 'id_resolucion': None}
    value.update(changes)
    return value


def history_item(**changes):
    return {**evaluation(**changes), 'eventos': [{'id_evento': 1, 'id_evaluacion': START,
        'id_actor': 432, 'tipo': 'INICIADA', 'fecha': NOW, 'detalle': None}]}


def database_error(code):
    error = RuntimeError('synthetic SQL/private object/password details must never escape')
    error.orig = SimpleNamespace(sqlstate=code)
    return error


class EvaluacionServiceTests(unittest.TestCase):
    def setUp(self):
        self.db = MagicMock(); self.service = Evaluaciones(self.db)

    def test_start_uses_exact_sql_signature_actor_and_expected_document(self):
        self.db.execute.return_value.scalar_one.return_value = evaluation()
        result = self.service.iniciar(430,432,UUID(START),IniciarEvaluacionRequest(id_documento=10,version=1))
        sql, params = self.db.execute.call_args.args
        self.assertIn('informes_privados.iniciar_evaluacion', str(sql))
        self.assertEqual(params, {'p':430,'a':432,'k':START,'d':10,'v':1})
        self.assertEqual(result.id_documento,10)
        self.assertNotIn('sha256',result.model_dump()); self.assertNotIn('id_entrega',result.model_dump())
        self.db.commit.assert_called_once(); self.db.rollback.assert_not_called()

    def test_resolution_carries_idempotency_and_normalized_observations(self):
        self.db.execute.return_value.scalar_one.return_value = evaluation(estado='RESUELTA', resultado='CON_OBSERVACIONES', observaciones='Corregir', termino=NOW)
        result = self.service.resolver(430,432,UUID(RESOLVE),UUID(START), ResolverEvaluacionRequest(resultado='CON_OBSERVACIONES',observaciones='  Corregir  '))
        sql, params = self.db.execute.call_args.args
        self.assertIn('informes_privados.resolver_evaluacion',str(sql))
        self.assertEqual(params,{'p':430,'a':432,'k':RESOLVE,'eid':START,'res':'CON_OBSERVACIONES','obs':'Corregir'})
        self.assertEqual(result.resultado,'CON_OBSERVACIONES'); self.db.commit.assert_called_once()

    def test_snapshot_metadata_and_history_commit_together_without_storage(self):
        self.db.execute.return_value.scalar_one.side_effect = [
            {'id_practica':430,'id_documento':10,'version':1,'estado':'EN_EVALUACION'}, [history_item()]]
        result = self.service.consultar(430,432)
        self.assertEqual(result.evaluacion_pendiente.id_evaluacion,UUID(START))
        self.assertIsNone(result.resultado_vigente)
        self.assertEqual([c.args[1] for c in self.db.execute.call_args_list],[{'p':430,'a':432}]*2)
        self.db.commit.assert_called_once()

    def test_old_document_approval_is_history_only(self):
        self.db.execute.return_value.scalar_one.side_effect = [
            {'id_practica':430,'id_documento':11,'version':2,'estado':'ENTREGADO'},
            [history_item(estado='RESUELTA',resultado='APROBADO',termino=NOW)]]
        result = self.service.consultar(430,430)
        self.assertIsNone(result.resultado_vigente)
        self.assertEqual(result.historial[0].resultado,'APROBADO')

    def test_inconsistent_sql_response_rolls_back_before_commit(self):
        for raw in [None, {'objeto':'private/path'}, evaluation(id_practica=999),evaluation(id_docente=999),evaluation(id_documento=999),evaluation(version=2)]:
            with self.subTest(raw=raw):
                self.db.reset_mock(); self.db.execute.return_value.scalar_one.return_value = raw
                with self.assertRaises(HTTPException) as caught:
                    self.service.iniciar(430,432,UUID(START),IniciarEvaluacionRequest(id_documento=10,version=1))
                self.assertEqual(caught.exception.status_code,503)
                self.db.commit.assert_not_called(); self.db.rollback.assert_called_once()

    def test_known_sqlstates_are_safe_and_rollback_without_commit(self):
        for code,status in [('42501',403),('P0404',404),('P0409',409),('22023',400),('23505',409),('23514',409),('40P01',409),('40001',409),('55P03',409),('XX000',503)]:
            with self.subTest(code=code):
                self.db.reset_mock(); self.db.execute.side_effect = database_error(code)
                with self.assertRaises(HTTPException) as caught:
                    self.service.iniciar(430,432,UUID(START),IniciarEvaluacionRequest(id_documento=10,version=1))
                self.assertEqual(caught.exception.status_code,status)
                self.assertNotIn('synthetic SQL',str(caught.exception.detail))
                self.db.rollback.assert_called_once(); self.db.commit.assert_not_called()

    def test_failed_rollback_does_not_mask_public_error_or_leak_sql(self):
        self.db.execute.side_effect = database_error('P0409')
        self.db.rollback.side_effect = RuntimeError('sensitive rollback internals')
        with self.assertRaises(HTTPException) as caught:
            self.service.iniciar(430,432,UUID(START),IniciarEvaluacionRequest(id_documento=10,version=1))
        self.assertEqual(caught.exception.status_code,409)
        self.assertNotIn('sensitive',caught.exception.detail)
        self.db.commit.assert_not_called()

    def test_commit_failure_is_not_retried_or_reported_as_success(self):
        self.db.execute.return_value.scalar_one.return_value = evaluation()
        self.db.commit.side_effect = database_error('40001')
        with self.assertRaises(HTTPException) as error:
            self.service.iniciar(430,432,UUID(START),IniciarEvaluacionRequest(id_documento=10,version=1))
        self.assertEqual(error.exception.status_code,409)
        self.db.execute.assert_called_once(); self.db.rollback.assert_called_once()


class EvaluacionRouteTests(unittest.TestCase):
    def setUp(self):
        self.previous = dict(app.dependency_overrides)
        self.addCleanup(self.restore)
        self.private = MagicMock(); self.auth = MagicMock()
        app.dependency_overrides[get_informe_db] = lambda: self.private
        app.dependency_overrides[get_db] = lambda: self.auth
        self.roles = self.enterContext(patch('app.core.permissions.obtener_contexto_usuario',return_value={'roles':['DOCENTE']}))
        self.enterContext(patch('sqlalchemy.engine.Engine.connect',side_effect=AssertionError('Real DB forbidden')))
        self.push = self.enterContext(patch('app.services.estado_practica_service.enviar_push_notificacion'))
        self.client = self.enterContext(TestClient(app))
        self.headers = {'Authorization':'Bearer '+create_access_token(432),'Idempotency-Key':START}
        self.private.execute.return_value.scalar_one.return_value = evaluation()

    def restore(self):
        app.dependency_overrides.clear(); app.dependency_overrides.update(self.previous)

    def start(self, headers=None, body=None):
        return self.client.post('/practicas/430/evaluaciones/inicio',headers=self.headers if headers is None else headers,
                                json={'id_documento':10,'version':1} if body is None else body)

    def resolve(self, body, key=RESOLVE):
        return self.client.post('/practicas/430/evaluaciones/'+START+'/resolucion',
            headers={**self.headers,'Idempotency-Key':key},json=body)

    def test_academic_success_responses_are_no_store_on_all_endpoints(self):
        response = self.start()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get('cache-control'), 'no-store')
        self.assertEqual(response.json()['id_evaluacion'], START)
        self.private.execute.return_value.scalar_one.return_value = evaluation(
            estado='RESUELTA', resultado='APROBADO', termino=NOW)
        response = self.resolve({'resultado': 'APROBADO'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get('cache-control'), 'no-store')
        self.assertEqual(response.json()['resultado'], 'APROBADO')
        for suffix in ['', '/vigente']:
            with self.subTest(suffix=suffix):
                self.private.execute.return_value.scalar_one.side_effect = [
                    {'id_practica':430,'id_documento':10,'version':1,'estado':'EN_EVALUACION'},
                    [history_item()]]
                response = self.client.get('/practicas/430/evaluaciones'+suffix, headers=self.headers)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.headers.get('cache-control'), 'no-store')
                self.assertEqual(response.json()['version'], 1)

    def test_academic_validation_and_auth_errors_are_no_store(self):
        response = self.start(body={'id_documento': 0, 'version': 1})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.headers.get('cache-control'), 'no-store')
        response = self.start(headers={})
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.headers.get('cache-control'), 'no-store')
        self.assertEqual(response.headers.get('www-authenticate'), 'Bearer')
        self.roles.return_value = {'roles': ['ADMINISTRADOR']}
        response = self.start()
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.headers.get('cache-control'), 'no-store')
        self.private.execute.assert_not_called()

    def test_academic_sql_errors_are_no_store_without_exposing_details(self):
        for code, status in [('42501',403), ('P0404',404), ('P0409',409), ('XX000',503)]:
            for operation in ['start', 'read']:
                with self.subTest(code=code, operation=operation):
                    self.private.reset_mock()
                    self.private.execute.side_effect = database_error(code)
                    response = self.start() if operation == 'start' else self.client.get(
                        '/practicas/430/evaluaciones', headers=self.headers)
                    self.assertEqual(response.status_code, status)
                    self.assertEqual(response.headers.get('cache-control'), 'no-store')
                    self.assertNotIn('synthetic SQL', response.text)
                    self.private.rollback.assert_called_once()
                    self.private.commit.assert_not_called()

    def test_no_store_preserves_existing_exception_headers_and_body(self):
        with patch('app.evaluaciones.routes.Evaluaciones.iniciar', side_effect=HTTPException(
                429, 'Operación temporalmente limitada', headers={'Retry-After': '10', 'cache-control': 'public'})):
            response = self.start()
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.headers.get('cache-control'), 'no-store')
        self.assertEqual(response.headers.get('retry-after'), '10')
        self.assertEqual(response.json(), {'detail': 'Operación temporalmente limitada'})
        self.private.execute.assert_not_called()

    def test_academic_cache_policy_does_not_change_unrelated_routes(self):
        response = self.client.get('/openapi.json')
        self.assertEqual(response.status_code, 200)
        self.assertNotIn('cache-control', response.headers)

    def test_missing_malformed_invalid_and_expired_jwt_are_401(self):
        expired = jwt.encode({'sub':'432','exp':datetime.now(timezone.utc)-timedelta(seconds=1)},settings.jwt_secret_key,algorithm=settings.jwt_algorithm)
        for header in [{},{'Authorization':'Basic synthetic'},{'Authorization':'Bearer invalid'}, {'Authorization':'Bearer '+expired}]:
            with self.subTest(header_type=list(header)):
                self.assertEqual(self.start(headers={**header,'Idempotency-Key':START}).status_code,401)
        self.private.execute.assert_not_called()

    def test_admin_student_and_gestor_alone_cannot_evaluate(self):
        for roles in [['ADMINISTRADOR'],['ESTUDIANTE'],['GESTOR'],['ADMINISTRADOR','GESTOR']]:
            with self.subTest(roles=roles):
                self.roles.return_value = {'roles':roles}
                self.assertEqual(self.start().status_code,403)
                self.assertEqual(self.resolve({'resultado':'APROBADO'}).status_code,403)
        self.private.execute.assert_not_called()

    def test_dual_role_uses_authenticated_actor_and_private_session(self):
        self.roles.return_value = {'roles':['ADMINISTRADOR','DOCENTE']}
        response = self.start()
        self.assertEqual(response.status_code,200)
        self.assertEqual(self.private.execute.call_args.args[1]['a'],432)
        self.auth.execute.assert_not_called()
        self.assertNotIn('sha256',response.json()); self.assertNotIn('id_entrega',response.json())
        self.assertNotIn('id_resolucion',response.json())

    def test_actor_fields_are_rejected_instead_of_trusted(self):
        for key in ['id_actor','id_docente','id_evaluador']:
            response = self.start(body={'id_documento':10,'version':1,key:999})
            self.assertEqual(response.status_code,400)
        self.private.execute.assert_not_called()

    def test_result_observation_validation_and_limits(self):
        invalid = [{'resultado':'REPROBADO'}, {'resultado':'4.0'}, {'resultado':'CON_OBSERVACIONES'},
            {'resultado':'CON_OBSERVACIONES','observaciones':'\u00a0\t '},
            {'resultado':'APROBADO','observaciones':' '*2001},
            {'resultado':'APROBADO','observaciones':123}, {'resultado':'APROBADO','observaciones':'texto\x00'}, {'resultado':'APROBADO','id_docente':999}]
        for body in invalid:
            self.assertEqual(self.resolve(body).status_code,400)
        self.private.execute.assert_not_called()
        self.private.execute.return_value.scalar_one.return_value = evaluation(estado='RESUELTA',resultado='CON_OBSERVACIONES',observaciones='x'*2000,termino=NOW)
        self.assertEqual(self.resolve({'resultado':'CON_OBSERVACIONES','observaciones':'x'*2000}).status_code,200)

    def test_invalid_version_document_and_missing_key_are_400(self):
        for body in [{'id_documento':0,'version':1},{'id_documento':10,'version':0},{'id_documento':True,'version':1}]:
            self.assertEqual(self.start(body=body).status_code,400)
        self.assertEqual(self.start(headers={'Authorization':self.headers['Authorization']}).status_code,400)
        self.private.execute.assert_not_called()

    def test_start_and_resolution_retries_keep_exact_parameters_without_api_notifications(self):
        for _ in range(2):
            self.assertEqual(self.start().status_code,200)
        self.assertEqual(self.private.execute.call_args_list[0].args[1],self.private.execute.call_args_list[1].args[1])
        for result,obs in [('APROBADO',None),('CON_OBSERVACIONES','Corregir')]:
            self.private.execute.return_value.scalar_one.return_value = evaluation(estado='RESUELTA',resultado=result,observaciones=obs,termino=NOW)
            for _ in range(2):
                self.assertEqual(self.resolve({'resultado':result,'observaciones':obs}).status_code,200)
            self.assertEqual(self.private.execute.call_args_list[-1].args[1],self.private.execute.call_args_list[-2].args[1])
        self.assertTrue(all('notificacion' not in str(call.args[0]) for call in self.private.execute.call_args_list))
        self.push.assert_not_called()

    def test_assignment_version_idempotency_and_finalized_conflicts_follow_sql(self):
        for code,status in [('42501',403),('P0409',409),('23505',409),('40P01',409),('22023',400),('XX000',503)]:
            with self.subTest(code=code):
                self.private.reset_mock(); self.private.execute.side_effect = database_error(code)
                response = self.resolve({'resultado':'APROBADO'})
                self.assertEqual(response.status_code,status)
                self.assertNotIn('synthetic SQL',response.text)
                self.private.rollback.assert_called_once(); self.private.commit.assert_not_called()

    def test_sql_denies_unassigned_and_self_evaluating_docente_even_after_guard(self):
        for scenario in ['unassigned','self evaluation','closed practice','inactive after guard']:
            with self.subTest(scenario=scenario):
                self.private.reset_mock(); self.private.execute.side_effect = database_error('42501')
                self.assertEqual(self.start().status_code,403)
                self.private.commit.assert_not_called()

    def test_read_current_and_history_authorized_roles_and_stale_results(self):
        for roles in [['ESTUDIANTE'],['GESTOR'],['DOCENTE'],['ADMINISTRADOR','GESTOR']]:
            self.roles.return_value = {'roles':roles}
            self.private.execute.return_value.scalar_one.side_effect = [
                {'id_practica':430,'id_documento':11,'version':2,'estado':'ENTREGADO'},
                [history_item(estado='RESUELTA',resultado='APROBADO',termino=NOW)]]
            response = self.client.get('/practicas/430/evaluaciones',headers=self.headers)
            self.assertEqual(response.status_code,200)
            self.assertIsNone(response.json()['resultado_vigente'])
            self.assertEqual(response.json()['historial'][0]['resultado'],'APROBADO')
        self.private.execute.return_value.scalar_one.side_effect = None
        self.roles.return_value = {'roles':['ADMINISTRADOR']}
        self.private.reset_mock()
        self.assertEqual(self.client.get('/practicas/430/evaluaciones',headers=self.headers).status_code,403)
        self.private.execute.assert_not_called()

    def test_current_endpoint_omits_history_and_storage_internals(self):
        self.private.execute.return_value.scalar_one.side_effect = [
            {'id_practica':430,'id_documento':10,'version':1,'estado':'EN_EVALUACION'}, [history_item()]]
        response = self.client.get('/practicas/430/evaluaciones/vigente',headers=self.headers)
        self.assertEqual(response.status_code,200)
        self.assertNotIn('historial',response.json()); self.assertNotIn('sha256',response.text)

    def test_read_denial_from_sql_is_preserved_and_rolled_back(self):
        for code,status in [('42501',403),('P0404',404)]:
            self.private.reset_mock(); self.private.execute.side_effect = database_error(code)
            response = self.client.get('/practicas/430/evaluaciones',headers=self.headers)
            self.assertEqual(response.status_code,status)
            self.private.rollback.assert_called_once(); self.private.commit.assert_not_called()

    def test_closure_uses_private_executor_and_retains_public_contract(self):
        self.roles.return_value = {'roles':['GESTOR','ADMINISTRADOR']}
        self.private.execute.return_value.scalar_one.return_value = {'id_practica':430,'id_cierre':1,'id_historial':2,
            'estado':'FINALIZADA','fecha_cierre':NOW,'mensaje':'La práctica se finalizó correctamente',
            'id_notificacion':3,'id_usuario_notificado':430}
        response = self.client.post('/practicas/430/cierre',headers=self.headers,json={})
        self.assertEqual(response.status_code,200)
        self.assertIn('public.fn_cerrar_practica',str(self.private.execute.call_args.args[0]))
        self.private.commit.assert_called_once(); self.auth.execute.assert_not_called()
        self.push.assert_called_once_with(self.auth,3,430)

    def test_closure_denies_admin_or_missing_approval_and_never_pushes(self):
        self.roles.return_value = {'roles':['ADMINISTRADOR']}
        self.assertEqual(self.client.post('/practicas/430/cierre',headers=self.headers,json={}).status_code,403)
        self.private.execute.assert_not_called()
        self.roles.return_value = {'roles':['GESTOR']}
        for code,status in [('P0409',409),('42501',403)]:
            self.private.reset_mock(); self.private.execute.side_effect = database_error(code)
            self.assertEqual(self.client.post('/practicas/430/cierre',headers=self.headers,json={}).status_code,status)
            self.private.rollback.assert_called_once(); self.private.commit.assert_not_called()
        self.push.assert_not_called()

    def test_openapi_documents_400_validation_for_new_routes(self):
        operation = app.openapi()['paths']['/practicas/{id_practica}/evaluaciones/inicio']['post']
        self.assertIn('400',operation['responses'])
        self.assertNotIn('422',operation['responses'])

    def test_assignment_forbids_student_docente_and_long_reasons(self):
        self.roles.return_value = {'roles':['GESTOR']}
        # Data validation occurs before the assignment service; no provider is opened.
        from app.core.database import get_docente_assignment_db
        assignment_db = MagicMock()
        app.dependency_overrides[get_docente_assignment_db] = lambda: assignment_db
        response = self.client.put('/docente/practicas/430/asignacion',headers=self.headers,json={'id_docente':430,'motivo':' '*2001})
        self.assertEqual(response.status_code,422); assignment_db.execute.assert_not_called()
        assignment_db.execute.return_value.scalar_one.return_value = {'error':'DOCENTE_IGUAL_ESTUDIANTE'}
        response = self.client.put('/docente/practicas/430/asignacion',headers=self.headers,json={'id_docente':430,'motivo':'Cambio'})
        self.assertEqual(response.status_code,409); assignment_db.commit.assert_not_called()
