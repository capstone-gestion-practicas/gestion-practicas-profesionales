import unittest
from unittest.mock import MagicMock

from sqlalchemy.exc import OperationalError
from app.seguimientos.schemas import SeguimientoCreate
from app.seguimientos.service import RegistroSeguimientoError, registrar_seguimiento


def exito():
    return {'id_seguimiento': 90, 'id_practica': 15, 'id_usuario': 123,
            'fecha': '2026-01-01', 'tipo': 'Videollamada', 'observacion': ' Texto ',
            'fecha_creacion': '2026-10-29T15:00:00Z'}


def fallo_sql(code=None, disconnected=False):
    original = Exception('detalle interno sintético')
    original.sqlstate = code
    return OperationalError('SQL interno', {}, original, connection_invalidated=disconnected)


class SeguimientoServiceTests(unittest.TestCase):
    def setUp(self):
        self.db = MagicMock()
        self.db.execute.return_value.scalar_one.return_value = exito()
        self.datos = SeguimientoCreate(fecha='2026-01-01', tipo='Videollamada', observacion=' Texto ')

    def call(self):
        return registrar_seguimiento(self.db, 15, 123, self.datos)

    def test_bound_parameters_and_commit_after_validated_response(self):
        response = self.call()
        self.assertEqual(response.id_usuario, 123)
        query, params = self.db.execute.call_args.args
        self.assertIn('seguimientos_privados.fn_registrar_seguimiento(', str(query))
        self.assertIn('CAST(:fecha AS DATE)', str(query))
        self.assertNotIn(' Texto ', str(query))
        self.assertEqual(params, {'id_practica': 15, 'id_usuario': 123, **self.datos.model_dump()})
        self.db.execute.assert_called_once()
        self.db.commit.assert_called_once()
        self.db.rollback.assert_not_called()

    def test_malformed_or_mismatching_results_never_commit(self):
        bad = [None, {}, [], {'error': []}]
        bad += [{**exito(), key: value} for key, value in [
            ('id_usuario', 999), ('id_practica', 16), ('fecha', '2026-01-02'),
            ('tipo', 'Otro'), ('observacion', 'Otro texto'), ('id_seguimiento', 0),
            ('id_seguimiento', True), ('fecha_creacion', '2026-01-01T00:00:00'),
        ]]
        for result in bad:
            with self.subTest(result=result):
                self.db.reset_mock()
                self.db.execute.return_value.scalar_one.return_value = result
                with self.assertRaises(RegistroSeguimientoError):
                    self.call()
                self.db.commit.assert_not_called()
                self.db.rollback.assert_called_once()

    def test_business_failure_and_failed_rollback_keep_original_error(self):
        self.db.execute.return_value.scalar_one.return_value = {'error': 'PRACTICA_NO_EN_CURSO'}
        self.db.rollback.side_effect = fallo_sql()
        with self.assertRaises(RegistroSeguimientoError) as error:
            self.call()
        self.assertEqual(error.exception.codigo, 'PRACTICA_NO_EN_CURSO')
        self.db.commit.assert_not_called()

    def test_connection_concurrency_and_commit_errors_never_retry(self):
        for stage in ['execute', 'commit']:
            for code, expected in [('40001', 'CONFLICTO_CONCURRENTE'), ('40P01', 'CONFLICTO_CONCURRENTE'),
                                   ('55P03', 'CONFLICTO_CONCURRENTE'), ('08006', 'CONEXION_NO_DISPONIBLE'),
                                   (None, 'FALLO_INESPERADO')]:
                with self.subTest(stage=stage, code=code):
                    self.db.reset_mock(side_effect=True)
                    getattr(self.db, stage).side_effect = fallo_sql(code)
                    with self.assertRaises(RegistroSeguimientoError) as error:
                        self.call()
                    self.assertEqual(error.exception.codigo, expected)
                    self.db.execute.assert_called_once()
                    self.assertEqual(self.db.commit.call_count, int(stage == 'commit'))
                    self.db.rollback.assert_called_once()
        self.db.reset_mock(side_effect=True)
        self.db.execute.side_effect = fallo_sql(disconnected=True)
        with self.assertRaises(RegistroSeguimientoError) as error:
            self.call()
        self.assertEqual(error.exception.codigo, 'CONEXION_NO_DISPONIBLE')
