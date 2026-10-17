import os
import unittest
from datetime import date, datetime, timezone
from unittest.mock import MagicMock, patch

os.environ.setdefault('SUPABASE_DATABASE_URL', 'postgresql+psycopg://user:password@localhost:5432/practicalink_test')
os.environ.setdefault('JWT_SECRET_KEY', 'unit-test-secret')

from fastapi.testclient import TestClient
from app.core.database import get_db
from app.core.security import get_current_user_id
from app.main import app
from app.practicas.service import obtener_detalle_practica
from app.practicas.routes import router as practicas_router


def fila(estado='FINALIZADA', fecha=None):
    return {
        'id_practica': 15, 'id_estudiante': 7, 'estudiante_nombre': 'Estudiante Sintético',
        'id_centro': 9, 'centro_nombre': 'Centro sintético',
        'fecha_registro': datetime(2025, 3, 1, 12, tzinfo=timezone.utc),
        'id_estado': 6, 'estado_nombre': estado,
        'es_final': estado in {'FINALIZADA', 'RECHAZADA'},
        'fecha_ultimo_cambio_estado': fecha,
        'fecha_inicio': date(2025, 3, 2), 'fecha_termino': date(2025, 6, 30),
        'horas': 360, 'cargo_funcion': 'Desarrollo', 'descripcion': 'Antecedentes sintéticos',
    }


class DetalleGestionTests(unittest.TestCase):
    def setUp(self):
        self.overrides = dict(app.dependency_overrides)
        self.addCleanup(self.restore_overrides)
        self.db = MagicMock()
        self.db.execute.return_value.mappings.return_value.first.return_value = fila()
        app.dependency_overrides[get_db] = lambda: self.db
        app.dependency_overrides[get_current_user_id] = lambda: 123
        self.contexto = self.enterContext(patch(
            'app.core.permissions.obtener_contexto_usuario', return_value={'roles': ['GESTOR']},
        ))
        self.enterContext(patch('sqlalchemy.engine.Engine.connect', side_effect=AssertionError('Conexión real prohibida')))
        self.enterContext(patch('socket.create_connection', side_effect=AssertionError('Red prohibida')))
        self.client = self.enterContext(TestClient(app))

    def restore_overrides(self):
        app.dependency_overrides.clear()
        app.dependency_overrides.update(self.overrides)

    def test_gestor_authorized_with_complete_approved_response(self):
        self.db.execute.return_value.mappings.return_value.first.return_value = fila(
            fecha=datetime(2025, 7, 1, 12, 30, tzinfo=timezone.utc),
        )
        response = self.client.get('/practicas/15')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {
            'id_practica': 15,
            'estudiante': {'id_estudiante': 7, 'nombre': 'Estudiante Sintético'},
            'centro_practica': {'id_centro': 9, 'nombre': 'Centro sintético'},
            'fecha_registro': '2025-03-01T12:00:00Z',
            'estado': {'id_estado': 6, 'nombre': 'FINALIZADA', 'es_final': True},
            'fecha_ultimo_cambio_estado': '2025-07-01T12:30:00Z',
            'fecha_inicio': '2025-03-02', 'fecha_termino': '2025-06-30',
            'horas': 360, 'cargo_funcion': 'Desarrollo', 'descripcion': 'Antecedentes sintéticos',
        })
        self.contexto.assert_called_once_with(db=self.db, id_usuario=123)
        self.db.execute.assert_called_once()
        self.db.commit.assert_not_called()
        self.db.rollback.assert_not_called()

    def test_administrador_authorized(self):
        self.contexto.return_value = {'roles': ['ADMINISTRADOR']}
        self.assertEqual(self.client.get('/practicas/15').status_code, 200)

    def test_estudiante_denied_before_data_query_even_for_missing_practice(self):
        self.contexto.return_value = {'roles': ['ESTUDIANTE']}
        self.db.execute.return_value.mappings.return_value.first.return_value = None
        self.assertEqual(self.client.get('/practicas/15').status_code, 403)
        self.db.execute.assert_not_called()

    def test_absent_and_invalid_credentials_match_existing_endpoint(self):
        del app.dependency_overrides[get_current_user_id]
        for headers in [{}, {'Authorization': 'Bearer invalid-token'}]:
            with self.subTest(headers=headers):
                existing = self.client.get('/practicas/me', headers=headers)
                actual = self.client.get('/practicas/15', headers=headers)
                self.assertIn(actual.status_code, (401, 403))
                self.assertEqual(actual.status_code, existing.status_code)
                self.assertEqual(actual.json(), existing.json())
        self.db.execute.assert_not_called()
        self.contexto.assert_not_called()

    def test_missing_practice_is_404_and_does_not_write(self):
        self.db.execute.return_value.mappings.return_value.first.return_value = None
        response = self.client.get('/practicas/15')
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json(), {'detail': 'La práctica no existe'})
        self.db.commit.assert_not_called()
        self.db.rollback.assert_not_called()

    def test_invalid_identifiers_do_not_reach_query(self):
        for identifier in ['abc', '1.5', '0', '-1', '9223372036854775808']:
            with self.subTest(identifier=identifier):
                response = self.client.get('/practicas/' + identifier)
                self.assertEqual(response.status_code, 422)
        self.db.execute.assert_not_called()

    def test_bigint_boundaries_are_accepted_and_parameterized(self):
        for identifier in [1, 9223372036854775807]:
            with self.subTest(identifier=identifier):
                self.assertEqual(self.client.get('/practicas/' + str(identifier)).status_code, 200)
                self.assertEqual(self.db.execute.call_args.args[1], {'id_practica': identifier})

    def test_historical_practice_in_all_states_can_be_read(self):
        for estado in ['REGISTRADA', 'EN_REVISION', 'OBSERVADA', 'APROBADA', 'EN_CURSO', 'FINALIZADA', 'RECHAZADA']:
            with self.subTest(estado=estado):
                self.db.execute.return_value.mappings.return_value.first.return_value = fila(estado)
                response = self.client.get('/practicas/15')
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()['estado']['nombre'], estado)
                self.assertEqual(response.json()['id_practica'], 15)

    def test_absent_history_and_optional_antecedents_serialize_as_null(self):
        record = fila()
        for key in ['fecha_inicio', 'fecha_termino', 'horas', 'cargo_funcion', 'descripcion']:
            record[key] = None
        self.db.execute.return_value.mappings.return_value.first.return_value = record
        response = self.client.get('/practicas/15')
        self.assertEqual(response.status_code, 200)
        for key in ['fecha_ultimo_cambio_estado', 'fecha_inicio', 'fecha_termino', 'horas', 'cargo_funcion', 'descripcion']:
            self.assertIsNone(response.json()[key])

    def test_sql_uses_current_state_latest_history_and_exact_id_without_writes(self):
        result = obtener_detalle_practica(self.db, 15)
        sql, params = self.db.execute.call_args.args
        sql = ' '.join(str(sql).split())
        self.assertEqual(params, {'id_practica': 15})
        self.assertTrue(sql.startswith('SELECT '))
        for fragment in [
            'WHERE p.id_practica = :id_practica',
            'JOIN estado_practica ep ON ep.id_estado = p.id_estado_actual',
            'WHERE h.id_practica = p.id_practica',
            'ORDER BY h.fecha_cambio DESC, h.id_historial DESC LIMIT 1',
        ]:
            self.assertIn(fragment, sql)
        for fragment in ['ep.nombre IN', 'ep.es_final =', 'ep.activo', 'p.id_estudiante =', 'fecha_actualizacion', 'FOR UPDATE', 'UPDATE ', 'INSERT ', 'DELETE ', 'e.rut', 'u.correo', 'cp.telefono']:
            self.assertNotIn(fragment, sql)
        self.assertEqual(result['id_practica'], 15)
        self.db.execute.assert_called_once()
        self.db.commit.assert_not_called()
        self.db.rollback.assert_not_called()
        self.db.flush.assert_not_called()

    def test_response_schema_excludes_unapproved_personal_fields(self):
        result = obtener_detalle_practica(self.db, 15)
        result['rut'] = 'dato excluido'
        result['correo'] = 'test@example.com'
        result['estudiante']['rut'] = 'dato excluido'
        result['centro_practica']['telefono'] = 'dato excluido'
        with patch('app.practicas.routes.obtener_detalle_practica', return_value=result):
            response = self.client.get('/practicas/15')
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(set(data), {
            'id_practica', 'estudiante', 'centro_practica', 'fecha_registro', 'estado',
            'fecha_ultimo_cambio_estado', 'fecha_inicio', 'fecha_termino', 'horas', 'cargo_funcion', 'descripcion',
        })
        self.assertEqual(set(data['estudiante']), {'id_estudiante', 'nombre'})
        self.assertEqual(set(data['centro_practica']), {'id_centro', 'nombre'})

    def test_me_is_registered_before_dynamic_route(self):
        paths = [route.path for route in practicas_router.routes]
        self.assertLess(paths.index('/practicas/me'), paths.index('/practicas/{id_practica}'))
