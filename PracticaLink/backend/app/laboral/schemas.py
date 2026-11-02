from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

from app.schemas.validators import normalizar_rut


class OfertaLaboralRequest(BaseModel):
    rut_empresa: str | None = Field(default=None, max_length=12)
    cargo: str = Field(min_length=2, max_length=150)
    descripcion: str = Field(min_length=10, max_length=10000)
    ubicacion: str = Field(min_length=2, max_length=150)
    modalidad: Literal["PRESENCIAL", "HIBRIDA", "REMOTA"]
    requisitos: str = Field(min_length=2, max_length=10000)
    jornada: Literal["COMPLETA", "PARCIAL", "PROYECTO", "PRACTICA"]
    fecha_cierre: date | None = None
    estado: Literal["BORRADOR", "PUBLICADA", "CERRADA"] = "PUBLICADA"

    @field_validator("rut_empresa", mode="before")
    @classmethod
    def normalizar_rut(cls, valor: str | None) -> str | None:
        if valor is None:
            return None
        if not isinstance(valor, str):
            raise ValueError("El RUT debe ser texto")
        if not valor.strip():
            return None
        return normalizar_rut(valor)

    @field_validator("cargo", "descripcion", "ubicacion", "requisitos", mode="before")
    @classmethod
    def limpiar_texto(cls, valor: str) -> str:
        if not isinstance(valor, str):
            raise ValueError("El valor debe ser texto")
        return valor.strip()


class OfertaLaboralResponse(BaseModel):
    id_oferta: int
    rut_empresa: str
    empresa: str
    cargo: str
    descripcion: str
    ubicacion: str
    modalidad: str
    requisitos: str
    jornada: str
    fecha_publicacion: datetime | None = None
    fecha_cierre: date | None = None
    estado: str
    total_postulaciones: int = 0


class OfertaGuardadaResponse(BaseModel):
    id_oferta: int
    rut_empresa: str
    cargo: str
    estado: str
    mensaje: str


class CuentaEmpresaResponse(BaseModel):
    rut_empresa: str


class PracticaEmpresaEstudiante(BaseModel):
    nombre: str
    apellido: str
    correo: str
    rut: str
    carrera: str
    sede: str
    telefono: str | None = None


class PracticaEmpresaResponse(BaseModel):
    id_practica: int
    rut_empresa: str
    centro_practica: str
    estado: str
    fecha_inicio: date | None = None
    fecha_termino: date | None = None
    cargo_funcion: str | None = None
    estudiante: PracticaEmpresaEstudiante


class PostularRequest(BaseModel):
    carta_presentacion: str | None = Field(default=None, max_length=5000)

    @field_validator("carta_presentacion", mode="before")
    @classmethod
    def limpiar_carta(cls, valor: str | None) -> str | None:
        return valor.strip() if valor and valor.strip() else None


class OperacionPostulacionResponse(BaseModel):
    id_postulacion: int
    estado: str
    mensaje: str


class PostulacionEstudianteResponse(BaseModel):
    id_postulacion: int
    id_oferta: int
    empresa: str
    cargo: str
    ubicacion: str
    modalidad: str
    fecha_postulacion: datetime
    estado: str
    carta_presentacion: str | None = None


class PostulacionEmpresaResponse(BaseModel):
    id_postulacion: int
    id_oferta: int
    id_estudiante: int
    nombre: str
    apellido: str
    correo: str
    rut: str
    carrera: str
    sede: str
    carta_presentacion: str | None = None
    estado: str
    fecha_postulacion: datetime


class ActualizarPostulacionRequest(BaseModel):
    estado: Literal["RECIBIDA", "EN_REVISION", "SELECCIONADA", "RECHAZADA"]
    observacion: str | None = Field(default=None, max_length=2000)

    @field_validator("observacion", mode="before")
    @classmethod
    def limpiar_observacion(cls, valor: str | None) -> str | None:
        return valor.strip() if valor and valor.strip() else None


class HistorialPostulacionResponse(BaseModel):
    estado_anterior: str | None = None
    estado_nuevo: str
    observacion: str | None = None
    fecha_cambio: datetime
    usuario: str


class SolicitudCuentaEmpresaRequest(BaseModel):
    razon_social: str = Field(min_length=2, max_length=255)
    rut_empresa: str = Field(max_length=12)
    nombre_contacto: str = Field(min_length=2, max_length=100)
    apellido_contacto: str = Field(min_length=2, max_length=100)
    correo: EmailStr = Field(max_length=150)
    telefono: str = Field(min_length=7, max_length=30)
    cargo_contacto: str = Field(min_length=2, max_length=100)
    password: str = Field(min_length=8, max_length=128)

    @field_validator(
        "razon_social", "nombre_contacto", "apellido_contacto",
        "telefono", "cargo_contacto", mode="before"
    )
    @classmethod
    def limpiar_texto_solicitud(cls, valor: str) -> str:
        if not isinstance(valor, str):
            raise ValueError("El valor debe ser texto")
        return valor.strip()

    @field_validator("rut_empresa", mode="before")
    @classmethod
    def normalizar_rut_empresa(cls, valor: str) -> str:
        if not isinstance(valor, str):
            raise ValueError("El RUT debe ser texto")
        return normalizar_rut(valor)

    @field_validator("correo", mode="before")
    @classmethod
    def normalizar_correo_solicitud(cls, valor: str) -> str:
        return valor.strip().lower()


class SolicitudCuentaEmpresaResponse(BaseModel):
    id_solicitud: int
    estado: str
    mensaje: str


class SolicitudCuentaEmpresaAdminResponse(BaseModel):
    id_solicitud: int
    razon_social: str
    rut_empresa: str
    nombre_contacto: str
    apellido_contacto: str
    correo: EmailStr
    telefono: str
    cargo_contacto: str
    estado: str
    observacion_revision: str | None = None
    fecha_solicitud: datetime
    fecha_revision: datetime | None = None


class ResolverSolicitudCuentaEmpresaRequest(BaseModel):
    estado: Literal["APROBADA", "RECHAZADA"]
    observacion: str | None = Field(default=None, max_length=2000)

    @field_validator("observacion", mode="before")
    @classmethod
    def limpiar_observacion_solicitud(cls, valor: str | None) -> str | None:
        return valor.strip() if valor and valor.strip() else None


class ResolverSolicitudCuentaEmpresaResponse(BaseModel):
    id_solicitud: int
    id_usuario: int | None = None
    estado: Literal["APROBADA", "RECHAZADA"]
    mensaje: str
