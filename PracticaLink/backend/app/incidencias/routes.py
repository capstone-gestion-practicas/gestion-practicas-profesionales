from fastapi import APIRouter, Depends, HTTPException, Path, Request, status
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.permissions import require_roles
from app.core.security import get_current_user_id
from app.core.incidencias_database import get_incidencias_db
from app.incidencias.schemas import IncidenciaCreate, IncidenciaCreateResponse
from app.incidencias.service import RegistroIncidenciaError, registrar_incidencia


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
