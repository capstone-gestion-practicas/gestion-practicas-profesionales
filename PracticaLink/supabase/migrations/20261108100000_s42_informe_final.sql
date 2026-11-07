-- S4.2. Storage is provisioned separately. No storage credentials or remote bucket creation.
INSERT INTO public.tipo_documento(nombre,descripcion) VALUES ('INFORME_FINAL','Informe final PDF versionado') ON CONFLICT(nombre) DO NOTHING;
CREATE ROLE pl_s42_owner NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE ROLE pl_s42_executor NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE SCHEMA informes_privados;
REVOKE ALL ON SCHEMA informes_privados FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA informes_privados TO pl_s42_owner,pl_s42_executor;
GRANT USAGE ON SCHEMA public TO pl_s42_owner;
CREATE TABLE public.informe_final (
 id_practica bigint PRIMARY KEY REFERENCES public.practica ON DELETE RESTRICT,
 id_documento bigint UNIQUE REFERENCES public.documento ON DELETE RESTRICT,
 version bigint NOT NULL DEFAULT 0 CHECK(version>=0),
 estado text NOT NULL DEFAULT 'ENTREGADO' CHECK(estado IN ('ENTREGADO','EN_EVALUACION'))
);
CREATE TABLE public.informe_entrega (
 id_entrega uuid PRIMARY KEY,
 id_practica bigint NOT NULL REFERENCES public.practica ON DELETE RESTRICT,
 id_actor bigint NOT NULL REFERENCES public.usuario ON DELETE RESTRICT,
 esperado bigint NOT NULL CHECK(esperado>=0),
 sha256 text NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),
 tamano bigint NOT NULL CHECK(tamano BETWEEN 1 AND 10485760),
 nombre text NOT NULL CHECK(char_length(nombre) BETWEEN 1 AND 200),
 objeto text NOT NULL UNIQUE,
 estado text NOT NULL DEFAULT 'RESERVADA' CHECK(estado IN ('RESERVADA','CONFIRMADA','CANCELADA')),
 creada timestamptz NOT NULL DEFAULT clock_timestamp(),
 vence timestamptz NOT NULL DEFAULT clock_timestamp()+interval '15 minutes',
 id_documento bigint UNIQUE REFERENCES public.documento ON DELETE RESTRICT,
 version bigint,
 confirmada timestamptz,
 CHECK((estado='CONFIRMADA') = (id_documento IS NOT NULL AND version IS NOT NULL AND confirmada IS NOT NULL))
);
CREATE INDEX informe_entrega_practica ON public.informe_entrega(id_practica,version);
CREATE INDEX informe_entrega_limpieza ON public.informe_entrega(vence) WHERE estado<>'CONFIRMADA';
ALTER TABLE public.informe_final ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.informe_entrega ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.informe_final,public.informe_entrega FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.informe_final,public.informe_entrega TO pl_s42_owner;
CREATE POLICY s42_owner ON public.informe_final TO pl_s42_owner USING(true) WITH CHECK(true);
CREATE POLICY s42_owner ON public.informe_entrega TO pl_s42_owner USING(true) WITH CHECK(true);
GRANT SELECT(id_usuario,activo) ON public.usuario TO pl_s42_owner;
GRANT SELECT(id_usuario,id_rol) ON public.usuario_rol TO pl_s42_owner;
GRANT SELECT(id_rol,nombre,activo) ON public.rol TO pl_s42_owner;
GRANT SELECT(id_estudiante,id_usuario) ON public.estudiante TO pl_s42_owner;
GRANT SELECT(id_estado,nombre) ON public.estado_practica TO pl_s42_owner;
GRANT SELECT(id_practica,id_estudiante,id_gestor,id_docente,id_estado_actual,fecha_termino) ON public.practica TO pl_s42_owner;
GRANT SELECT(id_tipo_documento,nombre,activo) ON public.tipo_documento TO pl_s42_owner;
GRANT SELECT,INSERT ON public.documento TO pl_s42_owner;
GRANT UPDATE(activo) ON public.documento TO pl_s42_owner;
GRANT INSERT(id_usuario,id_practica,tipo,titulo,mensaje) ON public.notificacion TO pl_s42_owner;
GRANT USAGE ON SEQUENCE public.documento_id_documento_seq,public.notificacion_id_notificacion_seq TO pl_s42_owner;
-- Row locks require UPDATE on one column; effective authorization writes remain forbidden.
GRANT UPDATE(id_usuario) ON public.usuario TO pl_s42_owner;
GRANT UPDATE(id_rol) ON public.usuario_rol,public.rol TO pl_s42_owner;
GRANT UPDATE(id_practica) ON public.practica TO pl_s42_owner;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['usuario','usuario_rol','rol','practica'] LOOP
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid=('public.'||t)::regclass) THEN RAISE EXCEPTION 'S42 requiere RLS: %',t; END IF;
  EXECUTE format('CREATE POLICY s42_read ON public.%I FOR SELECT TO pl_s42_owner USING(true)',t);
  EXECUTE format('CREATE POLICY s42_lock ON public.%I FOR UPDATE TO pl_s42_owner USING(true) WITH CHECK(false)',t);
  EXECUTE format('CREATE POLICY s42_no_write ON public.%I AS RESTRICTIVE FOR UPDATE TO pl_s42_owner USING(true) WITH CHECK(false)',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['estudiante','estado_practica','tipo_documento','documento'] LOOP
  EXECUTE format('CREATE POLICY s42_read ON public.%I FOR SELECT TO pl_s42_owner USING(true)',t);
 END LOOP;
END $$;
CREATE POLICY s42_insert ON public.documento FOR INSERT TO pl_s42_owner WITH CHECK(true);
CREATE POLICY s42_update ON public.documento FOR UPDATE TO pl_s42_owner USING(id_tipo_documento=(SELECT id_tipo_documento FROM public.tipo_documento WHERE nombre='INFORME_FINAL')) WITH CHECK(id_tipo_documento=(SELECT id_tipo_documento FROM public.tipo_documento WHERE nombre='INFORME_FINAL'));
CREATE POLICY s42_notify ON public.notificacion FOR INSERT TO pl_s42_owner WITH CHECK(tipo='INFORME_FINAL_ENTREGADO');

-- Internal helper: no EXECUTE for the backend. Lock order identity -> practice -> report.
CREATE FUNCTION informes_privados.autorizar(p bigint,a bigint,escritura boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE roles text[]; q record; docente_ok boolean; vigente record; habilitada boolean;
BEGIN
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
 SELECT f.*,d.nombre_original,d.tamano_bytes,d.fecha_subida INTO vigente FROM public.informe_final f LEFT JOIN public.documento d USING(id_documento) WHERE f.id_practica=p;
 habilitada:=('ESTUDIANTE'=ANY(roles) AND q.estudiante=a AND q.estado_practica='EN_CURSO' AND q.fecha_termino IS NOT NULL AND (clock_timestamp() AT TIME ZONE 'America/Santiago')::date>=q.fecha_termino AND docente_ok AND coalesce(vigente.estado,'ENTREGADO')='ENTREGADO');
 IF escritura AND NOT habilitada THEN RAISE EXCEPTION USING ERRCODE='P0409',MESSAGE='ENTREGA_NO_HABILITADA'; END IF;
 RETURN jsonb_build_object('id_practica',p,'estado',CASE WHEN vigente.id_documento IS NULL THEN 'SIN_ENTREGAR' ELSE vigente.estado END,'version',coalesce(vigente.version,0),'id_documento',vigente.id_documento,'nombre',vigente.nombre_original,'tamano',vigente.tamano_bytes,'fecha',vigente.fecha_subida,'habilitada',habilitada,'propietario_estudiante',coalesce('ESTUDIANTE'=ANY(roles) AND q.estudiante=a,false),'fecha_habilitada',q.fecha_termino);
END $$;
CREATE FUNCTION informes_privados.consultar(p bigint,a bigint) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$ SELECT informes_privados.autorizar(p,a,false) $$;
CREATE FUNCTION informes_privados.reservar(p bigint,a bigint,k uuid,v bigint,h text,n text,b bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c jsonb; r public.informe_entrega;
BEGIN
 c:=informes_privados.autorizar(p,a,false);
 IF (c->>'propietario_estudiante')::boolean IS NOT TRUE THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='SOLO_ESTUDIANTE'; END IF;
 SELECT * INTO r FROM public.informe_entrega WHERE id_entrega=k;
 IF FOUND THEN
  IF r.id_practica<>p OR r.id_actor<>a OR r.esperado<>v OR r.sha256<>h OR r.nombre<>n OR r.tamano<>b THEN RAISE EXCEPTION USING ERRCODE='P0409',MESSAGE='IDEMPOTENCIA_CONFLICTO'; END IF;
  IF r.estado='CONFIRMADA' THEN RETURN to_jsonb(r); END IF;
  IF r.estado<>'RESERVADA' OR r.vence<clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='P0409',MESSAGE='RESERVA_VENCIDA'; END IF;
 END IF;
 c:=informes_privados.autorizar(p,a,true);
 IF (c->>'version')::bigint<>v THEN RAISE EXCEPTION USING ERRCODE='P0409',MESSAGE='VERSION_CONFLICTO'; END IF;
 IF r.id_entrega IS NULL THEN
  INSERT INTO public.informe_entrega(id_entrega,id_practica,id_actor,esperado,sha256,nombre,tamano,objeto) VALUES(k,p,a,v,h,n,b,'practicas/'||p||'/informes/'||k||'.pdf') RETURNING * INTO r;
 END IF;
 RETURN to_jsonb(r);
END $$;
CREATE FUNCTION informes_privados.confirmar(p bigint,a bigint,k uuid) RETURNS jsonb
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
 SELECT p,a,id_tipo_documento,r.nombre,k||'.pdf',r.objeto,'application/pdf',r.tamano FROM public.tipo_documento WHERE nombre='INFORME_FINAL' AND activo RETURNING id_documento INTO doc;
 IF doc IS NULL THEN RAISE EXCEPTION 'TIPO_INFORME_NO_DISPONIBLE'; END IF;
 INSERT INTO public.informe_final(id_practica,id_documento,version,estado) VALUES(p,doc,r.esperado+1,'ENTREGADO') ON CONFLICT(id_practica) DO UPDATE SET id_documento=excluded.id_documento,version=excluded.version;
 UPDATE public.informe_entrega SET estado='CONFIRMADA',id_documento=doc,version=r.esperado+1,confirmada=clock_timestamp() WHERE id_entrega=k RETURNING * INTO r;
 FOR destinatario IN SELECT DISTINCT u.id_usuario FROM public.practica pr JOIN public.usuario u ON u.id_usuario IN (pr.id_docente,pr.id_gestor) WHERE pr.id_practica=p AND u.activo AND EXISTS (SELECT 1 FROM public.usuario_rol ur JOIN public.rol rol USING(id_rol) WHERE ur.id_usuario=u.id_usuario AND rol.activo AND ((u.id_usuario=pr.id_gestor AND rol.nombre='GESTOR') OR (u.id_usuario=pr.id_docente AND rol.nombre='DOCENTE'))) LOOP
  INSERT INTO public.notificacion(id_usuario,id_practica,tipo,titulo,mensaje) VALUES(destinatario,p,'INFORME_FINAL_ENTREGADO','Informe final entregado','El estudiante entregó una nueva versión de su informe final.');
 END LOOP;
 RETURN to_jsonb(r);
END $$;
CREATE FUNCTION informes_privados.archivo(p bigint,a bigint) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c jsonb; r jsonb;
BEGIN
 c:=informes_privados.autorizar(p,a,false);
 SELECT jsonb_build_object('objeto',e.objeto,'sha256',e.sha256,'tamano',e.tamano,'nombre',e.nombre,'version',e.version) INTO r FROM public.informe_entrega e WHERE e.id_documento=(c->>'id_documento')::bigint AND e.estado='CONFIRMADA';
 IF r IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0404',MESSAGE='SIN_INFORME'; END IF;
 RETURN r;
END $$;
-- A failed/ambiguous upload is not deleted inline: confirmation may have committed.
-- Expired reservations become tombstones; repeat deletion to recover late PUTs/errors.
CREATE FUNCTION informes_privados.limpieza() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE resultado jsonb;
BEGIN
 WITH elegidas AS (SELECT id_entrega FROM public.informe_entrega WHERE estado IN ('CANCELADA','RESERVADA') AND vence<clock_timestamp() ORDER BY vence LIMIT 100 FOR UPDATE SKIP LOCKED), canceladas AS (UPDATE public.informe_entrega e SET estado='CANCELADA',vence=clock_timestamp()+interval '1 day' FROM elegidas x WHERE e.id_entrega=x.id_entrega RETURNING e.objeto)
 SELECT coalesce(jsonb_agg(objeto),'[]'::jsonb) INTO resultado FROM canceladas;
 RETURN resultado;
END $$;
-- All report transitions, including future evaluation, must lock practica first.
CREATE FUNCTION informes_privados.proteger_estado() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM 1 FROM public.practica WHERE id_practica=NEW.id_practica FOR UPDATE;
 IF TG_OP='UPDATE' AND OLD.estado='EN_EVALUACION' AND (NEW.estado<>OLD.estado OR NEW.id_documento IS DISTINCT FROM OLD.id_documento OR NEW.version<>OLD.version) THEN RAISE EXCEPTION USING ERRCODE='P0409',MESSAGE='INFORME_EN_EVALUACION'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER s42_estado BEFORE INSERT OR UPDATE ON public.informe_final FOR EACH ROW EXECUTE FUNCTION informes_privados.proteger_estado();
GRANT CREATE ON SCHEMA informes_privados TO pl_s42_owner;
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure AS firma FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='informes_privados' LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO pl_s42_owner',f.firma);
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.firma);
 END LOOP;
END $$;
REVOKE CREATE ON SCHEMA informes_privados FROM pl_s42_owner;
GRANT EXECUTE ON FUNCTION informes_privados.consultar(bigint,bigint),informes_privados.reservar(bigint,bigint,uuid,bigint,text,text,bigint),informes_privados.confirmar(bigint,bigint,uuid),informes_privados.archivo(bigint,bigint),informes_privados.limpieza() TO pl_s42_executor;
