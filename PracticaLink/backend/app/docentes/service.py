from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session


class GestionAsignacionDocenteError(Exception):
    def __init__(self, codigo: str):
        self.codigo = codigo


def gestionar_asignacion_docente(
    db: Session, id_practica: int, id_actor: int, id_docente: int | None, motivo: str | None
) -> dict:
    try:
        resultado = db.execute(text("""
            SELECT docente_privado.fn_gestionar_asignacion(
                :id_practica, :id_actor, :id_docente, :motivo
            )
        """), {
            "id_practica": id_practica, "id_actor": id_actor,
            "id_docente": id_docente, "motivo": motivo,
        }).scalar_one()
        if resultado.get("error"):
            db.rollback()
            raise GestionAsignacionDocenteError(resultado["error"])
        db.commit()
        return resultado
    except GestionAsignacionDocenteError:
        raise
    except Exception as error:
        try:
            db.rollback()
        except SQLAlchemyError:
            pass
        raise GestionAsignacionDocenteError("FALLO_OPERACION") from error

def listar_practicas_docente(db: Session, id_docente: int) -> list[dict]:
    try:
        resultado = db.execute(text("""
            SELECT docente_privado.fn_listar_practicas_asignadas(:id_docente)
        """), {"id_docente": id_docente}).scalar_one()
        if isinstance(resultado, dict) and resultado.get("error"):
            db.rollback()
            raise GestionAsignacionDocenteError(resultado["error"])
        db.commit()
        return resultado
    except Exception as error:
        try:
            db.rollback()
        except SQLAlchemyError:
            pass
        raise GestionAsignacionDocenteError("FALLO_OPERACION") from error


def obtener_practica_docente(db: Session, id_docente: int, id_practica: int) -> dict:
    practicas = listar_practicas_docente(db, id_docente)
    practica = next((item for item in practicas if item["id_practica"] == id_practica), None)
    if practica is None:
        raise GestionAsignacionDocenteError("PRACTICA_NO_ENCONTRADA")
    return practica


def obtener_asignacion_docente(db: Session, id_practica: int, id_actor: int) -> dict:
    try:
        resultado = db.execute(text("""
            SELECT docente_privado.fn_obtener_asignacion(:id_practica, :id_actor)
        """), {"id_practica": id_practica, "id_actor": id_actor}).scalar_one()
        if resultado.get("error"):
            db.rollback()
            raise GestionAsignacionDocenteError(resultado["error"])
        db.commit()
        return resultado
    except GestionAsignacionDocenteError:
        raise
    except Exception as error:
        try: db.rollback()
        except SQLAlchemyError: pass
        raise GestionAsignacionDocenteError("FALLO_OPERACION") from error
