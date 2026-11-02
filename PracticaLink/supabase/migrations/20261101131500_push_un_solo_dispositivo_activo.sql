WITH dispositivos_ordenados AS (
    SELECT
        id_dispositivo,
        ROW_NUMBER() OVER (
            PARTITION BY id_usuario
            ORDER BY fecha_actualizacion DESC, id_dispositivo DESC
        ) AS posicion
    FROM public.dispositivo_push
    WHERE activo
)
UPDATE public.dispositivo_push AS dispositivo
SET activo = FALSE, fecha_actualizacion = NOW()
FROM dispositivos_ordenados AS orden
WHERE dispositivo.id_dispositivo = orden.id_dispositivo
  AND orden.posicion > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_dispositivo_push_un_activo_por_usuario
    ON public.dispositivo_push (id_usuario)
    WHERE activo;

CREATE OR REPLACE FUNCTION public.fn_registrar_dispositivo_push(
    p_id_usuario BIGINT, p_token TEXT, p_plataforma VARCHAR
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    PERFORM 1
    FROM public.usuario
    WHERE id_usuario = p_id_usuario
    FOR UPDATE;

    UPDATE public.dispositivo_push
    SET activo = FALSE, fecha_actualizacion = NOW()
    WHERE id_usuario = p_id_usuario
      AND activo
      AND token <> p_token;

    INSERT INTO public.dispositivo_push (
        id_usuario, token, plataforma, activo, fecha_actualizacion
    )
    VALUES (p_id_usuario, p_token, p_plataforma, TRUE, NOW())
    ON CONFLICT (token) DO UPDATE SET
        id_usuario = EXCLUDED.id_usuario,
        plataforma = EXCLUDED.plataforma,
        activo = TRUE,
        fecha_actualizacion = NOW();
END;
$$;

REVOKE ALL ON FUNCTION public.fn_registrar_dispositivo_push(BIGINT, TEXT, VARCHAR) FROM PUBLIC;
