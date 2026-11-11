-- S4.6: incidencias solo con la práctica EN_CURSO.
-- Migración incremental: no modifica incidencias existentes ni su alerta.
-- Parte de la definición vigente de fn_registrar_incidencia (S4.5) y conserva firma, modo de seguridad,
-- avisos y alerta. El código PRACTICA_NO_EN_CURSO coincide con la API (409) y con las pruebas de integración.

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
    v_gestor BIGINT;
    v_gestor_activo INTEGER;
BEGIN
    -- S4.6: las incidencias solo se registran con la práctica EN_CURSO.
    IF NOT EXISTS (
        SELECT 1 FROM practica p
        JOIN estado_practica ep ON ep.id_estado = p.id_estado_actual
        WHERE p.id_practica = p_id_practica AND ep.nombre = 'EN_CURSO'
    ) THEN
        RETURN jsonb_build_object('error', 'PRACTICA_NO_EN_CURSO');
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
        SELECT id_gestor INTO v_gestor FROM practica WHERE id_practica = p_id_practica;
        SELECT COUNT(*) INTO v_gestor_activo
          FROM usuario u JOIN usuario_rol ur ON ur.id_usuario = u.id_usuario
          JOIN rol r ON r.id_rol = ur.id_rol
         WHERE u.id_usuario = v_gestor AND u.activo AND r.activo AND r.nombre = 'GESTOR';
        IF v_gestor_activo > 0 THEN
            INSERT INTO notificacion(id_usuario,id_practica,tipo,titulo,mensaje)
            VALUES (v_gestor,p_id_practica,'INCIDENCIA_' || p_prioridad,'Incidencia de prioridad ' || LOWER(p_prioridad),
                    'Se registró una incidencia de prioridad ' || LOWER(p_prioridad) || ' en tu práctica.');
        ELSE
            INSERT INTO notificacion(id_usuario,id_practica,tipo,titulo,mensaje)
            SELECT DISTINCT u.id_usuario, p_id_practica, 'INCIDENCIA_' || p_prioridad,
                   'Incidencia de prioridad ' || LOWER(p_prioridad),
                   'Se registró una incidencia de prioridad ' || LOWER(p_prioridad) || ' sin gestor activo asignado.'
              FROM usuario u JOIN usuario_rol ur ON ur.id_usuario = u.id_usuario
              JOIN rol r ON r.id_rol = ur.id_rol
             WHERE u.activo AND r.activo AND r.nombre = 'ADMINISTRADOR';
        END IF;
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
        'correo_estudiante', (SELECT u.correo FROM practica p JOIN estudiante e ON e.id_estudiante = p.id_estudiante JOIN usuario u ON u.id_usuario = e.id_usuario WHERE p.id_practica = p_id_practica),
        'centro_practica', (SELECT cp.nombre FROM practica p JOIN centro_practica cp ON cp.id_centro = p.id_centro WHERE p.id_practica = p_id_practica)
    );
END;
$$;
