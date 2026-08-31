-- Fix release-1.1: instala la función requerida por POST /estudiantes/perfil.
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
        SELECT 1
        FROM public.usuario u
        JOIN public.usuario_rol ur ON ur.id_usuario = u.id_usuario
        JOIN public.rol r ON r.id_rol = ur.id_rol
        WHERE u.id_usuario = p_id_usuario
          AND u.activo = TRUE
          AND r.nombre = 'ESTUDIANTE'
          AND r.activo = TRUE
    ) THEN
        RETURN jsonb_build_object(
            'error', 'USUARIO_ESTUDIANTE_NO_VALIDO'
        );
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.estudiante e
        WHERE e.id_usuario = p_id_usuario
    ) THEN
        RETURN jsonb_build_object('error', 'PERFIL_EXISTENTE');
    END IF;

    v_rut := BTRIM(p_datos ->> 'rut');

    IF EXISTS (
        SELECT 1
        FROM public.estudiante e
        WHERE UPPER(e.rut) = UPPER(v_rut)
    ) THEN
        RETURN jsonb_build_object('error', 'RUT_EXISTENTE');
    END IF;

    INSERT INTO public.estudiante (
        id_usuario,
        rut,
        carrera,
        sede,
        telefono,
        direccion
    ) VALUES (
        p_id_usuario,
        v_rut,
        BTRIM(p_datos ->> 'carrera'),
        BTRIM(p_datos ->> 'sede'),
        NULLIF(BTRIM(p_datos ->> 'telefono'), ''),
        NULLIF(BTRIM(p_datos ->> 'direccion'), '')
    )
    RETURNING id_estudiante INTO v_id_estudiante;

    RETURN jsonb_build_object(
        'id_estudiante', v_id_estudiante,
        'mensaje', 'Perfil de estudiante completado correctamente'
    );
END;
$$;

-- Verificación de instalación y firma esperada por el backend.
SELECT
    n.nspname AS esquema,
    p.proname AS funcion,
    pg_get_function_identity_arguments(p.oid) AS argumentos
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'fn_completar_perfil_estudiante';
