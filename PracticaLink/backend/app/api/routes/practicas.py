from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.permissions import require_roles
from app.core.security import get_current_user_id
from app.schemas.practica import PracticaCreate, PracticaCreateResponse
from app.services.practica_service import (
    EstadoInicialNoEncontradoError,
    PerfilEstudianteNoEncontradoError,
    PracticaActivaError,
    registrar_practica,
)


router = APIRouter(prefix="/practicas", tags=["Prácticas"])


@router.post(
    "",
    response_model=PracticaCreateResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles("ESTUDIANTE"))],
)
def crear_practica(
    datos: PracticaCreate,
    id_usuario: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    try:
        return registrar_practica(db, id_usuario, datos)
    except PerfilEstudianteNoEncontradoError as error:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="El usuario no tiene un perfil de estudiante",
        ) from error
    except PracticaActivaError as error:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="El estudiante ya tiene una práctica activa",
        ) from error
    except EstadoInicialNoEncontradoError as error:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="No está configurado el estado inicial de la práctica",
        ) from error
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Los datos ingresados entran en conflicto con otro registro",
        ) from error
