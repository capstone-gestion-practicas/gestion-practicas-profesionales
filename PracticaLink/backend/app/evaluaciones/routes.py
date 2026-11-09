from typing import Annotated
from uuid import UUID
from fastapi import APIRouter, Depends, Header, HTTPException, Path, Request
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from starlette.exceptions import HTTPException as StarletteHTTPException
from app.core.academic_auth import require_academic_bearer
from app.core.permissions import require_roles
from app.core.security import get_current_user_id
from app.informes.database import get_informe_db
from app.evaluaciones.schemas import (
    ConsultaAcademicaResponse, EstadoAcademicoResponse, EvaluacionResponse,
    IniciarEvaluacionRequest, ResolverEvaluacionRequest,
)
from app.evaluaciones.service import Evaluaciones


class AcademicRoute(APIRoute):
    def get_route_handler(self):
        original = super().get_route_handler()
        async def handler(request: Request):
            try:
                response = await original(request)
            except RequestValidationError:
                raise HTTPException(400, 'Datos de evaluación inválidos. Revisa los identificadores, el resultado y las observaciones (máximo 2.000 caracteres).',
                                    headers={'Cache-Control': 'no-store'}) from None
            except StarletteHTTPException as error:
                # Preserve the existing exception handler, JSON, status and auth headers.
                error.headers = {key: value for key, value in (error.headers or {}).items()
                                 if key.lower() != 'cache-control'}
                error.headers['Cache-Control'] = 'no-store'
                raise
            response.headers['Cache-Control'] = 'no-store'
            return response
        return handler


router = APIRouter(prefix='/practicas', tags=['Evaluación académica'],
                   route_class=AcademicRoute, dependencies=[Depends(require_academic_bearer)],
                   responses={400: {'description': 'Datos de evaluación inválidos'},
                              401: {'description': 'JWT ausente, inválido o expirado'},
                              403: {'description': 'Sin autorización académica'},
                              404: {'description': 'Recurso no disponible'},
                              409: {'description': 'Conflicto de estado, versión o idempotencia'},
                              503: {'description': 'Operación no disponible'},
                              '4XX': {'description': 'Error del cliente; validación de entrada devuelve 400'}})
PracticaId = Annotated[int, Path(ge=1, le=9223372036854775807)]
Idempotencia = Annotated[UUID, Header(alias='Idempotency-Key')]


def get_evaluaciones(db=Depends(get_informe_db)):
    return Evaluaciones(db)


@router.get('/{id_practica}/evaluaciones', response_model=ConsultaAcademicaResponse,
            dependencies=[Depends(require_roles('ESTUDIANTE', 'DOCENTE', 'GESTOR'))])
def consultar(id_practica: PracticaId, actor: int = Depends(get_current_user_id),
              service: Evaluaciones = Depends(get_evaluaciones)):
    return service.consultar(id_practica, actor)


@router.get('/{id_practica}/evaluaciones/vigente', response_model=EstadoAcademicoResponse,
            dependencies=[Depends(require_roles('ESTUDIANTE', 'DOCENTE', 'GESTOR'))])
def vigente(id_practica: PracticaId, actor: int = Depends(get_current_user_id),
            service: Evaluaciones = Depends(get_evaluaciones)):
    return service.consultar(id_practica, actor)


@router.post('/{id_practica}/evaluaciones/inicio', response_model=EvaluacionResponse,
             dependencies=[Depends(require_roles('DOCENTE'))])
def iniciar(id_practica: PracticaId, datos: IniciarEvaluacionRequest, key: Idempotencia,
             actor: int = Depends(get_current_user_id), service: Evaluaciones = Depends(get_evaluaciones)):
    return service.iniciar(id_practica, actor, key, datos)


@router.post('/{id_practica}/evaluaciones/{id_evaluacion}/resolucion', response_model=EvaluacionResponse,
             dependencies=[Depends(require_roles('DOCENTE'))])
def resolver(id_practica: PracticaId, id_evaluacion: UUID, datos: ResolverEvaluacionRequest, key: Idempotencia,
              actor: int = Depends(get_current_user_id), service: Evaluaciones = Depends(get_evaluaciones)):
    return service.resolver(id_practica, actor, key, id_evaluacion, datos)
