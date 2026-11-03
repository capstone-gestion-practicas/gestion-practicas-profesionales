-- EP06 HU017 · Resumen de prácticas con incidencias PENDIENTE. Requiere ep06-01..04.
-- Solo lectura: sin DML, sin conversión de históricos, sin alterar prácticas.
-- pendiente = incidencia.estado = 'PENDIENTE' exacto. EN_ATENCION se informa
-- por separado y nunca se suma a pendientes. Estados históricos se ignoran.
-- Incluye prácticas finalizadas: HU016 permite gestionar sus incidencias modernas.
-- p_id_usuario es una afirmación del backend de confianza, obtenida del JWT
-- validado; SQL NO valida JWT. Nunca conceder este ejecutor al cliente web.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

DO $preflight$
BEGIN
    IF pg_catalog.to_regrole('pl_ep06_read_owner') IS NULL
       OR pg_catalog.to_regrole('pl_ep06_executor') IS NULL
       OR pg_catalog.to_regprocedure('incidencias_privadas.fn_consultar_incidencias(bigint,bigint,integer,bigint)') IS NULL THEN
        RAISE EXCEPTION 'EP06 HU017: requiere ep06-02 y ep06-04 aplicados';
    END IF;
    IF pg_catalog.to_regprocedure('incidencias_privadas.fn_resumen_incidencias_pendientes(bigint,integer,bigint)') IS NOT NULL THEN
        RAISE EXCEPTION 'EP06 HU017: la función ya existe';
    END IF;
    -- Columnas mínimas ya concedidas por ep06-04; no se conceden privilegios nuevos.
    IF NOT (pg_catalog.has_column_privilege('pl_ep06_read_owner','public.incidencia','id_practica','SELECT')
        AND pg_catalog.has_column_privilege('pl_ep06_read_owner','public.incidencia','estado','SELECT')
        AND pg_catalog.has_column_privilege('pl_ep06_read_owner','public.incidencia','fecha','SELECT')
        AND pg_catalog.has_column_privilege('pl_ep06_read_owner','public.usuario','activo','SELECT')
        AND pg_catalog.has_column_privilege('pl_ep06_read_owner','public.rol','activo','SELECT')) THEN
        RAISE EXCEPTION 'EP06 HU017: privilegios de lectura incompatibles';
    END IF;
    IF pg_catalog.has_table_privilege('pl_ep06_executor','public.incidencia','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
       OR pg_catalog.has_any_column_privilege('pl_ep06_executor','public.incidencia','SELECT,INSERT,UPDATE,REFERENCES') THEN
        RAISE EXCEPTION 'EP06 HU017: el ejecutor no debe leer ni escribir incidencia directamente';
    END IF;
END;
$preflight$;

CREATE FUNCTION incidencias_privadas.fn_resumen_incidencias_pendientes(
    p_id_usuario BIGINT, p_limit INTEGER DEFAULT 50, p_offset BIGINT DEFAULT 0
) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET TimeZone = 'UTC'
AS $$
DECLARE v_items JSONB; v_hay_mas BOOLEAN;
BEGIN
    -- Autorizar antes de revelar cualquier dato. Usuario y rol activos.
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

    -- Una sola sentencia: página y indicador de continuidad usan la misma instantánea.
    -- Solo se agregan estados modernos; cualquier otro valor histórico queda fuera.
    WITH agregado AS (
        SELECT i.id_practica,
               count(*) FILTER (WHERE i.estado='PENDIENTE') AS pendientes,
               count(*) FILTER (WHERE i.estado='EN_ATENCION') AS en_atencion,
               min(i.fecha) FILTER (WHERE i.estado='PENDIENTE') AS fecha_pendiente_antigua
        FROM public.incidencia i
        WHERE i.estado IN ('PENDIENTE','EN_ATENCION')
        GROUP BY i.id_practica
        HAVING count(*) FILTER (WHERE i.estado='PENDIENTE') > 0
    ), pagina AS MATERIALIZED (
        SELECT a.id_practica,a.pendientes,a.en_atencion,a.fecha_pendiente_antigua
        FROM agregado a
        ORDER BY a.fecha_pendiente_antigua ASC, a.id_practica ASC
        LIMIT p_limit+1 OFFSET p_offset
    )
    SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'id_practica',v.id_practica,'pendientes',v.pendientes,
               'en_atencion',v.en_atencion,'fecha_pendiente_antigua',v.fecha_pendiente_antigua)
           ORDER BY v.fecha_pendiente_antigua ASC, v.id_practica ASC),'[]'::JSONB),
           (SELECT count(*)>p_limit FROM pagina)
    INTO v_items, v_hay_mas
    FROM (SELECT * FROM pagina ORDER BY fecha_pendiente_antigua ASC, id_practica ASC LIMIT p_limit) v;

    RETURN pg_catalog.jsonb_build_object('items',v_items,'limit',p_limit,'offset',p_offset,'hay_mas',v_hay_mas);
END;
$$;

-- Propietario ya existente: no se crea ningún rol nuevo.
GRANT CREATE ON SCHEMA incidencias_privadas TO pl_ep06_read_owner;
ALTER FUNCTION incidencias_privadas.fn_resumen_incidencias_pendientes(BIGINT,INTEGER,BIGINT) OWNER TO pl_ep06_read_owner;
REVOKE CREATE ON SCHEMA incidencias_privadas FROM pl_ep06_read_owner;
REVOKE ALL ON FUNCTION incidencias_privadas.fn_resumen_incidencias_pendientes(BIGINT,INTEGER,BIGINT) FROM PUBLIC;
-- Eliminar también ACL heredadas por default privileges, salvo el propietario.
DO $acl$
DECLARE r NAME;
BEGIN
    FOR r IN SELECT DISTINCT roles.rolname FROM pg_catalog.pg_proc p
        CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
        JOIN pg_catalog.pg_roles roles ON roles.oid=a.grantee
        WHERE p.oid='incidencias_privadas.fn_resumen_incidencias_pendientes(bigint,integer,bigint)'::regprocedure
          AND a.grantee<>p.proowner
    LOOP
        EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION incidencias_privadas.fn_resumen_incidencias_pendientes(BIGINT,INTEGER,BIGINT) FROM %I',r);
    END LOOP;
END;
$acl$;
GRANT EXECUTE ON FUNCTION incidencias_privadas.fn_resumen_incidencias_pendientes(BIGINT,INTEGER,BIGINT) TO pl_ep06_executor;
COMMIT;
