from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.inicio_practica_database import get_inicio_practica_db
from app.core.permissions import require_roles
from app.core.security import get_current_user_id
from app.practicas.schemas import (
    PracticaCreate,
    PracticaCreateResponse,
    PracticaDetalleResponse,
    PracticaDetalleGestionResponse,
    PracticasListadoResponse,
    HistorialPracticaResponse,
    IniciarPracticaRequest,
    IniciarPracticaResponse,
)
from app.practicas.service import (
    EstadoInicialNoEncontradoError,
    PerfilEstudianteNoEncontradoError,
    PracticaActivaError,
    PracticaNoEncontradaError,
    listar_practicas,
    obtener_historial_practica,
    obtener_practica_del_estudiante,
    obtener_detalle_practica,
    registrar_practica,
    iniciar_practica,
    InicioPracticaError,
)
from app.schemas.validators import normalizar_rut


router = APIRouter(prefix="/practicas", tags=["Prácticas"])


@router.patch(
    "/{id_practica}/estado",
    response_model=IniciarPracticaResponse,
    dependencies=[Depends(require_roles("GESTOR", "ADMINISTRADOR"))],
)
def iniciar_estado_practica(
    datos: IniciarPracticaRequest,
    id_practica: int = Path(ge=1, le=9223372036854775807),
    id_usuario: int = Depends(get_current_user_id),
    db: Session = Depends(get_inicio_practica_db),
):
    try:
        return iniciar_practica(db, id_practica, id_usuario, datos)
    except InicioPracticaError as error:
        errores = {
            "USUARIO_NO_AUTORIZADO": (403, "No tiene permisos para iniciar la práctica"),
            "PRACTICA_NO_ENCONTRADA": (404, "La práctica no existe"),
            "ESTADO_FINAL": (409, "La práctica está en un estado final"),
            "TRANSICION_NO_PERMITIDA": (409, "La transición de estado no está permitida"),
            "HISTORIAL_INCONSISTENTE": (409, "El historial de estados es inconsistente"),
            "OBSERVACION_INVALIDA": (422, "La observación no es válida"),
            "ESTADO_DESTINO_NO_VALIDO": (500, "El estado de destino no está configurado correctamente"),
            "CONEXION_NO_DISPONIBLE": (503, "La conexión de inicio de práctica no está disponible"),
        }
        codigo, mensaje = errores.get(error.codigo, (500, "No se pudo iniciar la práctica"))
        raise HTTPException(status_code=codigo, detail=mensaje) from None


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


@router.get(
    "/me",
    response_model=PracticaDetalleResponse,
    dependencies=[Depends(require_roles("ESTUDIANTE"))],
)
def obtener_mi_practica(
    id_usuario: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    try:
        return obtener_practica_del_estudiante(db, id_usuario)
    except PerfilEstudianteNoEncontradoError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="El usuario no tiene un perfil de estudiante",
        ) from error
    except PracticaNoEncontradaError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="El estudiante no tiene una práctica registrada",
        ) from error


@router.get(
    "",
    response_model=PracticasListadoResponse,
    dependencies=[Depends(require_roles("GESTOR", "ADMINISTRADOR"))],
)
def consultar_practicas(
    rut: str | None = Query(default=None, pattern=r"^[0-9]{7,8}-[0-9Kk]$"),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
):
    if rut is not None:
        try:
            rut = normalizar_rut(rut)
        except ValueError as error:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="El RUT no es válido",
            ) from error
    return listar_practicas(db, rut=rut, limit=limit, offset=offset)


@router.get(
    "/{id_practica}/historial",
    response_model=HistorialPracticaResponse,
    dependencies=[Depends(require_roles("GESTOR", "ADMINISTRADOR"))],
)
def consultar_historial_practica(
    id_practica: int = Path(ge=1, le=9223372036854775807),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
):
    historial = obtener_historial_practica(db, id_practica, limit=limit, offset=offset)
    if historial is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="La práctica no existe",
        )
    return historial


@router.get(
    "/{id_practica}",
    response_model=PracticaDetalleGestionResponse,
    dependencies=[Depends(require_roles("GESTOR", "ADMINISTRADOR"))],
)
def consultar_detalle_practica(
    id_practica: int = Path(ge=1, le=9223372036854775807),
    db: Session = Depends(get_db),
):
    practica = obtener_detalle_practica(db, id_practica)
    if practica is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="La práctica no existe",
        )
    return practica
