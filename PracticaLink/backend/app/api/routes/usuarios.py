from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.permissions import require_roles
from app.core.security import get_current_user_id
from app.schemas.usuario import (
    OperacionUsuarioResponse, RolResponse, UsuarioActualizarRequest,
    UsuarioCrearRequest, UsuarioResponse,
)
from app.services.usuario_service import (
    AutogestionNoPermitidaError, RolesInvalidosError, UsuarioDuplicadoError,
    UsuarioNoEncontradoError, actualizar_usuario, crear_usuario, listar_roles,
    listar_usuarios,
)

router = APIRouter(
    prefix="/usuarios", tags=["Gestión de usuarios"],
    dependencies=[Depends(require_roles("ADMINISTRADOR"))],
)


@router.get("", response_model=list[UsuarioResponse])
def obtener_usuarios(db: Session = Depends(get_db)):
    return listar_usuarios(db)


@router.get("/roles", response_model=list[RolResponse])
def obtener_roles(db: Session = Depends(get_db)):
    return listar_roles(db)


@router.post("", response_model=OperacionUsuarioResponse, status_code=status.HTTP_201_CREATED)
def registrar_usuario(
    datos: UsuarioCrearRequest,
    id_admin: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    try:
        return crear_usuario(db, id_admin, datos)
    except UsuarioDuplicadoError as error:
        db.rollback()
        raise HTTPException(status_code=409, detail="El correo ya está registrado") from error
    except RolesInvalidosError as error:
        db.rollback()
        raise HTTPException(status_code=400, detail="Debe seleccionar roles válidos") from error


@router.patch("/{id_usuario}", response_model=OperacionUsuarioResponse)
def modificar_usuario(
    id_usuario: int,
    datos: UsuarioActualizarRequest,
    id_admin: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    try:
        return actualizar_usuario(db, id_admin, id_usuario, datos)
    except UsuarioNoEncontradoError as error:
        db.rollback()
        raise HTTPException(status_code=404, detail="Usuario no encontrado") from error
    except RolesInvalidosError as error:
        db.rollback()
        raise HTTPException(status_code=400, detail="Debe seleccionar roles válidos") from error
    except AutogestionNoPermitidaError as error:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="No puedes desactivar tu cuenta ni quitarte el rol administrador",
        ) from error
