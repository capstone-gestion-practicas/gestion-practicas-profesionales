from sqlalchemy import text
from sqlalchemy.orm import Session

from app.practicas.schemas import PracticaCreate


class PerfilEstudianteNoEncontradoError(Exception):
    pass


class PracticaActivaError(Exception):
    pass


class EstadoInicialNoEncontradoError(Exception):
    pass


class PracticaNoEncontradaError(Exception):
    pass


def registrar_practica(
    db: Session,
    id_usuario: int,
    datos: PracticaCreate,
) -> dict:
    resultado = db.execute(
        text("""
            SELECT fn_registrar_practica(
                :id_usuario,
                CAST(:datos AS JSONB)
            )
        """),
        {
            "id_usuario": id_usuario,
            "datos": datos.model_dump_json(),
        },
    ).scalar_one()

    error = resultado.get("error")
    if error == "PERFIL_ESTUDIANTE_NO_ENCONTRADO":
        raise PerfilEstudianteNoEncontradoError
    if error == "PRACTICA_ACTIVA":
        raise PracticaActivaError
    if error == "ESTADO_INICIAL_NO_ENCONTRADO":
        raise EstadoInicialNoEncontradoError

    db.commit()
    return resultado


def obtener_practica_del_estudiante(
    db: Session,
    id_usuario: int,
) -> dict:
    estudiante = db.execute(
        text("""
            SELECT e.id_estudiante
            FROM estudiante e
            WHERE e.id_usuario = :id_usuario
            LIMIT 1
        """),
        {"id_usuario": id_usuario},
    ).mappings().first()

    if estudiante is None:
        raise PerfilEstudianteNoEncontradoError

    practica = db.execute(
        text("""
            SELECT
                p.id_practica,
                p.fecha_registro,
                (
                    SELECT h.fecha_cambio
                    FROM historial_estado h
                    WHERE h.id_practica = p.id_practica
                    ORDER BY h.fecha_cambio DESC, h.id_historial DESC
                    LIMIT 1
                ) AS fecha_ultimo_cambio_estado,
                p.fecha_inicio,
                p.fecha_termino,
                p.horas,
                p.cargo_funcion,
                p.descripcion,
                ep.id_estado,
                ep.nombre AS estado_nombre,
                ep.es_final,
                cp.id_centro,
                cp.nombre AS centro_nombre,
                cp.rut_empresa,
                cp.direccion,
                cp.telefono,
                cp.correo,
                cp.contacto_nombre,
                cp.contacto_cargo
            FROM practica p
            JOIN estado_practica ep ON ep.id_estado = p.id_estado_actual
            JOIN centro_practica cp ON cp.id_centro = p.id_centro
            WHERE p.id_estudiante = :id_estudiante
            ORDER BY p.fecha_registro DESC
            LIMIT 1
        """),
        {"id_estudiante": estudiante["id_estudiante"]},
    ).mappings().first()

    if practica is None:
        raise PracticaNoEncontradaError

    return {
        "id_practica": practica["id_practica"],
        "fecha_registro": practica["fecha_registro"],
        "fecha_ultimo_cambio_estado": practica["fecha_ultimo_cambio_estado"],
        "estado": {
            "id_estado": practica["id_estado"],
            "nombre": practica["estado_nombre"],
            "es_final": practica["es_final"],
        },
        "centro_practica": {
            "id_centro": practica["id_centro"],
            "nombre": practica["centro_nombre"],
            "rut_empresa": practica["rut_empresa"],
            "direccion": practica["direccion"],
            "telefono": practica["telefono"],
            "correo": practica["correo"],
            "contacto_nombre": practica["contacto_nombre"],
            "contacto_cargo": practica["contacto_cargo"],
        },
        "fecha_inicio": practica["fecha_inicio"],
        "fecha_termino": practica["fecha_termino"],
        "horas": practica["horas"],
        "cargo_funcion": practica["cargo_funcion"],
        "descripcion": practica["descripcion"],
    }


def listar_practicas(
    db: Session,
    rut: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> dict:
    filtro = "WHERE e.rut = :rut" if rut is not None else ""
    parametros = {"limit": limit + 1, "offset": offset}
    if rut is not None:
        parametros["rut"] = rut

    filas = db.execute(text(f"""
        SELECT p.id_practica, p.fecha_registro,
               e.id_estudiante, CONCAT(u.nombre, ' ', u.apellido) AS estudiante_nombre,
               cp.nombre AS centro_nombre,
               ep.id_estado, ep.nombre AS estado_nombre, ep.es_final,
               (
                   SELECT h.fecha_cambio
                   FROM historial_estado h
                   WHERE h.id_practica = p.id_practica
                   ORDER BY h.fecha_cambio DESC, h.id_historial DESC
                   LIMIT 1
               ) AS fecha_ultimo_cambio_estado
        FROM practica p
        JOIN estudiante e ON e.id_estudiante = p.id_estudiante
        JOIN usuario u ON u.id_usuario = e.id_usuario
        JOIN centro_practica cp ON cp.id_centro = p.id_centro
        JOIN estado_practica ep ON ep.id_estado = p.id_estado_actual
        {filtro}
        ORDER BY p.fecha_registro DESC, p.id_practica DESC
        LIMIT :limit OFFSET :offset
    """), parametros).mappings().all()

    return {
        "items": [
            {
                "id_practica": fila["id_practica"],
                "estudiante": {
                    "id_estudiante": fila["id_estudiante"],
                    "nombre": fila["estudiante_nombre"],
                },
                "centro_practica": fila["centro_nombre"],
                "fecha_registro": fila["fecha_registro"],
                "estado": {
                    "id_estado": fila["id_estado"],
                    "nombre": fila["estado_nombre"],
                    "es_final": fila["es_final"],
                },
                "fecha_ultimo_cambio_estado": fila["fecha_ultimo_cambio_estado"],
            }
            for fila in filas[:limit]
        ],
        "limit": limit,
        "offset": offset,
        "hay_mas": len(filas) > limit,
    }


def obtener_detalle_practica(db: Session, id_practica: int) -> dict | None:
    practica = db.execute(text("""
        SELECT p.id_practica, p.fecha_registro,
               p.fecha_inicio, p.fecha_termino, p.horas, p.cargo_funcion, p.descripcion,
               e.id_estudiante, CONCAT(u.nombre, ' ', u.apellido) AS estudiante_nombre,
               cp.id_centro, cp.nombre AS centro_nombre,
               ep.id_estado, ep.nombre AS estado_nombre, ep.es_final,
               (
                   SELECT h.fecha_cambio
                   FROM historial_estado h
                   WHERE h.id_practica = p.id_practica
                   ORDER BY h.fecha_cambio DESC, h.id_historial DESC
                   LIMIT 1
               ) AS fecha_ultimo_cambio_estado
        FROM practica p
        JOIN estudiante e ON e.id_estudiante = p.id_estudiante
        JOIN usuario u ON u.id_usuario = e.id_usuario
        JOIN centro_practica cp ON cp.id_centro = p.id_centro
        JOIN estado_practica ep ON ep.id_estado = p.id_estado_actual
        WHERE p.id_practica = :id_practica
    """), {"id_practica": id_practica}).mappings().first()

    if practica is None:
        return None

    return {
        "id_practica": practica["id_practica"],
        "estudiante": {
            "id_estudiante": practica["id_estudiante"],
            "nombre": practica["estudiante_nombre"],
        },
        "centro_practica": {
            "id_centro": practica["id_centro"],
            "nombre": practica["centro_nombre"],
        },
        "fecha_registro": practica["fecha_registro"],
        "estado": {
            "id_estado": practica["id_estado"],
            "nombre": practica["estado_nombre"],
            "es_final": practica["es_final"],
        },
        "fecha_ultimo_cambio_estado": practica["fecha_ultimo_cambio_estado"],
        "fecha_inicio": practica["fecha_inicio"],
        "fecha_termino": practica["fecha_termino"],
        "horas": practica["horas"],
        "cargo_funcion": practica["cargo_funcion"],
        "descripcion": practica["descripcion"],
    }
