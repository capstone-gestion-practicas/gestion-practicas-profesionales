-- S4.3 synthetic PostgreSQL only; no external services. All data rolled back.
BEGIN;
INSERT INTO public.usuario(id_usuario,nombre,apellido,correo,password_hash)
 SELECT id,'Sintético','S43','s43-'||id||'@example.invalid','synthetic' FROM generate_series(430,439) id;
INSERT INTO public.usuario_rol SELECT id,id_rol FROM (VALUES
 (430,'ESTUDIANTE'),(431,'GESTOR'),(432,'DOCENTE'),(433,'DOCENTE'),(434,'ADMINISTRADOR'),(435,'GESTOR'),(436,'ESTUDIANTE'),(437,'DOCENTE'),(430,'DOCENTE'),(432,'ADMINISTRADOR')) x(id,nombre) JOIN public.rol USING(nombre);
INSERT INTO public.estudiante(id_estudiante,id_usuario,rut,carrera,sede) VALUES(430,430,'11111111-1','Sintética','Alameda');
INSERT INTO public.centro_practica(id_centro,nombre) VALUES(430,'Centro sintético');
INSERT INTO public.practica(id_practica,id_estudiante,id_centro,id_estado_actual,id_gestor,id_docente,fecha_termino)
 SELECT id,430,430,ep.id_estado,431,432,(clock_timestamp() AT TIME ZONE 'America/Santiago')::date FROM generate_series(430,435) id CROSS JOIN public.estado_practica ep WHERE ep.nombre='EN_CURSO';
CREATE FUNCTION pg_temp.ok(value boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF value IS NOT TRUE THEN RAISE EXCEPTION 'S43 assertion: %',label; END IF; END $$;
CREATE FUNCTION pg_temp.error(source text,expected text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE source; EXCEPTION WHEN OTHERS THEN IF SQLSTATE=expected THEN RETURN; END IF; RAISE; END;
 RAISE EXCEPTION 'Expected %: %',expected,source;
END $$;
SET LOCAL ROLE pl_s42_executor;
SELECT informes_privados.reservar(430,430,'43000000-0000-0000-0000-000000000001',0,repeat('a',64),'informe.pdf',5);
SELECT informes_privados.confirmar(430,430,'43000000-0000-0000-0000-000000000001');
DO $$ DECLARE a bigint; d bigint; BEGIN
 d:=(informes_privados.consultar(430,432)->>'id_documento')::bigint;
 FOREACH a IN ARRAY ARRAY[430,431,433,434,435,436] LOOP
  PERFORM pg_temp.error(format('SELECT informes_privados.iniciar_evaluacion(430,%s,''43000000-0000-0000-0000-000000000002'',%s,1)',a,d),'42501');
 END LOOP;
END $$;
RESET ROLE;
UPDATE public.usuario SET activo=false WHERE id_usuario=432;
SET LOCAL ROLE pl_s42_executor;
SELECT pg_temp.error('SELECT informes_privados.iniciar_evaluacion(430,432,''43000000-0000-0000-0000-000000000002'',1,1)','42501');
RESET ROLE;
UPDATE public.usuario SET activo=true WHERE id_usuario=432;
UPDATE public.rol SET activo=false WHERE nombre='DOCENTE';
SET LOCAL ROLE pl_s42_executor;
SELECT pg_temp.error('SELECT informes_privados.iniciar_evaluacion(430,432,''43000000-0000-0000-0000-000000000002'',1,1)','42501');
RESET ROLE;
UPDATE public.rol SET activo=true WHERE nombre='DOCENTE';
SET LOCAL ROLE pl_s42_executor;
SELECT pg_temp.error('SELECT informes_privados.iniciar_evaluacion(431,432,''43000000-0000-0000-0000-000000000002'',NULL,1)','P0409');
-- Assigned DOCENTE+ADMINISTRADOR acts as DOCENTE, not as an administrator exception.
SELECT informes_privados.iniciar_evaluacion(430,432,'43000000-0000-0000-0000-000000000002',(informes_privados.consultar(430,432)->>'id_documento')::bigint,1);
SELECT informes_privados.iniciar_evaluacion(430,432,'43000000-0000-0000-0000-000000000002',(informes_privados.consultar(430,432)->>'id_documento')::bigint,1);
SELECT pg_temp.ok(informes_privados.consultar(430,430)->>'estado'='EN_EVALUACION','explicit start');
DO $$ DECLARE a bigint; BEGIN
 FOREACH a IN ARRAY ARRAY[430,431,433,434,435,436] LOOP
  PERFORM pg_temp.error(format('SELECT informes_privados.resolver_evaluacion(430,%s,''43000000-0000-0000-0000-000000000004'',''43000000-0000-0000-0000-000000000002'',''APROBADO'',NULL)',a),'42501');
 END LOOP;
END $$;
SELECT pg_temp.error('SELECT informes_privados.resolver_evaluacion(430,432,''43000000-0000-0000-0000-000000000004'',''43000000-0000-0000-0000-000000000002'',''4.0'',NULL)','22023');

SELECT pg_temp.error('SELECT informes_privados.iniciar_evaluacion(430,432,''43000000-0000-0000-0000-000000000003'',1,1)','P0409');
SELECT pg_temp.error('SELECT informes_privados.resolver_evaluacion(430,433,''43000000-0000-0000-0000-000000000004'',''43000000-0000-0000-0000-000000000002'',''APROBADO'',NULL)','42501');
SELECT pg_temp.error('SELECT informes_privados.resolver_evaluacion(430,432,''43000000-0000-0000-0000-000000000004'',''43000000-0000-0000-0000-000000000002'',''CON_OBSERVACIONES'',''   '')','22023');
SELECT pg_temp.error('SELECT informes_privados.resolver_evaluacion(430,432,''43000000-0000-0000-0000-000000000004'',''43000000-0000-0000-0000-000000000002'',''CON_OBSERVACIONES'',repeat(chr(160),2))','22023');
SELECT pg_temp.error('SELECT informes_privados.resolver_evaluacion(430,432,''43000000-0000-0000-0000-000000000004'',''43000000-0000-0000-0000-000000000002'',''APROBADO'',repeat(''x'',2001))','22023');
SELECT pg_temp.error('SELECT informes_privados.reservar(430,430,''43000000-0000-0000-0000-000000000005'',1,repeat(''b'',64),''nuevo.pdf'',6)','P0409');
SELECT informes_privados.resolver_evaluacion(430,432,'43000000-0000-0000-0000-000000000004','43000000-0000-0000-0000-000000000002','CON_OBSERVACIONES','Corregir informe sintético');
SELECT informes_privados.resolver_evaluacion(430,432,'43000000-0000-0000-0000-000000000004','43000000-0000-0000-0000-000000000002','CON_OBSERVACIONES','Corregir informe sintético');
SELECT pg_temp.ok((informes_privados.consultar(430,430)->>'habilitada')::boolean,'observations enable delivery');
SELECT pg_temp.error('SELECT informes_privados.resolver_evaluacion(430,432,''43000000-0000-0000-0000-000000000006'',''43000000-0000-0000-0000-000000000002'',''APROBADO'',NULL)','P0409');
SELECT pg_temp.error('SELECT public.fn_cerrar_practica(430,431,NULL)','P0409');
SELECT informes_privados.reservar(430,430,'43000000-0000-0000-0000-000000000005',1,repeat('b',64),'nuevo.pdf',6);
SELECT informes_privados.confirmar(430,430,'43000000-0000-0000-0000-000000000005');
SELECT pg_temp.ok(informes_privados.consultar(430,430)->>'version'='2','new version');
SELECT pg_temp.error('SELECT public.fn_cerrar_practica(430,431,NULL)','P0409');
SELECT informes_privados.iniciar_evaluacion(430,432,'43000000-0000-0000-0000-000000000007',(informes_privados.consultar(430,432)->>'id_documento')::bigint,2);
RESET ROLE;
SET LOCAL ROLE pl_s41_docente_executor;
SELECT docente_privado.fn_gestionar_asignacion(430,431,433,'Cambio docente sintético');
RESET ROLE;
SELECT pg_temp.ok((SELECT estado='INTERRUMPIDA' AND id_docente=432 AND motivo='Cambio docente sintético' FROM public.evaluacion_informe WHERE id_evaluacion='43000000-0000-0000-0000-000000000007'),'interruption audit');
SET LOCAL ROLE pl_s42_executor;
SELECT pg_temp.error('SELECT informes_privados.historial_evaluacion(430,432)','42501');
SELECT pg_temp.error('SELECT informes_privados.resolver_evaluacion(430,432,''43000000-0000-0000-0000-000000000008'',''43000000-0000-0000-0000-000000000007'',''APROBADO'',NULL)','42501');
SELECT informes_privados.iniciar_evaluacion(430,433,'43000000-0000-0000-0000-000000000009',(informes_privados.consultar(430,433)->>'id_documento')::bigint,2);
SELECT informes_privados.resolver_evaluacion(430,433,'43000000-0000-0000-0000-000000000010','43000000-0000-0000-0000-000000000009','APROBADO',NULL);
SELECT pg_temp.ok(NOT (informes_privados.consultar(430,430)->>'habilitada')::boolean,'approval blocks replacement');
RESET ROLE;
SELECT pg_temp.ok((SELECT ep.nombre='EN_CURSO' FROM public.practica p JOIN public.estado_practica ep ON ep.id_estado=p.id_estado_actual WHERE p.id_practica=430),'approval never closes practice');
UPDATE public.practica SET fecha_termino=(clock_timestamp() AT TIME ZONE 'America/Santiago')::date+1 WHERE id_practica=430;
SET LOCAL ROLE pl_s42_executor;
SELECT pg_temp.error('SELECT public.fn_cerrar_practica(430,431,NULL)','P0409');
RESET ROLE;
UPDATE public.practica SET fecha_termino=(clock_timestamp() AT TIME ZONE 'America/Santiago')::date WHERE id_practica=430;
SET LOCAL ROLE pl_s42_executor;

SELECT pg_temp.error('SELECT informes_privados.reservar(430,430,''43000000-0000-0000-0000-000000000011'',2,repeat(''c'',64),''otro.pdf'',7)','P0409');
SELECT pg_temp.error('SELECT public.fn_cerrar_practica(430,434,NULL)','42501');
SELECT pg_temp.error('SELECT public.fn_cerrar_practica(430,435,NULL)','42501');
SELECT pg_temp.ok(jsonb_array_length(informes_privados.historial_evaluacion(430,430))=3,'student history');
RESET ROLE;
-- Resolved evaluations and evaluated bytes/metadata are immutable, even via direct DML.
SELECT pg_temp.error('UPDATE public.evaluacion_informe SET resultado=''CON_OBSERVACIONES'' WHERE id_evaluacion=''43000000-0000-0000-0000-000000000009''','23514');
SELECT pg_temp.error('DELETE FROM public.evaluacion_evento','23514');
SELECT pg_temp.error('UPDATE public.informe_entrega SET sha256=repeat(''f'',64) WHERE id_practica=430 AND estado=''CONFIRMADA''','23514');
SELECT pg_temp.error('UPDATE public.documento SET ruta_archivo=''forged'' WHERE id_practica=430','23514');
-- Stronger barriers reject alternative writes, rather than trusting frontend actions.
SELECT pg_temp.error('UPDATE public.practica SET id_estado_actual=(SELECT id_estado FROM public.estado_practica WHERE nombre=''FINALIZADA'') WHERE id_practica=431','42501');
SELECT pg_temp.error('INSERT INTO public.cierre_practica(id_practica,id_usuario,resultado) VALUES(431,431,''APROBADA'')','42501');
SELECT pg_temp.error('INSERT INTO public.historial_estado(id_practica,id_estado,id_usuario) SELECT 431,id_estado,431 FROM public.estado_practica WHERE nombre=''FINALIZADA''','42501');
SELECT pg_temp.error('UPDATE public.practica SET id_docente=430 WHERE id_practica=431','23514');
SET LOCAL ROLE pl_s41_docente_executor;
SELECT pg_temp.ok(docente_privado.fn_gestionar_asignacion(431,431,430,'No permitir autoevaluación')->>'error'='DOCENTE_IGUAL_ESTUDIANTE','self-evaluation assignment denied');
SELECT pg_temp.error('SELECT docente_privado.fn_gestionar_asignacion(431,431,433,repeat(''x'',2001))','22023');
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*)=4 FROM public.notificacion WHERE id_practica=430 AND tipo='INFORME_FINAL_EVALUADO'),'resolution retry does not duplicate notifications');
SELECT pg_temp.error('DELETE FROM public.informe_final WHERE id_practica=430','23514');
-- Approval survives a later DOCENTE reassignment; closing evidence remains version-specific.
SET LOCAL ROLE pl_s41_docente_executor;
SELECT docente_privado.fn_gestionar_asignacion(430,431,432,'Cambio posterior a resolución');
RESET ROLE;
SET LOCAL ROLE pl_s42_executor;
RESET ROLE;
SET LOCAL ROLE pl_s43_cierre_owner;
SELECT pg_temp.error('INSERT INTO public.cierre_practica(id_practica,id_usuario,resultado,id_evaluacion) VALUES(430,431,''APROBADA'',''43000000-0000-0000-0000-000000000002'')','P0409');
RESET ROLE;
SET LOCAL ROLE pl_s42_executor;
SELECT pg_temp.ok(public.fn_cerrar_practica(430,431,'Cierre sintético')->>'estado'='FINALIZADA','responsible gestor closes');
RESET ROLE;
SELECT pg_temp.ok((SELECT id_evaluacion='43000000-0000-0000-0000-000000000009'::uuid FROM public.cierre_practica WHERE id_practica=430),'closure references exact approval');
SELECT pg_temp.error('UPDATE public.cierre_practica SET observacion=''alterada'' WHERE id_practica=430','23514');
SELECT pg_temp.error('DELETE FROM public.cierre_practica WHERE id_practica=430','23514');
SELECT pg_temp.error('UPDATE public.practica SET id_estado_actual=(SELECT id_estado FROM public.estado_practica WHERE nombre=''EN_CURSO'') WHERE id_practica=430','23514');
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['pl_s42_owner','pl_s42_executor','pl_s43_cierre_owner'] LOOP
  IF (SELECT rolsuper OR rolbypassrls OR rolcanlogin FROM pg_roles WHERE rolname=r) THEN RAISE EXCEPTION 'unsafe private role'; END IF;
 END LOOP;
 IF has_column_privilege('pl_s43_cierre_owner','public.practica','id_docente','UPDATE') OR has_column_privilege('pl_s43_cierre_owner','public.practica','id_gestor','UPDATE') OR has_any_column_privilege('pl_s43_cierre_owner','public.usuario','SELECT,UPDATE') OR has_schema_privilege('pl_s43_cierre_owner','public','CREATE') THEN RAISE EXCEPTION 'closure owner privileges too broad'; END IF;
END $$;
-- Private owners can lock identities but cannot write them; backend executor has no DML.
SET LOCAL ROLE pl_s42_owner;
SELECT id_usuario FROM public.usuario WHERE id_usuario=430 FOR SHARE;
SELECT pg_temp.error('UPDATE public.usuario SET id_usuario=id_usuario WHERE id_usuario=430','42501');
RESET ROLE;
SET LOCAL ROLE pl_s42_executor;
SELECT pg_temp.error('SELECT * FROM public.evaluacion_informe','42501');
SELECT pg_temp.error('UPDATE public.evaluacion_informe SET estado=''RESUELTA''','42501');
SELECT pg_temp.error('SELECT informes_privados.interrumpir_evaluacion(431,431,''forged'')','42501');
SELECT pg_temp.error('SELECT informes_privados.validar_cierre(430,431)','42501');
RESET ROLE;
DO $$ DECLARE c text; f record; BEGIN
 FOREACH c IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF has_schema_privilege(c,'informes_privados','USAGE') THEN RAISE EXCEPTION 'private schema exposed'; END IF;
  FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='informes_privados' LOOP
   IF has_function_privilege(c,f.oid,'EXECUTE') THEN RAISE EXCEPTION 'function exposed'; END IF;
  END LOOP;
  IF has_function_privilege(c,'public.fn_cerrar_practica(bigint,bigint,text)','EXECUTE') OR has_table_privilege(c,'public.evaluacion_informe','SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'academic access exposed'; END IF;
 END LOOP;
END $$;
SET LOCAL ROLE anon;
SELECT pg_temp.error('SELECT informes_privados.iniciar_evaluacion(431,432,''43000000-0000-0000-0000-000000000099'',1,1)','42501');
SELECT pg_temp.error('SELECT informes_privados.resolver_evaluacion(431,432,''43000000-0000-0000-0000-000000000099'',''43000000-0000-0000-0000-000000000098'',''APROBADO'',NULL)','42501');
SELECT pg_temp.error('SELECT informes_privados.historial_evaluacion(430,430)','42501');
SELECT pg_temp.error('SELECT public.fn_cerrar_practica(431,431,NULL)','42501');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.error('SELECT informes_privados.iniciar_evaluacion(431,432,''43000000-0000-0000-0000-000000000099'',1,1)','42501');
SELECT pg_temp.error('SELECT informes_privados.resolver_evaluacion(431,432,''43000000-0000-0000-0000-000000000099'',''43000000-0000-0000-0000-000000000098'',''APROBADO'',NULL)','42501');
SELECT pg_temp.error('SELECT informes_privados.historial_evaluacion(430,430)','42501');
SELECT pg_temp.error('SELECT public.fn_cerrar_practica(431,431,NULL)','42501');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.error('SELECT informes_privados.iniciar_evaluacion(431,432,''43000000-0000-0000-0000-000000000099'',1,1)','42501');
SELECT pg_temp.error('SELECT informes_privados.resolver_evaluacion(431,432,''43000000-0000-0000-0000-000000000099'',''43000000-0000-0000-0000-000000000098'',''APROBADO'',NULL)','42501');
SELECT pg_temp.error('SELECT informes_privados.historial_evaluacion(430,430)','42501');
SELECT pg_temp.error('SELECT public.fn_cerrar_practica(431,431,NULL)','42501');
RESET ROLE;
SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;

-- Failure injection: resolution and assignment must roll back every dependent write.
-- S4.3 synthetic PostgreSQL only; no external services. All data rolled back.
BEGIN;
INSERT INTO public.usuario(id_usuario,nombre,apellido,correo,password_hash)
 SELECT id,'Sintético','S43','s43-'||id||'@example.invalid','synthetic' FROM generate_series(430,439) id;
INSERT INTO public.usuario_rol SELECT id,id_rol FROM (VALUES
 (430,'ESTUDIANTE'),(431,'GESTOR'),(432,'DOCENTE'),(433,'DOCENTE'),(434,'ADMINISTRADOR'),(435,'GESTOR'),(436,'ESTUDIANTE'),(437,'DOCENTE'),(430,'DOCENTE'),(432,'ADMINISTRADOR')) x(id,nombre) JOIN public.rol USING(nombre);
INSERT INTO public.estudiante(id_estudiante,id_usuario,rut,carrera,sede) VALUES(430,430,'11111111-1','Sintética','Alameda');
INSERT INTO public.centro_practica(id_centro,nombre) VALUES(430,'Centro sintético');
INSERT INTO public.practica(id_practica,id_estudiante,id_centro,id_estado_actual,id_gestor,id_docente,fecha_termino)
 SELECT id,430,430,ep.id_estado,431,432,(clock_timestamp() AT TIME ZONE 'America/Santiago')::date FROM generate_series(430,435) id CROSS JOIN public.estado_practica ep WHERE ep.nombre='EN_CURSO';

SELECT informes_privados.reservar(430,430,'43000000-0000-0000-0000-000000000001',0,repeat('a',64),'informe.pdf',5);
SELECT informes_privados.confirmar(430,430,'43000000-0000-0000-0000-000000000001');
SELECT informes_privados.iniciar_evaluacion(430,432,'43000000-0000-0000-0000-000000000002',(informes_privados.consultar(430,432)->>'id_documento')::bigint,1);
CREATE FUNCTION pg_temp.fallar_notificacion_s43() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.tipo='INFORME_FINAL_EVALUADO' THEN RAISE EXCEPTION USING ERRCODE='P4399',MESSAGE='synthetic notification failure'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER fallo_notificacion_s43 BEFORE INSERT ON public.notificacion FOR EACH ROW EXECUTE FUNCTION pg_temp.fallar_notificacion_s43();
DO $$ BEGIN
 BEGIN PERFORM informes_privados.resolver_evaluacion(430,432,'43000000-0000-0000-0000-000000000004','43000000-0000-0000-0000-000000000002','APROBADO',NULL); RAISE EXCEPTION 'notification failure not propagated'; EXCEPTION WHEN SQLSTATE 'P4399' THEN NULL; END;
 IF (SELECT estado FROM public.evaluacion_informe WHERE id_evaluacion='43000000-0000-0000-0000-000000000002') IS DISTINCT FROM 'EN_CURSO'
  OR (SELECT estado FROM public.informe_final WHERE id_practica=430) IS DISTINCT FROM 'EN_EVALUACION'
  OR EXISTS(SELECT 1 FROM public.evaluacion_evento WHERE tipo='RESUELTA') THEN RAISE EXCEPTION 'resolution partially committed'; END IF;
END $$;
CREATE FUNCTION pg_temp.fallar_asignacion_s43() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION USING ERRCODE='P4398',MESSAGE='synthetic assignment history failure'; END $$;
CREATE TRIGGER fallo_asignacion_s43 BEFORE INSERT ON public.historial_asignacion_docente FOR EACH ROW EXECUTE FUNCTION pg_temp.fallar_asignacion_s43();
DO $$ BEGIN
 BEGIN PERFORM docente_privado.fn_gestionar_asignacion(430,431,433,'Cambio sintético fallido'); RAISE EXCEPTION 'assignment failure not propagated'; EXCEPTION WHEN SQLSTATE 'P4398' THEN NULL; END;
 IF (SELECT id_docente FROM public.practica WHERE id_practica=430) IS DISTINCT FROM 432
  OR (SELECT estado FROM public.evaluacion_informe WHERE id_evaluacion='43000000-0000-0000-0000-000000000002') IS DISTINCT FROM 'EN_CURSO'
  OR (SELECT estado FROM public.informe_final WHERE id_practica=430) IS DISTINCT FROM 'EN_EVALUACION'
  OR EXISTS(SELECT 1 FROM public.evaluacion_evento WHERE tipo='INTERRUMPIDA') THEN RAISE EXCEPTION 'assignment/interruption partially committed'; END IF;
END $$;
SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;
