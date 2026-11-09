import hashlib
import io
import os
import unittest
from uuid import uuid4
from unittest.mock import MagicMock, patch
os.environ.setdefault('SUPABASE_DATABASE_URL', 'postgresql+psycopg://synthetic:synthetic@localhost/synthetic')
os.environ.setdefault('JWT_SECRET_KEY', 'synthetic-unit-test-key')
from fastapi import HTTPException
from fastapi.testclient import TestClient
from app.main import app
from app.core.security import get_current_user_id
from app.informes.routes import get_service
from app.informes.service import Informes
from app.informes.formats import Download
from app.informes.pdf import validar_pdf, MAX_BYTES


def pdf(encrypted=False, active=False):
    from pypdf import PdfWriter
    writer = PdfWriter()
    writer.add_blank_page(width=100, height=100)
    if encrypted:
        writer.encrypt('synthetic-password')
    if active:
        from pypdf.generic import DictionaryObject, NameObject, TextStringObject
        action = DictionaryObject({
            NameObject("/S"): NameObject("/JavaScript"),
            NameObject("/JS"): TextStringObject('app.alert("synthetic");'),
        })
        writer._root_object[NameObject("/OpenAction")] = writer._add_object(action)
    output = io.BytesIO(); writer.write(output)
    return output.getvalue()


class PdfTests(unittest.TestCase):
    def test_valid_pdf_hashes_actual_bytes(self):
        data = pdf()
        self.assertEqual(validar_pdf(data), hashlib.sha256(data).hexdigest())

    def test_empty_invalid_encrypted_active_and_oversized(self):
        for data, status in [(b'', 422), (b'%PDF-1.7\ninvalid', 422),
                             (pdf(encrypted=True), 422), (pdf(active=True), 422),
                             (b'x' * (MAX_BYTES + 1), 413)]:
            with self.subTest(status=status, size=len(data)):
                with self.assertRaises(HTTPException) as error:
                    validar_pdf(data)
                self.assertEqual(error.exception.status_code, status)


class InformeServiceTests(unittest.TestCase):
    def setUp(self):
        self.db = MagicMock(); self.storage = MagicMock()
        self.service = Informes(self.db, self.storage)

    def test_reservation_commit_precedes_upload_then_confirmation(self):
        key = uuid4(); data = pdf()
        self.db.execute.return_value.scalar_one.side_effect = [
            {'propietario_estudiante': True}, {'formato': 'PDF', 'estado': 'RESERVADA', 'objeto': 'synthetic.pdf'},
            {'id_documento': 1, 'version': 1, 'confirmada': '2026-11-08'}]
        result = self.service.entregar(7, 8, key, 0, 'informe.pdf', data, 'PDF')
        self.assertEqual(result['version'], 1)
        self.storage.put.assert_called_once_with('synthetic.pdf', data, hashlib.sha256(data).hexdigest(), 'application/pdf')
        self.assertEqual(self.db.commit.call_count, 3)
        self.assertEqual(self.db.execute.call_args_list[1].args[1]['a'], 8)
        self.assertEqual(self.db.execute.call_args_list[2].args[1]['k'], str(key))

    def test_confirmed_retry_does_not_upload_or_confirm_again(self):
        self.db.execute.return_value.scalar_one.side_effect = [{'propietario_estudiante': True},
            {'formato': 'PDF', 'estado': 'CONFIRMADA', 'id_documento': 1, 'version': 1, 'confirmada': '2026-11-08'}]
        self.service.entregar(7, 8, uuid4(), 0, 'informe.pdf', pdf())
        self.storage.put.assert_not_called()
        self.assertEqual(self.db.execute.call_count, 2)

    def test_storage_failure_preserves_old_report_and_reservation(self):
        self.db.execute.return_value.scalar_one.side_effect = [{'propietario_estudiante': True}, {'formato': 'PDF', 'estado': 'RESERVADA', 'objeto': 'synthetic.pdf'}]
        self.storage.put.side_effect = RuntimeError('synthetic storage failure')
        with self.assertRaises(HTTPException) as error:
            self.service.entregar(7, 8, uuid4(), 1, 'informe.pdf', pdf())
        self.assertEqual(error.exception.status_code, 503)
        self.assertEqual(self.db.execute.call_count, 2)
        self.storage.delete.assert_not_called()

    def test_ambiguous_confirmation_never_deletes_object(self):
        self.db.execute.return_value.scalar_one.side_effect = [{'propietario_estudiante': True}, {'formato': 'PDF', 'estado': 'RESERVADA', 'objeto': 'synthetic.pdf'}, RuntimeError()]
        with self.assertRaises(HTTPException):
            self.service.entregar(7, 8, uuid4(), 0, 'informe.pdf', pdf())
        self.db.rollback.assert_called_once()
        self.storage.delete.assert_not_called()

    def test_download_revalidates_assignment_after_storage_io(self):
        data = pdf(); item = {'formato': 'PDF', 'mime_type': 'application/pdf', 'objeto': 'x', 'tamano': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
        self.db.execute.return_value.scalar_one.side_effect = [item, RuntimeError()]
        self.storage.read.return_value = data
        with self.assertRaises(HTTPException):
            self.service.descargar(7, 8)
        self.assertEqual(self.db.execute.call_count, 2)

    def test_cleanup_attempts_all_keys_without_losing_failed_tombstones(self):
        self.db.execute.return_value.scalar_one.return_value = ['a', 'b']
        self.storage.delete.side_effect = [RuntimeError(), None]
        self.assertEqual(self.service.limpiar(), {'procesadas': 2, 'fallidas': 1})
        self.assertEqual(self.storage.delete.call_count, 2)


class InformeRouteTests(unittest.TestCase):
    def setUp(self):
        self.overrides = dict(app.dependency_overrides)
        self.service = MagicMock()
        app.dependency_overrides[get_service] = lambda: self.service
        app.dependency_overrides[get_current_user_id] = lambda: 8
        self.addCleanup(self.restore)
        self.client = TestClient(app)

    def restore(self):
        app.dependency_overrides.clear(); app.dependency_overrides.update(self.overrides)

    def test_upload_actor_comes_from_dependency_and_not_body(self):
        self.service.entregar.return_value = {'version': 1}
        key = uuid4(); data = pdf()
        result = self.client.post('/practicas/7/informe-final', content=data, headers={
            'Content-Type': 'application/pdf', 'Idempotency-Key': str(key),
            'Version-Esperada': '0', 'Nombre-Archivo': 'informe.pdf', 'Id-Actor': '999'})
        self.assertEqual(result.status_code, 200)
        self.service.entregar.assert_called_once_with(7, 8, key, 0, 'informe.pdf', data, 'PDF')

    def test_http_authorization_and_conflict_errors_are_preserved(self):
        for status in [403, 404, 409, 503]:
            self.service.consultar.side_effect = HTTPException(status, 'synthetic')
            self.assertEqual(self.client.get('/practicas/7/informe-final').status_code, status)

    def test_stream_size_limit_and_missing_idempotency(self):
        response = self.client.post('/practicas/7/informe-final', content=b'x')
        self.assertEqual(response.status_code, 422)
        response = self.client.post('/practicas/7/informe-final', content=b'x' * (MAX_BYTES+1), headers={
            'Content-Type': 'application/pdf', 'Idempotency-Key': str(uuid4()),
            'Version-Esperada': '0', 'Nombre-Archivo': 'informe.pdf'})
        self.assertEqual(response.status_code, 413)
        self.service.entregar.assert_not_called()

    def test_download_is_attachment_and_uncacheable(self):
        self.service.descargar.return_value = Download(b'synthetic', 'PDF', 'application/pdf')
        response = self.client.get('/practicas/7/informe-final/archivo')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers['cache-control'], 'no-store')
        self.assertEqual(response.headers['x-content-type-options'], 'nosniff')
        self.assertIn('attachment', response.headers['content-disposition'])


class StorageTests(unittest.TestCase):
    def make_storage(self, handler):
        import httpx
        from app.informes.storage import Storage
        from app.core.config import settings
        with patch.object(settings, 'informe_storage_url', 'https://storage.example.invalid'), patch.object(settings, 'informe_storage_key', 'synthetic-server-key'):
            storage = Storage()
        storage._client = lambda: httpx.Client(transport=httpx.MockTransport(handler))
        return storage

    def test_private_bucket_and_no_upsert_and_retry_hash_verified(self):
        import httpx
        seen = []; data = b'synthetic'
        def handler(request):
            seen.append(request)
            if '/bucket/' in request.url.path:
                return httpx.Response(200, json={'public': False, 'allowed_mime_types': ['application/pdf'], 'file_size_limit': MAX_BYTES})
            if request.method == 'POST':
                return httpx.Response(409, json={'error': 'already exists'})
            return httpx.Response(200, content=data)
        storage = self.make_storage(handler)
        storage.put('practicas/7/informes/synthetic.pdf', data, hashlib.sha256(data).hexdigest())
        self.assertEqual([r.method for r in seen], ['GET', 'POST', 'GET'])
        self.assertEqual(seen[1].headers['x-upsert'], 'false')

    def test_public_bucket_fails_before_upload(self):
        import httpx
        storage = self.make_storage(lambda request: httpx.Response(200, json={'public': True}))
        with self.assertRaises(HTTPException) as error:
            storage.put('x', b'synthetic', 'a'*64)
        self.assertEqual(error.exception.status_code, 503)

    def test_reused_object_key_never_accepts_other_bytes(self):
        import httpx
        def handler(request):
            if '/bucket/' in request.url.path:
                return httpx.Response(200, json={'public': False, 'allowed_mime_types': ['application/pdf'], 'file_size_limit': MAX_BYTES})
            if request.method == 'POST':
                return httpx.Response(409)
            return httpx.Response(200, content=b'other')
        storage = self.make_storage(handler)
        with self.assertRaises(HTTPException) as error:
            storage.put('x', b'synthetic', hashlib.sha256(b'synthetic').hexdigest())
        self.assertEqual(error.exception.status_code, 409)


class DatabaseErrorTests(unittest.TestCase):
    def test_expected_sqlstates_roll_back_without_exposing_sql(self):
        from types import SimpleNamespace
        for code, status in [('42501',403), ('P0404',404), ('P0409',409), ('23505',409), ('XX000',503)]:
            with self.subTest(code=code):
                db = MagicMock(); error = RuntimeError('sensitive synthetic SQL')
                error.orig = SimpleNamespace(sqlstate=code)
                db.execute.side_effect = error
                with self.assertRaises(HTTPException) as caught:
                    Informes(db, MagicMock()).consultar(7, 8)
                self.assertEqual(caught.exception.status_code, status)
                self.assertNotIn('sensitive', caught.exception.detail)
                db.rollback.assert_called_once(); db.commit.assert_not_called()
