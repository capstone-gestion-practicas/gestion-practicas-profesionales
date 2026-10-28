from datetime import datetime

from pydantic import BaseModel


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
