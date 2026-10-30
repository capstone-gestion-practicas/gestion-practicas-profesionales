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


class ResponsableSeguimiento(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id_usuario: Identificador
    nombre: str


class SeguimientoHistorialItem(BaseModel):
    # Lectura histórica: no heredar límites ni catálogo del contrato de creación.
    model_config = ConfigDict(extra='forbid')
    id_seguimiento: Identificador
    fecha: date
    tipo: str | None
    observacion: str
    responsable: ResponsableSeguimiento

    @field_validator('fecha', mode='before')
    @classmethod
    def fecha_calendario(cls, value):
        return SeguimientoDatos.fecha_calendario(value)


class SeguimientosHistorialResponse(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id_practica: Identificador
    items: list[SeguimientoHistorialItem]
    limit: int = Field(strict=True, ge=1, le=100)
    offset: int = Field(strict=True, ge=0, le=9223372036854775807)
    hay_mas: bool = Field(strict=True)
