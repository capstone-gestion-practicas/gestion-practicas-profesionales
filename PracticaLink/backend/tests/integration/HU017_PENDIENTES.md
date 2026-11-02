# HU017 — Identificar prácticas con incidencias pendientes (PostgreSQL)

Alcance de esta entrega: **solo PostgreSQL**. FastAPI y Angular no se han
modificado; el contrato HTTP y la UI quedan para fases posteriores.

## Definición implementada

- **Pendiente** = `incidencia.estado = 'PENDIENTE'`, exacto.
- `EN_ATENCION` se informa en el campo separado `en_atencion` y **nunca** se
  suma a `pendientes`.
- Una práctica aparece si tiene al menos una incidencia `PENDIENTE` **o** `EN_ATENCION`
  (corrección DEFECTO-001, `ep06-09-corregir-resumen-pendientes.sql`). Los dos contadores
  son independientes. Una práctica con ambos en 0 no aparece.
- Sin pendientes, `fecha_pendiente_antigua` es `null`; no se inventa fecha.
- `fecha_pendiente_antigua` = `MIN(fecha)` **únicamente** entre incidencias
  `PENDIENTE`. Una `EN_ATENCION` más antigua no altera ese valor.

## Históricos incompatibles

Estados anteriores al modelo moderno (`ABIERTA`, `EN_REVISION`, `CERRADA`, etc.):

- no cuentan como `PENDIENTE`;
- no se convierten, reinterpretan ni modifican;
- una práctica que solo tiene históricos **no aparece**;
- siguen consultables por las funciones existentes (EP06-04, HU016).

La función filtra `estado IN ('PENDIENTE','EN_ATENCION')` antes de agregar, así
que cualquier otro valor queda fuera por construcción.

## Prácticas finalizadas

Una práctica `FINALIZADA` con incidencias `PENDIENTE` **sí aparece**: HU016
permite gestionar incidencias modernas existentes. No cambia la regla de HU015:
`fn_registrar_incidencia` sigue devolviendo `PRACTICA_NO_EN_CURSO` para altas.

## Firma SQL

Script: `scripts/BD/fixes/ep06-08-resumen-pendientes.sql` (incremental, sin
modificar EP06-01..07).

```sql
incidencias_privadas.fn_resumen_incidencias_pendientes(
    p_id_usuario BIGINT,
    p_limit      INTEGER DEFAULT 50,
    p_offset     BIGINT  DEFAULT 0
) RETURNS JSONB
```

`LANGUAGE plpgsql STABLE SECURITY DEFINER`, `SET search_path = pg_catalog, pg_temp`,
`SET TimeZone = 'UTC'`, propietario `pl_ep06_read_owner` (ya existente).

## Respuesta

```json
{
  "items": [
    {
      "id_practica": 15,
      "pendientes": 3,
      "en_atencion": 1,
      "fecha_pendiente_antigua": "2026-10-20T15:10:00+00:00"
    }
  ],
  "limit": 50,
  "offset": 0,
  "hay_mas": false
}
```

Errores (mismo patrón que EP06-04): `{"error":"USUARIO_NO_AUTORIZADO"}` y
`{"error":"PAGINACION_INVALIDA"}`.

Orden: `fecha_pendiente_antigua ASC, id_practica ASC` (determinista).

## Paginación

- `limit`: 1..100, por defecto 50. `offset`: ≥ 0.
- `hay_mas` se calcula con `LIMIT limit+1` en la misma sentencia.
- **No** se devuelve `total`: no lo exige el patrón EP06-04 y evitarlo mantiene
  la consulta acotada.
- Limitación conocida de paginación offset: si otra transacción cambia estados
  entre dos páginas, pueden aparecer o desaparecer prácticas en el límite.

## Seguridad y permisos

- Autorización dentro de PostgreSQL antes de revelar datos: usuario activo y rol
  activo `GESTOR` o `ADMINISTRADOR`. ESTUDIANTE e inactivos → `USUARIO_NO_AUTORIZADO`.
- Sin nuevos propietarios técnicos: reutiliza `pl_ep06_read_owner`, que ya tenía
  SELECT de columnas mínimas (`incidencia`: `id_practica`, `estado`, `fecha`).
- `pl_ep06_executor`: solo `EXECUTE`. Sin SELECT, INSERT, UPDATE, DELETE ni TRUNCATE
  sobre `incidencia`, historial, usuario o práctica.
- ACL verificada: exactamente `pl_ep06_read_owner` y `pl_ep06_executor`, ambos con
  EXECUTE. Sin PUBLIC ni otros roles.
- El preflight del script rechaza entornos con privilegios incompatibles.
- Sin DML: la función es `STABLE`.

## Rendimiento

Medición en PostgreSQL 18.6 Docker con **50.000 incidencias sintéticas** y 2.000
prácticas (ver [HU017_PLAN_RESULTADO.json](HU017_PLAN_RESULTADO.json)):

| Configuración | Nodo principal | Tiempo |
|---|---|---|
| Sin índice adicional (actual) | Seq Scan sobre `incidencia` | 6,3 ms |
| Índice candidato `(estado,id_practica) INCLUDE (fecha)`, revertido | Bitmap Heap Scan | 3,7 ms |

Función completa (primera página, límite 50): **7,4 ms**.

**Decisión: no crear índice.** La ganancia medida (~2,6 ms) no justifica una
estructura permanente en este volumen. El índice candidato se evaluó dentro de
una transacción revertida; la prueba confirma que no queda en la base.

Índice existente relevante: `idx_ep06_incidencia_historial (id_practica, fecha DESC, id_incidencia DESC)`.
No cubre el filtro por `estado`, por eso el plan usa escaneo secuencial.

Revisar esta decisión si el volumen real crece de forma significativa; entonces
volver a medir con EXPLAIN ANALYZE sobre datos representativos.

## Pruebas

Suite: `PracticaLink/backend/tests/integration/run_resumen_pendientes.py`.
Ejecuta PostgreSQL 18.6 en Docker local exclusivo y, en la misma ejecución,
las regresiones de HU013, HU014, HU015, EP06-04 y HU016.

Cada prueba de HU017 corre dentro de una transacción revertida. Las aserciones
globales se comparan contra el listado completo, porque otras suites pueden dejar
filas confirmadas en el mismo contenedor.

Resultado observado (ejecución final):

- **97 pruebas, 97 aprobadas, 0 fallidas**, incluidas las 13 de HU017.
- Pruebas de HU017: autorización (GESTOR, ADMIN, ESTUDIANTE, usuario inactivo, rol
  inactivo, precedencia sobre paginación); conteo (solo `PENDIENTE`, `EN_ATENCION`
  separado); históricos (`ABIERTA`, `EN_REVISION`, `CERRADA`, mezclados); finalizadas
  (incluidas, alta bloqueada); orden y desempate; paginación contra listado completo
  y errores de parámetros; solo lectura; independencia de zona horaria; RLS
  restrictiva dentro de SECURITY DEFINER; configuración, propietario y ACL; ejecutor
  con EXECUTE sin escritura ni lectura directa; otros roles denegados.
- Preflight: entornos incompatibles rechazados (`SELECT` concedido al ejecutor; `SELECT`
  de `estado` retirado al propietario).

Un primer intento falló en una prueba de zona horaria por un error de la propia
prueba (la instantánea `to_jsonb(timestamptz)` depende de `TimeZone`). Se corrigió
la prueba, no la función, y se separó en dos pruebas con nombre explícito.

Reproducir:

~~~bash
PracticaLink/backend/.venv/bin/python -B \
  PracticaLink/backend/tests/integration/run_resumen_pendientes.py --docker-local
~~~

Medición de rendimiento:

~~~bash
PracticaLink/backend/.venv/bin/python -B \
  PracticaLink/backend/tests/integration/run_resumen_pendientes_plan.py \
  --docker-local --report PracticaLink/backend/tests/integration/HU017_PLAN_RESULTADO.json
~~~

Requiere Docker local con `postgres:18.6` ya disponible. No descarga imágenes ni
conecta a Supabase. Los recursos se crean con prefijo `ep06-hu017-` y se eliminan
solo si pertenecen al laboratorio.

## Limitaciones

- Sin FastAPI ni Angular: el contrato HTTP y la interfaz son trabajo posterior.
- Paginación offset: consistencia dentro de una página; no entre páginas.
- Volumen medido sintético (50.000 filas); no representa producción.
- No se verificó el contenido real de producción: no hay acceso a Supabase ni
  datos reales. Si existen filas `ABIERTA` o `EN_REVISION` en datos reales, no se
  contarán como pendientes, por diseño, y esto requiere confirmación funcional.
- Índices: ninguno creado; la decisión depende de la medición descrita.
