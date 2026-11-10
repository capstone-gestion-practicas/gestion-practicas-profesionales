"""Catalog diagnostic regression: synthetic settings/engine, outgoing sockets forbidden."""
import ast
import contextlib
import importlib.util
import io
import json
import logging
import os
from pathlib import Path
import socket
import sys
import tempfile
import types
import unittest
from unittest.mock import MagicMock, patch

ROOT=Path(__file__).resolve().parents[3]
SCRIPT=ROOT/'PracticaLink/backend/scripts/diagnostico_supabase_catalogo.py'
spec=importlib.util.spec_from_file_location('catalog_diagnostic',SCRIPT)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
from sqlalchemy.engine import make_url

URL='postgresql+psycopg://lab_user:synthetic_secret@lab.invalid:5432/catalog_lab?sslmode=verify-full'
FINGERPRINT=m.target_fingerprint(make_url(URL))
SECRET_MARKERS=('synthetic_secret','lab.invalid','lab_user','catalog_lab')

class OfflineTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.addCleanup(logging.disable,logging.root.manager.disable)
        original_path=sys.path.copy()
        self.addCleanup(lambda: sys.path.__setitem__(slice(None),original_path))
        self.out=Path(self.temp.name)/'report.json'
        self.sql=[]
        self.engine=MagicMock()
        self.connection=MagicMock()
        self.engine.connect.return_value.execution_options.return_value.__enter__.return_value=self.connection
        self.tx=self.connection.begin.return_value
        self.connection.exec_driver_sql.side_effect=lambda sql:self.sql.append(sql)
        self.connection.execute.side_effect=self.execute
        self.settings=types.ModuleType('app.core.config')
        self.settings.settings=types.SimpleNamespace(supabase_database_url=URL)
        self.stdout=io.StringIO(); self.stderr=io.StringIO()
        self.rows={}
        self.backend_patch=patch.object(m,'BACKEND',ROOT/'PracticaLink/backend')
        self.backend_patch.start(); self.addCleanup(self.backend_patch.stop)
        # Fail immediately if code bypasses the mocked engine and attempts networking.
        self.network=patch.object(socket,'socket',side_effect=AssertionError('network forbidden'))
        self.network.start(); self.addCleanup(self.network.stop)

    def execute(self,statement,parameters=None):
        sql=str(statement); self.sql.append(sql)
        result=MagicMock()
        if parameters is None:
            result.mappings.return_value.one.return_value={'version_num':'170006','read_only':'on','isolation':'repeatable read'}
        else:
            name=next(name for name,query in m.QUERIES.items() if sql==query+' LIMIT :row_limit')
            self.assertEqual(parameters['row_limit'],2001)
            result.mappings.return_value.all.return_value=self.rows.get(name,[])
        return result

    def run_main(self,extra=(),fingerprint=FINGERPRINT,show=False):
        args=['diagnostic','--show-target-fingerprint'] if show else [
            'diagnostic','--execute-read-only','--expected-target-sha256',fingerprint,'--output',str(self.out)]
        args.extend(extra)
        with patch.dict(sys.modules,{'app.core.config':self.settings}), patch('sqlalchemy.create_engine',return_value=self.engine) as create, patch.object(sys,'argv',args), contextlib.redirect_stdout(self.stdout), contextlib.redirect_stderr(self.stderr):
            result=m.main()
        self.create=create
        return result

    def report(self): return json.loads(self.out.read_text())

    def assert_incomplete(self,stage):
        self.assertNotEqual(self.run_main(),0)
        report=self.report()
        self.assertEqual(report['status'],'incomplete')
        self.assertFalse(report['capture_exhaustive'])
        self.assertIn(stage,[finding['section'] for finding in report['findings']])
        self.assertNotIn('complete.',self.stdout.getvalue().replace('incomplete.',''))

    def test_success_readonly_rollback_no_sql_writes(self):
        self.assertEqual(self.run_main(),0)
        r=self.report()
        self.assertEqual(r['status'],'complete')
        self.assertTrue(r['capture_exhaustive'])
        self.assertEqual(r['reference_comparison'],'not_performed')
        self.assertEqual(set(r['sections']),set(m.QUERIES))
        self.assertEqual(len(m.QUERIES),17)
        self.tx.rollback.assert_called_once()
        self.tx.commit.assert_not_called()
        self.engine.dispose.assert_called_once()
        self.assertEqual(self.out.stat().st_mode&0o777,0o600)
        for sql in self.sql:
            self.assertTrue(sql.lstrip().startswith(('SELECT','SET TRANSACTION READ ONLY','SET LOCAL statement_timeout = ')),sql)
        kwargs=self.create.call_args.kwargs
        self.assertEqual(kwargs['connect_args']['sslmode'],'verify-full')
        self.assertEqual(kwargs['connect_args']['connect_timeout'],5)
        self.assertIn('default_transaction_read_only=on',kwargs['connect_args']['options'])
        self.assertEqual(self.connection.execute.call_count,18)
        self.assertEqual(self.connection.exec_driver_sql.call_args_list[0].args,('SET TRANSACTION READ ONLY',))
        content=self.out.read_text()+self.stdout.getvalue()+self.stderr.getvalue()
        for secret in SECRET_MARKERS: self.assertNotIn(secret,content)

    def test_rollback_failure(self):
        self.tx.rollback.side_effect=RuntimeError('synthetic_secret')
        self.assert_incomplete('rollback')
        self.engine.dispose.assert_called_once()

    def test_query_failure_preserves_stage_and_rolls_back(self):
        self.connection.execute.side_effect=[self.execute('SELECT context'),RuntimeError('synthetic_secret')]
        self.assert_incomplete('schemas')
        self.tx.rollback.assert_called_once()

    def test_source_read_failure(self):
        with patch.object(Path,'read_bytes',side_effect=OSError('synthetic_secret')):
            self.assert_incomplete('source_read')

    def test_cleanup_failure(self):
        self.engine.dispose.side_effect=RuntimeError('synthetic_secret')
        self.assert_incomplete('cleanup')

    def test_connection_exit_failure(self):
        self.engine.connect.return_value.execution_options.return_value.__exit__.side_effect=RuntimeError('synthetic_secret')
        self.assert_incomplete('connection_cleanup')

    def test_comparison_failure(self):
        reference=Path(self.temp.name)/'reference.json'
        reference.write_text(json.dumps({'format_version':1,'scope':'postgresql_catalogs_only','status':'complete','sections':{name:[] for name in m.QUERIES}}))
        with patch.object(m,'reference_diff',side_effect=RuntimeError('synthetic_secret')):
            self.assertNotEqual(self.run_main(['--reference',str(reference)]),0)
        self.assertEqual(self.report()['status'],'incomplete')
        self.assertEqual(self.report()['findings'][-1]['section'],'reference_comparison')

    def test_bad_reference_rejected_before_connect(self):
        reference=Path(self.temp.name)/'reference.json'
        reference.write_text('{"synthetic_secret":')
        self.assertNotEqual(self.run_main(['--reference',str(reference)]),0)
        self.create.assert_not_called()
        self.assertEqual(self.report()['findings'][-1]['section'],'reference_read')
        self.assertNotIn('synthetic_secret',self.out.read_text())

    def test_reference_shape_checked(self):
        with self.assertRaises(ValueError):
            m.validate_reference({'format_version':1,'scope':'postgresql_catalogs_only','status':'complete','sections':{'roles':'invalid'}})

    def test_reject_insecure_tls(self):
        for mode in ('disable','allow','prefer','require','verify-ca'):
            self.settings.settings.supabase_database_url=URL.replace('verify-full',mode)
            self.assertNotEqual(self.run_main(),0)
            self.create.assert_not_called()
            self.assertEqual(self.report()['findings'][-1]['section'],'tls_configuration')
            self.out.unlink()

    def test_tls_default_is_verify_full(self):
        self.settings.settings.supabase_database_url=URL.split('?')[0]
        self.assertEqual(self.run_main(),0)
        self.assertEqual(self.create.call_args.kwargs['connect_args']['sslmode'],'verify-full')

    def test_wrong_target_no_connection(self):
        self.assertNotEqual(self.run_main(fingerprint='0'*64),0)
        self.create.assert_not_called()
        self.assertEqual(self.report()['findings'][-1]['section'],'target_verification')

    def test_fingerprint_offline(self):
        self.assertEqual(self.run_main(show=True),0)
        self.create.assert_not_called()
        self.assertIn(FINGERPRINT,self.stdout.getvalue())
        self.assertFalse(self.out.exists())
        for secret in SECRET_MARKERS: self.assertNotIn(secret,self.stdout.getvalue())

    def test_fingerprint_excludes_password_and_distinguishes_pooler_users(self):
        altered=make_url(URL).set(password='another')
        self.assertEqual(m.target_fingerprint(altered),FINGERPRINT)
        self.assertNotEqual(m.target_fingerprint(altered.set(username='other_project')),FINGERPRINT)
        self.assertNotEqual(m.target_fingerprint(altered.set(database='different')),FINGERPRINT)

    def test_row_limit_is_incomplete(self):
        self.rows['roles']=[{'name':'synthetic'}]*2001
        self.assertNotEqual(self.run_main(),0)
        r=self.report()
        self.assertEqual(len(r['sections']['roles']),2000)
        self.assertFalse(r['capture_exhaustive'])
        self.assertEqual(r['status'],'incomplete')
        self.assertIn({'section':'roles','code':'ROW_LIMIT_REACHED'},r['findings'])

    def test_writing_failure_no_partial_publication(self):
        with patch.object(m.os,'fsync',side_effect=OSError('synthetic_secret')):
            self.assertEqual(self.run_main(),2)
        self.assertFalse(self.out.exists())
        self.assertEqual(list(self.out.parent.glob('.practicalink-catalog-*')),[])
        self.assertIn('REPORT_WRITE_FAILED',self.stderr.getvalue())
        self.assertNotIn('synthetic_secret',self.stderr.getvalue())
        self.assertNotIn('Estado: complete',self.stdout.getvalue())

    def test_atomic_publication_failure_no_partial_publication(self):
        with patch.object(m,'publish_report',side_effect=OSError('synthetic_secret')):
            self.assertEqual(self.run_main(),2)
        self.assertFalse(self.out.exists())
        self.assertEqual(list(self.out.parent.glob('.practicalink-catalog-*')),[])

    def test_output_size_cap(self):
        with patch.object(m,'REPORT_BYTES',20):
            self.assertEqual(self.run_main(),2)
        self.assertFalse(self.out.exists())
        self.assertEqual(list(self.out.parent.glob('.practicalink-catalog-*')),[])

    def test_write_permission_failure(self):
        with patch.object(m.tempfile,'mkstemp',side_effect=PermissionError('synthetic_secret')):
            self.assertEqual(self.run_main(),2)
        self.assertFalse(self.out.exists())
        self.assertIn('REPORT_WRITE_FAILED',self.stderr.getvalue())

    def test_unsupported_atomic_rename_fails_closed(self):
        with patch.object(m.ctypes,'CDLL',side_effect=OSError('synthetic_secret')):
            self.assertEqual(self.run_main(),2)
        self.assertFalse(self.out.exists())
        self.assertEqual(list(self.out.parent.glob('.practicalink-catalog-*')),[])

    def test_default_system_ca_is_verified(self):
        self.assertEqual(self.run_main(),0)
        self.assertEqual(self.create.call_args.kwargs['connect_args']['sslrootcert'],'system')
        self.assertEqual(self.report()['tls_trust'],'system')

    def test_missing_explicit_ca_rejected_before_connect(self):
        self.assertNotEqual(self.run_main(['--tls-rootcert',str(self.out.parent/'absent.pem')]),0)
        self.create.assert_not_called()
        self.assertEqual(self.report()['findings'][0]['section'],'tls_configuration')

    def test_connection_failure_classification_never_exports_exception(self):
        self.engine.connect.side_effect=RuntimeError('root certificate file synthetic_secret does not exist')
        self.assertNotEqual(self.run_main(),0)
        self.assertEqual(self.report()['findings'][0]['reason'],'TLS_ROOT_CA_MISSING')
        self.assertNotIn('synthetic_secret',self.out.read_text()+self.stdout.getvalue()+self.stderr.getvalue())

    def test_certificate_rejected_classification(self):
        self.assertEqual(m.connection_failure_code(RuntimeError('certificate verify failed: synthetic_secret')),'TLS_CERTIFICATE_REJECTED')

    def test_atomic_existing_file_not_overwritten(self):
        self.out.write_bytes(b'preserve')
        with self.assertRaises(FileExistsError): m.write_report(self.out,{'status':'complete'})
        self.assertEqual(self.out.read_bytes(),b'preserve')
        self.assertEqual(list(self.out.parent.glob('.practicalink-catalog-*')),[])

    def test_serialization_failure_no_output(self):
        with self.assertRaises(TypeError): m.write_report(self.out,{'bad':object()})
        self.assertFalse(self.out.exists())

    def test_atomic_publish_bytes_already_complete(self):
        real_publish=m.publish_report
        def inspect(source,dest):
            self.assertFalse(Path(dest).exists())
            self.assertEqual(json.loads(Path(source).read_text()),{'status':'complete'})
            self.assertEqual(Path(source).stat().st_mode&0o777,0o600)
            real_publish(source,dest)
        with patch.object(m,'publish_report',side_effect=inspect): m.write_report(self.out,{'status':'complete'})
        self.assertEqual(json.loads(self.out.read_text()),{'status':'complete'})

    def test_all_original_queries_and_scopes_identical(self):
        import hashlib
        names=('QUERIES', 'TABLES', 'SCHEMAS', 'EP07', 'PARAMS', 'ROLE_SCOPE', 'FUNC_SCOPE', 'REL_SCOPE')
        fingerprint=hashlib.sha256(json.dumps({name:getattr(m,name) for name in names},sort_keys=True).encode()).hexdigest()
        self.assertEqual(fingerprint,'bfe8b62ca37679439549a72741011c3b1a7e94ce0668fd0573ce9735082e9667')
        ast.parse(SCRIPT.read_text())

if __name__=='__main__': unittest.main(verbosity=2)
