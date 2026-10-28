from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.permissions import require_roles
from app.core.security import get_current_user_id
from app.schemas.incidencia import (
    ActualizarEstadoIncidenciaRequest,
    ActualizarEstadoIncidenciaResponse,
    IncidenciaCreate,
    IncidenciaResponse,
)
from app.services.incidencia_service import (
    IncidenciaNoEncontradaError,
    PracticaIncidenciaNoDisponibleError,
    actualizar_estado_incidencia,
    listar_incidencias,
    registrar_incidencia,
)


router = APIRouter(tags=["Incidencias"])
gestor = [Depends(require_roles("GESTOR", "ADMINISTRADOR"))]


@router.get("/incidencias", response_model=list[IncidenciaResponse], dependencies=gestor)
def obtener_incidencias(db: Session = Depends(get_db)):
    return listar_incidencias(db)


@router.post(
    "/practicas/{id_practica}/incidencias",
    response_model=IncidenciaResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=gestor,
)
def crear_incidencia(
    id_practica: int,
    datos: IncidenciaCreate,
    id_usuario: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    try:
        return registrar_incidencia(db, id_practica, id_usuario, datos)
    except PracticaIncidenciaNoDisponibleError as error:
        db.rollback()
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "La práctica no existe o ya se encuentra finalizada",
        ) from error


@router.patch(
    "/incidencias/{id_incidencia}/estado",
    response_model=ActualizarEstadoIncidenciaResponse,
    dependencies=gestor,
)
def cambiar_estado_incidencia(
    id_incidencia: int,
    datos: ActualizarEstadoIncidenciaRequest,
    db: Session = Depends(get_db),
):
    try:
        return actualizar_estado_incidencia(db, id_incidencia, datos.estado)
    except IncidenciaNoEncontradaError as error:
        db.rollback()
        raise HTTPException(status.HTTP_404_NOT_FOUND, "La incidencia no existe") from error
