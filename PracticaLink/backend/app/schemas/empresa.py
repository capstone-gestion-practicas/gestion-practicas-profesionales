from datetime import datetime

from pydantic import BaseModel, Field


class ActividadEmpresaResponse(BaseModel):
    codigo: str
    descripcion: str
    afecta_iva: str | None = None
    categoria: str | None = None


class EmpresaLookupResponse(BaseModel):
    found: bool
    rut: str
    dv: str | None = None
    razon_social: str
    fecha_inicio_actividades: str | None = None
    giro: str | None = None
    rubro: str | None = None
    subrubro: str | None = None
    categoria_tributaria: str | None = None
    afecta_iva: str | None = None
    actividades: list[ActividadEmpresaResponse] = Field(default_factory=list)
    comuna: str | None = None
    region: str | None = None
    num_trabajadores: str | None = None
    fuente: str = "Chile RUT Empresa"
    consultado_en: datetime | None = None
    cache_vigente: bool = True
