-- EP07 · Corrección 4A: contrato canónico EP05 (HU013/HU014) con autorización por gestor asignado.
-- Ejecutar SOLO en un PostgreSQL de laboratorio desechable creado únicamente con las
-- migraciones versionadas hasta 20261103140000 inclusive (sin scripts manuales ep05).
-- Datos sintéticos. Todo ocurre en una transacción que termina con ROLLBACK.
-- Uso: psql -X -v ON_ERROR_STOP=1 -U postgres -d <base_laboratorio> -f ep07_seguimientos_ep05.sql

BEGIN;

-- Día de negocio en America/Santiago: la misma regla que usa fn_registrar_seguimiento.
-- No usar CURRENT_DATE: depende de la TimeZone de sesión y falla entre 00:00 y 03:00/04:00 UTC.
CREATE FUNCTION pg_temp.hoy_santiago() RETURNS DATE LANGUAGE sql STABLE AS $$
    SELECT (clock_timestamp() AT TIME ZONE 'America/Santiago')::date
$$;

INSERT INTO usuario(id_usuario,nombre,apellido,correo,password_hash) VALUES
    (950,'Estudiante','Sintetico','ep07g-student@example.invalid','synthetic-hash'),
    (951,'Gestor A','Sintetico','ep07g-gestorA@example.invalid','synthetic-hash'),
    (952,'Gestor B','Sintetico','ep07g-gestorB@example.invalid','synthetic-hash'),
    (953,'Admin','Sintetico','ep07g-admin@example.invalid','synthetic-hash');
INSERT INTO usuario_rol SELECT 950, id_rol FROM rol WHERE nombre = 'ESTUDIANTE';
INSERT INTO usuario_rol SELECT 951, id_rol FROM rol WHERE nombre = 'GESTOR';
INSERT INTO usuario_rol SELECT 952, id_rol FROM rol WHERE nombre = 'GESTOR';
INSERT INTO usuario_rol SELECT 953, id_rol FROM rol WHERE nombre = 'ADMINISTRADOR';
INSERT INTO estudiante(id_estudiante,id_usuario,rut,carrera,sede)
    VALUES (950, 950, '33333333-3', 'Carrera sintetica', 'Sede sintetica');
INSERT INTO centro_practica(id_centro,nombre) VALUES (950, 'Centro sintetico');

-- 9601: EN_CURSO, gestor A. 9602: EN_CURSO, gestor B. 9603: EN_CURSO, sin gestor.
-- 9604: APROBADA (no iniciada), gestor A.
INSERT INTO practica(id_practica,id_estudiante,id_centro,id_estado_actual,fecha_inicio,fecha_termino,id_gestor) VALUES
    (9601, 950, 950, (SELECT id_estado FROM estado_practica WHERE nombre='EN_CURSO'), pg_temp.hoy_santiago()-30, pg_temp.hoy_santiago()+30, 951),
    (9602, 950, 950, (SELECT id_estado FROM estado_practica WHERE nombre='EN_CURSO'), pg_temp.hoy_santiago()-30, pg_temp.hoy_santiago()+30, 952),
    (9603, 950, 950, (SELECT id_estado FROM estado_practica WHERE nombre='EN_CURSO'), pg_temp.hoy_santiago()-30, pg_temp.hoy_santiago()+30, NULL),
    (9604, 950, 950, (SELECT id_estado FROM estado_practica WHERE nombre='APROBADA'), pg_temp.hoy_santiago()-30, pg_temp.hoy_santiago()+30, 951);

-- Huella: seguimientos de una práctica.
CREATE FUNCTION pg_temp.seg(p BIGINT) RETURNS BIGINT LANGUAGE sql STABLE AS $$
    SELECT count(*) FROM seguimiento WHERE id_practica = p
$$;

-- C0: modelo de seguridad instalado.
DO $$
BEGIN
    IF has_function_privilege('public','seguimientos_privados.fn_registrar_seguimiento(bigint,bigint,date,text,text)','EXECUTE') THEN
        RAISE EXCEPTION 'C0 fallido: PUBLIC no debe ejecutar el registro';
    END IF;
    IF NOT has_function_privilege('pl_ep05_executor','seguimientos_privados.fn_registrar_seguimiento(bigint,bigint,date,text,text)','EXECUTE') THEN
        RAISE EXCEPTION 'C0 fallido: pl_ep05_executor debe ejecutar el registro';
    END IF;
END;
$$;

-- SG-A: gestor asignado registra con tipo -> permitido; tipo persiste.
DO $$
DECLARE
    antes BIGINT := pg_temp.seg(9601);
    r JSONB;
BEGIN
    r := seguimientos_privados.fn_registrar_seguimiento(9601, 951, pg_temp.hoy_santiago(), 'Videollamada', 'SG-A sintetico');
    IF r ? 'error' THEN RAISE EXCEPTION 'SG-A fallido: %', r; END IF;
    IF r->>'tipo' IS DISTINCT FROM 'Videollamada' THEN RAISE EXCEPTION 'SG-A fallido: tipo devuelto %', r; END IF;
    IF pg_temp.seg(9601) IS DISTINCT FROM antes + 1 THEN RAISE EXCEPTION 'SG-A fallido: sin escritura'; END IF;
END;
$$;

-- SG-B: gestor ajeno -> USUARIO_NO_AUTORIZADO sin escritura.
DO $$
DECLARE
    antes BIGINT := pg_temp.seg(9601);
    r JSONB;
BEGIN
    r := seguimientos_privados.fn_registrar_seguimiento(9601, 952, pg_temp.hoy_santiago(), 'Otro', 'SG-B');
    IF r IS DISTINCT FROM '{"error": "USUARIO_NO_AUTORIZADO"}'::JSONB THEN RAISE EXCEPTION 'SG-B fallido: %', r; END IF;
    IF pg_temp.seg(9601) IS DISTINCT FROM antes THEN RAISE EXCEPTION 'SG-B fallido: escritura'; END IF;
END;
$$;

-- SG-C: práctica sin gestor + GESTOR -> USUARIO_NO_AUTORIZADO sin escritura.
DO $$
DECLARE
    antes BIGINT := pg_temp.seg(9603);
    r JSONB;
BEGIN
    r := seguimientos_privados.fn_registrar_seguimiento(9603, 951, pg_temp.hoy_santiago(), 'Otro', 'SG-C');
    IF r IS DISTINCT FROM '{"error": "USUARIO_NO_AUTORIZADO"}'::JSONB THEN RAISE EXCEPTION 'SG-C fallido: %', r; END IF;
    IF pg_temp.seg(9603) IS DISTINCT FROM antes THEN RAISE EXCEPTION 'SG-C fallido: escritura'; END IF;
END;
$$;

-- SG-D: práctica inexistente -> PRACTICA_NO_ENCONTRADA, sin escritura.
DO $$
DECLARE
    antes BIGINT := (SELECT count(*) FROM seguimiento);
    r JSONB;
BEGIN
    r := seguimientos_privados.fn_registrar_seguimiento(999999, 951, pg_temp.hoy_santiago(), 'Otro', 'SG-D');
    IF r IS DISTINCT FROM '{"error": "PRACTICA_NO_ENCONTRADA"}'::JSONB THEN RAISE EXCEPTION 'SG-D fallido: %', r; END IF;
    IF (SELECT count(*) FROM seguimiento) IS DISTINCT FROM antes THEN RAISE EXCEPTION 'SG-D fallido: escritura'; END IF;
END;
$$;

-- SG-E: administrador sobre práctica de otro gestor -> permitido.
DO $$
DECLARE
    antes BIGINT := pg_temp.seg(9602);
    r JSONB;
BEGIN
    r := seguimientos_privados.fn_registrar_seguimiento(9602, 953, pg_temp.hoy_santiago(), 'Correo electrónico', 'SG-E sintetico');
    IF r ? 'error' THEN RAISE EXCEPTION 'SG-E fallido: %', r; END IF;
    IF pg_temp.seg(9602) IS DISTINCT FROM antes + 1 THEN RAISE EXCEPTION 'SG-E fallido: sin escritura'; END IF;
END;
$$;

-- Validaciones EP05 existentes: práctica no iniciada y tipo inválido, sin escritura.
DO $$
DECLARE
    antes BIGINT := pg_temp.seg(9604);
    r JSONB;
BEGIN
    r := seguimientos_privados.fn_registrar_seguimiento(9604, 951, pg_temp.hoy_santiago(), 'Otro', 'no iniciada');
    IF r IS DISTINCT FROM '{"error": "PRACTICA_NO_EN_CURSO"}'::JSONB THEN RAISE EXCEPTION 'EP05 no iniciada fallido: %', r; END IF;
    r := seguimientos_privados.fn_registrar_seguimiento(9601, 951, pg_temp.hoy_santiago(), 'Fax', 'tipo invalido');
    IF r IS DISTINCT FROM '{"error": "MEDIO_INVALIDO"}'::JSONB THEN RAISE EXCEPTION 'EP05 tipo fallido: %', r; END IF;
    IF pg_temp.seg(9604) IS DISTINCT FROM antes THEN RAISE EXCEPTION 'EP05 fallido: escritura'; END IF;
END;
$$;

-- SG-F / SG-I: lectura del gestor asignado -> solo sus datos, con tipo persistido.
DO $$
DECLARE
    r JSONB;
BEGIN
    r := seguimientos_privados.fn_consultar_seguimientos(9601, 951, 50, 0);
    IF r ? 'error' THEN RAISE EXCEPTION 'SG-F fallido: %', r; END IF;
    IF jsonb_array_length(r->'items') <> 1 THEN RAISE EXCEPTION 'SG-F fallido: items %', r; END IF;
    IF r->'items'->0->>'tipo' IS DISTINCT FROM 'Videollamada' THEN RAISE EXCEPTION 'SG-I fallido: tipo no persiste %', r; END IF;
END;
$$;

-- SG-G: lectura del gestor ajeno -> USUARIO_NO_AUTORIZADO.
DO $$
DECLARE
    r JSONB;
BEGIN
    r := seguimientos_privados.fn_consultar_seguimientos(9601, 952, 50, 0);
    IF r IS DISTINCT FROM '{"error": "USUARIO_NO_AUTORIZADO"}'::JSONB THEN RAISE EXCEPTION 'SG-G fallido: %', r; END IF;
    r := seguimientos_privados.fn_consultar_seguimientos(999999, 951, 50, 0);
    IF r IS DISTINCT FROM '{"error": "PRACTICA_NO_ENCONTRADA"}'::JSONB THEN RAISE EXCEPTION 'SG-G fallido (inexistente): %', r; END IF;
END;
$$;

-- SG-H: paginación sobre el conjunto autorizado (3 seguimientos del gestor A en 9601).
DO $$
DECLARE
    r1 JSONB;
    r2 JSONB;
BEGIN
    PERFORM seguimientos_privados.fn_registrar_seguimiento(9601, 953, pg_temp.hoy_santiago(), 'Otro', 'SG-H 2');
    PERFORM seguimientos_privados.fn_registrar_seguimiento(9601, 953, pg_temp.hoy_santiago(), 'Otro', 'SG-H 3');
    r1 := seguimientos_privados.fn_consultar_seguimientos(9601, 951, 2, 0);
    IF jsonb_array_length(r1->'items') <> 2 OR (r1->>'hay_mas')::BOOLEAN IS NOT TRUE THEN
        RAISE EXCEPTION 'SG-H fallido (pagina 1): %', r1;
    END IF;
    r2 := seguimientos_privados.fn_consultar_seguimientos(9601, 951, 2, 2);
    IF jsonb_array_length(r2->'items') <> 1 OR (r2->>'hay_mas')::BOOLEAN IS NOT FALSE THEN
        RAISE EXCEPTION 'SG-H fallido (pagina 2): %', r2;
    END IF;
END;
$$;

-- SG-E (lectura): administrador ve cualquier práctica.
DO $$
DECLARE
    r JSONB;
BEGIN
    r := seguimientos_privados.fn_consultar_seguimientos(9602, 953, 50, 0);
    IF r ? 'error' OR jsonb_array_length(r->'items') < 1 THEN RAISE EXCEPTION 'SG-E lectura fallida: %', r; END IF;
END;
$$;

SELECT 'EP07 seguimientos EP05: casos C0, SG-A a SG-I y validaciones aprobados' AS resultado;

ROLLBACK;
