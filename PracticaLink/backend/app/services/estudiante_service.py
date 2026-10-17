from sqlalchemy import text
from sqlalchemy.orm import Session

from app.schemas.estudiante import PerfilEstudianteCreate


class PerfilEstudianteExistenteError(Exception):
    pass


class UsuarioEstudianteNoValidoError(Exception):
    pass


class RutEstudianteExistenteError(Exception):
    pass


def completar_perfil_estudiante(
    db: Session,
    id_usuario: int,
    datos: PerfilEstudianteCreate,
) -> dict:
    valido = db.execute(text("""
        SELECT 1 FROM usuario u
        JOIN usuario_rol ur ON ur.id_usuario = u.id_usuario
        JOIN rol r ON r.id_rol = ur.id_rol
        WHERE u.id_usuario = :id_usuario AND u.activo = TRUE
          AND r.nombre = 'ESTUDIANTE' AND r.activo = TRUE
    """), {"id_usuario": id_usuario}).first()
    if not valido:
        raise UsuarioEstudianteNoValidoError
    if db.execute(text("SELECT 1 FROM estudiante WHERE id_usuario = :id_usuario"), {"id_usuario": id_usuario}).first():
        raise PerfilEstudianteExistenteError
    if db.execute(text("SELECT 1 FROM estudiante WHERE UPPER(rut) = UPPER(:rut)"), {"rut": datos.rut}).first():
        raise RutEstudianteExistenteError
    fila = db.execute(text("""
        INSERT INTO estudiante (id_usuario, rut, carrera, sede, telefono, direccion)
        VALUES (:id_usuario, :rut, :carrera, :sede, :telefono, :direccion)
        RETURNING id_estudiante
    """), {"id_usuario": id_usuario, **datos.model_dump()}).mappings().one()
    db.commit()
    return {"id_estudiante": fila["id_estudiante"], "mensaje": "Perfil de estudiante completado correctamente"}
