-- PDF + DOCX, SQL only. Apply atomically; no Storage provisioning or payload validation.
-- Forward-only: never restore a closure function predating S4.3.
-- Actor parameters remain exclusively supplied by the JWT-validating backend.
ALTER TABLE public.informe_entrega ADD COLUMN formato text NOT NULL DEFAULT 'PDF';
ALTER TABLE public.informe_entrega ADD CONSTRAINT informe_entrega_formato CHECK(formato IN ('PDF','DOCX'));
COMMENT ON COLUMN public.informe_entrega.formato IS 'Canonical validated format, immutable from reservation; historical deliveries are PDF.';
UPDATE public.tipo_documento SET descripcion='Informe final PDF o DOCX versionado' WHERE nombre='INFORME_FINAL';

CREATE FUNCTION informes_privados.reservar(p bigint,a bigint,k uuid,v bigint,h text,n text,b bigint,f text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c jsonb; r public.informe_entrega;
BEGIN
 IF f IS NULL OR f NOT IN ('PDF','DOCX') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='FORMATO_INVALIDO'; END IF;
 c:=informes_privados.autorizar(p,a,false);
 IF (c->>'propietario_estudiante')::boolean IS NOT TRUE THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='SOLO_ESTUDIANTE'; END IF;
 SELECT * INTO r FROM public.informe_entrega WHERE id_entrega=k;
 IF FOUND THEN
  IF ROW(r.id_practica,r.id_actor,r.esperado,r.sha256,r.nombre,r.tamano,r.formato) IS DISTINCT FROM ROW(p,a,v,h,n,b,f) THEN RAISE EXCEPTION USING ERRCODE='P0409',MESSAGE='IDEMPOTENCIA_CONFLICTO'; END IF;
  IF r.estado='CONFIRMADA' THEN RETURN to_jsonb(r); END IF;
  IF r.estado<>'RESERVADA' OR r.vence<clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='P0409',MESSAGE='RESERVA_VENCIDA'; END IF;
 END IF;
 c:=informes_privados.autorizar(p,a,true);
 IF (c->>'version')::bigint<>v THEN RAISE EXCEPTION USING ERRCODE='P0409',MESSAGE='VERSION_CONFLICTO'; END IF;
 IF r.id_entrega IS NULL THEN
  INSERT INTO public.informe_entrega(id_entrega,id_practica,id_actor,esperado,sha256,nombre,tamano,objeto,formato) VALUES(k,p,a,v,h,n,b,'practicas/'||p||'/informes/'||k||CASE f WHEN 'PDF' THEN '.pdf' ELSE '.docx' END,f) RETURNING * INTO r;
 END IF;
 RETURN to_jsonb(r);
END $$;

-- Preserve the seven-argument signature and its parameter names for S4.2 callers.
-- No DEFAULT argument: overload resolution must remain unambiguous.
CREATE OR REPLACE FUNCTION informes_privados.reservar(p bigint,a bigint,k uuid,v bigint,h text,n text,b bigint) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT informes_privados.reservar(p,a,k,v,h,n,b,'PDF'::text)
$$;

CREATE OR REPLACE FUNCTION informes_privados.confirmar(p bigint,a bigint,k uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c jsonb; r public.informe_entrega; doc bigint; destinatario bigint;
BEGIN
 c:=informes_privados.autorizar(p,a,false);
 SELECT * INTO r FROM public.informe_entrega WHERE id_entrega=k AND id_practica=p AND id_actor=a FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0404',MESSAGE='RESERVA_NO_ENCONTRADA'; END IF;
 IF r.estado='CONFIRMADA' THEN RETURN to_jsonb(r); END IF;
 c:=informes_privados.autorizar(p,a,true);
 IF r.estado<>'RESERVADA' OR r.vence<clock_timestamp() OR r.esperado<>(c->>'version')::bigint THEN RAISE EXCEPTION USING ERRCODE='P0409',MESSAGE='VERSION_O_RESERVA_CONFLICTO'; END IF;
 UPDATE public.documento SET activo=false WHERE id_documento=(c->>'id_documento')::bigint;
 INSERT INTO public.documento(id_practica,id_usuario,id_tipo_documento,nombre_original,nombre_almacenado,ruta_archivo,mime_type,tamano_bytes)
 SELECT p,a,id_tipo_documento,r.nombre,k||CASE r.formato WHEN 'PDF' THEN '.pdf' ELSE '.docx' END,r.objeto,CASE r.formato WHEN 'PDF' THEN 'application/pdf' ELSE 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' END,r.tamano FROM public.tipo_documento WHERE nombre='INFORME_FINAL' AND activo RETURNING id_documento INTO doc;
 IF doc IS NULL THEN RAISE EXCEPTION 'TIPO_INFORME_NO_DISPONIBLE'; END IF;
 INSERT INTO public.informe_final(id_practica,id_documento,version,estado) VALUES(p,doc,r.esperado+1,'ENTREGADO') ON CONFLICT(id_practica) DO UPDATE SET id_documento=excluded.id_documento,version=excluded.version;
 UPDATE public.informe_entrega SET estado='CONFIRMADA',id_documento=doc,version=r.esperado+1,confirmada=clock_timestamp() WHERE id_entrega=k RETURNING * INTO r;
 FOR destinatario IN SELECT DISTINCT u.id_usuario FROM public.practica pr JOIN public.usuario u ON u.id_usuario IN (pr.id_docente,pr.id_gestor) WHERE pr.id_practica=p AND u.activo AND EXISTS (SELECT 1 FROM public.usuario_rol ur JOIN public.rol rol USING(id_rol) WHERE ur.id_usuario=u.id_usuario AND rol.activo AND ((u.id_usuario=pr.id_gestor AND rol.nombre='GESTOR') OR (u.id_usuario=pr.id_docente AND rol.nombre='DOCENTE'))) LOOP
  INSERT INTO public.notificacion(id_usuario,id_practica,tipo,titulo,mensaje) VALUES(destinatario,p,'INFORME_FINAL_ENTREGADO','Informe final entregado','El estudiante entregó una nueva versión de su informe final.');
 END LOOP;
 RETURN to_jsonb(r);
END $$;
CREATE OR REPLACE FUNCTION informes_privados.autorizar(p bigint,a bigint,escritura boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE roles text[]; q record; docente_ok boolean; vigente record; habilitada boolean;
BEGIN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('practicalink-academico:'||p,0));
 PERFORM 1 FROM public.usuario WHERE id_usuario=a AND activo FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='NO_AUTORIZADO'; END IF;
 PERFORM 1 FROM public.usuario_rol WHERE id_usuario=a ORDER BY id_rol FOR SHARE;
 PERFORM 1 FROM public.rol WHERE id_rol IN (SELECT id_rol FROM public.usuario_rol WHERE id_usuario=a) ORDER BY id_rol FOR SHARE;
 SELECT array_agg(r.nombre) INTO roles FROM public.usuario_rol ur JOIN public.rol r USING(id_rol) WHERE ur.id_usuario=a AND r.activo;
 SELECT pr.id_practica,pr.id_gestor,pr.id_docente,pr.fecha_termino,e.id_usuario AS estudiante,ep.nombre AS estado_practica INTO q FROM public.practica pr JOIN public.estudiante e USING(id_estudiante) JOIN public.estado_practica ep ON ep.id_estado=pr.id_estado_actual WHERE pr.id_practica=p FOR UPDATE OF pr;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0404',MESSAGE='NO_ENCONTRADO'; END IF;
 IF NOT coalesce(('ESTUDIANTE'=ANY(roles) AND q.estudiante=a) OR (NOT escritura AND (('GESTOR'=ANY(roles) AND q.id_gestor=a) OR ('DOCENTE'=ANY(roles) AND q.id_docente=a))),false) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='NO_AUTORIZADO';
 END IF;
 PERFORM 1 FROM public.usuario u JOIN public.usuario_rol ur USING(id_usuario) JOIN public.rol r USING(id_rol) WHERE u.id_usuario=q.id_docente AND u.activo AND r.nombre='DOCENTE' AND r.activo FOR SHARE OF u,ur,r;
 docente_ok:=FOUND;
 SELECT f.*,d.nombre_original,d.tamano_bytes,d.fecha_subida,d.mime_type,ent.formato INTO vigente FROM public.informe_final f LEFT JOIN public.documento d USING(id_documento) LEFT JOIN public.informe_entrega ent ON ent.id_documento=f.id_documento AND ent.estado='CONFIRMADA' WHERE f.id_practica=p;
 habilitada:=('ESTUDIANTE'=ANY(roles) AND q.estudiante=a AND q.estado_practica='EN_CURSO' AND q.fecha_termino IS NOT NULL AND (clock_timestamp() AT TIME ZONE 'America/Santiago')::date>=q.fecha_termino AND docente_ok AND coalesce(vigente.estado,'ENTREGADO')='ENTREGADO' AND NOT EXISTS(SELECT 1 FROM public.evaluacion_informe WHERE id_documento=vigente.id_documento AND resultado='APROBADO' AND estado='RESUELTA'));
 IF escritura AND NOT habilitada THEN RAISE EXCEPTION USING ERRCODE='P0409',MESSAGE='ENTREGA_NO_HABILITADA'; END IF;
 RETURN jsonb_build_object('id_practica',p,'estado',CASE WHEN vigente.id_documento IS NULL THEN 'SIN_ENTREGAR' ELSE vigente.estado END,'version',coalesce(vigente.version,0),'id_documento',vigente.id_documento,'nombre',vigente.nombre_original,'tamano',vigente.tamano_bytes,'fecha',vigente.fecha_subida,'habilitada',habilitada,'propietario_estudiante',coalesce('ESTUDIANTE'=ANY(roles) AND q.estudiante=a,false),'fecha_habilitada',q.fecha_termino,'formato',vigente.formato,'mime_type',vigente.mime_type);
END $$;
CREATE OR REPLACE FUNCTION informes_privados.archivo(p bigint,a bigint) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c jsonb; r jsonb;
BEGIN
 c:=informes_privados.autorizar(p,a,false);
 SELECT jsonb_build_object('objeto',e.objeto,'sha256',e.sha256,'tamano',e.tamano,'nombre',e.nombre,'version',e.version,'formato',e.formato,'mime_type',CASE e.formato WHEN 'PDF' THEN 'application/pdf' ELSE 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' END) INTO r FROM public.informe_entrega e WHERE e.id_documento=(c->>'id_documento')::bigint AND e.estado='CONFIRMADA';
 IF r IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0404',MESSAGE='SIN_INFORME'; END IF;
 RETURN r;
END $$;

-- Existing S4.3 triggers still forbid all edits/deletes of confirmed deliveries.
-- Freeze pending payload identity too, while allowing expiry/cleanup/confirmation.
CREATE FUNCTION informes_privados.proteger_formato_entrega() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF ROW(NEW.id_entrega,NEW.id_practica,NEW.id_actor,NEW.esperado,NEW.sha256,NEW.nombre,NEW.tamano,NEW.objeto,NEW.formato,NEW.creada)
  IS DISTINCT FROM ROW(OLD.id_entrega,OLD.id_practica,OLD.id_actor,OLD.esperado,OLD.sha256,OLD.nombre,OLD.tamano,OLD.objeto,OLD.formato,OLD.creada)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='IDENTIDAD_ENTREGA_INMUTABLE'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pd_entrega_identidad BEFORE UPDATE ON public.informe_entrega
 FOR EACH ROW EXECUTE FUNCTION informes_privados.proteger_formato_entrega();

CREATE FUNCTION informes_privados.proteger_documento_confirmado() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.informe_entrega WHERE id_documento=OLD.id_documento AND estado='CONFIRMADA') THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='DOCUMENTO_CONFIRMADO_INMUTABLE'; END IF;
  IF (to_jsonb(NEW)-'activo') IS DISTINCT FROM (to_jsonb(OLD)-'activo') THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='DOCUMENTO_CONFIRMADO_INMUTABLE'; END IF;
 END IF;
 -- activo may change during a legitimate replacement; S4.3 still protects approvals.
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pd_documento_confirmado BEFORE UPDATE OR DELETE ON public.documento
 FOR EACH ROW EXECUTE FUNCTION informes_privados.proteger_documento_confirmado();

CREATE FUNCTION informes_privados.comprobar_formato_confirmado() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE extension text; mime text;
BEGIN
 IF NEW.estado<>'CONFIRMADA' THEN RETURN NULL; END IF;
 extension:=CASE NEW.formato WHEN 'PDF' THEN '.pdf' ELSE '.docx' END;
 mime:=CASE NEW.formato WHEN 'PDF' THEN 'application/pdf' ELSE 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' END;
 IF NEW.objeto IS DISTINCT FROM 'practicas/'||NEW.id_practica||'/informes/'||NEW.id_entrega||extension
  OR NOT EXISTS(SELECT 1 FROM public.documento d JOIN public.tipo_documento t USING(id_tipo_documento)
   WHERE d.id_documento=NEW.id_documento AND d.id_practica=NEW.id_practica AND d.id_usuario=NEW.id_actor
    AND t.nombre='INFORME_FINAL' AND d.nombre_original=NEW.nombre AND d.tamano_bytes=NEW.tamano
    AND d.nombre_almacenado=NEW.id_entrega||extension AND d.ruta_archivo=NEW.objeto AND d.mime_type=mime)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FORMATO_DOCUMENTO_INCONSISTENTE'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER pd_formato_confirmado AFTER INSERT OR UPDATE ON public.informe_entrega
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION informes_privados.comprobar_formato_confirmado();

-- Only new functions need ownership/ACL setup; CREATE OR REPLACE preserves existing ACL.
GRANT CREATE ON SCHEMA informes_privados TO pl_s42_owner;
ALTER FUNCTION informes_privados.reservar(bigint,bigint,uuid,bigint,text,text,bigint,text) OWNER TO pl_s42_owner;
ALTER FUNCTION informes_privados.proteger_formato_entrega() OWNER TO pl_s42_owner;
ALTER FUNCTION informes_privados.proteger_documento_confirmado() OWNER TO pl_s42_owner;
ALTER FUNCTION informes_privados.comprobar_formato_confirmado() OWNER TO pl_s42_owner;
REVOKE CREATE ON SCHEMA informes_privados FROM pl_s42_owner;
REVOKE ALL ON FUNCTION informes_privados.reservar(bigint,bigint,uuid,bigint,text,text,bigint,text),
 informes_privados.proteger_formato_entrega(),informes_privados.proteger_documento_confirmado(),informes_privados.comprobar_formato_confirmado()
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION informes_privados.reservar(bigint,bigint,uuid,bigint,text,text,bigint,text) TO pl_s42_executor;
-- No new table/column grants or RLS exceptions. Existing private owners retain their restrictions.
