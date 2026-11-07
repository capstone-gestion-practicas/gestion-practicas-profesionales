from typing import Annotated
from uuid import UUID
import unicodedata
from fastapi import APIRouter, Depends, Header, HTTPException, Path, Request, Response
from starlette.concurrency import run_in_threadpool
from app.core.security import get_current_user_id
from app.informes.database import get_informe_db
from app.informes.pdf import MAX_BYTES
from app.informes.service import Informes
from app.informes.storage import Storage

router = APIRouter(prefix='/practicas', tags=['Informe final'])
PracticaId = Annotated[int, Path(ge=1, le=9223372036854775807)]


def get_storage():
    return Storage()


def get_service(db=Depends(get_informe_db), storage=Depends(get_storage)):
    return Informes(db, storage)


@router.get('/{id_practica}/informe-final')
def consultar(id_practica: PracticaId, actor: int = Depends(get_current_user_id), service: Informes = Depends(get_service)):
    return service.consultar(id_practica, actor)


@router.post('/{id_practica}/informe-final')
async def entregar(id_practica: PracticaId, request: Request,
                   idempotency_key: Annotated[UUID, Header()],
                   version_esperada: Annotated[int, Header(ge=0, le=9223372036854775807)],
                   nombre_archivo: Annotated[str, Header(min_length=1, max_length=200)],
                   actor: int = Depends(get_current_user_id), service: Informes = Depends(get_service)):
    if request.headers.get('content-type', '').split(';')[0].lower() != 'application/pdf':
        raise HTTPException(415, 'Envía el archivo como application/pdf')
    # Filename is display-only; it never participates in the Storage key.
    from urllib.parse import unquote
    name = unicodedata.normalize('NFC', unquote(nombre_archivo))
    if not name.lower().endswith('.pdf') or len(name)>200 or any(ord(c)<32 for c in name) or '/' in name or '\\' in name:
        raise HTTPException(422, 'Nombre PDF no válido')
    await run_in_threadpool(service.consultar, id_practica, actor)
    data = bytearray()
    async for chunk in request.stream():
        if len(data)+len(chunk)>MAX_BYTES:
            raise HTTPException(413, 'El máximo permitido es 10 MiB')
        data.extend(chunk)
    return await run_in_threadpool(service.entregar, id_practica, actor, idempotency_key, version_esperada, name, bytes(data))


@router.get('/{id_practica}/informe-final/archivo')
def descargar(id_practica: PracticaId, actor: int = Depends(get_current_user_id), service: Informes = Depends(get_service)):
    return Response(service.descargar(id_practica, actor), media_type='application/pdf', headers={
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': 'attachment; filename="informe-final.pdf"'
    })
