\set ON_ERROR_STOP 1
BEGIN;
-- Datos sintéticos (dominio .invalid), revertidos al final.
INSERT INTO usuario(nombre,apellido,correo,password_hash,activo,fecha_creacion,fecha_actualizacion) VALUES
 ('Gestor','Uno','g1@s45.invalid','x',true,now(),now()),
 ('Gestor','Dos','g2@s45.invalid','x',true,now(),now()),
 ('Docente','Sint','d@s45.invalid','x',true,now(),now()),
 ('Estudiante','Sint','e@s45.invalid','x',true,now(),now()),
 ('Admin','Sint','a@s45.invalid','x',true,now(),now());
INSERT INTO usuario_rol(id_usuario,id_rol)
SELECT u.id_usuario, r.id_rol FROM usuario u JOIN rol r ON (
 (u.correo LIKE 'g%@s45.invalid' AND r.nombre='GESTOR') OR (u.correo='d@s45.invalid' AND r.nombre='DOCENTE') OR
 (u.correo='e@s45.invalid' AND r.nombre='ESTUDIANTE') OR (u.correo='a@s45.invalid' AND r.nombre='ADMINISTRADOR'))
WHERE u.correo LIKE '%@s45.invalid';
INSERT INTO estudiante(id_usuario,rut,carrera,sede,fecha_creacion,fecha_actualizacion)
SELECT id_usuario,'22222222-2','C','S',now(),now() FROM usuario WHERE correo='e@s45.invalid';
INSERT INTO centro_practica(nombre,activo,fecha_creacion,fecha_actualizacion) VALUES ('Centro S45',true,now(),now());
SELECT set_config('s45.g1',(SELECT id_usuario::text FROM usuario WHERE correo='g1@s45.invalid'),false),
       set_config('s45.g2',(SELECT id_usuario::text FROM usuario WHERE correo='g2@s45.invalid'),false),
       set_config('s45.d',(SELECT id_usuario::text FROM usuario WHERE correo='d@s45.invalid'),false),
       set_config('s45.e',(SELECT id_usuario::text FROM usuario WHERE correo='e@s45.invalid'),false),
       set_config('s45.a',(SELECT id_usuario::text FROM usuario WHERE correo='a@s45.invalid'),false),
       set_config('s45.est',(SELECT id_estudiante::text FROM estudiante WHERE rut='22222222-2'),false),
       set_config('s45.centro',(SELECT id_centro::text FROM centro_practica WHERE nombre='Centro S45'),false),
       set_config('s45.aprob',(SELECT id_estado::text FROM estado_practica WHERE nombre='APROBADA'),false);
INSERT INTO practica(id_estudiante,id_centro,id_estado_actual,id_gestor,id_docente,fecha_registro,fecha_actualizacion)
VALUES (current_setting('s45.est')::bigint, current_setting('s45.centro')::bigint, current_setting('s45.aprob')::bigint,
        current_setting('s45.g1')::bigint, current_setting('s45.d')::bigint, now(), now());
SELECT set_config('s45.p',(SELECT id_practica::text FROM practica WHERE id_gestor=current_setting('s45.g1')::bigint),false);

INSERT INTO historial_estado(id_practica,id_estado,id_usuario,fecha_cambio,observacion)
VALUES (current_setting('s45.p')::bigint, current_setting('s45.aprob')::bigint, current_setting('s45.g1')::bigint, now(), 'sintetico');
-- 1) Inicio (dueño pl_ep04_owner): avisa al estudiante.
SET ROLE pl_ep04_executor;
SELECT practicas_privadas.fn_iniciar_practica(current_setting('s45.p')::bigint, current_setting('s45.g1')::bigint, NULL) AS resultado;
RESET ROLE;
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM notificacion WHERE tipo='PRACTICA_INICIADA' AND id_usuario=current_setting('s45.e')::bigint;
  IF n<>1 THEN RAISE EXCEPTION 'INICIO_SIN_AVISO: %', n; END IF;
  RAISE NOTICE 'OK 1: inicio avisa al estudiante (PRACTICA_INICIADA)';
END $$;

-- 2) Reasignación de gestor: avisa al saliente y al entrante.
SELECT public.fn_asignar_gestor_practica(current_setting('s45.p')::bigint, current_setting('s45.a')::bigint, current_setting('s45.g2')::bigint) ->> 'mensaje';
DO $$ DECLARE a int; b int; BEGIN
  SELECT count(*) INTO a FROM notificacion WHERE tipo='GESTOR_REASIGNADO' AND id_usuario=current_setting('s45.g1')::bigint;
  SELECT count(*) INTO b FROM notificacion WHERE tipo='GESTOR_ASIGNADO' AND id_usuario=current_setting('s45.g2')::bigint;
  IF a<>1 OR b<>1 THEN RAISE EXCEPTION 'REASIGNACION_SIN_AVISOS: % %', a, b; END IF;
  RAISE NOTICE 'OK 2: reasignación avisa al gestor saliente y al entrante';
END $$;

-- 3) Incidencia ALTA: gestor asignado (g2) recibe el aviso.
SELECT public.fn_registrar_incidencia(current_setting('s45.p')::bigint, current_setting('s45.g2')::bigint, CURRENT_DATE, 'Sintetica', 'ALTA') ->> 'alerta' AS alerta;
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM notificacion WHERE tipo='INCIDENCIA_ALTA' AND id_usuario=current_setting('s45.g2')::bigint;
  IF n<>1 THEN RAISE EXCEPTION 'INCIDENCIA_SIN_AVISO_GESTOR: %', n; END IF;
  RAISE NOTICE 'OK 3: incidencia ALTA avisa al gestor asignado';
END $$;

-- 4) Sin gestor asignado: avisa a los administradores activos.
UPDATE practica SET id_gestor=NULL WHERE id_practica=current_setting('s45.p')::bigint;
SELECT public.fn_registrar_incidencia(current_setting('s45.p')::bigint, current_setting('s45.e')::bigint, CURRENT_DATE, 'Sintetica 2', 'CRITICA') ->> 'alerta' AS alerta;
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM notificacion WHERE tipo='INCIDENCIA_CRITICA' AND id_usuario=current_setting('s45.a')::bigint;
  IF n<>1 THEN RAISE EXCEPTION 'INCIDENCIA_SIN_AVISO_ADMIN: %', n; END IF;
  RAISE NOTICE 'OK 4: incidencia CRITICA sin gestor avisa al administrador activo';
END $$;
UPDATE practica SET id_gestor=current_setting('s45.g2')::bigint WHERE id_practica=current_setting('s45.p')::bigint;

-- 5) Cierre: prepara informe confirmado y evaluación APROBADO vigente; avisa a estudiante y docente.
INSERT INTO documento(id_practica,id_usuario,id_tipo_documento,nombre_original,nombre_almacenado,ruta_archivo,mime_type,tamano_bytes,activo)
SELECT current_setting('s45.p')::bigint, current_setting('s45.e')::bigint,
       (SELECT id_tipo_documento FROM tipo_documento WHERE nombre='INFORME_FINAL'), 'i.pdf','s45.pdf','s45/i.pdf','application/pdf',1000,true;
SELECT set_config('s45.doc',(SELECT max(id_documento)::text FROM documento),false);
INSERT INTO informe_entrega(id_entrega,id_practica,id_actor,esperado,sha256,tamano,nombre,objeto,estado,id_documento,version,confirmada)
VALUES ('00000000-0000-4000-8000-00000000045a', current_setting('s45.p')::bigint, current_setting('s45.e')::bigint, 0,
        repeat('a',64), 1000, 'i.pdf', 's45/entrega-1', 'CONFIRMADA', current_setting('s45.doc')::bigint, 1, now());
INSERT INTO informe_final(id_practica,id_documento,version,estado)
VALUES (current_setting('s45.p')::bigint, current_setting('s45.doc')::bigint, 1, 'ENTREGADO');
SET ROLE pl_s42_executor;
SELECT informes_privados.iniciar_evaluacion(current_setting('s45.p')::bigint, current_setting('s45.d')::bigint,
  '00000000-0000-4000-8000-00000000045b', current_setting('s45.doc')::bigint, 1) ->> 'estado' AS eval_inicio;
SELECT informes_privados.resolver_evaluacion(current_setting('s45.p')::bigint, current_setting('s45.d')::bigint,
  '00000000-0000-4000-8000-00000000045c', '00000000-0000-4000-8000-00000000045b', 'APROBADO', NULL) ->> 'estado' AS eval_resuelta;
RESET ROLE;
UPDATE practica SET fecha_termino=DATE '2020-01-01' WHERE id_practica=current_setting('s45.p')::bigint;
SET ROLE pl_s42_executor;
SELECT public.fn_cerrar_practica(current_setting('s45.p')::bigint, current_setting('s45.g2')::bigint, NULL) ->> 'estado' AS estado;
RESET ROLE;
DO $$ DECLARE e int; d int; BEGIN
  SELECT count(*) INTO e FROM notificacion WHERE tipo='PRACTICA_FINALIZADA' AND id_usuario=current_setting('s45.e')::bigint;
  SELECT count(*) INTO d FROM notificacion WHERE tipo='PRACTICA_FINALIZADA' AND id_usuario=current_setting('s45.d')::bigint;
  IF e<>1 OR d<>1 THEN RAISE EXCEPTION 'CIERRE_SIN_AVISOS: est=% doc=%', e, d; END IF;
  RAISE NOTICE 'OK 5: cierre avisa al estudiante y al docente';
END $$;

ROLLBACK;
\echo FIN_S45 (transacción revertida)
