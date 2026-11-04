-- EP07 · Corrección 3: prueba PostgreSQL de practicas_privadas.fn_iniciar_practica.
-- Ejecutar SOLO en un PostgreSQL de laboratorio desechable creado únicamente con las
-- migraciones versionadas hasta 20261103130000 inclusive (sin scripts manuales ep04).
-- Datos sintéticos. Todo ocurre en una transacción que termina con ROLLBACK.
-- Uso: psql -X -v ON_ERROR_STOP=1 -U postgres -d <base_laboratorio> -f ep07_inicio_practica.sql

BEGIN;

INSERT INTO usuario(id_usuario,nombre,apellido,correo,password_hash) VALUES
    (940,'Estudiante','Sintetico','ep07f-student@example.invalid','synthetic-hash'),
    (941,'Gestor A','Sintetico','ep07f-gestorA@example.invalid','synthetic-hash'),
    (942,'Gestor B','Sintetico','ep07f-gestorB@example.invalid','synthetic-hash'),
    (943,'Admin','Sintetico','ep07f-admin@example.invalid','synthetic-hash'),
    (944,'Sin rol','Sintetico','ep07f-norole@example.invalid','synthetic-hash'),
    (945,'Gestor inactivo','Sintetico','ep07f-inactive@example.invalid','synthetic-hash');
UPDATE usuario SET activo = FALSE WHERE id_usuario = 945;
INSERT INTO usuario_rol SELECT 940, id_rol FROM rol WHERE nombre = 'ESTUDIANTE';
INSERT INTO usuario_rol SELECT 941, id_rol FROM rol WHERE nombre = 'GESTOR';
INSERT INTO usuario_rol SELECT 942, id_rol FROM rol WHERE nombre = 'GESTOR';
INSERT INTO usuario_rol SELECT 943, id_rol FROM rol WHERE nombre = 'ADMINISTRADOR';
INSERT INTO usuario_rol SELECT 945, id_rol FROM rol WHERE nombre = 'GESTOR';
INSERT INTO estudiante(id_estudiante,id_usuario,rut,carrera,sede)
    VALUES (940, 940, '44444444-4', 'Carrera sintetica', 'Sede sintetica');
INSERT INTO centro_practica(id_centro,nombre) VALUES (940, 'Centro sintetico');

-- 9501: APROBADA, gestor A.      9502: APROBADA, gestor A (caso de reasignación/B).
-- 9503: APROBADA, sin gestor.    9504: APROBADA, gestor inactivo (945).
-- 9505: REGISTRADA, gestor A (no iniciable).  9506: FINALIZADA, gestor A (estado final).
-- 9507: APROBADA, gestor A, usada para el inicio exitoso (caso A).
INSERT INTO practica(id_practica,id_estudiante,id_centro,id_estado_actual,fecha_inicio,fecha_termino,id_gestor) VALUES
    (9501, 940, 940, (SELECT id_estado FROM estado_practica WHERE nombre='APROBADA'), CURRENT_DATE-30, CURRENT_DATE+30, 941),
    (9502, 940, 940, (SELECT id_estado FROM estado_practica WHERE nombre='APROBADA'), CURRENT_DATE-30, CURRENT_DATE+30, 941),
    (9503, 940, 940, (SELECT id_estado FROM estado_practica WHERE nombre='APROBADA'), CURRENT_DATE-30, CURRENT_DATE+30, NULL),
    (9504, 940, 940, (SELECT id_estado FROM estado_practica WHERE nombre='APROBADA'), CURRENT_DATE-30, CURRENT_DATE+30, 945),
    (9505, 940, 940, (SELECT id_estado FROM estado_practica WHERE nombre='REGISTRADA'), CURRENT_DATE-30, CURRENT_DATE+30, 941),
    (9506, 940, 940, (SELECT id_estado FROM estado_practica WHERE nombre='FINALIZADA'), CURRENT_DATE-60, CURRENT_DATE-1, 941),
    (9507, 940, 940, (SELECT id_estado FROM estado_practica WHERE nombre='APROBADA'), CURRENT_DATE-30, CURRENT_DATE+30, 941);
-- Historial inicial coherente con el estado actual (último evento = estado actual).
INSERT INTO historial_estado(id_practica,id_estado,id_usuario,fecha_cambio)
    SELECT p.id_practica, p.id_estado_actual, 943, now() - INTERVAL '1 day'
    FROM practica p WHERE p.id_practica IN (9501,9502,9503,9504,9505,9506,9507);

CREATE FUNCTION pg_temp.eventos(p BIGINT) RETURNS BIGINT LANGUAGE sql STABLE AS $$
    SELECT count(*) FROM historial_estado WHERE id_practica = p
$$;

CREATE FUNCTION pg_temp.estado(p BIGINT) RETURNS TEXT LANGUAGE sql STABLE AS $$
    SELECT e.nombre FROM practica pr JOIN estado_practica e ON e.id_estado = pr.id_estado_actual
    WHERE pr.id_practica = p
$$;

-- C0: modelo de seguridad instalado (SECURITY DEFINER, search_path, ACL).
DO $$
DECLARE
    v_prosecdef BOOLEAN;
BEGIN
    SELECT p.prosecdef INTO v_prosecdef
    FROM pg_proc p WHERE p.oid = 'practicas_privadas.fn_iniciar_practica(bigint,bigint,varchar)'::regprocedure;
    IF v_prosecdef IS NOT TRUE THEN RAISE EXCEPTION 'C0 fallido: debe ser SECURITY DEFINER'; END IF;
    IF has_function_privilege('public','practicas_privadas.fn_iniciar_practica(bigint,bigint,varchar)','EXECUTE') THEN
        RAISE EXCEPTION 'C0 fallido: PUBLIC no debe ejecutar';
    END IF;
    IF NOT has_function_privilege('pl_ep04_executor','practicas_privadas.fn_iniciar_practica(bigint,bigint,varchar)','EXECUTE') THEN
        RAISE EXCEPTION 'C0 fallido: pl_ep04_executor debe ejecutar';
    END IF;
END;
$$;

-- A: gestor asignado (A) sobre práctica de A -> inicio permitido; estado e historial correctos.
DO $$
DECLARE
    v_eventos_antes BIGINT := pg_temp.eventos(9507);
    v_resultado JSONB;
    v_ultimo RECORD;
BEGIN
    v_resultado := practicas_privadas.fn_iniciar_practica(9507, 941, 'inicio sintetico A');
    IF v_resultado ? 'error' THEN RAISE EXCEPTION 'A fallido: %', v_resultado; END IF;
    IF v_resultado->'estado'->>'nombre' IS DISTINCT FROM 'EN_CURSO' THEN
        RAISE EXCEPTION 'A fallido: estado devuelto %', v_resultado;
    END IF;
    IF pg_temp.estado(9507) IS DISTINCT FROM 'EN_CURSO' THEN
        RAISE EXCEPTION 'A fallido: estado persistido %', pg_temp.estado(9507);
    END IF;
    IF pg_temp.eventos(9507) IS DISTINCT FROM v_eventos_antes + 1 THEN
        RAISE EXCEPTION 'A fallido: eventos % -> %', v_eventos_antes, pg_temp.eventos(9507);
    END IF;
    SELECT h.id_estado, h.id_usuario INTO v_ultimo
    FROM historial_estado h WHERE h.id_practica = 9507
    ORDER BY h.fecha_cambio DESC, h.id_historial DESC LIMIT 1;
    IF v_ultimo.id_estado IS DISTINCT FROM (SELECT id_estado FROM estado_practica WHERE nombre='EN_CURSO')
       OR v_ultimo.id_usuario IS DISTINCT FROM 941 THEN
        RAISE EXCEPTION 'A fallido: último evento incorrecto';
    END IF;
END;
$$;

-- I (sin duplicados): tras el inicio exitoso, un único evento EN_CURSO para la práctica.
DO $$
BEGIN
    IF (SELECT count(*) FROM historial_estado h
        WHERE h.id_practica = 9507
          AND h.id_estado = (SELECT id_estado FROM estado_practica WHERE nombre='EN_CURSO')) <> 1 THEN
        RAISE EXCEPTION 'I fallido: evento EN_CURSO duplicado o ausente';
    END IF;
END;
$$;

-- J: segundo intento de inicio sobre la misma práctica -> rechazo sin nuevo evento.
DO $$
DECLARE
    v_eventos_antes BIGINT := pg_temp.eventos(9507);
    v_resultado JSONB;
BEGIN
    v_resultado := practicas_privadas.fn_iniciar_practica(9507, 941, 'segundo intento');
    IF v_resultado IS DISTINCT FROM '{"error": "TRANSICION_NO_PERMITIDA"}'::JSONB THEN
        RAISE EXCEPTION 'J fallido: resultado %', v_resultado;
    END IF;
    IF pg_temp.eventos(9507) IS DISTINCT FROM v_eventos_antes THEN
        RAISE EXCEPTION 'J fallido: evento nuevo tras segundo intento';
    END IF;
END;
$$;

-- B: gestor B sobre práctica del gestor A -> rechazo sin escrituras.
DO $$
DECLARE
    v_eventos_antes BIGINT := pg_temp.eventos(9501);
    v_resultado JSONB;
BEGIN
    v_resultado := practicas_privadas.fn_iniciar_practica(9501, 942, 'caso B');
    IF v_resultado IS DISTINCT FROM '{"error": "USUARIO_NO_AUTORIZADO"}'::JSONB THEN
        RAISE EXCEPTION 'B fallido: resultado %', v_resultado;
    END IF;
    IF pg_temp.estado(9501) IS DISTINCT FROM 'APROBADA' OR pg_temp.eventos(9501) IS DISTINCT FROM v_eventos_antes THEN
        RAISE EXCEPTION 'B fallido: escritura no permitida';
    END IF;
END;
$$;

-- C: práctica sin gestor + GESTOR -> GESTOR_NO_ASIGNADO sin escrituras.
DO $$
DECLARE
    v_eventos_antes BIGINT := pg_temp.eventos(9503);
    v_resultado JSONB;
BEGIN
    v_resultado := practicas_privadas.fn_iniciar_practica(9503, 941, 'caso C');
    IF v_resultado IS DISTINCT FROM '{"error": "GESTOR_NO_ASIGNADO"}'::JSONB THEN
        RAISE EXCEPTION 'C fallido: resultado %', v_resultado;
    END IF;
    IF pg_temp.estado(9503) IS DISTINCT FROM 'APROBADA' OR pg_temp.eventos(9503) IS DISTINCT FROM v_eventos_antes THEN
        RAISE EXCEPTION 'C fallido: escritura no permitida';
    END IF;
END;
$$;

-- D: práctica sin gestor + ADMINISTRADOR -> GESTOR_NO_ASIGNADO (ninguna práctica sin gestor se inicia).
DO $$
DECLARE
    v_resultado JSONB;
BEGIN
    v_resultado := practicas_privadas.fn_iniciar_practica(9503, 943, 'caso D');
    IF v_resultado IS DISTINCT FROM '{"error": "GESTOR_NO_ASIGNADO"}'::JSONB THEN
        RAISE EXCEPTION 'D fallido: resultado %', v_resultado;
    END IF;
    IF pg_temp.estado(9503) IS DISTINCT FROM 'APROBADA' THEN
        RAISE EXCEPTION 'D fallido: escritura no permitida';
    END IF;
END;
$$;

-- E: administrador sobre práctica con gestor activo -> permitido.
DO $$
DECLARE
    v_resultado JSONB;
BEGIN
    v_resultado := practicas_privadas.fn_iniciar_practica(9502, 943, 'caso E');
    IF v_resultado ? 'error' THEN RAISE EXCEPTION 'E fallido: %', v_resultado; END IF;
    IF pg_temp.estado(9502) IS DISTINCT FROM 'EN_CURSO' THEN
        RAISE EXCEPTION 'E fallido: estado no actualizado';
    END IF;
END;
$$;

-- F: usuario sin rol válido, estudiante, gestor inactivo asignado -> USUARIO_NO_AUTORIZADO.
DO $$
DECLARE
    v_eventos_antes BIGINT := pg_temp.eventos(9504);
    v_resultado JSONB;
BEGIN
    v_resultado := practicas_privadas.fn_iniciar_practica(9504, 944, 'caso F sin rol');
    IF v_resultado IS DISTINCT FROM '{"error": "USUARIO_NO_AUTORIZADO"}'::JSONB THEN
        RAISE EXCEPTION 'F fallido (sin rol): resultado %', v_resultado;
    END IF;
    v_resultado := practicas_privadas.fn_iniciar_practica(9501, 940, 'caso F estudiante');
    IF v_resultado IS DISTINCT FROM '{"error": "USUARIO_NO_AUTORIZADO"}'::JSONB THEN
        RAISE EXCEPTION 'F fallido (estudiante): resultado %', v_resultado;
    END IF;
    v_resultado := practicas_privadas.fn_iniciar_practica(9504, 945, 'caso F inactivo');
    IF v_resultado IS DISTINCT FROM '{"error": "USUARIO_NO_AUTORIZADO"}'::JSONB THEN
        RAISE EXCEPTION 'F fallido (gestor inactivo): resultado %', v_resultado;
    END IF;
    IF pg_temp.estado(9504) IS DISTINCT FROM 'APROBADA' OR pg_temp.eventos(9504) IS DISTINCT FROM v_eventos_antes THEN
        RAISE EXCEPTION 'F fallido: escritura no permitida';
    END IF;
END;
$$;

-- G: práctica inexistente -> PRACTICA_NO_ENCONTRADA.
DO $$
DECLARE
    v_resultado JSONB;
BEGIN
    v_resultado := practicas_privadas.fn_iniciar_practica(999999, 941, 'caso G');
    IF v_resultado IS DISTINCT FROM '{"error": "PRACTICA_NO_ENCONTRADA"}'::JSONB THEN
        RAISE EXCEPTION 'G fallido: resultado %', v_resultado;
    END IF;
END;
$$;

-- H: práctica no iniciable (REGISTRADA) y práctica FINALIZADA -> errores de estado.
DO $$
DECLARE
    v_resultado JSONB;
BEGIN
    v_resultado := practicas_privadas.fn_iniciar_practica(9505, 941, 'caso H registrada');
    IF v_resultado IS DISTINCT FROM '{"error": "TRANSICION_NO_PERMITIDA"}'::JSONB THEN
        RAISE EXCEPTION 'H fallido (REGISTRADA): resultado %', v_resultado;
    END IF;
    v_resultado := practicas_privadas.fn_iniciar_practica(9506, 941, 'caso H finalizada');
    IF v_resultado IS DISTINCT FROM '{"error": "ESTADO_FINAL"}'::JSONB THEN
        RAISE EXCEPTION 'H fallido (FINALIZADA): resultado %', v_resultado;
    END IF;
    IF pg_temp.estado(9505) IS DISTINCT FROM 'REGISTRADA' OR pg_temp.estado(9506) IS DISTINCT FROM 'FINALIZADA' THEN
        RAISE EXCEPTION 'H fallido: estado modificado';
    END IF;
END;
$$;

SELECT 'EP07 inicio de práctica: casos C0, A, I, J, B-H aprobados' AS resultado;

ROLLBACK;
