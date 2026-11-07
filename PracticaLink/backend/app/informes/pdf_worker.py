"""Untrusted PDF parser in a bounded subprocess, never in the API process."""
import io
import resource
import sys


def validate(data: bytes) -> None:
    from pypdf import PdfReader
    from pypdf.generic import ArrayObject, DictionaryObject, IndirectObject, StreamObject
    reader = PdfReader(io.BytesIO(data), strict=True)
    if reader.is_encrypted or not reader.pages:
        raise ValueError('PDF cifrado o sin páginas')
    forbidden = {'/A', '/Action', '/JS', '/JavaScript', '/AA', '/OpenAction', '/Launch', '/EmbeddedFiles',
                 '/EmbeddedFile', '/RichMedia', '/XFA', '/AcroForm', '/URI', '/SubmitForm',
                 '/ImportData', '/GoToR', '/GoToE', '/Sound', '/Movie', '/Rendition', '/Filespec'}
    visited: set[tuple[int, int]] = set()
    total = 0
    def walk(obj, depth=0):
        nonlocal total
        if depth > 80:
            raise ValueError('PDF demasiado complejo')
        if isinstance(obj, IndirectObject):
            key = (obj.idnum, obj.generation)
            if key in visited:
                return
            visited.add(key)
            if len(visited) > 10000:
                raise ValueError('Demasiados objetos')
            obj = obj.get_object()
        if isinstance(obj, DictionaryObject):
            if forbidden.intersection(str(key) for key in obj.keys()):
                raise ValueError('Contenido activo no permitido')
            if str(obj.get('/Type')) in forbidden or str(obj.get('/S')) in forbidden:
                raise ValueError('Contenido activo no permitido')
            if isinstance(obj, StreamObject):
                total += len(obj.get_data())
                if total > 32 * 1024 * 1024:
                    raise ValueError('Contenido expandido excesivo')
            for item in obj.values():
                walk(item, depth + 1)
        elif isinstance(obj, ArrayObject):
            for item in obj:
                walk(item, depth + 1)
    walk(reader.trailer)
    # Validate unreferenced objects too; never accept only a valid header/catalog.
    for generation, offsets in reader.xref.items():
        for number in offsets:
            if number:
                walk(IndirectObject(number, generation, reader))
    for number in reader.xref_objStm:
        walk(IndirectObject(number, 0, reader))
    for page in reader.pages:
        contents = page.get_contents()
        if contents is not None:
            contents.operations


if __name__ == '__main__':
    resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_CPU, (5, 5))
    try:
        import pypdf
    except ImportError:
        sys.exit(3)
    try:
        data = sys.stdin.buffer.read(10485761)
        if not data or len(data) > 10485760 or not data.startswith(b'%PDF-') or not data.rstrip().endswith(b'%%EOF'):
            raise ValueError('Tamaño no permitido')
        validate(data)
    except Exception:
        sys.exit(1)
