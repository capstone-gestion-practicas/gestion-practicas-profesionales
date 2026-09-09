from pydantic import BaseModel, Field, field_validator

from app.schemas.validators import normalizar_rut


class PerfilEstudianteCreate(BaseModel):
    rut: str = Field(min_length=8, max_length=12)
    carrera: str = Field(min_length=2, max_length=150)
    sede: str = Field(min_length=2, max_length=100)
    telefono: str | None = Field(default=None, max_length=20)
    direccion: str | None = Field(default=None, max_length=255)

    @field_validator("carrera", "sede", mode="before")
    @classmethod
    def limpiar_obligatorios(cls, valor: str) -> str:
        return valor.strip()

    @field_validator("rut", mode="before")
    @classmethod
    def validar_rut(cls, valor: str) -> str:
        return normalizar_rut(valor)


class PerfilEstudianteResponse(BaseModel):
    id_estudiante: int
    mensaje: str
