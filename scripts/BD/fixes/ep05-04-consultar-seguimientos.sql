-- HU014 WEB. Requiere ep05-01/02/03. Aplicación única y transaccional.
-- PMV: GESTOR/ADMINISTRADOR activos tienen alcance global, en todos los estados.
-- p_id_usuario es una afirmación del backend de confianza, obtenida del JWT
-- validado; SQL NO valida JWT. Nunca conceder este ejecutor al cliente web.
BEGIN;
CREATE ROLE pl_ep05_read_owner NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS
    NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE ROLE pl_ep05_read_executor NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS
    NOCREATEDB NOCREATEROLE NOREPLICATION;
GRANT USAGE ON SCHEMA seguimientos_privados TO pl_ep05_read_owner, pl_ep05_read_executor;
GRANT USAGE ON SCHEMA public TO pl_ep05_read_owner;
GRANT SELECT(id_usuario,activo,nombre,apellido) ON public.usuario TO pl_ep05_read_owner;
GRANT SELECT(id_usuario,id_rol) ON public.usuario_rol TO pl_ep05_read_owner;
GRANT SELECT(id_rol,nombre,activo) ON public.rol TO pl_ep05_read_owner;
GRANT SELECT(id_practica) ON public.practica TO pl_ep05_read_owner;
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
            WHEN 'practica' THEN permitidas:=ARRAY['id_practica'];
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
COMMIT;
