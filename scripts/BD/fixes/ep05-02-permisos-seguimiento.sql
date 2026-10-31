-- HU013 WEB: capacidades nuevas, sin modificar conexiones/permisos de EP03/EP04.
-- No crea logins ni contraseñas. El futuro login backend recibirá únicamente
-- pl_ep05_executor; nunca pl_ep05_owner. No conceder ejecutor a clientes/Data API.
-- RLS se comprueba; privilegios ambientales incompatibles abortan todo el script.
BEGIN;
CREATE ROLE pl_ep05_owner NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS
    NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE ROLE pl_ep05_executor NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS
    NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE SCHEMA seguimientos_privados;
REVOKE ALL ON SCHEMA seguimientos_privados FROM PUBLIC;
GRANT USAGE ON SCHEMA seguimientos_privados TO pl_ep05_owner, pl_ep05_executor;
GRANT USAGE ON SCHEMA public TO pl_ep05_owner;

GRANT SELECT(id_usuario, activo), UPDATE(id_usuario) ON public.usuario TO pl_ep05_owner;
GRANT SELECT(id_usuario, id_rol), UPDATE(id_rol) ON public.usuario_rol TO pl_ep05_owner;
GRANT SELECT(id_rol, nombre, activo), UPDATE(id_rol) ON public.rol TO pl_ep05_owner;
GRANT SELECT(id_practica, id_estado_actual), UPDATE(id_practica) ON public.practica TO pl_ep05_owner;
GRANT SELECT(id_estado, nombre, activo, es_final), UPDATE(id_estado) ON public.estado_practica TO pl_ep05_owner;
GRANT INSERT(id_practica, id_usuario, fecha, fecha_seguimiento, tipo, observacion, fecha_creacion),
    SELECT(id_seguimiento) ON public.seguimiento TO pl_ep05_owner;

-- UPDATE de columna se necesita para SELECT FOR SHARE/UPDATE. No autoriza
-- cambios: políticas restrictivas bloquean UPDATE incluso con políticas PUBLIC.
DO $policies$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['usuario','usuario_rol','rol','practica','estado_practica'] LOOP
        EXECUTE pg_catalog.format('CREATE POLICY ep05_select ON public.%I FOR SELECT TO pl_ep05_owner USING (true)', t);
        EXECUTE pg_catalog.format('CREATE POLICY ep05_lock ON public.%I FOR UPDATE TO pl_ep05_owner USING (true) WITH CHECK (false)', t);
        EXECUTE pg_catalog.format('CREATE POLICY ep05_no_update ON public.%I AS RESTRICTIVE FOR UPDATE TO pl_ep05_owner USING (true) WITH CHECK (false)', t);
    END LOOP;
END;
$policies$;
CREATE POLICY ep05_insert ON public.seguimiento FOR INSERT TO pl_ep05_owner WITH CHECK (true);
CREATE POLICY ep05_return_id ON public.seguimiento FOR SELECT TO pl_ep05_owner USING (true);

DO $preflight$
DECLARE
    t TEXT;
    oid_tabla OID;
    c RECORD;
    permitidos_select TEXT[];
    permitidos_update TEXT[];
    permitidos_insert TEXT[];
BEGIN
    FOREACH t IN ARRAY ARRAY['usuario','usuario_rol','rol','practica','estado_practica','seguimiento'] LOOP
        oid_tabla := pg_catalog.to_regclass('public.' || t);
        IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid=oid_tabla)
           OR (SELECT relowner='pl_ep05_owner'::regrole FROM pg_catalog.pg_class WHERE oid=oid_tabla) THEN
            RAISE EXCEPTION 'EP05: RLS o propiedad incompatible en %', t;
        END IF;
        IF pg_catalog.has_table_privilege('pl_ep05_owner',oid_tabla,'DELETE,TRUNCATE,REFERENCES,TRIGGER')
           OR pg_catalog.has_any_column_privilege('pl_ep05_executor',oid_tabla,'SELECT,INSERT,UPDATE,REFERENCES')
           OR pg_catalog.has_table_privilege('pl_ep05_executor',oid_tabla,'DELETE,TRUNCATE,TRIGGER') THEN
            RAISE EXCEPTION 'EP05: privilegios ambientales incompatibles en %', t;
        END IF;
        permitidos_insert := ARRAY[]::TEXT[];
        CASE t
            WHEN 'usuario' THEN permitidos_select:=ARRAY['id_usuario','activo']; permitidos_update:=ARRAY['id_usuario'];
            WHEN 'usuario_rol' THEN permitidos_select:=ARRAY['id_usuario','id_rol']; permitidos_update:=ARRAY['id_rol'];
            WHEN 'rol' THEN permitidos_select:=ARRAY['id_rol','nombre','activo']; permitidos_update:=ARRAY['id_rol'];
            WHEN 'practica' THEN permitidos_select:=ARRAY['id_practica','id_estado_actual']; permitidos_update:=ARRAY['id_practica'];
            WHEN 'estado_practica' THEN permitidos_select:=ARRAY['id_estado','nombre','activo','es_final']; permitidos_update:=ARRAY['id_estado'];
            WHEN 'seguimiento' THEN
                permitidos_select:=ARRAY['id_seguimiento']; permitidos_update:=ARRAY[]::TEXT[];
                permitidos_insert:=ARRAY['id_practica','id_usuario','fecha','fecha_seguimiento','tipo','observacion','fecha_creacion'];
        END CASE;
        FOR c IN SELECT attnum,attname FROM pg_catalog.pg_attribute WHERE attrelid=oid_tabla AND attnum>0 AND NOT attisdropped LOOP
            IF (pg_catalog.has_column_privilege('pl_ep05_owner',oid_tabla,c.attnum,'SELECT') AND NOT c.attname=ANY(permitidos_select))
               OR (pg_catalog.has_column_privilege('pl_ep05_owner',oid_tabla,c.attnum,'UPDATE') AND NOT c.attname=ANY(permitidos_update))
               OR (pg_catalog.has_column_privilege('pl_ep05_owner',oid_tabla,c.attnum,'INSERT') AND NOT c.attname=ANY(permitidos_insert))
               OR pg_catalog.has_column_privilege('pl_ep05_owner',oid_tabla,c.attnum,'REFERENCES') THEN
                RAISE EXCEPTION 'EP05: privilegio de columna no previsto en %.%',t,c.attname;
            END IF;
        END LOOP;
    END LOOP;
END;
$preflight$;
COMMIT;
