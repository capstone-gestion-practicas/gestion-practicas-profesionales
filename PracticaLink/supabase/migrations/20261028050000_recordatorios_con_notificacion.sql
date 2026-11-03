ALTER TABLE public.notificacion
    ALTER COLUMN id_practica DROP NOT NULL;

CREATE TABLE IF NOT EXISTS public.recordatorio_estudiante (
    id_usuario BIGINT NOT NULL
        REFERENCES public.usuario (id_usuario) ON DELETE CASCADE,
    fecha DATE NOT NULL DEFAULT CURRENT_DATE,
    fecha_envio TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id_usuario, fecha)
);

ALTER TABLE public.recordatorio_estudiante ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.recordatorio_estudiante
    FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_listar_estudiantes_sin_practica()
RETURNS JSONB
LANGUAGE sql STABLE
SET search_path = public
AS $$
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id_usuario', q.id_usuario,
        'nombre', q.nombre,
        'apellido', q.apellido,
        'recordatorio_enviado_hoy', q.recordatorio_enviado_hoy
    ) ORDER BY q.recordatorio_enviado_hoy, q.apellido, q.nombre), '[]'::JSONB)
    FROM (
        SELECT DISTINCT
            u.id_usuario,
            u.nombre,
            u.apellido,
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
          AND NOT EXISTS (
              SELECT 1
              FROM public.estudiante e
              JOIN public.practica p ON p.id_estudiante = e.id_estudiante
              WHERE e.id_usuario = u.id_usuario
          )
    ) q;
$$;

REVOKE ALL ON FUNCTION public.fn_listar_estudiantes_sin_practica()
    FROM PUBLIC, anon, authenticated, service_role;
