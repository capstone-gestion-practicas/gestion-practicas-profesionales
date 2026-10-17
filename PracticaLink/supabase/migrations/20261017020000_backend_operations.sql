-- Operaciones de la API encapsuladas en PostgreSQL.
-- FastAPI conserva autenticación, validación de entrada y códigos HTTP;
-- las consultas y transacciones de persistencia viven en estas funciones.

CREATE OR REPLACE FUNCTION public.fn_obtener_datos_login(p_correo VARCHAR)
RETURNS JSONB
LANGUAGE sql STABLE
SET search_path = public
AS $$
    SELECT jsonb_build_object(
        'id_usuario', id_usuario,
        'correo', correo,
        'password_hash', password_hash,
        'activo', activo
    )
    FROM usuario
    WHERE correo = LOWER(BTRIM(p_correo))
    LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.fn_completar_perfil_estudiante(
    p_id_usuario BIGINT,
    p_datos JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_id_estudiante BIGINT;
    v_rut VARCHAR(12);
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM usuario u
        JOIN usuario_rol ur ON ur.id_usuario = u.id_usuario
        JOIN rol r ON r.id_rol = ur.id_rol
        WHERE u.id_usuario = p_id_usuario AND u.activo
          AND r.nombre = 'ESTUDIANTE' AND r.activo
    ) THEN
        RETURN jsonb_build_object('error', 'USUARIO_ESTUDIANTE_NO_VALIDO');
    END IF;
    IF EXISTS (SELECT 1 FROM estudiante WHERE id_usuario = p_id_usuario) THEN
        RETURN jsonb_build_object('error', 'PERFIL_EXISTENTE');
    END IF;
    v_rut := BTRIM(p_datos ->> 'rut');
    IF EXISTS (SELECT 1 FROM estudiante WHERE UPPER(rut) = UPPER(v_rut)) THEN
        RETURN jsonb_build_object('error', 'RUT_EXISTENTE');
    END IF;
    INSERT INTO estudiante (id_usuario, rut, carrera, sede, telefono, direccion)
    VALUES (
        p_id_usuario, v_rut, BTRIM(p_datos ->> 'carrera'),
        BTRIM(p_datos ->> 'sede'), NULLIF(BTRIM(p_datos ->> 'telefono'), ''),
        NULLIF(BTRIM(p_datos ->> 'direccion'), '')
    ) RETURNING id_estudiante INTO v_id_estudiante;
    RETURN jsonb_build_object(
        'id_estudiante', v_id_estudiante,
        'mensaje', 'Perfil de estudiante completado correctamente'
    );
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
        fecha_termino, horas, cargo_funcion, descripcion
    ) VALUES (
        v_id_estudiante, v_id_centro, v_id_estado,
        NULLIF(p_datos ->> 'fecha_inicio', '')::DATE,
        NULLIF(p_datos ->> 'fecha_termino', '')::DATE,
        NULLIF(p_datos ->> 'horas', '')::INTEGER,
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

CREATE OR REPLACE FUNCTION public.fn_practica_estudiante(p_id_usuario BIGINT)
RETURNS JSONB
LANGUAGE sql STABLE
SET search_path = public
AS $$
    SELECT jsonb_build_object(
        'id_practica', p.id_practica,
        'fecha_registro', p.fecha_registro,
        'fecha_actualizacion', p.fecha_actualizacion,
        'id_estado', ep.id_estado,
        'estado', ep.nombre,
        'descripcion_estado', ep.descripcion,
        'es_final', ep.es_final,
        'id_centro', cp.id_centro,
        'centro_nombre', cp.nombre,
        'rut_empresa', cp.rut_empresa,
        'direccion', cp.direccion,
        'telefono', cp.telefono,
        'correo', cp.correo,
        'contacto_nombre', cp.contacto_nombre,
        'contacto_cargo', cp.contacto_cargo,
        'fecha_inicio', p.fecha_inicio,
        'fecha_termino', p.fecha_termino,
        'horas', p.horas,
        'cargo_funcion', p.cargo_funcion,
        'descripcion', p.descripcion
    )
    FROM practica p
    JOIN estudiante e ON e.id_estudiante = p.id_estudiante
    JOIN estado_practica ep ON ep.id_estado = p.id_estado_actual
    JOIN centro_practica cp ON cp.id_centro = p.id_centro
    WHERE e.id_usuario = p_id_usuario
    ORDER BY CASE WHEN ep.es_final = FALSE THEN 0 ELSE 1 END,
             p.fecha_registro DESC
    LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.fn_listar_estados_activos()
RETURNS JSONB
LANGUAGE sql STABLE
SET search_path = public
AS $$
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id_estado', id_estado, 'nombre', nombre,
        'descripcion', descripcion, 'es_final', es_final
    ) ORDER BY CASE nombre
        WHEN 'REGISTRADA' THEN 1 WHEN 'EN_REVISION' THEN 2
        WHEN 'OBSERVADA' THEN 3 WHEN 'APROBADA' THEN 4
        WHEN 'EN_CURSO' THEN 5 WHEN 'FINALIZADA' THEN 6
        WHEN 'RECHAZADA' THEN 7 ELSE 8 END, nombre), '[]'::JSONB)
    FROM estado_practica WHERE activo;
$$;

CREATE OR REPLACE FUNCTION public.fn_listar_practicas_gestion()
RETURNS JSONB
LANGUAGE sql STABLE
SET search_path = public
AS $$
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id_practica', p.id_practica,
        'fecha_registro', p.fecha_registro,
        'fecha_actualizacion', p.fecha_actualizacion,
        'id_estado', ep.id_estado, 'estado', ep.nombre,
        'descripcion_estado', ep.descripcion, 'es_final', ep.es_final,
        'estudiante', CONCAT(u.nombre, ' ', u.apellido),
        'rut_estudiante', e.rut, 'centro_practica', cp.nombre,
        'fecha_inicio', p.fecha_inicio, 'fecha_termino', p.fecha_termino
    ) ORDER BY p.fecha_actualizacion DESC, p.id_practica DESC), '[]'::JSONB)
    FROM practica p
    JOIN estudiante e ON e.id_estudiante = p.id_estudiante
    JOIN usuario u ON u.id_usuario = e.id_usuario
    JOIN centro_practica cp ON cp.id_centro = p.id_centro
    JOIN estado_practica ep ON ep.id_estado = p.id_estado_actual;
$$;

CREATE OR REPLACE FUNCTION public.fn_consultar_estado_practica(
    p_id_practica BIGINT, p_id_usuario BIGINT, p_puede_gestionar BOOLEAN
)
RETURNS JSONB
LANGUAGE sql STABLE
SET search_path = public
AS $$
    SELECT jsonb_build_object(
        'id_practica', p.id_practica,
        'fecha_actualizacion', p.fecha_actualizacion,
        'estado', jsonb_build_object(
            'id_estado', ep.id_estado, 'nombre', ep.nombre,
            'descripcion', ep.descripcion, 'es_final', ep.es_final
        )
    )
    FROM practica p
    JOIN estudiante e ON e.id_estudiante = p.id_estudiante
    JOIN estado_practica ep ON ep.id_estado = p.id_estado_actual
    WHERE p.id_practica = p_id_practica
      AND (p_puede_gestionar OR e.id_usuario = p_id_usuario);
$$;

CREATE OR REPLACE FUNCTION public.fn_consultar_historial_estados(
    p_id_practica BIGINT, p_id_usuario BIGINT, p_puede_gestionar BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql STABLE
SET search_path = public
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM practica p
        JOIN estudiante e ON e.id_estudiante = p.id_estudiante
        WHERE p.id_practica = p_id_practica
          AND (p_puede_gestionar OR e.id_usuario = p_id_usuario)
    ) THEN
        RETURN NULL;
    END IF;
    RETURN COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'id_historial', h.id_historial,
            'id_practica', h.id_practica,
            'id_estado', h.id_estado,
            'estado', ep.nombre,
            'es_final', ep.es_final,
            'id_usuario', h.id_usuario,
            'usuario', CONCAT(u.nombre, ' ', u.apellido),
            'fecha_cambio', h.fecha_cambio,
            'observacion', h.observacion
        ) ORDER BY h.fecha_cambio, h.id_historial)
        FROM historial_estado h
        JOIN estado_practica ep ON ep.id_estado = h.id_estado
        JOIN usuario u ON u.id_usuario = h.id_usuario
        WHERE h.id_practica = p_id_practica
    ), '[]'::JSONB);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_actualizar_estado_practica(
    p_id_practica BIGINT, p_id_usuario BIGINT,
    p_id_estado BIGINT, p_observacion VARCHAR
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_estado_actual BIGINT;
    v_id_estudiante BIGINT;
    v_nombre_estado VARCHAR(50);
BEGIN
    SELECT p.id_estado_actual, p.id_estudiante
    INTO v_estado_actual, v_id_estudiante
    FROM practica p WHERE p.id_practica = p_id_practica FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'PRACTICA_NO_ENCONTRADA'); END IF;
    SELECT nombre INTO v_nombre_estado
    FROM estado_practica WHERE id_estado = p_id_estado AND activo;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'ESTADO_NO_DISPONIBLE'); END IF;
    IF v_estado_actual <> p_id_estado THEN
        UPDATE practica SET id_estado_actual = p_id_estado, fecha_actualizacion = NOW()
        WHERE id_practica = p_id_practica;
        INSERT INTO historial_estado (id_practica, id_estado, id_usuario, observacion)
        VALUES (p_id_practica, p_id_estado, p_id_usuario, p_observacion);
        INSERT INTO notificacion (id_usuario, id_practica, tipo, titulo, mensaje)
        SELECT e.id_usuario, p_id_practica, 'CAMBIO_ESTADO',
            'Estado de práctica actualizado',
            CONCAT('Tu práctica cambió al estado ', v_nombre_estado, '.')
        FROM estudiante e WHERE e.id_estudiante = v_id_estudiante;
    END IF;
    RETURN jsonb_build_object(
        'id_practica', p_id_practica, 'id_estado', p_id_estado,
        'estado', v_nombre_estado,
        'mensaje', CASE WHEN v_estado_actual <> p_id_estado
            THEN 'Estado actualizado y registrado en el historial'
            ELSE 'La práctica ya se encuentra en ese estado' END
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_listar_solicitudes_revision()
RETURNS JSONB
LANGUAGE sql STABLE
SET search_path = public
AS $$
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id_practica', p.id_practica, 'fecha_registro', p.fecha_registro,
        'estado', ep.nombre, 'estudiante', CONCAT(u.nombre, ' ', u.apellido),
        'rut_estudiante', e.rut, 'centro_practica', cp.nombre
    ) ORDER BY p.fecha_registro), '[]'::JSONB)
    FROM practica p
    JOIN estudiante e ON e.id_estudiante = p.id_estudiante
    JOIN usuario u ON u.id_usuario = e.id_usuario
    JOIN centro_practica cp ON cp.id_centro = p.id_centro
    JOIN estado_practica ep ON ep.id_estado = p.id_estado_actual
    WHERE ep.nombre IN ('REGISTRADA', 'EN_REVISION', 'OBSERVADA');
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
        'horas', p.horas, 'cargo_funcion', p.cargo_funcion,
        'descripcion', p.descripcion
    )
    FROM practica p
    JOIN estudiante e ON e.id_estudiante = p.id_estudiante
    JOIN usuario u ON u.id_usuario = e.id_usuario
    JOIN centro_practica cp ON cp.id_centro = p.id_centro
    JOIN estado_practica ep ON ep.id_estado = p.id_estado_actual
    WHERE p.id_practica = p_id_practica;
$$;

CREATE OR REPLACE FUNCTION public.fn_revisar_practica(
    p_id_practica BIGINT, p_id_usuario BIGINT,
    p_decision VARCHAR, p_observacion VARCHAR DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_estado_actual VARCHAR(50);
    v_id_estado BIGINT;
    v_id_estudiante BIGINT;
    v_nombre_estado VARCHAR(50);
BEGIN
    SELECT ep.nombre, p.id_estudiante INTO v_estado_actual, v_id_estudiante
    FROM practica p
    JOIN estado_practica ep ON ep.id_estado = p.id_estado_actual
    WHERE p.id_practica = p_id_practica FOR UPDATE OF p;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'SOLICITUD_NO_ENCONTRADA'); END IF;
    IF v_estado_actual NOT IN ('REGISTRADA', 'EN_REVISION', 'OBSERVADA') THEN
        RETURN jsonb_build_object('error', 'SOLICITUD_NO_REVISABLE');
    END IF;
    SELECT id_estado, nombre INTO v_id_estado, v_nombre_estado
    FROM estado_practica
    WHERE nombre = UPPER(p_decision) AND activo
      AND nombre IN ('APROBADA', 'OBSERVADA', 'RECHAZADA');
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'DECISION_INVALIDA'); END IF;

    UPDATE practica SET id_estado_actual = v_id_estado, fecha_actualizacion = NOW()
    WHERE id_practica = p_id_practica;
    INSERT INTO historial_estado (id_practica, id_estado, id_usuario, observacion)
    VALUES (p_id_practica, v_id_estado, p_id_usuario, NULLIF(BTRIM(p_observacion), ''));
    INSERT INTO notificacion (id_usuario, id_practica, tipo, titulo, mensaje)
    SELECT e.id_usuario, p_id_practica, 'CAMBIO_ESTADO',
        'Estado de práctica actualizado',
        CONCAT('Tu práctica cambió al estado ', v_nombre_estado, '.')
    FROM estudiante e WHERE e.id_estudiante = v_id_estudiante;
    RETURN jsonb_build_object(
        'id_practica', p_id_practica, 'estado', v_nombre_estado,
        'mensaje', 'Solicitud resuelta correctamente'
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_listar_usuarios()
RETURNS JSONB
LANGUAGE sql STABLE
SET search_path = public
AS $$
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id_usuario', q.id_usuario, 'nombre', q.nombre,
        'apellido', q.apellido, 'correo', q.correo,
        'activo', q.activo, 'roles', q.roles
    ) ORDER BY q.apellido, q.nombre), '[]'::JSONB)
    FROM (
        SELECT u.id_usuario, u.nombre, u.apellido, u.correo, u.activo,
            COALESCE(array_agg(r.nombre ORDER BY r.nombre)
                FILTER (WHERE r.id_rol IS NOT NULL), ARRAY[]::VARCHAR[]) AS roles
        FROM usuario u
        LEFT JOIN usuario_rol ur ON ur.id_usuario = u.id_usuario
        LEFT JOIN rol r ON r.id_rol = ur.id_rol
        GROUP BY u.id_usuario
    ) q;
$$;

CREATE OR REPLACE FUNCTION public.fn_listar_roles()
RETURNS JSONB
LANGUAGE sql STABLE
SET search_path = public
AS $$
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id_rol', id_rol, 'nombre', nombre, 'descripcion', descripcion
    ) ORDER BY nombre), '[]'::JSONB)
    FROM rol WHERE activo;
$$;

CREATE OR REPLACE FUNCTION public.fn_crear_usuario_admin(
    p_id_admin BIGINT, p_datos JSONB, p_password_hash VARCHAR
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_id_usuario BIGINT;
    v_roles_solicitados INTEGER;
    v_roles_validos INTEGER;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM usuario_rol ur
        JOIN usuario u ON u.id_usuario = ur.id_usuario
        JOIN rol r ON r.id_rol = ur.id_rol
        WHERE u.id_usuario = p_id_admin AND u.activo
          AND r.nombre = 'ADMINISTRADOR' AND r.activo
    ) THEN RETURN jsonb_build_object('error', 'ADMIN_NO_VALIDO'); END IF;
    IF EXISTS (SELECT 1 FROM usuario WHERE LOWER(correo) = LOWER(BTRIM(p_datos ->> 'correo'))) THEN
        RETURN jsonb_build_object('error', 'CORREO_EXISTENTE');
    END IF;
    SELECT COUNT(DISTINCT UPPER(role_name)) INTO v_roles_solicitados
    FROM jsonb_array_elements_text(COALESCE(p_datos -> 'roles', '[]'::JSONB)) AS roles(role_name);
    SELECT COUNT(DISTINCT r.nombre) INTO v_roles_validos
    FROM rol r WHERE r.activo AND r.nombre IN (
        SELECT UPPER(role_name) FROM jsonb_array_elements_text(COALESCE(p_datos -> 'roles', '[]'::JSONB)) AS roles(role_name)
    );
    IF v_roles_solicitados = 0 OR v_roles_solicitados <> v_roles_validos THEN
        RETURN jsonb_build_object('error', 'ROLES_INVALIDOS');
    END IF;
    INSERT INTO usuario (nombre, apellido, correo, password_hash)
    VALUES (BTRIM(p_datos ->> 'nombre'), BTRIM(p_datos ->> 'apellido'),
        LOWER(BTRIM(p_datos ->> 'correo')), p_password_hash)
    RETURNING id_usuario INTO v_id_usuario;
    INSERT INTO usuario_rol (id_usuario, id_rol)
    SELECT v_id_usuario, r.id_rol FROM rol r
    WHERE r.activo AND r.nombre IN (
        SELECT UPPER(role_name) FROM jsonb_array_elements_text(p_datos -> 'roles') AS roles(role_name)
    );
    RETURN jsonb_build_object('id_usuario', v_id_usuario, 'mensaje', 'Usuario creado correctamente');
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_actualizar_usuario_admin(
    p_id_admin BIGINT, p_id_usuario BIGINT, p_datos JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_roles_solicitados INTEGER;
    v_roles_validos INTEGER;
    v_conserva_admin BOOLEAN;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM usuario_rol ur
        JOIN usuario u ON u.id_usuario = ur.id_usuario
        JOIN rol r ON r.id_rol = ur.id_rol
        WHERE u.id_usuario = p_id_admin AND u.activo
          AND r.nombre = 'ADMINISTRADOR' AND r.activo
    ) THEN RETURN jsonb_build_object('error', 'ADMIN_NO_VALIDO'); END IF;
    PERFORM 1 FROM usuario WHERE id_usuario = p_id_usuario FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'USUARIO_NO_ENCONTRADO'); END IF;
    SELECT COUNT(DISTINCT UPPER(role_name)) INTO v_roles_solicitados
    FROM jsonb_array_elements_text(COALESCE(p_datos -> 'roles', '[]'::JSONB)) AS roles(role_name);
    SELECT COUNT(DISTINCT r.nombre) INTO v_roles_validos
    FROM rol r WHERE r.activo AND r.nombre IN (
        SELECT UPPER(role_name) FROM jsonb_array_elements_text(COALESCE(p_datos -> 'roles', '[]'::JSONB)) AS roles(role_name)
    );
    IF v_roles_solicitados = 0 OR v_roles_solicitados <> v_roles_validos THEN
        RETURN jsonb_build_object('error', 'ROLES_INVALIDOS');
    END IF;
    SELECT EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(p_datos -> 'roles') AS roles(role_name)
        WHERE UPPER(role_name) = 'ADMINISTRADOR'
    ) INTO v_conserva_admin;
    IF p_id_admin = p_id_usuario AND (
        (p_datos ->> 'activo')::BOOLEAN = FALSE OR NOT v_conserva_admin
    ) THEN RETURN jsonb_build_object('error', 'AUTOGESTION_NO_PERMITIDA'); END IF;

    UPDATE usuario SET nombre = BTRIM(p_datos ->> 'nombre'),
        apellido = BTRIM(p_datos ->> 'apellido'),
        activo = (p_datos ->> 'activo')::BOOLEAN,
        fecha_actualizacion = NOW()
    WHERE id_usuario = p_id_usuario;
    DELETE FROM usuario_rol WHERE id_usuario = p_id_usuario;
    INSERT INTO usuario_rol (id_usuario, id_rol)
    SELECT p_id_usuario, r.id_rol FROM rol r
    WHERE r.activo AND r.nombre IN (
        SELECT UPPER(role_name) FROM jsonb_array_elements_text(p_datos -> 'roles') AS roles(role_name)
    );
    RETURN jsonb_build_object('id_usuario', p_id_usuario, 'mensaje', 'Usuario actualizado correctamente');
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_guardar_empresa_cache(p_datos JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_empresa empresa%ROWTYPE;
BEGIN
    INSERT INTO empresa (
        rut, dv, razon_social, fecha_inicio_actividades, giro, rubro,
        subrubro, categoria_tributaria, afecta_iva, actividades,
        comuna, region, num_trabajadores, fuente, consultado_en
    ) VALUES (
        p_datos->>'rut', p_datos->>'dv', p_datos->>'razon_social',
        p_datos->>'fecha_inicio_actividades', p_datos->>'giro', p_datos->>'rubro',
        p_datos->>'subrubro', p_datos->>'categoria_tributaria',
        p_datos->>'afecta_iva', COALESCE(p_datos->'actividades', '[]'::JSONB),
        p_datos->>'comuna', p_datos->>'region',
        NULLIF(p_datos->>'num_trabajadores', '')::INTEGER,
        COALESCE(p_datos->>'fuente', 'Chile RUT Empresa'), NOW()
    ) ON CONFLICT (rut) DO UPDATE SET
        dv = EXCLUDED.dv, razon_social = EXCLUDED.razon_social,
        fecha_inicio_actividades = EXCLUDED.fecha_inicio_actividades,
        giro = EXCLUDED.giro, rubro = EXCLUDED.rubro,
        subrubro = EXCLUDED.subrubro,
        categoria_tributaria = EXCLUDED.categoria_tributaria,
        afecta_iva = EXCLUDED.afecta_iva, actividades = EXCLUDED.actividades,
        comuna = EXCLUDED.comuna, region = EXCLUDED.region,
        num_trabajadores = EXCLUDED.num_trabajadores,
        fuente = EXCLUDED.fuente, consultado_en = NOW(), fecha_actualizacion = NOW()
    RETURNING * INTO v_empresa;
    RETURN public.fn_obtener_empresa_cache(v_empresa.rut);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_listar_notificaciones(p_id_usuario BIGINT)
RETURNS JSONB
LANGUAGE sql STABLE
SET search_path = public
AS $$
    SELECT jsonb_build_object(
        'no_leidas', (SELECT COUNT(*) FROM notificacion
            WHERE id_usuario = p_id_usuario AND fecha_leida IS NULL),
        'notificaciones', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id_notificacion', id_notificacion,
                'id_practica', id_practica, 'tipo', tipo,
                'titulo', titulo, 'mensaje', mensaje,
                'fecha_creacion', fecha_creacion, 'fecha_leida', fecha_leida
            ) ORDER BY id_notificacion DESC)
            FROM (
                SELECT id_notificacion, id_practica, tipo, titulo, mensaje,
                       fecha_creacion, fecha_leida
                FROM notificacion WHERE id_usuario = p_id_usuario
                ORDER BY id_notificacion DESC LIMIT 100
            ) n
        ), '[]'::JSONB)
    );
$$;

CREATE OR REPLACE FUNCTION public.fn_marcar_notificacion_leida(
    p_id_usuario BIGINT, p_id_notificacion BIGINT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    UPDATE notificacion SET fecha_leida = COALESCE(fecha_leida, NOW())
    WHERE id_notificacion = p_id_notificacion
      AND id_usuario = p_id_usuario AND fecha_leida IS NULL;
    RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_marcar_todas_notificaciones_leidas(p_id_usuario BIGINT)
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE v_actualizadas INTEGER;
BEGIN
    UPDATE notificacion SET fecha_leida = NOW()
    WHERE id_usuario = p_id_usuario AND fecha_leida IS NULL;
    GET DIAGNOSTICS v_actualizadas = ROW_COUNT;
    RETURN v_actualizadas;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_health_database()
RETURNS JSONB
LANGUAGE sql STABLE
AS $$
    SELECT jsonb_build_object(
        'database', current_database(), 'user', current_user,
        'server_time', NOW()
    );
$$;

-- Estas funciones solo las invoca la API a través de su conexión privada a
-- PostgreSQL. No se exponen como RPC a roles cliente de Supabase.
REVOKE ALL ON FUNCTION public.fn_registrar_usuario_estudiante(JSONB, VARCHAR) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_contexto_usuario(BIGINT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_registrar_practica(BIGINT, JSONB) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_completar_perfil_estudiante(BIGINT, JSONB) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_revisar_practica(BIGINT, BIGINT, VARCHAR, VARCHAR) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_crear_usuario_admin(BIGINT, JSONB, VARCHAR) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_actualizar_usuario_admin(BIGINT, BIGINT, JSONB) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_obtener_empresa_cache(VARCHAR) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_guardar_empresa_cache(JSONB) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_obtener_datos_login(VARCHAR) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_practica_estudiante(BIGINT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_listar_estados_activos() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_listar_practicas_gestion() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_consultar_estado_practica(BIGINT, BIGINT, BOOLEAN) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_consultar_historial_estados(BIGINT, BIGINT, BOOLEAN) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_actualizar_estado_practica(BIGINT, BIGINT, BIGINT, VARCHAR) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_listar_solicitudes_revision() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_obtener_solicitud_revision(BIGINT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_listar_usuarios() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_listar_roles() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_listar_notificaciones(BIGINT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_marcar_notificacion_leida(BIGINT, BIGINT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_marcar_todas_notificaciones_leidas(BIGINT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_health_database() FROM PUBLIC, anon, authenticated, service_role;

