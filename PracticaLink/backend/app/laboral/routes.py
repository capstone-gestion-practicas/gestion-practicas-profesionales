from fastapi import APIRouter, Depends, HTTPException, Path
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.permissions import require_roles
from app.core.security import get_current_user_id
from app.empresas.schemas import EmpresaLookupResponse
from app.empresas.service import (
    EmpresaApiNoConfiguradaError,
    EmpresaApiNoDisponibleError,
    EmpresaNoEncontradaError,
    consultar_empresa,
)
from app.laboral.schemas import (
    ActualizarPostulacionRequest,
    CuentaEmpresaResponse,
    HistorialPostulacionResponse,
    OfertaGuardadaResponse,
    OfertaLaboralRequest,
    OfertaLaboralResponse,
    OperacionPostulacionResponse,
    PostulacionEmpresaResponse,
    PostulacionEstudianteResponse,
    PostularRequest,
    PracticaEmpresaResponse,
    ResolverSolicitudCuentaEmpresaRequest,
    ResolverSolicitudCuentaEmpresaResponse,
    SolicitudCuentaEmpresaAdminResponse,
    SolicitudCuentaEmpresaRequest,
    SolicitudCuentaEmpresaResponse,
)
from app.laboral.service import (
    LaboralError,
    actualizar_postulacion,
    crear_solicitud_empresa,
    guardar_oferta,
    listar_historial_postulacion,
    listar_mis_postulaciones,
    listar_ofertas,
    listar_postulaciones,
    listar_practicas_empresa,
    listar_solicitudes_empresa,
    obtener_cuenta_empresa as consultar_cuenta_empresa,
    obtener_oferta,
    postular,
    resolver_solicitud_empresa,
)

router = APIRouter(prefix="/laboral", tags=["Portal laboral"])


def _http_error(error: LaboralError) -> HTTPException:
    errores = {
        "USUARIO_NO_AUTORIZADO": (403, "No tiene permisos para esta operación"),
        "CUENTA_EMPRESA_NO_CONFIGURADA": (409, "La cuenta empresa no tiene un RUT asociado"),
        "RUT_EMPRESA_REQUERIDO": (422, "Debe indicar el RUT de la empresa"),
        "OFERTA_NO_ENCONTRADA": (404, "La oferta no existe o no está disponible"),
        "OFERTA_NO_DISPONIBLE": (409, "La oferta está cerrada o fuera de plazo"),
        "DATOS_OFERTA_INVALIDOS": (422, "Los datos de la oferta no son válidos"),
        "PERFIL_ESTUDIANTE_NO_ENCONTRADO": (409, "El usuario no tiene un perfil de estudiante"),
        "POSTULACION_DUPLICADA": (409, "Ya postulaste a esta oferta"),
        "POSTULACION_NO_ENCONTRADA": (404, "La postulación no existe"),
        "ESTADO_POSTULACION_INVALIDO": (422, "El estado de la postulación no es válido"),
        "SOLICITUD_EMPRESA_DUPLICADA": (
            409, "Ya existe una cuenta o solicitud con ese correo o RUT"
        ),
        "SOLICITUD_EMPRESA_NO_ENCONTRADA": (404, "La solicitud no existe"),
        "SOLICITUD_EMPRESA_YA_RESUELTA": (409, "La solicitud ya fue revisada"),
        "CORREO_EMPRESA_DUPLICADO": (409, "El correo ya está asociado a una cuenta"),
        "RUT_EMPRESA_DUPLICADO": (409, "El RUT ya está asociado a otra cuenta empresa"),
        "ADMIN_NO_VALIDO": (403, "No tiene permisos para revisar solicitudes"),
        "ESTADO_SOLICITUD_INVALIDO": (422, "El resultado de revisión no es válido"),
        "SOLICITUD_EMPRESA_NO_VALIDA": (409, "La solicitud no tiene una credencial válida"),
    }
    status_code, detail = errores.get(
        error.codigo, (500, "No fue posible completar la operación laboral")
    )
    return HTTPException(status_code=status_code, detail=detail)


def _validar_rut_gestion(datos: OfertaLaboralRequest, contexto: dict) -> None:
    roles = set(contexto.get("roles", []))
    if "EMPRESA" not in roles and not datos.rut_empresa:
        raise HTTPException(status_code=422, detail="Debe indicar el RUT de la empresa")


@router.get(
    "/solicitudes-empresa/consulta/{rut}",
    response_model=EmpresaLookupResponse,
)
def consultar_empresa_para_solicitud(
    rut: str,
    db: Session = Depends(get_db),
):
    try:
        return consultar_empresa(db, rut)
    except ValueError as error:
        raise HTTPException(status_code=422, detail="El RUT no es válido") from error
    except EmpresaNoEncontradaError as error:
        raise HTTPException(status_code=404, detail="Empresa no encontrada") from error
    except EmpresaApiNoConfiguradaError as error:
        raise HTTPException(
            status_code=503, detail="La consulta de empresas no está configurada"
        ) from error
    except EmpresaApiNoDisponibleError as error:
        raise HTTPException(
            status_code=502, detail="El servicio de empresas no está disponible"
        ) from error


@router.post(
    "/solicitudes-empresa",
    response_model=SolicitudCuentaEmpresaResponse,
    status_code=201,
)
def solicitar_cuenta_empresa(
    datos: SolicitudCuentaEmpresaRequest,
    db: Session = Depends(get_db),
):
    try:
        return crear_solicitud_empresa(db, datos)
    except LaboralError as error:
        db.rollback()
        raise _http_error(error) from error


@router.get(
    "/solicitudes-empresa",
    response_model=list[SolicitudCuentaEmpresaAdminResponse],
    dependencies=[Depends(require_roles("ADMINISTRADOR"))],
)
def obtener_solicitudes_empresa(
    id_admin: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    try:
        return listar_solicitudes_empresa(db, id_admin)
    except LaboralError as error:
        raise _http_error(error) from error


@router.patch(
    "/solicitudes-empresa/{id_solicitud}",
    response_model=ResolverSolicitudCuentaEmpresaResponse,
    dependencies=[Depends(require_roles("ADMINISTRADOR"))],
)
def revisar_solicitud_empresa(
    datos: ResolverSolicitudCuentaEmpresaRequest,
    id_solicitud: int = Path(ge=1),
    id_admin: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    try:
        return resolver_solicitud_empresa(db, id_admin, id_solicitud, datos)
    except LaboralError as error:
        db.rollback()
        raise _http_error(error) from error


@router.get(
    "/practicas",
    response_model=list[PracticaEmpresaResponse],
    dependencies=[Depends(require_roles("EMPRESA"))],
)
def obtener_practicas_empresa(
    id_usuario: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    try:
        return listar_practicas_empresa(db, id_usuario)
    except LaboralError as error:
        raise _http_error(error) from error


@router.get(
    "/empresa/cuenta",
    response_model=CuentaEmpresaResponse,
    dependencies=[Depends(require_roles("EMPRESA"))],
)
def obtener_cuenta_empresa_actual(
    id_usuario: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    try:
        return consultar_cuenta_empresa(db, id_usuario)
    except LaboralError as error:
        raise _http_error(error) from error


@router.get(
    "/ofertas",
    response_model=list[OfertaLaboralResponse],
    dependencies=[Depends(require_roles("ESTUDIANTE"))],
)
def obtener_ofertas_publicadas(db: Session = Depends(get_db), id_usuario: int = Depends(get_current_user_id)):
    try:
        return listar_ofertas(db, id_usuario, solo_publicadas=True)
    except LaboralError as error:
        raise _http_error(error) from error


@router.get(
    "/ofertas/gestion",
    response_model=list[OfertaLaboralResponse],
    dependencies=[Depends(require_roles("EMPRESA", "GESTOR", "ADMINISTRADOR"))],
)
def obtener_ofertas_gestion(
    id_usuario: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    try:
        return listar_ofertas(db, id_usuario, solo_publicadas=False)
    except LaboralError as error:
        raise _http_error(error) from error


@router.get(
    "/ofertas/{id_oferta}",
    response_model=OfertaLaboralResponse,
    dependencies=[Depends(require_roles("ESTUDIANTE", "EMPRESA", "GESTOR", "ADMINISTRADOR"))],
)
def detalle_oferta(
    id_oferta: int = Path(ge=1),
    contexto: dict = Depends(require_roles("ESTUDIANTE", "EMPRESA", "GESTOR", "ADMINISTRADOR")),
    id_usuario: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    roles = set(contexto.get("roles", []))
    solo_publicada = not roles.intersection({"EMPRESA", "GESTOR", "ADMINISTRADOR"})
    try:
        return obtener_oferta(db, id_usuario, id_oferta, solo_publicada)
    except LaboralError as error:
        raise _http_error(error) from error


@router.post(
    "/ofertas",
    response_model=OfertaGuardadaResponse,
    status_code=201,
    dependencies=[Depends(require_roles("EMPRESA", "GESTOR", "ADMINISTRADOR"))],
)
def crear_oferta(
    datos: OfertaLaboralRequest,
    contexto: dict = Depends(require_roles("EMPRESA", "GESTOR", "ADMINISTRADOR")),
    id_usuario: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    _validar_rut_gestion(datos, contexto)
    try:
        return guardar_oferta(db, id_usuario, None, datos)
    except LaboralError as error:
        db.rollback()
        raise _http_error(error) from error


@router.put(
    "/ofertas/{id_oferta}",
    response_model=OfertaGuardadaResponse,
    dependencies=[Depends(require_roles("EMPRESA", "GESTOR", "ADMINISTRADOR"))],
)
def modificar_oferta(
    datos: OfertaLaboralRequest,
    id_oferta: int = Path(ge=1),
    contexto: dict = Depends(require_roles("EMPRESA", "GESTOR", "ADMINISTRADOR")),
    id_usuario: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    _validar_rut_gestion(datos, contexto)
    try:
        return guardar_oferta(db, id_usuario, id_oferta, datos)
    except LaboralError as error:
        db.rollback()
        raise _http_error(error) from error


@router.post(
    "/ofertas/{id_oferta}/postulaciones",
    response_model=OperacionPostulacionResponse,
    status_code=201,
    dependencies=[Depends(require_roles("ESTUDIANTE"))],
)
def crear_postulacion(
    datos: PostularRequest,
    id_oferta: int = Path(ge=1),
    id_usuario: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    try:
        return postular(db, id_usuario, id_oferta, datos.carta_presentacion)
    except LaboralError as error:
        db.rollback()
        raise _http_error(error) from error


@router.get(
    "/postulaciones/mias",
    response_model=list[PostulacionEstudianteResponse],
    dependencies=[Depends(require_roles("ESTUDIANTE"))],
)
def obtener_mis_postulaciones(
    id_usuario: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    try:
        return listar_mis_postulaciones(db, id_usuario)
    except LaboralError as error:
        raise _http_error(error) from error


@router.get(
    "/ofertas/{id_oferta}/postulaciones",
    response_model=list[PostulacionEmpresaResponse],
    dependencies=[Depends(require_roles("EMPRESA", "GESTOR", "ADMINISTRADOR"))],
)
def obtener_postulaciones_oferta(
    id_oferta: int = Path(ge=1),
    id_usuario: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    try:
        return listar_postulaciones(db, id_usuario, id_oferta)
    except LaboralError as error:
        raise _http_error(error) from error


@router.patch(
    "/postulaciones/{id_postulacion}",
    response_model=OperacionPostulacionResponse,
    dependencies=[Depends(require_roles("EMPRESA", "GESTOR", "ADMINISTRADOR"))],
)
def cambiar_estado_postulacion(
    datos: ActualizarPostulacionRequest,
    id_postulacion: int = Path(ge=1),
    id_usuario: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    try:
        return actualizar_postulacion(db, id_usuario, id_postulacion, datos)
    except LaboralError as error:
        db.rollback()
        raise _http_error(error) from error


@router.get(
    "/postulaciones/{id_postulacion}/historial",
    response_model=list[HistorialPostulacionResponse],
    dependencies=[Depends(require_roles("ESTUDIANTE", "EMPRESA", "GESTOR", "ADMINISTRADOR"))],
)
def historial_postulacion(
    id_postulacion: int = Path(ge=1),
    id_usuario: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    try:
        return listar_historial_postulacion(db, id_usuario, id_postulacion)
    except LaboralError as error:
        raise _http_error(error) from error
