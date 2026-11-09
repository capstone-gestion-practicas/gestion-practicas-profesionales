"""Closed format mapping and shared parser capacity for HTTP deliveries."""
from dataclasses import dataclass
from threading import BoundedSemaphore
from fastapi import HTTPException
from app.informes.pdf import validar_pdf
from app.informes.docx import validar_docx

MAX_BYTES = 10 * 1024 * 1024
FORMATS = {
    'PDF': ('application/pdf', '.pdf'),
    'DOCX': ('application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx'),
}
_capacity = BoundedSemaphore(2)


def from_mime(mime: str) -> str:
    for name, (value, _) in FORMATS.items():
        if mime == value:
            return name
    raise HTTPException(415, 'Solo se admiten PDF y DOCX Transitional')


def check_name(name: str, formato: str):
    if (formato not in FORMATS or not name.lower().endswith(FORMATS[formato][1])
            or not 1 <= len(name) <= 200 or any(ord(c) < 32 or ord(c) == 127 for c in name)
            or '/' in name or '\\' in name):
        raise HTTPException(422, 'Nombre incompatible con el formato del informe')


def validate(data: bytes, formato: str) -> str:
    if not _capacity.acquire(blocking=False):
        raise HTTPException(429, 'Validación ocupada; vuelve a intentar')
    try:
        return {'PDF': validar_pdf, 'DOCX': validar_docx}[formato](data)
    finally:
        _capacity.release()


def metadata(formato: str, mime: str | None = None) -> tuple[str, str]:
    if formato not in FORMATS or (mime is not None and mime != FORMATS[formato][0]):
        raise HTTPException(503, 'Metadatos del informe no disponibles')
    return FORMATS[formato]


@dataclass(frozen=True)
class Download:
    data: bytes
    formato: str
    mime_type: str
