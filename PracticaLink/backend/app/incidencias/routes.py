from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request, status
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.permissions import require_roles
from app.core.security import get_current_user_id
from app.core.incidencias_database import get_incidencias_db
from app.incidencias.schemas import (IncidenciaCreate, IncidenciaCreateResponse, IncidenciasHistorialResponse,
    IncidenciaEstadoRequest, IncidenciaEstadoResponse, IncidenciaEstadosHistorialResponse)
from app.incidencias.service import (
    RegistroIncidenciaError, registrar_incidencia, ConsultaIncidenciasError, consultar_incidencias,
    GestionEstadoIncidenciaError, cambiar_estado_incidencia, consultar_historial_incidencia
)


router = APIRouter(prefix='/practicas', tags=['Incidencias'])
_verificar_roles = require_roles('GESTOR', 'ADMINISTRADOR')


def responsable_autenticado(
    request: Request,
    id_usuario: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
) -> int:
    try:
        # fn_contexto_usuario solo devuelve usuarios activos y roles activos.
        contexto = _verificar_roles(user_id=id_usuario, db=db)
    except SQLAlchemyError:
        raise HTTPException(503, 'No fue posible verificar los permisos') from None
    if (not isinstance(contexto, dict)
            or not isinstance(contexto.get('usuario'), dict)
            or contexto.get('usuario', {}).get('id_usuario') != id_usuario
            or not 1 <= id_usuario <= 9223372036854775807):
        raise HTTPException(403, 'No tiene permisos para registrar incidencias')
    # Este endpoint no define parámetros query, incluidos IDs de autor.
    if request.query_params:
        raise HTTPException(422, 'No se admiten parámetros de consulta')
    return id_usuario


@router.post(
    '/{id_practica}/incidencias',
    response_model=IncidenciaCreateResponse,
    status_code=status.HTTP_201_CREATED,
    responses={403: {'description': 'Acceso denegado'},
               404: {'description': 'Práctica inexistente'},
               409: {'description': 'Estado incompatible o conflicto concurrente'},
               500: {'description': 'Registro no confirmado; no reenviar automáticamente'},
               503: {'description': 'Servicio no disponible; no reenviar automáticamente'}},
)
def crear_incidencia(
    datos: IncidenciaCreate,
    id_practica: int = Path(ge=1, le=9223372036854775807),
    id_usuario: int = Depends(responsable_autenticado),
    db: Session = Depends(get_incidencias_db),
):
    try:
        return registrar_incidencia(db, id_practica, id_usuario, datos)
    except RegistroIncidenciaError as error:
        errores = {
            'USUARIO_NO_AUTORIZADO': (403, 'No tiene permisos para registrar incidencias'),
            'PRACTICA_NO_ENCONTRADA': (404, 'La práctica no existe'),
            'PRACTICA_NO_EN_CURSO': (409, 'La práctica no está en curso'),
            'TIPO_INVALIDO': (422, 'El tipo de incidencia no es válido'),
            'DESCRIPCION_INVALIDA': (422, 'La descripción no es válida'),
            'CONFLICTO_CONCURRENTE': (409, 'No se pudo registrar por un conflicto concurrente'),
            'CONEXION_NO_DISPONIBLE': (503, 'No se pudo confirmar el registro; no reenvíe automáticamente la solicitud'),
        }
        codigo, mensaje = errores.get(error.codigo, (500, 'No se pudo confirmar el registro de la incidencia'))
        raise HTTPException(codigo, mensaje) from None


# Separada del POST: permite únicamente paginación, nunca identidad del cliente.
def lector_autenticado(
    request: Request,
    id_usuario: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
) -> int:
    try:
        contexto = _verificar_roles(user_id=id_usuario, db=db)
    except SQLAlchemyError:
        raise HTTPException(503, 'No fue posible verificar los permisos') from None
    if (not isinstance(contexto, dict) or not isinstance(contexto.get('usuario'), dict)
            or contexto['usuario'].get('id_usuario') != id_usuario
            or not 1 <= id_usuario <= 9223372036854775807):
        raise HTTPException(403, 'No tiene permisos para consultar incidencias')
    if set(request.query_params) - {'limit', 'offset'}:
        raise HTTPException(422, 'Parámetros de consulta no admitidos')
    return id_usuario


@router.get('/{id_practica}/incidencias', response_model=IncidenciasHistorialResponse)
def obtener_incidencias(
    id_practica: int = Path(ge=1, le=9223372036854775807),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0, le=9223372036854775807),
    id_usuario: int = Depends(lector_autenticado),
    db: Session = Depends(get_incidencias_db),
):
    try:
        return consultar_incidencias(db, id_practica, id_usuario, limit, offset)
    except ConsultaIncidenciasError as error:
        errores = {
            'USUARIO_NO_AUTORIZADO': (403, 'No tiene permisos para consultar incidencias'),
            'PRACTICA_NO_ENCONTRADA': (404, 'La práctica no existe'),
            'PAGINACION_INVALIDA': (422, 'La paginación no es válida'),
            'CONEXION_NO_DISPONIBLE': (503, 'La consulta de incidencias no está disponible'),
        }
        codigo, mensaje = errores.get(error.codigo, (500, 'No fue posible consultar las incidencias'))
        raise HTTPException(codigo, mensaje) from None


def _error_http_estado(error: GestionEstadoIncidenciaError, escritura: bool):
    errores = {
        'USUARIO_NO_AUTORIZADO': (403, 'No tiene permisos para gestionar incidencias'),
        'PRACTICA_NO_ENCONTRADA': (404, 'La práctica no existe'),
        'INCIDENCIA_NO_ENCONTRADA': (404, 'La incidencia no está disponible para esta práctica'),
        'IDENTIFICADOR_INVALIDO': (422, 'El identificador no es válido'),
        'ESTADO_INVALIDO': (422, 'El estado no es válido'),
        'COMENTARIO_INVALIDO': (422, 'El comentario no es válido'),
        'PAGINACION_INVALIDA': (422, 'La paginación no es válida'),
        'INCIDENCIA_NO_GESTIONABLE': (409, 'La incidencia no admite cambios de estado'),
        'ESTADO_DESACTUALIZADO': (409, 'El estado cambió; consulte nuevamente la incidencia'),
        'TRANSICION_NO_PERMITIDA': (409, 'La transición de estado no está permitida'),
        'HISTORIAL_INCONSISTENTE': (409, 'El historial no permite confirmar este cambio'),
        'CONFLICTO_CONCURRENTE': (409, 'No se pudo confirmar por un conflicto concurrente'),
        'CONEXION_NO_DISPONIBLE': (503, 'No se pudo confirmar el cambio; no reenvíe automáticamente la solicitud'
                                  if escritura else 'La consulta del historial no está disponible'),
    }
    # Los códigos de conflicto de escritura no forman parte del contrato GET.
    codigo, mensaje = errores.get(error.codigo, (500, 'No fue posible completar la operación de incidencias'))
    if not escritura and codigo == 409:
        codigo, mensaje = 500, 'No fue posible consultar el historial de la incidencia'
    return HTTPException(codigo, mensaje)


@router.patch('/{id_practica}/incidencias/{id_incidencia}/estado',
              response_model=IncidenciaEstadoResponse, status_code=200)
def actualizar_estado_incidencia(
    datos: IncidenciaEstadoRequest,
    id_practica: int = Path(ge=1, le=9223372036854775807),
    id_incidencia: int = Path(ge=1, le=9223372036854775807),
    id_usuario: int = Depends(responsable_autenticado),
    db: Session = Depends(get_incidencias_db),
):
    try:
        return cambiar_estado_incidencia(db, id_practica, id_incidencia, id_usuario, datos)
    except GestionEstadoIncidenciaError as error:
        raise _error_http_estado(error, escritura=True) from None


@router.get('/{id_practica}/incidencias/{id_incidencia}/historial',
            response_model=IncidenciaEstadosHistorialResponse)
def obtener_historial_incidencia(
    id_practica: int = Path(ge=1, le=9223372036854775807),
    id_incidencia: int = Path(ge=1, le=9223372036854775807),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0, le=9223372036854775807),
    id_usuario: int = Depends(lector_autenticado),
    db: Session = Depends(get_incidencias_db),
):
    try:
        return consultar_historial_incidencia(db, id_practica, id_incidencia, id_usuario, limit, offset)
    except GestionEstadoIncidenciaError as error:
        raise _error_http_estado(error, escritura=False) from None
