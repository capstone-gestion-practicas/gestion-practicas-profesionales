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


# Lectura histórica independiente de las validaciones de creación.
# PostgreSQL permite timestamps infinitos; conservarlos sin inventar fechas.
FechaIncidenciaHistorica = AwareDatetime | Literal['infinity', '-infinity']


class ResolucionIncidencia(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id_historial: Identificador
    id_usuario: Identificador
    fecha: FechaIncidenciaHistorica
    comentario: str | None


class IncidenciaHistorialItem(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id_incidencia: Identificador
    id_practica: Identificador
    id_usuario: Identificador
    tipo: str | None
    descripcion: str
    estado: str
    fecha: FechaIncidenciaHistorica
    sin_tipo_registrado: bool = Field(strict=True)
    fecha_resolucion: FechaIncidenciaHistorica | None
    resolucion: ResolucionIncidencia | None


class IncidenciasHistorialResponse(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id_practica: Identificador
    items: list[IncidenciaHistorialItem]
    limit: int = Field(strict=True, ge=1, le=100)
    offset: int = Field(strict=True, ge=0, le=9223372036854775807)
    hay_mas: bool = Field(strict=True)
