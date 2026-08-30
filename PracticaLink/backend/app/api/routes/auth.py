from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user_id
from app.schemas.auth import (
    LoginRequest,
    LoginResponse,
    ContextoUsuarioResponse
)
from app.services.auth_service import (
    autenticar_usuario,
    obtener_contexto_usuario
)


router = APIRouter(
    prefix="/auth",
    tags=["Autenticación"]
)


@router.post(
    "/login",
    response_model=LoginResponse
)
def login(
    datos: LoginRequest,
    db: Session = Depends(get_db)
):
    resultado = autenticar_usuario(
        db=db,
        correo=datos.correo,
        password=datos.password
    )

    if resultado is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenciales inválidas"
        )

    return resultado


@router.get(
    "/context",
    response_model=ContextoUsuarioResponse
)
def obtener_contexto(
    id_usuario: int = Depends(get_current_user_id),
    db: Session = Depends(get_db)
):
    contexto = obtener_contexto_usuario(
        db=db,
        id_usuario=id_usuario
    )

    if contexto is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No se encontró el contexto del usuario"
        )

    return contexto