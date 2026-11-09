import os
import unittest
from unittest.mock import MagicMock, patch
os.environ.setdefault('SUPABASE_DATABASE_URL','postgresql+psycopg://synthetic:synthetic@localhost/synthetic')
os.environ.setdefault('JWT_SECRET_KEY','synthetic-unit-test-key')
from fastapi import HTTPException
from app.informes import database


class AcademicExecutorTests(unittest.TestCase):
    def test_preflight_checks_exact_new_signatures_and_denies_direct_dml(self):
        db = MagicMock(); db.execute.return_value.scalar_one_or_none.return_value = True
        with patch.object(database,'_factory',lambda: db):
            dependency = database.get_informe_db()
            self.assertIs(next(dependency),db)
            query = str(db.execute.call_args.args[0])
            for signature in ['iniciar_evaluacion(bigint,bigint,uuid,bigint,bigint)',
                'resolver_evaluacion(bigint,bigint,uuid,uuid,text,text)',
                'historial_evaluacion(bigint,bigint)', 'public.fn_cerrar_practica(bigint,bigint,text)']:
                self.assertIn(signature,query)
            for table in ['evaluacion_informe','evaluacion_evento','cierre_practica','historial_estado']:
                self.assertIn(table,query)
            self.assertIn('has_any_column_privilege',query)
            dependency.close(); db.close.assert_called_once()

    def test_false_missing_or_failed_preflight_never_falls_back(self):
        for outcome in [False,None,RuntimeError('synthetic sensitive SQL')]:
            db = MagicMock()
            if isinstance(outcome,Exception): db.execute.side_effect = outcome
            else: db.execute.return_value.scalar_one_or_none.return_value = outcome
            with self.subTest(outcome_type=type(outcome).__name__),patch.object(database,'_factory',lambda: db),patch('app.core.database.SessionLocal') as ordinary:
                with self.assertRaises(HTTPException) as error:
                    next(database.get_informe_db())
                self.assertEqual(error.exception.status_code,503)
                self.assertNotIn('sensitive',error.exception.detail)
                ordinary.assert_not_called(); db.close.assert_called_once()

    def test_no_url_or_unsafe_principal_does_not_create_engine(self):
        for url in [None,'postgresql+psycopg://synthetic:secret@localhost/synthetic',
            'postgresql+psycopg://private:secret@localhost/synthetic?options=unsafe',
            'postgresql+psycopg://private:secret@/synthetic']:
            with self.subTest(configured=url is not None),patch.object(database,'_factory',None),patch.object(database.settings,'informe_database_url',url),patch.object(database.settings,'supabase_database_url','postgresql+psycopg://synthetic:secret@localhost/synthetic'),patch.object(database,'create_engine') as engine:
                with self.assertRaises(HTTPException) as error:
                    next(database.get_informe_db())
                self.assertEqual(error.exception.status_code,503)
                engine.assert_not_called()
