# HU017 — Resumen HTTP de prácticas con incidencias pendientes

## Endpoint

GET /practicas/con-incidencias-pendientes?limit=50&offset=0

Solo lectura. Sin cuerpo, sin identificadores de usuario en la petición.

## Parámetros

- `limit`: entero, 1..100, por defecto 50.
- `offset`: entero, ≥ 0, por defecto 0.
- Cualquier otro parámetro (por ejemplo `id_usuario`, `estado`) → 422.

## Respuesta 200

~~~json
{
  "items": [
    {
      "id_practica": 15,
      "pendientes": 3,
      "en_atencion": 1,
      "fecha_pendiente_antigua": "2026-10-20T15:10:00Z"
    }
  ],
  "limit": 50,
  "offset": 0,
  "hay_mas": false
}
~~~

Ejemplo sintético. La fecha se serializa con sufijo `Z`, igual que las respuestas
HU015/HU016; es el mismo instante que `+00:00` del contrato SQL.

Campos exactos (`extra='forbid'`): `items[].id_practica`, `items[].pendientes`,
`items[].en_atencion`, `items[].fecha_pendiente_antigua`, `limit`, `offset`, `hay_mas`.

## Definición

- `pendientes`: incidencias con `estado = 'PENDIENTE'`. Siempre ≥ 1.
- `en_atencion`: informativo, separado. **Nunca** se suma a `pendientes`.
- `fecha_pendiente_antigua`: mínima fecha entre las `PENDIENTE` de la práctica.
- Orden: `fecha_pendiente_antigua` ascendente, luego `id_practica` ascendente.
- Históricos (`ABIERTA`, `EN_REVISION`, `CERRADA`, etc.) no cuentan como pendientes y
  una práctica que solo los tiene no aparece. No se convierten ni se modifican.
- Prácticas finalizadas con `PENDIENTE` sí aparecen (HU016 permite gestionarlas).
  No cambia la regla de HU015: no se registran incidencias nuevas en prácticas finalizadas.

## Autenticación y autorización

- Identidad exclusivamente desde el JWT (`get_current_user_id`).
- Roles: GESTOR o ADMINISTRADOR **activos**, comprobados con el contexto del usuario
  mediante la conexión principal (solo `fn_contexto_usuario`).
- PostgreSQL repite la autorización dentro de `fn_resumen_incidencias_pendientes`
  (usuario y rol activos), antes de revelar datos.
- ESTUDIANTE → 403. Usuario inactivo → 403. JWT ausente o inválido → 401/403.

## Acceso a datos

- La lectura de `incidencia` usa **exclusivamente** `INCIDENCIAS_DATABASE_URL`
  (rol restringido `pl_ep06_executor`, con EXECUTE sobre la función).
- La conexión principal no lee `incidencia`. Sin fallback: si la conexión restringida
  no está configurada, la respuesta es 503 y no se consulta por otra vía.
- Una sola llamada a la función por petición. Sin N+1, sin consultas por práctica.
- Transacción de solo lectura (`SET TRANSACTION READ ONLY` como primera sentencia).
- Sin commit. Sin reintentos automáticos. Rollback ante error.

## Errores

| Origen | Respuesta HTTP |
|---|---|
| JWT ausente/inválido | 401 o 403 (dependencia de autenticación existente) |
| Rol no GESTOR/ADMINISTRADOR, usuario inactivo, `USUARIO_NO_AUTORIZADO` | 403 |
| Parámetros fuera de rango o no admitidos | 422 |
| `PAGINACION_INVALIDA` (SQL) | 422 |
| Conexión restringida no configurada o SQLSTATE `08xxx` | 503 |
| Resultado SQL inesperado, incoherente o desconocido | 500 sanitizado |
| Otro error de base de datos | 500 sanitizado |

Los mensajes no incluyen códigos SQL ni detalles internos.

## Validación de resultado antes de responder

Se rechaza con 500 cualquier respuesta que:
- tenga claves extra o un código de error desconocido;
- no coincida en `limit` u `offset` con la petición;
- tenga más elementos que `limit`, o `hay_mas=true` sin página completa;
- repita `id_practica`;
- no esté ordenada por `(fecha_pendiente_antigua, id_practica)`;
- tenga `pendientes = 0` (un histórico nunca debe contarse como pendiente);
- tenga contadores negativos, fechas sin zona horaria o no válidas.

## Enrutamiento

`app/main.py` incluye `incidencias_router` **antes** que `practicas_router`.
Motivo: `GET /practicas/{id_practica}` del router de prácticas coincidía primero con
`/practicas/con-incidencias-pendientes` y devolvía 422 (validación de `int`).
Comprobado: con el orden anterior → 422; con el orden actual → 200. Los demás
paths de incidencias no se solapan con prácticas (`/{id}/incidencias...`).

## Pruebas

Unitarias (`tests/test_incidencias_pendientes.py`, 23 pruebas, con mocks y sin red):
autorización e identidad, parámetros y límites, lista vacía, una y varias prácticas,
`en_atencion` separado, prácticas finalizadas, rechazo de `pendientes=0`, errores SQL,
resultados malformados, 503 por conexión, sin commit, una sola llamada, rollback sin
reintento y orden de rutas.

HTTP + PostgreSQL 18.6 (`tests/integration/run_resumen_pendientes_http.py`), Docker
exclusivo, con regresiones:
- GESTOR y ADMINISTRADOR 200; ESTUDIANTE 403; usuario inactivo 403 y restauración.
- Identidad solo desde JWT; `id_usuario` en query → 422; sin token → 401.
- PENDIENTE contado; EN_ATENCION separado; RESUELTA excluida.
- Históricos excluidos y filas sin cambios (sembrados dentro de una transacción confirmada
  con el CHECK moderno restaurado).
- Prácticas finalizadas con pendientes incluidas; sin pendientes, ausentes.
- Paginación y orden comparados contra el listado completo; `hay_mas`; límites 422.
- El ejecutor restringido no puede hacer SELECT, UPDATE ni DELETE directos.
- Las peticiones no modifican datos.

Regresiones en la misma ejecución: SQL y HTTP de HU013, HU014, HU015, HU016 y EP06-04.

## Reproducción

~~~bash
# Backend unitario completo (sin Docker, sin Supabase)
cd PracticaLink/backend
.venv/bin/python -B -m unittest discover -s tests -v

# HTTP + PostgreSQL real con regresiones (Docker local, imagen postgres:18.6 ya disponible)
.venv/bin/python -B tests/integration/run_resumen_pendientes_http.py --docker-local
~~~

## Limitaciones

- Paginación offset: consistencia dentro de una página; entre páginas puede haber
  desplazamientos si cambian estados.
- Sin Angular: la integración de UI es trabajo posterior.
- La serialización de la fecha usa `Z`, no `+00:00`, como el resto de respuestas del módulo.
- Los datos de prueba son sintéticos; no se accedió a Supabase.
