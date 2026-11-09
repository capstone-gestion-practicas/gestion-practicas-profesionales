from fastapi import APIRouter, Depends, HTTPException, Path, status
from sqlalchemy.orm import Session

from app.core.database import get_docente_assignment_db
from app.core.permissions import require_roles
from app.core.security import get_current_user_id
from app.docentes.schemas import (
    AsignacionDocenteRequest, AsignacionDocenteResponse, AsignacionDocenteDetalleResponse, PracticaDocenteResponse,
)
from app.docentes.service import (
    GestionAsignacionDocenteError, gestionar_asignacion_docente, listar_practicas_docente,
    obtener_practica_docente, obtener_asignacion_docente,
)

router = APIRouter(prefix="/docente", tags=["Espacio docente"])


@router.get("/practicas", response_model=list[PracticaDocenteResponse],
            dependencies=[Depends(require_roles("DOCENTE"))])
def obtener_practicas_asignadas(
    id_usuario: int = Depends(get_current_user_id),
    db: Session = Depends(get_docente_assignment_db),
):
    try:
        return listar_practicas_docente(db, id_usuario)
    except GestionAsignacionDocenteError as error:
        if error.codigo == "USUARIO_NO_AUTORIZADO":
            raise HTTPException(403, "Se requiere un rol DOCENTE activo") from None
        if error.codigo == "CONFLICTO_ASIGNACION":
            raise HTTPException(409, "La asignación cambió; vuelve a consultar") from None
        raise HTTPException(503, "No fue posible consultar las prácticas asignadas") from None


@router.put("/practicas/{id_practica}/asignacion",
            response_model=AsignacionDocenteResponse,
            dependencies=[Depends(require_roles("GESTOR"))])
def actualizar_asignacion(
    datos: AsignacionDocenteRequest,
    id_practica: int = Path(ge=1, le=9223372036854775807),
    id_usuario: int = Depends(get_current_user_id),
    db: Session = Depends(get_docente_assignment_db),
):
    try:
        return gestionar_asignacion_docente(
            db, id_practica, id_usuario, datos.id_docente, datos.motivo
        )
    except GestionAsignacionDocenteError as error:
        errores = {
            "USUARIO_NO_AUTORIZADO": (403, "Se requiere un GESTOR activo"),
            "GESTOR_NO_RESPONSABLE": (403, "Solo el GESTOR responsable puede modificar la asignación"),
            "PRACTICA_NO_ENCONTRADA": (404, "La práctica no existe"),
            "DOCENTE_NO_VALIDO": (409, "La cuenta no tiene un rol DOCENTE activo"),
            "DOCENTE_IGUAL_ESTUDIANTE": (409, "El DOCENTE no puede evaluar su propia práctica"),
            "DATOS_INVALIDOS": (400, "Motivo inválido; máximo 2.000 caracteres"),
            "CONFLICTO_ASIGNACION": (409, "La asignación o evaluación cambió; actualiza e intenta nuevamente"),
            "DOCENTE_IGUAL_GESTOR": (409, "El GESTOR responsable no puede ser también el DOCENTE asignado"),
            "ESTADO_NO_PERMITIDO": (409, "El estado actual no permite modificar la asignación docente"),
            "ASIGNACION_SIN_CAMBIOS": (409, "La asignación no presenta cambios"),
            "MOTIVO_OBLIGATORIO": (422, "Indica el motivo del reemplazo o retiro"),
            "FALLO_OPERACION": (503, "No fue posible actualizar la asignación docente"),
        }
        codigo, mensaje = errores.get(error.codigo, (409, "No fue posible actualizar la asignación"))
        raise HTTPException(status_code=codigo, detail=mensaje) from None


@router.get("/practicas/{id_practica}", response_model=PracticaDocenteResponse,
            dependencies=[Depends(require_roles("DOCENTE"))])
def consultar_practica_asignada(
    id_practica: int = Path(ge=1, le=9223372036854775807),
    id_usuario: int = Depends(get_current_user_id),
    db: Session = Depends(get_docente_assignment_db),
):
    try:
        return obtener_practica_docente(db, id_usuario, id_practica)
    except GestionAsignacionDocenteError as error:
        if error.codigo == "PRACTICA_NO_ENCONTRADA":
            raise HTTPException(404, "La práctica no existe o no está asignada a este docente") from None
        if error.codigo == "USUARIO_NO_AUTORIZADO":
            raise HTTPException(403, "Se requiere un rol DOCENTE activo") from None
        if error.codigo == "CONFLICTO_ASIGNACION":
            raise HTTPException(409, "La asignación cambió; vuelve a consultar") from None
        raise HTTPException(503, "No fue posible consultar la práctica") from None


@router.get("/practicas/{id_practica}/asignacion", response_model=AsignacionDocenteDetalleResponse,
            dependencies=[Depends(require_roles("GESTOR"))])
def consultar_asignacion(
    id_practica: int = Path(ge=1, le=9223372036854775807),
    id_usuario: int = Depends(get_current_user_id),
    db: Session = Depends(get_docente_assignment_db),
):
    try:
        return obtener_asignacion_docente(db, id_practica, id_usuario)
    except GestionAsignacionDocenteError as error:
        errores = {"USUARIO_NO_AUTORIZADO": (403, "Se requiere un GESTOR activo"),
                   "GESTOR_NO_RESPONSABLE": (403, "Solo el GESTOR responsable puede ver la asignación"),
                   "PRACTICA_NO_ENCONTRADA": (404, "La práctica no existe"),
                   "CONFLICTO_ASIGNACION": (409, "La asignación cambió; vuelve a consultar"),
                   "ESTADO_NO_PERMITIDO": (409, "El estado no permite gestionar docentes")}
        codigo, mensaje = errores.get(error.codigo, (503, "No fue posible consultar la asignación"))
        raise HTTPException(codigo, mensaje) from None
