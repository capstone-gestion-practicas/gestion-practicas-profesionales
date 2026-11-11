-- S4.4: listado docente con estado del informe + notificación de asignación.
-- Migración incremental. No modifica migraciones aplicadas.
-- Principio: el rol docente no obtiene lectura directa de informe_final ni evaluacion_informe.
-- Solo una función restringida (informes_privados.resumen_docente) devuelve un resumen
-- de la versión vigente, y únicamente para la práctica cuyo docente asignado es el solicitado.

-- 1) Permiso acotado para notificar la asignación (política RLS con tipo fijo, como S4.2/S4.3).
GRANT INSERT(id_usuario,id_practica,tipo,titulo,mensaje) ON public.notificacion TO pl_s41_docente_owner;
GRANT USAGE ON SEQUENCE public.notificacion_id_notificacion_seq TO pl_s41_docente_owner;
CREATE POLICY s44_docente_notify ON public.notificacion FOR INSERT TO pl_s41_docente_owner
    WITH CHECK (tipo='PRACTICA_ASIGNADA');

-- 2) Resumen de informe y evaluación vigente, sin exponer filas ni archivos.
-- pl_s42_owner ya tiene GRANT SELECT por columnas en practica, pero practica tiene RLS habilitado:
-- sin esta política, la función vería cero filas. Punto de revisión de seguridad.
CREATE POLICY s44_resumen_read_practica ON public.practica FOR SELECT TO pl_s42_owner USING (true);
CREATE FUNCTION informes_privados.resumen_docente(p_id_practica BIGINT, p_id_docente BIGINT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_estado TEXT; v_version BIGINT; v_resultado TEXT;
BEGIN
    PERFORM 1 FROM public.practica p WHERE p.id_practica=p_id_practica AND p.id_docente=p_id_docente;
    IF NOT FOUND THEN RETURN NULL; END IF;
    SELECT f.estado, f.version INTO v_estado, v_version
      FROM public.informe_final f WHERE f.id_practica=p_id_practica AND f.id_documento IS NOT NULL;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('informe_estado',NULL,'informe_version',NULL,'evaluacion_resultado',NULL);
    END IF;
    SELECT e.resultado INTO v_resultado FROM public.evaluacion_informe e
      WHERE e.id_practica=p_id_practica AND e.version=v_version AND e.estado='RESUELTA';
    RETURN jsonb_build_object('informe_estado',v_estado,'informe_version',v_version,'evaluacion_resultado',v_resultado);
END $$;
ALTER FUNCTION informes_privados.resumen_docente(BIGINT,BIGINT) OWNER TO pl_s42_owner;
REVOKE ALL ON FUNCTION informes_privados.resumen_docente(BIGINT,BIGINT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION informes_privados.resumen_docente(BIGINT,BIGINT) TO pl_s41_docente_owner;

-- 3) Listado docente: mismas columnas y firma, con los campos del informe añadidos.
CREATE OR REPLACE FUNCTION docente_privado.fn_listar_practicas_asignadas(p_id_docente BIGINT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_resultado JSONB;
BEGIN
    PERFORM 1 FROM public.usuario u JOIN public.usuario_rol ur USING(id_usuario)
      JOIN public.rol r USING(id_rol) WHERE u.id_usuario=p_id_docente AND u.activo
      AND r.activo AND r.nombre='DOCENTE' FOR SHARE OF u, ur, r;
    IF NOT FOUND THEN RETURN jsonb_build_object('error','USUARIO_NO_AUTORIZADO'); END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id_practica',p.id_practica,'estado',ep.nombre,'estudiante',concat(u.nombre,' ',u.apellido),
      'centro_practica',cp.nombre,'fecha_inicio',p.fecha_inicio,'fecha_termino',p.fecha_termino,
      'cargo_funcion',p.cargo_funcion,'descripcion',p.descripcion,
      'informe_estado',rs.r->'informe_estado','informe_version',rs.r->'informe_version',
      'evaluacion_resultado',rs.r->'evaluacion_resultado') ORDER BY p.id_practica), '[]'::jsonb)
      INTO v_resultado FROM public.practica p JOIN public.estado_practica ep ON ep.id_estado=p.id_estado_actual
      JOIN public.estudiante e ON e.id_estudiante=p.id_estudiante
      JOIN public.usuario u ON u.id_usuario=e.id_usuario
      JOIN public.centro_practica cp ON cp.id_centro=p.id_centro
      CROSS JOIN LATERAL (SELECT informes_privados.resumen_docente(p.id_practica,p_id_docente) AS r) rs
      WHERE p.id_docente=p_id_docente;
    RETURN v_resultado;
END $$;

-- 4) Asignación: misma función S4.3 (mismo bloqueo, validaciones y orden) y notificación
--    dentro de la misma transacción. Un fallo deshace también el aviso.
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
    IF p_id_docente IS NOT NULL THEN
      INSERT INTO public.notificacion(id_usuario,id_practica,tipo,titulo,mensaje)
      VALUES(p_id_docente,p_id_practica,'PRACTICA_ASIGNADA','Práctica asignada','Un gestor te asignó como profesor guía de una práctica.');
    END IF;
    RETURN jsonb_build_object('id_practica',p_id_practica,'id_docente',p_id_docente,
      'id_docente_anterior',v_anterior,'mensaje','Asignación docente actualizada');
END $$;

-- 5) Validación ambiental: EXECUTE de pl_s41_docente_owner en informes_privados solo en las funciones permitidas.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
   WHERE n.nspname='informes_privados' AND acl.grantee='pl_s41_docente_owner'::regrole
     AND p.proname NOT IN ('bloquear','interrumpir_evaluacion','normalizar_texto','resumen_docente')) THEN
   RAISE EXCEPTION 'S44: EXECUTE ambiental incompatible para pl_s41_docente_owner';
 END IF;
 IF has_table_privilege('pl_s41_docente_owner','public.informe_final','SELECT')
   OR has_table_privilege('pl_s41_docente_owner','public.evaluacion_informe','SELECT') THEN
   RAISE EXCEPTION 'S44: lectura directa de informes no permitida al rol docente';
 END IF;
END $$;
