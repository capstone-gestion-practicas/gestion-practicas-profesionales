import subprocess
import sys
from threading import BoundedSemaphore
from fastapi import HTTPException

_workers = BoundedSemaphore(2)
MAX_BYTES = 10 * 1024 * 1024


def validar_pdf(data: bytes) -> str:
    import hashlib
    if not data:
        raise HTTPException(422, 'El PDF está vacío')
    if len(data) > MAX_BYTES:
        raise HTTPException(413, 'El máximo permitido es 10 MiB')
    if not _workers.acquire(blocking=False):
        raise HTTPException(429, 'Validación ocupada; vuelve a intentar')
    try:
        result = subprocess.run([sys.executable, '-B', '-m', 'app.informes.pdf_worker'],
                                input=data, stdout=subprocess.DEVNULL,
                                stderr=subprocess.DEVNULL, timeout=10, check=False)
    except subprocess.TimeoutExpired:
        raise HTTPException(422, 'PDF demasiado complejo o no permitido') from None
    finally:
        _workers.release()
    if result.returncode == 3:
        raise HTTPException(503, 'Validador PDF no disponible')
    if result.returncode:
        raise HTTPException(422, 'PDF inválido, cifrado o con contenido no permitido')
    return hashlib.sha256(data).hexdigest()
