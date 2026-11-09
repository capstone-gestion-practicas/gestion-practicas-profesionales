"""Synthetic OOXML fixtures; real Bubblewrap validation, no DB/Storage/network services."""
import hashlib
import io
import os
from pathlib import Path
import struct
import tempfile
import textwrap
import unittest
from unittest.mock import patch
import zipfile
from xml.etree import ElementTree as ET

from fastapi import HTTPException
from PIL import Image
from app.informes import docx, docx_worker as worker


def fixture(body='<w:p><w:r><w:t>Informe sintético</w:t></w:r></w:p>', extra=None,
            rels=(), root_rels=None, raw_document=None):
    files = {'word/document.xml': (raw_document if raw_document is not None else
        f'<w:document xmlns:w="{worker.W}" xmlns:r="{worker.R}" xmlns:a="{worker.A}"><w:body>{body}</w:body></w:document>'.encode(), worker.MAIN)}
    files.update(extra or {})
    root = ET.Element('{' + worker.P + '}Relationships')
    for attributes in (root_rels if root_rels is not None else
                       [{'Id': 'root', 'Type': worker.R + '/officeDocument', 'Target': 'word/document.xml'}]):
        ET.SubElement(root, '{' + worker.P + '}Relationship', attributes)
    files['_rels/.rels'] = (ET.tostring(root), worker.REL)
    if rels:
        tree = ET.Element('{' + worker.P + '}Relationships')
        for attributes in rels: ET.SubElement(tree, '{' + worker.P + '}Relationship', attributes)
        files['word/_rels/document.xml.rels'] = (ET.tostring(tree), worker.REL)
    types = ET.Element('{' + worker.C + '}Types')
    for name, (_, mime) in files.items():
        ET.SubElement(types, '{' + worker.C + '}Override', {'PartName': '/' + name, 'ContentType': mime})
    result = {'[Content_Types].xml': ET.tostring(types), **{k: v[0] for k, v in files.items()}}
    return pack(result)


def pack(files):
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name, raw in files.items(): archive.writestr(name, raw)
    return out.getvalue()


def unpack(data):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        return {name: archive.read(name) for name in archive.namelist()}


def relation(target, kind='hyperlink', mode='External', rid='r1'):
    return {'Id': rid, 'Type': worker.R + '/' + kind, 'Target': target, 'TargetMode': mode}


def picture(format='PNG', size=(2, 2)):
    result = io.BytesIO()
    with Image.new('RGB', size, 'white') as image: image.save(result, format=format)
    return result.getvalue()


class DocxValidationTests(unittest.TestCase):
    def rejected(self, data, status=422):
        with self.assertRaises(HTTPException) as caught: docx.validar_docx(data)
        self.assertEqual(caught.exception.status_code, status)

    def test_real_sandbox_accepts_text_tables_styles_comments_changes_and_preserves_bytes(self):
        styles = f'<w:styles xmlns:w="{worker.W}"><w:style w:type="paragraph" w:styleId="Normal"/></w:styles>'.encode()
        comments = f'<w:comments xmlns:w="{worker.W}"><w:comment w:id="0" w:author="Sintético"><w:p><w:r><w:t>Comentario</w:t></w:r></w:p></w:comment></w:comments>'.encode()
        header = f'<w:hdr xmlns:w="{worker.W}"><w:p><w:r><w:t>Encabezado</w:t></w:r></w:p></w:hdr>'.encode()
        data = fixture(body='<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Tabla</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
            '<w:p><w:ins w:id="1" w:author="Sintético"><w:r><w:t>Nuevo</w:t></w:r></w:ins>'
            '<w:del w:id="2" w:author="Sintético"><w:r><w:delText>Anterior</w:delText></w:r></w:del></w:p>'
            '<w:sectPr><w:headerReference w:type="default" r:id="header"/></w:sectPr>',
            extra={'word/styles.xml': (styles, worker.WORD_TYPES['styles']),
                   'word/comments.xml': (comments, worker.WORD_TYPES['comments']),
                   'word/header1.xml': (header, worker.WORD_TYPES['header'])},
            rels=[relation('styles.xml','styles','Internal','styles'),
                  relation('comments.xml','comments','Internal','comments'),
                  relation('header1.xml','header','Internal','header')])
        original = bytes(data)
        self.assertEqual(docx.validar_docx(data), hashlib.sha256(original).hexdigest())
        self.assertEqual(data, original)

    def test_permitted_hyperlinks_and_bookmarks_do_not_need_network(self):
        for uri in ['https://example.invalid/informe', 'http://example.invalid', 'mailto:academic@example.invalid']:
            with self.subTest(uri=uri):
                data = fixture('<w:p><w:hyperlink r:id="r1"><w:r><w:t>Referencia</w:t></w:r></w:hyperlink><w:hyperlink w:anchor="local"/></w:p>', rels=[relation(uri)])
                self.assertEqual(docx.validar_docx(data), hashlib.sha256(data).hexdigest())

    def test_png_and_jpeg_decode_in_real_sandbox(self):
        for kind, mime in [('PNG','image/png'), ('JPEG','image/jpeg')]:
            data = fixture('<w:p><w:r><w:drawing><a:blip r:embed="r1"/></w:drawing></w:r></w:p>',
                           extra={'word/media/image': (picture(kind), mime)},
                           rels=[relation('media/image', 'image', 'Internal')])
            self.assertEqual(docx.validar_docx(data), hashlib.sha256(data).hexdigest())

    def test_empty_invalid_and_too_large(self):
        self.rejected(b''); self.rejected(b'not a zip'); self.rejected(b'x' * (docx.MAX_BYTES + 1), 413)
        self.rejected(fixture()[:-5])
        files = unpack(fixture()); files['word/document.xml'] = b'not XML'; self.rejected(pack(files))

    def test_zip_duplicates_traversal_symlink_encryption_and_bad_crc(self):
        base = unpack(fixture())
        for name in ['../escape.xml','/absolute.xml','word/../alias.xml','word\\bad.xml','word/%2e%2e/bad.xml','word/Document.xml']:
            with self.subTest(name=name): self.rejected(pack({**base, name: b'x'}))
        out = io.BytesIO()
        with zipfile.ZipFile(out,'w') as archive:
            for name, data in base.items(): archive.writestr(name,data)
            with self.assertWarns(UserWarning): archive.writestr('word/document.xml', b'x')
        self.rejected(out.getvalue())
        out = io.BytesIO()
        with zipfile.ZipFile(out,'w') as archive:
            item=zipfile.ZipInfo('link'); item.create_system=3; item.external_attr=(0o120777 << 16)
            archive.writestr(item,'/etc/passwd')
        self.rejected(out.getvalue())
        encrypted=bytearray(fixture())
        local=encrypted.find(b'PK\x03\x04'); central=encrypted.find(b'PK\x01\x02')
        encrypted[local+6] |= 1; encrypted[central+8] |= 1; self.rejected(bytes(encrypted))
        corrupt=bytearray(fixture()); central=corrupt.find(b'PK\x01\x02')
        corrupt[central+16] ^= 255; self.rejected(bytes(corrupt))

    def test_zip_expansion_and_entry_count_are_bounded(self):
        self.rejected(pack({'bomb': b'x'*(worker.MAX_ENTRY+1)}))
        self.rejected(pack({f'p{i}':b'' for i in range(worker.MAX_ENTRIES+1)}))
        with patch.object(worker,'MAX_TOTAL',100):
            with self.assertRaises(ValueError): worker.package(pack({'a':b'x'*60,'b':b'y'*60}))

    def test_dtd_entities_malformed_xml_depth_size_and_node_budgets(self):
        for raw in [b'<!DOCTYPE document [<!ENTITY x "boom">]><document>&x;</document>',
                    b'<!DOCTYPE document SYSTEM "file:///etc/passwd"><document/>', b'<broken>']:
            self.rejected(fixture(raw_document=raw))
        self.rejected(fixture(raw_document=(f'<w:document xmlns:w="{worker.W}">'+'<w:p>'*128+'</w:p>'*128+'</w:document>').encode()))
        self.rejected(fixture(raw_document=b' '*(worker.MAX_XML+1)))
        with patch.object(worker,'MAX_NODES',2):
            with self.assertRaises(ValueError): worker.validate(fixture())

    def test_active_parts_and_macro_content_types_are_rejected(self):
        for mime in ['application/vnd.ms-office.vbaProject','application/vnd.ms-word.document.macroEnabled.main+xml',
                     'application/vnd.ms-office.activeX+xml','application/vnd.openxmlformats-officedocument.oleObject','application/octet-stream']:
            self.rejected(fixture(extra={'word/evil.bin':(b'payload',mime)}))
        for tag in ['object','control','altChunk','attachedTemplate','subDoc']:
            self.rejected(fixture(f'<w:{tag}/>'))

    def test_external_resources_cannot_disguise_themselves_as_hyperlinks(self):
        for kind in ['image','attachedTemplate','aFChunk','oleObject','package']:
            self.rejected(fixture(rels=[relation('https://example.invalid/resource',kind)]))
        self.rejected(fixture('<w:p><a:blip r:link="r1"/></w:p>',rels=[relation('https://example.invalid/a.png')]))
        self.rejected(fixture('<w:p xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"><v:imagedata o:relid="r1"/></w:p>',rels=[relation('https://example.invalid/a.png')]))
        for uri in ['file:///etc/passwd','javascript:alert(1)','data:text/plain,x','//example.invalid/x','https://user:secret@example.invalid','https://example.invalid/\nresource']:
            self.rejected(fixture(rels=[relation(uri)]))

    def test_fields_split_across_runs_and_deleted_text_are_checked(self):
        for command in ['DDEAUTO','DDE','INCLUDETEXT','INCLUDEPICTURE','LINK','DATABASE']:
            parts=command[:3],command[3:]
            body=f'<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>{parts[0]}</w:instrText></w:r><w:r><w:instrText>{parts[1]} "https://example.invalid"</w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>'
            self.rejected(fixture(body))
            self.rejected(fixture(body.replace('instrText','delInstrText')))
            self.rejected(fixture(f'<w:fldSimple w:instr="{command} resource"/>'))
        data=fixture('<w:p><w:fldSimple w:instr="PAGE"/><w:fldSimple w:instr="HYPERLINK &quot;https://example.invalid&quot;"/></w:p>')
        self.assertEqual(docx.validar_docx(data),hashlib.sha256(data).hexdigest())

    def test_invalid_images_and_pixel_bombs_are_rejected(self):
        for raw,mime in [(b'not PNG','image/png'),(picture('JPEG'),'image/png'),(picture()[:-8],'image/png'),(picture('JPEG')[:-8],'image/jpeg')]:
            self.rejected(fixture(extra={'word/media/image':(raw,mime)},rels=[relation('media/image','image','Internal')]))
        with patch.object(worker,'MAX_IMAGE_PIXELS',1):
            with self.assertRaises(Image.DecompressionBombError): worker.image(picture(),'image/png',[0])

    def test_processing_instructions_and_embedded_binary_word_markup_are_rejected(self):
        raw=f'<?xml-stylesheet href="https://example.invalid/style"?><w:document xmlns:w="{worker.W}"><w:body/></w:document>'.encode()
        self.rejected(fixture(raw_document=raw))
        self.rejected(fixture('<w:binData>ZXhlY3V0YWJsZQ==</w:binData>'))

    def test_opc_relationship_integrity_and_strict_namespace_are_rejected(self):
        self.rejected(fixture(rels=[relation('../escape.xml','styles','Internal')]))
        self.rejected(fixture('<w:hyperlink r:id="missing"/>'))
        self.rejected(fixture(extra={'word/orphan.xml':(f'<w:styles xmlns:w="{worker.W}"/>'.encode(),worker.WORD_TYPES['styles'])}))
        self.rejected(fixture(raw_document=b'<document xmlns="http://purl.oclc.org/ooxml/wordprocessingml/main"><body/></document>'))
        self.rejected(fixture(root_rels=[]))


class DocxIsolationTests(unittest.TestCase):
    def probe(self, code):
        # Keep the actual worker bootstrap and its resource limits; substitute only parsing.
        source=Path(worker.__file__).read_text()
        source=source.replace('def main():','def _probe():\n'+textwrap.indent(code,'    ')+'\n\ndef main():')
        source=source.replace('validate(sys.stdin.buffer.read(MAX_BYTES + 1))','_probe()')
        with tempfile.TemporaryDirectory(prefix='docx-probe-') as directory:
            path=Path(directory)/'probe.py'; path.write_text(source)
            docx._execute(b'probe',path)

    def test_real_sandbox_hides_home_backend_secret_environment_and_host_network(self):
        net=os.readlink('/proc/self/ns/net')
        with tempfile.TemporaryDirectory(prefix='docx-sensitive-') as directory:
            secret=Path(directory)/'secret'; secret.write_text('synthetic')
            with patch.dict(os.environ,{'DOCX_SYNTHETIC_SECRET':'not-for-worker'}):
                self.probe(f"""import os, socket
assert os.getenv('DOCX_SYNTHETIC_SECRET') is None
assert not os.path.exists({str(secret)!r})
assert not os.path.exists('/home/chipo')
assert not os.path.exists({str(Path.cwd())!r})
assert os.readlink('/proc/self/ns/net') != {net!r}
assert os.geteuid() != 0 or not os.path.exists('/home')
with socket.socket() as connection:
    connection.settimeout(.2)
    try: connection.connect(('192.0.2.1',9))
    except OSError: pass
    else: raise AssertionError('network allowed')
""")

    def test_real_resource_limits(self):
        self.probe('''import resource
assert resource.getrlimit(resource.RLIMIT_AS)==(512*1024*1024,)*2
assert resource.getrlimit(resource.RLIMIT_CPU)==(5,5)
assert resource.getrlimit(resource.RLIMIT_CORE)==(0,0)
assert resource.getrlimit(resource.RLIMIT_FSIZE)==(0,0)
''')

    def test_timeout_and_output_limit_are_controlled(self):
        with patch.object(docx,'WALL_SECONDS',2):
            with self.assertRaises(HTTPException) as caught: self.probe('import time\ntime.sleep(5)')
        self.assertEqual(caught.exception.status_code,422)
        with self.assertRaises(HTTPException) as caught: self.probe('print("x"*1000,flush=True)')
        self.assertEqual(caught.exception.status_code,503)

    def test_memory_limit_rejects_without_crashing_parent(self):
        with self.assertRaises(HTTPException) as caught: self.probe('payload=bytearray(600*1024*1024)')
        self.assertEqual(caught.exception.status_code,422)
        data=fixture()
        self.assertEqual(docx.validar_docx(data),hashlib.sha256(data).hexdigest())

    def test_cpu_limit_terminates_a_busy_worker(self):
        with self.assertRaises(HTTPException) as caught: self.probe('while True: pass')
        self.assertEqual(caught.exception.status_code,422)

    def test_two_real_workers_hold_the_capacity_and_third_is_rejected(self):
        from concurrent.futures import ThreadPoolExecutor
        from threading import Barrier, Event
        gate=Barrier(3); release=Event(); execute=docx._execute; data=fixture()
        def held(payload):
            gate.wait(timeout=10)
            if not release.wait(timeout=10): raise AssertionError('test barrier timed out')
            return execute(payload)
        with ThreadPoolExecutor(max_workers=2) as pool, patch.object(docx,'_execute',side_effect=held):
            futures=[pool.submit(docx.validar_docx,data) for _ in range(2)]
            try:
                gate.wait(timeout=10)
                with self.assertRaises(HTTPException) as caught: docx.validar_docx(data)
                self.assertEqual(caught.exception.status_code,429)
            finally: release.set()
            for future in futures: self.assertEqual(future.result(timeout=15),hashlib.sha256(data).hexdigest())

    def test_sandbox_start_failure_never_falls_back(self):
        with patch.object(docx.subprocess,'Popen',side_effect=OSError('sandbox denied')) as launch:
            with self.assertRaises(HTTPException) as caught: docx.validar_docx(fixture())
        self.assertEqual(caught.exception.status_code,503); self.assertEqual(launch.call_count,1)

    def test_concurrency_refusal_is_controlled_and_semaphore_released(self):
        with patch.object(docx,'_workers') as pool:
            pool.acquire.return_value=False
            with self.assertRaises(HTTPException) as caught: docx.validar_docx(fixture())
            self.assertEqual(caught.exception.status_code,429); pool.release.assert_not_called()
        with patch.object(docx,'_workers') as pool, patch.object(docx,'_execute',side_effect=HTTPException(503,'unavailable')):
            pool.acquire.return_value=True
            with self.assertRaises(HTTPException): docx.validar_docx(fixture())
            pool.release.assert_called_once()


if __name__=='__main__': unittest.main()
