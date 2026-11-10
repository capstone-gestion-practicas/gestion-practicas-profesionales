-- SOLO LECTURA; todos los booleanos se revisan, no se ejecutan funciones de negocio.
\set ON_ERROR_STOP on
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='5s';
SET LOCAL lock_timeout='1s';
SET LOCAL search_path=pg_catalog;
SELECT x.name,to_regclass(x.name) IS NOT NULL AS present
FROM unnest(ARRAY['public.historial_asignacion_docente','public.informe_final','public.informe_entrega',
 'public.evaluacion_informe','public.evaluacion_evento','public.tipo_incidencia','public.historial_estado_incidencia']) x(name);
SELECT e.signature,p.oid IS NOT NULL AS present,pg_get_userbyid(p.proowner) AS owner,p.prosecdef,
       r.rolname AS client,has_function_privilege(r.oid,p.oid,'EXECUTE') AS client_execute
FROM unnest(ARRAY[
 'informes_privados.reservar(bigint,bigint,uuid,bigint,text,text,bigint)',
 'informes_privados.reservar(bigint,bigint,uuid,bigint,text,text,bigint,text)',
 'informes_privados.iniciar_evaluacion(bigint,bigint,uuid,bigint,bigint)',
 'informes_privados.resolver_evaluacion(bigint,bigint,uuid,uuid,text,text)',
 'public.fn_cerrar_practica(bigint,bigint,text)']) e(signature)
LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
CROSS JOIN pg_roles r WHERE r.rolname IN ('anon','authenticated','service_role') ORDER BY 1,4;
SELECT n.nspname,c.relname,c.relrowsecurity AS rls,c.relforcerowsecurity AS force_rls
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN ('usuario','rol','usuario_rol','practica','documento',
 'historial_asignacion_docente','informe_final','informe_entrega','evaluacion_informe','evaluacion_evento',
 'incidencia','historial_estado_incidencia','tipo_incidencia') ORDER BY 1,2;
SELECT c.relname,t.tgname,t.tgenabled,md5(pg_get_triggerdef(t.oid)) AS definition_hash
FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN ('practica','cierre_practica','historial_estado',
 'evaluacion_informe','evaluacion_evento','documento','informe_entrega') AND NOT t.tgisinternal ORDER BY 1,2;
ROLLBACK;
