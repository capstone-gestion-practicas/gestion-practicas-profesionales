-- Synthetic PostgreSQL only. Seeded by run_pdf_docx.py; all these checks roll back.
BEGIN;
CREATE FUNCTION pg_temp.pd_ok(value boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF value IS NOT TRUE THEN RAISE EXCEPTION 'PDF/DOCX assertion: %',label; END IF; END $$;
CREATE FUNCTION pg_temp.pd_error(source text,expected text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE source; EXCEPTION WHEN OTHERS THEN IF SQLSTATE=expected THEN RETURN; END IF; RAISE; END;
 RAISE EXCEPTION 'Expected %',expected;
END $$;
SET LOCAL ROLE pl_s42_executor;
-- A pre-migration pending reservation still confirms with the old signature.
SELECT pg_temp.pd_ok(informes_privados.reservar(1430,1430,'dd000000-0000-0000-0000-000000000002',1,repeat('b',64),'pending.pdf',6)->>'formato'='PDF','legacy pending retry');
SELECT pg_temp.pd_ok(informes_privados.confirmar(1430,1430,'dd000000-0000-0000-0000-000000000002')->>'version'='2','legacy pending confirmation');
-- New DOCX, exact retries, and conflicts across formats including the legacy adapter.
SELECT pg_temp.pd_ok(informes_privados.reservar(1433,1430,'dd000000-0000-0000-0000-000000000010',0,repeat('c',64),'first.docx',7,'DOCX')->>'objeto'='practicas/1433/informes/dd000000-0000-0000-0000-000000000010.docx','canonical DOCX key');
SELECT pg_temp.pd_ok(informes_privados.reservar(1433,1430,'dd000000-0000-0000-0000-000000000010',0,repeat('c',64),'first.docx',7,'DOCX')->>'formato'='DOCX','pending retry');
SELECT pg_temp.pd_error($q$SELECT informes_privados.reservar(1433,1430,'dd000000-0000-0000-0000-000000000010',0,repeat('c',64),'first.docx',7,'PDF')$q$,'P0409');
SELECT pg_temp.pd_error($q$SELECT informes_privados.reservar(1433,1430,'dd000000-0000-0000-0000-000000000010',0,repeat('c',64),'first.docx',7)$q$,'P0409');
SELECT pg_temp.pd_error($q$SELECT informes_privados.reservar(1433,1430,'dd000000-0000-0000-0000-000000000011',0,repeat('c',64),'x',7,'DOCM')$q$,'22023');
SELECT pg_temp.pd_error($q$SELECT informes_privados.reservar(1433,1430,'dd000000-0000-0000-0000-000000000011',0,repeat('c',64),'x',7,NULL)$q$,'22023');
SELECT pg_temp.pd_ok(informes_privados.confirmar(1433,1430,'dd000000-0000-0000-0000-000000000010')->>'version'='1','first DOCX');
SELECT pg_temp.pd_ok(informes_privados.confirmar(1433,1430,'dd000000-0000-0000-0000-000000000010')->>'version'='1','confirmed retry');
SELECT pg_temp.pd_ok(informes_privados.consultar(1433,1432)->>'formato'='DOCX','assigned teacher reads DOCX');
SELECT pg_temp.pd_ok(informes_privados.archivo(1433,1431)->>'mime_type'='application/vnd.openxmlformats-officedocument.wordprocessingml.document','assigned gestor MIME');
SELECT pg_temp.pd_ok((informes_privados.consultar(1449,1430)->>'formato') IS NULL,'no delivery has no format');
-- PDF -> DOCX -> PDF; historic objects and original bytes are not overwritten.
SELECT informes_privados.reservar(1430,1430,'dd000000-0000-0000-0000-000000000003',2,repeat('d',64),'next.docx',8,'DOCX');
SELECT pg_temp.pd_ok(informes_privados.confirmar(1430,1430,'dd000000-0000-0000-0000-000000000003')->>'version'='3','PDF to DOCX');
SELECT informes_privados.reservar(1430,1430,'dd000000-0000-0000-0000-000000000004',3,repeat('e',64),'next.pdf',9,'PDF');
SELECT pg_temp.pd_ok(informes_privados.confirmar(1430,1430,'dd000000-0000-0000-0000-000000000004')->>'version'='4','DOCX to PDF');
SELECT pg_temp.pd_ok(informes_privados.archivo(1430,1430)->>'mime_type'='application/pdf','PDF MIME restored');
-- SQL keeps the S4.3 authorization barrier and never grants academic access to admin.
SELECT pg_temp.pd_error('SELECT informes_privados.consultar(1433,1434)','42501');
SELECT pg_temp.pd_error($q$SELECT informes_privados.reservar(1433,1431,'dd000000-0000-0000-0000-000000000019',1,repeat('f',64),'x.docx',5,'DOCX')$q$,'42501');
SELECT pg_temp.pd_error($q$SELECT informes_privados.reservar(1431,1430,'dd000000-0000-0000-0000-000000000019',1,repeat('f',64),'x.docx',5,'DOCX')$q$,'P0409');
RESET ROLE;
DO $$ DECLARE d bigint; mime text; BEGIN
 SELECT id_documento INTO d FROM public.informe_final WHERE id_practica=1433;
 SELECT mime_type INTO mime FROM public.documento WHERE id_documento=d;
 PERFORM pg_temp.pd_ok(mime='application/vnd.openxmlformats-officedocument.wordprocessingml.document','persisted MIME');
 PERFORM pg_temp.pd_ok((SELECT count(*)=4 FROM public.informe_entrega WHERE id_practica=1430 AND estado='CONFIRMADA'),'four immutable versions');
 PERFORM pg_temp.pd_ok((SELECT count(*)=2 FROM public.notificacion WHERE id_practica=1433 AND tipo='INFORME_FINAL_ENTREGADO'),'no duplicate notifications');
END $$;
-- Effective DML attempts under a non-superuser, with sufficient ACL/RLS to reach triggers.
CREATE ROLE pd_metadata_writer NOLOGIN NOSUPERUSER NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO pd_metadata_writer;
GRANT SELECT,UPDATE,DELETE ON public.documento,public.informe_entrega TO pd_metadata_writer;
CREATE POLICY pd_test_writer ON public.documento TO pd_metadata_writer USING(true) WITH CHECK(true);
CREATE POLICY pd_test_writer ON public.informe_entrega TO pd_metadata_writer USING(true) WITH CHECK(true);
SET LOCAL ROLE pd_metadata_writer;
SELECT pg_temp.pd_ok(NOT (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname=current_user),'effective unprivileged writer');
SELECT pg_temp.pd_error($q$UPDATE public.documento SET mime_type='application/pdf' WHERE id_documento=(SELECT id_documento FROM public.informe_entrega WHERE id_practica=1433 AND estado='CONFIRMADA')$q$,'23514');
SELECT pg_temp.pd_error($q$DELETE FROM public.documento WHERE id_documento=(SELECT id_documento FROM public.informe_entrega WHERE id_practica=1433 AND estado='CONFIRMADA')$q$,'23514');
SELECT pg_temp.pd_error($q$UPDATE public.informe_entrega SET formato='PDF' WHERE id_practica=1433 AND estado='CONFIRMADA'$q$,'23514');
SELECT pg_temp.pd_error($q$DELETE FROM public.informe_entrega WHERE id_practica=1433$q$,'23514');
RESET ROLE;
-- The private executor has no DML, clients no RPC, helpers remain private.
DO $$ DECLARE r text; f record; BEGIN
 PERFORM pg_temp.pd_ok(has_function_privilege('pl_s42_executor','informes_privados.reservar(bigint,bigint,uuid,bigint,text,text,bigint)','EXECUTE'),'old EXECUTE');
 PERFORM pg_temp.pd_ok(has_function_privilege('pl_s42_executor','informes_privados.reservar(bigint,bigint,uuid,bigint,text,text,bigint,text)','EXECUTE'),'new EXECUTE');
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  PERFORM pg_temp.pd_ok(NOT has_schema_privilege(r,'informes_privados','USAGE'),'client schema denied');
  FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='informes_privados' LOOP
   PERFORM pg_temp.pd_ok(NOT has_function_privilege(r,f.oid,'EXECUTE'),'client function denied');
  END LOOP;
 END LOOP;
 FOR f IN SELECT p.oid,p.proname,p.prosecdef,p.proowner,p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='informes_privados' AND p.proname IN ('reservar','proteger_formato_entrega','proteger_documento_confirmado','comprobar_formato_confirmado') LOOP
  PERFORM pg_temp.pd_ok(f.prosecdef AND f.proowner='pl_s42_owner'::regrole AND 'search_path=pg_catalog, pg_temp'=ANY(f.proconfig),'owner and search path');
  IF f.proname<>'reservar' THEN PERFORM pg_temp.pd_ok(NOT has_function_privilege('pl_s42_executor',f.oid,'EXECUTE'),'helper EXECUTE denied'); END IF;
 END LOOP;
 FOREACH r IN ARRAY ARRAY['informe_entrega','informe_final','documento'] LOOP
  PERFORM pg_temp.pd_ok((SELECT relrowsecurity FROM pg_class WHERE oid=('public.'||r)::regclass),'RLS remains enabled');
  PERFORM pg_temp.pd_ok(NOT has_table_privilege('pl_s42_executor','public.'||r,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AND NOT has_any_column_privilege('pl_s42_executor','public.'||r,'SELECT,INSERT,UPDATE'),'no executor DML');
 END LOOP;
END $$;
SET LOCAL ROLE pl_s42_executor;
SELECT pg_temp.pd_error('SELECT * FROM public.informe_entrega','42501');
SELECT pg_temp.pd_error('UPDATE public.documento SET activo=false','42501');
SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;

-- Failure in a confirmed DOCX notification rolls back document/version/delivery.
BEGIN;
CREATE FUNCTION pg_temp.pd_fail_notification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION USING ERRCODE='P4991',MESSAGE='synthetic notification failure'; END $$;
CREATE TRIGGER pd_fail_notification BEFORE INSERT ON public.notificacion FOR EACH ROW EXECUTE FUNCTION pg_temp.pd_fail_notification();
SET LOCAL ROLE pl_s42_executor;
SELECT informes_privados.reservar(1430,1430,'dd000000-0000-0000-0000-000000000099',1,repeat('f',64),'rollback.docx',5,'DOCX');
DO $$ BEGIN
 BEGIN PERFORM informes_privados.confirmar(1430,1430,'dd000000-0000-0000-0000-000000000099'); RAISE EXCEPTION 'failure not propagated'; EXCEPTION WHEN SQLSTATE 'P4991' THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT version FROM public.informe_final WHERE id_practica=1430)<>1
  OR (SELECT estado FROM public.informe_entrega WHERE id_entrega='dd000000-0000-0000-0000-000000000099')<>'RESERVADA'
  OR (SELECT count(*) FROM public.documento WHERE id_practica=1430)<>1
  OR NOT (SELECT activo FROM public.documento WHERE id_practica=1430)
 THEN RAISE EXCEPTION 'DOCX confirmation partially committed'; END IF;
END $$;
-- Freeze identity of pending deliveries without obstructing expiration and cleanup.
SET LOCAL ROLE pl_s42_owner;
DO $$ BEGIN
 BEGIN UPDATE public.informe_entrega SET formato='PDF' WHERE id_entrega='dd000000-0000-0000-0000-000000000099'; RAISE EXCEPTION 'pending identity changed'; EXCEPTION WHEN SQLSTATE '23514' THEN NULL; END;
END $$;
UPDATE public.informe_entrega SET vence=clock_timestamp()-interval '1 minute' WHERE id_entrega='dd000000-0000-0000-0000-000000000099';
SET LOCAL ROLE pl_s42_executor;
DO $$ DECLARE result jsonb; BEGIN
 result:=informes_privados.limpieza();
 IF NOT result @> '["practicas/1430/informes/dd000000-0000-0000-0000-000000000099.docx"]'::jsonb THEN RAISE EXCEPTION 'DOCX cleanup missing'; END IF;
END $$;
SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;

-- An unexpected MIME written during confirmation must fail at deferred validation,
-- with the previous current version and all original metadata restored.
BEGIN;
CREATE FUNCTION pg_temp.pd_corrupt_mime() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.mime_type:='application/pdf'; RETURN NEW; END $$;
CREATE TRIGGER pd_corrupt_mime BEFORE INSERT ON public.documento FOR EACH ROW EXECUTE FUNCTION pg_temp.pd_corrupt_mime();
SET LOCAL ROLE pl_s42_executor;
SELECT informes_privados.reservar(1430,1430,'dd000000-0000-0000-0000-000000000098',1,repeat('f',64),'mismatch.docx',5,'DOCX');
DO $$ BEGIN
 BEGIN
  PERFORM informes_privados.confirmar(1430,1430,'dd000000-0000-0000-0000-000000000098');
  SET CONSTRAINTS ALL IMMEDIATE;
 EXCEPTION WHEN SQLSTATE '23514' THEN RETURN;
 END;
 RAISE EXCEPTION 'MIME mismatch accepted';
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT version FROM public.informe_final WHERE id_practica=1430)<>1
  OR (SELECT estado FROM public.informe_entrega WHERE id_entrega='dd000000-0000-0000-0000-000000000098')<>'RESERVADA'
  OR (SELECT count(*) FROM public.documento WHERE id_practica=1430)<>1
 THEN RAISE EXCEPTION 'invalid MIME confirmation partially committed'; END IF;
END $$;
SET LOCAL ROLE pl_s42_owner;
DO $$ BEGIN
 BEGIN
  INSERT INTO public.informe_entrega(id_entrega,id_practica,id_actor,esperado,sha256,tamano,nombre,objeto,formato)
   VALUES('dd000000-0000-0000-0000-000000000097',1430,1430,1,repeat('f',64),5,'bad.docm','synthetic-invalid.docm','DOCM');
 EXCEPTION WHEN SQLSTATE '23514' THEN RETURN;
 END;
 RAISE EXCEPTION 'format table constraint bypassed';
END $$;
ROLLBACK;
