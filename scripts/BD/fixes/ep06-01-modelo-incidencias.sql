-- HU015 WEB. Migración única; aplicar solo en entorno autorizado.
-- No reescribe históricos. NOT VALID controla INSERT/UPDATE posteriores.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
LOCK TABLE public.incidencia IN ACCESS EXCLUSIVE MODE;

-- Compara definiciones estructurales, no nombres aproximados. La tabla temporal
-- usa exactamente los tipos del esquema versionado para comparar expresiones.
CREATE TEMP TABLE ep06_expected (
    estado VARCHAR(20),
    CONSTRAINT ep06_expected_state CHECK (
        estado IN ('ABIERTA','EN_REVISION','RESUELTA','CERRADA'))
) ON COMMIT DROP;
DO $preflight$
DECLARE actual TEXT; expected TEXT;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conrelid='public.incidencia'::regclass
          AND conname='fk_incidencia_practica' AND contype='f' AND convalidated
          AND confrelid='public.practica'::regclass
          AND conkey=ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute
               WHERE attrelid='public.incidencia'::regclass AND attname='id_practica')]::smallint[]
          AND confkey=ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute
               WHERE attrelid='public.practica'::regclass AND attname='id_practica')]::smallint[]
          AND confdeltype='c' AND confupdtype='a' AND confmatchtype='s'
          AND NOT condeferrable AND NOT condeferred
    ) THEN RAISE EXCEPTION 'EP06: FK de práctica incompatible'; END IF;
    SELECT pg_catalog.pg_get_constraintdef(oid) INTO actual
    FROM pg_catalog.pg_constraint WHERE conrelid='public.incidencia'::regclass
      AND conname='chk_incidencia_estado' AND contype='c' AND convalidated;
    SELECT pg_catalog.pg_get_constraintdef(oid) INTO expected
    FROM pg_catalog.pg_constraint WHERE conrelid='pg_temp.ep06_expected'::regclass
      AND conname='ep06_expected_state';
    IF actual IS DISTINCT FROM expected THEN
        RAISE EXCEPTION 'EP06: CHECK de estado incompatible';
    END IF;
    -- Verificar columnas y defaults de los que depende la operación antes de DDL.
    IF EXISTS (
        SELECT 1 FROM (VALUES
          ('id_incidencia','bigint',true),('id_practica','bigint',true),
          ('id_usuario','bigint',true),('fecha','timestamp with time zone',true),
          ('descripcion','text',true),('prioridad','character varying(20)',true),
          ('estado','character varying(20)',true),('fecha_resolucion','timestamp with time zone',false)
        ) AS expected_column(name,type_name,not_null)
        LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid='public.incidencia'::regclass
          AND a.attname=expected_column.name AND NOT a.attisdropped
        WHERE a.attnum IS NULL OR pg_catalog.format_type(a.atttypid,a.atttypmod)<>type_name
          OR a.attnotnull<>not_null
    ) THEN RAISE EXCEPTION 'EP06: columnas incompatibles'; END IF;
    IF (SELECT pg_catalog.pg_get_expr(d.adbin,d.adrelid)
        FROM pg_catalog.pg_attrdef d JOIN pg_catalog.pg_attribute a
          ON a.attrelid=d.adrelid AND a.attnum=d.adnum
        WHERE a.attrelid='public.incidencia'::regclass AND a.attname='prioridad')
       IS DISTINCT FROM '''MEDIA''::character varying' THEN
        RAISE EXCEPTION 'EP06: prioridad predeterminada incompatible';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
        WHERE tgrelid='public.incidencia'::regclass AND NOT tgisinternal) THEN
        RAISE EXCEPTION 'EP06: triggers preexistentes requieren revisión';
    END IF;
    IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid='public.incidencia'::regclass) THEN
        RAISE EXCEPTION 'EP06: RLS requerido';
    END IF;
END;
$preflight$;

CREATE TABLE public.tipo_incidencia (
    id_tipo_incidencia BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    codigo TEXT NOT NULL UNIQUE,
    nombre TEXT NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT chk_ep06_codigo CHECK (codigo IN ('ABANDONO','PROBLEMA_CENTRO','SALUD','OTRO'))
);
INSERT INTO public.tipo_incidencia(codigo,nombre) VALUES
 ('ABANDONO','Abandono'),('PROBLEMA_CENTRO','Problema con el centro'),
 ('SALUD','Salud'),('OTRO','Otro');
ALTER TABLE public.tipo_incidencia ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incidencia ADD COLUMN id_tipo_incidencia BIGINT
    REFERENCES public.tipo_incidencia(id_tipo_incidencia) ON DELETE RESTRICT;
ALTER TABLE public.incidencia ADD CONSTRAINT chk_ep06_tipo
    CHECK (id_tipo_incidencia IS NOT NULL) NOT VALID;
ALTER TABLE public.incidencia DROP CONSTRAINT chk_incidencia_estado;
ALTER TABLE public.incidencia ADD CONSTRAINT chk_ep06_estado
    CHECK (estado IN ('PENDIENTE','EN_ATENCION','RESUELTA')) NOT VALID;
ALTER TABLE public.incidencia ALTER COLUMN estado SET DEFAULT 'PENDIENTE';
ALTER TABLE public.incidencia ADD CONSTRAINT chk_ep06_descripcion
    CHECK (descripcion ~ '[^[:space:]]' AND pg_catalog.char_length(descripcion)<=2000) NOT VALID;
ALTER TABLE public.incidencia DROP CONSTRAINT fk_incidencia_practica;
ALTER TABLE public.incidencia ADD CONSTRAINT fk_incidencia_practica
    FOREIGN KEY(id_practica) REFERENCES public.practica(id_practica) ON DELETE RESTRICT;

CREATE TABLE public.historial_estado_incidencia (
    id_historial BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id_incidencia BIGINT NOT NULL REFERENCES public.incidencia(id_incidencia) ON DELETE RESTRICT,
    id_usuario BIGINT NOT NULL REFERENCES public.usuario(id_usuario) ON DELETE RESTRICT,
    estado_anterior VARCHAR(20),
    estado_nuevo VARCHAR(20) NOT NULL,
    fecha TIMESTAMPTZ NOT NULL,
    comentario TEXT,
    CONSTRAINT chk_ep06_transicion CHECK (COALESCE((
      (estado_anterior IS NULL AND estado_nuevo='PENDIENTE') OR
      (estado_anterior='PENDIENTE' AND estado_nuevo IN ('EN_ATENCION','RESUELTA')) OR
      (estado_anterior='EN_ATENCION' AND estado_nuevo='RESUELTA')),false)),
    CONSTRAINT chk_ep06_comentario CHECK (estado_nuevo<>'RESUELTA' OR
      (comentario IS NOT NULL AND comentario ~ '[^[:space:]]'))
);
ALTER TABLE public.historial_estado_incidencia ENABLE ROW LEVEL SECURITY;
CREATE SCHEMA incidencias_privadas;
REVOKE ALL ON SCHEMA incidencias_privadas FROM PUBLIC;
CREATE FUNCTION incidencias_privadas.fn_impedir_borrado() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='EP06_CONSERVACION_REQUERIDA';
END;
$$;
REVOKE ALL ON FUNCTION incidencias_privadas.fn_impedir_borrado() FROM PUBLIC;
CREATE TRIGGER ep06_no_delete BEFORE DELETE ON public.incidencia
    FOR EACH ROW EXECUTE FUNCTION incidencias_privadas.fn_impedir_borrado();
CREATE TRIGGER ep06_no_truncate BEFORE TRUNCATE ON public.incidencia
    FOR EACH STATEMENT EXECUTE FUNCTION incidencias_privadas.fn_impedir_borrado();
CREATE TRIGGER ep06_historial_no_delete BEFORE DELETE ON public.historial_estado_incidencia
    FOR EACH ROW EXECUTE FUNCTION incidencias_privadas.fn_impedir_borrado();
CREATE TRIGGER ep06_historial_no_truncate BEFORE TRUNCATE ON public.historial_estado_incidencia
    FOR EACH STATEMENT EXECUTE FUNCTION incidencias_privadas.fn_impedir_borrado();
DO $index$
BEGIN
    -- Btree válido, no parcial ni de expresiones, con prefijo equivalente.
    -- ASC/ASC también sirve recorriéndolo al revés. Ambas columnas son NOT NULL.
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_index i
        JOIN pg_catalog.pg_class c ON c.oid=i.indexrelid
        JOIN pg_catalog.pg_am am ON am.oid=c.relam
        WHERE i.indrelid='public.incidencia'::regclass
          AND i.indisvalid AND i.indisready AND i.indpred IS NULL
          AND i.indexprs IS NULL AND i.indnkeyatts>=3 AND am.amname='btree'
          AND i.indkey[0]=(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid=i.indrelid AND attname='id_practica')
          AND i.indkey[1]=(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid=i.indrelid AND attname='fecha')
          AND i.indkey[2]=(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid=i.indrelid AND attname='id_incidencia')
          AND (i.indoption[1] & 1)=(i.indoption[2] & 1)
    ) THEN
        CREATE INDEX idx_ep06_incidencia_historial
            ON public.incidencia(id_practica,fecha DESC,id_incidencia DESC);
    END IF;
END;
$index$;
CREATE INDEX idx_ep06_historial ON public.historial_estado_incidencia(id_incidencia,fecha DESC,id_historial DESC);
COMMENT ON COLUMN public.incidencia.id_tipo_incidencia IS
 'NULL conserva históricos sin clasificar. No convertir automáticamente estados ni tipos.';
COMMIT;
