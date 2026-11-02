from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.permissions import require_roles
from app.schemas.incidencia import (
    ActualizarEstadoIncidenciaRequest,
    ActualizarEstadoIncidenciaResponse,
    IncidenciaResponse,
)
from app.services.incidencia_service import (
    IncidenciaNoEncontradaError,
    actualizar_estado_incidencia,
    listar_incidencias,
)


# Rutas legado de develop no conflictivas. El POST /practicas/{id}/incidencias
# fue retirado: el contrato canónico es el de EP06 (app/incidencias/routes.py).
router = APIRouter(tags=["Incidencias"])
gestor = [Depends(require_roles("GESTOR", "ADMINISTRADOR"))]


@router.get("/incidencias", response_model=list[IncidenciaResponse], dependencies=gestor)
def obtener_incidencias(db: Session = Depends(get_db)):
    return listar_incidencias(db)


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
