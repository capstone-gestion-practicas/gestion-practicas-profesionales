-- Read-only; run only after commit. Does not invoke business functions or read accounts.
\set ON_ERROR_STOP on
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='5s';
SET LOCAL search_path=pg_catalog;
SELECT count(*)=27 AS exactly_27_versions FROM supabase_migrations.schema_migrations;
SELECT nspname FROM pg_namespace WHERE nspname IN ('practicas_privadas','seguimientos_privados','docente_privado','informes_privados','incidencias_privadas') ORDER BY 1;
SELECT x.name,to_regclass(x.name) IS NOT NULL AS present FROM unnest(ARRAY[
 'public.historial_asignacion_docente','public.informe_final','public.informe_entrega',
 'public.evaluacion_informe','public.evaluacion_evento','public.tipo_incidencia','public.historial_estado_incidencia']) x(name);
SELECT x.name,a.attnotnull,format_type(a.atttypid,a.atttypmod) FROM unnest(ARRAY['id_docente','id_gestor']) x(name)
JOIN pg_attribute a ON a.attrelid='public.practica'::regclass AND a.attname=x.name AND NOT a.attisdropped;
SELECT conname,convalidated,md5(pg_get_constraintdef(oid)) FROM pg_constraint
WHERE conrelid IN ('public.practica'::regclass,'public.informe_entrega'::regclass,'public.evaluacion_informe'::regclass) ORDER BY 1;
SELECT c.relname,t.tgname,t.tgenabled FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal
AND c.relname IN ('practica','historial_estado','cierre_practica','documento','informe_final','informe_entrega','evaluacion_informe','evaluacion_evento') ORDER BY 1,2;
SELECT pg_get_userbyid(p.proowner)='pl_s43_cierre_owner' AND p.prosecdef AS private_closure_owner
FROM pg_proc p WHERE p.oid='public.fn_cerrar_practica(bigint,bigint,text)'::regprocedure;
SELECT c.relname,c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN ('practica','documento','informe_final','informe_entrega','evaluacion_informe','evaluacion_evento','incidencia','historial_estado_incidencia');
SELECT r.rolname,has_function_privilege(r.oid,'public.fn_cerrar_practica(bigint,bigint,text)','EXECUTE') AS client_execute_must_be_false
FROM pg_roles r WHERE r.rolname IN ('anon','authenticated','service_role');
SELECT r.rolname,a.inherit_option,a.set_option FROM pg_auth_members a JOIN pg_roles r ON r.oid=a.roleid
WHERE a.member=(SELECT oid FROM pg_roles WHERE rolname=current_user) AND left(r.rolname,3)='pl_' AND (a.inherit_option OR a.set_option);
ROLLBACK;
