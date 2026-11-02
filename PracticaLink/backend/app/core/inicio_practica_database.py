"""Conexión exclusiva de HU04.2; nunca utiliza la sesión principal."""

from threading import Lock

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.exc import ArgumentError, SQLAlchemyError
from sqlalchemy.orm import sessionmaker

from app.core.config import settings


_factory = None
_factory_lock = Lock()
_UNAVAILABLE = "La conexión de inicio de práctica no está disponible"


def _validated_url():
    try:
        if not settings.inicio_practica_database_url:
            raise ValueError
        restricted = make_url(settings.inicio_practica_database_url)
        principal = make_url(settings.supabase_database_url)
        if (
            restricted.drivername != "postgresql+psycopg"
            or not restricted.host
            or not restricted.database
            or not restricted.username
            or restricted == principal
            or restricted.username == principal.username
            # No permitir que parámetros libpq sustituyan la identidad/destino.
            or set(restricted.query) - {"sslmode", "sslrootcert", "connect_timeout"}
        ):
            raise ValueError
        return restricted
    except (ArgumentError, ValueError, TypeError):
        raise HTTPException(status_code=503, detail=_UNAVAILABLE) from None


def _get_session_factory():
    global _factory
    with _factory_lock:
        if _factory is None:
            url = _validated_url()
            engine = None
            try:
                engine = create_engine(
                    url, pool_pre_ping=True, hide_parameters=True,
                    connect_args={"connect_timeout": 10},
                )
                _factory = sessionmaker(autocommit=False, autoflush=False, bind=engine)
            except (SQLAlchemyError, ValueError, ImportError):
                if engine is not None:
                    engine.dispose()
                raise HTTPException(status_code=503, detail=_UNAVAILABLE) from None
        return _factory


def get_inicio_practica_db():
    """Abre la conexión al usarse; cierre revierte transacciones no confirmadas.

    El futuro servicio debe confirmar solo el éxito. No se traduce aquí ningún
    error del caso de uso ni se confirma automáticamente una transacción.
    """
    db = None
    error_previo = False
    try:
        try:
            db = _get_session_factory()()
            db.connection()
        except SQLAlchemyError:
            raise HTTPException(status_code=503, detail=_UNAVAILABLE) from None
        yield db
    except BaseException as error:
        # GeneratorExit indica cierre del generador, no un fallo del caso de uso.
        error_previo = not isinstance(error, GeneratorExit)
        raise
    finally:
        if db is not None:
            try:
                db.close()
            except SQLAlchemyError:
                if not error_previo:
                    raise HTTPException(status_code=503, detail=_UNAVAILABLE) from None
