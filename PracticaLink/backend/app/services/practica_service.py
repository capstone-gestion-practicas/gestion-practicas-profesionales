from sqlalchemy import text
from sqlalchemy.orm import Session

from app.schemas.practica import PracticaCreate


class PerfilEstudianteNoEncontradoError(Exception):
    pass


class PracticaActivaError(Exception):
    pass


class EstadoInicialNoEncontradoError(Exception):
    pass


def registrar_practica(
    db: Session,
    id_usuario: int,
    datos: PracticaCreate,
) -> dict:
    estudiante = db.execute(text("""
        SELECT id_estudiante FROM estudiante WHERE id_usuario = :id_usuario FOR UPDATE
    """), {"id_usuario": id_usuario}).scalar_one_or_none()
    if estudiante is None:
        raise PerfilEstudianteNoEncontradoError
    if db.execute(text("""
        SELECT 1 FROM practica p JOIN estado_practica ep ON ep.id_estado = p.id_estado_actual
        WHERE p.id_estudiante = :id_estudiante AND ep.es_final = FALSE
    """), {"id_estudiante": estudiante}).first():
        raise PracticaActivaError
    estado = db.execute(text("""
        SELECT id_estado, nombre FROM estado_practica
        WHERE nombre = 'REGISTRADA' AND activo = TRUE
    """)).mappings().first()
    if estado is None:
        raise EstadoInicialNoEncontradoError
    centro = datos.centro
    id_centro = None
    if centro.rut_empresa:
        id_centro = db.execute(text("""
            SELECT id_centro FROM centro_practica WHERE UPPER(rut_empresa) = UPPER(:rut)
        """), {"rut": centro.rut_empresa}).scalar_one_or_none()
    if id_centro is None:
        id_centro = db.execute(text("""
            INSERT INTO centro_practica (nombre, rut_empresa, direccion, telefono, correo, contacto_nombre, contacto_cargo)
            VALUES (:nombre, :rut_empresa, :direccion, :telefono, :correo, :contacto_nombre, :contacto_cargo)
            RETURNING id_centro
        """), centro.model_dump()).scalar_one()
    practica = db.execute(text("""
        INSERT INTO practica (id_estudiante, id_centro, id_estado_actual, fecha_inicio, fecha_termino, horas, cargo_funcion, descripcion)
        VALUES (:id_estudiante, :id_centro, :id_estado, :fecha_inicio, :fecha_termino, :horas, :cargo_funcion, :descripcion)
        RETURNING id_practica
    """), {"id_estudiante": estudiante, "id_centro": id_centro, "id_estado": estado["id_estado"], **datos.model_dump(exclude={"centro"})}).scalar_one()
    db.execute(text("""
        INSERT INTO historial_estado (id_practica, id_estado, id_usuario, observacion)
        VALUES (:id_practica, :id_estado, :id_usuario, 'Registro inicial de la práctica')
    """), {"id_practica": practica, "id_estado": estado["id_estado"], "id_usuario": id_usuario})
    db.execute(text("""
        INSERT INTO notificacion (
            id_usuario, id_practica, tipo, titulo, mensaje
        )
        SELECT DISTINCT ur.id_usuario, :id_practica, 'NUEVA_PRACTICA',
               'Nueva práctica registrada',
               CONCAT(solicitante.nombre, ' ', solicitante.apellido,
                      ' registró una práctica en ', cp.nombre, '.')
        FROM usuario_rol ur
        JOIN rol r ON r.id_rol = ur.id_rol
        JOIN usuario destinatario ON destinatario.id_usuario = ur.id_usuario
        JOIN usuario solicitante ON solicitante.id_usuario = :id_usuario
        JOIN centro_practica cp ON cp.id_centro = :id_centro
        WHERE r.nombre IN ('GESTOR', 'ADMINISTRADOR')
          AND r.activo = TRUE AND destinatario.activo = TRUE
    """), {"id_practica": practica, "id_usuario": id_usuario, "id_centro": id_centro})
    db.commit()
    return {"id_practica": practica, "id_centro": id_centro, "estado": estado["nombre"], "mensaje": "Práctica registrada correctamente"}
