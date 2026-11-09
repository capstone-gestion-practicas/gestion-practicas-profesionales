import hashlib
from urllib.parse import quote, urlsplit
import httpx
from fastapi import HTTPException
from app.core.config import settings
from app.informes.formats import MAX_BYTES, FORMATS


class Storage:
    def __init__(self):
        url = settings.informe_storage_url or ''
        parts = urlsplit(url)
        if (parts.scheme != 'https' or not parts.hostname or parts.username or parts.password
                or parts.query or parts.fragment or parts.path not in ('', '/')
                or not settings.informe_storage_key):
            raise HTTPException(503, 'Storage de informes no configurado')
        self.base = url.rstrip('/') + '/storage/v1'
        self.bucket = quote(settings.informe_storage_bucket, safe='')
        self.headers = {'apikey': settings.informe_storage_key,
                        'Authorization': 'Bearer ' + settings.informe_storage_key}

    def _client(self):
        return httpx.Client(headers=self.headers, timeout=30, follow_redirects=False)

    def _path(self, key: str) -> str:
        return f'{self.base}/object/{self.bucket}/{quote(key, safe="/")}'

    def verify(self, mime: str | None = None):
        with self._client() as client:
            r = client.get(f'{self.base}/bucket/{self.bucket}')
            r.raise_for_status()
            bucket = r.json()
            allowed = bucket.get('allowed_mime_types')
            known = {item[0] for item in FORMATS.values()}
            if (bucket.get('public') is not False or not isinstance(allowed, list)
                    or not all(isinstance(value, str) for value in allowed)
                    or set(allowed) not in ({'application/pdf'}, known)
                    or len(allowed) != len(set(allowed))
                    or type(bucket.get('file_size_limit')) is not int
                    or not 0 < bucket['file_size_limit'] <= MAX_BYTES):
                raise HTTPException(503, 'Bucket privado de informes no verificado')
            if mime is not None and mime not in allowed:
                raise HTTPException(503, 'El formato todavía no está habilitado en Storage')

    def read(self, key: str) -> bytes:
        with self._client() as client, client.stream('GET', self._path(key)) as response:
            response.raise_for_status()
            data = bytearray()
            for chunk in response.iter_bytes():
                data.extend(chunk)
                if len(data) > MAX_BYTES:
                    raise HTTPException(503, 'Objeto de informe excede el límite')
            return bytes(data)

    def put(self, key: str, data: bytes, digest: str, mime: str = 'application/pdf'):
        if mime not in {item[0] for item in FORMATS.values()}:
            raise HTTPException(503, 'Formato de almacenamiento no disponible')
        self.verify(mime)
        with self._client() as client:
            response = client.post(self._path(key), content=data,
                                   headers={'Content-Type': mime, 'x-upsert': 'false'})
            if response.status_code not in (200, 201, 400, 409):
                response.raise_for_status()
        # A retry may find an existing immutable object. Never accept a mismatch.
        existing = self.read(key)
        if len(existing) != len(data) or hashlib.sha256(existing).hexdigest() != digest:
            raise HTTPException(409, 'Conflicto de contenido del objeto reservado')

    def delete(self, key: str):
        self.verify()
        with self._client() as client:
            response = client.request('DELETE', f'{self.base}/object/{self.bucket}', json={'prefixes': [key]})
            response.raise_for_status()
