from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.permissions import require_roles
from app.core.security import get_current_user_id
from app.schemas.estudiante import (
    PerfilEstudianteCreate,
    PerfilEstudianteResponse,
)
from app.services.estudiante_service import (
    PerfilEstudianteExistenteError,
    RutEstudianteExistenteError,
    UsuarioEstudianteNoValidoError,
    completar_perfil_estudiante,
)


router = APIRouter(prefix="/estudiantes", tags=["Estudiantes"])


@router.post(
    "/perfil",
    response_model=PerfilEstudianteResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles("ESTUDIANTE"))],
)
def completar_perfil(
    datos: PerfilEstudianteCreate,
    id_usuario: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    try:
        return completar_perfil_estudiante(db, id_usuario, datos)
    except PerfilEstudianteExistenteError as error:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="El usuario ya tiene un perfil de estudiante",
        ) from error
    except RutEstudianteExistenteError as error:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="El RUT ya está asociado a otro estudiante",
        ) from error
    except UsuarioEstudianteNoValidoError as error:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="El usuario no está habilitado como estudiante",
        ) from error
