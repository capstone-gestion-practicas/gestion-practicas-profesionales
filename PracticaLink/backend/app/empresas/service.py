import json

import httpx
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import settings
from app.schemas.validators import normalizar_rut


class EmpresaNoEncontradaError(Exception):
    pass


class EmpresaApiNoConfiguradaError(Exception):
    pass


class EmpresaApiNoDisponibleError(Exception):
    pass


def consultar_empresa(db: Session, rut: str) -> dict:
    rut_normalizado = normalizar_rut(rut)

    cache = db.execute(
        text("SELECT fn_obtener_empresa_cache(:rut)"),
        {"rut": rut_normalizado},
    ).scalar_one_or_none()

    if cache and cache.get("cache_vigente"):
        return cache

    try:
        datos_api = _consultar_api(rut_normalizado)
    except (EmpresaApiNoConfiguradaError, EmpresaApiNoDisponibleError):
        if cache:
            cache["cache_vigente"] = False
            return cache
        raise

    guardada = db.execute(
        text("SELECT fn_guardar_empresa_cache(CAST(:datos AS JSONB))"),
        {"datos": _serializar_json(datos_api)},
    ).scalar_one()
    db.commit()
    return guardada


def _consultar_api(rut_normalizado: str) -> dict:
    if not settings.chile_rut_empresa_api_key:
        raise EmpresaApiNoConfiguradaError

    try:
        respuesta = httpx.get(
            f"{settings.chile_rut_empresa_api_url.rstrip('/')}/lookup/{rut_normalizado}",
            headers={"x-api-key": settings.chile_rut_empresa_api_key},
            timeout=8.0,
        )
    except httpx.RequestError as error:
        raise EmpresaApiNoDisponibleError from error

    if respuesta.status_code == 404:
        raise EmpresaNoEncontradaError
    if respuesta.status_code != 200:
        raise EmpresaApiNoDisponibleError

    try:
        datos = respuesta.json()
    except ValueError as error:
        raise EmpresaApiNoDisponibleError from error
    if not datos.get("found") or not datos.get("razon_social"):
        raise EmpresaNoEncontradaError

    return {
        "found": True,
        "rut": rut_normalizado,
        "dv": datos.get("dv"),
        "razon_social": datos["razon_social"],
        "fecha_inicio_actividades": datos.get("fecha_inicio_actividades"),
        "giro": datos.get("giro"),
        "rubro": datos.get("rubro"),
        "subrubro": datos.get("subrubro"),
        "categoria_tributaria": datos.get("categoria_tributaria"),
        "afecta_iva": datos.get("afecta_iva"),
        "actividades": datos.get("actividades") or [],
        "comuna": datos.get("comuna"),
        "region": datos.get("region"),
        "num_trabajadores": datos.get("num_trabajadores"),
        "fuente": "Chile RUT Empresa",
    }


def _serializar_json(datos: dict) -> str:
    return json.dumps(datos, ensure_ascii=False)
