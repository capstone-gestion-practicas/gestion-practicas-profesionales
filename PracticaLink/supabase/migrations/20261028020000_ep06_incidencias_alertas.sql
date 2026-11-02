CREATE INDEX IF NOT EXISTS idx_incidencia_estado_fecha
    ON incidencia (estado, fecha DESC);

CREATE OR REPLACE FUNCTION public.fn_registrar_incidencia(
    p_id_practica BIGINT,
    p_id_usuario BIGINT,
    p_fecha DATE,
    p_descripcion TEXT,
    p_prioridad VARCHAR
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_id_incidencia BIGINT;
    v_fecha TIMESTAMPTZ;
    v_alerta BOOLEAN := FALSE;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM practica p
        JOIN estado_practica ep ON ep.id_estado = p.id_estado_actual
        WHERE p.id_practica = p_id_practica AND NOT ep.es_final
    ) THEN
        RETURN jsonb_build_object('error', 'PRACTICA_NO_DISPONIBLE');
    END IF;

    INSERT INTO incidencia (id_practica, id_usuario, fecha, descripcion, prioridad)
    VALUES (
        p_id_practica, p_id_usuario,
        (COALESCE(p_fecha, CURRENT_DATE) + TIME '12:00') AT TIME ZONE 'UTC',
        p_descripcion, p_prioridad
    )
    RETURNING id_incidencia, fecha INTO v_id_incidencia, v_fecha;

    IF p_prioridad IN ('ALTA', 'CRITICA') THEN
        INSERT INTO alerta (id_incidencia, tipo, mensaje)
        VALUES (
            v_id_incidencia,
            'INCIDENCIA_' || p_prioridad,
            'Incidencia de prioridad ' || LOWER(p_prioridad) || ' requiere atención.'
        );
        v_alerta := TRUE;
    END IF;

    RETURN jsonb_build_object(
        'id_incidencia', v_id_incidencia,
        'id_practica', p_id_practica,
        'id_usuario', p_id_usuario,
        'usuario', (SELECT CONCAT(nombre, ' ', apellido) FROM usuario WHERE id_usuario = p_id_usuario),
        'fecha', v_fecha,
        'descripcion', p_descripcion,
        'prioridad', p_prioridad,
        'estado', 'ABIERTA',
        'fecha_resolucion', NULL,
        'alerta', v_alerta,
        'estudiante', (SELECT CONCAT(u.nombre, ' ', u.apellido) FROM practica p JOIN estudiante e ON e.id_estudiante = p.id_estudiante JOIN usuario u ON u.id_usuario = e.id_usuario WHERE p.id_practica = p_id_practica),
        'centro_practica', (SELECT cp.nombre FROM practica p JOIN centro_practica cp ON cp.id_centro = p.id_centro WHERE p.id_practica = p_id_practica)
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_listar_incidencias()
RETURNS JSONB
LANGUAGE sql STABLE
SET search_path = public
AS $$
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id_incidencia', i.id_incidencia,
        'id_practica', i.id_practica,
        'id_usuario', i.id_usuario,
        'usuario', CONCAT(autor.nombre, ' ', autor.apellido),
        'fecha', i.fecha,
        'descripcion', i.descripcion,
        'prioridad', i.prioridad,
        'estado', i.estado,
        'fecha_resolucion', i.fecha_resolucion,
        'alerta', EXISTS (SELECT 1 FROM alerta a WHERE a.id_incidencia = i.id_incidencia AND a.estado = 'PENDIENTE'),
        'estudiante', CONCAT(est.nombre, ' ', est.apellido),
        'centro_practica', cp.nombre
    ) ORDER BY (i.estado IN ('ABIERTA', 'EN_REVISION')) DESC, i.fecha DESC, i.id_incidencia DESC), '[]'::JSONB)
    FROM incidencia i
    JOIN usuario autor ON autor.id_usuario = i.id_usuario
    JOIN practica p ON p.id_practica = i.id_practica
    JOIN estudiante e ON e.id_estudiante = p.id_estudiante
    JOIN usuario est ON est.id_usuario = e.id_usuario
    JOIN centro_practica cp ON cp.id_centro = p.id_centro;
$$;

CREATE OR REPLACE FUNCTION public.fn_actualizar_estado_incidencia(
    p_id_incidencia BIGINT,
    p_estado VARCHAR
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_estado VARCHAR(20);
BEGIN
    UPDATE incidencia
    SET estado = p_estado,
        fecha_resolucion = CASE
            WHEN p_estado IN ('RESUELTA', 'CERRADA') THEN COALESCE(fecha_resolucion, NOW())
            ELSE NULL
        END
    WHERE id_incidencia = p_id_incidencia
    RETURNING estado INTO v_estado;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('error', 'INCIDENCIA_NO_ENCONTRADA');
    END IF;

    UPDATE alerta
    SET estado = CASE
        WHEN p_estado IN ('RESUELTA', 'CERRADA') THEN 'CERRADA'
        ELSE 'PENDIENTE'
    END
    WHERE id_incidencia = p_id_incidencia;

    RETURN jsonb_build_object(
        'id_incidencia', p_id_incidencia,
        'estado', v_estado,
        'mensaje', 'Estado de la incidencia actualizado'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_registrar_incidencia(BIGINT, BIGINT, DATE, TEXT, VARCHAR) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_listar_incidencias() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_actualizar_estado_incidencia(BIGINT, VARCHAR) FROM PUBLIC, anon, authenticated, service_role;
