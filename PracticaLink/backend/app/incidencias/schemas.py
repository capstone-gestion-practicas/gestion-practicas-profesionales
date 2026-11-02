from typing import Annotated, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator, model_validator


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


class PracticaIncidenciasPendientesItem(BaseModel):
    # pendientes cuenta solo estado PENDIENTE; en_atencion se informa aparte.
    model_config = ConfigDict(extra='forbid')
    id_practica: Identificador
    pendientes: int = Field(strict=True, ge=1)
    en_atencion: int = Field(strict=True, ge=0)
    fecha_pendiente_antigua: AwareDatetime


class ResumenIncidenciasPendientesResponse(BaseModel):
    model_config = ConfigDict(extra='forbid')
    items: list[PracticaIncidenciasPendientesItem]
    limit: int = Field(strict=True, ge=1, le=100)
    offset: int = Field(strict=True, ge=0, le=9223372036854775807)
    hay_mas: bool = Field(strict=True)


EstadoIncidencia = Literal['PENDIENTE', 'EN_ATENCION', 'RESUELTA']


class IncidenciaEstadoRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    estado_esperado: EstadoIncidencia
    estado_nuevo: EstadoIncidencia
    comentario: str | None = Field(default=None, strict=True)

    @field_validator('comentario')
    @classmethod
    def normalizar_comentario(cls, value):
        # Convención SQL btrim: retirar únicamente espacios U+0020 de borde.
        if value is None:
            return None
        value = value.strip(' ')
        if not value.strip():
            return None
        if len(value) > 2000:
            raise ValueError('El comentario debe tener como máximo 2000 caracteres')
        return value

    @model_validator(mode='after')
    def comentario_resolucion(self):
        if self.estado_nuevo == 'RESUELTA' and self.comentario is None:
            raise ValueError('Resolver requiere un comentario con contenido')
        return self


class IncidenciaEstadoResponse(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id_incidencia: Identificador
    id_practica: Identificador
    id_historial: Identificador
    estado_anterior: EstadoIncidencia
    estado_nuevo: EstadoIncidencia
    id_usuario: Identificador
    comentario: str | None = Field(strict=True, max_length=2000)
    fecha: AwareDatetime


class IncidenciaEstadoEvento(BaseModel):
    # Lectura histórica: sin enum ni límite de creación para comentarios.
    model_config = ConfigDict(extra='forbid')
    id_historial: Identificador
    id_usuario: Identificador
    estado_anterior: str | None = Field(strict=True)
    estado_nuevo: str = Field(strict=True)
    fecha: FechaIncidenciaHistorica
    comentario: str | None = Field(strict=True)


class IncidenciaEstadosHistorialResponse(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id_practica: Identificador
    id_incidencia: Identificador
    items: list[IncidenciaEstadoEvento]
    limit: int = Field(strict=True, ge=1, le=100)
    offset: int = Field(strict=True, ge=0, le=9223372036854775807)
    hay_mas: bool = Field(strict=True)
