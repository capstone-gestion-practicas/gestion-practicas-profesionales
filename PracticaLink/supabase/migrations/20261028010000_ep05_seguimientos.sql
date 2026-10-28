CREATE OR REPLACE FUNCTION public.fn_registrar_seguimiento(
    p_id_practica BIGINT,
    p_id_usuario BIGINT,
    p_fecha DATE,
    p_observacion TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_id_seguimiento BIGINT;
    v_fecha TIMESTAMPTZ;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM practica p
        JOIN estado_practica ep ON ep.id_estado = p.id_estado_actual
        WHERE p.id_practica = p_id_practica AND NOT ep.es_final
    ) THEN
        RETURN jsonb_build_object('error', 'PRACTICA_NO_DISPONIBLE');
    END IF;

    INSERT INTO seguimiento (id_practica, id_usuario, fecha, observacion)
    VALUES (
        p_id_practica, p_id_usuario,
        (COALESCE(p_fecha, CURRENT_DATE) + TIME '12:00') AT TIME ZONE 'UTC',
        p_observacion
    )
    RETURNING id_seguimiento, fecha INTO v_id_seguimiento, v_fecha;

    RETURN jsonb_build_object(
        'id_seguimiento', v_id_seguimiento,
        'id_practica', p_id_practica,
        'id_usuario', p_id_usuario,
        'usuario', (SELECT CONCAT(nombre, ' ', apellido) FROM usuario WHERE id_usuario = p_id_usuario),
        'fecha', v_fecha,
        'observacion', p_observacion
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_listar_seguimientos(
    p_id_practica BIGINT
)
RETURNS JSONB
LANGUAGE sql STABLE
SET search_path = public
AS $$
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id_seguimiento', s.id_seguimiento,
        'id_practica', s.id_practica,
        'id_usuario', s.id_usuario,
        'usuario', CONCAT(u.nombre, ' ', u.apellido),
        'fecha', s.fecha,
        'observacion', s.observacion
    ) ORDER BY s.fecha DESC, s.id_seguimiento DESC), '[]'::JSONB)
    FROM seguimiento s
    JOIN usuario u ON u.id_usuario = s.id_usuario
    WHERE s.id_practica = p_id_practica;
$$;

REVOKE ALL ON FUNCTION public.fn_registrar_seguimiento(BIGINT, BIGINT, DATE, TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_listar_seguimientos(BIGINT) FROM PUBLIC, anon, authenticated, service_role;
