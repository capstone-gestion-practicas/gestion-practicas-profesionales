from datetime import date, datetime

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

from app.schemas.validators import normalizar_rut


class CentroPracticaCreate(BaseModel):
    nombre: str = Field(min_length=2, max_length=150)
    rut_empresa: str | None = Field(default=None, max_length=12)
    direccion: str | None = Field(default=None, max_length=255)
    telefono: str | None = Field(default=None, max_length=20)
    correo: EmailStr | None = Field(default=None, max_length=150)
    contacto_nombre: str | None = Field(default=None, max_length=100)
    contacto_cargo: str | None = Field(default=None, max_length=100)

    @field_validator("correo", mode="before")
    @classmethod
    def normalizar_correo(cls, valor: str | None) -> str | None:
        if valor is None:
            return None
        limpio = valor.strip().lower()
        return limpio or None

    @field_validator("rut_empresa", mode="before")
    @classmethod
    def validar_rut_empresa(cls, valor: str | None) -> str | None:
        if valor is None or not valor.strip():
            return None
        return normalizar_rut(valor)


class PracticaCreate(BaseModel):
    centro: CentroPracticaCreate
    fecha_inicio: date | None = None
    fecha_termino: date | None = None
    horas: int | None = Field(default=None, gt=0)
    cargo_funcion: str | None = Field(default=None, max_length=150)
    descripcion: str | None = None

    @model_validator(mode="after")
    def validar_fechas(self):
        if (
            self.fecha_inicio is not None
            and self.fecha_termino is not None
            and self.fecha_termino < self.fecha_inicio
        ):
            raise ValueError(
                "La fecha de término no puede ser anterior a la fecha de inicio"
            )
        return self


class PracticaCreateResponse(BaseModel):
    id_practica: int
    id_centro: int
    estado: str
    mensaje: str


class EstadoPracticaLectura(BaseModel):
    id_estado: int
    nombre: str
    es_final: bool


class CentroPracticaLectura(BaseModel):
    id_centro: int
    nombre: str
    rut_empresa: str | None = None
    direccion: str | None = None
    telefono: str | None = None
    correo: EmailStr | None = None
    contacto_nombre: str | None = None
    contacto_cargo: str | None = None


class PracticaDetalleResponse(BaseModel):
    id_practica: int
    fecha_registro: datetime
    estado: EstadoPracticaLectura
    centro_practica: CentroPracticaLectura
    fecha_inicio: date | None = None
    fecha_termino: date | None = None
    horas: int | None = None
    cargo_funcion: str | None = None
    descripcion: str | None = None
