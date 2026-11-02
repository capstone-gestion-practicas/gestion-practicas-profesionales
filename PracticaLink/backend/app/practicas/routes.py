from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.inicio_practica_database import get_inicio_practica_db
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
    PracticaDetalleGestionResponse,
    PracticaEstadoResumen,
    PracticasListadoResponse,
    HistorialPracticaResponse,
    IniciarPracticaRequest,
    IniciarPracticaResponse,
    RecordatorioEstudianteResponse,
    ResponderObservacionPracticaRequest,
)
from app.schemas.seguimiento import SeguimientoCreate, SeguimientoResponse
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
    "/{id_practica}/estado/actualizacion",
    response_model=ActualizarEstadoPracticaResponse,
    dependencies=[Depends(require_roles("GESTOR", "ADMINISTRADOR"))],
)
def actualizar_estado_general(
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
