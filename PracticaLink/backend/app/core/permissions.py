from collections.abc import Callable

from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user_id
from app.auth.service import obtener_contexto_usuario


def require_roles(*roles_permitidos: str) -> Callable:
    roles_normalizados = {
        rol.strip().upper()
        for rol in roles_permitidos
        if rol.strip()
    }

    if not roles_normalizados:
        raise ValueError("Debe indicar al menos un rol permitido")

    def verificar_roles(
        user_id: int = Depends(get_current_user_id),
        db: Session = Depends(get_db),
    ):
        contexto = obtener_contexto_usuario(
            db=db,
            id_usuario=user_id
        )

        roles_usuario = {
            str(rol).upper()
            for rol in (contexto or {}).get("roles", [])
        }

        tiene_permiso = not roles_normalizados.isdisjoint(roles_usuario)

        if not tiene_permiso:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="No tiene permisos para acceder a esta funcionalidad."
            )

        return contexto

    return verificar_roles
