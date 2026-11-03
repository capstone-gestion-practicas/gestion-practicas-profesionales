-- EP06 HU017 · Corrección DEFECTO-001: el resumen incluye prácticas con PENDIENTE o EN_ATENCION.
-- Requiere ep06-08. Incremental: no modifica scripts anteriores.
-- Incluye una práctica si pendientes > 0 OR en_atencion > 0. Excluye si ambos son 0.
-- pendientes y en_atencion son contadores independientes. RESUELTA y históricos
-- (ABIERTA, EN_REVISION, CERRADA) no cuentan. Solo lectura: sin DML.
-- Orden determinista: primero prácticas con pendientes (la más antigua antes); después
-- prácticas solo EN_ATENCION (por su incidencia en gestión más antigua, clave interna
-- que no se devuelve); desempate por id_practica. fecha_pendiente_antigua es null si
-- pendientes = 0: no se inventa una fecha de pendiente.
-- p_id_usuario es una afirmación del backend de confianza, obtenida del JWT validado.
-- Mantiene propietario pl_ep06_read_owner, SECURITY DEFINER y EXECUTE solo para el ejecutor.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

DO $preflight$
BEGIN
    IF pg_catalog.to_regprocedure('incidencias_privadas.fn_resumen_incidencias_pendientes(bigint,integer,bigint)') IS NULL THEN
        RAISE EXCEPTION 'EP06 HU017 corrección: requiere ep06-08 aplicado';
    END IF;
    IF pg_catalog.pg_get_userbyid((SELECT proowner FROM pg_catalog.pg_proc
        WHERE oid='incidencias_privadas.fn_resumen_incidencias_pendientes(bigint,integer,bigint)'::regprocedure))
        <> 'pl_ep06_read_owner' THEN
        RAISE EXCEPTION 'EP06 HU017 corrección: propietario inesperado';
    END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION incidencias_privadas.fn_resumen_incidencias_pendientes(
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

    -- Una sola sentencia: página y continuidad usan la misma instantánea.
    -- Solo estados modernos PENDIENTE y EN_ATENCION; los históricos quedan fuera.
    WITH agregado AS (
        SELECT i.id_practica,
               count(*) FILTER (WHERE i.estado='PENDIENTE') AS pendientes,
               count(*) FILTER (WHERE i.estado='EN_ATENCION') AS en_atencion,
               min(i.fecha) FILTER (WHERE i.estado='PENDIENTE') AS fecha_pendiente_antigua,
               min(i.fecha) FILTER (WHERE i.estado='EN_ATENCION') AS fecha_en_atencion_antigua
        FROM public.incidencia i
        WHERE i.estado IN ('PENDIENTE','EN_ATENCION')
        GROUP BY i.id_practica
        HAVING count(*) FILTER (WHERE i.estado='PENDIENTE') > 0
            OR count(*) FILTER (WHERE i.estado='EN_ATENCION') > 0
    ), pagina AS MATERIALIZED (
        SELECT a.id_practica,a.pendientes,a.en_atencion,a.fecha_pendiente_antigua,a.fecha_en_atencion_antigua
        FROM agregado a
        ORDER BY (a.fecha_pendiente_antigua IS NULL) ASC, a.fecha_pendiente_antigua ASC,
                 a.fecha_en_atencion_antigua ASC, a.id_practica ASC
        LIMIT p_limit+1 OFFSET p_offset
    )
    SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'id_practica',v.id_practica,'pendientes',v.pendientes,
               'en_atencion',v.en_atencion,'fecha_pendiente_antigua',v.fecha_pendiente_antigua)
           ORDER BY (v.fecha_pendiente_antigua IS NULL) ASC, v.fecha_pendiente_antigua ASC,
                    v.fecha_en_atencion_antigua ASC, v.id_practica ASC),'[]'::JSONB),
           (SELECT count(*)>p_limit FROM pagina)
    INTO v_items, v_hay_mas
    FROM (SELECT * FROM pagina
          ORDER BY (fecha_pendiente_antigua IS NULL) ASC, fecha_pendiente_antigua ASC,
                   fecha_en_atencion_antigua ASC, id_practica ASC LIMIT p_limit) v;

    RETURN pg_catalog.jsonb_build_object('items',v_items,'limit',p_limit,'offset',p_offset,'hay_mas',v_hay_mas);
END;
$$;
COMMIT;
