CREATE OR REPLACE FUNCTION public.fn_listar_estudiantes_sin_practica()
RETURNS JSONB
LANGUAGE sql STABLE
SET search_path = public
AS $$
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id_usuario', q.id_usuario,
        'nombre', q.nombre,
        'apellido', q.apellido
    ) ORDER BY q.apellido, q.nombre), '[]'::JSONB)
    FROM (
        SELECT DISTINCT u.id_usuario, u.nombre, u.apellido
        FROM usuario u
        JOIN usuario_rol ur ON ur.id_usuario = u.id_usuario
        JOIN rol r ON r.id_rol = ur.id_rol
        WHERE u.activo
          AND r.activo
          AND r.nombre = 'ESTUDIANTE'
          AND NOT EXISTS (
              SELECT 1
              FROM estudiante e
              JOIN practica p ON p.id_estudiante = e.id_estudiante
              WHERE e.id_usuario = u.id_usuario
          )
    ) q;
$$;

REVOKE ALL ON FUNCTION public.fn_listar_estudiantes_sin_practica()
    FROM PUBLIC, anon, authenticated, service_role;
