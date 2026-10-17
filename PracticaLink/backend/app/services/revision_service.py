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
    practica = db.execute(text("""
        SELECT p.id_practica, ep.nombre AS estado_actual
        FROM practica p JOIN estado_practica ep ON ep.id_estado = p.id_estado_actual
        WHERE p.id_practica = :id_practica FOR UPDATE OF p
    """), {"id_practica": id_practica}).mappings().first()
    if practica is None:
        raise SolicitudNoEncontradaError
    if practica["estado_actual"] not in {"REGISTRADA", "EN_REVISION", "OBSERVADA"}:
        raise SolicitudNoRevisableError
    estado = db.execute(text("""
        SELECT id_estado, nombre FROM estado_practica
        WHERE nombre = :nombre AND activo = TRUE
    """), {"nombre": datos.decision}).mappings().first()
    if estado is None:
        raise SolicitudNoRevisableError
    db.execute(text("""
        UPDATE practica SET id_estado_actual = :id_estado, fecha_actualizacion = NOW()
        WHERE id_practica = :id_practica
    """), {"id_estado": estado["id_estado"], "id_practica": id_practica})
    db.execute(text("""
        INSERT INTO historial_estado (id_practica, id_estado, id_usuario, observacion)
        VALUES (:id_practica, :id_estado, :id_usuario, :observacion)
    """), {"id_practica": id_practica, "id_estado": estado["id_estado"],
           "id_usuario": id_usuario, "observacion": datos.observacion.strip() if datos.observacion else None})
    db.execute(text("""
        INSERT INTO notificacion (
            id_usuario, id_practica, tipo, titulo, mensaje
        )
        SELECT e.id_usuario, :id_practica, 'CAMBIO_ESTADO',
               'Estado de práctica actualizado',
               CONCAT('Tu práctica cambió al estado ', :estado, '.')
        FROM practica p
        JOIN estudiante e ON e.id_estudiante = p.id_estudiante
        WHERE p.id_practica = :id_practica
    """), {"id_practica": id_practica, "estado": estado["nombre"]})
    db.commit()
    return {"id_practica": id_practica, "estado": estado["nombre"], "mensaje": "Solicitud resuelta correctamente"}
