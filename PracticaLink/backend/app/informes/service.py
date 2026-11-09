import hashlib
from uuid import UUID
from fastapi import HTTPException
from sqlalchemy import text
from app.informes.formats import validate, metadata, check_name, Download
from app.core.sql_errors import sql_http_error


class Informes:
    def __init__(self, db, storage):
        self.db, self.storage = db, storage

    def call(self, name: str, params: dict):
        signatures = {
            'consultar': '(:p,:a)', 'archivo': '(:p,:a)',
            'reservar': '(:p,:a,CAST(:k AS uuid),:v,:h,:n,:b,CAST(:f AS text))',
            'confirmar': '(:p,:a,CAST(:k AS uuid))', 'limpieza': '()'
        }
        try:
            result = self.db.execute(text('SELECT informes_privados.' + name + signatures[name]), params).scalar_one()
            self.db.commit()
            return result
        except Exception as error:
            try:
                self.db.rollback()
            except Exception:
                pass
            raise sql_http_error(error, 'No fue posible completar la operación de informes') from None

    def consultar(self, practica: int, actor: int):
        return self.call('consultar', {'p': practica, 'a': actor})

    def propietario(self, practica: int, actor: int):
        current = self.consultar(practica, actor)
        if current.get('propietario_estudiante') is not True:
            raise HTTPException(403, 'Solo el estudiante propietario puede entregar el informe')
        return current

    def entregar(self, practica: int, actor: int, key: UUID, expected: int, name: str, data: bytes, formato: str = 'PDF'):
        # Reject unauthorized users before spending resources on the parser.
        self.propietario(practica, actor)
        check_name(name, formato)
        digest = validate(data, formato)
        reservation = self.call('reservar', {'p': practica, 'a': actor, 'k': str(key),
            'v': expected, 'h': digest, 'n': name, 'b': len(data), 'f': formato})
        mime, _ = metadata(reservation.get('formato'))
        if reservation['formato'] != formato:
            raise HTTPException(503, 'Metadatos del informe no disponibles')
        if reservation['estado'] != 'CONFIRMADA':
            try:
                self.storage.put(reservation['objeto'], data, digest, mime)
            except HTTPException:
                raise
            except Exception:
                raise HTTPException(503, 'No fue posible almacenar el informe; puedes reintentar la misma entrega') from None
            # No inline compensation: an ambiguous commit may already be confirmed.
            reservation = self.call('confirmar', {'p': practica, 'a': actor, 'k': str(key)})
        return {'id_entrega': str(key), 'id_documento': reservation['id_documento'],
                'version': reservation['version'], 'fecha': reservation['confirmada'], 'estado': 'ENTREGADO', 'formato': formato, 'mime_type': mime}

    def descargar(self, practica: int, actor: int):
        params = {'p': practica, 'a': actor}
        item = self.call('archivo', params)
        mime, _ = metadata(item.get('formato'), item.get('mime_type'))
        if item.get('mime_type') != mime:
            raise HTTPException(503, 'Metadatos del informe no disponibles')
        try:
            self.storage.verify(mime)
            data = self.storage.read(item['objeto'])
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(503, 'No fue posible descargar el informe') from None
        if len(data) != item['tamano'] or hashlib.sha256(data).hexdigest() != item['sha256']:
            raise HTTPException(503, 'No fue posible verificar la integridad del informe')
        # Recheck current assignment/version after the external IO, before releasing bytes.
        current = self.call('archivo', params)
        if current != item:
            raise HTTPException(409, 'El informe vigente cambió; vuelve a consultar')
        return Download(data, item['formato'], mime)

    def limpiar(self):
        keys = self.call('limpieza', {})
        failed = 0
        for key in keys:
            try:
                self.storage.delete(key)
            except Exception:
                failed += 1
        return {'procesadas': len(keys), 'fallidas': failed}
