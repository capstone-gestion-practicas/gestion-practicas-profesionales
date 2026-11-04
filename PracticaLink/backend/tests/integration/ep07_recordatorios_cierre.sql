-- EP07 · Corrección 6A: recordatorios de cierre (fn_procesar_recordatorios_cierre).
-- Ejecutar SOLO en un PostgreSQL de laboratorio desechable creado con las migraciones
-- versionadas hasta 20261103150000 inclusive. Datos sintéticos. Termina con ROLLBACK.
-- Uso: psql -X -v ON_ERROR_STOP=1 -U postgres -d <base_laboratorio> -f ep07_recordatorios_cierre.sql

BEGIN;

INSERT INTO usuario(id_usuario,nombre,apellido,correo,password_hash) VALUES
    (960,'Estudiante','Sintetico','ep07h-student@example.invalid','synthetic-hash'),
    (961,'Gestor activo','Sintetico','ep07h-gestor@example.invalid','synthetic-hash'),
    (962,'Gestor inactivo','Sintetico','ep07h-gestor-inactivo@example.invalid','synthetic-hash'),
    (963,'Admin A','Sintetico','ep07h-adminA@example.invalid','synthetic-hash'),
    (964,'Admin inactivo','Sintetico','ep07h-admin-inactivo@example.invalid','synthetic-hash'),
    (965,'Admin B','Sintetico','ep07h-adminB@example.invalid','synthetic-hash');
UPDATE usuario SET activo = FALSE WHERE id_usuario IN (962, 964);
INSERT INTO usuario_rol SELECT 960, id_rol FROM rol WHERE nombre = 'ESTUDIANTE';
INSERT INTO usuario_rol SELECT 961, id_rol FROM rol WHERE nombre = 'GESTOR';
INSERT INTO usuario_rol SELECT 962, id_rol FROM rol WHERE nombre = 'GESTOR';
INSERT INTO usuario_rol SELECT 963, id_rol FROM rol WHERE nombre = 'ADMINISTRADOR';
INSERT INTO usuario_rol SELECT 964, id_rol FROM rol WHERE nombre = 'ADMINISTRADOR';
INSERT INTO usuario_rol SELECT 965, id_rol FROM rol WHERE nombre = 'ADMINISTRADOR';
INSERT INTO estudiante(id_estudiante,id_usuario,rut,carrera,sede)
    VALUES (960, 960, '22222222-2', 'Carrera sintetica', 'Sede sintetica');
INSERT INTO centro_practica(id_centro,nombre) VALUES (960, 'Centro sintetico');

-- 9701: vencida, EN_CURSO, gestor activo (R-A).   9702: vencida, EN_CURSO, sin gestor (R-B).
-- 9703: vencida, EN_CURSO, gestor inactivo (R-C). 9704: no vencida, EN_CURSO (R-E).
-- 9705: vencida, FINALIZADA (R-F).
INSERT INTO practica(id_practica,id_estudiante,id_centro,id_estado_actual,fecha_inicio,fecha_termino,id_gestor) VALUES
    (9701, 960, 960, (SELECT id_estado FROM estado_practica WHERE nombre='EN_CURSO'), CURRENT_DATE-40, CURRENT_DATE-3, 961),
    (9702, 960, 960, (SELECT id_estado FROM estado_practica WHERE nombre='EN_CURSO'), CURRENT_DATE-40, CURRENT_DATE-3, NULL),
    (9703, 960, 960, (SELECT id_estado FROM estado_practica WHERE nombre='EN_CURSO'), CURRENT_DATE-40, CURRENT_DATE-3, 962),
    (9704, 960, 960, (SELECT id_estado FROM estado_practica WHERE nombre='EN_CURSO'), CURRENT_DATE-40, CURRENT_DATE+10, 961),
    (9705, 960, 960, (SELECT id_estado FROM estado_practica WHERE nombre='FINALIZADA'), CURRENT_DATE-40, CURRENT_DATE-3, 961);
INSERT INTO cierre_practica(id_practica,id_usuario,resultado) VALUES (9705, 961, 'APROBADA');

CREATE FUNCTION pg_temp.destinatarios(p BIGINT) RETURNS BIGINT[] LANGUAGE sql STABLE AS $$
    SELECT COALESCE(array_agg(n.id_usuario ORDER BY n.id_usuario), ARRAY[]::BIGINT[])
    FROM notificacion n WHERE n.id_practica = p AND n.tipo = 'CIERRE_PRACTICA_PENDIENTE'
$$;
CREATE FUNCTION pg_temp.recordatorio(p BIGINT) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM recordatorio_cierre_practica r WHERE r.id_practica = p)
$$;
CREATE FUNCTION pg_temp.total_notificaciones() RETURNS BIGINT LANGUAGE sql STABLE AS $$
    SELECT count(*) FROM notificacion WHERE tipo = 'CIERRE_PRACTICA_PENDIENTE' AND id_practica IN (9701,9702,9703,9704,9705)
$$;

-- Primera ejecución.
SELECT public.fn_procesar_recordatorios_cierre() AS primera_ejecucion \gset

-- R-A: gestor activo asignado + administradores activos (963, 965).
DO $$
BEGIN
    IF pg_temp.destinatarios(9701) IS DISTINCT FROM ARRAY[961,963,965]::BIGINT[] THEN
        RAISE EXCEPTION 'R-A fallido: destinatarios %', pg_temp.destinatarios(9701);
    END IF;
    IF NOT pg_temp.recordatorio(9701) THEN RAISE EXCEPTION 'R-A fallido: sin registro de control'; END IF;
END;
$$;

-- R-B: sin gestor -> administradores activos; el procesamiento no se omite.
DO $$
BEGIN
    IF pg_temp.destinatarios(9702) IS DISTINCT FROM ARRAY[963,965]::BIGINT[] THEN
        RAISE EXCEPTION 'R-B fallido: destinatarios %', pg_temp.destinatarios(9702);
    END IF;
    IF NOT pg_temp.recordatorio(9702) THEN RAISE EXCEPTION 'R-B fallido: sin registro de control'; END IF;
END;
$$;

-- R-C: gestor asignado inactivo -> no recibe; administradores activos sí.
DO $$
BEGIN
    IF pg_temp.destinatarios(9703) IS DISTINCT FROM ARRAY[963,965]::BIGINT[] THEN
        RAISE EXCEPTION 'R-C fallido: destinatarios %', pg_temp.destinatarios(9703);
    END IF;
END;
$$;

-- R-E, R-F: no vencida y FINALIZADA -> sin recordatorio.
DO $$
BEGIN
    IF pg_temp.destinatarios(9704) <> ARRAY[]::BIGINT[] OR pg_temp.recordatorio(9704) THEN
        RAISE EXCEPTION 'R-E fallido: práctica no vencida con recordatorio';
    END IF;
    IF pg_temp.destinatarios(9705) <> ARRAY[]::BIGINT[] OR pg_temp.recordatorio(9705) THEN
        RAISE EXCEPTION 'R-F fallido: práctica finalizada con recordatorio';
    END IF;
END;
$$;

-- R-G: práctica inexistente -> sin residuos; solo las tres prácticas candidatas tienen registro.
DO $$
BEGIN
    IF (SELECT count(*) FROM recordatorio_cierre_practica WHERE id_practica IN (9701,9702,9703,9704,9705,999999)) <> 3 THEN
        RAISE EXCEPTION 'R-G fallido: registros de control inesperados';
    END IF;
    IF EXISTS (SELECT 1 FROM notificacion WHERE id_practica = 999999) THEN
        RAISE EXCEPTION 'R-G fallido: residuo de notificación';
    END IF;
END;
$$;

-- R-H: cada destinatario recibe exactamente una notificación por práctica.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM notificacion
        WHERE tipo = 'CIERRE_PRACTICA_PENDIENTE' AND id_practica IN (9701,9702,9703)
        GROUP BY id_usuario, id_practica HAVING count(*) <> 1
    ) THEN
        RAISE EXCEPTION 'R-H fallido: notificación duplicada por destinatario';
    END IF;
END;
$$;

-- R-I: administrador inactivo -> no recibe.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM notificacion WHERE id_usuario = 964 AND tipo = 'CIERRE_PRACTICA_PENDIENTE') THEN
        RAISE EXCEPTION 'R-I fallido: administrador inactivo notificado';
    END IF;
END;
$$;

-- R-D: segunda ejecución -> cero duplicados, cero registros nuevos.
DO $$
DECLARE
    v_notif_antes BIGINT := (SELECT count(*) FROM notificacion);
    v_control_antes BIGINT := (SELECT count(*) FROM recordatorio_cierre_practica);
    v_resultado JSONB;
BEGIN
    v_resultado := public.fn_procesar_recordatorios_cierre();
    IF v_resultado IS DISTINCT FROM '[]'::JSONB THEN
        RAISE EXCEPTION 'R-D fallido: segunda ejecución devolvió %', v_resultado;
    END IF;
    IF (SELECT count(*) FROM notificacion) <> v_notif_antes
       OR (SELECT count(*) FROM recordatorio_cierre_practica) <> v_control_antes THEN
        RAISE EXCEPTION 'R-D fallido: duplicados tras segunda ejecución';
    END IF;
END;
$$;

-- R-J: sin administradores activos -> no se inventan destinatarios y no se consume el recordatorio;
-- al reactivar un administrador, la siguiente ejecución sí lo entrega.
SAVEPOINT sin_admins;
UPDATE usuario SET activo = FALSE WHERE id_usuario IN (963, 965);
DO $$
DECLARE
    v_resultado JSONB;
BEGIN
    DELETE FROM recordatorio_cierre_practica WHERE id_practica = 9702;
    DELETE FROM notificacion WHERE id_practica = 9702;
    v_resultado := public.fn_procesar_recordatorios_cierre();
    IF pg_temp.recordatorio(9702) OR EXISTS (SELECT 1 FROM notificacion WHERE id_practica = 9702) THEN
        RAISE EXCEPTION 'R-J fallido: se consumió el recordatorio sin destinatarios';
    END IF;
END;
$$;
UPDATE usuario SET activo = TRUE WHERE id_usuario = 963;
DO $$
BEGIN
    PERFORM public.fn_procesar_recordatorios_cierre();
    IF pg_temp.destinatarios(9702) IS DISTINCT FROM ARRAY[963]::BIGINT[] THEN
        RAISE EXCEPTION 'R-J fallido: el recordatorio no se entregó al reactivar: %', pg_temp.destinatarios(9702);
    END IF;
END;
$$;
ROLLBACK TO SAVEPOINT sin_admins;

-- TZ: la regla usa America/Santiago explícitamente y es independiente de la sesión.
-- Instantes absolutos fijados; fechas de calendario literales (no CURRENT_DATE).
-- Referencia verificada en PostgreSQL: 2026-07-01 00:00 Santiago (invierno) = 04:00 UTC;
-- 2026-04-05 00:00 Santiago (ya en invierno tras el cambio) = 04:00 UTC;
-- 2026-01-11 00:00 Santiago (verano) = 03:00 UTC.
CREATE FUNCTION pg_temp.habilitado_utc(f DATE, i TIMESTAMPTZ) RETURNS BOOLEAN LANGUAGE sql AS $$
    SELECT public.fn_ep07_recordatorio_habilitado(f, i)
$$;

-- TZ-A: sesión UTC. Aviso habilitado solo desde 04:00 UTC (medianoche Santiago, invierno).
SET TIME ZONE 'UTC';
DO $$
BEGIN
    IF public.fn_ep07_recordatorio_habilitado(DATE '2026-06-30', TIMESTAMPTZ '2026-07-01 03:59:59.999999+00') THEN
        RAISE EXCEPTION 'TZ-A fallido: habilitado antes de medianoche de Santiago (sesión UTC)';
    END IF;
    IF NOT public.fn_ep07_recordatorio_habilitado(DATE '2026-06-30', TIMESTAMPTZ '2026-07-01 04:00:00+00') THEN
        RAISE EXCEPTION 'TZ-A fallido: no habilitado en medianoche de Santiago (sesión UTC)';
    END IF;
END;
$$;

-- TZ-B: sesión America/Santiago. Mismo instante absoluto, mismo resultado.
SET TIME ZONE 'America/Santiago';
DO $$
BEGIN
    IF public.fn_ep07_recordatorio_habilitado(DATE '2026-06-30', TIMESTAMPTZ '2026-07-01 03:59:59.999999+00') THEN
        RAISE EXCEPTION 'TZ-B fallido: habilitado antes de medianoche (sesión Santiago)';
    END IF;
    IF NOT public.fn_ep07_recordatorio_habilitado(DATE '2026-06-30', TIMESTAMPTZ '2026-07-01 04:00:00+00') THEN
        RAISE EXCEPTION 'TZ-B fallido: no habilitado en medianoche (sesión Santiago)';
    END IF;
END;
$$;

-- TZ-C: inmediatamente antes de medianoche del día siguiente en Santiago -> no candidata.
DO $$
BEGIN
    IF public.fn_ep07_recordatorio_habilitado(DATE '2026-06-30', TIMESTAMPTZ '2026-06-30 23:59:59.999999 America/Santiago') THEN
        RAISE EXCEPTION 'TZ-C fallido: habilitado el mismo día de término';
    END IF;
END;
$$;

-- TZ-D: medianoche exacta e inmediatamente posterior en Santiago -> candidata.
DO $$
BEGIN
    IF NOT public.fn_ep07_recordatorio_habilitado(DATE '2026-06-30', TIMESTAMPTZ '2026-07-01 00:00:00 America/Santiago') THEN
        RAISE EXCEPTION 'TZ-D fallido: no habilitado en medianoche exacta';
    END IF;
    IF NOT public.fn_ep07_recordatorio_habilitado(DATE '2026-06-30', TIMESTAMPTZ '2026-07-01 00:00:00.000001 America/Santiago') THEN
        RAISE EXCEPTION 'TZ-D fallido: no habilitado justo después de medianoche';
    END IF;
END;
$$;

-- TZ-E: cambios de horario de Chile. Medianoche local sigue siendo medianoche de Santiago.
-- Otoño 2026: 2026-04-05 00:00 local = 04:00 UTC (no 03:00). Verano 2026-01-11 00:00 local = 03:00 UTC.
DO $$
BEGIN
    IF public.fn_ep07_recordatorio_habilitado(DATE '2026-04-04', TIMESTAMPTZ '2026-04-05 03:59:59.999999+00') THEN
        RAISE EXCEPTION 'TZ-E fallido: otoño habilitado antes de medianoche local';
    END IF;
    IF NOT public.fn_ep07_recordatorio_habilitado(DATE '2026-04-04', TIMESTAMPTZ '2026-04-05 04:00:00+00') THEN
        RAISE EXCEPTION 'TZ-E fallido: otoño no habilitado en medianoche local';
    END IF;
    IF public.fn_ep07_recordatorio_habilitado(DATE '2026-01-10', TIMESTAMPTZ '2026-01-11 02:59:59.999999+00') THEN
        RAISE EXCEPTION 'TZ-E fallido: verano habilitado antes de medianoche local';
    END IF;
    IF NOT public.fn_ep07_recordatorio_habilitado(DATE '2026-01-10', TIMESTAMPTZ '2026-01-11 03:00:00+00') THEN
        RAISE EXCEPTION 'TZ-E fallido: verano no habilitado en medianoche local';
    END IF;
    IF public.fn_ep07_recordatorio_habilitado(NULL, TIMESTAMPTZ '2026-07-01 04:00:00+00') IS TRUE THEN
        RAISE EXCEPTION 'TZ-E fallido: fecha nula habilitada';
    END IF;
END;
$$;

-- TZ-F: el resultado no cambia con la sesión (mismo conjunto de instantes bajo UTC y Santiago).
SET TIME ZONE 'UTC';
CREATE TEMP TABLE tz_utc AS
    SELECT i, public.fn_ep07_recordatorio_habilitado(DATE '2026-06-30', i) AS habilitado
    FROM unnest(ARRAY[TIMESTAMPTZ '2026-07-01 03:59:59.999999+00', TIMESTAMPTZ '2026-07-01 04:00:00+00']) AS i;
SET TIME ZONE 'America/Santiago';
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM tz_utc t
        WHERE t.habilitado IS DISTINCT FROM public.fn_ep07_recordatorio_habilitado(DATE '2026-06-30', t.i)
    ) THEN
        RAISE EXCEPTION 'TZ-F fallido: el resultado depende de la sesión';
    END IF;
END;
$$;

SELECT 'EP07 recordatorios de cierre: casos R-A a R-J y TZ-A a TZ-F aprobados' AS resultado;

ROLLBACK;
