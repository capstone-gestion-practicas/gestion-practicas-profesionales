-- EP07 · Corrección 6A: recordatorios de cierre para prácticas sin gestor asignado.
-- Incremental: no modifica 20261102170000 ni migraciones anteriores.
-- Política:
--   - Candidatas: EN_CURSO y recordatorio habilitado desde las 00:00 de America/Santiago del día
--     siguiente a fecha_termino (fecha de calendario). Independiente de la zona horaria de la sesión.
--   - Destinatarios: gestor asignado SOLO si está activo y tiene rol GESTOR activo;
--     administradores activos SIEMPRE (también si la práctica no tiene gestor).
--   - Idempotencia en PostgreSQL: la PK de recordatorio_cierre_practica reclama la práctica
--     dentro de la transacción. Si no hay ningún destinatario, el reclamo se libera para que
--     una ejecución posterior entregue el recordatorio cuando exista un destinatario.
-- Firma, modelo de seguridad (INVOKER), search_path y ACL se conservan.

-- Regla temporal explícita: fecha_termino es fecha de calendario; el recordatorio se habilita a las
-- 00:00 de America/Santiago del día siguiente. No depende de TimeZone de sesión ni del servidor.
CREATE OR REPLACE FUNCTION public.fn_ep07_recordatorio_habilitado(
    p_fecha_termino DATE,
    p_instante TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
    SELECT (((p_fecha_termino + 1)::TIMESTAMP) AT TIME ZONE 'America/Santiago') <= p_instante;
$$;

REVOKE ALL ON FUNCTION public.fn_ep07_recordatorio_habilitado(DATE, TIMESTAMPTZ)
    FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_procesar_recordatorios_cierre()
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_id_practica BIGINT;
    v_reclamada BIGINT;
    v_notificaciones JSONB := '[]'::JSONB;
    v_actuales JSONB;
BEGIN
    FOR v_id_practica IN
        SELECT p.id_practica
        FROM public.practica p
        JOIN public.estado_practica ep ON ep.id_estado = p.id_estado_actual
        WHERE ep.nombre = 'EN_CURSO'
          AND p.fecha_termino IS NOT NULL
          AND public.fn_ep07_recordatorio_habilitado(p.fecha_termino, pg_catalog.clock_timestamp())
        ORDER BY p.id_practica
    LOOP
        -- Reclamo idempotente: la PK impide un segundo registro para la misma práctica.
        INSERT INTO public.recordatorio_cierre_practica (id_practica)
        VALUES (v_id_practica)
        ON CONFLICT (id_practica) DO NOTHING
        RETURNING id_practica INTO v_reclamada;
        IF v_reclamada IS NULL THEN
            CONTINUE;
        END IF;

        WITH destinatarios AS (
            SELECT p.id_gestor AS id_usuario
            FROM public.practica p
            JOIN public.usuario u ON u.id_usuario = p.id_gestor AND u.activo
            WHERE p.id_practica = v_id_practica
              AND EXISTS (
                  SELECT 1
                  FROM public.usuario_rol ur
                  JOIN public.rol r ON r.id_rol = ur.id_rol
                  WHERE ur.id_usuario = p.id_gestor
                    AND r.nombre = 'GESTOR' AND r.activo
              )
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

        IF pg_catalog.jsonb_array_length(v_actuales) = 0 THEN
            -- Sin destinatarios: no consumir el recordatorio; se reintenta en una ejecución posterior.
            DELETE FROM public.recordatorio_cierre_practica
            WHERE id_practica = v_id_practica;
        END IF;

        v_notificaciones := v_notificaciones || v_actuales;
    END LOOP;

    RETURN v_notificaciones;
END;
$$;
