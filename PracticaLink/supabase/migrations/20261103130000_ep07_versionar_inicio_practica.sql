-- EP07 · Corrección 3: versiona el bootstrap de permisos y la función fn_iniciar_practica.
-- Incremental: NO modifica migraciones previas. Reproduce, en el mismo orden validado en
-- laboratorio, scripts/BD/fixes/ep04-01-permisos-iniciar-practica.sql y
-- scripts/BD/fixes/ep04-fn-iniciar-practica.sql (sin sus BEGIN/COMMIT: la migración ya es una transacción).
-- Origen: copia textual auditada; ver PracticaLink/backend/app/BACK_CONTEXT.md (EP07 Corrección 3).

-- ===== Parte 1: bootstrap de permisos (ep04-01) =====
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
GRANT SELECT(id_practica, id_estado_actual, id_gestor) ON public.practica TO pl_ep04_owner;
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
                v_select := ARRAY['id_practica','id_estado_actual','id_gestor']; v_update := ARRAY['id_estado_actual','fecha_actualizacion']; v_insert := ARRAY[]::TEXT[];
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


-- ===== Parte 2: función fn_iniciar_practica (ep04-fn) =====
-- EP04 / HU04.2: APROBADA -> EN_CURSO.
-- PREPARADO PARA REVISION. Validacion solo en PostgreSQL local aislado.
-- No aplicado a Supabase. Esta revision incorpora bloqueos de autorizacion/catalogo.
-- Orden: schema.sql -> ep04-01-permisos-iniciar-practica.sql -> este script.
-- Solo despues de revision y autorizacion del entorno. No aplicado a Supabase.
-- En instalaciones existentes no se elimina la firma publica anterior: auditarla
-- y retirarla por separado si ya se hubiera desplegado. No crear un wrapper RPC.
-- No modifica fn_revisar_practica ni repara datos historicos.
--
-- Contrato de errores de negocio (JSONB con clave error):
-- USUARIO_NO_AUTORIZADO       -> HTTP 403 (inexistente, inactivo o sin rol activo).
-- PRACTICA_NO_ENCONTRADA      -> HTTP 404.
-- ESTADO_FINAL               -> HTTP 409.
-- TRANSICION_NO_PERMITIDA     -> HTTP 409 (incluye EN_CURSO -> EN_CURSO).
-- HISTORIAL_INCONSISTENTE     -> HTTP 409 (ausente, diferente o fecha futura).
-- ESTADO_DESTINO_NO_VALIDO    -> HTTP 500 (EN_CURSO ausente/inactivo/final).
-- GESTOR_NO_ASIGNADO          -> HTTP 409 (la practica requiere un gestor activo asignado).
-- OBSERVACION_INVALIDA        -> HTTP 422 (mas de 500 caracteres).
-- INICIO_NO_CONFIRMADO (excepcion) -> HTTP 500 y rollback obligatorio.
-- Excepciones SQL inesperadas: propagar; FastAPI debe hacer rollback, sin
-- exponer SQL, observaciones o detalles internos. lock_timeout: conflicto
-- temporal; serialization_failure/deadlock: rollback de toda la transaccion.
-- FastAPI debe obtener p_id_usuario del JWT, nunca del cuerpo de la peticion.
--
-- Seguridad: DEFINER propiedad de pl_ep04_owner (NOLOGIN, sin privilegios
-- administrativos, no propietario de tablas); ejecuta con sus politicas RLS.
-- pl_ep04_executor recibe solo USAGE del esquema y EXECUTE de esta firma.
-- Ambos son roles de capacidad NOLOGIN; el login exclusivo de FastAPI se
-- aprovisionara fuera del script, sin pertenencia al propietario tecnico.
-- Esquema practicas_privadas: NO incluir en los esquemas expuestos de Supabase.
-- No se cambia el login ni los permisos existentes de EP03.
-- Objetos public calificados y search_path sin esquemas controlados por clientes.
-- El actor sigue siendo una afirmacion del backend de confianza, no un JWT SQL.
-- CREATE FUNCTION falla si existe la firma: no sustituir objetos automaticamente.
-- ACL: se elimina PUBLIC y cualquier concesion explicita no deseada heredada de
-- default privileges al crear esta funcion; despues se concede al ejecutor.
-- No se concede pertenencia a pl_ep04_owner ni CREATE permanente al propietario.
-- Un propietario/superusuario del despliegue sigue siendo una autoridad confiable.
-- El script previo falla si detecta privilegios ambientales incompatibles.
-- No asignar el rol ejecutor a roles cliente ni modificar grants generales.
--
-- Transacciones: el llamador debe hacer commit SOLO en exito y rollback ante
-- cualquier error. Los bloqueos duran hasta finalizar la transaccion externa.
-- El BEGIN/COMMIT de este archivo instala el objeto; NO hay COMMIT en la funcion.
--
-- Casos de integracion en base aislada con datos sinteticos:
-- Repetir en cada revision; la validacion local no aprueba despliegue real.
-- La revision con bloqueos tambien prueba mutaciones de usuario/rol/asignacion
-- y catalogo en ambos ordenes, asi como concurrencia con EP03. No afirmar que
-- pruebas finitas demuestran ausencia general de deadlocks.
-- 1. Gestor/administrador activo, APROBADA y ultimo evento coincidente: un UPDATE,
--    un evento EN_CURSO; timestamp exacto compartido y respuesta con ambos estados.
-- 2. Actor ausente/inactivo, estudiante, rol inactivo o sin asignacion: 403 sin cambios.
-- 3. Practica ausente: 404; todos los otros origenes y repeticion: 409 sin evento.
-- 4. FINALIZADA/RECHAZADA y cualquier catalogo es_final=true: rechazo sin cambios.
-- 5. EN_CURSO ausente/inactivo/final: 500 sin cambios.
-- 6. Historial vacio, ultimo evento diferente o fecha futura: 409 sin reparacion.
-- 7. Fechas iguales: comprobar desempate por id_historial DESC.
-- 8. Observacion NULL/vacia/espacios y 500 caracteres; 501: rechazo sin truncar.
-- 9. Provocar fallo al insertar historial: UPDATE revertido por la excepcion;
--    rollback del llamador tras exito tambien revierte estado e historial.
-- 10. Dos conexiones: A inicia y mantiene transaccion abierta; B espera el lock.
--     Si A confirma, B rechaza origen EN_CURSO; exactamente un evento nuevo.
--     Si A revierte, B puede completar; exactamente un cambio persistente.
-- 11. Verificar permisos de funcion, RLS y secuencias con el rol real de backend;
--     PUBLIC/roles cliente sin privilegio efectivo de ejecucion.
-- 12. UPDATE o INSERT suprimido por politica/trigger: excepcion, sin exito parcial.
-- 13. Regresion de fn_revisar_practica y lectura de detalle/historial.
--
-- Limites: el estado anterior se devuelve, pero no se almacena en columna nueva.
-- HU04.3 lo deriva del evento previo. Los nombres del catalogo son los actuales.
-- Escritores directos que omitan el bloqueo de practica pueden romper el protocolo;
-- la consistencia global exige controlar esos privilegios por separado.
-- Orden de bloqueos de esta funcion:
-- usuario responsable FOR SHARE -> sus asignaciones por id_rol FOR SHARE ->
-- roles asignados por id_rol FOR SHARE -> practica FOR UPDATE ->
-- catalogo (origen y destino) por id_estado FOR SHARE.
-- Usuario primero es compatible con fn_actualizar_usuario_admin, que bloquea
-- el usuario antes de editarlo y reemplazar sus asignaciones. No modificar ese
-- procedimiento ni fn_revisar_practica. SHARE deja coexistir inicios del mismo
-- responsable y bloquea modificaciones de las filas protegidas hasta commit.
-- Se valida usando los valores obtenidos DESPUES de adquirir cada bloqueo.
-- Una asignacion nueva concurrente no invalida una autorizacion ya protegida;
-- si no se encontro autorizacion vigente se rechaza sin esperar altas futuras.
-- Sin garantia general de ausencia de deadlocks: otros escritores pueden usar
-- otro orden; 40P01/40001/55P03 deben causar rollback por el llamador.
-- READ COMMITTED: validar datos actualizados tras esperas; a mayor aislamiento
-- pueden aparecer errores de serializacion y debe repetirse la transaccion.
-- No garantiza que una revocacion ya solicitada tenga prioridad: la operacion
-- que obtiene primero los bloqueos termina antes y la otra espera.


CREATE FUNCTION practicas_privadas.fn_iniciar_practica(
    p_id_practica BIGINT,
    p_id_usuario BIGINT,
    p_observacion VARCHAR DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_id_estado_anterior BIGINT;
    v_nombre_estado_anterior VARCHAR(50);
    v_es_final BOOLEAN;
    v_id_estado_nuevo BIGINT;
    v_id_ultimo_estado BIGINT;
    v_fecha_ultimo_evento TIMESTAMPTZ;
    v_fecha_cambio TIMESTAMPTZ;
    v_id_historial BIGINT;
    v_id_practica_actualizada BIGINT;
    v_observacion TEXT;
    v_usuario_activo BOOLEAN;
    v_ids_roles BIGINT[] := ARRAY[]::BIGINT[];
    v_id_rol BIGINT;
    v_rol RECORD;
    v_autorizado BOOLEAN := FALSE;
    v_estado RECORD;
    v_destino_valido BOOLEAN := FALSE;
    v_id_gestor BIGINT;
    v_es_administrador BOOLEAN := FALSE;
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.usuario u
        JOIN public.usuario_rol ur ON ur.id_usuario = u.id_usuario
        JOIN public.rol r ON r.id_rol = ur.id_rol
        WHERE u.id_usuario = p_id_usuario AND u.activo = TRUE
          AND r.activo = TRUE AND r.nombre IN ('GESTOR', 'ADMINISTRADOR')
    ) THEN
        RETURN pg_catalog.jsonb_build_object('error', 'USUARIO_NO_AUTORIZADO');
    END IF;

    -- Bloquear usuario antes de sus asignaciones, como hace administracion.
    SELECT u.activo
    INTO v_usuario_activo
    FROM public.usuario u
    WHERE u.id_usuario = p_id_usuario
    FOR SHARE OF u;
    IF NOT FOUND OR v_usuario_activo IS NOT TRUE THEN
        RETURN pg_catalog.jsonb_build_object('error', 'USUARIO_NO_AUTORIZADO');
    END IF;

    FOR v_id_rol IN
        SELECT ur.id_rol
        FROM public.usuario_rol ur
        WHERE ur.id_usuario = p_id_usuario
        ORDER BY ur.id_rol
        FOR SHARE OF ur
    LOOP
        v_ids_roles := pg_catalog.array_append(v_ids_roles, v_id_rol);
    END LOOP;

    FOR v_rol IN
        SELECT r.id_rol, r.nombre, r.activo
        FROM public.rol r
        WHERE r.id_rol = ANY(v_ids_roles)
        ORDER BY r.id_rol
        FOR SHARE OF r
    LOOP
        IF v_rol.activo AND v_rol.nombre IN ('GESTOR', 'ADMINISTRADOR') THEN
            v_autorizado := TRUE;
        END IF;
        IF v_rol.activo AND v_rol.nombre = 'ADMINISTRADOR' THEN
            v_es_administrador := TRUE;
        END IF;
    END LOOP;
    IF NOT v_autorizado THEN
        RETURN pg_catalog.jsonb_build_object('error', 'USUARIO_NO_AUTORIZADO');
    END IF;

    SELECT p.id_estado_actual, p.id_gestor
    INTO v_id_estado_anterior, v_id_gestor
    FROM public.practica p
    WHERE p.id_practica = p_id_practica
    FOR UPDATE OF p;

    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('error', 'PRACTICA_NO_ENCONTRADA');
    END IF;

    IF v_id_gestor IS NULL OR NOT EXISTS (
        SELECT 1
        FROM public.usuario u
        JOIN public.usuario_rol ur ON ur.id_usuario = u.id_usuario
        JOIN public.rol r ON r.id_rol = ur.id_rol
        WHERE u.id_usuario = v_id_gestor
          AND u.activo
          AND r.activo
          AND r.nombre = 'GESTOR'
    ) THEN
        RETURN pg_catalog.jsonb_build_object('error', 'GESTOR_NO_ASIGNADO');
    END IF;
    IF NOT v_es_administrador AND v_id_gestor <> p_id_usuario THEN
        RETURN pg_catalog.jsonb_build_object('error', 'USUARIO_NO_AUTORIZADO');
    END IF;

    -- Bloquear ambas filas en orden estable, sin filtrar activo/es_final:
    -- los valores modificados por una transaccion previa deben poder rechazarse.
    FOR v_estado IN
        SELECT ep.id_estado, ep.nombre, ep.activo, ep.es_final
        FROM public.estado_practica ep
        WHERE ep.id_estado = v_id_estado_anterior OR ep.nombre = 'EN_CURSO'
        ORDER BY ep.id_estado
        FOR SHARE OF ep
    LOOP
        IF v_estado.id_estado = v_id_estado_anterior THEN
            v_nombre_estado_anterior := v_estado.nombre;
            v_es_final := v_estado.es_final;
        END IF;
        IF v_estado.nombre = 'EN_CURSO' THEN
            v_id_estado_nuevo := v_estado.id_estado;
            v_destino_valido := v_estado.activo AND NOT v_estado.es_final;
        END IF;
    END LOOP;

    IF v_es_final IS TRUE THEN
        RETURN pg_catalog.jsonb_build_object('error', 'ESTADO_FINAL');
    END IF;
    IF v_nombre_estado_anterior IS DISTINCT FROM 'APROBADA' THEN
        RETURN pg_catalog.jsonb_build_object('error', 'TRANSICION_NO_PERMITIDA');
    END IF;
    IF NOT v_destino_valido THEN
        RETURN pg_catalog.jsonb_build_object('error', 'ESTADO_DESTINO_NO_VALIDO');
    END IF;

    SELECT h.id_estado, h.fecha_cambio
    INTO v_id_ultimo_estado, v_fecha_ultimo_evento
    FROM public.historial_estado h
    WHERE h.id_practica = p_id_practica
    ORDER BY h.fecha_cambio DESC, h.id_historial DESC
    LIMIT 1;

    IF NOT FOUND OR v_id_ultimo_estado IS DISTINCT FROM v_id_estado_anterior THEN
        RETURN pg_catalog.jsonb_build_object('error', 'HISTORIAL_INCONSISTENTE');
    END IF;

    v_observacion := NULLIF(pg_catalog.btrim(p_observacion), '');
    IF pg_catalog.char_length(v_observacion) > 500 THEN
        RETURN pg_catalog.jsonb_build_object('error', 'OBSERVACION_INVALIDA');
    END IF;

    -- clock_timestamp evita utilizar el inicio de una transaccion que espero.
    v_fecha_cambio := pg_catalog.clock_timestamp();
    IF v_fecha_ultimo_evento > v_fecha_cambio THEN
        RETURN pg_catalog.jsonb_build_object('error', 'HISTORIAL_INCONSISTENTE');
    END IF;

    UPDATE public.practica
    SET id_estado_actual = v_id_estado_nuevo,
        fecha_actualizacion = v_fecha_cambio
    WHERE id_practica = p_id_practica
    RETURNING id_practica INTO v_id_practica_actualizada;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INICIO_NO_CONFIRMADO';
    END IF;

    INSERT INTO public.historial_estado (
        id_practica, id_estado, id_usuario, fecha_cambio, observacion
    ) VALUES (
        p_id_practica, v_id_estado_nuevo, p_id_usuario, v_fecha_cambio, v_observacion
    )
    RETURNING id_historial INTO v_id_historial;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INICIO_NO_CONFIRMADO';
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'id_practica', p_id_practica,
        'estado_anterior', pg_catalog.jsonb_build_object(
            'id_estado', v_id_estado_anterior, 'nombre', v_nombre_estado_anterior
        ),
        'estado', pg_catalog.jsonb_build_object(
            'id_estado', v_id_estado_nuevo, 'nombre', 'EN_CURSO', 'es_final', FALSE
        ),
        'fecha_ultimo_cambio_estado', v_fecha_cambio,
        'id_historial', v_id_historial
    );
END;
$$;

-- CREATE sobre el esquema es un requisito temporal para transferir propiedad.
-- No se conserva despues de instalar; la funcion no pertenece al dueno de tablas.
GRANT CREATE ON SCHEMA practicas_privadas TO pl_ep04_owner;
ALTER FUNCTION practicas_privadas.fn_iniciar_practica(BIGINT, BIGINT, VARCHAR)
    OWNER TO pl_ep04_owner;
REVOKE CREATE ON SCHEMA practicas_privadas FROM pl_ep04_owner;
REVOKE ALL ON FUNCTION practicas_privadas.fn_iniciar_practica(BIGINT, BIGINT, VARCHAR)
    FROM PUBLIC;

-- Limpiar grants explicitos que pudieran introducir default privileges del
-- instalador. Solo esta funcion; no alterar default privileges ni otros objetos.
DO $acl$
DECLARE
    v_rol NAME;
BEGIN
    FOR v_rol IN
        SELECT DISTINCT r.rolname
        FROM pg_catalog.pg_proc p
        CROSS JOIN LATERAL pg_catalog.aclexplode(
            COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))
        ) a
        JOIN pg_catalog.pg_roles r ON r.oid = a.grantee
        WHERE p.oid = 'practicas_privadas.fn_iniciar_practica(bigint,bigint,character varying)'::pg_catalog.regprocedure
          AND a.grantee <> p.proowner
    LOOP
        EXECUTE pg_catalog.format(
            'REVOKE ALL ON FUNCTION practicas_privadas.fn_iniciar_practica(BIGINT, BIGINT, VARCHAR) FROM %I',
            v_rol
        );
    END LOOP;
END;
$acl$;
GRANT EXECUTE ON FUNCTION practicas_privadas.fn_iniciar_practica(BIGINT, BIGINT, VARCHAR)
    TO pl_ep04_executor;
