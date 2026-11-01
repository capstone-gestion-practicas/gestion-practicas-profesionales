-- HU016 consulta de todos los eventos. No modifica el GET de HU015.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
CREATE FUNCTION incidencias_privadas.fn_consultar_historial_incidencia(
    p_id_practica BIGINT, p_id_incidencia BIGINT, p_id_usuario BIGINT,
    p_limit INTEGER DEFAULT 50, p_offset BIGINT DEFAULT 0
) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
SET TimeZone='UTC'
AS $$
DECLARE v_items JSONB; v_hay_mas BOOLEAN;
BEGIN
    IF p_id_usuario IS NULL OR p_id_usuario<=0 THEN
        RETURN pg_catalog.jsonb_build_object('error','USUARIO_NO_AUTORIZADO');
    END IF;
    IF NOT EXISTS(SELECT 1 FROM public.usuario u
        JOIN public.usuario_rol ur ON ur.id_usuario=u.id_usuario
        JOIN public.rol r ON r.id_rol=ur.id_rol
        WHERE u.id_usuario=p_id_usuario AND u.activo AND r.activo AND r.nombre IN ('GESTOR','ADMINISTRADOR')) THEN
        RETURN pg_catalog.jsonb_build_object('error','USUARIO_NO_AUTORIZADO');
    END IF;
    IF p_id_practica IS NULL OR p_id_practica<=0 OR p_id_incidencia IS NULL OR p_id_incidencia<=0 THEN
        RETURN pg_catalog.jsonb_build_object('error','IDENTIFICADOR_INVALIDO');
    END IF;
    IF p_limit IS NULL OR p_limit<1 OR p_limit>100 OR p_offset IS NULL OR p_offset<0 THEN
        RETURN pg_catalog.jsonb_build_object('error','PAGINACION_INVALIDA');
    END IF;
    IF NOT EXISTS(SELECT 1 FROM public.practica WHERE id_practica=p_id_practica) THEN
        RETURN pg_catalog.jsonb_build_object('error','PRACTICA_NO_ENCONTRADA');
    END IF;
    IF NOT EXISTS(SELECT 1 FROM public.incidencia WHERE id_incidencia=p_id_incidencia AND id_practica=p_id_practica) THEN
        RETURN pg_catalog.jsonb_build_object('error','INCIDENCIA_NO_ENCONTRADA');
    END IF;
    WITH pagina AS MATERIALIZED (
        SELECT h.id_historial,h.id_usuario,h.estado_anterior,h.estado_nuevo,h.fecha,h.comentario
        FROM public.historial_estado_incidencia h WHERE h.id_incidencia=p_id_incidencia
        ORDER BY h.id_historial DESC LIMIT p_limit+1 OFFSET p_offset
    ), visibles AS (SELECT * FROM pagina ORDER BY id_historial DESC LIMIT p_limit)
    SELECT COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(v) ORDER BY v.id_historial DESC)
        FROM visibles v),'[]'::JSONB),(SELECT count(*)>p_limit FROM pagina)
    INTO v_items,v_hay_mas;
    RETURN pg_catalog.jsonb_build_object('id_practica',p_id_practica,'id_incidencia',p_id_incidencia,
        'items',v_items,'limit',p_limit,'offset',p_offset,'hay_mas',v_hay_mas);
END;
$$;

GRANT CREATE ON SCHEMA incidencias_privadas TO pl_ep06_history_owner;
ALTER FUNCTION incidencias_privadas.fn_consultar_historial_incidencia(BIGINT,BIGINT,BIGINT,INTEGER,BIGINT) OWNER TO pl_ep06_history_owner;
REVOKE CREATE ON SCHEMA incidencias_privadas FROM pl_ep06_history_owner;
REVOKE ALL ON FUNCTION incidencias_privadas.fn_consultar_historial_incidencia(BIGINT,BIGINT,BIGINT,INTEGER,BIGINT) FROM PUBLIC;
DO $acl$
DECLARE r NAME;
BEGIN
    FOR r IN SELECT DISTINCT roles.rolname FROM pg_catalog.pg_proc p
        CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
        JOIN pg_catalog.pg_roles roles ON roles.oid=a.grantee
        WHERE p.oid='incidencias_privadas.fn_consultar_historial_incidencia(BIGINT,BIGINT,BIGINT,INTEGER,BIGINT)'::regprocedure AND a.grantee<>p.proowner
    LOOP
        EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION incidencias_privadas.fn_consultar_historial_incidencia(BIGINT,BIGINT,BIGINT,INTEGER,BIGINT) FROM %I',r);
    END LOOP;
END;
$acl$;
GRANT EXECUTE ON FUNCTION incidencias_privadas.fn_consultar_historial_incidencia(BIGINT,BIGINT,BIGINT,INTEGER,BIGINT) TO pl_ep06_executor;
COMMIT;
