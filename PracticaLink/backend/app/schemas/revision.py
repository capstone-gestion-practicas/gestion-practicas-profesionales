from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class SolicitudRevisionResumen(BaseModel):
    id_practica: int
    fecha_registro: datetime
    estado: str
    estudiante: str
    rut_estudiante: str
    centro_practica: str


class SolicitudRevisionDetalle(SolicitudRevisionResumen):
    correo_estudiante: str
    carrera: str
    sede: str
    rut_empresa: str | None = None
    direccion_empresa: str | None = None
    correo_empresa: str | None = None
    contacto_nombre: str | None = None
    contacto_cargo: str | None = None
    fecha_inicio: date | None = None
    fecha_termino: date | None = None
    horas: int | None = None
    cargo_funcion: str | None = None
    descripcion: str | None = None


class DecisionRevisionRequest(BaseModel):
    decision: Literal["APROBADA", "OBSERVADA", "RECHAZADA"]
    observacion: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def validar_observacion(self):
        if (
            self.decision in {"OBSERVADA", "RECHAZADA"}
            and not (self.observacion or "").strip()
        ):
            raise ValueError("Debe ingresar una observación")
        return self


class DecisionRevisionResponse(BaseModel):
    id_practica: int
    estado: str
    mensaje: str
