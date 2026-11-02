ALTER TABLE public.practica
    ADD COLUMN IF NOT EXISTS id_gestor BIGINT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_constraint
        WHERE conname = 'fk_practica_gestor'
          AND conrelid = 'public.practica'::pg_catalog.regclass
    ) THEN
        ALTER TABLE public.practica
            ADD CONSTRAINT fk_practica_gestor
            FOREIGN KEY (id_gestor)
            REFERENCES public.usuario (id_usuario) ON DELETE RESTRICT;
    END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_practica_gestor_activo
    ON public.practica (id_gestor, id_estado_actual)
    WHERE id_gestor IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.recordatorio_cierre_practica (
    id_practica BIGINT PRIMARY KEY
        REFERENCES public.practica (id_practica) ON DELETE CASCADE,
    fecha_recordatorio TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.recordatorio_cierre_practica ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.recordatorio_cierre_practica
    FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_ep07_exigir_cierre_registrado()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF NEW.id_estado_actual IS DISTINCT FROM OLD.id_estado_actual
       AND EXISTS (
           SELECT 1
           FROM public.estado_practica ep
           WHERE ep.id_estado = NEW.id_estado_actual
             AND ep.nombre = 'FINALIZADA'
       )
       AND NOT EXISTS (
           SELECT 1
           FROM public.cierre_practica c
           WHERE c.id_practica = NEW.id_practica
       ) THEN
        RAISE EXCEPTION 'EP07_CIERRE_REQUERIDO'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ep07_exigir_cierre_registrado
    ON public.practica;
CREATE TRIGGER trg_ep07_exigir_cierre_registrado
    BEFORE UPDATE OF id_estado_actual ON public.practica
    FOR EACH ROW EXECUTE FUNCTION public.fn_ep07_exigir_cierre_registrado();

CREATE OR REPLACE FUNCTION public.fn_actualizar_estado_practica(
    p_id_practica BIGINT,
    p_id_usuario BIGINT,
    p_id_estado BIGINT,
    p_observacion VARCHAR
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_estado_actual BIGINT;
    v_id_estudiante BIGINT;
    v_nombre_estado VARCHAR(50);
BEGIN
    SELECT p.id_estado_actual, p.id_estudiante
    INTO v_estado_actual, v_id_estudiante
    FROM public.practica p
    WHERE p.id_practica = p_id_practica
    FOR UPDATE;
    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('error', 'PRACTICA_NO_ENCONTRADA');
    END IF;

    SELECT ep.nombre
    INTO v_nombre_estado
    FROM public.estado_practica ep
    WHERE ep.id_estado = p_id_estado AND ep.activo;
    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('error', 'ESTADO_NO_DISPONIBLE');
    END IF;
    IF v_nombre_estado = 'FINALIZADA' THEN
        RETURN pg_catalog.jsonb_build_object('error', 'CIERRE_MANUAL_REQUERIDO');
    END IF;
    IF v_nombre_estado = 'EN_CURSO' THEN
        RETURN pg_catalog.jsonb_build_object('error', 'INICIO_RESTRINGIDO_REQUERIDO');
    END IF;

    IF v_estado_actual <> p_id_estado THEN
        UPDATE public.practica
        SET id_estado_actual = p_id_estado,
            fecha_actualizacion = pg_catalog.clock_timestamp()
        WHERE id_practica = p_id_practica;
        INSERT INTO public.historial_estado (
            id_practica, id_estado, id_usuario, observacion
        ) VALUES (
            p_id_practica, p_id_estado, p_id_usuario, p_observacion
        );
        INSERT INTO public.notificacion (
            id_usuario, id_practica, tipo, titulo, mensaje
        )
        SELECT e.id_usuario, p_id_practica, 'CAMBIO_ESTADO',
            'Estado de práctica actualizado',
            pg_catalog.concat('Tu práctica cambió al estado ', v_nombre_estado, '.')
        FROM public.estudiante e
        WHERE e.id_estudiante = v_id_estudiante;
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'id_practica', p_id_practica,
        'id_estado', p_id_estado,
        'estado', v_nombre_estado,
        'mensaje', CASE WHEN v_estado_actual <> p_id_estado
            THEN 'Estado actualizado y registrado en el historial'
            ELSE 'La práctica ya se encuentra en ese estado' END
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_listar_gestores_activos(p_id_admin BIGINT)
RETURNS JSONB
LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.usuario u
        JOIN public.usuario_rol ur ON ur.id_usuario = u.id_usuario
        JOIN public.rol r ON r.id_rol = ur.id_rol
        WHERE u.id_usuario = p_id_admin
          AND u.activo
          AND r.activo
          AND r.nombre = 'ADMINISTRADOR'
    ) THEN
        RETURN pg_catalog.jsonb_build_object('error', 'USUARIO_NO_AUTORIZADO');
    END IF;

    RETURN COALESCE((
        SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'id_usuario', q.id_usuario,
            'nombre', q.nombre,
            'correo', q.correo
        ) ORDER BY q.nombre, q.id_usuario)
        FROM (
            SELECT DISTINCT u.id_usuario,
                pg_catalog.concat(u.nombre, ' ', u.apellido) AS nombre,
                u.correo
            FROM public.usuario u
            JOIN public.usuario_rol ur ON ur.id_usuario = u.id_usuario
            JOIN public.rol r ON r.id_rol = ur.id_rol
            WHERE u.activo AND r.activo AND r.nombre = 'GESTOR'
        ) q
    ), '[]'::JSONB);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_asignar_gestor_practica(
    p_id_practica BIGINT,
    p_id_admin BIGINT,
    p_id_gestor BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_estado VARCHAR(50);
    v_nombre_gestor TEXT;
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.usuario u
        JOIN public.usuario_rol ur ON ur.id_usuario = u.id_usuario
        JOIN public.rol r ON r.id_rol = ur.id_rol
        WHERE u.id_usuario = p_id_admin AND u.activo
          AND r.activo AND r.nombre = 'ADMINISTRADOR'
    ) THEN
        RETURN pg_catalog.jsonb_build_object('error', 'USUARIO_NO_AUTORIZADO');
    END IF;

    IF p_id_gestor IS NOT NULL THEN
        SELECT pg_catalog.concat(u.nombre, ' ', u.apellido)
        INTO v_nombre_gestor
        FROM public.usuario u
        JOIN public.usuario_rol ur ON ur.id_usuario = u.id_usuario
        JOIN public.rol r ON r.id_rol = ur.id_rol
        WHERE u.id_usuario = p_id_gestor AND u.activo
          AND r.activo AND r.nombre = 'GESTOR'
        FOR UPDATE OF u;
        IF NOT FOUND THEN
            RETURN pg_catalog.jsonb_build_object('error', 'GESTOR_NO_DISPONIBLE');
        END IF;
    END IF;

    SELECT ep.nombre
    INTO v_estado
    FROM public.practica p
    JOIN public.estado_practica ep ON ep.id_estado = p.id_estado_actual
    WHERE p.id_practica = p_id_practica
    FOR UPDATE OF p;
    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('error', 'PRACTICA_NO_ENCONTRADA');
    END IF;

    IF v_estado IN ('FINALIZADA', 'RECHAZADA') THEN
        RETURN pg_catalog.jsonb_build_object('error', 'PRACTICA_FINALIZADA');
    END IF;

    UPDATE public.practica
    SET id_gestor = p_id_gestor, fecha_actualizacion = pg_catalog.clock_timestamp()
    WHERE id_practica = p_id_practica;

    RETURN pg_catalog.jsonb_build_object(
        'id_practica', p_id_practica,
        'id_gestor', p_id_gestor,
        'gestor', v_nombre_gestor,
        'mensaje', CASE WHEN p_id_gestor IS NULL
            THEN 'Asignación retirada'
            ELSE 'Gestor asignado correctamente' END
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_listar_practicas_gestion_usuario(
    p_id_gestor BIGINT
)
RETURNS JSONB
LANGUAGE sql STABLE
SET search_path = pg_catalog, public
AS $$
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM public.usuario u
        JOIN public.usuario_rol ur ON ur.id_usuario = u.id_usuario
        JOIN public.rol r ON r.id_rol = ur.id_rol
        WHERE u.id_usuario = p_id_gestor AND u.activo
          AND r.activo AND r.nombre = 'GESTOR'
    ) THEN pg_catalog.jsonb_build_object('error', 'USUARIO_NO_AUTORIZADO')
    ELSE COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id_practica', p.id_practica,
        'fecha_registro', p.fecha_registro,
        'fecha_actualizacion', p.fecha_actualizacion,
        'id_estado', ep.id_estado,
        'estado', ep.nombre,
        'descripcion_estado', ep.descripcion,
        'es_final', ep.es_final,
        'estudiante', pg_catalog.concat(u.nombre, ' ', u.apellido),
        'rut_estudiante', e.rut,
        'centro_practica', cp.nombre,
        'fecha_inicio', p.fecha_inicio,
        'fecha_termino', p.fecha_termino,
        'id_gestor', p.id_gestor,
        'gestor', pg_catalog.concat(g.nombre, ' ', g.apellido),
        'horas_semanales', p.horas_semanales
    ) ORDER BY p.fecha_actualizacion DESC, p.id_practica DESC), '[]'::JSONB)
    END
    FROM public.practica p
    JOIN public.estudiante e ON e.id_estudiante = p.id_estudiante
    JOIN public.usuario u ON u.id_usuario = e.id_usuario
    JOIN public.centro_practica cp ON cp.id_centro = p.id_centro
    JOIN public.estado_practica ep ON ep.id_estado = p.id_estado_actual
    LEFT JOIN public.usuario g ON g.id_usuario = p.id_gestor
    WHERE p.id_gestor = p_id_gestor;
$$;

CREATE OR REPLACE FUNCTION public.fn_listar_practicas_gestion()
RETURNS JSONB
LANGUAGE sql STABLE
SET search_path = pg_catalog, public
AS $$
    SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id_practica', p.id_practica,
        'fecha_registro', p.fecha_registro,
        'fecha_actualizacion', p.fecha_actualizacion,
        'id_estado', ep.id_estado,
        'estado', ep.nombre,
        'descripcion_estado', ep.descripcion,
        'es_final', ep.es_final,
        'estudiante', pg_catalog.concat(u.nombre, ' ', u.apellido),
        'rut_estudiante', e.rut,
        'centro_practica', cp.nombre,
        'fecha_inicio', p.fecha_inicio,
        'fecha_termino', p.fecha_termino,
        'id_gestor', p.id_gestor,
        'gestor', pg_catalog.concat(g.nombre, ' ', g.apellido),
        'horas_semanales', p.horas_semanales
    ) ORDER BY p.fecha_actualizacion DESC, p.id_practica DESC), '[]'::JSONB)
    FROM public.practica p
    JOIN public.estudiante e ON e.id_estudiante = p.id_estudiante
    JOIN public.usuario u ON u.id_usuario = e.id_usuario
    JOIN public.centro_practica cp ON cp.id_centro = p.id_centro
    JOIN public.estado_practica ep ON ep.id_estado = p.id_estado_actual
    LEFT JOIN public.usuario g ON g.id_usuario = p.id_gestor;
$$;

CREATE OR REPLACE FUNCTION public.fn_cerrar_practica(
    p_id_practica BIGINT,
    p_id_usuario BIGINT,
    p_observacion TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_estado VARCHAR(50);
    v_id_gestor BIGINT;
    v_fecha_termino DATE;
    v_id_estudiante BIGINT;
    v_id_estado_final BIGINT;
    v_fecha_cambio TIMESTAMPTZ;
    v_id_historial BIGINT;
    v_id_notificacion BIGINT;
    v_es_admin BOOLEAN;
    v_id_cierre BIGINT;
BEGIN
    SELECT EXISTS (
        SELECT 1
        FROM public.usuario u
        JOIN public.usuario_rol ur ON ur.id_usuario = u.id_usuario
        JOIN public.rol r ON r.id_rol = ur.id_rol
        WHERE u.id_usuario = p_id_usuario AND u.activo
          AND r.activo AND r.nombre = 'ADMINISTRADOR'
    ) INTO v_es_admin;

    SELECT ep.nombre, p.id_gestor, p.fecha_termino, e.id_usuario
    INTO v_estado, v_id_gestor, v_fecha_termino, v_id_estudiante
    FROM public.practica p
    JOIN public.estado_practica ep ON ep.id_estado = p.id_estado_actual
    JOIN public.estudiante e ON e.id_estudiante = p.id_estudiante
    WHERE p.id_practica = p_id_practica
    FOR UPDATE OF p;

    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('error', 'PRACTICA_NO_ENCONTRADA');
    END IF;

    IF NOT v_es_admin AND (
        v_id_gestor IS DISTINCT FROM p_id_usuario
        OR NOT EXISTS (
            SELECT 1
            FROM public.usuario u
            JOIN public.usuario_rol ur ON ur.id_usuario = u.id_usuario
            JOIN public.rol r ON r.id_rol = ur.id_rol
            WHERE u.id_usuario = p_id_usuario AND u.activo
              AND r.activo AND r.nombre = 'GESTOR'
        )
    ) THEN
        RETURN pg_catalog.jsonb_build_object('error', 'USUARIO_NO_AUTORIZADO');
    END IF;

    IF v_estado <> 'EN_CURSO' OR v_fecha_termino IS NULL
       OR v_fecha_termino > CURRENT_DATE THEN
        RETURN pg_catalog.jsonb_build_object('error', 'PRACTICA_NO_CERRABLE');
    END IF;

    SELECT id_estado INTO v_id_estado_final
    FROM public.estado_practica
    WHERE nombre = 'FINALIZADA' AND activo AND es_final
    FOR SHARE;
    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('error', 'ESTADO_FINAL_NO_DISPONIBLE');
    END IF;

    v_fecha_cambio := pg_catalog.clock_timestamp();

    INSERT INTO public.cierre_practica (
        id_practica, id_usuario, fecha_cierre, resultado, observacion
    ) VALUES (
        p_id_practica, p_id_usuario, v_fecha_cambio, 'APROBADA',
        NULLIF(pg_catalog.btrim(p_observacion), '')
    )
    RETURNING id_cierre INTO v_id_cierre;

    UPDATE public.practica
    SET id_estado_actual = v_id_estado_final,
        fecha_actualizacion = v_fecha_cambio
    WHERE id_practica = p_id_practica;

    INSERT INTO public.historial_estado (
        id_practica, id_estado, id_usuario, fecha_cambio, observacion
    ) VALUES (
        p_id_practica, v_id_estado_final, p_id_usuario, v_fecha_cambio,
        NULLIF(pg_catalog.btrim(p_observacion), '')
    )
    RETURNING id_historial INTO v_id_historial;

    INSERT INTO public.notificacion (
        id_usuario, id_practica, tipo, titulo, mensaje
    ) VALUES (
        v_id_estudiante, p_id_practica, 'PRACTICA_FINALIZADA',
        'Práctica finalizada', 'Tu práctica profesional fue finalizada.'
    )
    RETURNING id_notificacion INTO v_id_notificacion;

    RETURN pg_catalog.jsonb_build_object(
        'id_practica', p_id_practica,
        'id_cierre', v_id_cierre,
        'id_historial', v_id_historial,
        'id_notificacion', v_id_notificacion,
        'id_usuario_notificado', v_id_estudiante,
        'estado', 'FINALIZADA',
        'fecha_cierre', v_fecha_cambio,
        'mensaje', 'La práctica se finalizó correctamente'
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_procesar_recordatorios_cierre()
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_id_practica BIGINT;
    v_notificaciones JSONB := '[]'::JSONB;
    v_actuales JSONB;
BEGIN
    FOR v_id_practica IN
        INSERT INTO public.recordatorio_cierre_practica (id_practica)
        SELECT p.id_practica
        FROM public.practica p
        JOIN public.estado_practica ep ON ep.id_estado = p.id_estado_actual
        WHERE ep.nombre = 'EN_CURSO'
          AND p.fecha_termino IS NOT NULL
          AND (p.fecha_termino::TIMESTAMP + INTERVAL '1 day') <= pg_catalog.clock_timestamp()
          AND p.id_gestor IS NOT NULL
        ON CONFLICT (id_practica) DO NOTHING
        RETURNING id_practica
    LOOP
        WITH destinatarios AS (
            SELECT p.id_gestor AS id_usuario
            FROM public.practica p
            JOIN public.usuario u ON u.id_usuario = p.id_gestor AND u.activo
            WHERE p.id_practica = v_id_practica
            UNION
            SELECT ur.id_usuario
            FROM public.usuario_rol ur
            JOIN public.rol r ON r.id_rol = ur.id_rol
            JOIN public.usuario u ON u.id_usuario = ur.id_usuario
            WHERE r.nombre = 'ADMINISTRADOR' AND r.activo AND u.activo
        ), insertadas AS (
            INSERT INTO public.notificacion (
                id_usuario, id_practica, tipo, titulo, mensaje
            )
            SELECT d.id_usuario, v_id_practica,
                   'CIERRE_PRACTICA_PENDIENTE',
                   'Revisar cierre de práctica',
                   'La fecha de término fue alcanzada hace 24 horas. Revisa la práctica antes de finalizarla.'
            FROM destinatarios d
            WHERE d.id_usuario IS NOT NULL
            RETURNING id_notificacion, id_usuario
        )
        SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'id_notificacion', i.id_notificacion,
            'id_usuario', i.id_usuario,
            'id_practica', v_id_practica
        )), '[]'::JSONB)
        INTO v_actuales
        FROM insertadas i;

        v_notificaciones := v_notificaciones || v_actuales;
    END LOOP;

    RETURN v_notificaciones;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_listar_gestores_activos(BIGINT)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_asignar_gestor_practica(BIGINT, BIGINT, BIGINT)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_listar_practicas_gestion_usuario(BIGINT)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_cerrar_practica(BIGINT, BIGINT, TEXT)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_ep07_exigir_cierre_registrado()
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_procesar_recordatorios_cierre()
    FROM PUBLIC, anon, authenticated, service_role;
