from sqlalchemy import text
from sqlalchemy.orm import Session

from app.schemas.revision import DecisionRevisionRequest


class SolicitudNoEncontradaError(Exception):
    pass


class SolicitudNoRevisableError(Exception):
    pass


def listar_solicitudes(db: Session) -> list[dict]:
    return list(db.execute(text("""
        SELECT p.id_practica, p.fecha_registro, ep.nombre AS estado,
               CONCAT(u.nombre, ' ', u.apellido) AS estudiante,
               e.rut AS rut_estudiante, cp.nombre AS centro_practica
        FROM practica p
        JOIN estudiante e ON e.id_estudiante = p.id_estudiante
        JOIN usuario u ON u.id_usuario = e.id_usuario
        JOIN centro_practica cp ON cp.id_centro = p.id_centro
        JOIN estado_practica ep ON ep.id_estado = p.id_estado_actual
        WHERE ep.nombre IN ('REGISTRADA', 'EN_REVISION', 'OBSERVADA')
        ORDER BY p.fecha_registro ASC
    """)).mappings().all())


def obtener_solicitud(db: Session, id_practica: int) -> dict | None:
    return db.execute(text("""
        SELECT p.id_practica, p.fecha_registro, ep.nombre AS estado,
               CONCAT(u.nombre, ' ', u.apellido) AS estudiante,
               e.rut AS rut_estudiante, u.correo AS correo_estudiante,
               e.carrera, e.sede, cp.nombre AS centro_practica,
               cp.rut_empresa, cp.direccion AS direccion_empresa,
               cp.correo AS correo_empresa, cp.contacto_nombre,
               cp.contacto_cargo, p.fecha_inicio, p.fecha_termino,
               p.horas, p.cargo_funcion, p.descripcion
        FROM practica p
        JOIN estudiante e ON e.id_estudiante = p.id_estudiante
        JOIN usuario u ON u.id_usuario = e.id_usuario
        JOIN centro_practica cp ON cp.id_centro = p.id_centro
        JOIN estado_practica ep ON ep.id_estado = p.id_estado_actual
        WHERE p.id_practica = :id_practica
    """), {"id_practica": id_practica}).mappings().first()


def resolver_solicitud(
    db: Session,
    id_practica: int,
    id_usuario: int,
    datos: DecisionRevisionRequest,
) -> dict:
    resultado = db.execute(text("""
        SELECT fn_revisar_practica(
            :id_practica, :id_usuario, :decision, :observacion
        )
    """), {
        "id_practica": id_practica,
        "id_usuario": id_usuario,
        "decision": datos.decision,
        "observacion": datos.observacion.strip() if datos.observacion else None,
    }).scalar_one()

    if resultado.get("error") == "SOLICITUD_NO_ENCONTRADA":
        raise SolicitudNoEncontradaError
    if resultado.get("error") == "SOLICITUD_NO_REVISABLE":
        raise SolicitudNoRevisableError

    db.commit()
    return resultado
