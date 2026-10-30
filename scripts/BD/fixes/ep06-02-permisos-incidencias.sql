-- HU015 WEB: capacidades nuevas, sin modificar conexiones/permisos de EP03/EP04.
-- No crea logins ni contraseñas. El futuro login backend recibirá únicamente
-- pl_ep06_executor; nunca pl_ep06_owner. No conceder ejecutor a clientes/Data API.
-- RLS se comprueba; privilegios ambientales incompatibles abortan todo el script.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
CREATE ROLE pl_ep06_owner NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS
    NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE ROLE pl_ep06_executor NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS
    NOCREATEDB NOCREATEROLE NOREPLICATION;
-- Esquema creado por ep06-01.
REVOKE ALL ON SCHEMA incidencias_privadas FROM PUBLIC;
GRANT USAGE ON SCHEMA incidencias_privadas TO pl_ep06_owner, pl_ep06_executor;
GRANT USAGE ON SCHEMA public TO pl_ep06_owner;

GRANT SELECT(id_usuario, activo), UPDATE(id_usuario) ON public.usuario TO pl_ep06_owner;
GRANT SELECT(id_usuario, id_rol), UPDATE(id_rol) ON public.usuario_rol TO pl_ep06_owner;
GRANT SELECT(id_rol, nombre, activo), UPDATE(id_rol) ON public.rol TO pl_ep06_owner;
GRANT SELECT(id_practica, id_estado_actual), UPDATE(id_practica) ON public.practica TO pl_ep06_owner;
GRANT SELECT(id_estado, nombre, activo, es_final), UPDATE(id_estado) ON public.estado_practica TO pl_ep06_owner;
GRANT SELECT(id_tipo_incidencia,codigo,activo), UPDATE(id_tipo_incidencia) ON public.tipo_incidencia TO pl_ep06_owner;
GRANT INSERT(id_practica,id_usuario,fecha,id_tipo_incidencia,descripcion,estado),
    SELECT(id_incidencia) ON public.incidencia TO pl_ep06_owner;
GRANT INSERT(id_incidencia,id_usuario,estado_anterior,estado_nuevo,fecha) ON public.historial_estado_incidencia TO pl_ep06_owner;

-- UPDATE de columna se necesita para SELECT FOR SHARE/UPDATE. No autoriza
-- cambios: políticas restrictivas bloquean UPDATE incluso con políticas PUBLIC.
DO $policies$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['usuario','usuario_rol','rol','practica','estado_practica','tipo_incidencia'] LOOP
        EXECUTE pg_catalog.format('CREATE POLICY ep06_select ON public.%I FOR SELECT TO pl_ep06_owner USING (true)', t);
        EXECUTE pg_catalog.format('CREATE POLICY ep06_lock ON public.%I FOR UPDATE TO pl_ep06_owner USING (true) WITH CHECK (false)', t);
        EXECUTE pg_catalog.format('CREATE POLICY ep06_no_update ON public.%I AS RESTRICTIVE FOR UPDATE TO pl_ep06_owner USING (true) WITH CHECK (false)', t);
    END LOOP;
END;
$policies$;
CREATE POLICY ep06_insert ON public.incidencia FOR INSERT TO pl_ep06_owner WITH CHECK (true);
CREATE POLICY ep06_return_id ON public.incidencia FOR SELECT TO pl_ep06_owner USING (true);

DO $preflight$
DECLARE
    t TEXT;
    oid_tabla OID;
    c RECORD;
    permitidos_select TEXT[];
    permitidos_update TEXT[];
    permitidos_insert TEXT[];
BEGIN
    FOREACH t IN ARRAY ARRAY['usuario','usuario_rol','rol','practica','estado_practica','tipo_incidencia','incidencia','historial_estado_incidencia'] LOOP
        oid_tabla := pg_catalog.to_regclass('public.' || t);
        IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid=oid_tabla)
           OR (SELECT relowner='pl_ep06_owner'::regrole FROM pg_catalog.pg_class WHERE oid=oid_tabla) THEN
            RAISE EXCEPTION 'EP06: RLS o propiedad incompatible en %', t;
        END IF;
        IF pg_catalog.has_table_privilege('pl_ep06_owner',oid_tabla,'DELETE,TRUNCATE,REFERENCES,TRIGGER')
           OR pg_catalog.has_any_column_privilege('pl_ep06_executor',oid_tabla,'SELECT,INSERT,UPDATE,REFERENCES')
           OR pg_catalog.has_table_privilege('pl_ep06_executor',oid_tabla,'DELETE,TRUNCATE,TRIGGER') THEN
            RAISE EXCEPTION 'EP06: privilegios ambientales incompatibles en %', t;
        END IF;
        permitidos_insert := ARRAY[]::TEXT[];
        CASE t
            WHEN 'usuario' THEN permitidos_select:=ARRAY['id_usuario','activo']; permitidos_update:=ARRAY['id_usuario'];
            WHEN 'usuario_rol' THEN permitidos_select:=ARRAY['id_usuario','id_rol']; permitidos_update:=ARRAY['id_rol'];
            WHEN 'rol' THEN permitidos_select:=ARRAY['id_rol','nombre','activo']; permitidos_update:=ARRAY['id_rol'];
            WHEN 'practica' THEN permitidos_select:=ARRAY['id_practica','id_estado_actual']; permitidos_update:=ARRAY['id_practica'];
            WHEN 'estado_practica' THEN permitidos_select:=ARRAY['id_estado','nombre','activo','es_final']; permitidos_update:=ARRAY['id_estado'];
            WHEN 'tipo_incidencia' THEN permitidos_select:=ARRAY['id_tipo_incidencia','codigo','activo']; permitidos_update:=ARRAY['id_tipo_incidencia'];
            WHEN 'incidencia' THEN
                permitidos_select:=ARRAY['id_incidencia']; permitidos_update:=ARRAY[]::TEXT[];
                permitidos_insert:=ARRAY['id_practica','id_usuario','fecha','id_tipo_incidencia','descripcion','estado'];
            WHEN 'historial_estado_incidencia' THEN
                permitidos_select:=ARRAY[]::TEXT[]; permitidos_update:=ARRAY[]::TEXT[];
                permitidos_insert:=ARRAY['id_incidencia','id_usuario','estado_anterior','estado_nuevo','fecha'];
        END CASE;
        FOR c IN SELECT attnum,attname FROM pg_catalog.pg_attribute WHERE attrelid=oid_tabla AND attnum>0 AND NOT attisdropped LOOP
            IF (pg_catalog.has_column_privilege('pl_ep06_owner',oid_tabla,c.attnum,'SELECT') AND NOT c.attname=ANY(permitidos_select))
               OR (pg_catalog.has_column_privilege('pl_ep06_owner',oid_tabla,c.attnum,'UPDATE') AND NOT c.attname=ANY(permitidos_update))
               OR (pg_catalog.has_column_privilege('pl_ep06_owner',oid_tabla,c.attnum,'INSERT') AND NOT c.attname=ANY(permitidos_insert))
               OR pg_catalog.has_column_privilege('pl_ep06_owner',oid_tabla,c.attnum,'REFERENCES') THEN
                RAISE EXCEPTION 'EP06: privilegio de columna no previsto en %.%',t,c.attname;
            END IF;
        END LOOP;
    END LOOP;
END;
$preflight$;
CREATE POLICY ep06_insert ON public.historial_estado_incidencia FOR INSERT TO pl_ep06_owner WITH CHECK(true);
-- BY DEFAULT identity de incidencia requiere USAGE; ninguna capacidad al ejecutor.
DO $sequence$
DECLARE seq regclass; pair RECORD;
BEGIN
    FOR pair IN SELECT * FROM (VALUES
        ('public.incidencia','id_incidencia'),
        ('public.tipo_incidencia','id_tipo_incidencia'),
        ('public.historial_estado_incidencia','id_historial')
    ) AS sequences(table_name,column_name) LOOP
        seq:=pg_catalog.pg_get_serial_sequence(pair.table_name,pair.column_name)::regclass;
        IF seq IS NULL THEN RAISE EXCEPTION 'EP06: identidad incompatible'; END IF;
        IF pair.table_name='public.incidencia' THEN
            EXECUTE pg_catalog.format('GRANT USAGE ON SEQUENCE %s TO pl_ep06_owner',seq);
        END IF;
        IF pg_catalog.has_sequence_privilege('pl_ep06_executor',seq,'USAGE,SELECT,UPDATE')
          OR pg_catalog.has_sequence_privilege('pl_ep06_owner',seq,'SELECT,UPDATE')
          OR (pair.table_name<>'public.incidencia' AND
              pg_catalog.has_sequence_privilege('pl_ep06_owner',seq,'USAGE')) THEN
            RAISE EXCEPTION 'EP06: privilegios de secuencia incompatibles';
        END IF;
    END LOOP;
END;
$sequence$;
COMMIT;
