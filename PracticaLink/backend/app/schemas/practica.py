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
    horas_semanales: int | None = Field(default=None, ge=1, le=45)
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


class EstadoPracticaDetalle(BaseModel):
    id_estado: int
    nombre: str
    descripcion: str | None = None
    es_final: bool


class CentroPracticaDetalle(BaseModel):
    id_centro: int
    nombre: str
    rut_empresa: str | None = None
    direccion: str | None = None
    telefono: str | None = None
    correo: str | None = None
    contacto_nombre: str | None = None
    contacto_cargo: str | None = None


class PracticaDetalleResponse(BaseModel):
    id_practica: int
    fecha_registro: datetime
    fecha_actualizacion: datetime
    estado: EstadoPracticaDetalle
    centro_practica: CentroPracticaDetalle
    fecha_inicio: date | None = None
    fecha_termino: date | None = None
    horas: int | None = None
    horas_semanales: int | None = None
    cargo_funcion: str | None = None
    descripcion: str | None = None


class PracticaEstadoResumen(BaseModel):
    id_practica: int
    fecha_registro: datetime
    fecha_actualizacion: datetime
    id_estado: int
    estado: str
    descripcion_estado: str | None = None
    es_final: bool
    estudiante: str
    rut_estudiante: str
    centro_practica: str
    fecha_inicio: date | None = None
    fecha_termino: date | None = None
    horas_semanales: int | None = None


class EstudianteSinPractica(BaseModel):
    id_usuario: int
    nombre: str
    apellido: str
    tiene_perfil: bool
    tiene_practica: bool
    recordatorio_enviado_hoy: bool


class RecordatorioEstudianteResponse(BaseModel):
    id_usuario: int
    mensaje: str
    recordatorio_enviado_hoy: bool


class ActualizarEstadoPracticaRequest(BaseModel):
    id_estado: int = Field(gt=0)
    observacion: str | None = Field(default=None, max_length=500)

    @field_validator("observacion", mode="before")
    @classmethod
    def limpiar_observacion(cls, valor: str | None) -> str | None:
        if valor is None:
            return None
        limpio = valor.strip()
        return limpio or None


class ResponderObservacionPracticaRequest(BaseModel):
    respuesta: str = Field(min_length=1, max_length=500)

    @field_validator("respuesta", mode="before")
    @classmethod
    def limpiar_respuesta(cls, valor: str) -> str:
        if not isinstance(valor, str):
            raise ValueError("Debe ingresar una respuesta")
        limpio = valor.strip()
        if not limpio:
            raise ValueError("Debe ingresar una respuesta")
        return limpio


class ActualizarEstadoPracticaResponse(BaseModel):
    id_practica: int
    id_estado: int
    estado: str
    mensaje: str


class HistorialEstadoPractica(BaseModel):
    id_historial: int
    id_practica: int
    id_estado: int
    estado: str
    es_final: bool
    id_usuario: int
    usuario: str
    fecha_cambio: datetime
    observacion: str | None = None


class EstadoPracticaActualResponse(BaseModel):
    id_practica: int
    fecha_actualizacion: datetime
    estado: EstadoPracticaDetalle
