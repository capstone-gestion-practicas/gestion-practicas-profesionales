\set ON_ERROR_STOP 1
BEGIN;
-- Datos sintéticos (dominio .invalid); se revierten al final.
INSERT INTO usuario(nombre,apellido,correo,password_hash,activo,fecha_creacion,fecha_actualizacion)
VALUES ('Gestor','Sint','gestor@s44.invalid','x',true,now(),now()),
       ('Docente','Sint','docente@s44.invalid','x',true,now(),now()),
       ('Docente','Dos','docente2@s44.invalid','x',true,now(),now()),
       ('Estudiante','Sint','estudiante@s44.invalid','x',true,now(),now());
INSERT INTO usuario_rol(id_usuario,id_rol)
SELECT u.id_usuario, r.id_rol FROM usuario u JOIN rol r ON (
     (u.correo='gestor@s44.invalid' AND r.nombre='GESTOR') OR
     (u.correo IN ('docente@s44.invalid','docente2@s44.invalid') AND r.nombre='DOCENTE') OR
     (u.correo='estudiante@s44.invalid' AND r.nombre='ESTUDIANTE'))
  WHERE u.correo LIKE '%@s44.invalid';
INSERT INTO estudiante(id_usuario,rut,carrera,sede,fecha_creacion,fecha_actualizacion)
SELECT id_usuario,'11111111-1','Carrera','Sede',now(),now() FROM usuario WHERE correo='estudiante@s44.invalid';
INSERT INTO centro_practica(nombre,activo,fecha_creacion,fecha_actualizacion)
VALUES ('Centro sintetico',true,now(),now());
CREATE TEMP TABLE ctx AS
SELECT
 (SELECT id_usuario FROM usuario WHERE correo='gestor@s44.invalid') AS ctx_gest,
 (SELECT id_usuario FROM usuario WHERE correo='docente@s44.invalid') AS ctx_doc,
 (SELECT id_usuario FROM usuario WHERE correo='docente2@s44.invalid') AS ctx_doc2,
 (SELECT id_usuario FROM usuario WHERE correo='estudiante@s44.invalid') AS ctx_estu,
 (SELECT id_centro FROM centro_practica WHERE nombre='Centro sintetico') AS ctx_centro,
 (SELECT id_estudiante FROM estudiante WHERE rut='11111111-1') AS ctx_est,
 (SELECT id_estado FROM estado_practica WHERE nombre='APROBADA') AS ctx_aprob;
INSERT INTO practica(id_estudiante,id_centro,id_estado_actual,id_gestor,fecha_registro,fecha_actualizacion)
SELECT ctx_est,ctx_centro,ctx_aprob,ctx_gest,now(),now() FROM ctx;
CREATE TEMP TABLE pr AS SELECT p.id_practica AS prac_id FROM practica p JOIN ctx ON p.id_gestor=ctx.ctx_gest;

SELECT set_config('s44.gest',(SELECT ctx_gest FROM ctx)::text,false),
       set_config('s44.doc',(SELECT ctx_doc FROM ctx)::text,false),
       set_config('s44.doc2',(SELECT ctx_doc2 FROM ctx)::text,false),
       set_config('s44.prac',(SELECT prac_id FROM pr)::text,false);
-- 1) Antes de asignar: el docente no ve prácticas.
SET ROLE pl_s41_docente_executor;
DO $$ DECLARE v_d bigint; r jsonb; BEGIN
  v_d := current_setting('s44.doc')::bigint; r := docente_privado.fn_listar_practicas_asignadas(v_d);
  IF jsonb_array_length(r) <> 0 THEN RAISE EXCEPTION 'ESPERABA_0_ANTES: %', r; END IF;
  RAISE NOTICE 'OK 1: sin asignación no hay prácticas';
END $$;
RESET ROLE;

-- 2) Asignación por el gestor responsable (estado APROBADA): genera la notificación.
SET ROLE pl_s41_docente_executor;
DO $$ DECLARE v_g bigint; v_d bigint; v_p bigint; r jsonb; BEGIN
  v_g := current_setting('s44.gest')::bigint; v_d := current_setting('s44.doc')::bigint; v_p := current_setting('s44.prac')::bigint;
  r := docente_privado.fn_gestionar_asignacion(v_p, v_g, v_d, NULL);
  IF r ? 'error' THEN RAISE EXCEPTION 'ASIGNACION_FALLO: %', r; END IF;
  RAISE NOTICE 'OK 2: asignación realizada %', r->>'mensaje';
END $$;
RESET ROLE;
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM notificacion n JOIN ctx ON n.id_usuario=ctx.ctx_doc WHERE n.tipo='PRACTICA_ASIGNADA';
  IF n <> 1 THEN RAISE EXCEPTION 'ESPERABA_1_NOTIFICACION: %', n; END IF;
  RAISE NOTICE 'OK 3: notificación PRACTICA_ASIGNADA creada para el docente';
END $$;

-- 3) Listado con el docente asignado: sin informe todavía.
SET ROLE pl_s41_docente_executor;
DO $$ DECLARE v_d bigint; r jsonb; BEGIN
  v_d := current_setting('s44.doc')::bigint; r := docente_privado.fn_listar_practicas_asignadas(v_d);
  IF jsonb_array_length(r) <> 1 OR (r->0->>'informe_estado') IS NOT NULL OR (r->0) ? 'informe_estado' IS FALSE THEN
    RAISE EXCEPTION 'ESPERABA_1_SIN_INFORME: %', r; END IF;
  RAISE NOTICE 'OK 4: listado con práctica asignada y campos de informe nulos';
END $$;
RESET ROLE;

-- 4) Informe entregado por el estudiante (versión 1): el listado lo refleja.
INSERT INTO documento(id_practica,id_usuario,id_tipo_documento,nombre_original,nombre_almacenado,ruta_archivo,mime_type,tamano_bytes,activo)
SELECT pr.prac_id, ctx.ctx_estu, (SELECT id_tipo_documento FROM tipo_documento WHERE nombre='INFORME_FINAL'), 'informe.pdf','s44.pdf','s44/informe.pdf','application/pdf',1000,true
FROM pr, ctx;
INSERT INTO informe_final(id_practica,id_documento,version,estado)
SELECT pr.prac_id, (SELECT max(id_documento) FROM documento), 1, 'ENTREGADO' FROM pr;
SET ROLE pl_s41_docente_executor;
DO $$ DECLARE v_d bigint; r jsonb; BEGIN
  v_d := current_setting('s44.doc')::bigint; r := docente_privado.fn_listar_practicas_asignadas(v_d);
  IF r->0->>'informe_estado' <> 'ENTREGADO' OR (r->0->>'informe_version')::int <> 1 OR (r->0->>'evaluacion_resultado') IS NOT NULL THEN
    RAISE EXCEPTION 'ESPERABA_ENTREGADO_V1: %', r; END IF;
  RAISE NOTICE 'OK 5: listado refleja informe ENTREGADO versión 1 sin evaluación';
END $$;
RESET ROLE;

-- 5) Aislamiento: otro docente no ve la práctica ni el resumen.
SET ROLE pl_s41_docente_executor;
DO $$ DECLARE v_d2 bigint; v_p bigint; r jsonb; BEGIN
  v_d2 := current_setting('s44.doc2')::bigint; v_p := current_setting('s44.prac')::bigint;
  r := docente_privado.fn_listar_practicas_asignadas(v_d2);
  IF jsonb_array_length(r) <> 0 THEN RAISE EXCEPTION 'AISLAMIENTO_FALLO_LISTA: %', r; END IF;
  BEGIN
    PERFORM informes_privados.resumen_docente(v_p, v_d2);
    RAISE EXCEPTION 'AISLAMIENTO_FALLO_RESUMEN_ACCESIBLE';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'OK 6a: el rol ejecutor no puede llamar resumen_docente directamente';
  END;
END $$;
RESET ROLE;

-- 6) El dueño de la función del docente no tiene lectura directa de informe_final.
SET ROLE pl_s41_docente_owner;
DO $$ BEGIN
  BEGIN
    PERFORM 1 FROM public.informe_final;
    RAISE EXCEPTION 'LECTURA_DIRECTA_PERMITIDA';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'OK 6b: sin lectura directa de informe_final para el rol docente';
  END;
END $$;
RESET ROLE;

ROLLBACK;
\echo RESULTADO: todas las comprobaciones han terminado (transacción revertida)
