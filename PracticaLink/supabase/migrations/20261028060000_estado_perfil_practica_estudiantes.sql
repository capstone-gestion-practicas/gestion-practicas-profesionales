CREATE OR REPLACE FUNCTION public.fn_listar_estudiantes_sin_practica()
RETURNS JSONB
LANGUAGE sql STABLE
SET search_path = public
AS $$
    WITH estudiantes AS (
        SELECT DISTINCT
            u.id_usuario,
            u.nombre,
            u.apellido,
            EXISTS (
                SELECT 1
                FROM public.estudiante e
                WHERE e.id_usuario = u.id_usuario
            ) AS tiene_perfil,
            EXISTS (
                SELECT 1
                FROM public.estudiante e
                JOIN public.practica p ON p.id_estudiante = e.id_estudiante
                WHERE e.id_usuario = u.id_usuario
            ) AS tiene_practica,
            EXISTS (
                SELECT 1
                FROM public.recordatorio_estudiante re
                WHERE re.id_usuario = u.id_usuario
                  AND re.fecha = CURRENT_DATE
            ) AS recordatorio_enviado_hoy
        FROM public.usuario u
        JOIN public.usuario_rol ur ON ur.id_usuario = u.id_usuario
        JOIN public.rol r ON r.id_rol = ur.id_rol
        WHERE u.activo
          AND r.activo
          AND r.nombre = 'ESTUDIANTE'
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id_usuario', q.id_usuario,
        'nombre', q.nombre,
        'apellido', q.apellido,
        'tiene_perfil', q.tiene_perfil,
        'tiene_practica', q.tiene_practica,
        'recordatorio_enviado_hoy', q.recordatorio_enviado_hoy
    ) ORDER BY q.recordatorio_enviado_hoy, q.apellido, q.nombre), '[]'::JSONB)
    FROM estudiantes q
    WHERE NOT q.tiene_perfil OR NOT q.tiene_practica;
$$;

REVOKE ALL ON FUNCTION public.fn_listar_estudiantes_sin_practica()
    FROM PUBLIC, anon, authenticated, service_role;
