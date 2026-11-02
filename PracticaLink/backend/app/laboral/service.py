import json

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.laboral.schemas import (
    ActualizarPostulacionRequest,
    OfertaLaboralRequest,
    ResolverSolicitudCuentaEmpresaRequest,
    SolicitudCuentaEmpresaRequest,
)


class LaboralError(Exception):
    def __init__(self, codigo: str):
        super().__init__(codigo)
        self.codigo = codigo


def _resultado(db: Session, consulta: str, parametros: dict) -> dict | list:
    resultado = db.execute(text(consulta), parametros).scalar_one()
    if isinstance(resultado, dict) and resultado.get("error"):
        raise LaboralError(resultado["error"])
    return resultado


def listar_practicas_empresa(db: Session, id_usuario: int) -> list[dict]:
    return _resultado(db, """
        SELECT public.fn_laboral_practicas_empresa(:id_usuario)
    """, {"id_usuario": id_usuario})


def listar_ofertas(
    db: Session, id_usuario: int, solo_publicadas: bool
) -> list[dict]:
    return _resultado(db, """
        SELECT public.fn_laboral_listar_ofertas(:id_usuario, :solo_publicadas)
    """, {"id_usuario": id_usuario, "solo_publicadas": solo_publicadas})


def obtener_oferta(
    db: Session, id_usuario: int, id_oferta: int, solo_publicada: bool
) -> dict:
    return _resultado(db, """
        SELECT public.fn_laboral_detalle_oferta(
            :id_usuario, :id_oferta, :solo_publicada
        )
    """, {
        "id_usuario": id_usuario,
        "id_oferta": id_oferta,
        "solo_publicada": solo_publicada,
    })


def guardar_oferta(
    db: Session, id_usuario: int, id_oferta: int | None,
    datos: OfertaLaboralRequest,
) -> dict:
    resultado = _resultado(db, """
        SELECT public.fn_laboral_guardar_oferta(
            :id_usuario, :id_oferta, CAST(:datos AS JSONB)
        )
    """, {
        "id_usuario": id_usuario,
        "id_oferta": id_oferta,
        "datos": datos.model_dump_json(),
    })
    db.commit()
    return resultado


def postular(
    db: Session, id_usuario: int, id_oferta: int, carta_presentacion: str | None
) -> dict:
    resultado = _resultado(db, """
        SELECT public.fn_laboral_postular(
            :id_usuario, :id_oferta, :carta_presentacion
        )
    """, {
        "id_usuario": id_usuario,
        "id_oferta": id_oferta,
        "carta_presentacion": carta_presentacion,
    })
    db.commit()
    return resultado


def listar_mis_postulaciones(db: Session, id_usuario: int) -> list[dict]:
    return _resultado(db, """
        SELECT public.fn_laboral_mis_postulaciones(:id_usuario)
    """, {"id_usuario": id_usuario})


def listar_postulaciones(
    db: Session, id_usuario: int, id_oferta: int
) -> list[dict]:
    return _resultado(db, """
        SELECT public.fn_laboral_listar_postulaciones(:id_usuario, :id_oferta)
    """, {"id_usuario": id_usuario, "id_oferta": id_oferta})


def actualizar_postulacion(
    db: Session, id_usuario: int, id_postulacion: int,
    datos: ActualizarPostulacionRequest,
) -> dict:
    resultado = _resultado(db, """
        SELECT public.fn_laboral_actualizar_postulacion(
            :id_usuario, :id_postulacion, :estado, :observacion
        )
    """, {
        "id_usuario": id_usuario,
        "id_postulacion": id_postulacion,
        "estado": datos.estado,
        "observacion": datos.observacion,
    })
    db.commit()
    return resultado


def listar_historial_postulacion(
    db: Session, id_usuario: int, id_postulacion: int
) -> list[dict]:
    return _resultado(db, """
        SELECT public.fn_laboral_historial_postulacion(
            :id_usuario, :id_postulacion
        )
    """, {"id_usuario": id_usuario, "id_postulacion": id_postulacion})


def crear_solicitud_empresa(
    db: Session, datos: SolicitudCuentaEmpresaRequest
) -> dict:
    valores = datos.model_dump(exclude={"password"})
    resultado = _resultado(db, """
        SELECT public.fn_laboral_solicitar_cuenta_empresa(
            CAST(:datos AS JSONB), :password_hash
        )
    """, {
        "datos": json.dumps(valores, ensure_ascii=False),
        "password_hash": hash_password(datos.password),
    })
    db.commit()
    return resultado


def listar_solicitudes_empresa(db: Session, id_admin: int) -> list[dict]:
    return _resultado(db, """
        SELECT public.fn_laboral_listar_solicitudes_empresa(:id_admin)
    """, {"id_admin": id_admin})


def resolver_solicitud_empresa(
    db: Session,
    id_admin: int,
    id_solicitud: int,
    datos: ResolverSolicitudCuentaEmpresaRequest,
) -> dict:
    resultado = _resultado(db, """
        SELECT public.fn_laboral_resolver_solicitud_empresa(
            :id_admin, :id_solicitud, :estado, :observacion
        )
    """, {
        "id_admin": id_admin,
        "id_solicitud": id_solicitud,
        "estado": datos.estado,
        "observacion": datos.observacion,
    })
    db.commit()
    return resultado
