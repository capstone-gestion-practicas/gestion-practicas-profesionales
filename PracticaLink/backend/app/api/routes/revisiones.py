from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.permissions import require_roles
from app.core.security import get_current_user_id
from app.schemas.revision import (
    DecisionRevisionRequest,
    DecisionRevisionResponse,
    SolicitudRevisionDetalle,
    SolicitudRevisionResumen,
)
from app.services.revision_service import (
    SolicitudNoEncontradaError,
    SolicitudNoRevisableError,
    listar_solicitudes,
    obtener_solicitud,
    resolver_solicitud,
)


router = APIRouter(
    prefix="/revisiones",
    tags=["Revisión de prácticas"],
    dependencies=[Depends(require_roles("GESTOR", "ADMINISTRADOR"))],
)


@router.get("/solicitudes", response_model=list[SolicitudRevisionResumen])
def listar(db: Session = Depends(get_db)):
    return listar_solicitudes(db)


@router.get(
    "/solicitudes/{id_practica}",
    response_model=SolicitudRevisionDetalle,
)
def obtener(id_practica: int, db: Session = Depends(get_db)):
    solicitud = obtener_solicitud(db, id_practica)
    if solicitud is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "La solicitud no existe")
    return solicitud


@router.patch(
    "/solicitudes/{id_practica}",
    response_model=DecisionRevisionResponse,
)
def resolver(
    id_practica: int,
    datos: DecisionRevisionRequest,
    id_usuario: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    try:
        return resolver_solicitud(db, id_practica, id_usuario, datos)
    except SolicitudNoEncontradaError as error:
        db.rollback()
        raise HTTPException(status.HTTP_404_NOT_FOUND, "La solicitud no existe") from error
    except SolicitudNoRevisableError as error:
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "La solicitud ya no se encuentra en revisión",
        ) from error
