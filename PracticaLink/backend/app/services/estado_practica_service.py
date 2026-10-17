from sqlalchemy import text
from sqlalchemy.orm import Session

from app.schemas.practica import ActualizarEstadoPracticaRequest


class PracticaEstadoNoEncontradaError(Exception):
    pass


class EstadoPracticaNoDisponibleError(Exception):
    pass


def obtener_practica_estudiante(db: Session, id_usuario: int) -> dict | None:
    return db.execute(text("""
        SELECT p.id_practica, p.fecha_registro, p.fecha_actualizacion,
               ep.id_estado, ep.nombre AS estado, ep.descripcion AS descripcion_estado,
               ep.es_final, cp.id_centro, cp.nombre AS centro_nombre,
               cp.rut_empresa, cp.direccion, cp.telefono, cp.correo,
               cp.contacto_nombre, cp.contacto_cargo,
               p.fecha_inicio, p.fecha_termino, p.horas,
               p.cargo_funcion, p.descripcion
        FROM practica p
        JOIN estudiante e ON e.id_estudiante = p.id_estudiante
        JOIN estado_practica ep ON ep.id_estado = p.id_estado_actual
        JOIN centro_practica cp ON cp.id_centro = p.id_centro
        WHERE e.id_usuario = :id_usuario
        ORDER BY CASE WHEN ep.es_final = FALSE THEN 0 ELSE 1 END,
                 p.fecha_registro DESC
        LIMIT 1
    """), {"id_usuario": id_usuario}).mappings().first()


def listar_estados_activos(db: Session) -> list[dict]:
    return list(db.execute(text("""
        SELECT id_estado, nombre, descripcion, es_final
        FROM estado_practica
        WHERE activo = TRUE
        ORDER BY CASE nombre
            WHEN 'REGISTRADA' THEN 1
            WHEN 'EN_REVISION' THEN 2
            WHEN 'OBSERVADA' THEN 3
            WHEN 'APROBADA' THEN 4
            WHEN 'EN_CURSO' THEN 5
            WHEN 'FINALIZADA' THEN 6
            WHEN 'RECHAZADA' THEN 7
            ELSE 8
        END, nombre
    """)).mappings().all())


def listar_practicas_para_gestion(db: Session) -> list[dict]:
    return list(db.execute(text("""
        SELECT p.id_practica, p.fecha_registro, p.fecha_actualizacion,
               ep.id_estado, ep.nombre AS estado,
               ep.descripcion AS descripcion_estado, ep.es_final,
               CONCAT(u.nombre, ' ', u.apellido) AS estudiante,
               e.rut AS rut_estudiante, cp.nombre AS centro_practica,
               p.fecha_inicio, p.fecha_termino
        FROM practica p
        JOIN estudiante e ON e.id_estudiante = p.id_estudiante
        JOIN usuario u ON u.id_usuario = e.id_usuario
        JOIN centro_practica cp ON cp.id_centro = p.id_centro
        JOIN estado_practica ep ON ep.id_estado = p.id_estado_actual
        ORDER BY p.fecha_actualizacion DESC, p.id_practica DESC
    """)).mappings().all())


def _consulta_practica_accesible(
    db: Session,
    id_practica: int,
    id_usuario: int,
    puede_gestionar: bool,
) -> dict | None:
    if puede_gestionar:
        return db.execute(text("""
            SELECT p.id_practica, p.fecha_actualizacion,
                   ep.id_estado, ep.nombre AS estado,
                   ep.descripcion AS descripcion_estado, ep.es_final
            FROM practica p
            JOIN estado_practica ep ON ep.id_estado = p.id_estado_actual
            WHERE p.id_practica = :id_practica
        """), {"id_practica": id_practica}).mappings().first()

    return db.execute(text("""
        SELECT p.id_practica, p.fecha_actualizacion,
               ep.id_estado, ep.nombre AS estado,
               ep.descripcion AS descripcion_estado, ep.es_final
        FROM practica p
        JOIN estudiante e ON e.id_estudiante = p.id_estudiante
        JOIN estado_practica ep ON ep.id_estado = p.id_estado_actual
        WHERE p.id_practica = :id_practica
          AND e.id_usuario = :id_usuario
    """), {
        "id_practica": id_practica,
        "id_usuario": id_usuario,
    }).mappings().first()


def obtener_estado_actual(
    db: Session,
    id_practica: int,
    id_usuario: int,
    puede_gestionar: bool,
) -> dict | None:
    practica = _consulta_practica_accesible(
        db, id_practica, id_usuario, puede_gestionar
    )
    if practica is None:
        return None

    return {
        "id_practica": practica["id_practica"],
        "fecha_actualizacion": practica["fecha_actualizacion"],
        "estado": {
            "id_estado": practica["id_estado"],
            "nombre": practica["estado"],
            "descripcion": practica["descripcion_estado"],
            "es_final": practica["es_final"],
        },
    }


def obtener_historial_estados(
    db: Session,
    id_practica: int,
    id_usuario: int,
    puede_gestionar: bool,
) -> list[dict] | None:
    practica = _consulta_practica_accesible(
        db, id_practica, id_usuario, puede_gestionar
    )
    if practica is None:
        return None

    return list(db.execute(text("""
        SELECT h.id_historial, h.id_practica, h.id_estado,
               ep.nombre AS estado, ep.es_final, h.id_usuario,
               CONCAT(u.nombre, ' ', u.apellido) AS usuario,
               h.fecha_cambio, h.observacion
        FROM historial_estado h
        JOIN estado_practica ep ON ep.id_estado = h.id_estado
        JOIN usuario u ON u.id_usuario = h.id_usuario
        WHERE h.id_practica = :id_practica
        ORDER BY h.fecha_cambio ASC, h.id_historial ASC
    """), {"id_practica": id_practica}).mappings().all())


def actualizar_estado_practica(
    db: Session,
    id_practica: int,
    id_usuario: int,
    datos: ActualizarEstadoPracticaRequest,
) -> dict:
    practica = db.execute(text("""
        SELECT p.id_practica, p.id_estado_actual
        FROM practica p
        WHERE p.id_practica = :id_practica
        FOR UPDATE
    """), {"id_practica": id_practica}).mappings().first()

    if practica is None:
        raise PracticaEstadoNoEncontradaError

    nuevo_estado = db.execute(text("""
        SELECT id_estado, nombre
        FROM estado_practica
        WHERE id_estado = :id_estado AND activo = TRUE
    """), {"id_estado": datos.id_estado}).mappings().first()

    if nuevo_estado is None:
        raise EstadoPracticaNoDisponibleError

    if practica["id_estado_actual"] != nuevo_estado["id_estado"]:
        db.execute(text("""
            UPDATE practica
            SET id_estado_actual = :id_estado,
                fecha_actualizacion = NOW()
            WHERE id_practica = :id_practica
        """), {
            "id_estado": nuevo_estado["id_estado"],
            "id_practica": id_practica,
        })
        db.execute(text("""
            INSERT INTO historial_estado (
                id_practica, id_estado, id_usuario, observacion
            ) VALUES (
                :id_practica, :id_estado, :id_usuario, :observacion
            )
        """), {
            "id_practica": id_practica,
            "id_estado": nuevo_estado["id_estado"],
            "id_usuario": id_usuario,
            "observacion": datos.observacion,
        })
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
        """), {
            "id_practica": id_practica,
            "estado": nuevo_estado["nombre"],
        })
        mensaje = "Estado actualizado y registrado en el historial"
    else:
        mensaje = "La práctica ya se encuentra en ese estado"

    db.commit()
    return {
        "id_practica": id_practica,
        "id_estado": nuevo_estado["id_estado"],
        "estado": nuevo_estado["nombre"],
        "mensaje": mensaje,
    }
