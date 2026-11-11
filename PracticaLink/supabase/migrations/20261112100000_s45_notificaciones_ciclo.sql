-- S4.5: avisos del ciclo de práctica. Migración incremental; no edita migraciones aplicadas.
-- Cada función conserva su firma, su modo de seguridad, su dueño y sus validaciones; solo añade la inserción de aviso.
-- Permisos mínimos nuevos:
--  * pl_ep04_owner (inicio): leer practica.id_estudiante y estudiante.id_usuario; insertar PRACTICA_INICIADA.
--  * pl_s43_cierre_owner (cierre): leer practica.id_docente (ya tenía INSERT de PRACTICA_FINALIZADA).
--  * fn_asignar_gestor_practica y fn_registrar_incidencia son SECURITY INVOKER: usan el rol del llamador, como ya hace fn_actualizar_estado_practica.

GRANT SELECT(id_estudiante,id_usuario) ON public.estudiante TO pl_ep04_owner;
CREATE POLICY s45_ep04_read_estudiante ON public.estudiante FOR SELECT TO pl_ep04_owner USING (true);
GRANT INSERT(id_usuario,id_practica,tipo,titulo,mensaje) ON public.notificacion TO pl_ep04_owner;
GRANT USAGE ON SEQUENCE public.notificacion_id_notificacion_seq TO pl_ep04_owner;
CREATE POLICY s45_ep04_notify ON public.notificacion FOR INSERT TO pl_ep04_owner WITH CHECK (tipo='PRACTICA_INICIADA');
GRANT SELECT(id_docente) ON public.practica TO pl_s43_cierre_owner;
GRANT SELECT(id_estudiante) ON public.practica TO pl_ep04_owner;

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
    v_gestor_anterior BIGINT;
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

    SELECT ep.nombre, p.id_gestor
    INTO v_estado, v_gestor_anterior
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

    IF p_id_gestor IS DISTINCT FROM v_gestor_anterior THEN
        IF v_gestor_anterior IS NOT NULL THEN
            INSERT INTO public.notificacion(id_usuario,id_practica,tipo,titulo,mensaje)
            VALUES (v_gestor_anterior,p_id_practica,'GESTOR_REASIGNADO','Práctica reasignada',
                'La práctica dejó de estar a tu cargo como gestor responsable.');
        END IF;
        IF p_id_gestor IS NOT NULL THEN
            INSERT INTO public.notificacion(id_usuario,id_practica,tipo,titulo,mensaje)
            VALUES (p_id_gestor,p_id_practica,'GESTOR_ASIGNADO','Práctica asignada',
                'Se te asignó una práctica como gestor responsable.');
        END IF;
    END IF;

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

    INSERT INTO public.notificacion(id_usuario,id_practica,tipo,titulo,mensaje)
    SELECT e.id_usuario, p_id_practica, 'PRACTICA_INICIADA', 'Práctica iniciada',
           'Tu práctica quedó en curso.'
      FROM public.practica p JOIN public.estudiante e ON e.id_estudiante = p.id_estudiante
     WHERE p.id_practica = p_id_practica;

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

CREATE OR REPLACE FUNCTION public.fn_cerrar_practica(p_id_practica bigint,p_id_usuario bigint,p_observacion text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE eid uuid; q record; destino bigint; fecha timestamptz; cierre bigint; historial bigint; notificacion bigint;
BEGIN
 PERFORM informes_privados.bloquear(p_id_practica);
 eid:=informes_privados.validar_cierre(p_id_practica,p_id_usuario);
 IF char_length(p_observacion)>500 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OBSERVACION_CIERRE_INVALIDA'; END IF;
 SELECT ep.nombre,p.fecha_termino,e.id_usuario,p.id_docente INTO q FROM public.practica p JOIN public.estado_practica ep ON ep.id_estado=p.id_estado_actual JOIN public.estudiante e USING(id_estudiante) WHERE p.id_practica=p_id_practica FOR UPDATE OF p;
 IF q.nombre<>'EN_CURSO' OR q.fecha_termino IS NULL OR q.fecha_termino>(clock_timestamp() AT TIME ZONE 'America/Santiago')::date THEN RAISE EXCEPTION USING ERRCODE='P0409',MESSAGE='PRACTICA_NO_CERRABLE'; END IF;
 SELECT id_estado INTO destino FROM public.estado_practica WHERE nombre='FINALIZADA' AND activo AND es_final FOR SHARE;
 IF destino IS NULL THEN RAISE EXCEPTION 'ESTADO_FINAL_NO_DISPONIBLE'; END IF;
 fecha:=clock_timestamp();
 INSERT INTO public.cierre_practica(id_practica,id_usuario,fecha_cierre,resultado,observacion,id_evaluacion) VALUES(p_id_practica,p_id_usuario,fecha,'APROBADA',nullif(btrim(p_observacion),''),eid) RETURNING id_cierre INTO cierre;
 UPDATE public.practica SET id_estado_actual=destino,fecha_actualizacion=fecha WHERE id_practica=p_id_practica;
 INSERT INTO public.historial_estado(id_practica,id_estado,id_usuario,fecha_cambio,observacion) VALUES(p_id_practica,destino,p_id_usuario,fecha,nullif(btrim(p_observacion),'')) RETURNING id_historial INTO historial;
 INSERT INTO public.notificacion(id_usuario,id_practica,tipo,titulo,mensaje) VALUES(q.id_usuario,p_id_practica,'PRACTICA_FINALIZADA','Práctica finalizada','Tu práctica profesional fue finalizada.') RETURNING id_notificacion INTO notificacion;
 IF q.id_docente IS NOT NULL THEN
 INSERT INTO public.notificacion(id_usuario,id_practica,tipo,titulo,mensaje)
 VALUES(q.id_docente,p_id_practica,'PRACTICA_FINALIZADA','Práctica finalizada','La práctica que evaluaste fue finalizada.');
END IF;
RETURN jsonb_build_object('id_practica',p_id_practica,'id_cierre',cierre,'id_historial',historial,'id_notificacion',notificacion,'id_usuario_notificado',q.id_usuario,'estado','FINALIZADA','fecha_cierre',fecha,'mensaje','La práctica se finalizó correctamente');
END $$;

CREATE OR REPLACE FUNCTION public.fn_registrar_incidencia(
    p_id_practica BIGINT,
    p_id_usuario BIGINT,
    p_fecha DATE,
    p_descripcion TEXT,
    p_prioridad VARCHAR
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_id_incidencia BIGINT;
    v_fecha TIMESTAMPTZ;
    v_alerta BOOLEAN := FALSE;
    v_gestor BIGINT;
    v_gestor_activo INTEGER;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM practica p
        JOIN estado_practica ep ON ep.id_estado = p.id_estado_actual
        WHERE p.id_practica = p_id_practica AND NOT ep.es_final
    ) THEN
        RETURN jsonb_build_object('error', 'PRACTICA_NO_DISPONIBLE');
    END IF;

    INSERT INTO incidencia (id_practica, id_usuario, fecha, descripcion, prioridad)
    VALUES (
        p_id_practica, p_id_usuario,
        (COALESCE(p_fecha, CURRENT_DATE) + TIME '12:00') AT TIME ZONE 'UTC',
        p_descripcion, p_prioridad
    )
    RETURNING id_incidencia, fecha INTO v_id_incidencia, v_fecha;

    IF p_prioridad IN ('ALTA', 'CRITICA') THEN
        INSERT INTO alerta (id_incidencia, tipo, mensaje)
        VALUES (
            v_id_incidencia,
            'INCIDENCIA_' || p_prioridad,
            'Incidencia de prioridad ' || LOWER(p_prioridad) || ' requiere atención.'
        );
        v_alerta := TRUE;
        SELECT id_gestor INTO v_gestor FROM practica WHERE id_practica = p_id_practica;
        SELECT COUNT(*) INTO v_gestor_activo
          FROM usuario u JOIN usuario_rol ur ON ur.id_usuario = u.id_usuario
          JOIN rol r ON r.id_rol = ur.id_rol
         WHERE u.id_usuario = v_gestor AND u.activo AND r.activo AND r.nombre = 'GESTOR';
        IF v_gestor_activo > 0 THEN
            INSERT INTO notificacion(id_usuario,id_practica,tipo,titulo,mensaje)
            VALUES (v_gestor,p_id_practica,'INCIDENCIA_' || p_prioridad,'Incidencia de prioridad ' || LOWER(p_prioridad),
                    'Se registró una incidencia de prioridad ' || LOWER(p_prioridad) || ' en tu práctica.');
        ELSE
            INSERT INTO notificacion(id_usuario,id_practica,tipo,titulo,mensaje)
            SELECT DISTINCT u.id_usuario, p_id_practica, 'INCIDENCIA_' || p_prioridad,
                   'Incidencia de prioridad ' || LOWER(p_prioridad),
                   'Se registró una incidencia de prioridad ' || LOWER(p_prioridad) || ' sin gestor activo asignado.'
              FROM usuario u JOIN usuario_rol ur ON ur.id_usuario = u.id_usuario
              JOIN rol r ON r.id_rol = ur.id_rol
             WHERE u.activo AND r.activo AND r.nombre = 'ADMINISTRADOR';
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'id_incidencia', v_id_incidencia,
        'id_practica', p_id_practica,
        'id_usuario', p_id_usuario,
        'usuario', (SELECT CONCAT(nombre, ' ', apellido) FROM usuario WHERE id_usuario = p_id_usuario),
        'fecha', v_fecha,
        'descripcion', p_descripcion,
        'prioridad', p_prioridad,
        'estado', 'ABIERTA',
        'fecha_resolucion', NULL,
        'alerta', v_alerta,
        'estudiante', (SELECT CONCAT(u.nombre, ' ', u.apellido) FROM practica p JOIN estudiante e ON e.id_estudiante = p.id_estudiante JOIN usuario u ON u.id_usuario = e.id_usuario WHERE p.id_practica = p_id_practica),
        'correo_estudiante', (SELECT u.correo FROM practica p JOIN estudiante e ON e.id_estudiante = p.id_estudiante JOIN usuario u ON u.id_usuario = e.id_usuario WHERE p.id_practica = p_id_practica),
        'centro_practica', (SELECT cp.nombre FROM practica p JOIN centro_practica cp ON cp.id_centro = p.id_centro WHERE p.id_practica = p_id_practica)
    );
END;
$$;
