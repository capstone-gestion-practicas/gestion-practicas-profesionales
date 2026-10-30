-- HU013 WEB. Aplicar solo tras revisión y autorización del entorno.
-- Orden: schema.sql (solo base vacía), este archivo, ep05-02, ep05-03.
-- Migración única: falla si ya fue aplicada; nunca recrea ni vacía tablas.
-- Mantiene fecha/fecha_creacion originales, IDs, autor, medio y observaciones.
-- La nueva columna es la fecha funcional; los timestamps históricos no se pierden.
BEGIN;

LOCK TABLE public.seguimiento IN ACCESS EXCLUSIVE MODE;
ALTER TABLE public.seguimiento ADD COLUMN fecha_seguimiento DATE;
UPDATE public.seguimiento
SET fecha_seguimiento = (fecha AT TIME ZONE 'America/Santiago')::DATE;
ALTER TABLE public.seguimiento ALTER COLUMN fecha_seguimiento SET NOT NULL;

-- Los datos anteriores se conservan incluso si no satisfacen las nuevas reglas.
-- NOT VALID evita repararlos o descartarlos; sí controla nuevas filas/updates.
ALTER TABLE public.seguimiento ADD CONSTRAINT chk_ep05_observacion
    CHECK (observacion ~ '[^[:space:]]' AND char_length(observacion) <= 2000) NOT VALID;
ALTER TABLE public.seguimiento ADD CONSTRAINT chk_ep05_tipo
    CHECK (tipo IS NOT NULL AND tipo IN (
        'Reunión presencial', 'Videollamada', 'Llamada telefónica',
        'Correo electrónico', 'Otro'
    )) NOT VALID;

-- No permitir borrado de una práctica con seguimientos, tampoco desde cascadas.
ALTER TABLE public.seguimiento DROP CONSTRAINT fk_seguimiento_practica;
ALTER TABLE public.seguimiento ADD CONSTRAINT fk_seguimiento_practica
    FOREIGN KEY (id_practica) REFERENCES public.practica(id_practica) ON DELETE RESTRICT;

COMMENT ON COLUMN public.seguimiento.fecha_seguimiento IS
    'HU013: fecha calendario del seguimiento en America/Santiago, independiente de fecha_creacion.';
COMMIT;
