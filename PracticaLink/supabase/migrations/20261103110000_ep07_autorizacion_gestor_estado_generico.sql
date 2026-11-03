-- EP07 · Corrección 2A: autorización por gestor asignado en el cambio genérico de estado.
-- Incremental: no modifica 20261102170000 ni 20261103100000.
-- Orden de validaciones (todas tras SELECT ... FOR UPDATE sobre la práctica):
--   1. existencia de la práctica                    -> PRACTICA_NO_ENCONTRADA
--   2. ADMINISTRADOR activo                          -> permitido (sin restricción por gestor)
--   3. GESTOR activo                                 -> debe ser id_gestor de la práctica
--        id_gestor NULL o de otro usuario            -> GESTOR_NO_ASIGNADO_A_PRACTICA
--   4. sin rol ADMINISTRADOR/GESTOR activo           -> USUARIO_NO_AUTORIZADO
--   5. reglas de estado existentes (FINALIZADA terminal, cierre, inicio, transición)
-- Firma, ACL, search_path y SECURITY DEFINER (ausente en la versión vigente) se conservan.

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
    v_id_gestor BIGINT;
    v_nombre_estado VARCHAR(50);
    v_es_admin BOOLEAN;
    v_es_gestor BOOLEAN;
BEGIN
    SELECT p.id_estado_actual, p.id_estudiante, p.id_gestor
    INTO v_estado_actual, v_id_estudiante, v_id_gestor
    FROM public.practica p
    WHERE p.id_practica = p_id_practica
    FOR UPDATE;
    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('error', 'PRACTICA_NO_ENCONTRADA');
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM public.usuario u
        JOIN public.usuario_rol ur ON ur.id_usuario = u.id_usuario
        JOIN public.rol r ON r.id_rol = ur.id_rol
        WHERE u.id_usuario = p_id_usuario AND u.activo
          AND r.activo AND r.nombre = 'ADMINISTRADOR'
    ) INTO v_es_admin;

    IF NOT v_es_admin THEN
        SELECT EXISTS (
            SELECT 1
            FROM public.usuario u
            JOIN public.usuario_rol ur ON ur.id_usuario = u.id_usuario
            JOIN public.rol r ON r.id_rol = ur.id_rol
            WHERE u.id_usuario = p_id_usuario AND u.activo
              AND r.activo AND r.nombre = 'GESTOR'
        ) INTO v_es_gestor;
        IF NOT v_es_gestor THEN
            RETURN pg_catalog.jsonb_build_object('error', 'USUARIO_NO_AUTORIZADO');
        END IF;
        IF v_id_gestor IS DISTINCT FROM p_id_usuario THEN
            RETURN pg_catalog.jsonb_build_object('error', 'GESTOR_NO_ASIGNADO_A_PRACTICA');
        END IF;
    END IF;

    -- Terminal: ningún destino es válido si la práctica ya está FINALIZADA (Corrección 1).
    IF EXISTS (
        SELECT 1
        FROM public.estado_practica ep
        WHERE ep.id_estado = v_estado_actual
          AND ep.nombre = 'FINALIZADA'
    ) THEN
        RETURN pg_catalog.jsonb_build_object('error', 'PRACTICA_FINALIZADA_NO_MODIFICABLE');
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
