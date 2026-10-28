from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator


PrioridadIncidencia = Literal["BAJA", "MEDIA", "ALTA", "CRITICA"]
EstadoIncidencia = Literal["ABIERTA", "EN_REVISION", "RESUELTA", "CERRADA"]


class IncidenciaCreate(BaseModel):
    fecha: date | None = None
    descripcion: str = Field(min_length=1, max_length=5000)
    prioridad: PrioridadIncidencia = "MEDIA"

    @field_validator("descripcion", mode="before")
    @classmethod
    def limpiar_descripcion(cls, valor: str) -> str:
        if not isinstance(valor, str) or not valor.strip():
            raise ValueError("Debe ingresar una descripción")
        return valor.strip()


class ActualizarEstadoIncidenciaRequest(BaseModel):
    estado: EstadoIncidencia


class IncidenciaResponse(BaseModel):
    id_incidencia: int
    id_practica: int
    id_usuario: int
    usuario: str
    fecha: datetime
    descripcion: str
    prioridad: PrioridadIncidencia
    estado: EstadoIncidencia
    fecha_resolucion: datetime | None
    alerta: bool
    estudiante: str | None
    correo_estudiante: str | None
    centro_practica: str | None


class ActualizarEstadoIncidenciaResponse(BaseModel):
    id_incidencia: int
    estado: EstadoIncidencia
    mensaje: str
