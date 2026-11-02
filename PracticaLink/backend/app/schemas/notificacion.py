from datetime import datetime

from pydantic import BaseModel, Field, field_validator


class NotificacionResponse(BaseModel):
    id_notificacion: int
    id_practica: int | None = None
    tipo: str
    titulo: str
    mensaje: str
    fecha_creacion: datetime
    fecha_leida: datetime | None = None


class NotificacionesResumenResponse(BaseModel):
    notificaciones: list[NotificacionResponse]
    no_leidas: int


class DestinatarioMensajePush(BaseModel):
    id_usuario: int
    nombre: str


class EnviarMensajePushRequest(BaseModel):
    id_usuario: int
    titulo: str = Field(min_length=1, max_length=150)
    mensaje: str = Field(min_length=1, max_length=500)

    @field_validator('titulo', 'mensaje')
    @classmethod
    def quitar_espacios_exteriores(cls, valor: str) -> str:
        valor = valor.strip()
        if not valor:
            raise ValueError('El texto no puede quedar vacío')
        return valor


class EnviarMensajePushResponse(BaseModel):
    id_notificacion: int
    dispositivos_enviados: int
    mensaje: str


class EnviarBroadcastPushRequest(BaseModel):
    titulo: str = Field(min_length=1, max_length=150)
    mensaje: str = Field(min_length=1, max_length=500)

    @field_validator('titulo', 'mensaje')
    @classmethod
    def quitar_espacios_exteriores(cls, valor: str) -> str:
        valor = valor.strip()
        if not valor:
            raise ValueError('El texto no puede quedar vacío')
        return valor


class EnviarBroadcastPushResponse(BaseModel):
    destinatarios: int
    dispositivos_enviados: int
    mensaje: str
