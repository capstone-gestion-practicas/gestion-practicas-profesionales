from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.permissions import require_roles
from app.core.security import get_current_user_id
from app.practicas.schemas import (
    ActualizarEstadoPracticaRequest,
    ActualizarEstadoPracticaResponse,
    EstadoPracticaActualResponse,
    EstadoPracticaDetalle,
    EstudianteSinPractica,
    HistorialEstadoPractica,
    PracticaCreate,
    PracticaCreateResponse,
    PracticaDetalleResponse,
    PracticaEstadoResumen,
    RecordatorioEstudianteResponse,
    ResponderObservacionPracticaRequest,
)
from app.schemas.seguimiento import SeguimientoCreate, SeguimientoResponse
from app.practicas.service import (
    EstadoInicialNoEncontradoError,
    PerfilEstudianteNoEncontradoError,
    PracticaActivaError,
    PracticaNoEncontradaError,
    obtener_practica_del_estudiante,
    registrar_practica,
)
from app.services.correo_service import (
    EstudianteNoEncontradoError,
    EstudianteYaTienePracticaError,
    RecordatorioYaEnviadoHoyError,
    enviar_recordatorio_sin_practica,
)
from app.services.estado_practica_service import (
    EstadoPracticaNoDisponibleError,
    PracticaEstadoNoEncontradaError,
    PracticaNoObservadaError,
    actualizar_estado_practica,
    listar_estados_activos,
    listar_estudiantes_sin_practica,
    listar_practicas_para_gestion,
    obtener_estado_actual,
    obtener_historial_estados,
    responder_observacion_practica,
)
from app.services.seguimiento_service import (
    PracticaSeguimientoNoDisponibleError,
    listar_seguimientos,
    registrar_seguimiento,
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


@router.get(
    "/me",
    response_model=PracticaDetalleResponse,
    response_model_exclude_unset=True,
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


@router.post(
    "/{id_practica}/seguimientos",
    response_model=SeguimientoResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles("GESTOR", "ADMINISTRADOR"))],
)
def crear_seguimiento(
    id_practica: int,
    datos: SeguimientoCreate,
    id_usuario: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    try:
        return registrar_seguimiento(db, id_practica, id_usuario, datos)
    except PracticaSeguimientoNoDisponibleError as error:
        db.rollback()
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "La práctica no existe o ya se encuentra finalizada",
        ) from error


@router.get(
    "/{id_practica}/seguimientos",
    response_model=list[SeguimientoResponse],
    dependencies=[Depends(require_roles("GESTOR", "ADMINISTRADOR"))],
)
def consultar_seguimientos(
    id_practica: int,
    db: Session = Depends(get_db),
):
    return listar_seguimientos(db, id_practica)


@router.patch(
    "/{id_practica}/respuesta-observacion",
    response_model=ActualizarEstadoPracticaResponse,
    dependencies=[Depends(require_roles("ESTUDIANTE"))],
)
def responder_observacion(
    id_practica: int,
    datos: ResponderObservacionPracticaRequest,
    id_usuario: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    try:
        return responder_observacion_practica(
            db, id_practica, id_usuario, datos.respuesta
        )
    except PracticaEstadoNoEncontradaError as error:
        db.rollback()
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "La práctica no existe"
        ) from error
    except PracticaNoObservadaError as error:
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Solo puedes responder cuando la práctica está observada",
        ) from error
    except EstadoPracticaNoDisponibleError as error:
        db.rollback()
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "No está configurado el estado EN_REVISION",
        ) from error


@router.get(
    "/estados",
    response_model=list[EstadoPracticaDetalle],
    dependencies=[Depends(require_roles("GESTOR", "ADMINISTRADOR"))],
)
def listar_estados(db: Session = Depends(get_db)):
    return listar_estados_activos(db)


@router.get(
    "/gestion-estados",
    response_model=list[PracticaEstadoResumen],
    dependencies=[Depends(require_roles("GESTOR", "ADMINISTRADOR"))],
)
def listar_para_gestionar_estados(db: Session = Depends(get_db)):
    return listar_practicas_para_gestion(db)


@router.get(
    "/estudiantes-sin-practica",
    response_model=list[EstudianteSinPractica],
    dependencies=[Depends(require_roles("GESTOR", "ADMINISTRADOR"))],
)
def listar_estudiantes_sin_practica_endpoint(db: Session = Depends(get_db)):
    return listar_estudiantes_sin_practica(db)


@router.post(
    "/estudiantes/{id_usuario}/recordatorio",
    response_model=RecordatorioEstudianteResponse,
    dependencies=[Depends(require_roles("GESTOR", "ADMINISTRADOR"))],
)
def enviar_recordatorio_estudiante(
    id_usuario: int,
    db: Session = Depends(get_db),
):
    try:
        return enviar_recordatorio_sin_practica(db, id_usuario)
    except EstudianteNoEncontradoError as error:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "No se encontró un estudiante activo con ese identificador",
        ) from error
    except EstudianteYaTienePracticaError as error:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "El estudiante ya tiene una práctica registrada",
        ) from error
    except RecordatorioYaEnviadoHoyError as error:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Ya se envió un recordatorio a este estudiante durante el día de hoy",
        ) from error


@router.get(
    "/{id_practica}/estado",
    response_model=EstadoPracticaActualResponse,
)
def consultar_estado(
    id_practica: int,
    contexto: dict = Depends(
        require_roles("ESTUDIANTE", "GESTOR", "ADMINISTRADOR")
    ),
    id_usuario: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    roles = {str(rol).upper() for rol in contexto.get("roles", [])}
    estado = obtener_estado_actual(
        db,
        id_practica,
        id_usuario,
        bool(roles.intersection({"GESTOR", "ADMINISTRADOR"})),
    )
    if estado is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No se encontró la práctica solicitada",
        )
    return estado


@router.get(
    "/{id_practica}/historial-estados",
    response_model=list[HistorialEstadoPractica],
)
def consultar_historial_estados(
    id_practica: int,
    contexto: dict = Depends(
        require_roles("ESTUDIANTE", "GESTOR", "ADMINISTRADOR")
    ),
    id_usuario: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    roles = {str(rol).upper() for rol in contexto.get("roles", [])}
    historial = obtener_historial_estados(
        db,
        id_practica,
        id_usuario,
        bool(roles.intersection({"GESTOR", "ADMINISTRADOR"})),
    )
    if historial is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No se encontró la práctica solicitada",
        )
    return historial


@router.patch(
    "/{id_practica}/estado",
    response_model=ActualizarEstadoPracticaResponse,
    dependencies=[Depends(require_roles("GESTOR", "ADMINISTRADOR"))],
)
def actualizar_estado(
    id_practica: int,
    datos: ActualizarEstadoPracticaRequest,
    id_usuario: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    try:
        return actualizar_estado_practica(db, id_practica, id_usuario, datos)
    except PracticaEstadoNoEncontradaError as error:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="La práctica no existe",
        ) from error
    except EstadoPracticaNoDisponibleError as error:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="El estado seleccionado no existe o no está activo",
        ) from error
