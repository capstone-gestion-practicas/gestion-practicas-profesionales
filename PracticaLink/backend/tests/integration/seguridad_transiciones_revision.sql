-- SOLO laboratorio desechable, con todas las migraciones incluida
-- 20261113100000_bloquear_revision_estado_generico.sql. No ejecutado automáticamente.
-- Comprueba llamadas SQL directas, sin FastAPI. Datos sintéticos y rollback.
\set ON_ERROR_STOP 1
BEGIN;
DO $$
DECLARE
    g bigint; a bigint; ag bigint; e bigint; est bigint; centro bigint; p bigint;
    actor bigint; destino record; resultado jsonb; antes jsonb; despues jsonb;
    h bigint; n bigint; inicial bigint;
BEGIN
    INSERT INTO public.usuario(nombre,apellido,correo,password_hash)
    VALUES ('Gestor','Sintético','g@transiciones.invalid','synthetic-hash') RETURNING id_usuario INTO g;
    INSERT INTO public.usuario(nombre,apellido,correo,password_hash)
    VALUES ('Admin','Sintético','a@transiciones.invalid','synthetic-hash') RETURNING id_usuario INTO a;
    INSERT INTO public.usuario(nombre,apellido,correo,password_hash)
    VALUES ('Multirol','Sintético','ag@transiciones.invalid','synthetic-hash') RETURNING id_usuario INTO ag;
    INSERT INTO public.usuario(nombre,apellido,correo,password_hash)
    VALUES ('Estudiante','Sintético','e@transiciones.invalid','synthetic-hash') RETURNING id_usuario INTO e;
    INSERT INTO public.usuario_rol(id_usuario,id_rol)
    SELECT g,id_rol FROM public.rol WHERE nombre='GESTOR';
    INSERT INTO public.usuario_rol(id_usuario,id_rol)
    SELECT a,id_rol FROM public.rol WHERE nombre='ADMINISTRADOR';
    INSERT INTO public.usuario_rol(id_usuario,id_rol)
    SELECT ag,id_rol FROM public.rol WHERE nombre IN ('ADMINISTRADOR','GESTOR');
    INSERT INTO public.usuario_rol(id_usuario,id_rol)
    SELECT e,id_rol FROM public.rol WHERE nombre='ESTUDIANTE';
    INSERT INTO public.estudiante(id_usuario,rut,carrera,sede)
    VALUES (e,'33333333-3','Carrera sintética','Sede sintética') RETURNING id_estudiante INTO est;
    INSERT INTO public.centro_practica(nombre) VALUES ('Centro transiciones sintético') RETURNING id_centro INTO centro;
    SELECT id_estado INTO STRICT inicial FROM public.estado_practica WHERE nombre='REGISTRADA' AND activo;
    INSERT INTO public.practica(id_estudiante,id_centro,id_estado_actual,id_gestor)
    VALUES (est,centro,inicial,g) RETURNING id_practica INTO p;
    INSERT INTO public.historial_estado(id_practica,id_estado,id_usuario) VALUES(p,inicial,e);

    SELECT to_jsonb(pr) INTO antes FROM public.practica pr WHERE id_practica=p;
    SELECT count(*) INTO h FROM public.historial_estado WHERE id_practica=p;
    SELECT count(*) INTO n FROM public.notificacion WHERE id_practica=p;
    FOREACH actor IN ARRAY ARRAY[g,a,ag] LOOP
        FOR destino IN SELECT id_estado,nombre FROM public.estado_practica
                       WHERE nombre IN ('APROBADA','OBSERVADA','RECHAZADA') AND activo LOOP
            resultado:=public.fn_actualizar_estado_practica(p,actor,destino.id_estado,'Intento directo');
            IF resultado IS DISTINCT FROM '{"error":"REVISION_FORMAL_REQUERIDA"}'::jsonb THEN
                RAISE EXCEPTION 'Bypass para actor %, destino %: %',actor,destino.nombre,resultado;
            END IF;
            SELECT to_jsonb(pr) INTO despues FROM public.practica pr WHERE id_practica=p;
            IF antes IS DISTINCT FROM despues
               OR h<>(SELECT count(*) FROM public.historial_estado WHERE id_practica=p)
               OR n<>(SELECT count(*) FROM public.notificacion WHERE id_practica=p) THEN
                RAISE EXCEPTION 'Intento rechazado produjo efectos';
            END IF;
        END LOOP;
    END LOOP;
    IF 3<>(SELECT count(*) FROM public.estado_practica WHERE nombre IN ('APROBADA','OBSERVADA','RECHAZADA') AND activo) THEN
        RAISE EXCEPTION 'Catálogo de revisión incompleto';
    END IF;

    -- Las mismas decisiones siguen disponibles en el flujo formal del GESTOR.
    FOR destino IN SELECT id_estado,nombre FROM public.estado_practica
                   WHERE nombre IN ('APROBADA','OBSERVADA','RECHAZADA') AND activo LOOP
        resultado:=public.fn_actualizar_estado_practica(p,g,
            (SELECT id_estado FROM public.estado_practica WHERE nombre='EN_REVISION'),'Preparar revisión');
        IF resultado->>'estado' IS DISTINCT FROM 'EN_REVISION' THEN
            RAISE EXCEPTION 'Transición genérica legítima rechazada: %',resultado;
        END IF;
        resultado:=public.fn_revisar_practica(p,g,destino.nombre,'Decisión formal sintética');
        IF resultado->>'estado' IS DISTINCT FROM destino.nombre THEN
            RAISE EXCEPTION 'Revisión formal rechazada: %',resultado;
        END IF;
    END LOOP;
END $$;
ROLLBACK;
