from threading import Lock

from fastapi import HTTPException
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import ArgumentError, SQLAlchemyError
from sqlalchemy.orm import sessionmaker

from app.core.config import settings


engine = create_engine(
    settings.supabase_database_url,
    pool_pre_ping=True
)

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine
)


def get_db():
    db = SessionLocal()

    try:
        yield db
    finally:
        db.close()


# Conexión aislada; debe pertenecer únicamente a pl_s41_docente_executor.
_docente_factory = None
_docente_lock = Lock()


def _get_docente_session_factory():
    global _docente_factory
    with _docente_lock:
        if _docente_factory is None:
            try:
                if not settings.docente_assignment_database_url:
                    raise ValueError
                restricted = make_url(settings.docente_assignment_database_url)
                principal_urls = (
                    settings.supabase_database_url,
                    settings.inicio_practica_database_url,
                    settings.seguimientos_database_url,
                    settings.seguimientos_lectura_database_url,
                    settings.incidencias_database_url,
                )
                other_principals = [make_url(value) for value in principal_urls if value]
                if (
                    restricted.drivername != "postgresql+psycopg"
                    or not restricted.host
                    or not restricted.database
                    or not restricted.username
                    or any(
                        restricted == other or restricted.username == other.username
                        for other in other_principals
                    )
                    # Evita parámetros libpq capaces de sustituir usuario o destino.
                    or set(restricted.query) - {"sslmode", "sslrootcert", "connect_timeout"}
                ):
                    raise ValueError
                engine_docente = create_engine(
                    restricted,
                    pool_pre_ping=True,
                    hide_parameters=True,
                    connect_args={"connect_timeout": 10},
                )
                _docente_factory = sessionmaker(
                    autocommit=False, autoflush=False, bind=engine_docente
                )
            except (ArgumentError, ValueError, TypeError, SQLAlchemyError):
                raise HTTPException(
                    503, "La conexión docente no está disponible"
                ) from None
        return _docente_factory


def get_docente_assignment_db():
    db = None
    try:
        try:
            db = _get_docente_session_factory()()
            db.connection()
            privilegios_validos = db.execute(text("""
                SELECT NOT r.rolsuper AND NOT r.rolbypassrls
                    AND pg_catalog.pg_has_role(current_user, 'pl_s41_docente_executor', 'MEMBER')
                    AND NOT pg_catalog.pg_has_role(current_user, 'pl_s41_docente_owner', 'MEMBER')
                    AND pg_catalog.has_schema_privilege(current_user, 'docente_privado', 'USAGE')
                    AND pg_catalog.has_function_privilege(current_user, 'docente_privado.fn_gestionar_asignacion(bigint,bigint,bigint,text)', 'EXECUTE')
                    AND pg_catalog.has_function_privilege(current_user, 'docente_privado.fn_listar_practicas_asignadas(bigint)', 'EXECUTE')
                    AND pg_catalog.has_function_privilege(current_user, 'docente_privado.fn_obtener_asignacion(bigint,bigint)', 'EXECUTE')
                    AND NOT EXISTS (
                        SELECT 1
                        FROM pg_catalog.unnest(ARRAY[
                            'public.practica', 'public.historial_asignacion_docente',
                            'public.usuario', 'public.usuario_rol', 'public.rol',
                            'public.estado_practica', 'public.estudiante', 'public.centro_practica'
                        ]) AS relation_name(nombre)
                        WHERE pg_catalog.has_table_privilege(current_user, relation_name.nombre, 'SELECT')
                           OR pg_catalog.has_table_privilege(current_user, relation_name.nombre, 'INSERT')
                           OR pg_catalog.has_table_privilege(current_user, relation_name.nombre, 'UPDATE')
                           OR pg_catalog.has_table_privilege(current_user, relation_name.nombre, 'DELETE')
                           OR pg_catalog.has_table_privilege(current_user, relation_name.nombre, 'TRUNCATE')
                           OR pg_catalog.has_any_column_privilege(current_user, relation_name.nombre, 'SELECT')
                           OR pg_catalog.has_any_column_privilege(current_user, relation_name.nombre, 'INSERT')
                           OR pg_catalog.has_any_column_privilege(current_user, relation_name.nombre, 'UPDATE')
                    )
                FROM pg_catalog.pg_roles r WHERE r.rolname=current_user
            """)).scalar_one_or_none()
            if privilegios_validos is not True:
                raise HTTPException(503, "La conexión docente no está disponible")
        except HTTPException:
            if db is not None:
                db.close()
            raise
        except SQLAlchemyError:
            raise HTTPException(
                503, "La conexión docente no está disponible"
            ) from None
        yield db
    finally:
        if db is not None:
            db.close()
