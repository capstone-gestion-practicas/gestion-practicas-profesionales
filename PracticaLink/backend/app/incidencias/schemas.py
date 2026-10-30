from typing import Annotated, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator


TipoIncidencia = Literal['ABANDONO', 'PROBLEMA_CENTRO', 'SALUD', 'OTRO']
Identificador = Annotated[int, Field(strict=True, ge=1, le=9223372036854775807)]


class IncidenciaCreate(BaseModel):
    model_config = ConfigDict(extra='forbid')

    tipo: TipoIncidencia
    descripcion: str = Field(strict=True, min_length=1, max_length=2000)

    @field_validator('descripcion')
    @classmethod
    def descripcion_con_contenido(cls, value):
        if not value.strip():
            raise ValueError('La descripción debe contener texto')
        return value


class IncidenciaCreateResponse(IncidenciaCreate):
    id_incidencia: Identificador
    id_practica: Identificador
    id_usuario: Identificador
    estado: Literal['PENDIENTE']
    fecha: AwareDatetime
