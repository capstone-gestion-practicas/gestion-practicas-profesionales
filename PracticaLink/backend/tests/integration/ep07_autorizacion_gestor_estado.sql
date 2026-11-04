-- EP07 · Corrección 2A: autorización por gestor asignado en fn_actualizar_estado_practica.
-- Ejecutar SOLO en un PostgreSQL de laboratorio desechable con las migraciones hasta
-- 20261103110000 inclusive y los scripts EP04 aplicados, en orden.
-- Datos sintéticos. Todo ocurre en una transacción que termina con ROLLBACK.
-- Uso: psql -X -v ON_ERROR_STOP=1 -U postgres -d <base_laboratorio> -f ep07_autorizacion_gestor_estado.sql

BEGIN;

INSERT INTO usuario(id_usuario,nombre,apellido,correo,password_hash) VALUES
    (920,'Estudiante','Sintetico','ep07b-student@example.invalid','synthetic-hash'),
    (921,'Gestor A','Sintetico','ep07b-gestorA@example.invalid','synthetic-hash'),
    (922,'Gestor B','Sintetico','ep07b-gestorB@example.invalid','synthetic-hash'),
    (923,'Admin','Sintetico','ep07b-admin@example.invalid','synthetic-hash'),
    (924,'Sin rol','Sintetico','ep07b-norole@example.invalid','synthetic-hash'),
    (925,'Gestor inactivo','Sintetico','ep07b-inactive@example.invalid','synthetic-hash');
UPDATE usuario SET activo = FALSE WHERE id_usuario = 925;
INSERT INTO usuario_rol SELECT 920, id_rol FROM rol WHERE nombre = 'ESTUDIANTE';
INSERT INTO usuario_rol SELECT 921, id_rol FROM rol WHERE nombre = 'GESTOR';
INSERT INTO usuario_rol SELECT 922, id_rol FROM rol WHERE nombre = 'GESTOR';
INSERT INTO usuario_rol SELECT 923, id_rol FROM rol WHERE nombre = 'ADMINISTRADOR';
INSERT INTO usuario_rol SELECT 925, id_rol FROM rol WHERE nombre = 'GESTOR';
INSERT INTO estudiante(id_estudiante,id_usuario,rut,carrera,sede)
    VALUES (920, 920, '99999999-9', 'Carrera sintetica', 'Sede sintetica');
INSERT INTO centro_practica(id_centro,nombre) VALUES (920, 'Centro sintetico');

-- 9201: asignada a gestor A, transición válida (caso A).
-- 9202: asignada a gestor A (casos B, D, F).
-- 9203: sin gestor (caso C).
-- 9204: asignada a gestor A y FINALIZADA con cierre (caso E).
-- 9205: asignada a gestor inactivo (caso F).
INSERT INTO practica(id_practica,id_estudiante,id_centro,id_estado_actual,fecha_inicio,fecha_termino,id_gestor) VALUES
    (9201, 920, 920, (SELECT id_estado FROM estado_practica WHERE nombre='APROBADA'), CURRENT_DATE-30, CURRENT_DATE+30, 921),
    (9202, 920, 920, (SELECT id_estado FROM estado_practica WHERE nombre='APROBADA'), CURRENT_DATE-30, CURRENT_DATE+30, 921),
    (9203, 920, 920, (SELECT id_estado FROM estado_practica WHERE nombre='APROBADA'), CURRENT_DATE-30, CURRENT_DATE+30, NULL),
    (9204, 920, 920, (SELECT id_estado FROM estado_practica WHERE nombre='FINALIZADA'), CURRENT_DATE-60, CURRENT_DATE-1, 921),
    (9205, 920, 920, (SELECT id_estado FROM estado_practica WHERE nombre='APROBADA'), CURRENT_DATE-30, CURRENT_DATE+30, 925);
INSERT INTO cierre_practica(id_practica,id_usuario,resultado) VALUES (9204, 921, 'APROBADA');
INSERT INTO historial_estado(id_practica,id_estado,id_usuario)
    SELECT p.id_practica, p.id_estado_actual, 921 FROM practica p WHERE p.id_practica IN (9201,9202,9203,9204,9205);

-- Huella del estado observable: estado | nº historial | nº notificaciones.
CREATE FUNCTION pg_temp.huella(p BIGINT) RETURNS TEXT LANGUAGE sql STABLE AS $$
    SELECT (SELECT e.nombre FROM practica pr JOIN estado_practica e ON e.id_estado = pr.id_estado_actual
             WHERE pr.id_practica = p)
        || '|' || (SELECT count(*) FROM historial_estado WHERE id_practica = p)
        || '|' || (SELECT count(*) FROM notificacion WHERE id_practica = p)
$$;

CREATE FUNCTION pg_temp.estado_id(n TEXT) RETURNS BIGINT LANGUAGE sql STABLE AS $$
    SELECT id_estado FROM estado_practica WHERE nombre = n
$$;

-- Caso A: gestor asignado, transición válida -> permitida, estado e historial correctos.
DO $$
DECLARE
    antes TEXT := pg_temp.huella(9201);
    resultado JSONB;
BEGIN
    resultado := public.fn_actualizar_estado_practica(9201, 921, pg_temp.estado_id('OBSERVADA'), 'caso A');
    IF resultado->>'estado' IS DISTINCT FROM 'OBSERVADA' THEN
        RAISE EXCEPTION 'Caso A fallido: resultado %', resultado;
    END IF;
    IF pg_temp.huella(9201) IS DISTINCT FROM 'OBSERVADA|' || (split_part(antes,'|',2)::INT + 1) || '|' || (split_part(antes,'|',3)::INT + 1) THEN
        RAISE EXCEPTION 'Caso A fallido: huella % -> %', antes, pg_temp.huella(9201);
    END IF;
END;
$$;

-- Caso B: gestor B sobre práctica de gestor A -> rechazo, sin escrituras.
DO $$
DECLARE
    antes TEXT := pg_temp.huella(9202);
    resultado JSONB;
BEGIN
    resultado := public.fn_actualizar_estado_practica(9202, 922, pg_temp.estado_id('OBSERVADA'), 'caso B');
    IF resultado IS DISTINCT FROM '{"error": "GESTOR_NO_ASIGNADO_A_PRACTICA"}'::JSONB THEN
        RAISE EXCEPTION 'Caso B fallido: resultado %', resultado;
    END IF;
    IF pg_temp.huella(9202) IS DISTINCT FROM antes THEN
        RAISE EXCEPTION 'Caso B fallido: escritura no permitida % -> %', antes, pg_temp.huella(9202);
    END IF;
END;
$$;

-- Caso C: práctica sin gestor, usuario GESTOR -> rechazo, sin escrituras.
DO $$
DECLARE
    antes TEXT := pg_temp.huella(9203);
    resultado JSONB;
BEGIN
    resultado := public.fn_actualizar_estado_practica(9203, 921, pg_temp.estado_id('OBSERVADA'), 'caso C');
    IF resultado IS DISTINCT FROM '{"error": "GESTOR_NO_ASIGNADO_A_PRACTICA"}'::JSONB THEN
        RAISE EXCEPTION 'Caso C fallido: resultado %', resultado;
    END IF;
    IF pg_temp.huella(9203) IS DISTINCT FROM antes THEN
        RAISE EXCEPTION 'Caso C fallido: escritura no permitida % -> %', antes, pg_temp.huella(9203);
    END IF;
END;
$$;

-- Caso D: administrador sobre práctica asignada a otro gestor -> permitido si la transición es válida.
DO $$
DECLARE
    resultado JSONB;
BEGIN
    resultado := public.fn_actualizar_estado_practica(9202, 923, pg_temp.estado_id('OBSERVADA'), 'caso D');
    IF resultado->>'estado' IS DISTINCT FROM 'OBSERVADA' THEN
        RAISE EXCEPTION 'Caso D fallido: resultado %', resultado;
    END IF;
    IF (SELECT e.nombre FROM practica p JOIN estado_practica e ON e.id_estado = p.id_estado_actual
         WHERE p.id_practica = 9202) IS DISTINCT FROM 'OBSERVADA' THEN
        RAISE EXCEPTION 'Caso D fallido: estado no actualizado';
    END IF;
END;
$$;

-- Caso E: práctica FINALIZADA prevalece sobre la autorización del gestor asignado y del administrador.
DO $$
DECLARE
    antes TEXT := pg_temp.huella(9204);
    resultado JSONB;
BEGIN
    resultado := public.fn_actualizar_estado_practica(9204, 921, pg_temp.estado_id('OBSERVADA'), 'caso E gestor');
    IF resultado IS DISTINCT FROM '{"error": "PRACTICA_FINALIZADA_NO_MODIFICABLE"}'::JSONB THEN
        RAISE EXCEPTION 'Caso E fallido (gestor asignado): resultado %', resultado;
    END IF;
    resultado := public.fn_actualizar_estado_practica(9204, 923, pg_temp.estado_id('OBSERVADA'), 'caso E admin');
    IF resultado IS DISTINCT FROM '{"error": "PRACTICA_FINALIZADA_NO_MODIFICABLE"}'::JSONB THEN
        RAISE EXCEPTION 'Caso E fallido (admin): resultado %', resultado;
    END IF;
    IF pg_temp.huella(9204) IS DISTINCT FROM antes THEN
        RAISE EXCEPTION 'Caso E fallido: escritura sobre FINALIZADA % -> %', antes, pg_temp.huella(9204);
    END IF;
END;
$$;

-- Caso F: sin rol válido, estudiante, gestor inactivo asignado -> USUARIO_NO_AUTORIZADO, sin escrituras.
DO $$
DECLARE
    antes TEXT := pg_temp.huella(9202);
    antes_inactiva TEXT := pg_temp.huella(9205);
    resultado JSONB;
BEGIN
    resultado := public.fn_actualizar_estado_practica(9202, 924, pg_temp.estado_id('RECHAZADA'), 'caso F sin rol');
    IF resultado IS DISTINCT FROM '{"error": "USUARIO_NO_AUTORIZADO"}'::JSONB THEN
        RAISE EXCEPTION 'Caso F fallido (sin rol): resultado %', resultado;
    END IF;
    resultado := public.fn_actualizar_estado_practica(9202, 920, pg_temp.estado_id('RECHAZADA'), 'caso F estudiante');
    IF resultado IS DISTINCT FROM '{"error": "USUARIO_NO_AUTORIZADO"}'::JSONB THEN
        RAISE EXCEPTION 'Caso F fallido (estudiante): resultado %', resultado;
    END IF;
    resultado := public.fn_actualizar_estado_practica(9205, 925, pg_temp.estado_id('RECHAZADA'), 'caso F inactivo');
    IF resultado IS DISTINCT FROM '{"error": "USUARIO_NO_AUTORIZADO"}'::JSONB THEN
        RAISE EXCEPTION 'Caso F fallido (gestor inactivo): resultado %', resultado;
    END IF;
    IF pg_temp.huella(9202) IS DISTINCT FROM antes OR pg_temp.huella(9205) IS DISTINCT FROM antes_inactiva THEN
        RAISE EXCEPTION 'Caso F fallido: escritura no permitida';
    END IF;
END;
$$;

SELECT 'EP07 autorización por gestor asignado: casos A-F aprobados' AS resultado;

ROLLBACK;
