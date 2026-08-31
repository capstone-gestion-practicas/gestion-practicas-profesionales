from pydantic import BaseModel, EmailStr, Field, field_validator


class RolResponse(BaseModel):
    id_rol: int
    nombre: str
    descripcion: str | None = None


class UsuarioResponse(BaseModel):
    id_usuario: int
    nombre: str
    apellido: str
    correo: EmailStr
    activo: bool
    roles: list[str]


class UsuarioCrearRequest(BaseModel):
    nombre: str = Field(min_length=2, max_length=100)
    apellido: str = Field(min_length=2, max_length=100)
    correo: EmailStr
    password: str = Field(min_length=8, max_length=128)
    roles: list[str] = Field(min_length=1)

    @field_validator("nombre", "apellido", mode="before")
    @classmethod
    def limpiar_texto(cls, valor: str) -> str:
        return valor.strip()

    @field_validator("roles")
    @classmethod
    def normalizar_roles(cls, roles: list[str]) -> list[str]:
        normalizados = sorted({rol.strip().upper() for rol in roles if rol.strip()})
        if not normalizados:
            raise ValueError("Debe indicar al menos un rol")
        return normalizados


class UsuarioActualizarRequest(BaseModel):
    nombre: str = Field(min_length=2, max_length=100)
    apellido: str = Field(min_length=2, max_length=100)
    activo: bool
    roles: list[str] = Field(min_length=1)

    @field_validator("nombre", "apellido", mode="before")
    @classmethod
    def limpiar_texto(cls, valor: str) -> str:
        return valor.strip()

    @field_validator("roles")
    @classmethod
    def normalizar_roles(cls, roles: list[str]) -> list[str]:
        normalizados = sorted({rol.strip().upper() for rol in roles if rol.strip()})
        if not normalizados:
            raise ValueError("Debe indicar al menos un rol")
        return normalizados


class OperacionUsuarioResponse(BaseModel):
    id_usuario: int
    mensaje: str
