-- EP06 consulta WEB. Requiere ep06-01/02/03. Aplicación única y transaccional.
-- PMV: GESTOR/ADMINISTRADOR activos tienen alcance global, en todos los estados.
-- p_id_usuario es una afirmación del backend de confianza, obtenida del JWT
-- validado; SQL NO valida JWT. Nunca conceder este ejecutor al cliente web.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
CREATE ROLE pl_ep06_read_owner NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS
    NOCREATEDB NOCREATEROLE NOREPLICATION;
-- Conservar el ejecutor dedicado existente; no cambiar sus membresías.
GRANT USAGE ON SCHEMA incidencias_privadas TO pl_ep06_read_owner, pl_ep06_executor;
GRANT USAGE ON SCHEMA public TO pl_ep06_read_owner;
GRANT SELECT(id_usuario,activo) ON public.usuario TO pl_ep06_read_owner;
GRANT SELECT(id_usuario,id_rol) ON public.usuario_rol TO pl_ep06_read_owner;
GRANT SELECT(id_rol,nombre,activo) ON public.rol TO pl_ep06_read_owner;
GRANT SELECT(id_practica) ON public.practica TO pl_ep06_read_owner;
GRANT SELECT(id_incidencia,id_practica,id_usuario,id_tipo_incidencia,fecha,descripcion,estado,fecha_resolucion)
    ON public.incidencia TO pl_ep06_read_owner;
GRANT SELECT(id_tipo_incidencia,codigo) ON public.tipo_incidencia TO pl_ep06_read_owner;
GRANT SELECT(id_historial,id_incidencia,id_usuario,estado_nuevo,fecha,comentario)
    ON public.historial_estado_incidencia TO pl_ep06_read_owner;

-- El DEFINER puede leer estas columnas para aplicar autorización; no hay
-- privilegios UPDATE para locks ni escrituras. El ejecutor no lee tablas.
DO $bootstrap$
DECLARE t TEXT; c RECORD; oid_tabla OID; permitidas TEXT[];
BEGIN
    FOREACH t IN ARRAY ARRAY['usuario','usuario_rol','rol','practica','incidencia','tipo_incidencia','historial_estado_incidencia'] LOOP
        oid_tabla := pg_catalog.to_regclass('public.' || t);
        IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid=oid_tabla)
           OR (SELECT relowner='pl_ep06_read_owner'::regrole FROM pg_catalog.pg_class WHERE oid=oid_tabla) THEN
            RAISE EXCEPTION 'EP06 lectura: RLS o propiedad incompatible';
        END IF;
        IF pg_catalog.has_table_privilege('pl_ep06_read_owner',oid_tabla,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
           OR pg_catalog.has_any_column_privilege('pl_ep06_read_owner',oid_tabla,'INSERT,UPDATE,REFERENCES')
           OR pg_catalog.has_table_privilege('pl_ep06_executor',oid_tabla,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
           OR pg_catalog.has_any_column_privilege('pl_ep06_executor',oid_tabla,'SELECT,INSERT,UPDATE,REFERENCES') THEN
            RAISE EXCEPTION 'EP06 lectura: privilegios ambientales incompatibles';
        END IF;
        CASE t
            WHEN 'usuario' THEN permitidas:=ARRAY['id_usuario','activo'];
            WHEN 'usuario_rol' THEN permitidas:=ARRAY['id_usuario','id_rol'];
            WHEN 'rol' THEN permitidas:=ARRAY['id_rol','nombre','activo'];
            WHEN 'practica' THEN permitidas:=ARRAY['id_practica'];
            WHEN 'incidencia' THEN permitidas:=ARRAY['id_incidencia','id_practica','id_usuario','id_tipo_incidencia','fecha','descripcion','estado','fecha_resolucion'];
            WHEN 'tipo_incidencia' THEN permitidas:=ARRAY['id_tipo_incidencia','codigo'];
            WHEN 'historial_estado_incidencia' THEN permitidas:=ARRAY['id_historial','id_incidencia','id_usuario','estado_nuevo','fecha','comentario'];
        END CASE;
        FOR c IN SELECT attnum,attname FROM pg_catalog.pg_attribute WHERE attrelid=oid_tabla AND attnum>0 AND NOT attisdropped LOOP
            IF pg_catalog.has_column_privilege('pl_ep06_read_owner',oid_tabla,c.attnum,'SELECT')
               AND NOT c.attname=ANY(permitidas) THEN
                RAISE EXCEPTION 'EP06 lectura: columna no prevista';
            END IF;
        END LOOP;
        EXECUTE pg_catalog.format('CREATE POLICY ep06_read_select ON public.%I FOR SELECT TO pl_ep06_read_owner USING(true)',t);
    END LOOP;
END;
$bootstrap$;

CREATE FUNCTION incidencias_privadas.fn_consultar_incidencias(
    p_id_practica BIGINT, p_id_usuario BIGINT,
    p_limit INTEGER DEFAULT 50, p_offset BIGINT DEFAULT 0
) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET TimeZone = 'UTC'
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

    WITH pagina AS MATERIALIZED (
        SELECT i.id_incidencia,i.id_practica,i.id_usuario,i.id_tipo_incidencia,
               i.fecha,i.descripcion,i.estado,i.fecha_resolucion
        FROM public.incidencia i WHERE i.id_practica=p_id_practica
        ORDER BY i.fecha DESC,i.id_incidencia DESC
        LIMIT p_limit+1 OFFSET p_offset
    ), visibles AS (
        SELECT * FROM pagina ORDER BY fecha DESC,id_incidencia DESC LIMIT p_limit
    )
    SELECT COALESCE((
        SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'id_incidencia',i.id_incidencia,'id_practica',i.id_practica,
            'id_usuario',i.id_usuario,'tipo',t.codigo,'descripcion',i.descripcion,
            'estado',i.estado,'fecha',i.fecha,
            'sin_tipo_registrado',i.id_tipo_incidencia IS NULL,
            'fecha_resolucion',i.fecha_resolucion,
            'resolucion',CASE WHEN h.id_historial IS NULL THEN NULL ELSE
                pg_catalog.jsonb_build_object('id_historial',h.id_historial,
                    'id_usuario',h.id_usuario,'fecha',h.fecha,'comentario',h.comentario) END
        ) ORDER BY i.fecha DESC,i.id_incidencia DESC)
        FROM visibles i
        LEFT JOIN public.tipo_incidencia t ON t.id_tipo_incidencia=i.id_tipo_incidencia
        LEFT JOIN LATERAL (
            SELECT e.id_historial,e.id_usuario,e.fecha,e.comentario
            FROM public.historial_estado_incidencia e
            WHERE e.id_incidencia=i.id_incidencia AND e.estado_nuevo='RESUELTA'
            ORDER BY e.fecha DESC,e.id_historial DESC LIMIT 1
        ) h ON true
    ),'[]'::JSONB), (SELECT count(*)>p_limit FROM pagina)
    INTO v_items,v_hay_mas;
    RETURN pg_catalog.jsonb_build_object('id_practica',p_id_practica,'items',v_items,
        'limit',p_limit,'offset',p_offset,'hay_mas',v_hay_mas);
END;
$$;
GRANT CREATE ON SCHEMA incidencias_privadas TO pl_ep06_read_owner;
ALTER FUNCTION incidencias_privadas.fn_consultar_incidencias(BIGINT,BIGINT,INTEGER,BIGINT) OWNER TO pl_ep06_read_owner;
REVOKE CREATE ON SCHEMA incidencias_privadas FROM pl_ep06_read_owner;
REVOKE ALL ON FUNCTION incidencias_privadas.fn_consultar_incidencias(BIGINT,BIGINT,INTEGER,BIGINT) FROM PUBLIC;
-- Limpiar también grants de default privileges, exclusivamente de esta función.
DO $acl$
DECLARE r NAME;
BEGIN
    FOR r IN SELECT DISTINCT roles.rolname FROM pg_catalog.pg_proc p
        CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
        JOIN pg_catalog.pg_roles roles ON roles.oid=a.grantee
        WHERE p.oid='incidencias_privadas.fn_consultar_incidencias(bigint,bigint,integer,bigint)'::regprocedure
          AND a.grantee<>p.proowner
    LOOP
        EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION incidencias_privadas.fn_consultar_incidencias(BIGINT,BIGINT,INTEGER,BIGINT) FROM %I',r);
    END LOOP;
END;
$acl$;
GRANT EXECUTE ON FUNCTION incidencias_privadas.fn_consultar_incidencias(BIGINT,BIGINT,INTEGER,BIGINT) TO pl_ep06_executor;
COMMIT;
