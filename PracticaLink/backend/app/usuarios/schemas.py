from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

from app.schemas.validators import normalizar_rut


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
    rut_empresa: str | None = None


class UsuarioCrearRequest(BaseModel):
    nombre: str = Field(min_length=2, max_length=100)
    apellido: str = Field(min_length=2, max_length=100)
    correo: EmailStr = Field(max_length=150)
    password: str = Field(min_length=8, max_length=128)
    roles: list[str] = Field(min_length=1)
    rut_empresa: str | None = Field(default=None, max_length=12)

    @field_validator("nombre", "apellido", mode="before")
    @classmethod
    def limpiar_texto(cls, valor: str) -> str:
        return valor.strip()

    @field_validator("correo", mode="before")
    @classmethod
    def normalizar_correo(cls, valor: str) -> str:
        return valor.strip().lower()

    @field_validator("roles")
    @classmethod
    def normalizar_roles(cls, roles: list[str]) -> list[str]:
        normalizados = sorted({rol.strip().upper() for rol in roles if rol.strip()})
        if not normalizados:
            raise ValueError("Debe indicar al menos un rol")
        return normalizados

    @field_validator("rut_empresa", mode="before")
    @classmethod
    def normalizar_rut_empresa(cls, valor: str | None) -> str | None:
        if valor is None:
            return None
        if not isinstance(valor, str):
            raise ValueError("El RUT debe ser texto")
        if not valor.strip():
            return None
        return normalizar_rut(valor)

    @model_validator(mode="after")
    def validar_cuenta_empresa(self):
        if ("EMPRESA" in self.roles) != (self.rut_empresa is not None):
            raise ValueError("Las cuentas EMPRESA requieren un RUT asociado y exclusivo")
        if "EMPRESA" in self.roles and len(self.roles) != 1:
            raise ValueError("El rol EMPRESA debe asignarse de forma exclusiva")
        return self


class UsuarioActualizarRequest(BaseModel):
    nombre: str = Field(min_length=2, max_length=100)
    apellido: str = Field(min_length=2, max_length=100)
    activo: bool
    roles: list[str] = Field(min_length=1)
    rut_empresa: str | None = Field(default=None, max_length=12)

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

    @field_validator("rut_empresa", mode="before")
    @classmethod
    def normalizar_rut_empresa(cls, valor: str | None) -> str | None:
        if valor is None:
            return None
        if not isinstance(valor, str):
            raise ValueError("El RUT debe ser texto")
        if not valor.strip():
            return None
        return normalizar_rut(valor)

    @model_validator(mode="after")
    def validar_cuenta_empresa(self):
        if ("EMPRESA" in self.roles) != (self.rut_empresa is not None):
            raise ValueError("Las cuentas EMPRESA requieren un RUT asociado y exclusivo")
        if "EMPRESA" in self.roles and len(self.roles) != 1:
            raise ValueError("El rol EMPRESA debe asignarse de forma exclusiva")
        return self


class OperacionUsuarioResponse(BaseModel):
    id_usuario: int
    mensaje: str
