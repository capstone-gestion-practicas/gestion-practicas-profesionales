-- EP04 / HU04.2: bootstrap de permisos del diseno candidato, NO desplegado.
-- Orden: schema.sql -> este script -> ep04-fn-iniciar-practica.sql.
-- CREATE falla si existe cualquier rol/esquema/politica de este bootstrap.
-- No reutilizar ni modificar roles ajenos automaticamente. Instalador de confianza
-- debe poder crear roles, conceder privilegios y politicas y transferir propiedad.
-- Supabase: verificar esas facultades, propietarios, membresias, grants/default
-- privileges y politicas reales antes de autorizar. No ejecutado remotamente.
-- No incluye secretos, LOGIN, passwords ni cambios a la conexion compartida EP03.
-- El futuro login exclusivo de FastAPI recibira solo pl_ep04_executor; nunca
-- membresia directa/indirecta o capacidad SET ROLE a pl_ep04_owner.
-- No exponer practicas_privadas en la Data API. PostgreSQL local no puede
-- verificar la configuracion de esquemas expuestos de Supabase.

BEGIN;

CREATE ROLE pl_ep04_owner NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS
    NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE ROLE pl_ep04_executor NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS
    NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE SCHEMA practicas_privadas;
REVOKE ALL ON SCHEMA practicas_privadas FROM PUBLIC;
GRANT USAGE ON SCHEMA practicas_privadas TO pl_ep04_owner, pl_ep04_executor;
GRANT USAGE ON SCHEMA public TO pl_ep04_owner;

-- No se transfiere propiedad de tablas y no se concede BYPASSRLS.
GRANT SELECT(id_usuario, activo) ON public.usuario TO pl_ep04_owner;
GRANT SELECT(id_usuario, id_rol) ON public.usuario_rol TO pl_ep04_owner;
GRANT SELECT(id_rol, nombre, activo) ON public.rol TO pl_ep04_owner;
GRANT SELECT(id_estado, nombre, activo, es_final) ON public.estado_practica TO pl_ep04_owner;
GRANT SELECT(id_practica, id_estado_actual) ON public.practica TO pl_ep04_owner;
GRANT SELECT(id_historial, id_practica, id_estado, fecha_cambio)
    ON public.historial_estado TO pl_ep04_owner;

-- Privilegios de columna exigidos por FOR SHARE, no permiso para cambiar
-- autorizacion/catalogo: RLS restrictiva WITH CHECK(false) rechaza esos UPDATE.
GRANT UPDATE(id_usuario) ON public.usuario TO pl_ep04_owner;
GRANT UPDATE(id_rol) ON public.usuario_rol TO pl_ep04_owner;
GRANT UPDATE(id_rol) ON public.rol TO pl_ep04_owner;
GRANT UPDATE(id_estado) ON public.estado_practica TO pl_ep04_owner;
GRANT UPDATE(id_estado_actual, fecha_actualizacion) ON public.practica TO pl_ep04_owner;
GRANT INSERT(id_practica, id_estado, id_usuario, fecha_cambio, observacion)
    ON public.historial_estado TO pl_ep04_owner;
-- identity funciona sin conceder permisos generales a secuencias: probar en version real.

CREATE POLICY ep04_owner_select ON public.usuario FOR SELECT TO pl_ep04_owner USING (true);
CREATE POLICY ep04_owner_select ON public.usuario_rol FOR SELECT TO pl_ep04_owner USING (true);
CREATE POLICY ep04_owner_select ON public.rol FOR SELECT TO pl_ep04_owner USING (true);
CREATE POLICY ep04_owner_select ON public.estado_practica FOR SELECT TO pl_ep04_owner USING (true);
CREATE POLICY ep04_owner_select ON public.practica FOR SELECT TO pl_ep04_owner USING (true);
CREATE POLICY ep04_owner_select ON public.historial_estado FOR SELECT TO pl_ep04_owner USING (true);

CREATE POLICY ep04_owner_lock ON public.usuario FOR UPDATE TO pl_ep04_owner USING (true) WITH CHECK (false);
CREATE POLICY ep04_owner_lock ON public.usuario_rol FOR UPDATE TO pl_ep04_owner USING (true) WITH CHECK (false);
CREATE POLICY ep04_owner_lock ON public.rol FOR UPDATE TO pl_ep04_owner USING (true) WITH CHECK (false);
CREATE POLICY ep04_owner_lock ON public.estado_practica FOR UPDATE TO pl_ep04_owner USING (true) WITH CHECK (false);
-- AND obligatorio incluso si existe una politica permisiva para PUBLIC.
CREATE POLICY ep04_owner_no_auth_write ON public.usuario AS RESTRICTIVE FOR UPDATE TO pl_ep04_owner USING (true) WITH CHECK (false);
CREATE POLICY ep04_owner_no_auth_write ON public.usuario_rol AS RESTRICTIVE FOR UPDATE TO pl_ep04_owner USING (true) WITH CHECK (false);
CREATE POLICY ep04_owner_no_auth_write ON public.rol AS RESTRICTIVE FOR UPDATE TO pl_ep04_owner USING (true) WITH CHECK (false);
CREATE POLICY ep04_owner_no_auth_write ON public.estado_practica AS RESTRICTIVE FOR UPDATE TO pl_ep04_owner USING (true) WITH CHECK (false);
CREATE POLICY ep04_owner_update ON public.practica FOR UPDATE TO pl_ep04_owner USING (true) WITH CHECK (true);
CREATE POLICY ep04_owner_insert ON public.historial_estado FOR INSERT TO pl_ep04_owner WITH CHECK (true);

-- No debilitar RLS/ACL ambientales si son incompatibles: abortar y revisar.
DO $preflight$
DECLARE
    v_tabla TEXT;
    v_oid OID;
    v_col RECORD;
    v_select TEXT[];
    v_update TEXT[];
    v_insert TEXT[];
BEGIN
    FOREACH v_tabla IN ARRAY ARRAY['usuario','usuario_rol','rol','estado_practica','practica','historial_estado']
    LOOP
        v_oid := pg_catalog.to_regclass('public.' || v_tabla);
        IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = v_oid)
           OR (SELECT relowner = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'pl_ep04_owner')
               FROM pg_catalog.pg_class WHERE oid = v_oid) THEN
            RAISE EXCEPTION 'EP04: RLS o propiedad de tablas incompatible';
        END IF;
        IF pg_catalog.has_table_privilege('pl_ep04_owner', v_oid, 'DELETE,TRUNCATE,REFERENCES,TRIGGER')
           OR pg_catalog.has_any_column_privilege('pl_ep04_executor', v_oid, 'SELECT,INSERT,UPDATE,REFERENCES')
           OR pg_catalog.has_table_privilege('pl_ep04_executor', v_oid, 'DELETE,TRUNCATE,TRIGGER') THEN
            RAISE EXCEPTION 'EP04: privilegios ambientales incompatibles en %', v_tabla;
        END IF;
        CASE v_tabla
            WHEN 'usuario' THEN
                v_select := ARRAY['id_usuario','activo']; v_update := ARRAY['id_usuario']; v_insert := ARRAY[]::TEXT[];
            WHEN 'usuario_rol' THEN
                v_select := ARRAY['id_usuario','id_rol']; v_update := ARRAY['id_rol']; v_insert := ARRAY[]::TEXT[];
            WHEN 'rol' THEN
                v_select := ARRAY['id_rol','nombre','activo']; v_update := ARRAY['id_rol']; v_insert := ARRAY[]::TEXT[];
            WHEN 'estado_practica' THEN
                v_select := ARRAY['id_estado','nombre','activo','es_final']; v_update := ARRAY['id_estado']; v_insert := ARRAY[]::TEXT[];
            WHEN 'practica' THEN
                v_select := ARRAY['id_practica','id_estado_actual']; v_update := ARRAY['id_estado_actual','fecha_actualizacion']; v_insert := ARRAY[]::TEXT[];
            WHEN 'historial_estado' THEN
                v_select := ARRAY['id_historial','id_practica','id_estado','fecha_cambio']; v_update := ARRAY[]::TEXT[];
                v_insert := ARRAY['id_practica','id_estado','id_usuario','fecha_cambio','observacion'];
        END CASE;
        FOR v_col IN SELECT attnum, attname FROM pg_catalog.pg_attribute WHERE attrelid=v_oid AND attnum>0 AND NOT attisdropped
        LOOP
            IF (pg_catalog.has_column_privilege('pl_ep04_owner',v_oid,v_col.attnum,'SELECT') AND NOT v_col.attname=ANY(v_select))
               OR (pg_catalog.has_column_privilege('pl_ep04_owner',v_oid,v_col.attnum,'UPDATE') AND NOT v_col.attname=ANY(v_update))
               OR (pg_catalog.has_column_privilege('pl_ep04_owner',v_oid,v_col.attnum,'INSERT') AND NOT v_col.attname=ANY(v_insert))
               OR pg_catalog.has_column_privilege('pl_ep04_owner',v_oid,v_col.attnum,'REFERENCES') THEN
                RAISE EXCEPTION 'EP04: privilegio de columna no previsto en %.%',v_tabla,v_col.attname;
            END IF;
        END LOOP;
    END LOOP;
END;
$preflight$;

COMMIT;
