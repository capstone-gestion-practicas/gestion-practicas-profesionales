import json
import logging
import time
from urllib.parse import urlsplit

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
            logger.warning("Provider unavailable; returning stale cached company data")
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
    base_url = settings.chile_rut_empresa_api_url.rstrip("/")
    parsed_url = urlsplit(base_url)
    safe_headers = (
        "content-type",
        "content-length",
        "server",
        "cf-cache-status",
        "cf-ray",
        "x-request-id",
        "x-quota-limit",
        "x-quota-used",
        "x-quota-plan",
    )
    started_at = time.monotonic()
    logger.info(
        "Calling Chile RUT Empresa method=GET scheme=%s host=%s "
        "base_path=%s endpoint=/lookup/<rut> rut_has_dots=%s rut_has_hyphen=%s "
        "api_key_configured=true timeout_seconds=8",
        parsed_url.scheme,
        parsed_url.hostname or "unknown",
        parsed_url.path.rstrip("/"),
        "." in rut_api,
        "-" in rut_api,
    )
    try:
        respuesta = httpx.get(
            f"{base_url}/lookup/{rut_api}",
            headers={"x-api-key": settings.chile_rut_empresa_api_key},
            timeout=8.0,
        )
    except httpx.RequestError as error:
        logger.warning(
            "Chile RUT Empresa request failed error_type=%s elapsed_ms=%.1f",
            type(error).__name__,
            (time.monotonic() - started_at) * 1000,
        )
        raise EmpresaApiNoDisponibleError from error

    elapsed_ms = (time.monotonic() - started_at) * 1000
    response_headers = {
        name: respuesta.headers[name]
        for name in safe_headers
        if name in respuesta.headers
    }
    if respuesta.status_code == 404:
        logger.info(
            "Chile RUT Empresa returned HTTP status=404 elapsed_ms=%.1f "
            "response_headers=%s",
            elapsed_ms,
            response_headers,
        )
        raise EmpresaNoEncontradaError
    if respuesta.status_code != 200:
        logger.warning(
            "Chile RUT Empresa returned unexpected HTTP status=%d "
            "elapsed_ms=%.1f response_headers=%s",
            respuesta.status_code,
            elapsed_ms,
            response_headers,
        )
        raise EmpresaApiNoDisponibleError
    logger.info(
        "Chile RUT Empresa returned HTTP status=200 elapsed_ms=%.1f "
        "response_headers=%s",
        elapsed_ms,
        response_headers,
    )

    try:
        datos = respuesta.json()
    except ValueError as error:
        logger.warning(
            "Chile RUT Empresa returned invalid JSON content_type=%s "
            "content_length=%d",
            respuesta.headers.get("content-type", "unknown"),
            len(respuesta.content),
        )
        raise EmpresaApiNoDisponibleError from error
    if not isinstance(datos, dict):
        logger.warning(
            "Chile RUT Empresa returned unexpected JSON type=%s",
            type(datos).__name__,
        )
        raise EmpresaApiNoDisponibleError
    if not datos.get("found") or not datos.get("razon_social"):
        logger.info(
            "Chile RUT Empresa response had no usable company data "
            "found_field_present=%s razon_social_field_present=%s",
            "found" in datos,
            "razon_social" in datos,
        )
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
