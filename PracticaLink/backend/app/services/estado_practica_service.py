from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.practicas.schemas import ActualizarEstadoPracticaRequest, ActualizarEstadoPracticaResponse
from app.services.push_service import enviar_push_notificacion


class PracticaEstadoNoEncontradaError(Exception):
    pass


class EstadoPracticaNoDisponibleError(Exception):
    pass


class PracticaNoObservadaError(Exception):
    pass


class CierreManualRequeridoError(Exception):
    pass


class InicioRestringidoRequeridoError(Exception):
    pass


class PracticaFinalizadaNoModificableError(Exception):
    pass


class EstadoPracticaOperacionError(Exception):
    """Resultado no reconocido o inválido: nunca se confirma como éxito."""
    pass

def obtener_practica_estudiante(db: Session, id_usuario: int) -> dict | None:
    return db.execute(text("""
        SELECT public.fn_practica_estudiante(:id_usuario)
    """), {"id_usuario": id_usuario}).scalar_one_or_none()


def listar_estados_activos(db: Session) -> list[dict]:
    return db.execute(text("""
        SELECT public.fn_listar_estados_activos()
    """)).scalar_one()


def listar_practicas_para_gestion(
    db: Session, id_usuario: int, es_administrador: bool
) -> list[dict]:
    if es_administrador:
        practicas = db.execute(text("""
            SELECT public.fn_listar_practicas_gestion()
        """)).scalar_one()
    else:
        practicas = db.execute(text("""
            SELECT public.fn_listar_practicas_gestion_usuario(:id_usuario)
        """), {"id_usuario": id_usuario}).scalar_one()
    if isinstance(practicas, dict) and practicas.get("error"):
        raise PermissionError("No se pudo autorizar la consulta de prácticas")
    return practicas


def listar_gestores_activos(db: Session, id_usuario: int) -> list[dict]:
    gestores = db.execute(text("""
        SELECT public.fn_listar_gestores_activos(:id_usuario)
    """), {"id_usuario": id_usuario}).scalar_one()
    if isinstance(gestores, dict) and gestores.get("error"):
        raise PermissionError("No se pudo autorizar la consulta de gestores")
    return gestores


def asignar_gestor_practica(
    db: Session, id_practica: int, id_admin: int, id_gestor: int | None
) -> dict:
    resultado = db.execute(text("""
        SELECT public.fn_asignar_gestor_practica(
            :id_practica, :id_admin, :id_gestor
        )
    """), {
        "id_practica": id_practica,
        "id_admin": id_admin,
        "id_gestor": id_gestor,
    }).scalar_one()
    if not (isinstance(resultado, dict) and resultado.get("error")):
        db.commit()
    return resultado


def cerrar_practica(
    db: Session, id_practica: int, id_usuario: int, observacion: str | None
) -> dict:
    resultado = db.execute(text("""
        SELECT public.fn_cerrar_practica(
            :id_practica, :id_usuario, :observacion
        )
    """), {
        "id_practica": id_practica,
        "id_usuario": id_usuario,
        "observacion": observacion,
    }).scalar_one()
    if isinstance(resultado, dict) and resultado.get("error"):
        return resultado
    db.commit()
    id_notificacion = resultado.get("id_notificacion")
    id_destinatario = resultado.get("id_usuario_notificado")
    if id_notificacion is not None and id_destinatario is not None:
        enviar_push_notificacion(db, int(id_notificacion), int(id_destinatario))
    return resultado


def procesar_recordatorios_cierre(db: Session) -> list[dict]:
    notificaciones = db.execute(text("""
        SELECT public.fn_procesar_recordatorios_cierre()
    """)).scalar_one()
    db.commit()
    for notificacion in notificaciones:
        enviar_push_notificacion(
            db,
            int(notificacion["id_notificacion"]),
            int(notificacion["id_usuario"]),
        )
    return notificaciones


def listar_estudiantes_sin_practica(db: Session) -> list[dict]:
    return db.execute(text("""
        SELECT public.fn_listar_estudiantes_sin_practica()
    """)).scalar_one()


def obtener_estado_actual(
    db: Session,
    id_practica: int,
    id_usuario: int,
    puede_gestionar: bool,
) -> dict | None:
    return db.execute(text("""
        SELECT public.fn_consultar_estado_practica(
            :id_practica, :id_usuario, :puede_gestionar
        )
    """), {
        "id_practica": id_practica,
        "id_usuario": id_usuario,
        "puede_gestionar": puede_gestionar,
    }).scalar_one_or_none()


def obtener_historial_estados(
    db: Session,
    id_practica: int,
    id_usuario: int,
    puede_gestionar: bool,
) -> list[dict] | None:
    historial = db.execute(text("""
        SELECT public.fn_consultar_historial_estados(
            :id_practica, :id_usuario, :puede_gestionar
        )
    """), {
        "id_practica": id_practica,
        "id_usuario": id_usuario,
        "puede_gestionar": puede_gestionar,
    }).scalar_one_or_none()
    return historial


def actualizar_estado_practica(
    db: Session,
    id_practica: int,
    id_usuario: int,
    datos: ActualizarEstadoPracticaRequest,
) -> dict:
    resultado = db.execute(text("""
        SELECT public.fn_actualizar_estado_practica(
            :id_practica, :id_usuario, :id_estado, :observacion
        )
    """), {
        "id_practica": id_practica,
        "id_usuario": id_usuario,
        "id_estado": datos.id_estado,
        "observacion": datos.observacion,
    }).scalar_one()
    if not isinstance(resultado, dict):
        raise EstadoPracticaOperacionError
    error = resultado.get("error")
    if error == "PRACTICA_NO_ENCONTRADA":
        raise PracticaEstadoNoEncontradaError
    if error == "ESTADO_NO_DISPONIBLE":
        raise EstadoPracticaNoDisponibleError
    if error == "CIERRE_MANUAL_REQUERIDO":
        raise CierreManualRequeridoError
    if error == "INICIO_RESTRINGIDO_REQUERIDO":
        raise InicioRestringidoRequeridoError
    if error == "PRACTICA_FINALIZADA_NO_MODIFICABLE":
        raise PracticaFinalizadaNoModificableError
    if error is not None:
        raise EstadoPracticaOperacionError
    # Validar antes de confirmar: una respuesta inesperada nunca es éxito.
    try:
        ActualizarEstadoPracticaResponse.model_validate(resultado)
    except ValidationError as error_validacion:
        raise EstadoPracticaOperacionError from error_validacion
    db.commit()
    return resultado


def responder_observacion_practica(
    db: Session,
    id_practica: int,
    id_usuario: int,
    respuesta: str,
) -> dict:
    resultado = db.execute(text("""
        SELECT public.fn_responder_observacion_practica(
            :id_practica, :id_usuario, :respuesta
        )
    """), {
        "id_practica": id_practica,
        "id_usuario": id_usuario,
        "respuesta": respuesta,
    }).scalar_one()
    error = resultado.get("error")
    if error == "PRACTICA_NO_ENCONTRADA":
        raise PracticaEstadoNoEncontradaError
    if error == "PRACTICA_NO_OBSERVADA":
        raise PracticaNoObservadaError
    if error == "ESTADO_REVISION_NO_DISPONIBLE":
        raise EstadoPracticaNoDisponibleError
    db.commit()
    return resultado
