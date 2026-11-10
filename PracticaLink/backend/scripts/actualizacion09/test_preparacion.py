"""Offline safety tests: no app settings, Docker or remote connections."""
import contextlib,io,json,os,runpy,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import backup
import apply
from common import ROOT,adopted,cleanup_sql
class PreparationTests(unittest.TestCase):
    def test_helpers_resolve_relocated_checkout_without_configuration(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)/'checkout'
            package=root/'PracticaLink/backend/scripts/actualizacion09'
            package.mkdir(parents=True)
            migrations=root/'PracticaLink/supabase/migrations';migrations.mkdir(parents=True)
            fixes=root/'scripts/BD/fixes';fixes.mkdir(parents=True)
            for number in range(27):(migrations/f'{number:014}_fixture.sql').touch()
            for number in range(1,10):(fixes/f'ep06-0{number}-fixture.sql').touch()
            helper=package/'common.py'
            helper.write_text((ROOT/'PracticaLink/backend/scripts/actualizacion09/common.py').read_text())
            with patch('socket.socket',side_effect=AssertionError('network forbidden')):
                namespace=runpy.run_path(str(helper))
            self.assertEqual(namespace['ROOT'],root.resolve())
            self.assertTrue(all(path.is_relative_to(root) for path in namespace['MIGRATIONS']+namespace['EP06']))

    def test_transaction_frame_adoption_preserves_body(self):
        self.assertEqual(adopted('-- reviewed\nBEGIN;\nSELECT 1;\nCOMMIT;\n'),'-- reviewed\n\nSELECT 1;\n')
    def test_missing_or_multiple_frames_rejected(self):
        for source in ['BEGIN;\nSELECT 1;','BEGIN;\nBEGIN;\nCOMMIT;\n','COMMIT;\n']:
            with self.subTest(source=source),self.assertRaises(ValueError):adopted(source)
    def test_unframed_source_unchanged(self):
        source="DO $$ BEGIN RAISE NOTICE 'x'; END $$;\n";self.assertEqual(adopted(source),source)
    def test_cleanup_is_creator_and_named_roles_only(self):
        sql=cleanup_sql();self.assertIn('a.grantor=',sql);self.assertIn('r.rolname IN (',sql);self.assertNotIn("left(r.rolname,3)='pl_'",sql);self.assertIn('GRANTED BY',sql)
    def test_backup_plan_never_runs_docker_or_database(self):
        with patch.object(sys,'argv',['backup','--plan']),patch.object(backup.subprocess,'run',side_effect=AssertionError('no tools allowed')),contextlib.redirect_stdout(io.StringIO()):self.assertEqual(backup.main(),0)
    def test_update_plan_never_connects(self):
        with patch.object(sys,'argv',['apply','--plan']),patch.object(apply,'connect',side_effect=AssertionError('no connection')),contextlib.redirect_stdout(io.StringIO()):self.assertEqual(apply.main(),0)
    def test_write_without_approvals_rejected_before_connect(self):
        with patch.object(sys,'argv',['apply']),patch.object(apply,'connect',side_effect=AssertionError('no connection')),contextlib.redirect_stderr(io.StringIO()),self.assertRaises(SystemExit) as e:apply.main()
        self.assertEqual(e.exception.code,2)
    def test_service_alias_injection_rejected(self):
        with self.assertRaises(ValueError):backup.service_identity(Path('/nonexistent'),'x host=other')
    def test_private_service_permissions_and_password_redaction(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'pg_service.conf';p.write_text('[lab]\nhost=lab.invalid\nport=5432\ndbname=synthetic\nuser=synthetic\npassword=synthetic_fixture_only\n')
            os.chmod(p,0o600);fp=backup.service_identity(p,'lab');self.assertEqual(len(fp),64);self.assertNotIn('synthetic',fp)
            os.chmod(p,0o644)
            with self.assertRaises(ValueError):backup.service_identity(p,'lab')
if __name__=='__main__':unittest.main(verbosity=2)
