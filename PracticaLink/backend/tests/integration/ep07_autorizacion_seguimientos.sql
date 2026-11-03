-- NOTA (EP07 Corrección 4A): esta prueba valida la función pública LEGACY
-- public.fn_registrar_seguimiento (migración 20261028010000), que no informa 'tipo'.
-- Desde 20261103140000 el contrato vigente es EP05 (seguimientos_privados, tipo obligatorio),
-- cubierto por ep07_seguimientos_ep05.sql. Esta prueba solo debe ejecutarse sobre un
-- laboratorio con migraciones hasta 20261103130000 inclusive.
-- EP07 · Corrección 2B.2: autorización de seguimientos en fn_registrar_seguimiento.
-- Ejecutar SOLO en un PostgreSQL de laboratorio desechable con las migraciones hasta
-- 20261103120000 inclusive y los scripts EP04 aplicados, en orden.
-- Datos sintéticos. Todo ocurre en una transacción que termina con ROLLBACK.
-- Uso: psql -X -v ON_ERROR_STOP=1 -U postgres -d <base_laboratorio> -f ep07_autorizacion_seguimientos.sql

BEGIN;

INSERT INTO usuario(id_usuario,nombre,apellido,correo,password_hash) VALUES
    (930,'Estudiante','Sintetico','ep07e-student@example.invalid','synthetic-hash'),
    (931,'Gestor A','Sintetico','ep07e-gestorA@example.invalid','synthetic-hash'),
    (932,'Gestor B','Sintetico','ep07e-gestorB@example.invalid','synthetic-hash'),
    (933,'Admin','Sintetico','ep07e-admin@example.invalid','synthetic-hash'),
    (934,'Sin rol','Sintetico','ep07e-norole@example.invalid','synthetic-hash'),
    (935,'Gestor inactivo','Sintetico','ep07e-inactive@example.invalid','synthetic-hash');
UPDATE usuario SET activo = FALSE WHERE id_usuario = 935;
INSERT INTO usuario_rol SELECT 930, id_rol FROM rol WHERE nombre = 'ESTUDIANTE';
INSERT INTO usuario_rol SELECT 931, id_rol FROM rol WHERE nombre = 'GESTOR';
INSERT INTO usuario_rol SELECT 932, id_rol FROM rol WHERE nombre = 'GESTOR';
INSERT INTO usuario_rol SELECT 933, id_rol FROM rol WHERE nombre = 'ADMINISTRADOR';
INSERT INTO usuario_rol SELECT 935, id_rol FROM rol WHERE nombre = 'GESTOR';
INSERT INTO estudiante(id_estudiante,id_usuario,rut,carrera,sede)
    VALUES (930, 930, '55555555-5', 'Carrera sintetica', 'Sede sintetica');
INSERT INTO centro_practica(id_centro,nombre) VALUES (930, 'Centro sintetico');

-- 9401: gestor A (931). 9402: gestor B (932). 9403: sin gestor. 9404: gestor inactivo (935).
-- 9405: gestor A y FINALIZADA (regla terminal previa).
INSERT INTO practica(id_practica,id_estudiante,id_centro,id_estado_actual,fecha_inicio,fecha_termino,id_gestor) VALUES
    (9401, 930, 930, (SELECT id_estado FROM estado_practica WHERE nombre='APROBADA'), CURRENT_DATE-30, CURRENT_DATE+30, 931),
    (9402, 930, 930, (SELECT id_estado FROM estado_practica WHERE nombre='APROBADA'), CURRENT_DATE-30, CURRENT_DATE+30, 932),
    (9403, 930, 930, (SELECT id_estado FROM estado_practica WHERE nombre='APROBADA'), CURRENT_DATE-30, CURRENT_DATE+30, NULL),
    (9404, 930, 930, (SELECT id_estado FROM estado_practica WHERE nombre='APROBADA'), CURRENT_DATE-30, CURRENT_DATE+30, 935),
    (9405, 930, 930, (SELECT id_estado FROM estado_practica WHERE nombre='FINALIZADA'), CURRENT_DATE-60, CURRENT_DATE-1, 931);
INSERT INTO cierre_practica(id_practica,id_usuario,resultado) VALUES (9405, 931, 'APROBADA');

-- Huella observable: número de seguimientos de la práctica.
CREATE FUNCTION pg_temp.seguimientos(p BIGINT) RETURNS BIGINT LANGUAGE sql STABLE AS $$
    SELECT count(*) FROM seguimiento WHERE id_practica = p
$$;

-- C0: matriz de la regla auxiliar (administrador global; gestor solo asignado y activo).
DO $$
BEGIN
    IF NOT public.fn_puede_gestionar_practica(9401, 933) THEN RAISE EXCEPTION 'C0 fallido: admin'; END IF;
    IF NOT public.fn_puede_gestionar_practica(9401, 931) THEN RAISE EXCEPTION 'C0 fallido: asignado'; END IF;
    IF public.fn_puede_gestionar_practica(9401, 932) THEN RAISE EXCEPTION 'C0 fallido: ajeno'; END IF;
    IF public.fn_puede_gestionar_practica(9403, 931) THEN RAISE EXCEPTION 'C0 fallido: sin gestor'; END IF;
    IF public.fn_puede_gestionar_practica(9404, 935) THEN RAISE EXCEPTION 'C0 fallido: gestor inactivo'; END IF;
    IF public.fn_puede_gestionar_practica(9401, 934) THEN RAISE EXCEPTION 'C0 fallido: sin rol'; END IF;
END;
$$;

-- C1: gestor asignado registra seguimiento -> permitido.
DO $$
DECLARE
    antes BIGINT := pg_temp.seguimientos(9401);
    resultado JSONB;
BEGIN
    resultado := public.fn_registrar_seguimiento(9401, 931, CURRENT_DATE, 'C1 sintetico');
    IF resultado ? 'error' THEN RAISE EXCEPTION 'C1 fallido: %', resultado; END IF;
    IF pg_temp.seguimientos(9401) IS DISTINCT FROM antes + 1 THEN
        RAISE EXCEPTION 'C1 fallido: no se insertó el seguimiento';
    END IF;
END;
$$;

-- C2: gestor ajeno registra en práctica de otro gestor -> rechazo sin escritura.
DO $$
DECLARE
    antes BIGINT := pg_temp.seguimientos(9401);
    resultado JSONB;
BEGIN
    resultado := public.fn_registrar_seguimiento(9401, 932, CURRENT_DATE, 'C2 sintetico');
    IF resultado IS DISTINCT FROM '{"error": "USUARIO_NO_AUTORIZADO"}'::JSONB THEN
        RAISE EXCEPTION 'C2 fallido: resultado %', resultado;
    END IF;
    IF pg_temp.seguimientos(9401) IS DISTINCT FROM antes THEN
        RAISE EXCEPTION 'C2 fallido: escritura no permitida';
    END IF;
END;
$$;

-- C3: administrador registra en práctica asignada a otro gestor -> permitido.
DO $$
DECLARE
    antes BIGINT := pg_temp.seguimientos(9402);
    resultado JSONB;
BEGIN
    resultado := public.fn_registrar_seguimiento(9402, 933, CURRENT_DATE, 'C3 sintetico');
    IF resultado ? 'error' THEN RAISE EXCEPTION 'C3 fallido: %', resultado; END IF;
    IF pg_temp.seguimientos(9402) IS DISTINCT FROM antes + 1 THEN
        RAISE EXCEPTION 'C3 fallido: no se insertó el seguimiento';
    END IF;
END;
$$;

-- C4: práctica sin gestor + gestor -> rechazo sin escritura.
DO $$
DECLARE
    antes BIGINT := pg_temp.seguimientos(9403);
    resultado JSONB;
BEGIN
    resultado := public.fn_registrar_seguimiento(9403, 931, CURRENT_DATE, 'C4 sintetico');
    IF resultado IS DISTINCT FROM '{"error": "USUARIO_NO_AUTORIZADO"}'::JSONB THEN
        RAISE EXCEPTION 'C4 fallido: resultado %', resultado;
    END IF;
    IF pg_temp.seguimientos(9403) IS DISTINCT FROM antes THEN
        RAISE EXCEPTION 'C4 fallido: escritura no permitida';
    END IF;
END;
$$;

-- C5: gestor inactivo asignado y usuario sin rol -> rechazo sin escritura.
DO $$
DECLARE
    antes_inactivo BIGINT := pg_temp.seguimientos(9404);
    antes BIGINT := pg_temp.seguimientos(9401);
    resultado JSONB;
BEGIN
    resultado := public.fn_registrar_seguimiento(9404, 935, CURRENT_DATE, 'C5 inactivo');
    IF resultado IS DISTINCT FROM '{"error": "USUARIO_NO_AUTORIZADO"}'::JSONB THEN
        RAISE EXCEPTION 'C5 fallido (inactivo): resultado %', resultado;
    END IF;
    resultado := public.fn_registrar_seguimiento(9401, 934, CURRENT_DATE, 'C5 sin rol');
    IF resultado IS DISTINCT FROM '{"error": "USUARIO_NO_AUTORIZADO"}'::JSONB THEN
        RAISE EXCEPTION 'C5 fallido (sin rol): resultado %', resultado;
    END IF;
    IF pg_temp.seguimientos(9404) IS DISTINCT FROM antes_inactivo
       OR pg_temp.seguimientos(9401) IS DISTINCT FROM antes THEN
        RAISE EXCEPTION 'C5 fallido: escritura no permitida';
    END IF;
END;
$$;

-- C6: práctica FINALIZADA con administrador -> regla de estado existente, sin escritura.
DO $$
DECLARE
    antes BIGINT := pg_temp.seguimientos(9405);
    resultado JSONB;
BEGIN
    resultado := public.fn_registrar_seguimiento(9405, 933, CURRENT_DATE, 'C6 sintetico');
    IF resultado IS DISTINCT FROM '{"error": "PRACTICA_NO_DISPONIBLE"}'::JSONB THEN
        RAISE EXCEPTION 'C6 fallido: resultado %', resultado;
    END IF;
    IF pg_temp.seguimientos(9405) IS DISTINCT FROM antes THEN
        RAISE EXCEPTION 'C6 fallido: escritura sobre práctica finalizada';
    END IF;
END;
$$;

-- C7: gestor sobre práctica inexistente -> PRACTICA_NO_ENCONTRADA (404), sin escritura.
DO $$
DECLARE
    antes BIGINT := (SELECT count(*) FROM seguimiento);
    resultado JSONB;
BEGIN
    resultado := public.fn_registrar_seguimiento(999999, 931, CURRENT_DATE, 'C7 sintetico');
    IF resultado IS DISTINCT FROM '{"error": "PRACTICA_NO_ENCONTRADA"}'::JSONB THEN
        RAISE EXCEPTION 'C7 fallido: resultado %', resultado;
    END IF;
    IF (SELECT count(*) FROM seguimiento) IS DISTINCT FROM antes THEN
        RAISE EXCEPTION 'C7 fallido: escritura sobre práctica inexistente';
    END IF;
END;
$$;

-- C8: administrador sobre práctica inexistente -> PRACTICA_NO_ENCONTRADA (404), sin escritura.
DO $$
DECLARE
    antes BIGINT := (SELECT count(*) FROM seguimiento);
    resultado JSONB;
BEGIN
    resultado := public.fn_registrar_seguimiento(999999, 933, CURRENT_DATE, 'C8 sintetico');
    IF resultado IS DISTINCT FROM '{"error": "PRACTICA_NO_ENCONTRADA"}'::JSONB THEN
        RAISE EXCEPTION 'C8 fallido: resultado %', resultado;
    END IF;
    IF (SELECT count(*) FROM seguimiento) IS DISTINCT FROM antes THEN
        RAISE EXCEPTION 'C8 fallido: escritura sobre práctica inexistente';
    END IF;
END;
$$;

SELECT 'EP07 autorización de seguimientos: casos C0-C8 aprobados' AS resultado;

ROLLBACK;
