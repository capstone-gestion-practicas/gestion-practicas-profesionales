-- Integración PostgreSQL 17 (datos sintéticos, dominio .invalid, transacción revertida).
-- A) Incidencias solo con la práctica EN_CURSO.
-- B) Desvío 7a completo: informe v1 → evaluación CON_OBSERVACIONES → reentrega v2 → APROBADO → cierre.
--    Negativos: resolver CON_OBSERVACIONES sin observaciones; cerrar con la versión vigente CON_OBSERVACIONES.
\set ON_ERROR_STOP 1
BEGIN;
INSERT INTO usuario(nombre,apellido,correo,password_hash,activo,fecha_creacion,fecha_actualizacion) VALUES
 ('G','S46','g@s46.invalid','x',true,now(),now()),
 ('D','S46','d@s46.invalid','x',true,now(),now()),
 ('E','S46','e@s46.invalid','x',true,now(),now());
INSERT INTO usuario_rol(id_usuario,id_rol) SELECT u.id_usuario, r.id_rol FROM usuario u JOIN rol r ON (
 (u.correo='g@s46.invalid' AND r.nombre='GESTOR') OR (u.correo='d@s46.invalid' AND r.nombre='DOCENTE') OR (u.correo='e@s46.invalid' AND r.nombre='ESTUDIANTE'))
 WHERE u.correo LIKE '%@s46.invalid';
INSERT INTO estudiante(id_usuario,rut,carrera,sede,fecha_creacion,fecha_actualizacion)
SELECT id_usuario,'66666666-6','C','S',now(),now() FROM usuario WHERE correo='e@s46.invalid';
INSERT INTO centro_practica(nombre,activo,fecha_creacion,fecha_actualizacion) VALUES ('C46',true,now(),now());
-- Práctica A: APROBADA (para el rechazo de incidencias).
INSERT INTO practica(id_estudiante,id_centro,id_estado_actual,id_gestor,id_docente,fecha_registro,fecha_actualizacion)
SELECT e.id_estudiante,c.id_centro,(SELECT id_estado FROM estado_practica WHERE nombre='APROBADA'),g.id_usuario,d.id_usuario,now(),now()
FROM estudiante e,centro_practica c,usuario g,usuario d WHERE e.rut='66666666-6' AND c.nombre='C46' AND g.correo='g@s46.invalid' AND d.correo='d@s46.invalid';
-- Práctica B: EN_CURSO, fecha de término ya alcanzada (para el cierre).
INSERT INTO practica(id_estudiante,id_centro,id_estado_actual,id_gestor,id_docente,fecha_registro,fecha_actualizacion,fecha_termino)
SELECT e.id_estudiante,c.id_centro,(SELECT id_estado FROM estado_practica WHERE nombre='EN_CURSO'),g.id_usuario,d.id_usuario,now(),now(),DATE '2020-01-01'
FROM estudiante e,centro_practica c,usuario g,usuario d WHERE e.rut='66666666-6' AND c.nombre='C46' AND g.correo='g@s46.invalid' AND d.correo='d@s46.invalid';
INSERT INTO historial_estado(id_practica,id_estado,id_usuario,fecha_cambio,observacion)
SELECT p.id_practica, p.id_estado_actual, p.id_gestor, now(), 'sintetico' FROM practica p JOIN usuario g ON g.id_usuario=p.id_gestor WHERE g.correo='g@s46.invalid';
SELECT set_config('s46.g',(SELECT id_usuario::text FROM usuario WHERE correo='g@s46.invalid'),false),
       set_config('s46.d',(SELECT id_usuario::text FROM usuario WHERE correo='d@s46.invalid'),false),
       set_config('s46.e',(SELECT id_usuario::text FROM usuario WHERE correo='e@s46.invalid'),false),
       set_config('s46.pa',(SELECT min(id_practica)::text FROM practica),false),
       set_config('s46.pb',(SELECT max(id_practica)::text FROM practica),false);

-- A1) Incidencia con práctica APROBADA: rechazada.
DO $$ DECLARE r jsonb; BEGIN
  r := public.fn_registrar_incidencia(current_setting('s46.pa')::bigint, current_setting('s46.g')::bigint, CURRENT_DATE, 'x', 'MEDIA')::jsonb;
  IF r->>'error' IS DISTINCT FROM 'PRACTICA_NO_EN_CURSO' THEN RAISE EXCEPTION 'INCIDENCIA_APROBADA_DEBE_RECHAZARSE: %', r; END IF;
  RAISE NOTICE 'OK A1: incidencia en APROBADA rechazada con PRACTICA_NO_EN_CURSO';
END $$;
-- A2) Incidencia con práctica EN_CURSO: aceptada.
DO $$ DECLARE r jsonb; BEGIN
  r := public.fn_registrar_incidencia(current_setting('s46.pb')::bigint, current_setting('s46.g')::bigint, CURRENT_DATE, 'x', 'MEDIA')::jsonb;
  IF r ? 'error' OR (r->>'id_incidencia') IS NULL THEN RAISE EXCEPTION 'INCIDENCIA_EN_CURSO_DEBE_ACEPTARSE: %', r; END IF;
  RAISE NOTICE 'OK A2: incidencia en EN_CURSO registrada';
END $$;

-- B) Desvío 7a. Todas las operaciones de informe y evaluación usan el rol que las ejecuta en la aplicación.
SET ROLE pl_s42_executor;
-- B1) Informe v1 (reserva + confirmación).
SELECT informes_privados.reservar(current_setting('s46.pb')::bigint, current_setting('s46.e')::bigint,
  '00000000-0000-4000-8000-0000000046a1', 0, repeat('a',64), 'informe1.pdf', 1000) ->> 'estado' AS reserva_v1;
SELECT set_config('s46.doc1', informes_privados.confirmar(current_setting('s46.pb')::bigint, current_setting('s46.e')::bigint,
  '00000000-0000-4000-8000-0000000046a1') ->> 'id_documento', false);
RESET ROLE;
DO $$ DECLARE v int; BEGIN
  SELECT version INTO v FROM informe_final WHERE id_practica=current_setting('s46.pb')::bigint;
  IF v IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'INFORME_V1_NO_CONFIRMADO: %', v; END IF;
  RAISE NOTICE 'OK B1: informe versión 1 entregado';
END $$;

-- B2) Evaluación de v1 por el docente asignado: CON_OBSERVACIONES sin observaciones → rechazada.
SET ROLE pl_s42_executor;
SELECT informes_privados.iniciar_evaluacion(current_setting('s46.pb')::bigint, current_setting('s46.d')::bigint,
  '00000000-0000-4000-8000-0000000046b1', current_setting('s46.doc1')::bigint, 1) ->> 'estado' AS eval_iniciada;
DO $$ BEGIN
  BEGIN
    PERFORM informes_privados.resolver_evaluacion(current_setting('s46.pb')::bigint, current_setting('s46.d')::bigint,
      '00000000-0000-4000-8000-0000000046c0', '00000000-0000-4000-8000-0000000046b1', 'CON_OBSERVACIONES', '   ');
    RAISE EXCEPTION 'OBSERVACIONES_VACIAS_DEBEN_RECHAZARSE';
  EXCEPTION WHEN sqlstate '22023' THEN
    IF SQLERRM NOT LIKE '%RESULTADO_OBSERVACIONES_INVALIDOS%' THEN RAISE; END IF;
    RAISE NOTICE 'OK B2a: CON_OBSERVACIONES sin observaciones rechazado';
  END;
END $$;
-- B2b) Resultado CON_OBSERVACIONES con observaciones: registrado.
SELECT informes_privados.resolver_evaluacion(current_setting('s46.pb')::bigint, current_setting('s46.d')::bigint,
  '00000000-0000-4000-8000-0000000046c1', '00000000-0000-4000-8000-0000000046b1', 'CON_OBSERVACIONES', 'Corrija la metodología.') ->> 'resultado' AS resultado_v1;
RESET ROLE;
DO $$ DECLARE r text; BEGIN
  SELECT resultado INTO r FROM evaluacion_informe WHERE id_evaluacion='00000000-0000-4000-8000-0000000046b1';
  IF r IS DISTINCT FROM 'CON_OBSERVACIONES' THEN RAISE EXCEPTION 'RESULTADO_V1_NO_REGISTRADO: %', r; END IF;
  RAISE NOTICE 'OK B2b: resultado CON_OBSERVACIONES registrado para v1';
END $$;

-- B3) Negativo: cerrar con la versión vigente CON_OBSERVACIONES debe rechazarse.
SET ROLE pl_s42_executor;
DO $$ DECLARE msg text; BEGIN
  BEGIN
    PERFORM public.fn_cerrar_practica(current_setting('s46.pb')::bigint, current_setting('s46.g')::bigint, NULL);
    RAISE EXCEPTION 'CIERRE_CON_OBSERVACIONES_DEBE_RECHAZARSE';
  EXCEPTION WHEN sqlstate 'P0409' THEN
    IF SQLERRM NOT LIKE '%EVALUACION_APROBATORIA_VIGENTE_REQUERIDA%' THEN RAISE; END IF;
    RAISE NOTICE 'OK B3: cierre rechazado con evaluación vigente CON_OBSERVACIONES';
  END;
END $$;
RESET ROLE;

-- B4) Reentrega v2 por el estudiante (esperado = versión actual 1).
SET ROLE pl_s42_executor;
SELECT informes_privados.reservar(current_setting('s46.pb')::bigint, current_setting('s46.e')::bigint,
  '00000000-0000-4000-8000-0000000046a2', 1, repeat('b',64), 'informe2.pdf', 1200) ->> 'estado' AS reserva_v2;
SELECT set_config('s46.doc2', informes_privados.confirmar(current_setting('s46.pb')::bigint, current_setting('s46.e')::bigint,
  '00000000-0000-4000-8000-0000000046a2') ->> 'id_documento', false);
-- B5) Evaluación de v2 por el docente: APROBADO.
SELECT informes_privados.iniciar_evaluacion(current_setting('s46.pb')::bigint, current_setting('s46.d')::bigint,
  '00000000-0000-4000-8000-0000000046b2', current_setting('s46.doc2')::bigint, 2) ->> 'estado' AS eval_v2;
SELECT informes_privados.resolver_evaluacion(current_setting('s46.pb')::bigint, current_setting('s46.d')::bigint,
  '00000000-0000-4000-8000-0000000046c2', '00000000-0000-4000-8000-0000000046b2', 'APROBADO', NULL) ->> 'resultado' AS resultado_v2;
-- B6) Cierre permitido con la versión vigente APROBADA.
SELECT public.fn_cerrar_practica(current_setting('s46.pb')::bigint, current_setting('s46.g')::bigint, NULL) ->> 'estado' AS cierre;
RESET ROLE;
DO $$ DECLARE e text; BEGIN
  SELECT ep.nombre INTO e FROM practica p JOIN estado_practica ep ON ep.id_estado=p.id_estado_actual WHERE p.id_practica=current_setting('s46.pb')::bigint;
  IF e IS DISTINCT FROM 'FINALIZADA' THEN RAISE EXCEPTION 'CIERRE_NO_APLICADO: %', e; END IF;
  RAISE NOTICE 'OK B6: cierre permitido tras la reentrega aprobada (FINALIZADA)';
END $$;

ROLLBACK;
\echo FIN_S46 (transacción revertida)
