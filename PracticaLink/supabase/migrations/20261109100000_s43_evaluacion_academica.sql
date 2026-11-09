-- S4.3: academic evaluation, no grades and no automatic closure.
-- Forward-only security migration: never restore the pre-S4.3 closure on rollback.
-- Actors are supplied ONLY by the trusted JWT-validating API, not browser RPC.
CREATE ROLE pl_s43_cierre_owner NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
-- Normalize Unicode whitespace consistently; whitespace-only is never a reason/result.
CREATE FUNCTION informes_privados.normalizar_texto(t text) RETURNS text LANGUAGE sql IMMUTABLE
SET search_path=pg_catalog,pg_temp AS $$ SELECT nullif(btrim(t,chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(28)||chr(29)||chr(30)||chr(31)||chr(32)||chr(133)||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)),'') $$;
CREATE TABLE public.evaluacion_informe (
 id_evaluacion uuid PRIMARY KEY,
 id_practica bigint NOT NULL REFERENCES public.practica ON DELETE RESTRICT,
 id_entrega uuid NOT NULL REFERENCES public.informe_entrega ON DELETE RESTRICT,
 id_documento bigint NOT NULL REFERENCES public.documento ON DELETE RESTRICT,
 version bigint NOT NULL CHECK(version>0),
 sha256 text NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),
 id_docente bigint NOT NULL REFERENCES public.usuario ON DELETE RESTRICT,
 estado text NOT NULL DEFAULT 'EN_CURSO' CHECK(estado IN ('EN_CURSO','RESUELTA','INTERRUMPIDA')),
 resultado text CHECK(resultado IN ('APROBADO','CON_OBSERVACIONES')),
 observaciones text CHECK(char_length(observaciones)<=2000),
 motivo text CHECK(char_length(motivo)<=2000),
 inicio timestamptz NOT NULL DEFAULT clock_timestamp(),
 termino timestamptz,
 id_resolucion uuid UNIQUE,
 CHECK((estado='EN_CURSO' AND resultado IS NULL AND termino IS NULL AND id_resolucion IS NULL AND motivo IS NULL AND observaciones IS NULL)
    OR (estado='RESUELTA' AND resultado IS NOT NULL AND termino IS NOT NULL AND id_resolucion IS NOT NULL AND motivo IS NULL
        AND (resultado='APROBADO' OR informes_privados.normalizar_texto(observaciones) IS NOT NULL))
    OR (estado='INTERRUMPIDA' AND resultado IS NULL AND termino IS NOT NULL AND id_resolucion IS NULL
        AND informes_privados.normalizar_texto(motivo) IS NOT NULL AND observaciones IS NULL)),
 CHECK(termino IS NULL OR termino>=inicio)
);
CREATE UNIQUE INDEX s43_una_pendiente ON public.evaluacion_informe(id_practica) WHERE estado='EN_CURSO';
CREATE UNIQUE INDEX s43_una_resolucion_por_pdf ON public.evaluacion_informe(id_documento) WHERE estado='RESUELTA';
CREATE INDEX s43_historial ON public.evaluacion_informe(id_practica,inicio,id_evaluacion);
CREATE TABLE public.evaluacion_evento (
 id_evento bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 id_evaluacion uuid NOT NULL REFERENCES public.evaluacion_informe ON DELETE RESTRICT,
 id_actor bigint NOT NULL REFERENCES public.usuario ON DELETE RESTRICT,
 tipo text NOT NULL CHECK(tipo IN ('INICIADA','RESUELTA','INTERRUMPIDA')),
 fecha timestamptz NOT NULL DEFAULT clock_timestamp(),
 detalle text CHECK(char_length(detalle)<=2000),
 UNIQUE(id_evaluacion,tipo)
);
ALTER TABLE public.cierre_practica ADD COLUMN id_evaluacion uuid REFERENCES public.evaluacion_informe ON DELETE RESTRICT;
-- Existing closures and assignment reasons remain untouched; validate new writes only.
ALTER TABLE public.historial_asignacion_docente ADD CONSTRAINT s43_motivo_maximo CHECK(char_length(motivo)<=2000) NOT VALID;
ALTER TABLE public.evaluacion_informe ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evaluacion_evento ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.evaluacion_informe,public.evaluacion_evento FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.evaluacion_informe TO pl_s42_owner;
GRANT SELECT,INSERT ON public.evaluacion_evento TO pl_s42_owner;
GRANT USAGE ON SEQUENCE public.evaluacion_evento_id_evento_seq TO pl_s42_owner;
CREATE POLICY s43_owner ON public.evaluacion_informe TO pl_s42_owner USING(true) WITH CHECK(true);
CREATE POLICY s43_owner ON public.evaluacion_evento FOR SELECT TO pl_s42_owner USING(true);
CREATE POLICY s43_insert ON public.evaluacion_evento FOR INSERT TO pl_s42_owner WITH CHECK(true);
-- Shared per-practice transaction gate precedes identity/row locks in S4.1/S4.2/S4.3/EP07.
-- Hash collisions only serialize unrelated practices; correctness does not depend on uniqueness.
CREATE FUNCTION informes_privados.bloquear(p bigint) RETURNS void LANGUAGE sql
SET search_path=pg_catalog,pg_temp AS $$ SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('practicalink-academico:'||p,0)) $$;
GRANT USAGE ON SCHEMA informes_privados TO pl_s41_docente_owner,pl_s43_cierre_owner;
GRANT EXECUTE ON FUNCTION informes_privados.bloquear(bigint) TO pl_s41_docente_owner,pl_s43_cierre_owner;

CREATE FUNCTION informes_privados.docente_autorizado(p bigint,a bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c jsonb;
BEGIN
 c:=informes_privados.autorizar(p,a,false);
 PERFORM 1 FROM public.practica pr JOIN public.estudiante e USING(id_estudiante)
 JOIN public.usuario u ON u.id_usuario=a JOIN public.usuario_rol ur ON ur.id_usuario=u.id_usuario
 JOIN public.rol r USING(id_rol) JOIN public.estado_practica ep ON ep.id_estado=pr.id_estado_actual
 WHERE pr.id_practica=p AND pr.id_docente=a AND e.id_usuario<>a AND u.activo AND r.activo AND r.nombre='DOCENTE' AND ep.nombre='EN_CURSO'
 FOR SHARE OF u,ur,r;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='DOCENTE_NO_AUTORIZADO'; END IF;
 RETURN c;
END $$;
CREATE FUNCTION informes_privados.iniciar_evaluacion(p bigint,a bigint,k uuid,d bigint,v bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c jsonb; e public.evaluacion_informe; entrega public.informe_entrega;
BEGIN
 c:=informes_privados.docente_autorizado(p,a);
 SELECT * INTO e FROM public.evaluacion_informe WHERE id_evaluacion=k;
 IF FOUND THEN
  IF e.id_practica<>p OR e.id_docente<>a OR e.id_documento<>d OR e.version<>v THEN RAISE EXCEPTION USING ERRCODE='P0409',MESSAGE='IDEMPOTENCIA_CONFLICTO'; END IF;
  RETURN to_jsonb(e);
 END IF;
 IF c->>'estado'<>'ENTREGADO' OR (c->>'id_documento')::bigint IS DISTINCT FROM d OR (c->>'version')::bigint<>v THEN RAISE EXCEPTION USING ERRCODE='P0409',MESSAGE='INFORME_NO_EVALUABLE'; END IF;
 SELECT * INTO entrega FROM public.informe_entrega WHERE id_documento=d AND id_practica=p AND version=v AND estado='CONFIRMADA';
 IF NOT FOUND OR EXISTS(SELECT 1 FROM public.evaluacion_informe WHERE id_practica=p AND estado='EN_CURSO')
   OR EXISTS(SELECT 1 FROM public.evaluacion_informe WHERE id_documento=d AND estado='RESUELTA') THEN RAISE EXCEPTION USING ERRCODE='P0409',MESSAGE='VERSION_NO_EVALUABLE'; END IF;
 INSERT INTO public.evaluacion_informe(id_evaluacion,id_practica,id_entrega,id_documento,version,sha256,id_docente)
 VALUES(k,p,entrega.id_entrega,d,v,entrega.sha256,a) RETURNING * INTO e;
 INSERT INTO public.evaluacion_evento(id_evaluacion,id_actor,tipo) VALUES(k,a,'INICIADA');
 UPDATE public.informe_final SET estado='EN_EVALUACION' WHERE id_practica=p;
 RETURN to_jsonb(e);
END $$;
CREATE FUNCTION informes_privados.resolver_evaluacion(p bigint,a bigint,k uuid,eid uuid,res text,obs text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c jsonb; e public.evaluacion_informe; destinatario bigint;
BEGIN
 c:=informes_privados.docente_autorizado(p,a);
 IF char_length(obs)>2000 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OBSERVACIONES_DEMASIADO_LARGAS'; END IF;
 obs:=informes_privados.normalizar_texto(obs);
 IF res IS NULL OR res NOT IN ('APROBADO','CON_OBSERVACIONES') OR char_length(obs)>2000 OR (res='CON_OBSERVACIONES' AND NOT coalesce(obs ~ '[^[:space:]]',false)) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='RESULTADO_OBSERVACIONES_INVALIDOS'; END IF;
 SELECT * INTO e FROM public.evaluacion_informe WHERE id_evaluacion=eid AND id_practica=p AND id_docente=a FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0404',MESSAGE='EVALUACION_NO_ENCONTRADA'; END IF;
 IF e.estado='RESUELTA' AND e.id_resolucion=k AND e.resultado=res AND e.observaciones IS NOT DISTINCT FROM obs THEN RETURN to_jsonb(e); END IF;
 IF e.estado<>'EN_CURSO' OR c->>'estado'<>'EN_EVALUACION' OR (c->>'id_documento')::bigint<>e.id_documento OR (c->>'version')::bigint<>e.version THEN RAISE EXCEPTION USING ERRCODE='P0409',MESSAGE='EVALUACION_NO_RESOLUBLE'; END IF;
 UPDATE public.evaluacion_informe SET estado='RESUELTA',resultado=res,observaciones=obs,termino=clock_timestamp(),id_resolucion=k WHERE id_evaluacion=eid RETURNING * INTO e;
 INSERT INTO public.evaluacion_evento(id_evaluacion,id_actor,tipo,detalle) VALUES(eid,a,'RESUELTA',obs);
 UPDATE public.informe_final SET estado='ENTREGADO' WHERE id_practica=p;
 FOR destinatario IN SELECT DISTINCT u.id_usuario FROM public.practica pr JOIN public.estudiante est USING(id_estudiante)
  JOIN public.usuario u ON u.id_usuario IN (est.id_usuario,pr.id_gestor) WHERE pr.id_practica=p AND u.activo AND EXISTS(SELECT 1 FROM public.usuario_rol ur JOIN public.rol r USING(id_rol) WHERE ur.id_usuario=u.id_usuario AND r.activo AND ((u.id_usuario=est.id_usuario AND r.nombre='ESTUDIANTE') OR (u.id_usuario=pr.id_gestor AND r.nombre='GESTOR'))) LOOP
  INSERT INTO public.notificacion(id_usuario,id_practica,tipo,titulo,mensaje) VALUES(destinatario,p,'INFORME_FINAL_EVALUADO','Informe final evaluado',CASE WHEN res='APROBADO' THEN 'El informe fue aprobado académicamente; la práctica aún requiere cierre del GESTOR.' ELSE 'El informe tiene observaciones. Consulta el resultado para entregar una nueva versión.' END);
 END LOOP;
 RETURN to_jsonb(e);
END $$;
CREATE FUNCTION informes_privados.historial_evaluacion(p bigint,a bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r jsonb;
BEGIN
 PERFORM informes_privados.autorizar(p,a,false);
 SELECT coalesce(jsonb_agg(to_jsonb(e)||jsonb_build_object('eventos',(SELECT coalesce(jsonb_agg(to_jsonb(ev) ORDER BY ev.id_evento),'[]'::jsonb) FROM public.evaluacion_evento ev WHERE ev.id_evaluacion=e.id_evaluacion)) ORDER BY e.inicio,e.id_evaluacion),'[]'::jsonb)
 INTO r FROM public.evaluacion_informe e WHERE e.id_practica=p;
 RETURN r;
END $$;
CREATE FUNCTION informes_privados.interrumpir_evaluacion(p bigint,a bigint,m text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE e public.evaluacion_informe;
BEGIN
 PERFORM informes_privados.bloquear(p);
 PERFORM 1 FROM public.practica pr JOIN public.usuario u ON u.id_usuario=a JOIN public.usuario_rol ur USING(id_usuario) JOIN public.rol r USING(id_rol)
 WHERE pr.id_practica=p AND pr.id_gestor=a AND u.activo AND r.activo AND r.nombre='GESTOR';
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='GESTOR_NO_RESPONSABLE'; END IF;
 SELECT * INTO e FROM public.evaluacion_informe WHERE id_practica=p AND estado='EN_CURSO' FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 IF char_length(m)>2000 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='MOTIVO_DEMASIADO_LARGO'; END IF;
 m:=informes_privados.normalizar_texto(m);
 IF m IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='MOTIVO_REQUERIDO'; END IF;
 UPDATE public.evaluacion_informe SET estado='INTERRUMPIDA',termino=clock_timestamp(),motivo=btrim(m) WHERE id_evaluacion=e.id_evaluacion;
 INSERT INTO public.evaluacion_evento(id_evaluacion,id_actor,tipo,detalle) VALUES(e.id_evaluacion,a,'INTERRUMPIDA',btrim(m));
 UPDATE public.informe_final SET estado='ENTREGADO' WHERE id_practica=p;
END $$;
CREATE POLICY s43_notify ON public.notificacion FOR INSERT TO pl_s42_owner WITH CHECK(tipo='INFORME_FINAL_EVALUADO');
CREATE FUNCTION informes_privados.guardar_evaluacion() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='EVALUACION_INMUTABLE'; END IF;
 IF TG_OP='UPDATE' THEN
  IF OLD.estado<>'EN_CURSO' OR NEW.estado NOT IN ('RESUELTA','INTERRUMPIDA')
   OR (to_jsonb(NEW)-ARRAY['estado','resultado','observaciones','motivo','termino','id_resolucion']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['estado','resultado','observaciones','motivo','termino','id_resolucion']) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='EVALUACION_INMUTABLE'; END IF;
 ELSE
  IF NEW.estado<>'EN_CURSO' OR NOT EXISTS(SELECT 1 FROM public.informe_entrega e JOIN public.informe_final f ON f.id_documento=e.id_documento JOIN public.practica p ON p.id_practica=f.id_practica JOIN public.estudiante est USING(id_estudiante)
    WHERE e.id_entrega=NEW.id_entrega AND e.estado='CONFIRMADA' AND e.id_documento=NEW.id_documento AND e.sha256=NEW.sha256 AND e.version=NEW.version AND e.id_practica=NEW.id_practica AND p.id_docente=NEW.id_docente AND est.id_usuario<>NEW.id_docente) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='VERSION_EVALUACION_INVALIDA'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER s43_evaluacion_inmutable BEFORE INSERT OR UPDATE OR DELETE ON public.evaluacion_informe FOR EACH ROW EXECUTE FUNCTION informes_privados.guardar_evaluacion();
CREATE FUNCTION informes_privados.evento_inmutable() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE e public.evaluacion_informe;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='EVENTO_INMUTABLE'; END IF;
 SELECT * INTO e FROM public.evaluacion_informe WHERE id_evaluacion=NEW.id_evaluacion;
 IF NOT ((NEW.tipo='INICIADA' AND e.estado='EN_CURSO' AND NEW.id_actor=e.id_docente AND NEW.detalle IS NULL)
  OR (NEW.tipo='RESUELTA' AND e.estado='RESUELTA' AND NEW.id_actor=e.id_docente AND NEW.detalle IS NOT DISTINCT FROM e.observaciones)
  OR (NEW.tipo='INTERRUMPIDA' AND e.estado='INTERRUMPIDA' AND NEW.detalle=e.motivo AND NEW.id_actor=(SELECT id_gestor FROM public.practica WHERE id_practica=e.id_practica))) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='EVENTO_INVALIDO'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER s43_evento_inmutable BEFORE INSERT OR UPDATE OR DELETE ON public.evaluacion_evento FOR EACH ROW EXECUTE FUNCTION informes_privados.evento_inmutable();
CREATE FUNCTION informes_privados.consistencia_evaluacion() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE p bigint; e public.evaluacion_informe; f public.informe_final;
BEGIN
 p:=NEW.id_practica;
 SELECT * INTO f FROM public.informe_final WHERE id_practica=p;
 IF f.id_documento IS NULL OR NOT EXISTS(SELECT 1 FROM public.informe_entrega ent JOIN public.documento d USING(id_documento) WHERE ent.id_practica=p AND ent.id_documento=f.id_documento AND ent.version=f.version AND ent.estado='CONFIRMADA' AND d.id_practica=p AND d.activo) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INFORME_VIGENTE_NO_CONFIRMADO'; END IF;
 SELECT * INTO e FROM public.evaluacion_informe WHERE id_practica=p AND estado='EN_CURSO';
 IF (f.estado='EN_EVALUACION') IS DISTINCT FROM (e.id_evaluacion IS NOT NULL) OR (e.id_evaluacion IS NOT NULL AND (f.id_documento IS DISTINCT FROM e.id_documento OR f.version IS DISTINCT FROM e.version)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='ESTADO_EVALUACION_INCONSISTENTE'; END IF;
 IF EXISTS(SELECT 1 FROM public.evaluacion_informe ev WHERE ev.id_practica=p AND (NOT EXISTS(SELECT 1 FROM public.evaluacion_evento ee WHERE ee.id_evaluacion=ev.id_evaluacion AND ee.tipo='INICIADA') OR (ev.estado<>'EN_CURSO' AND NOT EXISTS(SELECT 1 FROM public.evaluacion_evento ee WHERE ee.id_evaluacion=ev.id_evaluacion AND ee.tipo=ev.estado)))) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='EVENTOS_EVALUACION_INCOMPLETOS'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER s43_consistencia_evaluacion AFTER INSERT OR UPDATE ON public.evaluacion_informe DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION informes_privados.consistencia_evaluacion();
CREATE CONSTRAINT TRIGGER s43_consistencia_informe AFTER INSERT OR UPDATE ON public.informe_final DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION informes_privados.consistencia_evaluacion();
CREATE OR REPLACE FUNCTION informes_privados.proteger_estado() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM informes_privados.bloquear(NEW.id_practica);
 PERFORM 1 FROM public.practica WHERE id_practica=NEW.id_practica FOR UPDATE;
 IF TG_OP='UPDATE' THEN
  IF (NEW.id_documento IS DISTINCT FROM OLD.id_documento AND NEW.version<>OLD.version+1) OR (NEW.id_documento IS NOT DISTINCT FROM OLD.id_documento AND NEW.version<>OLD.version) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='VERSION_NO_MONOTONICA'; END IF;
  IF NEW.id_practica<>OLD.id_practica THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PRACTICA_INMUTABLE'; END IF;
  IF (NEW.id_documento IS DISTINCT FROM OLD.id_documento OR NEW.version<>OLD.version) AND
    (OLD.estado='EN_EVALUACION' OR EXISTS(SELECT 1 FROM public.evaluacion_informe WHERE id_documento=OLD.id_documento AND resultado='APROBADO' AND estado='RESUELTA')) THEN RAISE EXCEPTION USING ERRCODE='P0409',MESSAGE='INFORME_BLOQUEADO'; END IF;
  IF NEW.estado='EN_EVALUACION' AND NOT EXISTS(SELECT 1 FROM public.evaluacion_informe WHERE id_practica=NEW.id_practica AND id_documento=NEW.id_documento AND version=NEW.version AND estado='EN_CURSO') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INICIO_EXPLICITO_REQUERIDO'; END IF;
  IF OLD.estado='EN_EVALUACION' AND NEW.estado='ENTREGADO' AND EXISTS(SELECT 1 FROM public.evaluacion_informe WHERE id_practica=NEW.id_practica AND estado='EN_CURSO') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='EVALUACION_PENDIENTE'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION informes_privados.pdf_evaluado_inmutable() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF TG_TABLE_NAME='informe_entrega' THEN
  IF OLD.estado='CONFIRMADA' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='ENTREGA_CONFIRMADA_INMUTABLE'; END IF;
 END IF;
 IF TG_TABLE_NAME='documento' AND EXISTS(SELECT 1 FROM public.evaluacion_informe WHERE id_documento=OLD.id_documento) THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PDF_EVALUADO_INMUTABLE'; END IF;
  IF (to_jsonb(NEW)-'activo') IS DISTINCT FROM (to_jsonb(OLD)-'activo') OR
    (NEW.activo IS DISTINCT FROM OLD.activo AND EXISTS(SELECT 1 FROM public.evaluacion_informe WHERE id_documento=OLD.id_documento AND resultado='APROBADO')) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PDF_EVALUADO_INMUTABLE'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER s43_entrega_inmutable BEFORE UPDATE OR DELETE ON public.informe_entrega FOR EACH ROW EXECUTE FUNCTION informes_privados.pdf_evaluado_inmutable();
CREATE TRIGGER s43_pdf_inmutable BEFORE UPDATE OR DELETE ON public.documento FOR EACH ROW EXECUTE FUNCTION informes_privados.pdf_evaluado_inmutable();
CREATE FUNCTION informes_privados.asignacion_segura() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM id_estudiante FROM public.estudiante WHERE id_estudiante=NEW.id_estudiante FOR SHARE;
 IF NEW.id_docente IS NOT NULL AND EXISTS(SELECT 1 FROM public.estudiante WHERE id_estudiante=NEW.id_estudiante AND id_usuario=NEW.id_docente) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='DOCENTE_IGUAL_ESTUDIANTE'; END IF;
 IF TG_OP='UPDATE' AND NEW.id_docente IS DISTINCT FROM OLD.id_docente AND EXISTS(SELECT 1 FROM public.evaluacion_informe WHERE id_practica=NEW.id_practica AND estado='EN_CURSO') THEN RAISE EXCEPTION USING ERRCODE='P0409',MESSAGE='INTERRUPCION_ATOMICA_REQUERIDA'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER s43_asignacion_segura BEFORE INSERT OR UPDATE OF id_docente,id_estudiante ON public.practica FOR EACH ROW EXECUTE FUNCTION informes_privados.asignacion_segura();
CREATE FUNCTION informes_privados.estudiante_seguro() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.practica WHERE id_estudiante=NEW.id_estudiante AND id_docente=NEW.id_usuario) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='DOCENTE_IGUAL_ESTUDIANTE'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER s43_estudiante_seguro BEFORE UPDATE OF id_usuario ON public.estudiante FOR EACH ROW EXECUTE FUNCTION informes_privados.estudiante_seguro();

CREATE FUNCTION informes_privados.validar_cierre(p bigint,a bigint) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c jsonb; eid uuid;
BEGIN
 c:=informes_privados.autorizar(p,a,false);
 PERFORM 1 FROM public.practica pr JOIN public.usuario u ON u.id_usuario=a JOIN public.usuario_rol ur USING(id_usuario) JOIN public.rol r USING(id_rol) WHERE pr.id_practica=p AND pr.id_gestor=a AND u.activo AND r.activo AND r.nombre='GESTOR' FOR SHARE OF u,ur,r;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='GESTOR_NO_RESPONSABLE'; END IF;
 SELECT e.id_evaluacion INTO eid FROM public.evaluacion_informe e JOIN public.informe_entrega ent USING(id_entrega)
 WHERE e.id_practica=p AND e.id_documento=(c->>'id_documento')::bigint AND e.version=(c->>'version')::bigint AND e.estado='RESUELTA' AND e.resultado='APROBADO' AND ent.estado='CONFIRMADA' AND ent.sha256=e.sha256;
 IF eid IS NULL OR c->>'estado'<>'ENTREGADO' OR EXISTS(SELECT 1 FROM public.evaluacion_informe WHERE id_practica=p AND estado='EN_CURSO') THEN RAISE EXCEPTION USING ERRCODE='P0409',MESSAGE='EVALUACION_APROBATORIA_VIGENTE_REQUERIDA'; END IF;
 RETURN eid;
END $$;
CREATE FUNCTION informes_privados.barrera_cierre() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE p bigint; actor bigint; eid uuid; estado text; fecha date;
BEGIN
 IF TG_TABLE_NAME='cierre_practica' THEN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CIERRE_HISTORICO_INMUTABLE'; END IF;
  p:=NEW.id_practica; actor:=NEW.id_usuario;
  eid:=informes_privados.validar_cierre(p,actor);
  SELECT ep.nombre,pr.fecha_termino INTO estado,fecha FROM public.practica pr JOIN public.estado_practica ep ON ep.id_estado=pr.id_estado_actual WHERE pr.id_practica=p;
  IF NEW.resultado<>'APROBADA' OR NEW.id_evaluacion IS DISTINCT FROM eid OR estado<>'EN_CURSO' OR fecha IS NULL OR fecha>(clock_timestamp() AT TIME ZONE 'America/Santiago')::date THEN RAISE EXCEPTION USING ERRCODE='P0409',MESSAGE='CIERRE_NO_VALIDO'; END IF;
 ELSIF TG_TABLE_NAME='practica' THEN
  IF TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM public.estado_practica WHERE id_estado=OLD.id_estado_actual AND nombre='FINALIZADA') THEN
   IF NEW.id_estado_actual<>OLD.id_estado_actual THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINALIZADA_TERMINAL'; END IF;
   RETURN NEW;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.estado_practica WHERE id_estado=NEW.id_estado_actual AND nombre='FINALIZADA') THEN RETURN NEW; END IF;
  p:=NEW.id_practica;
  SELECT id_usuario,id_evaluacion INTO actor,eid FROM public.cierre_practica WHERE id_practica=p;
  IF actor IS NULL OR eid IS DISTINCT FROM informes_privados.validar_cierre(p,actor) THEN RAISE EXCEPTION USING ERRCODE='P0409',MESSAGE='CIERRE_VALIDADO_REQUERIDO'; END IF;
 ELSE
  -- E03: preserve final history, including pre-S4.3 rows without evaluation.
  IF TG_OP IN ('UPDATE','DELETE') THEN
   IF EXISTS(SELECT 1 FROM public.estado_practica WHERE id_estado=OLD.id_estado AND nombre='FINALIZADA') THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='HISTORIAL_FINALIZADA_INMUTABLE';
   END IF;
   IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.estado_practica WHERE id_estado=NEW.id_estado AND nombre='FINALIZADA') THEN RETURN NEW; END IF;
  p:=NEW.id_practica;
  SELECT id_usuario,id_evaluacion INTO actor,eid FROM public.cierre_practica WHERE id_practica=p;
  IF actor IS NULL OR NEW.id_usuario<>actor OR eid IS DISTINCT FROM informes_privados.validar_cierre(p,actor) THEN RAISE EXCEPTION USING ERRCODE='P0409',MESSAGE='HISTORIAL_CIERRE_NO_VALIDO'; END IF;
 END IF;
 RETURN NEW;
END $$;
GRANT SELECT ON public.cierre_practica TO pl_s42_owner;
CREATE POLICY s43_read_cierre ON public.cierre_practica FOR SELECT TO pl_s42_owner USING(true);
CREATE TRIGGER s43_cierre_validado BEFORE INSERT OR UPDATE OR DELETE ON public.cierre_practica FOR EACH ROW EXECUTE FUNCTION informes_privados.barrera_cierre();
CREATE TRIGGER s43_finalizada_validada BEFORE INSERT OR UPDATE OF id_estado_actual ON public.practica FOR EACH ROW EXECUTE FUNCTION informes_privados.barrera_cierre();
CREATE TRIGGER s43_historial_final_validado BEFORE INSERT OR UPDATE OR DELETE ON public.historial_estado FOR EACH ROW EXECUTE FUNCTION informes_privados.barrera_cierre();
GRANT UPDATE(id_estudiante) ON public.estudiante TO pl_s42_owner;
CREATE POLICY s43_student_lock ON public.estudiante FOR UPDATE TO pl_s42_owner USING(true) WITH CHECK(false);
CREATE POLICY s43_student_no_write ON public.estudiante AS RESTRICTIVE FOR UPDATE TO pl_s42_owner USING(true) WITH CHECK(false);

-- S4.3 incremental integration: preserve signature and add transaction gate.
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
 SELECT f.*,d.nombre_original,d.tamano_bytes,d.fecha_subida INTO vigente FROM public.informe_final f LEFT JOIN public.documento d USING(id_documento) WHERE f.id_practica=p;
 habilitada:=('ESTUDIANTE'=ANY(roles) AND q.estudiante=a AND q.estado_practica='EN_CURSO' AND q.fecha_termino IS NOT NULL AND (clock_timestamp() AT TIME ZONE 'America/Santiago')::date>=q.fecha_termino AND docente_ok AND coalesce(vigente.estado,'ENTREGADO')='ENTREGADO' AND NOT EXISTS(SELECT 1 FROM public.evaluacion_informe WHERE id_documento=vigente.id_documento AND resultado='APROBADO' AND estado='RESUELTA'));
 IF escritura AND NOT habilitada THEN RAISE EXCEPTION USING ERRCODE='P0409',MESSAGE='ENTREGA_NO_HABILITADA'; END IF;
 RETURN jsonb_build_object('id_practica',p,'estado',CASE WHEN vigente.id_documento IS NULL THEN 'SIN_ENTREGAR' ELSE vigente.estado END,'version',coalesce(vigente.version,0),'id_documento',vigente.id_documento,'nombre',vigente.nombre_original,'tamano',vigente.tamano_bytes,'fecha',vigente.fecha_subida,'habilitada',habilitada,'propietario_estudiante',coalesce('ESTUDIANTE'=ANY(roles) AND q.estudiante=a,false),'fecha_habilitada',q.fecha_termino);
END $$;

-- S4.3 incremental integration: preserve signature and add transaction gate.
CREATE OR REPLACE FUNCTION docente_privado.fn_gestionar_asignacion(
    p_id_practica BIGINT, p_id_actor BIGINT, p_id_docente BIGINT, p_motivo TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_id_gestor BIGINT; v_id_docente_actual BIGINT; v_id_estado_actual BIGINT; v_estado TEXT; v_anterior BIGINT;
BEGIN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('practicalink-academico:'||p_id_practica,0));
    IF char_length(p_motivo)>2000 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='MOTIVO_DEMASIADO_LARGO'; END IF;
    p_motivo:=informes_privados.normalizar_texto(p_motivo);
    PERFORM 1 FROM public.usuario u JOIN public.usuario_rol ur USING(id_usuario)
      JOIN public.rol r USING(id_rol)
      WHERE u.id_usuario=p_id_actor AND u.activo AND r.activo AND r.nombre='GESTOR'
      FOR SHARE OF u, ur, r;
    IF NOT FOUND THEN RETURN jsonb_build_object('error','USUARIO_NO_AUTORIZADO'); END IF;
    SELECT p.id_gestor, p.id_docente, p.id_estado_actual
      INTO v_id_gestor, v_id_docente_actual, v_id_estado_actual
      FROM public.practica p WHERE p.id_practica=p_id_practica FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('error','PRACTICA_NO_ENCONTRADA'); END IF;
    IF v_id_gestor IS DISTINCT FROM p_id_actor THEN
      RETURN jsonb_build_object('error','GESTOR_NO_RESPONSABLE');
    END IF;
    SELECT ep.nombre INTO v_estado FROM public.estado_practica ep WHERE ep.id_estado=v_id_estado_actual;
    IF v_estado IS NULL OR v_estado NOT IN ('APROBADA','EN_CURSO') THEN
      RETURN jsonb_build_object('error','ESTADO_NO_PERMITIDO');
    END IF;
    IF p_id_docente IS NOT NULL AND EXISTS(SELECT 1 FROM public.practica pr JOIN public.estudiante est USING(id_estudiante) WHERE pr.id_practica=p_id_practica AND est.id_usuario=p_id_docente) THEN RETURN jsonb_build_object('error','DOCENTE_IGUAL_ESTUDIANTE'); END IF;
    v_anterior := v_id_docente_actual;
    IF p_id_docente IS NOT NULL THEN
      IF p_id_docente=p_id_actor THEN RETURN jsonb_build_object('error','DOCENTE_IGUAL_GESTOR'); END IF;
      PERFORM 1 FROM public.usuario u JOIN public.usuario_rol ur USING(id_usuario)
        JOIN public.rol r USING(id_rol)
        WHERE u.id_usuario=p_id_docente AND u.activo AND r.activo AND r.nombre='DOCENTE'
        FOR SHARE OF u, ur, r;
      IF NOT FOUND THEN RETURN jsonb_build_object('error','DOCENTE_NO_VALIDO'); END IF;
    END IF;
    IF v_anterior IS NOT DISTINCT FROM p_id_docente THEN
      RETURN jsonb_build_object('error','ASIGNACION_SIN_CAMBIOS');
    END IF;
    IF v_anterior IS NOT NULL AND (p_motivo IS NULL OR btrim(p_motivo)='') THEN
      RETURN jsonb_build_object('error','MOTIVO_OBLIGATORIO');
    END IF;
    PERFORM informes_privados.interrumpir_evaluacion(p_id_practica,p_id_actor,p_motivo);
    UPDATE public.practica SET id_docente=p_id_docente, fecha_actualizacion=clock_timestamp()
      WHERE id_practica=p_id_practica;
    INSERT INTO public.historial_asignacion_docente
      (id_practica,id_docente_anterior,id_docente_nuevo,id_actor,fecha_cambio,motivo)
      VALUES (p_id_practica,v_anterior,p_id_docente,p_id_actor,clock_timestamp(),NULLIF(btrim(p_motivo),''));
    RETURN jsonb_build_object('id_practica',p_id_practica,'id_docente',p_id_docente,
      'id_docente_anterior',v_anterior,'mensaje','Asignación docente actualizada');
END $$;

-- S4.3 incremental integration: preserve signature and add transaction gate.
CREATE OR REPLACE FUNCTION public.fn_asignar_gestor_practica(
    p_id_practica BIGINT,
    p_id_admin BIGINT,
    p_id_gestor BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_estado VARCHAR(50);
    v_nombre_gestor TEXT;
BEGIN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('practicalink-academico:'||p_id_practica,0));
    IF NOT EXISTS (
        SELECT 1
        FROM public.usuario u
        JOIN public.usuario_rol ur ON ur.id_usuario = u.id_usuario
        JOIN public.rol r ON r.id_rol = ur.id_rol
        WHERE u.id_usuario = p_id_admin AND u.activo
          AND r.activo AND r.nombre = 'ADMINISTRADOR'
    ) THEN
        RETURN pg_catalog.jsonb_build_object('error', 'USUARIO_NO_AUTORIZADO');
    END IF;

    IF p_id_gestor IS NOT NULL THEN
        SELECT pg_catalog.concat(u.nombre, ' ', u.apellido)
        INTO v_nombre_gestor
        FROM public.usuario u
        JOIN public.usuario_rol ur ON ur.id_usuario = u.id_usuario
        JOIN public.rol r ON r.id_rol = ur.id_rol
        WHERE u.id_usuario = p_id_gestor AND u.activo
          AND r.activo AND r.nombre = 'GESTOR'
        FOR SHARE OF u;
        IF NOT FOUND THEN
            RETURN pg_catalog.jsonb_build_object('error', 'GESTOR_NO_DISPONIBLE');
        END IF;
    END IF;

    SELECT ep.nombre
    INTO v_estado
    FROM public.practica p
    JOIN public.estado_practica ep ON ep.id_estado = p.id_estado_actual
    WHERE p.id_practica = p_id_practica
    FOR UPDATE OF p;
    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('error', 'PRACTICA_NO_ENCONTRADA');
    END IF;

    IF v_estado IN ('FINALIZADA', 'RECHAZADA') THEN
        RETURN pg_catalog.jsonb_build_object('error', 'PRACTICA_FINALIZADA');
    END IF;

    UPDATE public.practica
    SET id_gestor = p_id_gestor, fecha_actualizacion = pg_catalog.clock_timestamp()
    WHERE id_practica = p_id_practica;

    RETURN pg_catalog.jsonb_build_object(
        'id_practica', p_id_practica,
        'id_gestor', p_id_gestor,
        'gestor', v_nombre_gestor,
        'mensaje', CASE WHEN p_id_gestor IS NULL
            THEN 'Asignación retirada'
            ELSE 'Gestor asignado correctamente' END
    );
END;
$$;

-- S4.3 incremental integration: preserve signature and add transaction gate.
CREATE OR REPLACE FUNCTION public.fn_actualizar_estado_practica(
    p_id_practica BIGINT,
    p_id_usuario BIGINT,
    p_id_estado BIGINT,
    p_observacion VARCHAR
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_estado_actual BIGINT;
    v_id_estudiante BIGINT;
    v_id_gestor BIGINT;
    v_nombre_estado VARCHAR(50);
    v_es_admin BOOLEAN;
    v_es_gestor BOOLEAN;
BEGIN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('practicalink-academico:'||p_id_practica,0));
    SELECT p.id_estado_actual, p.id_estudiante, p.id_gestor
    INTO v_estado_actual, v_id_estudiante, v_id_gestor
    FROM public.practica p
    WHERE p.id_practica = p_id_practica
    FOR UPDATE;
    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('error', 'PRACTICA_NO_ENCONTRADA');
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM public.usuario u
        JOIN public.usuario_rol ur ON ur.id_usuario = u.id_usuario
        JOIN public.rol r ON r.id_rol = ur.id_rol
        WHERE u.id_usuario = p_id_usuario AND u.activo
          AND r.activo AND r.nombre = 'ADMINISTRADOR'
    ) INTO v_es_admin;

    IF NOT v_es_admin THEN
        SELECT EXISTS (
            SELECT 1
            FROM public.usuario u
            JOIN public.usuario_rol ur ON ur.id_usuario = u.id_usuario
            JOIN public.rol r ON r.id_rol = ur.id_rol
            WHERE u.id_usuario = p_id_usuario AND u.activo
              AND r.activo AND r.nombre = 'GESTOR'
        ) INTO v_es_gestor;
        IF NOT v_es_gestor THEN
            RETURN pg_catalog.jsonb_build_object('error', 'USUARIO_NO_AUTORIZADO');
        END IF;
        IF v_id_gestor IS DISTINCT FROM p_id_usuario THEN
            RETURN pg_catalog.jsonb_build_object('error', 'GESTOR_NO_ASIGNADO_A_PRACTICA');
        END IF;
    END IF;

    -- Terminal: ningún destino es válido si la práctica ya está FINALIZADA (Corrección 1).
    IF EXISTS (
        SELECT 1
        FROM public.estado_practica ep
        WHERE ep.id_estado = v_estado_actual
          AND ep.nombre = 'FINALIZADA'
    ) THEN
        RETURN pg_catalog.jsonb_build_object('error', 'PRACTICA_FINALIZADA_NO_MODIFICABLE');
    END IF;

    SELECT ep.nombre
    INTO v_nombre_estado
    FROM public.estado_practica ep
    WHERE ep.id_estado = p_id_estado AND ep.activo;
    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('error', 'ESTADO_NO_DISPONIBLE');
    END IF;
    IF v_nombre_estado = 'FINALIZADA' THEN
        RETURN pg_catalog.jsonb_build_object('error', 'CIERRE_MANUAL_REQUERIDO');
    END IF;
    IF v_nombre_estado = 'EN_CURSO' THEN
        RETURN pg_catalog.jsonb_build_object('error', 'INICIO_RESTRINGIDO_REQUERIDO');
    END IF;

    IF v_estado_actual <> p_id_estado THEN
        UPDATE public.practica
        SET id_estado_actual = p_id_estado,
            fecha_actualizacion = pg_catalog.clock_timestamp()
        WHERE id_practica = p_id_practica;
        INSERT INTO public.historial_estado (
            id_practica, id_estado, id_usuario, observacion
        ) VALUES (
            p_id_practica, p_id_estado, p_id_usuario, p_observacion
        );
        INSERT INTO public.notificacion (
            id_usuario, id_practica, tipo, titulo, mensaje
        )
        SELECT e.id_usuario, p_id_practica, 'CAMBIO_ESTADO',
            'Estado de práctica actualizado',
            pg_catalog.concat('Tu práctica cambió al estado ', v_nombre_estado, '.')
        FROM public.estudiante e
        WHERE e.id_estudiante = v_id_estudiante;
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'id_practica', p_id_practica,
        'id_estado', p_id_estado,
        'estado', v_nombre_estado,
        'mensaje', CASE WHEN v_estado_actual <> p_id_estado
            THEN 'Estado actualizado y registrado en el historial'
            ELSE 'La práctica ya se encuentra en ese estado' END
    );
END;
$$;

-- S4.3 incremental integration: preserve signature and add transaction gate.
CREATE OR REPLACE FUNCTION public.fn_revisar_practica(
    p_id_practica BIGINT,
    p_id_usuario BIGINT,
    p_decision VARCHAR,
    p_observacion VARCHAR DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_estado_actual VARCHAR(50);
    v_id_estado BIGINT;
    v_id_estudiante BIGINT;
    v_id_gestor BIGINT;
    v_nombre_estado VARCHAR(50);
BEGIN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('practicalink-academico:'||p_id_practica,0));
    -- Mantiene vigente el rol durante la operación; coincide con el orden de
    -- bloqueos usuario -> práctica usado por la asignación administrativa.
    PERFORM 1
    FROM public.usuario u
    JOIN public.usuario_rol ur ON ur.id_usuario = u.id_usuario
    JOIN public.rol r ON r.id_rol = ur.id_rol
    WHERE u.id_usuario = p_id_usuario
      AND u.activo
      AND r.activo
      AND r.nombre = 'GESTOR'
    FOR SHARE OF u, ur, r;
    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('error', 'USUARIO_NO_AUTORIZADO');
    END IF;

    SELECT ep.nombre, p.id_estudiante, p.id_gestor
    INTO v_estado_actual, v_id_estudiante, v_id_gestor
    FROM public.practica p
    JOIN public.estado_practica ep ON ep.id_estado = p.id_estado_actual
    WHERE p.id_practica = p_id_practica
    FOR UPDATE OF p;
    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('error', 'SOLICITUD_NO_ENCONTRADA');
    END IF;

    IF v_estado_actual NOT IN ('REGISTRADA', 'EN_REVISION', 'OBSERVADA') THEN
        RETURN pg_catalog.jsonb_build_object('error', 'SOLICITUD_NO_REVISABLE');
    END IF;

    SELECT ep.id_estado, ep.nombre
    INTO v_id_estado, v_nombre_estado
    FROM public.estado_practica ep
    WHERE ep.nombre = pg_catalog.upper(p_decision)
      AND ep.activo
      AND ep.nombre IN ('APROBADA', 'OBSERVADA', 'RECHAZADA');
    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('error', 'DECISION_INVALIDA');
    END IF;

    IF v_nombre_estado = 'APROBADA'
       AND v_id_gestor IS NOT NULL
       AND v_id_gestor <> p_id_usuario THEN
        RETURN pg_catalog.jsonb_build_object('error', 'GESTOR_ASIGNADO_A_OTRO');
    END IF;

    UPDATE public.practica
    SET id_estado_actual = v_id_estado,
        id_gestor = CASE
            WHEN v_nombre_estado = 'APROBADA' THEN p_id_usuario
            ELSE id_gestor
        END,
        fecha_actualizacion = pg_catalog.clock_timestamp()
    WHERE id_practica = p_id_practica;

    INSERT INTO public.historial_estado (
        id_practica, id_estado, id_usuario, observacion
    ) VALUES (
        p_id_practica, v_id_estado, p_id_usuario,
        NULLIF(pg_catalog.btrim(p_observacion), '')
    );

    INSERT INTO public.notificacion (
        id_usuario, id_practica, tipo, titulo, mensaje
    )
    SELECT e.id_usuario, p_id_practica, 'CAMBIO_ESTADO',
        'Estado de práctica actualizado',
        pg_catalog.concat('Tu práctica cambió al estado ', v_nombre_estado, '.')
    FROM public.estudiante e
    WHERE e.id_estudiante = v_id_estudiante;

    RETURN pg_catalog.jsonb_build_object(
        'id_practica', p_id_practica,
        'estado', v_nombre_estado,
        'mensaje', 'Solicitud revisada correctamente'
    );
END;
$$;

-- S4.3 incremental integration: preserve signature and add transaction gate.
CREATE OR REPLACE FUNCTION practicas_privadas.fn_iniciar_practica(
    p_id_practica BIGINT,
    p_id_usuario BIGINT,
    p_observacion VARCHAR DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_id_estado_anterior BIGINT;
    v_nombre_estado_anterior VARCHAR(50);
    v_es_final BOOLEAN;
    v_id_estado_nuevo BIGINT;
    v_id_ultimo_estado BIGINT;
    v_fecha_ultimo_evento TIMESTAMPTZ;
    v_fecha_cambio TIMESTAMPTZ;
    v_id_historial BIGINT;
    v_id_practica_actualizada BIGINT;
    v_observacion TEXT;
    v_usuario_activo BOOLEAN;
    v_ids_roles BIGINT[] := ARRAY[]::BIGINT[];
    v_id_rol BIGINT;
    v_rol RECORD;
    v_autorizado BOOLEAN := FALSE;
    v_estado RECORD;
    v_destino_valido BOOLEAN := FALSE;
    v_id_gestor BIGINT;
    v_es_administrador BOOLEAN := FALSE;
BEGIN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('practicalink-academico:'||p_id_practica,0));
    IF NOT EXISTS (
        SELECT 1
        FROM public.usuario u
        JOIN public.usuario_rol ur ON ur.id_usuario = u.id_usuario
        JOIN public.rol r ON r.id_rol = ur.id_rol
        WHERE u.id_usuario = p_id_usuario AND u.activo = TRUE
          AND r.activo = TRUE AND r.nombre IN ('GESTOR', 'ADMINISTRADOR')
    ) THEN
        RETURN pg_catalog.jsonb_build_object('error', 'USUARIO_NO_AUTORIZADO');
    END IF;

    -- Bloquear usuario antes de sus asignaciones, como hace administracion.
    SELECT u.activo
    INTO v_usuario_activo
    FROM public.usuario u
    WHERE u.id_usuario = p_id_usuario
    FOR SHARE OF u;
    IF NOT FOUND OR v_usuario_activo IS NOT TRUE THEN
        RETURN pg_catalog.jsonb_build_object('error', 'USUARIO_NO_AUTORIZADO');
    END IF;

    FOR v_id_rol IN
        SELECT ur.id_rol
        FROM public.usuario_rol ur
        WHERE ur.id_usuario = p_id_usuario
        ORDER BY ur.id_rol
        FOR SHARE OF ur
    LOOP
        v_ids_roles := pg_catalog.array_append(v_ids_roles, v_id_rol);
    END LOOP;

    FOR v_rol IN
        SELECT r.id_rol, r.nombre, r.activo
        FROM public.rol r
        WHERE r.id_rol = ANY(v_ids_roles)
        ORDER BY r.id_rol
        FOR SHARE OF r
    LOOP
        IF v_rol.activo AND v_rol.nombre IN ('GESTOR', 'ADMINISTRADOR') THEN
            v_autorizado := TRUE;
        END IF;
        IF v_rol.activo AND v_rol.nombre = 'ADMINISTRADOR' THEN
            v_es_administrador := TRUE;
        END IF;
    END LOOP;
    IF NOT v_autorizado THEN
        RETURN pg_catalog.jsonb_build_object('error', 'USUARIO_NO_AUTORIZADO');
    END IF;

    SELECT p.id_estado_actual, p.id_gestor
    INTO v_id_estado_anterior, v_id_gestor
    FROM public.practica p
    WHERE p.id_practica = p_id_practica
    FOR UPDATE OF p;

    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('error', 'PRACTICA_NO_ENCONTRADA');
    END IF;

    IF v_id_gestor IS NULL OR NOT EXISTS (
        SELECT 1
        FROM public.usuario u
        JOIN public.usuario_rol ur ON ur.id_usuario = u.id_usuario
        JOIN public.rol r ON r.id_rol = ur.id_rol
        WHERE u.id_usuario = v_id_gestor
          AND u.activo
          AND r.activo
          AND r.nombre = 'GESTOR'
    ) THEN
        RETURN pg_catalog.jsonb_build_object('error', 'GESTOR_NO_ASIGNADO');
    END IF;
    IF NOT v_es_administrador AND v_id_gestor <> p_id_usuario THEN
        RETURN pg_catalog.jsonb_build_object('error', 'USUARIO_NO_AUTORIZADO');
    END IF;

    -- Bloquear ambas filas en orden estable, sin filtrar activo/es_final:
    -- los valores modificados por una transaccion previa deben poder rechazarse.
    FOR v_estado IN
        SELECT ep.id_estado, ep.nombre, ep.activo, ep.es_final
        FROM public.estado_practica ep
        WHERE ep.id_estado = v_id_estado_anterior OR ep.nombre = 'EN_CURSO'
        ORDER BY ep.id_estado
        FOR SHARE OF ep
    LOOP
        IF v_estado.id_estado = v_id_estado_anterior THEN
            v_nombre_estado_anterior := v_estado.nombre;
            v_es_final := v_estado.es_final;
        END IF;
        IF v_estado.nombre = 'EN_CURSO' THEN
            v_id_estado_nuevo := v_estado.id_estado;
            v_destino_valido := v_estado.activo AND NOT v_estado.es_final;
        END IF;
    END LOOP;

    IF v_es_final IS TRUE THEN
        RETURN pg_catalog.jsonb_build_object('error', 'ESTADO_FINAL');
    END IF;
    IF v_nombre_estado_anterior IS DISTINCT FROM 'APROBADA' THEN
        RETURN pg_catalog.jsonb_build_object('error', 'TRANSICION_NO_PERMITIDA');
    END IF;
    IF NOT v_destino_valido THEN
        RETURN pg_catalog.jsonb_build_object('error', 'ESTADO_DESTINO_NO_VALIDO');
    END IF;

    SELECT h.id_estado, h.fecha_cambio
    INTO v_id_ultimo_estado, v_fecha_ultimo_evento
    FROM public.historial_estado h
    WHERE h.id_practica = p_id_practica
    ORDER BY h.fecha_cambio DESC, h.id_historial DESC
    LIMIT 1;

    IF NOT FOUND OR v_id_ultimo_estado IS DISTINCT FROM v_id_estado_anterior THEN
        RETURN pg_catalog.jsonb_build_object('error', 'HISTORIAL_INCONSISTENTE');
    END IF;

    v_observacion := NULLIF(pg_catalog.btrim(p_observacion), '');
    IF pg_catalog.char_length(v_observacion) > 500 THEN
        RETURN pg_catalog.jsonb_build_object('error', 'OBSERVACION_INVALIDA');
    END IF;

    -- clock_timestamp evita utilizar el inicio de una transaccion que espero.
    v_fecha_cambio := pg_catalog.clock_timestamp();
    IF v_fecha_ultimo_evento > v_fecha_cambio THEN
        RETURN pg_catalog.jsonb_build_object('error', 'HISTORIAL_INCONSISTENTE');
    END IF;

    UPDATE public.practica
    SET id_estado_actual = v_id_estado_nuevo,
        fecha_actualizacion = v_fecha_cambio
    WHERE id_practica = p_id_practica
    RETURNING id_practica INTO v_id_practica_actualizada;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INICIO_NO_CONFIRMADO';
    END IF;

    INSERT INTO public.historial_estado (
        id_practica, id_estado, id_usuario, fecha_cambio, observacion
    ) VALUES (
        p_id_practica, v_id_estado_nuevo, p_id_usuario, v_fecha_cambio, v_observacion
    )
    RETURNING id_historial INTO v_id_historial;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INICIO_NO_CONFIRMADO';
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'id_practica', p_id_practica,
        'estado_anterior', pg_catalog.jsonb_build_object(
            'id_estado', v_id_estado_anterior, 'nombre', v_nombre_estado_anterior
        ),
        'estado', pg_catalog.jsonb_build_object(
            'id_estado', v_id_estado_nuevo, 'nombre', 'EN_CURSO', 'es_final', FALSE
        ),
        'fecha_ultimo_cambio_estado', v_fecha_cambio,
        'id_historial', v_id_historial
    );
END;
$$;

-- Isolated closure owner, same API executor. Never relax s42_no_write on practica.
GRANT USAGE ON SCHEMA public TO pl_s43_cierre_owner;
GRANT EXECUTE ON FUNCTION informes_privados.validar_cierre(bigint,bigint) TO pl_s43_cierre_owner;
GRANT SELECT(id_practica,id_estudiante,id_estado_actual,fecha_termino) ON public.practica TO pl_s43_cierre_owner;
GRANT UPDATE(id_estado_actual,fecha_actualizacion) ON public.practica TO pl_s43_cierre_owner;
GRANT SELECT(id_estudiante,id_usuario) ON public.estudiante TO pl_s43_cierre_owner;
GRANT SELECT(id_estado,nombre,activo,es_final),UPDATE(id_estado) ON public.estado_practica TO pl_s43_cierre_owner;
GRANT INSERT(id_practica,id_usuario,fecha_cierre,resultado,observacion,id_evaluacion),SELECT(id_cierre) ON public.cierre_practica TO pl_s43_cierre_owner;
GRANT INSERT(id_practica,id_estado,id_usuario,fecha_cambio,observacion),SELECT(id_historial) ON public.historial_estado TO pl_s43_cierre_owner;
GRANT INSERT(id_usuario,id_practica,tipo,titulo,mensaje),SELECT(id_notificacion) ON public.notificacion TO pl_s43_cierre_owner;
GRANT USAGE ON SEQUENCE public.cierre_practica_id_cierre_seq,public.historial_estado_id_historial_seq,public.notificacion_id_notificacion_seq TO pl_s43_cierre_owner;
CREATE POLICY s43_cierre_read ON public.practica FOR SELECT TO pl_s43_cierre_owner USING(true);
CREATE POLICY s43_cierre_update ON public.practica FOR UPDATE TO pl_s43_cierre_owner USING(true) WITH CHECK(true);
CREATE POLICY s43_cierre_student ON public.estudiante FOR SELECT TO pl_s43_cierre_owner USING(true);
CREATE POLICY s43_cierre_state ON public.estado_practica FOR SELECT TO pl_s43_cierre_owner USING(true);
CREATE POLICY s43_cierre_state_lock ON public.estado_practica FOR UPDATE TO pl_s43_cierre_owner USING(true) WITH CHECK(false);
CREATE POLICY s43_cierre_state_no_write ON public.estado_practica AS RESTRICTIVE FOR UPDATE TO pl_s43_cierre_owner USING(true) WITH CHECK(false);
CREATE POLICY s43_cierre_insert ON public.cierre_practica FOR INSERT TO pl_s43_cierre_owner WITH CHECK(true);
CREATE POLICY s43_cierre_select ON public.cierre_practica FOR SELECT TO pl_s43_cierre_owner USING(true);
CREATE POLICY s43_cierre_history_insert ON public.historial_estado FOR INSERT TO pl_s43_cierre_owner WITH CHECK(true);
CREATE POLICY s43_cierre_history_select ON public.historial_estado FOR SELECT TO pl_s43_cierre_owner USING(true);
CREATE POLICY s43_cierre_notification_insert ON public.notificacion FOR INSERT TO pl_s43_cierre_owner WITH CHECK(tipo='PRACTICA_FINALIZADA');
CREATE POLICY s43_cierre_notification_select ON public.notificacion FOR SELECT TO pl_s43_cierre_owner USING(true);
CREATE OR REPLACE FUNCTION public.fn_cerrar_practica(p_id_practica bigint,p_id_usuario bigint,p_observacion text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE eid uuid; q record; destino bigint; fecha timestamptz; cierre bigint; historial bigint; notificacion bigint;
BEGIN
 PERFORM informes_privados.bloquear(p_id_practica);
 eid:=informes_privados.validar_cierre(p_id_practica,p_id_usuario);
 IF char_length(p_observacion)>500 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OBSERVACION_CIERRE_INVALIDA'; END IF;
 SELECT ep.nombre,p.fecha_termino,e.id_usuario INTO q FROM public.practica p JOIN public.estado_practica ep ON ep.id_estado=p.id_estado_actual JOIN public.estudiante e USING(id_estudiante) WHERE p.id_practica=p_id_practica FOR UPDATE OF p;
 IF q.nombre<>'EN_CURSO' OR q.fecha_termino IS NULL OR q.fecha_termino>(clock_timestamp() AT TIME ZONE 'America/Santiago')::date THEN RAISE EXCEPTION USING ERRCODE='P0409',MESSAGE='PRACTICA_NO_CERRABLE'; END IF;
 SELECT id_estado INTO destino FROM public.estado_practica WHERE nombre='FINALIZADA' AND activo AND es_final FOR SHARE;
 IF destino IS NULL THEN RAISE EXCEPTION 'ESTADO_FINAL_NO_DISPONIBLE'; END IF;
 fecha:=clock_timestamp();
 INSERT INTO public.cierre_practica(id_practica,id_usuario,fecha_cierre,resultado,observacion,id_evaluacion) VALUES(p_id_practica,p_id_usuario,fecha,'APROBADA',nullif(btrim(p_observacion),''),eid) RETURNING id_cierre INTO cierre;
 UPDATE public.practica SET id_estado_actual=destino,fecha_actualizacion=fecha WHERE id_practica=p_id_practica;
 INSERT INTO public.historial_estado(id_practica,id_estado,id_usuario,fecha_cambio,observacion) VALUES(p_id_practica,destino,p_id_usuario,fecha,nullif(btrim(p_observacion),'')) RETURNING id_historial INTO historial;
 INSERT INTO public.notificacion(id_usuario,id_practica,tipo,titulo,mensaje) VALUES(q.id_usuario,p_id_practica,'PRACTICA_FINALIZADA','Práctica finalizada','Tu práctica profesional fue finalizada.') RETURNING id_notificacion INTO notificacion;
 RETURN jsonb_build_object('id_practica',p_id_practica,'id_cierre',cierre,'id_historial',historial,'id_notificacion',notificacion,'id_usuario_notificado',q.id_usuario,'estado','FINALIZADA','fecha_cierre',fecha,'mensaje','La práctica se finalizó correctamente');
END $$;
-- Ownership/ACL: do not transfer any public table to a function owner.
GRANT CREATE ON SCHEMA informes_privados TO pl_s42_owner;
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure AS firma FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='informes_privados' LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO pl_s42_owner',f.firma);
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.firma);
 END LOOP;
END $$;
REVOKE CREATE ON SCHEMA informes_privados FROM pl_s42_owner;
GRANT CREATE ON SCHEMA public TO pl_s43_cierre_owner;
ALTER FUNCTION public.fn_cerrar_practica(bigint,bigint,text) OWNER TO pl_s43_cierre_owner;
REVOKE CREATE ON SCHEMA public FROM pl_s43_cierre_owner;
REVOKE ALL ON FUNCTION public.fn_cerrar_practica(bigint,bigint,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.fn_cerrar_practica(bigint,bigint,text) TO pl_s42_executor;
GRANT EXECUTE ON FUNCTION informes_privados.interrumpir_evaluacion(bigint,bigint,text),informes_privados.normalizar_texto(text) TO pl_s41_docente_owner;
GRANT EXECUTE ON FUNCTION informes_privados.iniciar_evaluacion(bigint,bigint,uuid,bigint,bigint),informes_privados.resolver_evaluacion(bigint,bigint,uuid,uuid,text,text),informes_privados.historial_evaluacion(bigint,bigint) TO pl_s42_executor;
-- No backend EXECUTE on internal authorization, interruption or barrier functions.
REVOKE ALL ON public.evaluacion_informe,public.evaluacion_evento FROM pl_s42_executor,pl_s41_docente_executor;
REVOKE ALL ON SEQUENCE public.evaluacion_evento_id_evento_seq FROM PUBLIC,anon,authenticated,service_role,pl_s42_executor,pl_s41_docente_executor;
-- Invoker gate preserves the SQL calling context. Only the isolated closure
-- function owner may create a closure/final transition, even if a general
-- connection has legacy table DML. Superusers/installers remain outside this trust boundary.
CREATE FUNCTION informes_privados.origen_cierre() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,pg_temp AS $$
DECLARE final boolean;
BEGIN
 IF TG_TABLE_NAME='cierre_practica' THEN final:=true;
 ELSIF TG_TABLE_NAME='practica' THEN final:=EXISTS(SELECT 1 FROM public.estado_practica WHERE id_estado=NEW.id_estado_actual AND nombre='FINALIZADA');
 ELSE
  -- Independently enforce OLD in the invoker gate before inspecting NEW.
  IF TG_OP IN ('UPDATE','DELETE') THEN
   IF EXISTS(SELECT 1 FROM public.estado_practica WHERE id_estado=OLD.id_estado AND nombre='FINALIZADA') THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='HISTORIAL_FINALIZADA_INMUTABLE';
   END IF;
   IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  END IF;
  final:=EXISTS(SELECT 1 FROM public.estado_practica WHERE id_estado=NEW.id_estado AND nombre='FINALIZADA');
 END IF;
 IF final AND current_user<>'pl_s43_cierre_owner' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='FUNCION_PRIVADA_CIERRE_REQUERIDA'; END IF;
 RETURN NEW;
END $$;
GRANT CREATE ON SCHEMA informes_privados TO pl_s42_owner;
ALTER FUNCTION informes_privados.origen_cierre() OWNER TO pl_s42_owner;
REVOKE CREATE ON SCHEMA informes_privados FROM pl_s42_owner;
REVOKE ALL ON FUNCTION informes_privados.origen_cierre() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER a_s43_origen_cierre BEFORE INSERT ON public.cierre_practica FOR EACH ROW EXECUTE FUNCTION informes_privados.origen_cierre();
CREATE TRIGGER a_s43_origen_final BEFORE INSERT OR UPDATE OF id_estado_actual ON public.practica FOR EACH ROW EXECUTE FUNCTION informes_privados.origen_cierre();
CREATE TRIGGER a_s43_origen_historial BEFORE INSERT OR UPDATE OR DELETE ON public.historial_estado FOR EACH ROW EXECUTE FUNCTION informes_privados.origen_cierre();

CREATE FUNCTION informes_privados.no_eliminar_informe() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='HISTORIAL_INFORME_INMUTABLE'; END $$;
GRANT CREATE ON SCHEMA informes_privados TO pl_s42_owner;
ALTER FUNCTION informes_privados.no_eliminar_informe() OWNER TO pl_s42_owner;
REVOKE CREATE ON SCHEMA informes_privados FROM pl_s42_owner;
REVOKE ALL ON FUNCTION informes_privados.no_eliminar_informe() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER s43_no_eliminar_informe BEFORE DELETE ON public.informe_final FOR EACH ROW EXECUTE FUNCTION informes_privados.no_eliminar_informe();

-- Abort rather than silently retain unexpected ambient grants/memberships.
DO $$ DECLARE c text; r text; t text; BEGIN
 FOREACH c IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  FOREACH r IN ARRAY ARRAY['pl_s42_executor','pl_s42_owner','pl_s43_cierre_owner','pl_s41_docente_owner','pl_s41_docente_executor'] LOOP
   IF pg_has_role(c,r,'MEMBER') THEN RAISE EXCEPTION 'S43: cliente miembro de rol privado'; END IF;
  END LOOP;
  IF has_function_privilege(c,'public.fn_cerrar_practica(bigint,bigint,text)','EXECUTE') THEN RAISE EXCEPTION 'S43: cierre expuesto a cliente'; END IF;
 END LOOP;
 IF pg_has_role('pl_s42_executor','pl_s43_cierre_owner','MEMBER') OR pg_has_role('pl_s42_executor','pl_s42_owner','MEMBER') THEN RAISE EXCEPTION 'S43: executor alcanza propietario'; END IF;
 FOREACH t IN ARRAY ARRAY['evaluacion_informe','evaluacion_evento','informe_final','informe_entrega','cierre_practica'] LOOP
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid=('public.'||t)::regclass)
   OR has_table_privilege('pl_s42_executor','public.'||t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
   OR has_any_column_privilege('pl_s42_executor','public.'||t,'SELECT,INSERT,UPDATE,REFERENCES') THEN RAISE EXCEPTION 'S43: RLS/ACL ambiental incompatible en %',t; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) acl WHERE p.oid='public.fn_cerrar_practica(bigint,bigint,text)'::regprocedure AND acl.grantee NOT IN ('pl_s42_executor'::regrole,'pl_s43_cierre_owner'::regrole)) THEN RAISE EXCEPTION 'S43: revisar grants heredados de cierre'; END IF;
 IF has_schema_privilege('pl_s43_cierre_owner','public','CREATE') OR has_schema_privilege('pl_s42_executor','informes_privados','CREATE') THEN RAISE EXCEPTION 'S43: CREATE ambiental incompatible'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
  WHERE n.nspname='informes_privados' AND (acl.grantee NOT IN ('pl_s42_owner'::regrole,'pl_s42_executor'::regrole,'pl_s41_docente_owner'::regrole,'pl_s43_cierre_owner'::regrole)
   OR (acl.grantee='pl_s42_executor'::regrole AND p.proname NOT IN ('consultar','reservar','confirmar','archivo','limpieza','iniciar_evaluacion','resolver_evaluacion','historial_evaluacion'))
   OR (acl.grantee='pl_s41_docente_owner'::regrole AND p.proname NOT IN ('bloquear','interrumpir_evaluacion','normalizar_texto'))
   OR (acl.grantee='pl_s43_cierre_owner'::regrole AND p.proname NOT IN ('bloquear','validar_cierre')))) THEN RAISE EXCEPTION 'S43: EXECUTE ambiental incompatible'; END IF;
 IF EXISTS(SELECT 1 FROM pg_class WHERE relkind IN ('r','p') AND relowner IN ('pl_s42_owner'::regrole,'pl_s43_cierre_owner'::regrole)) THEN RAISE EXCEPTION 'S43: propietario de función no debe poseer tablas'; END IF;
END $$;
