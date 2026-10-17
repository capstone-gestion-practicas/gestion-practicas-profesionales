from datetime import datetime, timedelta, timezone

import jwt
from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.permissions import require_roles
from app.core.security import get_current_user_id
from app.core.config import settings
from app.schemas.notificacion import NotificacionesResumenResponse
from app.services.notificacion_service import (
    listar_notificaciones,
    marcar_notificacion_leida,
    marcar_todas_leidas,
)


router = APIRouter(
    prefix="/notificaciones",
    tags=["Notificaciones"],
    dependencies=[Depends(require_roles("ESTUDIANTE", "GESTOR", "ADMINISTRADOR"))],
)


@router.get("", response_model=NotificacionesResumenResponse)
def listar(
    id_usuario: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    return listar_notificaciones(db, id_usuario)


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
