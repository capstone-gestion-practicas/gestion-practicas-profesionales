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
from app.practicas.service import listar_practicas


def fila(id_practica=10, estado='FINALIZADA', fecha=None, estudiante_rut='11.111.111-1',
         fecha_inicio=None, fecha_termino=None, id_gestor=None, gestor_nombre=None):
    return {
        'id_practica': id_practica, 'id_estudiante': 7,
        'estudiante_nombre': 'Estudiante Sintético', 'estudiante_rut': estudiante_rut,
        'centro_nombre': 'Centro sintético',
        'fecha_registro': datetime(2026, 10, 17, 12, tzinfo=timezone.utc),
        'id_estado': 6, 'estado_nombre': estado,
        'es_final': estado in {'FINALIZADA', 'RECHAZADA'},
        'fecha_ultimo_cambio_estado': fecha,
        # Etapa 4a: campos añadidos al listado paginado.
        'fecha_inicio': fecha_inicio, 'fecha_termino': fecha_termino,
        'id_gestor': id_gestor, 'gestor_nombre': gestor_nombre,
    }


class ListadoPracticasTests(unittest.TestCase):
    def setUp(self):
        self.overrides = dict(app.dependency_overrides)
        self.addCleanup(self.restore_overrides)
        self.db = MagicMock()
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

    def test_allowed_roles_and_general_empty_listing(self):
        for rol in ['GESTOR', 'ADMINISTRADOR']:
            with self.subTest(rol=rol):
                self.contexto.return_value = {'roles': [rol]}
                response = self.client.get('/practicas')
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json(), {'items': [], 'limit': 50, 'offset': 0, 'hay_mas': False})
                self.contexto.assert_called_with(db=self.db, id_usuario=123)

    def test_denies_estudiante_before_query(self):
        self.contexto.return_value = {'roles': ['ESTUDIANTE']}
        self.assertEqual(self.client.get('/practicas').status_code, 403)
        self.db.execute.assert_not_called()

    def test_missing_and_invalid_credentials_preserve_existing_authentication(self):
        del app.dependency_overrides[get_current_user_id]
        for headers in [{}, {'Authorization': 'Bearer invalid-token'}]:
            with self.subTest(headers=headers):
                previous = self.client.get('/practicas/me', headers=headers)
                response = self.client.get('/practicas', headers=headers)
                self.assertIn(response.status_code, (401, 403))
                self.assertEqual(response.status_code, previous.status_code)
                self.assertEqual(response.json(), previous.json())
        self.db.execute.assert_not_called()
        self.contexto.assert_not_called()

    def test_valid_rut_is_normalized_parameterized_and_can_have_no_matches(self):
        response = self.client.get('/practicas', params={'rut': '12345678-5'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['items'], [])
        sql, params = self.db.execute.call_args.args
        self.assertIn('WHERE e.rut = :rut', str(sql))
        # EP07: GESTOR consulta solo sus prácticas asignadas (id desde el JWT, no desde el cliente).
        self.assertEqual(params, {'rut': '12.345.678-5', 'limit': 51, 'offset': 0, 'id_gestor_asignado': 123})
        self.assertNotIn('12.345.678-5', str(sql))

    def test_accepts_uppercase_and_lowercase_k(self):
        for rut in ['10000013-K', '10000013-k']:
            with self.subTest(rut=rut):
                self.assertEqual(self.client.get('/practicas', params={'rut': rut}).status_code, 200)
                self.assertEqual(self.db.execute.call_args.args[1]['rut'], '10.000.013-K')

    def test_rejects_invalid_format_and_verifier(self):
        for rut in ['12.345.678-5', '123456785', '12345678-4', '12345678-', '', ' 12345678-5', '12345678-5 ', "12345678-5' OR 1=1"]:
            with self.subTest(rut=rut):
                self.assertEqual(self.client.get('/practicas', params={'rut': rut}).status_code, 422)
        self.db.execute.assert_not_called()

    def test_rejects_invalid_pagination(self):
        for params in [{'limit': 0}, {'limit': 101}, {'limit': 'abc'}, {'limit': '1.5'}, {'offset': -1}, {'offset': 'abc'}]:
            with self.subTest(params=params):
                self.assertEqual(self.client.get('/practicas', params=params).status_code, 422)
        self.db.execute.assert_not_called()

    def test_final_states_same_student_dates_and_minimal_response(self):
        fecha = datetime(2026, 10, 17, 12, 30, tzinfo=timezone.utc)
        self.db.execute.return_value.mappings.return_value.all.return_value = [fila(11, 'FINALIZADA', fecha), fila(10, 'RECHAZADA'), fila(9, 'EN_CURSO')]
        response = self.client.get('/practicas', params={'rut': '12345678-5'})
        self.assertEqual(response.status_code, 200)
        items = response.json()['items']
        self.assertEqual([x['id_practica'] for x in items], [11, 10, 9])
        # Etapa 4a: el contrato se extiende con rut_estudiante, fechas y gestor; los
        # campos anteriores (hasta fecha_ultimo_cambio_estado) no cambian de nombre ni de forma.
        self.assertEqual(items[0], {
            'id_practica': 11, 'estudiante': {'id_estudiante': 7, 'nombre': 'Estudiante Sintético'},
            'centro_practica': 'Centro sintético', 'fecha_registro': '2026-10-17T12:00:00Z',
            'estado': {'id_estado': 6, 'nombre': 'FINALIZADA', 'es_final': True},
            'fecha_ultimo_cambio_estado': '2026-10-17T12:30:00Z',
            'rut_estudiante': '11.111.111-1', 'fecha_inicio': None, 'fecha_termino': None,
            'id_gestor': None, 'gestor': None,
        })
        self.assertIsNone(items[1]['fecha_ultimo_cambio_estado'])
        self.assertTrue(items[1]['estado']['es_final'])
        self.assertFalse(items[2]['estado']['es_final'])
        self.db.execute.assert_called_once()
        self.db.commit.assert_not_called()
        self.db.rollback.assert_not_called()

    def test_limit_plus_one_offset_and_deterministic_sql(self):
        self.db.execute.return_value.mappings.return_value.all.return_value = [fila(12), fila(11), fila(10)]
        result = listar_practicas(self.db, limit=2, offset=4)
        self.assertEqual([x['id_practica'] for x in result['items']], [12, 11])
        self.assertEqual((result['limit'], result['offset'], result['hay_mas']), (2, 4, True))
        sql, params = self.db.execute.call_args.args
        sql = ' '.join(str(sql).split())
        self.assertEqual(params, {'limit': 3, 'offset': 4})
        for fragment in ['ORDER BY p.fecha_registro DESC, p.id_practica DESC', 'ORDER BY h.fecha_cambio DESC, h.id_historial DESC LIMIT 1', 'WHERE h.id_practica = p.id_practica', 'LIMIT :limit OFFSET :offset']:
            self.assertIn(fragment, sql)
        for fragment in ['WHERE e.rut', 'ep.nombre IN', 'ep.es_final =', 'DISTINCT', 'fecha_actualizacion']:
            self.assertNotIn(fragment, sql)
        self.db.execute.assert_called_once()

    def test_no_extra_row_means_no_more_results(self):
        for rows in [[], [fila()], [fila(11), fila(10)]]:
            with self.subTest(count=len(rows)):
                self.db.execute.return_value.mappings.return_value.all.return_value = rows
                self.assertFalse(listar_practicas(self.db, limit=2)['hay_mas'])

    def test_pagination_boundaries_reach_service(self):
        response = self.client.get('/practicas', params={'limit': 100, 'offset': 200})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.db.execute.call_args.args[1], {'limit': 101, 'offset': 200, 'id_gestor_asignado': 123})

    # ---------- Etapa 4a: filtro por estado, aplicado en el servidor antes de paginar ----------

    def test_estado_filter_is_uppercased_parameterized_and_can_have_no_matches(self):
        response = self.client.get('/practicas', params={'estado': 'en_curso'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['items'], [])
        sql, params = self.db.execute.call_args.args
        self.assertIn('WHERE ep.nombre = :estado', str(sql))
        self.assertEqual(params, {'estado': 'EN_CURSO', 'limit': 51, 'offset': 0, 'id_gestor_asignado': 123})
        # Parametrizado: el valor crudo no aparece embebido en el texto del SQL.
        self.assertNotIn('EN_CURSO', str(sql))

    def test_estado_well_formed_but_nonexistent_returns_empty_page_not_error(self):
        response = self.client.get('/practicas', params={'estado': 'ESTADO_INVENTADO'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'items': [], 'limit': 50, 'offset': 0, 'hay_mas': False})

    def test_estado_rejects_malformed_values(self):
        for estado in ['', ' ', 'EN CURSO', 'EN-CURSO', "EN_CURSO' OR 1=1", 'x' * 51, 'ÑOÑO']:
            with self.subTest(estado=estado):
                self.assertEqual(self.client.get('/practicas', params={'estado': estado}).status_code, 422)
        self.db.execute.assert_not_called()

    def test_estado_combined_with_rut_applies_both_conditions_together(self):
        response = self.client.get('/practicas', params={'estado': 'FINALIZADA', 'rut': '12345678-5'})
        self.assertEqual(response.status_code, 200)
        sql, params = self.db.execute.call_args.args
        sql = ' '.join(str(sql).split())
        self.assertIn('WHERE e.rut = :rut AND ep.nombre = :estado', sql)
        self.assertEqual(params, {
            'rut': '12.345.678-5', 'estado': 'FINALIZADA', 'limit': 51, 'offset': 0, 'id_gestor_asignado': 123,
        })

    def test_estado_absent_keeps_previous_params_shape_exactly(self):
        # Sin ?estado en la URL, el contrato de parámetros hacia la BD no cambia.
        result = listar_practicas(self.db, limit=2, offset=4)
        self.assertEqual([x['id_practica'] for x in result['items']], [])
        self.assertEqual(self.db.execute.call_args.args[1], {'limit': 3, 'offset': 4})

    # ---------- Etapa 4a: campos nuevos (RUT, fechas, gestor) y ausencia de duplicados ----------

    def test_new_fields_are_mapped_including_assigned_manager(self):
        self.db.execute.return_value.mappings.return_value.all.return_value = [
            fila(20, 'EN_CURSO', estudiante_rut='9.876.543-2', fecha_inicio=date(2026, 3, 1),
                 fecha_termino=date(2026, 7, 31), id_gestor=55, gestor_nombre='Gestora Sintética'),
        ]
        items = self.client.get('/practicas').json()['items']
        self.assertEqual(items[0]['rut_estudiante'], '9.876.543-2')
        self.assertEqual(items[0]['fecha_inicio'], '2026-03-01')
        self.assertEqual(items[0]['fecha_termino'], '2026-07-31')
        self.assertEqual(items[0]['id_gestor'], 55)
        self.assertEqual(items[0]['gestor'], 'Gestora Sintética')

    def test_unassigned_manager_is_null_not_empty_string(self):
        # Guarda contra el comportamiento de CONCAT() de PostgreSQL con NULL (ver comentario
        # en el servicio): sin gestor asignado, el campo debe llegar como null, no como " ".
        self.db.execute.return_value.mappings.return_value.all.return_value = [
            fila(21, 'APROBADA', id_gestor=None, gestor_nombre=None),
        ]
        item = self.client.get('/practicas').json()['items'][0]
        self.assertIsNone(item['id_gestor'])
        self.assertIsNone(item['gestor'])

    def test_query_joins_manager_with_left_join_single_row_relation_no_duplicates(self):
        self.db.execute.return_value.mappings.return_value.all.return_value = [fila(10)]
        response = self.client.get('/practicas')
        sql = ' '.join(str(self.db.execute.call_args.args[0]).split())
        self.assertIn('LEFT JOIN usuario g ON g.id_usuario = p.id_gestor', sql)
        self.assertNotIn('DISTINCT', sql)
        # p.id_gestor es 1:1 opcional hacia usuario: el LEFT JOIN no puede multiplicar filas.
        self.assertEqual(len(response.json()['items']), 1)

    # ---------- Etapa 4a: roles, incluidas cuentas con GESTOR y ADMINISTRADOR a la vez ----------

    def test_gestor_sees_only_assigned_practices_regardless_of_filters(self):
        self.contexto.return_value = {'roles': ['GESTOR']}
        self.client.get('/practicas', params={'estado': 'EN_CURSO'})
        self.assertEqual(self.db.execute.call_args.args[1]['id_gestor_asignado'], 123)

    def test_administrator_sees_all_practices_without_gestor_restriction(self):
        self.contexto.return_value = {'roles': ['ADMINISTRADOR']}
        self.client.get('/practicas', params={'estado': 'EN_CURSO'})
        self.assertNotIn('id_gestor_asignado', self.db.execute.call_args.args[1])

    def test_dual_role_account_is_authorized_as_administrator_ignoring_workspace(self):
        # La cuenta con ambos roles no depende de ningún dato enviado por el cliente (el
        # espacio elegido vive solo en sessionStorage del navegador y nunca llega al backend):
        # basta con que el token incluya ADMINISTRADOR para no restringir por gestor.
        self.contexto.return_value = {'roles': ['GESTOR', 'ADMINISTRADOR']}
        self.client.get('/practicas')
        self.assertNotIn('id_gestor_asignado', self.db.execute.call_args.args[1])

    def test_dual_role_with_administrator_last_in_the_list_is_still_unrestricted(self):
        self.contexto.return_value = {'roles': ['ADMINISTRADOR', 'GESTOR']}
        self.client.get('/practicas')
        self.assertNotIn('id_gestor_asignado', self.db.execute.call_args.args[1])
