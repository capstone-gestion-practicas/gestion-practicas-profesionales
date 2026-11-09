from typing import Annotated
from uuid import UUID
import unicodedata
from fastapi import APIRouter, Depends, Header, HTTPException, Path, Request, Response
from starlette.concurrency import run_in_threadpool
from app.core.security import get_current_user_id
from app.informes.database import get_informe_db
from app.informes.formats import MAX_BYTES, from_mime, check_name, metadata
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
    formato = from_mime(request.headers.get('content-type', '').split(';')[0].strip().lower())
    # Filename is display-only; it never participates in the Storage key.
    from urllib.parse import unquote
    name = unicodedata.normalize('NFC', unquote(nombre_archivo))
    check_name(name, formato)
    await run_in_threadpool(service.propietario, id_practica, actor)
    data = bytearray()
    async for chunk in request.stream():
        if len(data)+len(chunk)>MAX_BYTES:
            raise HTTPException(413, 'El máximo permitido es 10 MiB')
        data.extend(chunk)
    return await run_in_threadpool(service.entregar, id_practica, actor, idempotency_key, version_esperada, name, bytes(data), formato)


@router.get('/{id_practica}/informe-final/archivo')
def descargar(id_practica: PracticaId, actor: int = Depends(get_current_user_id), service: Informes = Depends(get_service)):
    result = service.descargar(id_practica, actor)
    mime, extension = metadata(result.formato, result.mime_type)
    return Response(result.data, media_type=mime, headers={
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': f'attachment; filename="informe-final{extension}"'
    })
