import re
from datetime import date, datetime
from typing import Annotated, Literal
from zoneinfo import ZoneInfo

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator


MedioContacto = Literal[
    'Reunión presencial', 'Videollamada', 'Llamada telefónica',
    'Correo electrónico', 'Otro',
]
Identificador = Annotated[int, Field(strict=True, ge=1, le=9223372036854775807)]


def hoy_chile() -> date:
    return datetime.now(ZoneInfo('America/Santiago')).date()


class SeguimientoDatos(BaseModel):
    model_config = ConfigDict(extra='forbid')

    fecha: date
    tipo: MedioContacto
    observacion: str = Field(min_length=1, max_length=2000)

    @field_validator('fecha', mode='before')
    @classmethod
    def fecha_calendario(cls, value):
        if type(value) is date:
            return value
        if isinstance(value, str) and re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}', value):
            return date.fromisoformat(value)
        raise ValueError('La fecha debe ser una fecha calendario YYYY-MM-DD')

    @field_validator('observacion')
    @classmethod
    def observacion_con_contenido(cls, value):
        if not value.strip():
            raise ValueError('La observación debe contener texto')
        # Preservar texto y contar espacios para el máximo, como el contrato SQL.
        return value


class SeguimientoCreate(SeguimientoDatos):
    @field_validator('fecha')
    @classmethod
    def fecha_no_futura(cls, value):
        if value > hoy_chile():
            raise ValueError('La fecha no puede ser futura en America/Santiago')
        return value


class SeguimientoCreateResponse(SeguimientoDatos):
    id_seguimiento: Identificador
    id_practica: Identificador
    id_usuario: Identificador
    fecha_creacion: AwareDatetime
