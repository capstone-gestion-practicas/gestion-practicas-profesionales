import os
import unittest
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

os.environ.setdefault('SUPABASE_DATABASE_URL', 'postgresql+psycopg://user:password@localhost:5432/practicalink_test')
os.environ.setdefault('JWT_SECRET_KEY', 'unit-test-secret')

from fastapi.testclient import TestClient
from app.core.database import get_db
from app.core.security import get_current_user_id
from app.main import app
from app.practicas.service import obtener_historial_practica
from app.practicas.routes import router


def evento(identifier=1, anterior=None, nuevo=1, observacion=None):
    nombres = {1: 'REGISTRADA', 3: 'OBSERVADA', 4: 'APROBADA'}
    return {
        'id_historial': identifier, 'id_estado_anterior': anterior,
        'estado_anterior_nombre': nombres.get(anterior), 'id_estado': nuevo,
        'estado_nuevo_nombre': nombres[nuevo],
        'fecha_cambio': datetime(2026, 10, 17, 12, 30, tzinfo=timezone.utc),
        'id_usuario': 42, 'responsable_nombre': 'Responsable sintético', 'observacion': observacion,
    }


class HistorialPracticaTests(unittest.TestCase):
    def setUp(self):
        self.overrides = dict(app.dependency_overrides)
        self.addCleanup(self.restore_overrides)
        self.db = MagicMock()
        self.db.execute.return_value.mappings.return_value.first.return_value = {'id_practica': 15}
        self.db.execute.return_value.mappings.return_value.all.return_value = []
        app.dependency_overrides[get_db] = lambda: self.db
        app.dependency_overrides[get_current_user_id] = lambda: 123
        self.contexto = self.enterContext(patch('app.core.permissions.obtener_contexto_usuario', return_value={'roles': ['GESTOR']}))
        self.enterContext(patch('sqlalchemy.engine.Engine.connect', side_effect=AssertionError('Conexión real prohibida')))
        self.enterContext(patch('socket.create_connection', side_effect=AssertionError('Red prohibida')))
        self.client = self.enterContext(TestClient(app))

    def restore_overrides(self):
        app.dependency_overrides.clear()
        app.dependency_overrides.update(self.overrides)

    def test_gestor_and_administrador_can_read_empty_history(self):
        for rol in ['GESTOR', 'ADMINISTRADOR']:
            with self.subTest(rol=rol):
                self.contexto.return_value = {'roles': [rol]}
                response = self.client.get('/practicas/15/historial')
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json(), {'id_practica': 15, 'items': [], 'limit': 50, 'offset': 0, 'hay_mas': False})
                self.contexto.assert_called_with(db=self.db, id_usuario=123)

    def test_estudiante_is_denied_before_data_queries(self):
        self.contexto.return_value = {'roles': ['ESTUDIANTE']}
        self.assertEqual(self.client.get('/practicas/15/historial').status_code, 403)
        self.db.execute.assert_not_called()

    def test_missing_and_invalid_authentication_preserve_existing_behavior(self):
        del app.dependency_overrides[get_current_user_id]
        for headers in [{}, {'Authorization': 'Bearer invalid-token'}]:
            with self.subTest(headers=headers):
                previous = self.client.get('/practicas/me', headers=headers)
                response = self.client.get('/practicas/15/historial', headers=headers)
                self.assertIn(response.status_code, (401, 403))
                self.assertEqual(response.status_code, previous.status_code)
                self.assertEqual(response.json(), previous.json())
        self.db.execute.assert_not_called()
        self.contexto.assert_not_called()

    def test_missing_practice_returns_404_without_querying_history(self):
        self.db.execute.return_value.mappings.return_value.first.return_value = None
        response = self.client.get('/practicas/15/historial')
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json(), {'detail': 'La práctica no existe'})
        self.db.execute.assert_called_once()

    def test_invalid_identifier_and_pagination_do_not_reach_service(self):
        for identifier, params in [('abc', {}), ('0', {}), ('-1', {}), ('1.5', {}), ('9223372036854775808', {}), ('15', {'limit': 0}), ('15', {'limit': 101}), ('15', {'limit': 'abc'}), ('15', {'offset': -1}), ('15', {'offset': 'abc'})]:
            with self.subTest(identifier=identifier, params=params):
                self.assertEqual(self.client.get(f'/practicas/{identifier}/historial', params=params).status_code, 422)
        self.db.execute.assert_not_called()

    def test_first_available_event_serializes_without_previous_state(self):
        self.db.execute.return_value.mappings.return_value.all.return_value = [evento(observacion='Registro inicial de la práctica')]
        response = self.client.get('/practicas/15/historial')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['items'], [{
            'id_historial': 1, 'estado_anterior': None,
            'estado_nuevo': {'id_estado': 1, 'nombre': 'REGISTRADA'},
            'fecha_cambio': '2026-10-17T12:30:00Z',
            'responsable': {'id_usuario': 42, 'nombre': 'Responsable sintético'},
            'observacion': 'Registro inicial de la práctica',
        }])

    def test_successive_repeated_states_equal_dates_and_null_observations_are_preserved(self):
        self.db.execute.return_value.mappings.return_value.all.return_value = [evento(), evento(2, 1, 3, 'Revisión sintética'), evento(3, 3, 3)]
        items = self.client.get('/practicas/15/historial').json()['items']
        self.assertEqual([x['id_historial'] for x in items], [1, 2, 3])
        self.assertEqual(items[1]['estado_anterior'], items[0]['estado_nuevo'])
        self.assertEqual(items[2]['estado_anterior'], items[2]['estado_nuevo'])
        self.assertEqual(items[0]['fecha_cambio'], items[2]['fecha_cambio'])
        self.assertEqual(items[1]['observacion'], 'Revisión sintética')
        self.assertIsNone(items[2]['observacion'])

    def test_history_without_registration_does_not_fabricate_initial_event(self):
        self.db.execute.return_value.mappings.return_value.all.return_value = [evento(20, None, 3)]
        item = self.client.get('/practicas/15/historial').json()['items'][0]
        self.assertEqual(item['id_historial'], 20)
        self.assertIsNone(item['estado_anterior'])
        self.assertEqual(item['estado_nuevo']['nombre'], 'OBSERVADA')
        self.assertNotIn('es_inicial', item)

    def test_previous_state_on_later_page_is_kept_and_extra_row_is_trimmed(self):
        self.db.execute.return_value.mappings.return_value.all.return_value = [evento(3, 3, 4), evento(4, 4, 3)]
        response = self.client.get('/practicas/15/historial', params={'limit': 1, 'offset': 2})
        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertEqual(len(result['items']), 1)
        self.assertEqual(result['items'][0]['estado_anterior'], {'id_estado': 3, 'nombre': 'OBSERVADA'})
        self.assertEqual((result['limit'], result['offset'], result['hay_mas']), (1, 2, True))
        self.assertEqual(self.db.execute.call_args.args[1], {'id_practica': 15, 'limit': 2, 'offset': 2})

    def test_exact_page_and_beyond_history_have_no_more_results(self):
        for rows in [[evento()], []]:
            with self.subTest(rows=len(rows)):
                self.db.execute.return_value.mappings.return_value.all.return_value = rows
                result = obtener_historial_practica(self.db, 15, limit=1, offset=10)
                self.assertFalse(result['hay_mas'])
                self.assertEqual(len(result['items']), len(rows))

    def test_sql_is_parameterized_and_lag_precedes_pagination_without_writes(self):
        obtener_historial_practica(self.db, 15, limit=100, offset=50)
        self.assertEqual(self.db.execute.call_count, 2)
        existence, history = self.db.execute.call_args_list
        self.assertEqual(existence.args[1], {'id_practica': 15})
        sql = ' '.join(str(history.args[0]).split())
        self.assertEqual(history.args[1], {'id_practica': 15, 'limit': 101, 'offset': 50})
        self.assertIn('LAG(h.id_estado) OVER ( PARTITION BY h.id_practica ORDER BY h.fecha_cambio ASC, h.id_historial ASC )', sql)
        self.assertIn('WHERE h.id_practica = :id_practica', sql)
        self.assertIn('LEFT JOIN estado_practica anterior', sql)
        self.assertIn('ORDER BY s.fecha_cambio ASC, s.id_historial ASC LIMIT :limit OFFSET :offset', sql)
        cte = sql.split('FROM secuencia s')[0]
        self.assertNotIn('LIMIT', cte)
        self.assertNotIn('OFFSET', cte)
        for call in self.db.execute.call_args_list:
            query = str(call.args[0]).upper()
            for forbidden in ['INSERT ', 'UPDATE ', 'DELETE ', 'FOR UPDATE', 'DISTINCT', 'U.ACTIVO', 'CORREO', 'TELEFONO', 'RUT', 'ID_ESTADO_ACTUAL']:
                self.assertNotIn(forbidden, query)
        self.db.commit.assert_not_called()
        self.db.rollback.assert_not_called()
        self.db.flush.assert_not_called()

    def test_output_contains_only_approved_fields(self):
        record = evento()
        record.update(rut='dato excluido', correo='test@example.com', telefono='dato excluido')
        self.db.execute.return_value.mappings.return_value.all.return_value = [record]
        item = self.client.get('/practicas/15/historial').json()['items'][0]
        self.assertEqual(set(item), {'id_historial', 'estado_anterior', 'estado_nuevo', 'fecha_cambio', 'responsable', 'observacion'})
        self.assertEqual(set(item['responsable']), {'id_usuario', 'nombre'})
        self.assertEqual(set(item['estado_nuevo']), {'id_estado', 'nombre'})

    def test_valid_bigint_boundaries_reach_queries(self):
        for identifier in [1, 9223372036854775807]:
            with self.subTest(identifier=identifier):
                self.assertEqual(self.client.get(f'/practicas/{identifier}/historial').status_code, 200)
                self.assertEqual(self.db.execute.call_args.args[1]['id_practica'], identifier)

    def test_route_is_get_only_and_does_not_shadow_me(self):
        paths = [route.path for route in router.routes]
        self.assertLess(paths.index('/practicas/me'), paths.index('/practicas/{id_practica}'))
        self.assertLess(paths.index('/practicas/{id_practica}/historial'), paths.index('/practicas/{id_practica}'))
        route = next(route for route in router.routes if route.path == '/practicas/{id_practica}/historial')
        self.assertEqual(route.methods, {'GET'})
