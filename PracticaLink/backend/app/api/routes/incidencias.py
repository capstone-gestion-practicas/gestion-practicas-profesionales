from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.permissions import require_roles
from app.schemas.incidencia import IncidenciaResponse
from app.services.incidencia_service import listar_incidencias


# Rutas legado de develop conservadas: solo consulta.
# Retirados del API público: POST /practicas/{id}/incidencias (contrato EP06) y
# PATCH /incidencias/{id}/estado (cambio de estado sin garantías HU016). El único
# cambio de estado público es PATCH /practicas/{id}/incidencias/{id}/estado (EP06).
router = APIRouter(tags=["Incidencias"])
gestor = [Depends(require_roles("GESTOR", "ADMINISTRADOR"))]


@router.get("/incidencias", response_model=list[IncidenciaResponse], dependencies=gestor)
def obtener_incidencias(db: Session = Depends(get_db)):
    return listar_incidencias(db)
