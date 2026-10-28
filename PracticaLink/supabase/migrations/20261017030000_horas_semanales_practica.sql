ALTER TABLE public.practica
    ADD COLUMN IF NOT EXISTS horas_semanales INTEGER;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.practica'::regclass
          AND conname = 'chk_practica_horas_semanales'
    ) THEN
        ALTER TABLE public.practica
            ADD CONSTRAINT chk_practica_horas_semanales
            CHECK (horas_semanales IS NULL OR horas_semanales BETWEEN 1 AND 45);
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_registrar_practica(
    p_id_usuario BIGINT,
    p_datos JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_id_estudiante BIGINT;
    v_id_estado BIGINT;
    v_nombre_estado VARCHAR(50);
    v_id_centro BIGINT;
    v_id_practica BIGINT;
    v_nombre_estudiante TEXT;
    v_nombre_centro TEXT;
    v_rut_empresa VARCHAR(12);
BEGIN
    SELECT e.id_estudiante INTO v_id_estudiante
    FROM estudiante e WHERE e.id_usuario = p_id_usuario FOR UPDATE;
    IF v_id_estudiante IS NULL THEN
        RETURN jsonb_build_object('error', 'PERFIL_ESTUDIANTE_NO_ENCONTRADO');
    END IF;
    IF EXISTS (
        SELECT 1 FROM practica p
        JOIN estado_practica ep ON ep.id_estado = p.id_estado_actual
        WHERE p.id_estudiante = v_id_estudiante AND ep.es_final = FALSE
    ) THEN
        RETURN jsonb_build_object('error', 'PRACTICA_ACTIVA');
    END IF;
    SELECT id_estado, nombre INTO v_id_estado, v_nombre_estado
    FROM estado_practica WHERE nombre = 'REGISTRADA' AND activo LIMIT 1;
    IF v_id_estado IS NULL THEN
        RETURN jsonb_build_object('error', 'ESTADO_INICIAL_NO_ENCONTRADO');
    END IF;

    v_rut_empresa := NULLIF(BTRIM(p_datos #>> '{centro,rut_empresa}'), '');
    IF v_rut_empresa IS NOT NULL THEN
        SELECT id_centro INTO v_id_centro FROM centro_practica
        WHERE UPPER(rut_empresa) = UPPER(v_rut_empresa) LIMIT 1;
    END IF;
    IF v_id_centro IS NULL THEN
        INSERT INTO centro_practica (
            nombre, rut_empresa, direccion, telefono, correo,
            contacto_nombre, contacto_cargo
        ) VALUES (
            BTRIM(p_datos #>> '{centro,nombre}'), v_rut_empresa,
            NULLIF(BTRIM(p_datos #>> '{centro,direccion}'), ''),
            NULLIF(BTRIM(p_datos #>> '{centro,telefono}'), ''),
            NULLIF(BTRIM(p_datos #>> '{centro,correo}'), ''),
            NULLIF(BTRIM(p_datos #>> '{centro,contacto_nombre}'), ''),
            NULLIF(BTRIM(p_datos #>> '{centro,contacto_cargo}'), '')
        ) RETURNING id_centro INTO v_id_centro;
    END IF;

    INSERT INTO practica (
        id_estudiante, id_centro, id_estado_actual, fecha_inicio,
        fecha_termino, horas, horas_semanales, cargo_funcion, descripcion
    ) VALUES (
        v_id_estudiante, v_id_centro, v_id_estado,
        NULLIF(p_datos ->> 'fecha_inicio', '')::DATE,
        NULLIF(p_datos ->> 'fecha_termino', '')::DATE,
        NULLIF(p_datos ->> 'horas', '')::INTEGER,
        NULLIF(p_datos ->> 'horas_semanales', '')::INTEGER,
        NULLIF(BTRIM(p_datos ->> 'cargo_funcion'), ''),
        NULLIF(BTRIM(p_datos ->> 'descripcion'), '')
    ) RETURNING id_practica INTO v_id_practica;

    INSERT INTO historial_estado (id_practica, id_estado, id_usuario, observacion)
    VALUES (v_id_practica, v_id_estado, p_id_usuario, 'Registro inicial de la práctica');
    SELECT CONCAT(nombre, ' ', apellido) INTO v_nombre_estudiante
    FROM usuario WHERE id_usuario = p_id_usuario;
    SELECT nombre INTO v_nombre_centro FROM centro_practica WHERE id_centro = v_id_centro;
    INSERT INTO notificacion (id_usuario, id_practica, tipo, titulo, mensaje)
    SELECT DISTINCT ur.id_usuario, v_id_practica, 'NUEVA_PRACTICA',
        'Nueva práctica registrada',
        CONCAT(v_nombre_estudiante, ' registró una práctica en ', v_nombre_centro, '.')
    FROM usuario_rol ur
    JOIN rol r ON r.id_rol = ur.id_rol
    JOIN usuario destinatario ON destinatario.id_usuario = ur.id_usuario
    WHERE r.nombre IN ('GESTOR', 'ADMINISTRADOR')
      AND r.activo AND destinatario.activo;

    RETURN jsonb_build_object(
        'id_practica', v_id_practica, 'id_centro', v_id_centro,
        'estado', v_nombre_estado, 'mensaje', 'Práctica registrada correctamente'
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_contexto_usuario(p_id_usuario BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_contexto JSONB;
BEGIN
    SELECT jsonb_build_object(
        'usuario', jsonb_build_object(
            'id_usuario', u.id_usuario, 'nombre', u.nombre,
            'apellido', u.apellido, 'correo', u.correo
        ),
        'roles', COALESCE((
            SELECT jsonb_agg(r.nombre ORDER BY r.nombre)
            FROM usuario_rol ur JOIN rol r ON r.id_rol = ur.id_rol
            WHERE ur.id_usuario = u.id_usuario AND r.activo = TRUE
        ), '[]'::jsonb),
        'perfil', CASE WHEN e.id_estudiante IS NOT NULL THEN jsonb_build_object(
            'id_estudiante', e.id_estudiante, 'rut', e.rut,
            'carrera', e.carrera, 'sede', e.sede
        ) ELSE NULL END,
        'practica_actual', CASE WHEN p.id_practica IS NOT NULL THEN jsonb_build_object(
            'id_practica', p.id_practica,
            'estado', jsonb_build_object(
                'id_estado', ep.id_estado, 'nombre', ep.nombre, 'es_final', ep.es_final
            ),
            'centro_practica', jsonb_build_object(
                'id_centro', cp.id_centro, 'nombre', cp.nombre
            ),
            'fecha_inicio', p.fecha_inicio, 'fecha_termino', p.fecha_termino,
            'horas', p.horas, 'horas_semanales', p.horas_semanales,
            'cargo_funcion', p.cargo_funcion
        ) ELSE NULL END
    ) INTO v_contexto
    FROM usuario u
    LEFT JOIN estudiante e ON e.id_usuario = u.id_usuario
    LEFT JOIN LATERAL (
        SELECT pr.* FROM practica pr
        WHERE pr.id_estudiante = e.id_estudiante
        ORDER BY CASE WHEN EXISTS (
            SELECT 1 FROM estado_practica est
            WHERE est.id_estado = pr.id_estado_actual AND est.es_final = FALSE
        ) THEN 0 ELSE 1 END, pr.fecha_registro DESC
        LIMIT 1
    ) p ON TRUE
    LEFT JOIN estado_practica ep ON ep.id_estado = p.id_estado_actual
    LEFT JOIN centro_practica cp ON cp.id_centro = p.id_centro
    WHERE u.id_usuario = p_id_usuario AND u.activo = TRUE;
    RETURN v_contexto;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_practica_estudiante(p_id_usuario BIGINT)
RETURNS JSONB
LANGUAGE sql STABLE
SET search_path = public
AS $$
    SELECT jsonb_build_object(
        'id_practica', p.id_practica, 'fecha_registro', p.fecha_registro,
        'fecha_actualizacion', p.fecha_actualizacion,
        'id_estado', ep.id_estado, 'estado', ep.nombre,
        'descripcion_estado', ep.descripcion, 'es_final', ep.es_final,
        'id_centro', cp.id_centro, 'centro_nombre', cp.nombre,
        'rut_empresa', cp.rut_empresa, 'direccion', cp.direccion,
        'telefono', cp.telefono, 'correo', cp.correo,
        'contacto_nombre', cp.contacto_nombre, 'contacto_cargo', cp.contacto_cargo,
        'fecha_inicio', p.fecha_inicio, 'fecha_termino', p.fecha_termino,
        'horas', p.horas, 'horas_semanales', p.horas_semanales,
        'cargo_funcion', p.cargo_funcion, 'descripcion', p.descripcion
    )
    FROM practica p
    JOIN estudiante e ON e.id_estudiante = p.id_estudiante
    JOIN estado_practica ep ON ep.id_estado = p.id_estado_actual
    JOIN centro_practica cp ON cp.id_centro = p.id_centro
    WHERE e.id_usuario = p_id_usuario
    ORDER BY CASE WHEN ep.es_final = FALSE THEN 0 ELSE 1 END, p.fecha_registro DESC
    LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.fn_listar_practicas_gestion()
RETURNS JSONB
LANGUAGE sql STABLE
SET search_path = public
AS $$
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id_practica', p.id_practica, 'fecha_registro', p.fecha_registro,
        'fecha_actualizacion', p.fecha_actualizacion,
        'id_estado', ep.id_estado, 'estado', ep.nombre,
        'descripcion_estado', ep.descripcion, 'es_final', ep.es_final,
        'estudiante', CONCAT(u.nombre, ' ', u.apellido),
        'rut_estudiante', e.rut, 'centro_practica', cp.nombre,
        'fecha_inicio', p.fecha_inicio, 'fecha_termino', p.fecha_termino,
        'horas_semanales', p.horas_semanales
    ) ORDER BY p.fecha_actualizacion DESC, p.id_practica DESC), '[]'::JSONB)
    FROM practica p
    JOIN estudiante e ON e.id_estudiante = p.id_estudiante
    JOIN usuario u ON u.id_usuario = e.id_usuario
    JOIN centro_practica cp ON cp.id_centro = p.id_centro
    JOIN estado_practica ep ON ep.id_estado = p.id_estado_actual;
$$;

CREATE OR REPLACE FUNCTION public.fn_obtener_solicitud_revision(p_id_practica BIGINT)
RETURNS JSONB
LANGUAGE sql STABLE
SET search_path = public
AS $$
    SELECT jsonb_build_object(
        'id_practica', p.id_practica, 'fecha_registro', p.fecha_registro,
        'estado', ep.nombre, 'estudiante', CONCAT(u.nombre, ' ', u.apellido),
        'rut_estudiante', e.rut, 'correo_estudiante', u.correo,
        'carrera', e.carrera, 'sede', e.sede,
        'centro_practica', cp.nombre, 'rut_empresa', cp.rut_empresa,
        'direccion_empresa', cp.direccion, 'correo_empresa', cp.correo,
        'contacto_nombre', cp.contacto_nombre, 'contacto_cargo', cp.contacto_cargo,
        'fecha_inicio', p.fecha_inicio, 'fecha_termino', p.fecha_termino,
        'horas', p.horas, 'horas_semanales', p.horas_semanales,
        'cargo_funcion', p.cargo_funcion, 'descripcion', p.descripcion
    )
    FROM practica p
    JOIN estudiante e ON e.id_estudiante = p.id_estudiante
    JOIN usuario u ON u.id_usuario = e.id_usuario
    JOIN centro_practica cp ON cp.id_centro = p.id_centro
    JOIN estado_practica ep ON ep.id_estado = p.id_estado_actual
    WHERE p.id_practica = p_id_practica;
$$;

REVOKE ALL ON FUNCTION public.fn_registrar_practica(BIGINT, JSONB)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_contexto_usuario(BIGINT)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_practica_estudiante(BIGINT)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_listar_practicas_gestion()
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_obtener_solicitud_revision(BIGINT)
    FROM PUBLIC, anon, authenticated, service_role;
