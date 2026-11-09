"""Binary HTTP contracts, real parsers and simulated Storage; never external DB."""
import hashlib
import unittest
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier, Event
from unittest.mock import MagicMock, patch
from uuid import uuid4
import httpx
from fastapi import HTTPException
from app.informes import formats
from app.informes.service import Informes
from tests import test_informes as legacy
from tests.test_docx import fixture

DOCX_MIME = formats.FORMATS['DOCX'][0]


class FormatRoutesTests(unittest.TestCase):
    setUp = legacy.InformeRouteTests.setUp
    restore = legacy.InformeRouteTests.restore

    def headers(self, mime='application/pdf', name='informe.pdf'):
        return {'Content-Type': mime, 'Nombre-Archivo': name,
                'Idempotency-Key': str(uuid4()), 'Version-Esperada': '0'}

    def test_docx_contract_and_decoded_filename(self):
        self.service.entregar.return_value = {'formato': 'DOCX'}
        data=fixture(); h=self.headers(DOCX_MIME,'informe%20final.docx')
        result=self.client.post('/practicas/7/informe-final',headers=h,content=data)
        self.assertEqual(result.status_code,200)
        self.service.propietario.assert_called_once_with(7,8)
        args=self.service.entregar.call_args.args
        self.assertEqual(args[0:2],(7,8)); self.assertEqual(args[4:],('informe final.docx',data,'DOCX'))

    def test_mime_and_filename_discordance_is_rejected(self):
        for mime,name,status in [('application/zip','x.docx',415),('application/msword','x.doc',415),
             ('application/pdf','x.docx',422),(DOCX_MIME,'x.pdf',422),(DOCX_MIME,'x.docm',422),
             (DOCX_MIME,'../x.docx',422),(DOCX_MIME,'x%0d%0a.docx',422)]:
            with self.subTest(mime=mime,name=name):
                result=self.client.post('/practicas/7/informe-final',headers=self.headers(mime,name),content=b'x')
                self.assertEqual(result.status_code,status)
        self.service.entregar.assert_not_called()

    def test_non_owner_is_rejected_before_delivery(self):
        self.service.propietario.side_effect=HTTPException(403,'not owner')
        result=self.client.post('/practicas/7/informe-final',headers=self.headers(),content=b'x')
        self.assertEqual(result.status_code,403); self.service.entregar.assert_not_called()

    def test_authentication_is_required(self):
        from app.main import app
        from app.core.security import get_current_user_id
        app.dependency_overrides.pop(get_current_user_id)
        result=self.client.post('/practicas/7/informe-final',headers=self.headers(),content=b'x')
        self.assertEqual(result.status_code,401); self.service.propietario.assert_not_called()

    def test_docx_download_headers_and_exact_original(self):
        data=fixture(); self.service.descargar.return_value=formats.Download(data,'DOCX',DOCX_MIME)
        response=self.client.get('/practicas/7/informe-final/archivo')
        self.assertEqual(response.content,data); self.assertEqual(response.headers['content-type'],DOCX_MIME)
        self.assertEqual(response.headers['content-disposition'],'attachment; filename="informe-final.docx"')
        self.assertEqual(response.headers['cache-control'],'no-store')
        self.assertEqual(response.headers['x-content-type-options'],'nosniff')


class FormatServiceTests(unittest.TestCase):
    def setUp(self):
        self.db=MagicMock(); self.storage=MagicMock(); self.service=Informes(self.db,self.storage)

    def test_real_pdf_and_sandbox_docx_select_explicit_sql_format_and_original_hash(self):
        for fmt,data in [('PDF',legacy.pdf()),('DOCX',fixture())]:
            with self.subTest(fmt=fmt):
                self.db.reset_mock(); self.storage.reset_mock(); key=uuid4()
                self.db.execute.return_value.scalar_one.side_effect=[{'propietario_estudiante':True},
                    {'formato':fmt,'estado':'RESERVADA','objeto':'server-generated'+formats.FORMATS[fmt][1]},
                    {'id_documento':3,'version':1,'confirmada':'2026-11-08'}]
                result=self.service.entregar(7,8,key,0,'informe'+formats.FORMATS[fmt][1],data,fmt)
                call=self.db.execute.call_args_list[1]
                self.assertIn('CAST(:f AS text)',str(call.args[0])); self.assertEqual(call.args[1]['f'],fmt)
                self.assertEqual(call.args[1]['h'],hashlib.sha256(data).hexdigest())
                self.storage.put.assert_called_once_with('server-generated'+formats.FORMATS[fmt][1],data,hashlib.sha256(data).hexdigest(),formats.FORMATS[fmt][0])
                self.assertEqual(result['formato'],fmt); self.assertEqual(result['mime_type'],formats.FORMATS[fmt][0])

    def test_owner_denial_does_not_execute_parsers_or_reserve(self):
        self.db.execute.return_value.scalar_one.return_value={'propietario_estudiante':False}
        with patch('app.informes.service.validate') as parser:
            with self.assertRaises(HTTPException) as error: self.service.entregar(7,8,uuid4(),0,'x.docx',b'bad','DOCX')
        self.assertEqual(error.exception.status_code,403); parser.assert_not_called()
        self.assertEqual(self.db.execute.call_count,1); self.storage.put.assert_not_called()

    def test_confirmed_retry_is_allowed_when_new_deliveries_are_disabled(self):
        self.db.execute.return_value.scalar_one.side_effect=[{'propietario_estudiante':True,'habilitada':False},
            {'estado':'CONFIRMADA','formato':'PDF','id_documento':1,'version':1,'confirmada':'2026-11-08'}]
        result=self.service.entregar(7,8,uuid4(),0,'x.pdf',legacy.pdf(),'PDF')
        self.assertEqual(result['version'],1); self.storage.put.assert_not_called()
        self.assertEqual(self.db.execute.call_count,2)

    def test_content_must_match_claimed_format(self):
        for fmt,data in [('PDF',fixture()),('DOCX',legacy.pdf()),('DOCX',b''),('PDF',b'invalid')]:
            self.db.reset_mock(); self.db.execute.return_value.scalar_one.side_effect=None
            self.db.execute.return_value.scalar_one.return_value={'propietario_estudiante':True}
            with self.subTest(fmt=fmt), self.assertRaises(HTTPException) as error:
                self.service.entregar(7,8,uuid4(),0,'x'+formats.FORMATS[fmt][1],data,fmt)
            self.assertEqual(error.exception.status_code,422); self.assertEqual(self.db.execute.call_count,1)
        self.storage.put.assert_not_called()

    def test_download_hash_mismatch_and_metadata_mismatch_fail_closed(self):
        item={'formato':'DOCX','mime_type':DOCX_MIME,'objeto':'server.docx','sha256':'a'*64,'tamano':3}
        self.db.execute.return_value.scalar_one.return_value=item; self.storage.read.return_value=b'bad'
        with self.assertRaises(HTTPException) as error: self.service.descargar(7,8)
        self.assertEqual(error.exception.status_code,503)
        self.storage.reset_mock(); item['mime_type']='application/pdf'
        with self.assertRaises(HTTPException) as error: self.service.descargar(7,8)
        self.assertEqual(error.exception.status_code,503); self.storage.read.assert_not_called()

    def test_download_revalidates_current_version_and_assignment(self):
        data=fixture(); item={'formato':'DOCX','mime_type':DOCX_MIME,'objeto':'x.docx','sha256':hashlib.sha256(data).hexdigest(),'tamano':len(data),'version':1}
        self.storage.read.return_value=data
        for second,status in [({**item,'version':2},409),(HTTPException(403,'lost assignment'),403)]:
            with patch.object(self.service,'call',side_effect=[item,second]):
                with self.assertRaises(HTTPException) as error: self.service.descargar(7,8)
                self.assertEqual(error.exception.status_code,status)


class TransitionStorageTests(unittest.TestCase):
    make_storage=legacy.StorageTests.make_storage

    def storage(self,allowed,public=False,limit=formats.MAX_BYTES):
        self.seen=[]; self.data=b'original'
        def handler(request):
            self.seen.append(request)
            if '/bucket/' in request.url.path:
                return httpx.Response(200,json={'public':public,'allowed_mime_types':allowed,'file_size_limit':limit})
            if request.method=='POST': return httpx.Response(201)
            return httpx.Response(200,content=self.data)
        return self.make_storage(handler)

    def test_both_bucket_configurations_and_both_mimes(self):
        for allowed,mime in [(['application/pdf'],'application/pdf'),([DOCX_MIME,'application/pdf'],DOCX_MIME),(['application/pdf',DOCX_MIME],'application/pdf')]:
            storage=self.storage(allowed)
            storage.put('server-key',self.data,hashlib.sha256(self.data).hexdigest(),mime)
            self.assertEqual(self.seen[1].headers['content-type'],mime)
            self.assertEqual(self.seen[1].headers['x-upsert'],'false')

    def test_pdf_only_bucket_rejects_docx_before_upload_but_allows_cleanup(self):
        storage=self.storage(['application/pdf'])
        with self.assertRaises(HTTPException) as error: storage.put('x.docx',self.data,hashlib.sha256(self.data).hexdigest(),DOCX_MIME)
        self.assertEqual(error.exception.status_code,503); self.assertEqual(len(self.seen),1)
        storage.delete('expired.docx'); self.assertEqual(self.seen[-1].method,'DELETE')

    def test_unsafe_bucket_configuration_is_rejected(self):
        for allowed,public,limit in [(None,False,10),([],False,10),(['*/*'],False,10),
            (['application/pdf',DOCX_MIME,'image/png'],False,10),([DOCX_MIME],False,10),
            (['application/pdf','application/pdf'],False,10),(['application/pdf'],True,10),
            (['application/pdf'],False,True),(['application/pdf'],False,formats.MAX_BYTES+1)]:
            with self.subTest(allowed=allowed,public=public,limit=limit):
                storage=self.storage(allowed,public,limit)
                with self.assertRaises(HTTPException) as error: storage.verify()
                self.assertEqual(error.exception.status_code,503)


class SharedCapacityTests(unittest.TestCase):
    def test_pdf_and_docx_share_two_slots(self):
        gate=Barrier(3); release=Event()
        def held(data):
            gate.wait(timeout=5)
            if not release.wait(timeout=5): raise AssertionError('test capacity timeout')
            return hashlib.sha256(data).hexdigest()
        with patch.object(formats,'validar_pdf',side_effect=held),patch.object(formats,'validar_docx',side_effect=held),ThreadPoolExecutor(max_workers=2) as pool:
            futures=[pool.submit(formats.validate,b'original',fmt) for fmt in ('PDF','DOCX')]
            try:
                gate.wait(timeout=5)
                with self.assertRaises(HTTPException) as error: formats.validate(b'original','PDF')
                self.assertEqual(error.exception.status_code,429)
            finally: release.set()
            for future in futures: self.assertEqual(future.result(timeout=5),hashlib.sha256(b'original').hexdigest())

    def test_sandbox_failure_is_preserved_and_slot_released(self):
        with patch.object(formats,'validar_docx',side_effect=HTTPException(503,'sandbox unavailable')) as parser:
            for _ in range(3):
                with self.assertRaises(HTTPException) as error: formats.validate(b'x','DOCX')
                self.assertEqual(error.exception.status_code,503)
            self.assertEqual(parser.call_count,3)
