from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.permissions import require_roles
from app.schemas.empresa import EmpresaLookupResponse
from app.services.empresa_service import (
    EmpresaApiNoConfiguradaError,
    EmpresaApiNoDisponibleError,
    EmpresaNoEncontradaError,
    consultar_empresa,
)

router = APIRouter(
    prefix="/empresas",
    tags=["Empresas"],
    dependencies=[Depends(require_roles("ESTUDIANTE", "ADMINISTRADOR"))],
)


@router.get("/consulta/{rut}", response_model=EmpresaLookupResponse)
def obtener_empresa(rut: str, db: Session = Depends(get_db)):
    try:
        return consultar_empresa(db, rut)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except EmpresaNoEncontradaError as error:
        raise HTTPException(status_code=404, detail="Empresa no encontrada") from error
    except EmpresaApiNoConfiguradaError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="La consulta de empresas no está configurada",
        ) from error
    except EmpresaApiNoDisponibleError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="El servicio de empresas no está disponible",
        ) from error
