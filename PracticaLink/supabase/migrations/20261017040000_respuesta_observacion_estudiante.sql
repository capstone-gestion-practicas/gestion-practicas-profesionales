CREATE OR REPLACE FUNCTION public.fn_responder_observacion_practica(
    p_id_practica BIGINT,
    p_id_usuario BIGINT,
    p_respuesta VARCHAR
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_id_estudiante BIGINT;
    v_id_estado_actual BIGINT;
    v_id_estado_revision BIGINT;
    v_nombre_estado VARCHAR(50);
    v_respuesta VARCHAR(500);
BEGIN
    v_respuesta := NULLIF(BTRIM(p_respuesta), '');
    IF v_respuesta IS NULL THEN
        RETURN jsonb_build_object('error', 'RESPUESTA_REQUERIDA');
    END IF;

    SELECT p.id_estudiante, p.id_estado_actual
    INTO v_id_estudiante, v_id_estado_actual
    FROM practica p
    JOIN estudiante e ON e.id_estudiante = p.id_estudiante
    WHERE p.id_practica = p_id_practica
      AND e.id_usuario = p_id_usuario
    FOR UPDATE OF p;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('error', 'PRACTICA_NO_ENCONTRADA');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM estado_practica
        WHERE id_estado = v_id_estado_actual AND nombre = 'OBSERVADA'
    ) THEN
        RETURN jsonb_build_object('error', 'PRACTICA_NO_OBSERVADA');
    END IF;

    SELECT id_estado, nombre
    INTO v_id_estado_revision, v_nombre_estado
    FROM estado_practica
    WHERE nombre = 'EN_REVISION' AND activo
    LIMIT 1;
    IF v_id_estado_revision IS NULL THEN
        RETURN jsonb_build_object('error', 'ESTADO_REVISION_NO_DISPONIBLE');
    END IF;

    UPDATE practica
    SET id_estado_actual = v_id_estado_revision,
        fecha_actualizacion = NOW()
    WHERE id_practica = p_id_practica;

    INSERT INTO historial_estado (id_practica, id_estado, id_usuario, observacion)
    VALUES (p_id_practica, v_id_estado_revision, p_id_usuario, v_respuesta);

    INSERT INTO notificacion (id_usuario, id_practica, tipo, titulo, mensaje)
    SELECT DISTINCT ur.id_usuario, p_id_practica, 'RESPUESTA_OBSERVACION',
        'Respuesta a práctica observada',
        CONCAT('El estudiante respondió la observación de la práctica #', p_id_practica, '.')
    FROM usuario_rol ur
    JOIN rol r ON r.id_rol = ur.id_rol
    JOIN usuario destinatario ON destinatario.id_usuario = ur.id_usuario
    WHERE r.nombre IN ('GESTOR', 'ADMINISTRADOR')
      AND r.activo AND destinatario.activo;

    RETURN jsonb_build_object(
        'id_practica', p_id_practica,
        'id_estado', v_id_estado_revision,
        'estado', v_nombre_estado,
        'mensaje', 'Respuesta enviada y práctica devuelta a revisión'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_responder_observacion_practica(BIGINT, BIGINT, VARCHAR)
    FROM PUBLIC, anon, authenticated, service_role;
