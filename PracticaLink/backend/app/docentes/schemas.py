from datetime import date

from pydantic import BaseModel, ConfigDict, Field, field_validator


class AsignacionDocenteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id_docente: int | None = Field(gt=0)
    motivo: str | None = None

    @field_validator("motivo", mode="before")
    @classmethod
    def limpiar_motivo(cls, valor: str | None) -> str | None:
        if valor is None:
            return None
        limpio = valor.strip()
        return limpio or None


class AsignacionDocenteResponse(BaseModel):
    id_practica: int
    id_docente: int | None = Field(gt=0)
    id_docente_anterior: int | None
    mensaje: str


class PracticaDocenteResponse(BaseModel):
    id_practica: int
    estado: str
    estudiante: str
    centro_practica: str
    fecha_inicio: date | None = None
    fecha_termino: date | None = None
    cargo_funcion: str | None = None
    descripcion: str | None = None


class DocenteDisponible(BaseModel):
    id_usuario: int
    nombre: str
    correo: str


class AsignacionDocenteDetalleResponse(BaseModel):
    id_practica: int
    docente_actual: DocenteDisponible | None
    docentes_disponibles: list[DocenteDisponible]
