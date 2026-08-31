from datetime import date

from pydantic import BaseModel, EmailStr, Field, field_validator


class LoginRequest(BaseModel):
    correo: EmailStr
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class RegistroRequest(BaseModel):
    nombre: str = Field(min_length=2, max_length=100)
    apellido: str = Field(min_length=2, max_length=100)
    correo: EmailStr
    password: str = Field(min_length=8, max_length=128)
    @field_validator("nombre", "apellido", mode="before")
    @classmethod
    def limpiar_nombre(cls, valor: str) -> str:
        return valor.strip()


class RegistroResponse(BaseModel):
    id_usuario: int
    nombre: str
    apellido: str
    correo: EmailStr
    rol: str


class UsuarioContext(BaseModel):
    id_usuario: int
    nombre: str
    apellido: str
    correo: EmailStr


class PerfilEstudianteContext(BaseModel):
    id_estudiante: int
    rut: str
    carrera: str
    sede: str


class EstadoPracticaContext(BaseModel):
    id_estado: int
    nombre: str
    es_final: bool


class CentroPracticaContext(BaseModel):
    id_centro: int
    nombre: str


class PracticaActualContext(BaseModel):
    id_practica: int
    estado: EstadoPracticaContext
    centro_practica: CentroPracticaContext
    fecha_inicio: date | None = None
    fecha_termino: date | None = None
    horas: int | None = None
    cargo_funcion: str | None = None


class ContextoUsuarioResponse(BaseModel):
    usuario: UsuarioContext
    roles: list[str]
    perfil: PerfilEstudianteContext | None = None
    practica_actual: PracticaActualContext | None = None
