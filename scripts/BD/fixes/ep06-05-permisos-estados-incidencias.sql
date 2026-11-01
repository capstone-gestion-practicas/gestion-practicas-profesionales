-- HU016 WEB. Aplicación única después de EP06-04, solo en entorno autorizado.
-- No modifica datos, constraints, funciones ni capacidades de propietarios HU015.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $dependencies$
BEGIN
    IF pg_catalog.to_regprocedure('incidencias_privadas.fn_registrar_incidencia(bigint,bigint,text,text)') IS NULL
       OR pg_catalog.to_regprocedure('incidencias_privadas.fn_consultar_incidencias(bigint,bigint,integer,bigint)') IS NULL THEN
        RAISE EXCEPTION 'HU016: dependencias EP06 incompletas';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='pl_ep06_executor'
        AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole) THEN
        RAISE EXCEPTION 'HU016: ejecutor incompatible';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conrelid='public.incidencia'::regclass AND conname='fk_incidencia_practica'
        AND contype='f' AND confrelid='public.practica'::regclass AND confdeltype='r'
        AND convalidated AND NOT condeferrable) THEN
        RAISE EXCEPTION 'HU016: conservación incompatible';
    END IF;
    IF (SELECT count(*) FROM pg_catalog.pg_trigger
        WHERE tgrelid IN ('public.incidencia'::regclass,'public.historial_estado_incidencia'::regclass)
        AND tgname IN ('ep06_no_delete','ep06_no_truncate','ep06_historial_no_delete','ep06_historial_no_truncate')
        AND tgenabled='O' AND tgfoid='incidencias_privadas.fn_impedir_borrado()'::regprocedure)<>4 THEN
        RAISE EXCEPTION 'HU016: triggers de conservación incompatibles';
    END IF;
END;
$dependencies$;
CREATE ROLE pl_ep06_state_owner NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE ROLE pl_ep06_history_owner NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
GRANT USAGE ON SCHEMA incidencias_privadas, public TO pl_ep06_state_owner, pl_ep06_history_owner;

-- Capacidades explícitas; los UPDATE de claves en referencias son solo para locks.
CREATE TEMP TABLE hu016_capabilities(owner_name NAME, table_name NAME, reads TEXT[], updates TEXT[], inserts TEXT[]) ON COMMIT DROP;
INSERT INTO hu016_capabilities VALUES
 ('pl_ep06_state_owner','usuario',ARRAY['id_usuario','activo'],ARRAY['id_usuario'],ARRAY[]::TEXT[]),
 ('pl_ep06_state_owner','usuario_rol',ARRAY['id_usuario','id_rol'],ARRAY['id_rol'],ARRAY[]::TEXT[]),
 ('pl_ep06_state_owner','rol',ARRAY['id_rol','nombre','activo'],ARRAY['id_rol'],ARRAY[]::TEXT[]),
 ('pl_ep06_state_owner','practica',ARRAY['id_practica'],ARRAY['id_practica'],ARRAY[]::TEXT[]),
 ('pl_ep06_state_owner','incidencia',ARRAY['id_incidencia','id_practica','id_usuario','id_tipo_incidencia','fecha','descripcion','estado','fecha_resolucion'],
     ARRAY['estado','fecha_resolucion'],ARRAY[]::TEXT[]),
 ('pl_ep06_state_owner','historial_estado_incidencia',
     ARRAY['id_historial','id_incidencia','id_usuario','estado_anterior','estado_nuevo','fecha','comentario'],ARRAY[]::TEXT[],
     ARRAY['id_incidencia','id_usuario','estado_anterior','estado_nuevo','fecha','comentario']),
 ('pl_ep06_history_owner','usuario',ARRAY['id_usuario','activo'],ARRAY[]::TEXT[],ARRAY[]::TEXT[]),
 ('pl_ep06_history_owner','usuario_rol',ARRAY['id_usuario','id_rol'],ARRAY[]::TEXT[],ARRAY[]::TEXT[]),
 ('pl_ep06_history_owner','rol',ARRAY['id_rol','nombre','activo'],ARRAY[]::TEXT[],ARRAY[]::TEXT[]),
 ('pl_ep06_history_owner','practica',ARRAY['id_practica'],ARRAY[]::TEXT[],ARRAY[]::TEXT[]),
 ('pl_ep06_history_owner','incidencia',ARRAY['id_incidencia','id_practica'],ARRAY[]::TEXT[],ARRAY[]::TEXT[]),
 ('pl_ep06_history_owner','historial_estado_incidencia',
     ARRAY['id_historial','id_incidencia','id_usuario','estado_anterior','estado_nuevo','fecha','comentario'],ARRAY[]::TEXT[],ARRAY[]::TEXT[]);
DO $capabilities$
DECLARE r RECORD; c RECORD; op TEXT; cols TEXT[]; col_list TEXT; tab REGCLASS; seq REGCLASS;
BEGIN
    FOR r IN SELECT * FROM pg_temp.hu016_capabilities LOOP
        IF pg_catalog.has_schema_privilege(r.owner_name,'public','CREATE')
           OR pg_catalog.has_schema_privilege(r.owner_name,'incidencias_privadas','CREATE') THEN
            RAISE EXCEPTION 'HU016: creación de objetos no permitida al propietario funcional';
        END IF;
        tab:=pg_catalog.to_regclass('public.'||r.table_name);
        IF tab IS NULL OR NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid=tab)
           OR (SELECT relowner=r.owner_name::regrole FROM pg_catalog.pg_class WHERE oid=tab) THEN
            RAISE EXCEPTION 'HU016: RLS o propiedad incompatible';
        END IF;
        FOREACH op IN ARRAY ARRAY['SELECT','UPDATE','INSERT'] LOOP
            cols:=CASE op WHEN 'SELECT' THEN r.reads WHEN 'UPDATE' THEN r.updates ELSE r.inserts END;
            IF pg_catalog.cardinality(cols)>0 THEN
                SELECT pg_catalog.string_agg(pg_catalog.format('%I',x),',') INTO col_list FROM pg_catalog.unnest(cols) x;
                EXECUTE pg_catalog.format('GRANT %s(%s) ON public.%I TO %I',op,col_list,r.table_name,r.owner_name);
            END IF;
        END LOOP;
        IF pg_catalog.has_table_privilege(r.owner_name,tab,'DELETE,TRUNCATE,REFERENCES,TRIGGER')
           OR pg_catalog.has_any_column_privilege('pl_ep06_executor',tab,'SELECT,INSERT,UPDATE,REFERENCES')
           OR pg_catalog.has_table_privilege('pl_ep06_executor',tab,'DELETE,TRUNCATE,TRIGGER') THEN
            RAISE EXCEPTION 'HU016: privilegios ambientales incompatibles';
        END IF;
        FOR c IN SELECT attnum,attname FROM pg_catalog.pg_attribute WHERE attrelid=tab AND attnum>0 AND NOT attisdropped LOOP
            IF (pg_catalog.has_column_privilege(r.owner_name,tab,c.attnum,'SELECT') AND NOT c.attname=ANY(r.reads))
               OR (pg_catalog.has_column_privilege(r.owner_name,tab,c.attnum,'UPDATE') AND NOT c.attname=ANY(r.updates))
               OR (pg_catalog.has_column_privilege(r.owner_name,tab,c.attnum,'INSERT') AND NOT c.attname=ANY(r.inserts))
               OR pg_catalog.has_column_privilege(r.owner_name,tab,c.attnum,'REFERENCES') THEN
                RAISE EXCEPTION 'HU016: privilegio de columna no previsto';
            END IF;
        END LOOP;
        EXECUTE pg_catalog.format('CREATE POLICY %I ON public.%I FOR SELECT TO %I USING(true)',
            'hu016_'||r.owner_name||'_select',r.table_name,r.owner_name);
        IF pg_catalog.cardinality(r.updates)>0 THEN
            IF r.table_name='incidencia' THEN
                EXECUTE 'CREATE POLICY hu016_state_update ON public.incidencia FOR UPDATE TO pl_ep06_state_owner USING(true) WITH CHECK(true)';
            ELSE
                EXECUTE pg_catalog.format('CREATE POLICY hu016_lock ON public.%I FOR UPDATE TO pl_ep06_state_owner USING(true) WITH CHECK(false)',r.table_name);
                EXECUTE pg_catalog.format('CREATE POLICY hu016_no_update ON public.%I AS RESTRICTIVE FOR UPDATE TO pl_ep06_state_owner USING(true) WITH CHECK(false)',r.table_name);
            END IF;
        END IF;
        IF pg_catalog.cardinality(r.inserts)>0 THEN
            EXECUTE 'CREATE POLICY hu016_state_insert ON public.historial_estado_incidencia FOR INSERT TO pl_ep06_state_owner WITH CHECK(true)';
        END IF;
    END LOOP;
    -- Historial GENERATED ALWAYS: INSERT usa identidad sin conceder acceso a secuencia.
    FOR seq IN SELECT pg_catalog.pg_get_serial_sequence(v.t,v.c)::regclass FROM (VALUES
        ('public.incidencia','id_incidencia'),('public.historial_estado_incidencia','id_historial'),
        ('public.tipo_incidencia','id_tipo_incidencia')) v(t,c)
    LOOP
        IF seq IS NULL OR pg_catalog.has_sequence_privilege('pl_ep06_state_owner',seq,'USAGE,SELECT,UPDATE')
          OR pg_catalog.has_sequence_privilege('pl_ep06_history_owner',seq,'USAGE,SELECT,UPDATE')
          OR pg_catalog.has_sequence_privilege('pl_ep06_executor',seq,'USAGE,SELECT,UPDATE') THEN
            RAISE EXCEPTION 'HU016: privilegios de secuencia incompatibles';
        END IF;
    END LOOP;
END;
$capabilities$;
COMMIT;
