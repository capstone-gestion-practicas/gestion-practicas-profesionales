-- HU015 WEB. Requiere ep06-01 y ep06-02. No exponer el esquema vía Data API.
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
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
CREATE FUNCTION incidencias_privadas.fn_registrar_incidencia(
    p_id_practica BIGINT,
    p_id_usuario BIGINT,
    p_tipo TEXT,
    p_descripcion TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET TimeZone = 'UTC'
AS $$
DECLARE
    v_activo BOOLEAN;
    v_roles BIGINT[] := ARRAY[]::BIGINT[];
    v_id_rol BIGINT;
    v_rol RECORD;
    v_autorizado BOOLEAN := FALSE;
    v_id_estado BIGINT;
    v_estado RECORD;
    v_instante TIMESTAMPTZ;
    v_id BIGINT;
    v_tipo BIGINT;
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
    END LOOP;
    IF NOT v_autorizado THEN
        RETURN pg_catalog.jsonb_build_object('error','USUARIO_NO_AUTORIZADO');
    END IF;

    -- Separar lectura de práctica y catálogo evita basarse en el valor de un
    -- JOIN obtenido antes de esperar una transición concurrente.
    SELECT p.id_estado_actual INTO v_id_estado FROM public.practica p
    WHERE p.id_practica=p_id_practica FOR UPDATE OF p;
    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('error','PRACTICA_NO_ENCONTRADA');
    END IF;
    SELECT e.nombre,e.activo,e.es_final INTO v_estado FROM public.estado_practica e
    WHERE e.id_estado=v_id_estado FOR SHARE OF e;
    IF NOT FOUND OR v_estado.nombre IS DISTINCT FROM 'EN_CURSO'
       OR v_estado.activo IS NOT TRUE OR v_estado.es_final IS NOT FALSE THEN
        RETURN pg_catalog.jsonb_build_object('error','PRACTICA_NO_EN_CURSO');
    END IF;

    SELECT t.id_tipo_incidencia INTO v_tipo FROM public.tipo_incidencia t
    WHERE t.codigo=p_tipo AND t.activo FOR SHARE OF t;
    IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('error','TIPO_INVALIDO'); END IF;
    -- Cuenta caracteres PostgreSQL, no bytes. Preserva el texto original:
    -- espacios cuentan para el máximo; vacío o solo whitespace se rechaza.
    IF p_descripcion IS NULL OR p_descripcion !~ '[^[:space:]]'
       OR pg_catalog.char_length(p_descripcion)>2000 THEN
        RETURN pg_catalog.jsonb_build_object('error','DESCRIPCION_INVALIDA');
    END IF;

    v_instante := pg_catalog.clock_timestamp();
    INSERT INTO public.incidencia(id_practica,id_usuario,fecha,id_tipo_incidencia,descripcion,estado)
    VALUES(p_id_practica,p_id_usuario,v_instante,v_tipo,p_descripcion,'PENDIENTE')
    RETURNING id_incidencia INTO v_id;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='INCIDENCIA_NO_CONFIRMADA'; END IF;
    INSERT INTO public.historial_estado_incidencia(id_incidencia,id_usuario,estado_anterior,estado_nuevo,fecha)
    VALUES(v_id,p_id_usuario,NULL,'PENDIENTE',v_instante);
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='HISTORIAL_NO_CONFIRMADO'; END IF;
    RETURN pg_catalog.jsonb_build_object(
        'id_incidencia',v_id,'id_practica',p_id_practica,'id_usuario',p_id_usuario,
        'fecha',v_instante,'tipo',p_tipo,'descripcion',p_descripcion,'estado','PENDIENTE');

END;
$$;

GRANT CREATE ON SCHEMA incidencias_privadas TO pl_ep06_owner;
ALTER FUNCTION incidencias_privadas.fn_registrar_incidencia(BIGINT,BIGINT,TEXT,TEXT)
    OWNER TO pl_ep06_owner;
REVOKE CREATE ON SCHEMA incidencias_privadas FROM pl_ep06_owner;
REVOKE ALL ON FUNCTION incidencias_privadas.fn_registrar_incidencia(BIGINT,BIGINT,TEXT,TEXT) FROM PUBLIC;
-- Limpiar concesiones explícitas introducidas por default privileges: solo
-- esta función, sin modificar roles ni grants ajenos al incremento.
DO $acl$
DECLARE r NAME;
BEGIN
    FOR r IN SELECT DISTINCT roles.rolname FROM pg_catalog.pg_proc p
        CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
        JOIN pg_catalog.pg_roles roles ON roles.oid=a.grantee
        WHERE p.oid='incidencias_privadas.fn_registrar_incidencia(bigint,bigint,text,text)'::regprocedure
          AND a.grantee<>p.proowner
    LOOP
        EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION incidencias_privadas.fn_registrar_incidencia(BIGINT,BIGINT,TEXT,TEXT) FROM %I',r);
    END LOOP;
END;
$acl$;
GRANT EXECUTE ON FUNCTION incidencias_privadas.fn_registrar_incidencia(BIGINT,BIGINT,TEXT,TEXT) TO pl_ep06_executor;
COMMIT;
