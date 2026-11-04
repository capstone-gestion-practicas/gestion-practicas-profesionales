import json
import logging

import httpx
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import settings
from app.schemas.validators import normalizar_rut

logger = logging.getLogger(__name__)


class EmpresaNoEncontradaError(Exception):
    pass


class EmpresaApiNoConfiguradaError(Exception):
    pass


class EmpresaApiNoDisponibleError(Exception):
    pass


def consultar_empresa(db: Session, rut: str) -> dict:
    rut_normalizado = normalizar_rut(rut)
    cache = _leer_cache(db, rut_normalizado)
    if cache and cache.get("cache_vigente"):
        logger.info("Using current cached company data")
        return cache

    try:
        datos_api = _consultar_api(rut_normalizado)
    except (EmpresaApiNoConfiguradaError, EmpresaApiNoDisponibleError):
        if cache:
            cache["cache_vigente"] = False
            return cache
        raise

    guardada = db.execute(text("""
        SELECT public.fn_guardar_empresa_cache(CAST(:datos AS JSONB))
    """), {"datos": json.dumps(datos_api, ensure_ascii=False)}).scalar_one()
    db.commit()
    return guardada


def _leer_cache(db: Session, rut: str) -> dict | None:
    return db.execute(text("""
        SELECT public.fn_obtener_empresa_cache(:rut)
    """), {"rut": rut}).scalar_one_or_none()


def _consultar_api(rut_normalizado: str) -> dict:
    if not settings.chile_rut_empresa_api_key:
        logger.error("Chile RUT Empresa API key is not configured")
        raise EmpresaApiNoConfiguradaError

    rut_api = rut_normalizado.replace(".", "")
    try:
        respuesta = httpx.get(
            f"{settings.chile_rut_empresa_api_url.rstrip('/')}/lookup/{rut_api}",
            headers={"x-api-key": settings.chile_rut_empresa_api_key},
            timeout=8.0,
        )
    except httpx.RequestError as error:
        logger.warning(
            "Chile RUT Empresa request failed (%s)", type(error).__name__
        )
        raise EmpresaApiNoDisponibleError from error

    if respuesta.status_code == 404:
        raise EmpresaNoEncontradaError
    if respuesta.status_code != 200:
        logger.warning(
            "Chile RUT Empresa returned unexpected HTTP status %d",
            respuesta.status_code,
        )
        raise EmpresaApiNoDisponibleError
    logger.info("Chile RUT Empresa returned HTTP status 200")

    try:
        datos = respuesta.json()
    except ValueError as error:
        logger.warning("Chile RUT Empresa returned invalid JSON")
        raise EmpresaApiNoDisponibleError from error
    if not isinstance(datos, dict):
        logger.warning(
            "Chile RUT Empresa returned unexpected JSON type %s",
            type(datos).__name__,
        )
        raise EmpresaApiNoDisponibleError
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
