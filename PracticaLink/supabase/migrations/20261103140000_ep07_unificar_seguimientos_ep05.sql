-- EP07 · Corrección 4A: unifica seguimientos en el contrato EP05 (HU013/HU014) con
-- autorización por gestor asignado. Incremental: no modifica migraciones previas.
-- Partes 1, 2, 4 y 5: copia auditada de scripts/BD/fixes/ep05-01, ep05-02, ep05-04 y ep05-05,
--   con dos ajustes EP07: lectura de practica.id_gestor para autorizar (parte 2 y 4).
-- Parte 3 y función de lectura: versión final de ep05-03 y ep05-04 con la regla de gestor asignado.
--   Las funciones públicas fn_registrar_seguimiento / fn_listar_seguimientos no se eliminan (histórico).
-- Orden de códigos de dominio: PRACTICA_NO_ENCONTRADA (404) -> USUARIO_NO_AUTORIZADO (403) -> estado/validaciones.
-- Solo para revisión y aplicación autorizada; no desplegada en Supabase real.

BEGIN;
-- ===== Parte 1: calendario HU013 (ep05-01) =====
-- HU013 WEB. Aplicar solo tras revisión y autorización del entorno.
-- Orden: schema.sql (solo base vacía), este archivo, ep05-02, ep05-03.
-- Migración única: falla si ya fue aplicada; nunca recrea ni vacía tablas.
-- Mantiene fecha/fecha_creacion originales, IDs, autor, medio y observaciones.
-- La nueva columna es la fecha funcional; los timestamps históricos no se pierden.

LOCK TABLE public.seguimiento IN ACCESS EXCLUSIVE MODE;
ALTER TABLE public.seguimiento ADD COLUMN fecha_seguimiento DATE;
UPDATE public.seguimiento
SET fecha_seguimiento = (fecha AT TIME ZONE 'America/Santiago')::DATE;
ALTER TABLE public.seguimiento ALTER COLUMN fecha_seguimiento SET NOT NULL;

-- Los datos anteriores se conservan incluso si no satisfacen las nuevas reglas.
-- NOT VALID evita repararlos o descartarlos; sí controla nuevas filas/updates.
ALTER TABLE public.seguimiento ADD CONSTRAINT chk_ep05_observacion
    CHECK (observacion ~ '[^[:space:]]' AND char_length(observacion) <= 2000) NOT VALID;
ALTER TABLE public.seguimiento ADD CONSTRAINT chk_ep05_tipo
    CHECK (tipo IS NOT NULL AND tipo IN (
        'Reunión presencial', 'Videollamada', 'Llamada telefónica',
        'Correo electrónico', 'Otro'
    )) NOT VALID;

-- No permitir borrado de una práctica con seguimientos, tampoco desde cascadas.
ALTER TABLE public.seguimiento DROP CONSTRAINT fk_seguimiento_practica;
ALTER TABLE public.seguimiento ADD CONSTRAINT fk_seguimiento_practica
    FOREIGN KEY (id_practica) REFERENCES public.practica(id_practica) ON DELETE RESTRICT;

COMMENT ON COLUMN public.seguimiento.fecha_seguimiento IS
    'HU013: fecha calendario del seguimiento en America/Santiago, independiente de fecha_creacion.';


-- ===== Parte 2: roles y permisos EP05 (ep05-02) =====
-- HU013 WEB: capacidades nuevas, sin modificar conexiones/permisos de EP03/EP04.
-- No crea logins ni contraseñas. El futuro login backend recibirá únicamente
-- pl_ep05_executor; nunca pl_ep05_owner. No conceder ejecutor a clientes/Data API.
-- RLS se comprueba; privilegios ambientales incompatibles abortan todo el script.
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
GRANT SELECT(id_practica, id_estado_actual, id_gestor), UPDATE(id_practica) ON public.practica TO pl_ep05_owner;
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
            WHEN 'practica' THEN permitidos_select:=ARRAY['id_practica','id_estado_actual','id_gestor']; permitidos_update:=ARRAY['id_practica'];
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


-- ===== Parte 3: registro con autorización por gestor asignado (ep05-03) =====
-- HU013 WEB. Requiere ep05-01 y ep05-02. No exponer el esquema vía Data API.
-- p_id_usuario es una afirmación del backend de confianza: debe provenir del
-- JWT validado, NUNCA del body/query del cliente. SQL revalida existencia,
-- actividad y roles, pero NO verifica JWT ni demuestra quién posee la sesión web.
-- El login dedicado solo tiene EXECUTE; no se concede al público ni a clientes.
-- Orden de locks compatible con inicio EP04: usuario -> asignaciones -> roles
-- -> práctica -> catálogo. Los locks duran hasta COMMIT/ROLLBACK del llamador.
-- READ COMMITTED: relectura tras esperar el lock. Otros aislamientos pueden
-- producir 40001; 40P01/55P03/excepciones SQL requieren rollback completo.
-- Sin commit interno ni reintento. JSON error no es éxito: el futuro backend
-- debe hacer rollback; validar respuesta y confirmar únicamente el éxito.
CREATE FUNCTION seguimientos_privados.fn_registrar_seguimiento(
    p_id_practica BIGINT,
    p_id_usuario BIGINT,
    p_fecha DATE,
    p_tipo TEXT,
    p_observacion TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_activo BOOLEAN;
    v_roles BIGINT[] := ARRAY[]::BIGINT[];
    v_id_rol BIGINT;
    v_rol RECORD;
    v_autorizado BOOLEAN := FALSE;
    v_es_administrador BOOLEAN := FALSE;
    v_id_estado BIGINT;
    v_id_gestor BIGINT;
    v_estado RECORD;
    v_instante TIMESTAMPTZ;
    v_id BIGINT;
BEGIN
    SELECT u.activo INTO v_activo FROM public.usuario u
    WHERE u.id_usuario=p_id_usuario FOR SHARE OF u;
    IF NOT FOUND OR v_activo IS NOT TRUE THEN
        RETURN pg_catalog.jsonb_build_object('error','USUARIO_NO_AUTORIZADO');
    END IF;
    FOR v_id_rol IN SELECT ur.id_rol FROM public.usuario_rol ur
        WHERE ur.id_usuario=p_id_usuario ORDER BY ur.id_rol FOR SHARE OF ur
    LOOP
        v_roles := pg_catalog.array_append(v_roles,v_id_rol);
    END LOOP;
    FOR v_rol IN SELECT r.nombre,r.activo FROM public.rol r
        WHERE r.id_rol=ANY(v_roles) ORDER BY r.id_rol FOR SHARE OF r
    LOOP
        IF v_rol.activo AND v_rol.nombre IN ('GESTOR','ADMINISTRADOR') THEN
            v_autorizado := TRUE;
        END IF;
        IF v_rol.activo AND v_rol.nombre = 'ADMINISTRADOR' THEN
            v_es_administrador := TRUE;
        END IF;
    END LOOP;
    IF NOT v_autorizado THEN
        RETURN pg_catalog.jsonb_build_object('error','USUARIO_NO_AUTORIZADO');
    END IF;

    -- Práctica bloqueada antes de decidir: existencia (404) y después autorización (403).
    -- Ninguna escritura ocurre antes de ambas comprobaciones.
    SELECT p.id_estado_actual, p.id_gestor INTO v_id_estado, v_id_gestor
    FROM public.practica p
    WHERE p.id_practica=p_id_practica FOR UPDATE OF p;
    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('error','PRACTICA_NO_ENCONTRADA');
    END IF;
    -- EP07: GESTOR solo sobre prácticas asignadas a su identidad. Sin gestor o ajena -> 403.
    IF NOT v_es_administrador AND (v_id_gestor IS NULL OR v_id_gestor <> p_id_usuario) THEN
        RETURN pg_catalog.jsonb_build_object('error','USUARIO_NO_AUTORIZADO');
    END IF;

    SELECT e.nombre,e.activo,e.es_final INTO v_estado FROM public.estado_practica e
    WHERE e.id_estado=v_id_estado FOR SHARE OF e;
    IF NOT FOUND OR v_estado.nombre IS DISTINCT FROM 'EN_CURSO'
       OR v_estado.activo IS NOT TRUE OR v_estado.es_final IS NOT FALSE THEN
        RETURN pg_catalog.jsonb_build_object('error','PRACTICA_NO_EN_CURSO');
    END IF;

    -- Fecha evaluada después de los bloqueos; independiente de TimeZone de sesión.
    v_instante := pg_catalog.clock_timestamp();
    IF p_fecha IS NULL OR NOT pg_catalog.isfinite(p_fecha)
       OR p_fecha > (v_instante AT TIME ZONE 'America/Santiago')::DATE THEN
        RETURN pg_catalog.jsonb_build_object('error','FECHA_INVALIDA');
    END IF;
    IF p_tipo IS NULL OR p_tipo NOT IN (
        'Reunión presencial','Videollamada','Llamada telefónica','Correo electrónico','Otro'
    ) THEN
        RETURN pg_catalog.jsonb_build_object('error','MEDIO_INVALIDO');
    END IF;
    -- Cuenta caracteres PostgreSQL, no bytes. Preserva el texto original:
    -- espacios cuentan para el máximo; vacío o solo whitespace se rechaza.
    IF p_observacion IS NULL OR p_observacion !~ '[^[:space:]]'
       OR pg_catalog.char_length(p_observacion)>2000 THEN
        RETURN pg_catalog.jsonb_build_object('error','OBSERVACION_INVALIDA');
    END IF;

    INSERT INTO public.seguimiento(
        id_practica,id_usuario,fecha,fecha_seguimiento,tipo,observacion,fecha_creacion
    ) VALUES (p_id_practica,p_id_usuario,v_instante,p_fecha,p_tipo,p_observacion,v_instante)
    RETURNING id_seguimiento INTO v_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='SEGUIMIENTO_NO_CONFIRMADO';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
        'id_seguimiento',v_id,'id_practica',p_id_practica,'id_usuario',p_id_usuario,
        'fecha',p_fecha,'tipo',p_tipo,'observacion',p_observacion,'fecha_creacion',v_instante
    );
END;
$$;

GRANT CREATE ON SCHEMA seguimientos_privados TO pl_ep05_owner;
ALTER FUNCTION seguimientos_privados.fn_registrar_seguimiento(BIGINT,BIGINT,DATE,TEXT,TEXT)
    OWNER TO pl_ep05_owner;
REVOKE CREATE ON SCHEMA seguimientos_privados FROM pl_ep05_owner;
REVOKE ALL ON FUNCTION seguimientos_privados.fn_registrar_seguimiento(BIGINT,BIGINT,DATE,TEXT,TEXT) FROM PUBLIC;
-- Limpiar concesiones explícitas introducidas por default privileges: solo
-- esta función, sin modificar roles ni grants ajenos al incremento.
DO $acl$
DECLARE r NAME;
BEGIN
    FOR r IN SELECT DISTINCT roles.rolname FROM pg_catalog.pg_proc p
        CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
        JOIN pg_catalog.pg_roles roles ON roles.oid=a.grantee
        WHERE p.oid='seguimientos_privados.fn_registrar_seguimiento(bigint,bigint,date,text,text)'::regprocedure
          AND a.grantee<>p.proowner
    LOOP
        EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION seguimientos_privados.fn_registrar_seguimiento(BIGINT,BIGINT,DATE,TEXT,TEXT) FROM %I',r);
    END LOOP;
END;
$acl$;
GRANT EXECUTE ON FUNCTION seguimientos_privados.fn_registrar_seguimiento(BIGINT,BIGINT,DATE,TEXT,TEXT) TO pl_ep05_executor;


-- ===== Parte 4: consulta paginada con autorización por gestor asignado (ep05-04) =====
-- HU014 WEB. Requiere ep05-01/02/03. Aplicación única y transaccional.
-- PMV: GESTOR/ADMINISTRADOR activos tienen alcance global, en todos los estados.
-- p_id_usuario es una afirmación del backend de confianza, obtenida del JWT
-- validado; SQL NO valida JWT. Nunca conceder este ejecutor al cliente web.
CREATE ROLE pl_ep05_read_owner NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS
    NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE ROLE pl_ep05_read_executor NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS
    NOCREATEDB NOCREATEROLE NOREPLICATION;
GRANT USAGE ON SCHEMA seguimientos_privados TO pl_ep05_read_owner, pl_ep05_read_executor;
GRANT USAGE ON SCHEMA public TO pl_ep05_read_owner;
GRANT SELECT(id_usuario,activo,nombre,apellido) ON public.usuario TO pl_ep05_read_owner;
GRANT SELECT(id_usuario,id_rol) ON public.usuario_rol TO pl_ep05_read_owner;
GRANT SELECT(id_rol,nombre,activo) ON public.rol TO pl_ep05_read_owner;
GRANT SELECT(id_practica, id_gestor) ON public.practica TO pl_ep05_read_owner;
GRANT SELECT(id_seguimiento,id_practica,id_usuario,fecha_seguimiento,tipo,observacion)
    ON public.seguimiento TO pl_ep05_read_owner;

-- El DEFINER puede leer estas columnas para aplicar autorización; no hay
-- privilegios UPDATE para locks ni escrituras. El ejecutor no lee tablas.
DO $bootstrap$
DECLARE t TEXT; c RECORD; oid_tabla OID; permitidas TEXT[];
BEGIN
    FOREACH t IN ARRAY ARRAY['usuario','usuario_rol','rol','practica','seguimiento'] LOOP
        oid_tabla := pg_catalog.to_regclass('public.' || t);
        IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid=oid_tabla)
           OR (SELECT relowner='pl_ep05_read_owner'::regrole FROM pg_catalog.pg_class WHERE oid=oid_tabla) THEN
            RAISE EXCEPTION 'HU014: RLS o propiedad incompatible';
        END IF;
        IF pg_catalog.has_table_privilege('pl_ep05_read_owner',oid_tabla,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
           OR pg_catalog.has_any_column_privilege('pl_ep05_read_owner',oid_tabla,'INSERT,UPDATE,REFERENCES')
           OR pg_catalog.has_table_privilege('pl_ep05_read_executor',oid_tabla,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
           OR pg_catalog.has_any_column_privilege('pl_ep05_read_executor',oid_tabla,'SELECT,INSERT,UPDATE,REFERENCES') THEN
            RAISE EXCEPTION 'HU014: privilegios ambientales incompatibles';
        END IF;
        CASE t
            WHEN 'usuario' THEN permitidas:=ARRAY['id_usuario','activo','nombre','apellido'];
            WHEN 'usuario_rol' THEN permitidas:=ARRAY['id_usuario','id_rol'];
            WHEN 'rol' THEN permitidas:=ARRAY['id_rol','nombre','activo'];
            WHEN 'practica' THEN permitidas:=ARRAY['id_practica','id_gestor'];
            WHEN 'seguimiento' THEN permitidas:=ARRAY['id_seguimiento','id_practica','id_usuario','fecha_seguimiento','tipo','observacion'];
        END CASE;
        FOR c IN SELECT attnum,attname FROM pg_catalog.pg_attribute WHERE attrelid=oid_tabla AND attnum>0 AND NOT attisdropped LOOP
            IF pg_catalog.has_column_privilege('pl_ep05_read_owner',oid_tabla,c.attnum,'SELECT')
               AND NOT c.attname=ANY(permitidas) THEN
                RAISE EXCEPTION 'HU014: columna no prevista';
            END IF;
        END LOOP;
        EXECUTE pg_catalog.format('CREATE POLICY ep05_read_select ON public.%I FOR SELECT TO pl_ep05_read_owner USING(true)',t);
    END LOOP;
END;
$bootstrap$;

CREATE FUNCTION seguimientos_privados.fn_consultar_seguimientos(
    p_id_practica BIGINT, p_id_usuario BIGINT,
    p_limit INTEGER DEFAULT 50, p_offset BIGINT DEFAULT 0
) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_items JSONB; v_hay_mas BOOLEAN;
BEGIN
    -- STABLE: todas las lecturas usan la instantánea de la sentencia llamadora.
    -- Autorizar antes de revelar existencia o contenido. Sin filtro por autor.
    IF NOT EXISTS (
        SELECT 1 FROM public.usuario u
        JOIN public.usuario_rol ur ON ur.id_usuario=u.id_usuario
        JOIN public.rol r ON r.id_rol=ur.id_rol
        WHERE u.id_usuario=p_id_usuario AND u.activo AND r.activo
          AND r.nombre IN ('GESTOR','ADMINISTRADOR')
    ) THEN
        RETURN pg_catalog.jsonb_build_object('error','USUARIO_NO_AUTORIZADO');
    END IF;
    IF p_limit IS NULL OR p_limit<1 OR p_limit>100 OR p_offset IS NULL OR p_offset<0 THEN
        RETURN pg_catalog.jsonb_build_object('error','PAGINACION_INVALIDA');
    END IF;
    IF NOT EXISTS(SELECT 1 FROM public.practica p WHERE p.id_practica=p_id_practica) THEN
        RETURN pg_catalog.jsonb_build_object('error','PRACTICA_NO_ENCONTRADA');
    END IF;
    -- EP07: ADMINISTRADOR activo global; GESTOR activo solo sobre prácticas asignadas.
    IF NOT EXISTS (
        SELECT 1 FROM public.usuario u
        JOIN public.usuario_rol ur ON ur.id_usuario=u.id_usuario
        JOIN public.rol r ON r.id_rol=ur.id_rol
        WHERE u.id_usuario=p_id_usuario AND u.activo AND r.activo
          AND r.nombre='ADMINISTRADOR'
    ) AND NOT EXISTS (
        SELECT 1 FROM public.practica p
        WHERE p.id_practica=p_id_practica AND p.id_gestor=p_id_usuario
    ) THEN
        RETURN pg_catalog.jsonb_build_object('error','USUARIO_NO_AUTORIZADO');
    END IF;

    WITH pagina AS MATERIALIZED (
        SELECT s.id_seguimiento,s.fecha_seguimiento,s.tipo,s.observacion,s.id_usuario
        FROM public.seguimiento s WHERE s.id_practica=p_id_practica
        ORDER BY s.fecha_seguimiento DESC,s.id_seguimiento DESC
        LIMIT p_limit+1 OFFSET p_offset
    ), visibles AS (
        SELECT * FROM pagina ORDER BY fecha_seguimiento DESC,id_seguimiento DESC LIMIT p_limit
    )
    SELECT COALESCE((
        SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'id_seguimiento',s.id_seguimiento,'fecha',s.fecha_seguimiento,
            'tipo',s.tipo,'observacion',s.observacion,
            'responsable',pg_catalog.jsonb_build_object('id_usuario',s.id_usuario,
                'nombre',pg_catalog.concat(u.nombre,' ',u.apellido))
        ) ORDER BY s.fecha_seguimiento DESC,s.id_seguimiento DESC)
        FROM visibles s JOIN public.usuario u ON u.id_usuario=s.id_usuario
    ),'[]'::JSONB), (SELECT count(*)>p_limit FROM pagina)
    INTO v_items,v_hay_mas;
    RETURN pg_catalog.jsonb_build_object('id_practica',p_id_practica,'items',v_items,
        'limit',p_limit,'offset',p_offset,'hay_mas',v_hay_mas);
END;
$$;
GRANT CREATE ON SCHEMA seguimientos_privados TO pl_ep05_read_owner;
ALTER FUNCTION seguimientos_privados.fn_consultar_seguimientos(BIGINT,BIGINT,INTEGER,BIGINT) OWNER TO pl_ep05_read_owner;
REVOKE CREATE ON SCHEMA seguimientos_privados FROM pl_ep05_read_owner;
REVOKE ALL ON FUNCTION seguimientos_privados.fn_consultar_seguimientos(BIGINT,BIGINT,INTEGER,BIGINT) FROM PUBLIC;
-- Limpiar también grants de default privileges, exclusivamente de esta función.
DO $acl$
DECLARE r NAME;
BEGIN
    FOR r IN SELECT DISTINCT roles.rolname FROM pg_catalog.pg_proc p
        CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
        JOIN pg_catalog.pg_roles roles ON roles.oid=a.grantee
        WHERE p.oid='seguimientos_privados.fn_consultar_seguimientos(bigint,bigint,integer,bigint)'::regprocedure
          AND a.grantee<>p.proowner
    LOOP
        EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION seguimientos_privados.fn_consultar_seguimientos(BIGINT,BIGINT,INTEGER,BIGINT) FROM %I',r);
    END LOOP;
END;
$acl$;
GRANT EXECUTE ON FUNCTION seguimientos_privados.fn_consultar_seguimientos(BIGINT,BIGINT,INTEGER,BIGINT) TO pl_ep05_read_executor;


-- ===== Parte 5: índice de lectura (ep05-05) =====
-- HU014: índice de lectura. Transaccional; no reescribe datos.
-- CREATE INDEX normal toma un lock que puede esperar/bloquear escritores:
-- planificar su aplicación fuera del laboratorio mediante revisión humana.
DO $index$
BEGIN
    -- Btree válido, no parcial ni de expresiones, con prefijo equivalente.
    -- ASC/ASC también sirve recorriéndolo al revés. Ambas columnas son NOT NULL.
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_index i
        JOIN pg_catalog.pg_class c ON c.oid=i.indexrelid
        JOIN pg_catalog.pg_am am ON am.oid=c.relam
        WHERE i.indrelid='public.seguimiento'::regclass
          AND i.indisvalid AND i.indisready AND i.indpred IS NULL
          AND i.indexprs IS NULL AND i.indnkeyatts>=3 AND am.amname='btree'
          AND i.indkey[0]=(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid=i.indrelid AND attname='id_practica')
          AND i.indkey[1]=(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid=i.indrelid AND attname='fecha_seguimiento')
          AND i.indkey[2]=(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid=i.indrelid AND attname='id_seguimiento')
          AND (i.indoption[1] & 1)=(i.indoption[2] & 1)
    ) THEN
        CREATE INDEX idx_ep05_seguimiento_historial
            ON public.seguimiento(id_practica,fecha_seguimiento DESC,id_seguimiento DESC);
    END IF;
END;
$index$;


COMMIT;
