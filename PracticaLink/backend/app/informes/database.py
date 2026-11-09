"""Dedicated SQL executor; fail closed, no fallback to the general connection."""
from threading import Lock
from fastapi import HTTPException
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker
from app.core.config import settings

_factory = None
_lock = Lock()


def get_informe_db():
    global _factory
    db = None
    try:
        with _lock:
            if _factory is None:
                url = make_url(settings.informe_database_url or '')
                others = [settings.supabase_database_url, settings.docente_assignment_database_url,
                          settings.inicio_practica_database_url, settings.seguimientos_database_url,
                          settings.seguimientos_lectura_database_url, settings.incidencias_database_url]
                if (url.drivername != 'postgresql+psycopg' or not url.host or not url.username or not url.database
                        or set(url.query)-{'sslmode','sslrootcert','connect_timeout'}
                        or any(url.username == make_url(other).username for other in others if other)):
                    raise ValueError('principal no dedicado')
                _factory = sessionmaker(bind=create_engine(url, pool_pre_ping=True, hide_parameters=True,
                                                           connect_args={'connect_timeout': 10}))
        db = _factory()
        ok = db.execute(text("""
         SELECT NOT rolsuper AND NOT rolbypassrls
           AND pg_has_role(current_user,'pl_s42_executor','USAGE')
           AND NOT pg_has_role(current_user,'pl_s42_owner','MEMBER')
           AND NOT EXISTS (SELECT 1 FROM pg_roles other WHERE other.rolname NOT IN (current_user,'pl_s42_executor') AND pg_has_role(current_user,other.oid,'MEMBER'))
           AND NOT has_schema_privilege(current_user,'informes_privados','CREATE')
           AND has_schema_privilege(current_user,'informes_privados','USAGE')
           AND NOT EXISTS (SELECT 1 FROM unnest(ARRAY['usuario','usuario_rol','rol','practica','estudiante','estado_practica','documento','tipo_documento','informe_final','informe_entrega','notificacion','evaluacion_informe','evaluacion_evento','cierre_practica','historial_estado']) t
            WHERE has_table_privilege(current_user,'public.'||t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
            OR has_any_column_privilege(current_user,'public.'||t,'SELECT,INSERT,UPDATE,REFERENCES'))
           AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='informes_privados' AND p.proname IN ('consultar','reservar','confirmar','archivo','limpieza','iniciar_evaluacion','resolver_evaluacion','historial_evaluacion')
            AND NOT has_function_privilege(current_user,p.oid,'EXECUTE'))
           AND (SELECT count(*)=9 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                WHERE n.nspname='informes_privados' AND p.oid IN (
                 to_regprocedure('informes_privados.consultar(bigint,bigint)'),
                 to_regprocedure('informes_privados.reservar(bigint,bigint,uuid,bigint,text,text,bigint)'),
                 to_regprocedure('informes_privados.reservar(bigint,bigint,uuid,bigint,text,text,bigint,text)'),
                 to_regprocedure('informes_privados.confirmar(bigint,bigint,uuid)'),
                 to_regprocedure('informes_privados.archivo(bigint,bigint)'),
                 to_regprocedure('informes_privados.limpieza()'),
                 to_regprocedure('informes_privados.iniciar_evaluacion(bigint,bigint,uuid,bigint,bigint)'),
                 to_regprocedure('informes_privados.resolver_evaluacion(bigint,bigint,uuid,uuid,text,text)'),
                 to_regprocedure('informes_privados.historial_evaluacion(bigint,bigint)')))
           AND NOT EXISTS (SELECT 1 FROM pg_roles client
                WHERE client.rolname IN ('anon','authenticated','service_role')
                AND has_function_privilege(client.oid,
                 to_regprocedure('informes_privados.reservar(bigint,bigint,uuid,bigint,text,text,bigint,text)'), 'EXECUTE'))
           AND has_function_privilege(current_user,'public.fn_cerrar_practica(bigint,bigint,text)','EXECUTE')
           AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                WHERE n.nspname='informes_privados' AND p.proname NOT IN
                 ('consultar','reservar','confirmar','archivo','limpieza','iniciar_evaluacion','resolver_evaluacion','historial_evaluacion')
                AND has_function_privilege(current_user,p.oid,'EXECUTE'))
         FROM pg_roles WHERE rolname=current_user
        """)).scalar_one_or_none()
        if ok is not True:
            raise ValueError('ACL incompatibles')
    except Exception:
        if db is not None:
            db.close()
        raise HTTPException(503, 'La conexión de informes no está disponible') from None
    try:
        yield db
    finally:
        db.close()
