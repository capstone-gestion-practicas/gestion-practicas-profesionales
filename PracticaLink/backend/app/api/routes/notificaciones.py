from datetime import datetime, timedelta, timezone

import jwt
from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.permissions import require_roles
from app.core.security import get_current_user_id
from app.core.config import settings
from app.schemas.notificacion import (
    DestinatarioMensajePush,
    EnviarBroadcastPushRequest,
    EnviarBroadcastPushResponse,
    EnviarMensajePushRequest,
    EnviarMensajePushResponse,
    NotificacionesResumenResponse,
)
from app.services.notificacion_service import (
    listar_notificaciones,
    listar_destinatarios_mensaje_push,
    crear_mensaje_push_gestor,
    crear_broadcast_push_gestor,
    marcar_notificacion_leida,
    marcar_todas_leidas,
)


router = APIRouter(
    prefix="/notificaciones",
    tags=["Notificaciones"],
    dependencies=[Depends(require_roles("ESTUDIANTE", "GESTOR", "ADMINISTRADOR"))],
)


class DispositivoPushRequest(BaseModel):
    token: str = Field(min_length=20, max_length=4096)
    plataforma: str = Field(pattern="^(android|ios)$")


@router.get("", response_model=NotificacionesResumenResponse)
def listar(
    id_usuario: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    return listar_notificaciones(db, id_usuario)


@router.get(
    '/destinatarios-push',
    response_model=list[DestinatarioMensajePush],
    dependencies=[Depends(require_roles('GESTOR', 'ADMINISTRADOR'))],
)
def listar_destinatarios_push(db: Session = Depends(get_db)):
    return listar_destinatarios_mensaje_push(db)


@router.post(
    '/mensaje-personalizado',
    response_model=EnviarMensajePushResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles('GESTOR', 'ADMINISTRADOR'))],
)
def enviar_mensaje_personalizado(
    body: EnviarMensajePushRequest,
    db: Session = Depends(get_db),
):
    id_notificacion, enviados = crear_mensaje_push_gestor(
        db, body.id_usuario, body.titulo, body.mensaje
    )
    if id_notificacion is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail='El destinatario no está disponible.',
        )
    return {
        'id_notificacion': id_notificacion,
        'dispositivos_enviados': enviados,
        'mensaje': (
            'Mensaje enviado por push.' if enviados
            else 'Aviso guardado en la bandeja; el destinatario no tiene un dispositivo push activo.'
        ),
    }


@router.post(
    '/mensaje-broadcast',
    response_model=EnviarBroadcastPushResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles('GESTOR', 'ADMINISTRADOR'))],
)
def enviar_broadcast_personalizado(
    body: EnviarBroadcastPushRequest,
    db: Session = Depends(get_db),
):
    destinatarios, enviados = crear_broadcast_push_gestor(
        db, body.titulo, body.mensaje
    )
    return {
        'destinatarios': destinatarios,
        'dispositivos_enviados': enviados,
        'mensaje': (
            f'Mensaje enviado a {destinatarios} estudiantes; '
            f'{enviados} dispositivos recibieron el push.'
            if destinatarios
            else 'No hay estudiantes activos para enviar el mensaje.'
        ),
    }


@router.post("/dispositivos", status_code=status.HTTP_204_NO_CONTENT)
def registrar_dispositivo(
    body: DispositivoPushRequest,
    id_usuario: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    db.execute(text("SELECT public.fn_registrar_dispositivo_push(:usuario, :token, :plataforma)"), {
        "usuario": id_usuario, "token": body.token, "plataforma": body.plataforma,
    })
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/dispositivos/actual", status_code=status.HTTP_204_NO_CONTENT)
def eliminar_dispositivo(
    id_usuario: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    db.execute(text("SELECT public.fn_eliminar_dispositivos_usuario_push(:usuario)"), {"usuario": id_usuario})
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/realtime-token")
def obtener_token_realtime(
    id_usuario: int = Depends(get_current_user_id),
):
    """Issue a short-lived Supabase JWT scoped to this user's notifications."""
    if not settings.supabase_jwt_secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Realtime no está configurado en el backend",
        )

    expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)
    token = jwt.encode(
        {
            "sub": str(id_usuario),
            "role": "authenticated",
            "aud": "authenticated",
            "exp": expires_at,
        },
        settings.supabase_jwt_secret,
        algorithm="HS256",
    )
    return {"token": token, "expires_at": expires_at.isoformat()}


@router.patch("/leidas")
def marcar_todas(
    id_usuario: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    return {"actualizadas": marcar_todas_leidas(db, id_usuario)}


@router.patch("/{id_notificacion}/leida", status_code=status.HTTP_204_NO_CONTENT)
def marcar_leida(
    id_notificacion: int,
    id_usuario: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    if not marcar_notificacion_leida(db, id_usuario, id_notificacion):
        raise HTTPException(status_code=404, detail="Notificación no encontrada")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
