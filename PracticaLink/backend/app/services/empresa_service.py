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

    cache = _leer_cache(db, rut_normalizado)

    if cache and cache.get("cache_vigente"):
        return cache

    try:
        datos_api = _consultar_api(rut_normalizado)
    except (EmpresaApiNoConfiguradaError, EmpresaApiNoDisponibleError):
        if cache:
            cache["cache_vigente"] = False
            return cache
        raise

    guardada = db.execute(text("""
        INSERT INTO empresa (
            rut, dv, razon_social, fecha_inicio_actividades, giro, rubro,
            subrubro, categoria_tributaria, afecta_iva, actividades,
            comuna, region, num_trabajadores, fuente, consultado_en
        ) VALUES (
            :rut, :dv, :razon_social, :fecha_inicio_actividades, :giro, :rubro,
            :subrubro, :categoria_tributaria, :afecta_iva, CAST(:actividades AS JSONB),
            :comuna, :region, CAST(:num_trabajadores AS INTEGER), :fuente, NOW()
        ) ON CONFLICT (rut) DO UPDATE SET
            dv = EXCLUDED.dv, razon_social = EXCLUDED.razon_social,
            fecha_inicio_actividades = EXCLUDED.fecha_inicio_actividades,
            giro = EXCLUDED.giro, rubro = EXCLUDED.rubro, subrubro = EXCLUDED.subrubro,
            categoria_tributaria = EXCLUDED.categoria_tributaria,
            afecta_iva = EXCLUDED.afecta_iva, actividades = EXCLUDED.actividades,
            comuna = EXCLUDED.comuna, region = EXCLUDED.region,
            num_trabajadores = EXCLUDED.num_trabajadores, fuente = EXCLUDED.fuente,
            consultado_en = NOW(), fecha_actualizacion = NOW()
        RETURNING rut, dv, razon_social, fecha_inicio_actividades, giro, rubro,
            subrubro, categoria_tributaria, afecta_iva, actividades, comuna,
            region, num_trabajadores, fuente, consultado_en
    """), {
        **{key: value for key, value in datos_api.items() if key != "found"},
        "actividades": json.dumps(datos_api.get("actividades") or [], ensure_ascii=False),
        "num_trabajadores": datos_api.get("num_trabajadores"),
    }).mappings().one()
    db.commit()
    return {"found": True, **dict(guardada), "num_trabajadores": str(guardada["num_trabajadores"]) if guardada["num_trabajadores"] is not None else None, "cache_vigente": True}


def _leer_cache(db: Session, rut: str) -> dict | None:
    fila = db.execute(text("""
        SELECT rut, dv, razon_social, fecha_inicio_actividades, giro, rubro,
               subrubro, categoria_tributaria, afecta_iva, actividades, comuna,
               region, num_trabajadores, fuente, consultado_en,
               consultado_en >= NOW() - INTERVAL '30 days' AS cache_vigente
        FROM empresa WHERE rut = :rut
    """), {"rut": rut}).mappings().first()
    if fila is None:
        return None
    resultado = dict(fila)
    resultado["found"] = True
    if resultado["num_trabajadores"] is not None:
        resultado["num_trabajadores"] = str(resultado["num_trabajadores"])
    return resultado


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
