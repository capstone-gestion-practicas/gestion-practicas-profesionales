CREATE OR REPLACE FUNCTION public.fn_crear_mensaje_push_broadcast(
    p_titulo VARCHAR,
    p_mensaje VARCHAR
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_notificaciones JSONB;
BEGIN
    WITH nuevos AS (
        INSERT INTO public.notificacion (
            id_usuario, id_practica, tipo, titulo, mensaje
        )
        SELECT u.id_usuario, NULL, 'MENSAJE_GESTOR',
            LEFT(BTRIM(p_titulo), 150), LEFT(BTRIM(p_mensaje), 500)
        FROM public.usuario u
        WHERE u.activo
          AND EXISTS (
              SELECT 1
              FROM public.usuario_rol ur
              JOIN public.rol r ON r.id_rol = ur.id_rol
              WHERE ur.id_usuario = u.id_usuario
                AND r.nombre = 'ESTUDIANTE'
                AND r.activo
          )
        RETURNING id_notificacion, id_usuario
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id_notificacion', id_notificacion,
        'id_usuario', id_usuario
    )), '[]'::JSONB)
    INTO v_notificaciones
    FROM nuevos;

    RETURN jsonb_build_object('notificaciones', v_notificaciones);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_crear_mensaje_push_broadcast(VARCHAR, VARCHAR) FROM PUBLIC;
