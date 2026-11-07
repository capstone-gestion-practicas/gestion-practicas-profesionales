-- EP08: autoriza decisiones solo a gestores activos y autoasigna al aprobador.
-- La identidad p_id_usuario es una afirmación del backend privado, derivada del
-- JWT validado. Esta función no se publica como RPC para clientes Supabase.

CREATE OR REPLACE FUNCTION public.fn_revisar_practica(
    p_id_practica BIGINT,
    p_id_usuario BIGINT,
    p_decision VARCHAR,
    p_observacion VARCHAR DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_estado_actual VARCHAR(50);
    v_id_estado BIGINT;
    v_id_estudiante BIGINT;
    v_id_gestor BIGINT;
    v_nombre_estado VARCHAR(50);
BEGIN
    -- Mantiene vigente el rol durante la operación; coincide con el orden de
    -- bloqueos usuario -> práctica usado por la asignación administrativa.
    PERFORM 1
    FROM public.usuario u
    JOIN public.usuario_rol ur ON ur.id_usuario = u.id_usuario
    JOIN public.rol r ON r.id_rol = ur.id_rol
    WHERE u.id_usuario = p_id_usuario
      AND u.activo
      AND r.activo
      AND r.nombre = 'GESTOR'
    FOR SHARE OF u, ur, r;
    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('error', 'USUARIO_NO_AUTORIZADO');
    END IF;

    SELECT ep.nombre, p.id_estudiante, p.id_gestor
    INTO v_estado_actual, v_id_estudiante, v_id_gestor
    FROM public.practica p
    JOIN public.estado_practica ep ON ep.id_estado = p.id_estado_actual
    WHERE p.id_practica = p_id_practica
    FOR UPDATE OF p;
    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('error', 'SOLICITUD_NO_ENCONTRADA');
    END IF;

    IF v_estado_actual NOT IN ('REGISTRADA', 'EN_REVISION', 'OBSERVADA') THEN
        RETURN pg_catalog.jsonb_build_object('error', 'SOLICITUD_NO_REVISABLE');
    END IF;

    SELECT ep.id_estado, ep.nombre
    INTO v_id_estado, v_nombre_estado
    FROM public.estado_practica ep
    WHERE ep.nombre = pg_catalog.upper(p_decision)
      AND ep.activo
      AND ep.nombre IN ('APROBADA', 'OBSERVADA', 'RECHAZADA');
    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('error', 'DECISION_INVALIDA');
    END IF;

    IF v_nombre_estado = 'APROBADA'
       AND v_id_gestor IS NOT NULL
       AND v_id_gestor <> p_id_usuario THEN
        RETURN pg_catalog.jsonb_build_object('error', 'GESTOR_ASIGNADO_A_OTRO');
    END IF;

    UPDATE public.practica
    SET id_estado_actual = v_id_estado,
        id_gestor = CASE
            WHEN v_nombre_estado = 'APROBADA' THEN p_id_usuario
            ELSE id_gestor
        END,
        fecha_actualizacion = pg_catalog.clock_timestamp()
    WHERE id_practica = p_id_practica;

    INSERT INTO public.historial_estado (
        id_practica, id_estado, id_usuario, observacion
    ) VALUES (
        p_id_practica, v_id_estado, p_id_usuario,
        NULLIF(pg_catalog.btrim(p_observacion), '')
    );

    INSERT INTO public.notificacion (
        id_usuario, id_practica, tipo, titulo, mensaje
    )
    SELECT e.id_usuario, p_id_practica, 'CAMBIO_ESTADO',
        'Estado de práctica actualizado',
        pg_catalog.concat('Tu práctica cambió al estado ', v_nombre_estado, '.')
    FROM public.estudiante e
    WHERE e.id_estudiante = v_id_estudiante;

    RETURN pg_catalog.jsonb_build_object(
        'id_practica', p_id_practica,
        'estado', v_nombre_estado,
        'mensaje', 'Solicitud revisada correctamente'
    );
END;
$$;

-- Solo el propietario/la conexión privada del backend puede invocar la función.
-- No conceder EXECUTE a roles cliente ni publicar esta firma en la Data API.
REVOKE ALL ON FUNCTION public.fn_revisar_practica(BIGINT, BIGINT, VARCHAR, VARCHAR)
    FROM PUBLIC, anon, authenticated, service_role;

DO $acl$
DECLARE
    v_firma TEXT := 'public.fn_revisar_practica(bigint,bigint,character varying,character varying)';
BEGIN
    IF NOT pg_catalog.has_function_privilege(CURRENT_USER, v_firma, 'EXECUTE') THEN
        RAISE EXCEPTION 'EP08: la identidad que instala la función no conserva EXECUTE';
    END IF;
    IF pg_catalog.has_function_privilege('anon', v_firma, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_firma, 'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role', v_firma, 'EXECUTE') THEN
        RAISE EXCEPTION 'EP08: una identidad de cliente conserva EXECUTE';
    END IF;
END;
$acl$;
