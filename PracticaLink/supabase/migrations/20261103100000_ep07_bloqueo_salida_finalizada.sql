-- EP07 · Corrección 1: una práctica FINALIZADA es terminal para el cambio genérico de estado.
-- Incremental: no modifica 20261102170000_ep07_cierre_asignaciones.sql.
-- Cambio único: nueva comprobación tras bloquear la práctica (FOR UPDATE) y antes de
-- cualquier validación de destino o escritura. Código: PRACTICA_FINALIZADA_NO_MODIFICABLE.
-- Firma y permisos se conservan: CREATE OR REPLACE mantiene el ACL existente.

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

    -- Terminal: ningún destino es válido si la práctica ya está FINALIZADA.
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
