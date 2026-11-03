-- HU016: identidad afirmada exclusivamente por backend JWT; SQL revalida roles.
-- Locks: usuario -> asignaciones -> roles -> práctica -> incidencia.
-- No commit ni reintento interno. JSON error exige rollback del llamador.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
CREATE FUNCTION incidencias_privadas.fn_cambiar_estado_incidencia(
    p_id_practica BIGINT, p_id_incidencia BIGINT, p_id_usuario BIGINT,
    p_estado_esperado TEXT, p_estado_nuevo TEXT, p_comentario TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
SET TimeZone='UTC'
AS $$
DECLARE
    v_activo BOOLEAN;
    v_roles BIGINT[]:=ARRAY[]::BIGINT[];
    v_id_rol BIGINT;
    v_rol RECORD;
    v_autorizado BOOLEAN:=FALSE;
    v_i RECORD;
    v_h RECORD;
    v_prev TEXT:=NULL;
    v_fecha_anterior TIMESTAMPTZ;
    v_count INTEGER:=0;
    v_comentario TEXT;
    v_instante TIMESTAMPTZ;
    v_evento BIGINT;
    v_rows INTEGER;
BEGIN
    IF p_id_usuario IS NULL OR p_id_usuario<=0 THEN
        RETURN pg_catalog.jsonb_build_object('error','USUARIO_NO_AUTORIZADO');
    END IF;
    IF p_id_practica IS NULL OR p_id_practica<=0 OR p_id_incidencia IS NULL OR p_id_incidencia<=0 THEN
        RETURN pg_catalog.jsonb_build_object('error','IDENTIFICADOR_INVALIDO');
    END IF;
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


    PERFORM p.id_practica FROM public.practica p WHERE p.id_practica=p_id_practica FOR UPDATE OF p;
    IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('error','PRACTICA_NO_ENCONTRADA'); END IF;
    SELECT i.id_incidencia,i.id_practica,i.id_usuario,i.id_tipo_incidencia,i.fecha,i.descripcion,i.estado,i.fecha_resolucion
      INTO v_i FROM public.incidencia i
      WHERE i.id_incidencia=p_id_incidencia AND i.id_practica=p_id_practica FOR UPDATE OF i;
    IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('error','INCIDENCIA_NO_ENCONTRADA'); END IF;
    IF p_estado_esperado IS NULL OR p_estado_esperado NOT IN ('PENDIENTE','EN_ATENCION','RESUELTA')
       OR p_estado_nuevo IS NULL OR p_estado_nuevo NOT IN ('PENDIENTE','EN_ATENCION','RESUELTA') THEN
        RETURN pg_catalog.jsonb_build_object('error','ESTADO_INVALIDO');
    END IF;
    -- No inferir procedencia por tipo solamente; validar compatibilidad integral.
    IF v_i.id_tipo_incidencia IS NULL OR v_i.estado NOT IN ('PENDIENTE','EN_ATENCION','RESUELTA')
       OR v_i.descripcion !~ '[^[:space:]]' OR pg_catalog.char_length(v_i.descripcion)>2000
       OR NOT pg_catalog.isfinite(v_i.fecha) THEN
        RETURN pg_catalog.jsonb_build_object('error','INCIDENCIA_NO_GESTIONABLE');
    END IF;
    IF v_i.estado IS DISTINCT FROM p_estado_esperado THEN
        RETURN pg_catalog.jsonb_build_object('error','ESTADO_DESACTUALIZADO');
    END IF;
    IF NOT ((v_i.estado='PENDIENTE' AND p_estado_nuevo IN ('EN_ATENCION','RESUELTA'))
         OR (v_i.estado='EN_ATENCION' AND p_estado_nuevo='RESUELTA')) THEN
        RETURN pg_catalog.jsonb_build_object('error','TRANSICION_NO_PERMITIDA');
    END IF;
    -- Convención EP04: btrim retira espacios U+0020 de borde.
    -- Whitespace sin contenido se normaliza a NULL; máximo sobre texto normalizado.
    v_comentario:=pg_catalog.btrim(p_comentario);
    IF v_comentario !~ '[^[:space:]]' THEN v_comentario:=NULL; END IF;
    IF pg_catalog.char_length(v_comentario)>2000 OR (p_estado_nuevo='RESUELTA' AND v_comentario IS NULL) THEN
        RETURN pg_catalog.jsonb_build_object('error','COMENTARIO_INVALIDO');
    END IF;
    v_instante:=pg_catalog.clock_timestamp();
    -- ID de evento marca secuencia de inserción; no dejar que un timestamp alterado
    -- reordene una cadena inválida. Se comprueba además monotonía temporal.
    FOR v_h IN SELECT h.id_historial,h.id_usuario,h.estado_anterior,h.estado_nuevo,h.fecha,h.comentario
        FROM public.historial_estado_incidencia h WHERE h.id_incidencia=p_id_incidencia ORDER BY h.id_historial
    LOOP
        v_count:=v_count+1;
        IF NOT pg_catalog.isfinite(v_h.fecha) OR v_h.fecha>v_instante
           OR (v_count=1 AND (v_h.estado_anterior IS NOT NULL OR v_h.estado_nuevo IS DISTINCT FROM 'PENDIENTE'
               OR v_h.fecha IS DISTINCT FROM v_i.fecha OR v_h.id_usuario IS DISTINCT FROM v_i.id_usuario))
           OR (v_count>1 AND (v_h.estado_anterior IS DISTINCT FROM v_prev OR v_h.fecha<v_fecha_anterior
               OR NOT ((v_prev='PENDIENTE' AND v_h.estado_nuevo IN ('EN_ATENCION','RESUELTA'))
                    OR (v_prev='EN_ATENCION' AND v_h.estado_nuevo='RESUELTA'))))
           OR (v_h.estado_nuevo='RESUELTA' AND (v_h.comentario IS NULL OR v_h.comentario !~ '[^[:space:]]')) THEN
            RETURN pg_catalog.jsonb_build_object('error','HISTORIAL_INCONSISTENTE');
        END IF;
        v_prev:=v_h.estado_nuevo;
        v_fecha_anterior:=v_h.fecha;
    END LOOP;
    IF v_count=0 OR v_prev IS DISTINCT FROM v_i.estado OR v_i.fecha_resolucion IS NOT NULL THEN
        -- Estados de origen permitidos son abiertos: no deben tener resolución.
        RETURN pg_catalog.jsonb_build_object('error','HISTORIAL_INCONSISTENTE');
    END IF;
    v_instante:=pg_catalog.clock_timestamp();
    IF v_instante<v_fecha_anterior THEN
        RETURN pg_catalog.jsonb_build_object('error','HISTORIAL_INCONSISTENTE');
    END IF;
    UPDATE public.incidencia SET estado=p_estado_nuevo,
        fecha_resolucion=CASE WHEN p_estado_nuevo='RESUELTA' THEN v_instante ELSE NULL END
    WHERE id_incidencia=p_id_incidencia AND id_practica=p_id_practica;
    GET DIAGNOSTICS v_rows=ROW_COUNT;
    IF v_rows<>1 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='CAMBIO_NO_CONFIRMADO'; END IF;
    INSERT INTO public.historial_estado_incidencia(id_incidencia,id_usuario,estado_anterior,estado_nuevo,fecha,comentario)
    VALUES(p_id_incidencia,p_id_usuario,v_i.estado,p_estado_nuevo,v_instante,v_comentario)
    RETURNING id_historial INTO v_evento;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='HISTORIAL_NO_CONFIRMADO'; END IF;
    RETURN pg_catalog.jsonb_build_object('id_incidencia',p_id_incidencia,'id_practica',p_id_practica,
        'id_historial',v_evento,'estado_anterior',v_i.estado,'estado_nuevo',p_estado_nuevo,
        'id_usuario',p_id_usuario,'comentario',v_comentario,'fecha',v_instante);
END;
$$;

GRANT CREATE ON SCHEMA incidencias_privadas TO pl_ep06_state_owner;
ALTER FUNCTION incidencias_privadas.fn_cambiar_estado_incidencia(BIGINT,BIGINT,BIGINT,TEXT,TEXT,TEXT) OWNER TO pl_ep06_state_owner;
REVOKE CREATE ON SCHEMA incidencias_privadas FROM pl_ep06_state_owner;
REVOKE ALL ON FUNCTION incidencias_privadas.fn_cambiar_estado_incidencia(BIGINT,BIGINT,BIGINT,TEXT,TEXT,TEXT) FROM PUBLIC;
DO $acl$
DECLARE r NAME;
BEGIN
    FOR r IN SELECT DISTINCT roles.rolname FROM pg_catalog.pg_proc p
        CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
        JOIN pg_catalog.pg_roles roles ON roles.oid=a.grantee
        WHERE p.oid='incidencias_privadas.fn_cambiar_estado_incidencia(BIGINT,BIGINT,BIGINT,TEXT,TEXT,TEXT)'::regprocedure AND a.grantee<>p.proowner
    LOOP
        EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION incidencias_privadas.fn_cambiar_estado_incidencia(BIGINT,BIGINT,BIGINT,TEXT,TEXT,TEXT) FROM %I',r);
    END LOOP;
END;
$acl$;
GRANT EXECUTE ON FUNCTION incidencias_privadas.fn_cambiar_estado_incidencia(BIGINT,BIGINT,BIGINT,TEXT,TEXT,TEXT) TO pl_ep06_executor;
COMMIT;
