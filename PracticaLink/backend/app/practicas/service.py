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
