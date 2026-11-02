-- EP04 / HU04.2: APROBADA -> EN_CURSO.
-- PREPARADO PARA REVISION. Validacion solo en PostgreSQL local aislado.
-- No aplicado a Supabase. Esta revision incorpora bloqueos de autorizacion/catalogo.
-- Orden: schema.sql -> ep04-01-permisos-iniciar-practica.sql -> este script.
-- Solo despues de revision y autorizacion del entorno. No aplicado a Supabase.
-- En instalaciones existentes no se elimina la firma publica anterior: auditarla
-- y retirarla por separado si ya se hubiera desplegado. No crear un wrapper RPC.
-- No modifica fn_revisar_practica ni repara datos historicos.
--
-- Contrato de errores de negocio (JSONB con clave error):
-- USUARIO_NO_AUTORIZADO       -> HTTP 403 (inexistente, inactivo o sin rol activo).
-- PRACTICA_NO_ENCONTRADA      -> HTTP 404.
-- ESTADO_FINAL               -> HTTP 409.
-- TRANSICION_NO_PERMITIDA     -> HTTP 409 (incluye EN_CURSO -> EN_CURSO).
-- HISTORIAL_INCONSISTENTE     -> HTTP 409 (ausente, diferente o fecha futura).
-- ESTADO_DESTINO_NO_VALIDO    -> HTTP 500 (EN_CURSO ausente/inactivo/final).
-- OBSERVACION_INVALIDA        -> HTTP 422 (mas de 500 caracteres).
-- INICIO_NO_CONFIRMADO (excepcion) -> HTTP 500 y rollback obligatorio.
-- Excepciones SQL inesperadas: propagar; FastAPI debe hacer rollback, sin
-- exponer SQL, observaciones o detalles internos. lock_timeout: conflicto
-- temporal; serialization_failure/deadlock: rollback de toda la transaccion.
-- FastAPI debe obtener p_id_usuario del JWT, nunca del cuerpo de la peticion.
--
-- Seguridad: DEFINER propiedad de pl_ep04_owner (NOLOGIN, sin privilegios
-- administrativos, no propietario de tablas); ejecuta con sus politicas RLS.
-- pl_ep04_executor recibe solo USAGE del esquema y EXECUTE de esta firma.
-- Ambos son roles de capacidad NOLOGIN; el login exclusivo de FastAPI se
-- aprovisionara fuera del script, sin pertenencia al propietario tecnico.
-- Esquema practicas_privadas: NO incluir en los esquemas expuestos de Supabase.
-- No se cambia el login ni los permisos existentes de EP03.
-- Objetos public calificados y search_path sin esquemas controlados por clientes.
-- El actor sigue siendo una afirmacion del backend de confianza, no un JWT SQL.
-- CREATE FUNCTION falla si existe la firma: no sustituir objetos automaticamente.
-- ACL: se elimina PUBLIC y cualquier concesion explicita no deseada heredada de
-- default privileges al crear esta funcion; despues se concede al ejecutor.
-- No se concede pertenencia a pl_ep04_owner ni CREATE permanente al propietario.
-- Un propietario/superusuario del despliegue sigue siendo una autoridad confiable.
-- El script previo falla si detecta privilegios ambientales incompatibles.
-- No asignar el rol ejecutor a roles cliente ni modificar grants generales.
--
-- Transacciones: el llamador debe hacer commit SOLO en exito y rollback ante
-- cualquier error. Los bloqueos duran hasta finalizar la transaccion externa.
-- El BEGIN/COMMIT de este archivo instala el objeto; NO hay COMMIT en la funcion.
--
-- Casos de integracion en base aislada con datos sinteticos:
-- Repetir en cada revision; la validacion local no aprueba despliegue real.
-- La revision con bloqueos tambien prueba mutaciones de usuario/rol/asignacion
-- y catalogo en ambos ordenes, asi como concurrencia con EP03. No afirmar que
-- pruebas finitas demuestran ausencia general de deadlocks.
-- 1. Gestor/administrador activo, APROBADA y ultimo evento coincidente: un UPDATE,
--    un evento EN_CURSO; timestamp exacto compartido y respuesta con ambos estados.
-- 2. Actor ausente/inactivo, estudiante, rol inactivo o sin asignacion: 403 sin cambios.
-- 3. Practica ausente: 404; todos los otros origenes y repeticion: 409 sin evento.
-- 4. FINALIZADA/RECHAZADA y cualquier catalogo es_final=true: rechazo sin cambios.
-- 5. EN_CURSO ausente/inactivo/final: 500 sin cambios.
-- 6. Historial vacio, ultimo evento diferente o fecha futura: 409 sin reparacion.
-- 7. Fechas iguales: comprobar desempate por id_historial DESC.
-- 8. Observacion NULL/vacia/espacios y 500 caracteres; 501: rechazo sin truncar.
-- 9. Provocar fallo al insertar historial: UPDATE revertido por la excepcion;
--    rollback del llamador tras exito tambien revierte estado e historial.
-- 10. Dos conexiones: A inicia y mantiene transaccion abierta; B espera el lock.
--     Si A confirma, B rechaza origen EN_CURSO; exactamente un evento nuevo.
--     Si A revierte, B puede completar; exactamente un cambio persistente.
-- 11. Verificar permisos de funcion, RLS y secuencias con el rol real de backend;
--     PUBLIC/roles cliente sin privilegio efectivo de ejecucion.
-- 12. UPDATE o INSERT suprimido por politica/trigger: excepcion, sin exito parcial.
-- 13. Regresion de fn_revisar_practica y lectura de detalle/historial.
--
-- Limites: el estado anterior se devuelve, pero no se almacena en columna nueva.
-- HU04.3 lo deriva del evento previo. Los nombres del catalogo son los actuales.
-- Escritores directos que omitan el bloqueo de practica pueden romper el protocolo;
-- la consistencia global exige controlar esos privilegios por separado.
-- Orden de bloqueos de esta funcion:
-- usuario responsable FOR SHARE -> sus asignaciones por id_rol FOR SHARE ->
-- roles asignados por id_rol FOR SHARE -> practica FOR UPDATE ->
-- catalogo (origen y destino) por id_estado FOR SHARE.
-- Usuario primero es compatible con fn_actualizar_usuario_admin, que bloquea
-- el usuario antes de editarlo y reemplazar sus asignaciones. No modificar ese
-- procedimiento ni fn_revisar_practica. SHARE deja coexistir inicios del mismo
-- responsable y bloquea modificaciones de las filas protegidas hasta commit.
-- Se valida usando los valores obtenidos DESPUES de adquirir cada bloqueo.
-- Una asignacion nueva concurrente no invalida una autorizacion ya protegida;
-- si no se encontro autorizacion vigente se rechaza sin esperar altas futuras.
-- Sin garantia general de ausencia de deadlocks: otros escritores pueden usar
-- otro orden; 40P01/40001/55P03 deben causar rollback por el llamador.
-- READ COMMITTED: validar datos actualizados tras esperas; a mayor aislamiento
-- pueden aparecer errores de serializacion y debe repetirse la transaccion.
-- No garantiza que una revocacion ya solicitada tenga prioridad: la operacion
-- que obtiene primero los bloqueos termina antes y la otra espera.

BEGIN;

CREATE FUNCTION practicas_privadas.fn_iniciar_practica(
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
BEGIN
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
    END LOOP;
    IF NOT v_autorizado THEN
        RETURN pg_catalog.jsonb_build_object('error', 'USUARIO_NO_AUTORIZADO');
    END IF;

    SELECT p.id_estado_actual
    INTO v_id_estado_anterior
    FROM public.practica p
    WHERE p.id_practica = p_id_practica
    FOR UPDATE OF p;

    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('error', 'PRACTICA_NO_ENCONTRADA');
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

-- CREATE sobre el esquema es un requisito temporal para transferir propiedad.
-- No se conserva despues de instalar; la funcion no pertenece al dueno de tablas.
GRANT CREATE ON SCHEMA practicas_privadas TO pl_ep04_owner;
ALTER FUNCTION practicas_privadas.fn_iniciar_practica(BIGINT, BIGINT, VARCHAR)
    OWNER TO pl_ep04_owner;
REVOKE CREATE ON SCHEMA practicas_privadas FROM pl_ep04_owner;
REVOKE ALL ON FUNCTION practicas_privadas.fn_iniciar_practica(BIGINT, BIGINT, VARCHAR)
    FROM PUBLIC;

-- Limpiar grants explicitos que pudieran introducir default privileges del
-- instalador. Solo esta funcion; no alterar default privileges ni otros objetos.
DO $acl$
DECLARE
    v_rol NAME;
BEGIN
    FOR v_rol IN
        SELECT DISTINCT r.rolname
        FROM pg_catalog.pg_proc p
        CROSS JOIN LATERAL pg_catalog.aclexplode(
            COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))
        ) a
        JOIN pg_catalog.pg_roles r ON r.oid = a.grantee
        WHERE p.oid = 'practicas_privadas.fn_iniciar_practica(bigint,bigint,character varying)'::pg_catalog.regprocedure
          AND a.grantee <> p.proowner
    LOOP
        EXECUTE pg_catalog.format(
            'REVOKE ALL ON FUNCTION practicas_privadas.fn_iniciar_practica(BIGINT, BIGINT, VARCHAR) FROM %I',
            v_rol
        );
    END LOOP;
END;
$acl$;
GRANT EXECUTE ON FUNCTION practicas_privadas.fn_iniciar_practica(BIGINT, BIGINT, VARCHAR)
    TO pl_ep04_executor;

COMMIT;
