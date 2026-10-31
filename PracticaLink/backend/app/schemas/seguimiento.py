from datetime import date, datetime

from pydantic import BaseModel, Field, field_validator


class SeguimientoCreate(BaseModel):
    fecha: date | None = None
    observacion: str = Field(min_length=1, max_length=5000)

    @field_validator("observacion", mode="before")
    @classmethod
    def limpiar_observacion(cls, valor: str) -> str:
        if not isinstance(valor, str) or not valor.strip():
            raise ValueError("Debe ingresar una observación")
        return valor.strip()


class SeguimientoResponse(BaseModel):
    id_seguimiento: int
    id_practica: int
    id_usuario: int
    usuario: str
    fecha: datetime
    observacion: str
