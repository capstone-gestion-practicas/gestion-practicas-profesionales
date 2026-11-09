-- E03: isolated S4.3 laboratory only. Practice 530 is a pre-upgrade closure.
-- Runs again after concurrency, including the new closure of practice 430.
BEGIN;
CREATE ROLE s43_e03_dml NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
GRANT USAGE ON SCHEMA public TO s43_e03_dml;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.historial_estado TO s43_e03_dml;
GRANT USAGE ON SEQUENCE public.historial_estado_id_historial_seq TO s43_e03_dml;
GRANT SELECT ON public.estado_practica TO s43_e03_dml;
CREATE POLICY e03_history_dml ON public.historial_estado TO s43_e03_dml USING(true) WITH CHECK(true);
CREATE POLICY e03_states_read ON public.estado_practica FOR SELECT TO s43_e03_dml USING(true);
CREATE TEMP TABLE e03_snapshot AS
 SELECT id_historial,to_jsonb(h) AS original FROM public.historial_estado h
 JOIN public.estado_practica ep ON ep.id_estado=h.id_estado
 WHERE h.id_practica IN (530,430) AND ep.nombre='FINALIZADA';
CREATE TEMP TABLE e03_closures AS SELECT id_cierre,to_jsonb(c) AS original
 FROM public.cierre_practica c WHERE id_practica IN (530,430);
GRANT SELECT ON e03_snapshot TO s43_e03_dml;
CREATE FUNCTION pg_temp.e03_ok(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
 BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'E03: %',label; END IF; END $$;
CREATE FUNCTION pg_temp.e03_error(statement text,code text,message text) RETURNS void LANGUAGE plpgsql AS $$
 BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
   IF SQLSTATE=code AND SQLERRM=message THEN RETURN; END IF;
   RAISE;
  END;
  RAISE EXCEPTION 'E03: write unexpectedly allowed';
 END $$;
SELECT pg_temp.e03_ok(EXISTS(SELECT 1 FROM e03_snapshot s JOIN public.historial_estado h USING(id_historial) WHERE h.id_practica=530),'legacy final history exists');
SELECT pg_temp.e03_ok(EXISTS(SELECT 1 FROM public.cierre_practica WHERE id_practica=530 AND id_evaluacion IS NULL),'legacy closure without fabricated evaluation');
SET LOCAL ROLE s43_e03_dml;
SELECT pg_temp.e03_ok((SELECT NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole FROM pg_roles WHERE rolname=current_user),'non-superuser without bypass');
SELECT pg_temp.e03_ok((SELECT relrowsecurity AND relowner<>current_user::regrole FROM pg_class WHERE oid='public.historial_estado'::regclass),'RLS enabled, caller not table owner');
SELECT pg_temp.e03_ok(has_table_privilege(current_user,'public.historial_estado','SELECT') AND has_table_privilege(current_user,'public.historial_estado','INSERT') AND has_table_privilege(current_user,'public.historial_estado','UPDATE') AND has_table_privilege(current_user,'public.historial_estado','DELETE'),'effective DML privileges');
SELECT pg_temp.e03_ok(NOT has_function_privilege(current_user,'public.fn_cerrar_practica(bigint,bigint,text)','EXECUTE') AND NOT pg_has_role(current_user,'pl_s43_cierre_owner','MEMBER'),'no private closure capability');
SELECT pg_temp.e03_ok((SELECT count(*) FROM public.historial_estado h JOIN e03_snapshot s USING(id_historial))=(SELECT count(*) FROM e03_snapshot),'final rows visible through RLS');
SELECT pg_temp.e03_error('DELETE FROM public.historial_estado WHERE id_historial IN (SELECT id_historial FROM e03_snapshot)','23514','HISTORIAL_FINALIZADA_INMUTABLE');
SELECT pg_temp.e03_error('UPDATE public.historial_estado SET id_estado=(SELECT id_estado FROM public.estado_practica WHERE nombre=''APROBADA'') WHERE id_historial IN (SELECT id_historial FROM e03_snapshot)','23514','HISTORIAL_FINALIZADA_INMUTABLE');
SELECT pg_temp.e03_error('UPDATE public.historial_estado SET id_estado=(SELECT id_estado FROM public.estado_practica WHERE nombre=''EN_CURSO'') WHERE id_historial IN (SELECT id_historial FROM e03_snapshot)','23514','HISTORIAL_FINALIZADA_INMUTABLE');
SELECT pg_temp.e03_error('UPDATE public.historial_estado SET observacion=''forged'',fecha_cambio=clock_timestamp(),id_usuario=532 WHERE id_historial IN (SELECT id_historial FROM e03_snapshot)','23514','HISTORIAL_FINALIZADA_INMUTABLE');
SELECT pg_temp.e03_error('UPDATE public.historial_estado SET id_estado=id_estado WHERE id_historial IN (SELECT id_historial FROM e03_snapshot)','23514','HISTORIAL_FINALIZADA_INMUTABLE');
-- Positive controls prove writes are not merely denied by ACL or RLS.
INSERT INTO public.historial_estado(id_practica,id_estado,id_usuario,observacion)
 SELECT 530,id_estado,531,'E03 control' FROM public.estado_practica WHERE nombre='APROBADA';
UPDATE public.historial_estado SET observacion='E03 control updated' WHERE observacion='E03 control' AND id_practica=530;
SELECT pg_temp.e03_ok(EXISTS(SELECT 1 FROM public.historial_estado WHERE observacion='E03 control updated' AND id_practica=530),'non-final insert/update unaffected');
SELECT pg_temp.e03_error('UPDATE public.historial_estado SET id_estado=(SELECT id_estado FROM public.estado_practica WHERE nombre=''FINALIZADA'') WHERE observacion=''E03 control updated'' AND id_practica=530','42501','FUNCION_PRIVADA_CIERRE_REQUERIDA');
SELECT pg_temp.e03_error('INSERT INTO public.historial_estado(id_practica,id_estado,id_usuario) SELECT 530,id_estado,531 FROM public.estado_practica WHERE nombre=''FINALIZADA''','42501','FUNCION_PRIVADA_CIERRE_REQUERIDA');
-- The CTE write precedes the forbidden delete and must be rolled back with it.
SELECT pg_temp.e03_error('WITH changed AS (UPDATE public.historial_estado SET observacion=''E03 must rollback'' WHERE observacion=''E03 control updated'' AND id_practica=530 RETURNING id_historial) DELETE FROM public.historial_estado WHERE id_historial IN (SELECT id_historial FROM e03_snapshot) AND EXISTS(SELECT 1 FROM changed)','23514','HISTORIAL_FINALIZADA_INMUTABLE');
SELECT pg_temp.e03_ok(EXISTS(SELECT 1 FROM public.historial_estado WHERE observacion='E03 control updated' AND id_practica=530) AND NOT EXISTS(SELECT 1 FROM public.historial_estado WHERE observacion='E03 must rollback'),'failed statement rolled back preceding write');
DELETE FROM public.historial_estado WHERE observacion='E03 control updated' AND id_practica=530;
SELECT pg_temp.e03_ok(NOT EXISTS(SELECT 1 FROM public.historial_estado WHERE observacion='E03 control updated' AND id_practica=530),'non-final delete unaffected');
RESET ROLE;
-- Installer toggles triggers only here, to test each guard independently.
ALTER TABLE public.historial_estado DISABLE TRIGGER a_s43_origen_historial;
SET LOCAL ROLE s43_e03_dml;
SELECT pg_temp.e03_error('DELETE FROM public.historial_estado WHERE id_historial IN (SELECT id_historial FROM e03_snapshot)','23514','HISTORIAL_FINALIZADA_INMUTABLE');
SELECT pg_temp.e03_error('UPDATE public.historial_estado SET id_estado=(SELECT id_estado FROM public.estado_practica WHERE nombre=''APROBADA'') WHERE id_historial IN (SELECT id_historial FROM e03_snapshot)','23514','HISTORIAL_FINALIZADA_INMUTABLE');
RESET ROLE;
ALTER TABLE public.historial_estado ENABLE TRIGGER a_s43_origen_historial;
ALTER TABLE public.historial_estado DISABLE TRIGGER s43_historial_final_validado;
SET LOCAL ROLE s43_e03_dml;
SELECT pg_temp.e03_error('DELETE FROM public.historial_estado WHERE id_historial IN (SELECT id_historial FROM e03_snapshot)','23514','HISTORIAL_FINALIZADA_INMUTABLE');
SELECT pg_temp.e03_error('UPDATE public.historial_estado SET id_estado=(SELECT id_estado FROM public.estado_practica WHERE nombre=''APROBADA'') WHERE id_historial IN (SELECT id_historial FROM e03_snapshot)','23514','HISTORIAL_FINALIZADA_INMUTABLE');
RESET ROLE;
ALTER TABLE public.historial_estado ENABLE TRIGGER s43_historial_final_validado;
SELECT pg_temp.e03_ok(NOT EXISTS(SELECT 1 FROM e03_snapshot s LEFT JOIN public.historial_estado h USING(id_historial) WHERE to_jsonb(h) IS DISTINCT FROM s.original),'final history byte-for-byte preserved');
SELECT pg_temp.e03_ok(NOT EXISTS(SELECT 1 FROM e03_closures s LEFT JOIN public.cierre_practica c USING(id_cierre) WHERE to_jsonb(c) IS DISTINCT FROM s.original),'old and new closures untouched');
SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;
-- No test grants, roles, policies or trigger toggles survive the test.
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='s43_e03_dml') THEN RAISE EXCEPTION 'E03 role survived rollback'; END IF; END $$;
