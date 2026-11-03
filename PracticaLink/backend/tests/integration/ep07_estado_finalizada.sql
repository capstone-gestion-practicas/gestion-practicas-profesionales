-- EP07 · Corrección 1: una práctica FINALIZADA no puede cambiar de estado por el flujo genérico.
-- Ejecutar SOLO en un PostgreSQL de laboratorio desechable que ya tenga aplicadas, en orden,
-- las migraciones de supabase/migrations hasta 20261103100000 inclusive y los scripts EP04.
-- Datos sintéticos. Todo ocurre en una transacción que termina con ROLLBACK.
--
-- Uso: psql -X -v ON_ERROR_STOP=1 -U postgres -d <base_laboratorio> -f ep07_estado_finalizada.sql
-- Cualquier aserción fallida aborta el script con código distinto de cero.

BEGIN;

INSERT INTO usuario(id_usuario,nombre,apellido,correo,password_hash) VALUES
    (900,'Estudiante','Sintetico','ep07-student@example.invalid','synthetic-hash'),
    (901,'Gestor','Sintetico','ep07-manager@example.invalid','synthetic-hash'),
    (902,'Admin','Sintetico','ep07-admin@example.invalid','synthetic-hash');
INSERT INTO usuario_rol SELECT 900, id_rol FROM rol WHERE nombre = 'ESTUDIANTE';
INSERT INTO usuario_rol SELECT 901, id_rol FROM rol WHERE nombre = 'GESTOR';
INSERT INTO usuario_rol SELECT 902, id_rol FROM rol WHERE nombre = 'ADMINISTRADOR';
INSERT INTO estudiante(id_estudiante,id_usuario,rut,carrera,sede)
    VALUES (900, 900, '12345678-5', 'Carrera sintetica', 'Sede sintetica');
INSERT INTO centro_practica(id_centro,nombre) VALUES (900, 'Centro sintetico');

-- Práctica terminal: FINALIZADA con su cierre y su historial de cierre.
INSERT INTO practica(id_practica,id_estudiante,id_centro,id_estado_actual,fecha_inicio,fecha_termino,id_gestor)
    VALUES (9001, 900, 900,
            (SELECT id_estado FROM estado_practica WHERE nombre = 'FINALIZADA'),
            CURRENT_DATE - 30, CURRENT_DATE - 1, 901);
INSERT INTO cierre_practica(id_practica,id_usuario,resultado) VALUES (9001, 901, 'APROBADA');
INSERT INTO historial_estado(id_practica,id_estado,id_usuario)
    VALUES (9001, (SELECT id_estado FROM estado_practica WHERE nombre = 'FINALIZADA'), 901);

-- Práctica NO finalizada, para comprobar que las transiciones válidas siguen funcionando.
INSERT INTO practica(id_practica,id_estudiante,id_centro,id_estado_actual,fecha_inicio,fecha_termino,id_gestor)
    VALUES (9002, 900, 900,
            (SELECT id_estado FROM estado_practica WHERE nombre = 'APROBADA'),
            CURRENT_DATE - 30, CURRENT_DATE + 30, 901);
INSERT INTO historial_estado(id_practica,id_estado,id_usuario)
    VALUES (9002, (SELECT id_estado FROM estado_practica WHERE nombre = 'APROBADA'), 902);

CREATE TEMP TABLE ep07_foto AS
SELECT 'antes' AS momento,
       (SELECT id_estado_actual FROM practica WHERE id_practica = 9001) AS estado,
       (SELECT count(*) FROM cierre_practica WHERE id_practica = 9001) AS cierres,
       (SELECT count(*) FROM historial_estado WHERE id_practica = 9001) AS historial,
       (SELECT count(*) FROM notificacion WHERE id_practica = 9001) AS notificaciones;

-- Caso A y B: ningún destino válido puede sacar a 9001 de FINALIZADA.
DO $$
DECLARE
    destino BIGINT;
    resultado JSONB;
    rechazos INTEGER := 0;
BEGIN
    FOR destino IN
        SELECT id_estado FROM estado_practica
        WHERE nombre IN ('EN_CURSO', 'APROBADA', 'RECHAZADA', 'FINALIZADA', 'REGISTRADA', 'OBSERVADA')
    LOOP
        resultado := public.fn_actualizar_estado_practica(9001, 902, destino, 'intento de reapertura');
        IF resultado IS DISTINCT FROM '{"error": "PRACTICA_FINALIZADA_NO_MODIFICABLE"}'::JSONB THEN
            RAISE EXCEPTION 'Caso A/B fallido: destino % devolvió %', destino, resultado;
        END IF;
        rechazos := rechazos + 1;
    END LOOP;
    -- Destino inexistente: también debe rechazarse por la regla de terminal, no por ESTADO_NO_DISPONIBLE.
    resultado := public.fn_actualizar_estado_practica(9001, 902, 999999, 'destino inexistente');
    IF resultado IS DISTINCT FROM '{"error": "PRACTICA_FINALIZADA_NO_MODIFICABLE"}'::JSONB THEN
        RAISE EXCEPTION 'Caso B fallido: destino inexistente devolvió %', resultado;
    END IF;
    IF rechazos < 6 THEN
        RAISE EXCEPTION 'Caso A/B: se comprobaron pocos destinos (%)', rechazos;
    END IF;
END;
$$;

-- Caso C: tras los rechazos, nada cambió: estado, cierre, historial y notificaciones.
DO $$
DECLARE
    antes RECORD;
    ahora RECORD;
BEGIN
    SELECT * INTO antes FROM ep07_foto WHERE momento = 'antes';
    SELECT 'ahora' AS momento,
           (SELECT id_estado_actual FROM practica WHERE id_practica = 9001) AS estado,
           (SELECT count(*) FROM cierre_practica WHERE id_practica = 9001) AS cierres,
           (SELECT count(*) FROM historial_estado WHERE id_practica = 9001) AS historial,
           (SELECT count(*) FROM notificacion WHERE id_practica = 9001) AS notificaciones
      INTO ahora;
    IF ahora.estado IS DISTINCT FROM antes.estado THEN
        RAISE EXCEPTION 'Caso C fallido: el estado cambió de % a %', antes.estado, ahora.estado;
    END IF;
    IF ahora.cierres <> antes.cierres OR ahora.cierres <> 1 THEN
        RAISE EXCEPTION 'Caso C fallido: cierre_practica alterado (% → %)', antes.cierres, ahora.cierres;
    END IF;
    IF ahora.historial <> antes.historial THEN
        RAISE EXCEPTION 'Caso C fallido: historial alterado (% → %)', antes.historial, ahora.historial;
    END IF;
    IF ahora.notificaciones <> antes.notificaciones THEN
        RAISE EXCEPTION 'Caso C fallido: notificaciones alteradas (% → %)', antes.notificaciones, ahora.notificaciones;
    END IF;
END;
$$;

-- Caso D: una transición válida de una práctica NO finalizada sigue funcionando.
DO $$
DECLARE
    observada BIGINT;
    resultado JSONB;
    historial_antes BIGINT;
    historial_despues BIGINT;
BEGIN
    SELECT id_estado INTO observada FROM estado_practica WHERE nombre = 'OBSERVADA';
    SELECT count(*) INTO historial_antes FROM historial_estado WHERE id_practica = 9002;
    resultado := public.fn_actualizar_estado_practica(9002, 902, observada, 'transición válida');
    IF resultado->>'estado' IS DISTINCT FROM 'OBSERVADA' THEN
        RAISE EXCEPTION 'Caso D fallido: resultado inesperado %', resultado;
    END IF;
    SELECT count(*) INTO historial_despues FROM historial_estado WHERE id_practica = 9002;
    IF historial_despues <> historial_antes + 1 THEN
        RAISE EXCEPTION 'Caso D fallido: historial % → %, se esperaba +1', historial_antes, historial_despues;
    END IF;
    IF (SELECT nombre FROM estado_practica e JOIN practica p ON p.id_estado_actual = e.id_estado
         WHERE p.id_practica = 9002) <> 'OBSERVADA' THEN
        RAISE EXCEPTION 'Caso D fallido: el estado de la práctica no quedó en OBSERVADA';
    END IF;
END;
$$;

SELECT 'EP07 estado FINALIZADO: todas las aserciones aprobadas' AS resultado;

ROLLBACK;
