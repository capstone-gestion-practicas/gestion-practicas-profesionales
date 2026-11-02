-- HU014: índice de lectura. Transaccional; no reescribe datos.
-- CREATE INDEX normal toma un lock que puede esperar/bloquear escritores:
-- planificar su aplicación fuera del laboratorio mediante revisión humana.
BEGIN;
DO $index$
BEGIN
    -- Btree válido, no parcial ni de expresiones, con prefijo equivalente.
    -- ASC/ASC también sirve recorriéndolo al revés. Ambas columnas son NOT NULL.
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_index i
        JOIN pg_catalog.pg_class c ON c.oid=i.indexrelid
        JOIN pg_catalog.pg_am am ON am.oid=c.relam
        WHERE i.indrelid='public.seguimiento'::regclass
          AND i.indisvalid AND i.indisready AND i.indpred IS NULL
          AND i.indexprs IS NULL AND i.indnkeyatts>=3 AND am.amname='btree'
          AND i.indkey[0]=(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid=i.indrelid AND attname='id_practica')
          AND i.indkey[1]=(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid=i.indrelid AND attname='fecha_seguimiento')
          AND i.indkey[2]=(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid=i.indrelid AND attname='id_seguimiento')
          AND (i.indoption[1] & 1)=(i.indoption[2] & 1)
    ) THEN
        CREATE INDEX idx_ep05_seguimiento_historial
            ON public.seguimiento(id_practica,fecha_seguimiento DESC,id_seguimiento DESC);
    END IF;
END;
$index$;
COMMIT;
