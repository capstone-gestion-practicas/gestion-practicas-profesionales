-- S4.1: validación sintética transaccional. Ejecutar en PostgreSQL local desechable
-- con esquema base y migración S4.1 aplicados; no usar Supabase compartido.
-- psql -X -v ON_ERROR_STOP=1 -d <base_sintetica> -f s41_asignacion_docente.sql
-- La prueba revierte sus filas; los avances de secuencias no se revierten. Incluye la defensa CHECK frente a conflicto de
-- identidad; concurrencia real de dos sesiones queda pendiente de ejecución local.
BEGIN;

-- Fallar explícitamente si el catálogo sintético previo está incompleto.
DO $$ BEGIN
  IF (SELECT count(*) FROM public.rol
      WHERE nombre IN ('GESTOR','DOCENTE','ADMINISTRADOR','ESTUDIANTE') AND activo) <> 4 THEN
    RAISE EXCEPTION 'faltan roles activos requeridos por el fixture';
  END IF;
  IF (SELECT count(*) FROM public.estado_practica
      WHERE nombre IN ('APROBADA','EN_CURSO','REGISTRADA') AND activo) <> 3 THEN
    RAISE EXCEPTION 'faltan estados activos requeridos por el fixture';
  END IF;
END $$;

INSERT INTO public.usuario(id_usuario,nombre,apellido,correo,password_hash) VALUES
 (970,'Gestor','S41A','s41-gestor-a@example.invalid','synthetic'),
 (971,'Gestor','S41B','s41-gestor-b@example.invalid','synthetic'),
 (972,'Docente','S41A','s41-docente-a@example.invalid','synthetic'),
 (973,'Administrador','S41','s41-admin@example.invalid','synthetic'),
 (974,'Estudiante','S41','s41-estudiante@example.invalid','synthetic'),
 (975,'Docente','S41B','s41-docente-b@example.invalid','synthetic'),
 (976,'Docente','S41Inactivo','s41-docente-inactivo@example.invalid','synthetic');
INSERT INTO public.usuario_rol SELECT 970,id_rol FROM public.rol WHERE nombre='GESTOR';
INSERT INTO public.usuario_rol SELECT 971,id_rol FROM public.rol WHERE nombre='GESTOR';
INSERT INTO public.usuario_rol SELECT 972,id_rol FROM public.rol WHERE nombre='DOCENTE';
INSERT INTO public.usuario_rol SELECT 973,id_rol FROM public.rol WHERE nombre='ADMINISTRADOR';
INSERT INTO public.usuario_rol SELECT 974,id_rol FROM public.rol WHERE nombre='ESTUDIANTE';
INSERT INTO public.usuario_rol SELECT 975,id_rol FROM public.rol WHERE nombre='DOCENTE';
INSERT INTO public.usuario_rol SELECT 976,id_rol FROM public.rol WHERE nombre='DOCENTE';
INSERT INTO public.usuario_rol SELECT 970,id_rol FROM public.rol WHERE nombre='DOCENTE';
UPDATE public.usuario SET activo=FALSE WHERE id_usuario=976;
INSERT INTO public.estudiante(id_estudiante,id_usuario,rut,carrera,sede)
 VALUES (970,974,'12345678-5','Carrera sintética','Alameda');
INSERT INTO public.centro_practica(id_centro,nombre) VALUES (970,'Centro sintético S4.1');
INSERT INTO public.practica(id_practica,id_estudiante,id_centro,id_estado_actual,id_gestor)
 SELECT 9700,970,970,id_estado,970 FROM public.estado_practica WHERE nombre='APROBADA';
INSERT INTO public.practica(id_practica,id_estudiante,id_centro,id_estado_actual,id_gestor)
 SELECT 9701,970,970,id_estado,970 FROM public.estado_practica WHERE nombre='EN_CURSO';
INSERT INTO public.practica(id_practica,id_estudiante,id_centro,id_estado_actual,id_gestor)
 SELECT 9702,970,970,id_estado,970 FROM public.estado_practica WHERE nombre='REGISTRADA';

DO $$ DECLARE r JSONB; BEGIN
  IF (SELECT count(*) FROM public.practica WHERE id_practica IN (9700,9701,9702) AND id_docente IS NULL) <> 3 THEN
    RAISE EXCEPTION 'fixtures de práctica incompletos o incompatibles';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.rol WHERE nombre='DOCENTE' AND activo) THEN RAISE EXCEPTION 'DOCENTE no activo'; END IF;
  r := docente_privado.fn_gestionar_asignacion(9701,970,972,NULL);
  IF r IS NULL OR r ? 'error' OR (SELECT id_docente FROM public.practica WHERE id_practica=9701) IS DISTINCT FROM 972 THEN RAISE EXCEPTION 'asignación durante EN_CURSO fallida: %',r; END IF;
  r := docente_privado.fn_gestionar_asignacion(9700,970,972,NULL);
  IF r IS NULL OR r ? 'error' OR (SELECT id_docente FROM public.practica WHERE id_practica=9700) IS DISTINCT FROM 972 THEN RAISE EXCEPTION 'asignación inicial fallida: %',r; END IF;
  IF (SELECT count(*) FROM public.historial_asignacion_docente WHERE id_practica=9700) <> 1 THEN RAISE EXCEPTION 'no se registró historia inicial'; END IF;
  r := docente_privado.fn_gestionar_asignacion(9700,970,975,NULL);
  IF r->>'error' IS DISTINCT FROM 'MOTIVO_OBLIGATORIO' THEN RAISE EXCEPTION 'reemplazo sin motivo permitido: %',r; END IF;
  r := docente_privado.fn_gestionar_asignacion(9700,970,975,'reemplazo sintético');
  IF r IS NULL OR r ? 'error' OR (SELECT count(*) FROM public.historial_asignacion_docente WHERE id_practica=9700 AND id_docente_anterior=972 AND id_docente_nuevo=975 AND id_actor=970 AND motivo='reemplazo sintético') <> 1 THEN RAISE EXCEPTION 'reemplazo/historial incorrecto: %',r; END IF;
  r := docente_privado.fn_gestionar_asignacion(9700,970,NULL,NULL);
  IF r->>'error' IS DISTINCT FROM 'MOTIVO_OBLIGATORIO' THEN RAISE EXCEPTION 'retiro sin motivo permitido: %',r; END IF;
  r := docente_privado.fn_gestionar_asignacion(9700,970,NULL,'retiro sintético');
  IF r IS NULL OR r ? 'error' OR (SELECT id_docente FROM public.practica WHERE id_practica=9700) IS NOT NULL THEN RAISE EXCEPTION 'retiro fallido: %',r; END IF;
  r := docente_privado.fn_gestionar_asignacion(9700,971,972,NULL);
  IF r->>'error' IS DISTINCT FROM 'GESTOR_NO_RESPONSABLE' THEN RAISE EXCEPTION 'gestor ajeno autorizado: %',r; END IF;
  r := docente_privado.fn_gestionar_asignacion(9700,973,972,NULL);
  IF r->>'error' IS DISTINCT FROM 'USUARIO_NO_AUTORIZADO' THEN RAISE EXCEPTION 'administrador autorizado: %',r; END IF;
  r := docente_privado.fn_gestionar_asignacion(9702,970,972,NULL);
  IF r->>'error' IS DISTINCT FROM 'ESTADO_NO_PERMITIDO' THEN RAISE EXCEPTION 'estado pendiente permitió asignación: %',r; END IF;
  r := docente_privado.fn_gestionar_asignacion(9700,970,976,NULL);
  IF r->>'error' IS DISTINCT FROM 'DOCENTE_NO_VALIDO' THEN RAISE EXCEPTION 'docente inactivo asignable: %',r; END IF;
  r := docente_privado.fn_gestionar_asignacion(9700,970,970,NULL);
  IF r->>'error' IS DISTINCT FROM 'DOCENTE_IGUAL_GESTOR' THEN RAISE EXCEPTION 'cuenta GESTOR+DOCENTE permitió compartir identidad: %',r; END IF;
  r := docente_privado.fn_listar_practicas_asignadas(976);
  IF r->>'error' IS DISTINCT FROM 'USUARIO_NO_AUTORIZADO' THEN RAISE EXCEPTION 'docente inactivo consultó prácticas: %',r; END IF;
  BEGIN
    UPDATE public.practica SET id_gestor=972 WHERE id_practica=9701;
    RAISE EXCEPTION 'constraint permitió conflicto gestor/docente';
  EXCEPTION WHEN check_violation THEN NULL; END;
  r := docente_privado.fn_listar_practicas_asignadas(972);
  IF r IS NULL OR NOT r @> '[{"id_practica":9701}]'::JSONB OR r @> '[{"id_practica":9700}]'::JSONB THEN
    RAISE EXCEPTION 'aislamiento de prácticas docentes incorrecto: %',r;
  END IF;
  IF NOT pg_catalog.has_function_privilege('pl_s41_docente_executor','docente_privado.fn_gestionar_asignacion(bigint,bigint,bigint,text)','EXECUTE') THEN
    RAISE EXCEPTION 'el executor no obtiene EXECUTE';
  END IF;
  IF pg_catalog.has_table_privilege('pl_s41_docente_executor','public.practica','UPDATE') THEN
    RAISE EXCEPTION 'el executor tiene UPDATE directo en práctica';
  END IF;
  IF pg_catalog.has_function_privilege('anon','docente_privado.fn_gestionar_asignacion(bigint,bigint,bigint,text)','EXECUTE') THEN
    RAISE EXCEPTION 'rol anon obtiene EXECUTE';
  END IF;
  IF pg_catalog.has_function_privilege('authenticated','docente_privado.fn_listar_practicas_asignadas(bigint)','EXECUTE') THEN
    RAISE EXCEPTION 'rol authenticated obtiene EXECUTE';
  END IF;
END $$;

CREATE FUNCTION pg_temp.fallar_historial_docente() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION USING ERRCODE='P4091', MESSAGE='fallo sintético de historial'; END $$;
CREATE TRIGGER s41_fallo_historial BEFORE INSERT ON public.historial_asignacion_docente
  FOR EACH ROW EXECUTE FUNCTION pg_temp.fallar_historial_docente();
DO $$ BEGIN
  BEGIN
    PERFORM docente_privado.fn_gestionar_asignacion(9700,970,972,NULL);
    RAISE EXCEPTION 'la falla de historia no abortó';
  EXCEPTION WHEN SQLSTATE 'P4091' THEN NULL;
  END;
  IF (SELECT id_docente FROM public.practica WHERE id_practica=9700) IS NOT NULL THEN
    RAISE EXCEPTION 'la asignación sobrevivió al fallo de historial';
  END IF;
END $$;

ROLLBACK;
