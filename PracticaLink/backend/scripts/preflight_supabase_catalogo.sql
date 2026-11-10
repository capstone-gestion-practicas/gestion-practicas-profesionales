-- SOLO LECTURA. No demuestra equivalencia ni autoriza registrar/aplicar migraciones.
-- psql -X -v ON_ERROR_STOP=1; dirigir salida a archivo privado (umask 077).
\set ON_ERROR_STOP on
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='5s';
SET LOCAL lock_timeout='1s';
SET LOCAL idle_in_transaction_session_timeout='10s';
SET LOCAL search_path=pg_catalog;
SELECT current_setting('server_version_num') AS version,
       current_setting('transaction_read_only') AS read_only;
SELECT nspname AS schema_name FROM pg_namespace
WHERE nspname IN ('practicas_privadas','seguimientos_privados','docente_privado','informes_privados','incidencias_privadas') ORDER BY 1;
SELECT c.relname AS relation,a.attname AS column_name,format_type(a.atttypid,a.atttypmod) AS type,
       a.attnotnull FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN ('practica','informe_entrega','cierre_practica','incidencia')
AND a.attname IN ('id_gestor','id_docente','horas_semanales','formato','id_evaluacion','id_tipo_incidencia')
AND NOT a.attisdropped ORDER BY 1,2;
SELECT c.relname,k.conname,k.contype,k.convalidated,md5(pg_get_constraintdef(k.oid)) AS definition_hash
FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN ('practica','incidencia','cierre_practica','recordatorio_cierre_practica') ORDER BY 1,2;
SELECT c.relname,t.tgname,t.tgenabled,p.proname,p.prosecdef,pg_get_userbyid(p.proowner) AS owner,
       md5(pg_get_functiondef(p.oid)) AS function_hash,md5(pg_get_triggerdef(t.oid)) AS trigger_hash
FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
JOIN pg_proc p ON p.oid=t.tgfoid
WHERE n.nspname='public' AND c.relname IN ('practica','historial_estado','incidencia')
AND NOT t.tgisinternal ORDER BY 1,2;
ROLLBACK;
