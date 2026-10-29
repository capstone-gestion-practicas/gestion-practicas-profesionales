CREATE OR REPLACE FUNCTION public.fn_listar_destinatarios_mensaje_push()
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id_usuario', u.id_usuario,
        'nombre', CONCAT(u.nombre, ' ', u.apellido)
    ) ORDER BY u.apellido, u.nombre), '[]'::JSONB)
    FROM public.usuario u
    WHERE u.activo
      AND EXISTS (
          SELECT 1
          FROM public.usuario_rol ur
          JOIN public.rol r ON r.id_rol = ur.id_rol
          WHERE ur.id_usuario = u.id_usuario
            AND r.nombre = 'ESTUDIANTE'
            AND r.activo
      );
$$;

CREATE OR REPLACE FUNCTION public.fn_crear_mensaje_push_gestor(
    p_id_usuario BIGINT,
    p_titulo VARCHAR,
    p_mensaje VARCHAR
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_id_notificacion BIGINT;
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.usuario u
        WHERE u.id_usuario = p_id_usuario
          AND u.activo
          AND EXISTS (
              SELECT 1
              FROM public.usuario_rol ur
              JOIN public.rol r ON r.id_rol = ur.id_rol
              WHERE ur.id_usuario = u.id_usuario
                AND r.nombre = 'ESTUDIANTE'
                AND r.activo
          )
    ) THEN
        RETURN jsonb_build_object('error', 'DESTINATARIO_NO_DISPONIBLE');
    END IF;

    INSERT INTO public.notificacion (id_usuario, id_practica, tipo, titulo, mensaje)
    VALUES (
        p_id_usuario, NULL, 'MENSAJE_GESTOR',
        LEFT(BTRIM(p_titulo), 150),
        LEFT(BTRIM(p_mensaje), 500)
    )
    RETURNING id_notificacion INTO v_id_notificacion;

    RETURN jsonb_build_object('id_notificacion', v_id_notificacion);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_listar_destinatarios_mensaje_push() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_crear_mensaje_push_gestor(BIGINT, VARCHAR, VARCHAR) FROM PUBLIC;
