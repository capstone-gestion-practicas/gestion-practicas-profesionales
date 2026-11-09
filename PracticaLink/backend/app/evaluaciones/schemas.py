from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Identificador = Annotated[int, Field(strict=True, gt=0, le=9223372036854775807)]
TextoAcademico = Annotated[str, Field(strict=True, max_length=2000)]
Resultado = Literal['APROBADO', 'CON_OBSERVACIONES']


class IniciarEvaluacionRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id_documento: Identificador
    version: Identificador


class ResolverEvaluacionRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    resultado: Resultado
    observaciones: TextoAcademico | None = None

    @field_validator('observaciones')
    @classmethod
    def normalizar(cls, value: str | None) -> str | None:
        # Field length is checked BEFORE stripping, as in PostgreSQL.
        if value is not None and '\x00' in value:
            raise ValueError('El texto contiene caracteres no admitidos por PostgreSQL')
        return value.strip() or None if value is not None else None

    @model_validator(mode='after')
    def requerir_observaciones(self):
        if self.resultado == 'CON_OBSERVACIONES' and not self.observaciones:
            raise ValueError('CON_OBSERVACIONES requiere texto no vacío')
        return self


class EvaluacionResponse(BaseModel):
    # Whitelist public fields; SQL delivery/hash/idempotency internals are omitted.
    model_config = ConfigDict(extra='ignore')
    id_evaluacion: UUID
    id_practica: Identificador
    id_documento: Identificador
    version: Identificador
    id_docente: Identificador
    estado: Literal['EN_CURSO', 'RESUELTA', 'INTERRUMPIDA']
    resultado: Resultado | None
    observaciones: TextoAcademico | None
    motivo: TextoAcademico | None
    inicio: datetime
    termino: datetime | None

    @model_validator(mode='after')
    def coherencia(self):
        if self.estado == 'EN_CURSO' and (self.resultado is not None or self.termino is not None or self.observaciones is not None or self.motivo is not None):
            raise ValueError('Evaluación pendiente inconsistente')
        if self.estado == 'RESUELTA' and (self.resultado is None or self.termino is None or self.motivo is not None or (self.resultado == 'CON_OBSERVACIONES' and not (self.observaciones or '').strip())):
            raise ValueError('Resolución inconsistente')
        if self.estado == 'INTERRUMPIDA' and (self.resultado is not None or self.termino is None or not (self.motivo or '').strip() or self.observaciones is not None):
            raise ValueError('Interrupción inconsistente')
        return self


class EventoEvaluacionResponse(BaseModel):
    model_config = ConfigDict(extra='ignore')
    id_evento: Identificador
    id_evaluacion: UUID
    id_actor: Identificador
    tipo: Literal['INICIADA', 'RESUELTA', 'INTERRUMPIDA']
    fecha: datetime
    detalle: TextoAcademico | None


class HistorialEvaluacionResponse(EvaluacionResponse):
    eventos: list[EventoEvaluacionResponse]


class EstadoAcademicoResponse(BaseModel):
    id_practica: Identificador
    id_documento: Identificador | None
    version: Annotated[int, Field(strict=True, ge=0)]
    estado_informe: Literal['SIN_ENTREGAR', 'ENTREGADO', 'EN_EVALUACION']
    evaluacion_pendiente: EvaluacionResponse | None
    resultado_vigente: EvaluacionResponse | None


class ConsultaAcademicaResponse(EstadoAcademicoResponse):
    historial: list[HistorialEvaluacionResponse]
