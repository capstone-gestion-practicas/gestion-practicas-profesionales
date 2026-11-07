-- Synthetic database only, all migrations applied. psql -X -v ON_ERROR_STOP=1.
BEGIN;
INSERT INTO public.usuario(id_usuario,nombre,apellido,correo,password_hash)
SELECT id,'Sintético','S42','s42-'||id||'@example.invalid','synthetic' FROM generate_series(880,887) id;
INSERT INTO public.usuario_rol SELECT id,id_rol FROM (VALUES(880,'ESTUDIANTE'),(881,'GESTOR'),(882,'DOCENTE'),(883,'ADMINISTRADOR'),(884,'ESTUDIANTE'),(885,'DOCENTE'),(886,'GESTOR'),(887,'DOCENTE'),(880,'ADMINISTRADOR')) x(id,nombre) JOIN public.rol USING(nombre);
INSERT INTO public.estudiante(id_estudiante,id_usuario,rut,carrera,sede) VALUES(880,880,'11111111-1','Sintética','Alameda');
INSERT INTO public.centro_practica(id_centro,nombre) VALUES(880,'Centro sintético');
INSERT INTO public.practica(id_practica,id_estudiante,id_centro,id_estado_actual,id_gestor,id_docente,fecha_termino)
SELECT 880,880,880,id_estado,881,882,(clock_timestamp() AT TIME ZONE 'America/Santiago')::date FROM public.estado_practica WHERE nombre='EN_CURSO';
CREATE FUNCTION pg_temp.assert_true(ok boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'S42 assertion failed'; END IF; END $$;
CREATE FUNCTION pg_temp.expect_error(source text, code text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE source; EXCEPTION WHEN OTHERS THEN IF SQLSTATE=code THEN RETURN; END IF; RAISE; END;
 RAISE EXCEPTION 'expected SQLSTATE %: %',code,source;
END $$;
SET LOCAL ROLE pl_s42_executor;
SELECT pg_temp.assert_true(informes_privados.consultar(880,880)->>'estado'='SIN_ENTREGAR');
SELECT pg_temp.assert_true((informes_privados.consultar(880,880)->>'habilitada')::boolean);
DO $$ DECLARE a bigint; BEGIN
 FOREACH a IN ARRAY ARRAY[883,884,885,886] LOOP
  PERFORM pg_temp.expect_error(format('SELECT informes_privados.consultar(880,%s)',a),'42501');
 END LOOP;
 FOREACH a IN ARRAY ARRAY[881,882,883] LOOP
  PERFORM pg_temp.expect_error(format('SELECT informes_privados.reservar(880,%s,''00000000-0000-0000-0000-000000000009'',0,repeat(''a'',64),''informe.pdf'',5)',a),'42501');
 END LOOP;
END $$;
SELECT pg_temp.assert_true(informes_privados.reservar(880,880,'00000000-0000-0000-0000-000000000001',0,repeat('a',64),'informe.pdf',5)->>'estado'='RESERVADA');
SELECT pg_temp.assert_true(informes_privados.consultar(880,880)->>'estado'='SIN_ENTREGAR');
SELECT pg_temp.assert_true(informes_privados.confirmar(880,880,'00000000-0000-0000-0000-000000000001')->>'version'='1');
SELECT pg_temp.assert_true(informes_privados.confirmar(880,880,'00000000-0000-0000-0000-000000000001')->>'version'='1');
SELECT pg_temp.assert_true(informes_privados.archivo(880,881)->>'sha256'=repeat('a',64));
SELECT pg_temp.assert_true(informes_privados.archivo(880,882)->>'version'='1');
SELECT pg_temp.expect_error('SELECT informes_privados.reservar(880,880,''00000000-0000-0000-0000-000000000001'',0,repeat(''b'',64),''informe.pdf'',5)','P0409');
SELECT informes_privados.reservar(880,880,'00000000-0000-0000-0000-000000000002',1,repeat('b',64),'nuevo.pdf',6);
SELECT pg_temp.assert_true(informes_privados.confirmar(880,880,'00000000-0000-0000-0000-000000000002')->>'version'='2');
SELECT pg_temp.expect_error('SELECT informes_privados.reservar(880,880,''00000000-0000-0000-0000-000000000003'',0,repeat(''c'',64),''nuevo.pdf'',6)','P0409');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM public.informe_entrega WHERE estado='CONFIRMADA'));
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.documento WHERE id_practica=880 AND activo));
SELECT pg_temp.assert_true((SELECT count(*)=4 FROM public.notificacion WHERE id_practica=880 AND tipo='INFORME_FINAL_ENTREGADO'));
-- Account/role activity and completed practices are independently enforced.
UPDATE public.usuario SET activo=false WHERE id_usuario=880;
SET LOCAL ROLE pl_s42_executor;
SELECT pg_temp.expect_error('SELECT informes_privados.consultar(880,880)','42501');
RESET ROLE;
UPDATE public.usuario SET activo=true WHERE id_usuario=880;
UPDATE public.rol SET activo=false WHERE nombre='DOCENTE';
SET LOCAL ROLE pl_s42_executor;
SELECT pg_temp.expect_error('SELECT informes_privados.archivo(880,882)','42501');
SELECT pg_temp.expect_error('SELECT informes_privados.reservar(880,880,''00000000-0000-0000-0000-000000000003'',2,repeat(''c'',64),''nuevo.pdf'',6)','P0409');
RESET ROLE;
UPDATE public.rol SET activo=true WHERE nombre='DOCENTE';
SAVEPOINT s42_finalizada;
INSERT INTO public.cierre_practica(id_practica,id_usuario,resultado) VALUES(880,881,'APROBADA');
UPDATE public.practica SET id_estado_actual=(SELECT id_estado FROM public.estado_practica WHERE nombre='FINALIZADA') WHERE id_practica=880;
SET LOCAL ROLE pl_s42_executor;
SELECT pg_temp.expect_error('SELECT informes_privados.reservar(880,880,''00000000-0000-0000-0000-000000000003'',2,repeat(''c'',64),''nuevo.pdf'',6)','P0409');
RESET ROLE;
ROLLBACK TO SAVEPOINT s42_finalizada;
-- Reassignment changes access without deleting any report/version.
UPDATE public.practica SET id_docente=885 WHERE id_practica=880;
SET LOCAL ROLE pl_s42_executor;
SELECT pg_temp.expect_error('SELECT informes_privados.archivo(880,882)','42501');
SELECT pg_temp.assert_true(informes_privados.archivo(880,885)->>'version'='2');
RESET ROLE;
UPDATE public.usuario SET activo=false WHERE id_usuario=885;
SET LOCAL ROLE pl_s42_executor;
SELECT pg_temp.expect_error('SELECT informes_privados.archivo(880,885)','42501');
SELECT pg_temp.expect_error('SELECT informes_privados.reservar(880,880,''00000000-0000-0000-0000-000000000003'',2,repeat(''c'',64),''nuevo.pdf'',6)','P0409');
RESET ROLE;
UPDATE public.usuario SET activo=true WHERE id_usuario=885;
UPDATE public.practica SET fecha_termino=(clock_timestamp() AT TIME ZONE 'America/Santiago')::date+1 WHERE id_practica=880;
SET LOCAL ROLE pl_s42_executor;
SELECT pg_temp.expect_error('SELECT informes_privados.reservar(880,880,''00000000-0000-0000-0000-000000000003'',2,repeat(''c'',64),''nuevo.pdf'',6)','P0409');
RESET ROLE;
UPDATE public.practica SET fecha_termino=(clock_timestamp() AT TIME ZONE 'America/Santiago')::date,id_docente=NULL WHERE id_practica=880;
SET LOCAL ROLE pl_s42_executor;
SELECT pg_temp.expect_error('SELECT informes_privados.reservar(880,880,''00000000-0000-0000-0000-000000000003'',2,repeat(''c'',64),''nuevo.pdf'',6)','P0409');
RESET ROLE;
UPDATE public.practica SET id_docente=885,id_estado_actual=(SELECT id_estado FROM public.estado_practica WHERE nombre='APROBADA') WHERE id_practica=880;
SET LOCAL ROLE pl_s42_executor;
SELECT pg_temp.expect_error('SELECT informes_privados.reservar(880,880,''00000000-0000-0000-0000-000000000003'',2,repeat(''c'',64),''nuevo.pdf'',6)','P0409');
RESET ROLE;
UPDATE public.practica SET id_estado_actual=(SELECT id_estado FROM public.estado_practica WHERE nombre='EN_CURSO') WHERE id_practica=880;
SET LOCAL ROLE pl_s42_executor;
SELECT informes_privados.reservar(880,880,'00000000-0000-0000-0000-000000000003',2,repeat('c',64),'nuevo.pdf',6);
RESET ROLE;
-- Simulated S4.3 writer follows practice -> report lock order; no evaluation implemented.
SELECT id_practica FROM public.practica WHERE id_practica=880 FOR UPDATE;
UPDATE public.informe_final SET estado='EN_EVALUACION' WHERE id_practica=880;
SET LOCAL ROLE pl_s42_executor;
SELECT pg_temp.expect_error('SELECT informes_privados.confirmar(880,880,''00000000-0000-0000-0000-000000000003'')','P0409');
RESET ROLE;
SELECT pg_temp.expect_error('UPDATE public.informe_final SET estado=''ENTREGADO'' WHERE id_practica=880','P0409');
UPDATE public.informe_entrega SET vence=clock_timestamp()-interval '1 second' WHERE estado='RESERVADA';
SET LOCAL ROLE pl_s42_executor;
SELECT pg_temp.assert_true(jsonb_array_length(informes_privados.limpieza())=1);
SELECT pg_temp.assert_true(jsonb_array_length(informes_privados.limpieza())=0);
SELECT pg_temp.expect_error('SELECT * FROM public.documento','42501');
RESET ROLE;
SET LOCAL ROLE pl_s42_owner;
SELECT id_usuario FROM public.usuario WHERE id_usuario=880 FOR SHARE;
SELECT pg_temp.expect_error('UPDATE public.usuario SET id_usuario=id_usuario WHERE id_usuario=880','42501');
SELECT pg_temp.expect_error('UPDATE public.usuario_rol SET id_rol=id_rol WHERE id_usuario=880','42501');
SELECT pg_temp.expect_error('UPDATE public.rol SET id_rol=id_rol WHERE nombre=''DOCENTE''','42501');
SELECT pg_temp.expect_error('UPDATE public.practica SET id_practica=id_practica WHERE id_practica=880','42501');
RESET ROLE;
DO $$ DECLARE c text; f record; BEGIN
 FOREACH c IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF has_schema_privilege(c,'informes_privados','USAGE') THEN RAISE EXCEPTION 'schema exposed'; END IF;
  FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='informes_privados' LOOP
   IF has_function_privilege(c,f.oid,'EXECUTE') THEN RAISE EXCEPTION 'function exposed'; END IF;
  END LOOP;
 END LOOP;
END $$;
ROLLBACK;
-- Second transaction: failure in notification must roll back the entire confirmation.
BEGIN;
INSERT INTO public.usuario(id_usuario,nombre,apellido,correo,password_hash) SELECT id,'Sintético','Rollback','rollback-'||id||'@example.invalid','synthetic' FROM generate_series(880,882) id;
INSERT INTO public.usuario_rol SELECT id,id_rol FROM (VALUES(880,'ESTUDIANTE'),(881,'GESTOR'),(882,'DOCENTE')) x(id,nombre) JOIN public.rol USING(nombre);
INSERT INTO public.estudiante(id_estudiante,id_usuario,rut,carrera,sede) VALUES(880,880,'11111111-1','Sintética','Alameda');
INSERT INTO public.centro_practica(id_centro,nombre) VALUES(880,'Centro sintético');
INSERT INTO public.practica(id_practica,id_estudiante,id_centro,id_estado_actual,id_gestor,id_docente,fecha_termino) SELECT 880,880,880,id_estado,881,882,(clock_timestamp() AT TIME ZONE 'America/Santiago')::date FROM public.estado_practica WHERE nombre='EN_CURSO';
SELECT informes_privados.reservar(880,880,'00000000-0000-0000-0000-000000000001',0,repeat('a',64),'informe.pdf',5);
CREATE FUNCTION pg_temp.fail_s42() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION USING ERRCODE='P4099',MESSAGE='synthetic notification failure'; END $$;
CREATE TRIGGER fail_s42 BEFORE INSERT ON public.notificacion FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_s42();
DO $$ BEGIN
 BEGIN PERFORM informes_privados.confirmar(880,880,'00000000-0000-0000-0000-000000000001'); RAISE EXCEPTION 'confirmation did not fail'; EXCEPTION WHEN SQLSTATE 'P4099' THEN NULL; END;
 IF EXISTS(SELECT 1 FROM public.documento WHERE id_practica=880) OR EXISTS(SELECT 1 FROM public.informe_final WHERE id_practica=880) THEN RAISE EXCEPTION 'partial commit'; END IF;
 IF (SELECT estado FROM public.informe_entrega WHERE id_practica=880) IS DISTINCT FROM 'RESERVADA' THEN RAISE EXCEPTION 'reservation lost'; END IF;
END $$;
ROLLBACK;
