# S4.3 — Etapa C: backend académico

El backend consume la migración incremental S4.3 y está integrado con la interfaz
Angular. La implementación y las correcciones E03–E05 están validadas localmente;
no están acreditadas como desplegadas ni verificadas en Supabase real.

## Contratos

Todas las rutas requieren JWT del mecanismo existente. La cabecera de actor no
existe: `get_current_user_id` suministra `a`. Los cuerpos rechazan campos extra,
incluidos IDs de docente/evaluador/actor. `Idempotency-Key` es un UUID obligatorio
para mutaciones y se transmite sin regenerarlo entre reintentos.

| Método/ruta (prefijo /practicas/{id_practica}) | Contrato |
| --- | --- |
| GET /evaluaciones | Estado del informe, versión/documento vigente, evaluación pendiente, resultado vigente e historial con eventos |
| GET /evaluaciones/vigente | Mismo estado actual sin el listado histórico |
| POST /evaluaciones/inicio | `{ "id_documento": 10, "version": 1 }` e Idempotency-Key; devuelve evaluación |
| POST /evaluaciones/{id_evaluacion}/resolucion | `{ "resultado": "APROBADO", "observaciones": null }` o CON_OBSERVACIONES con texto obligatorio, e Idempotency-Key |

Observaciones: máximo 2000 caracteres ANTES de quitar espacios; se normalizan los
espacios Unicode como SQL. Sin notas numéricas ni rectificaciones. Motivos S4.1
aplican el mismo máximo; cierre EP07 mantiene su límite previo de 500 caracteres.
No se publican rutas Storage, hash, identificador de entrega o clave de resolución.
Los IDs de práctica, documento y evaluación sí forman parte del contrato académico.

DTOs de respuesta validan el resultado SQL antes de commit. Consulta reúne metadata
e historial dentro de la misma sesión/transacción y bajo el gate SQL de práctica.
El resultado vigente se filtra por documento Y versión; una aprobación histórica
no se presenta como aprobación del PDF actual. Las lecturas no necesitan Storage.

## Funciones y seguridad

Funciones SQL consumidas por el backend:

- `informes_privados.consultar(p,a)`
- `informes_privados.historial_evaluacion(p,a)`
- `informes_privados.iniciar_evaluacion(p,a,k,d,v)`
- `informes_privados.resolver_evaluacion(p,a,k,eid,res,obs)`
- `public.fn_cerrar_practica(id_practica,id_usuario,observacion)`

Las evaluaciones y el cierre usan `get_informe_db` y exclusivamente el login miembro
solo de `pl_s42_executor`, sin DML, CREATE, pertenencia a propietarios ni BYPASSRLS.
Se amplió el preflight para las firmas exactas S4.3, cierre y tablas académicas.
Falla cerrado con 503 si faltan migraciones/privilegios; no hay conexión alternativa.
`require_roles` reutiliza la conexión general únicamente para leer el contexto de
autorización; nunca ejecuta evaluaciones o cierre en ella. SQL revalida asignación,
rol activo, autoevaluación, versión y estado al modificar datos.

ADMINISTRADOR solo es rechazado. ADMINISTRADOR+DOCENTE puede evaluar si está asignado;
ADMINISTRADOR+GESTOR puede cerrar únicamente si es el responsable. Lecturas requieren
ESTUDIANTE propietario, DOCENTE asignado o GESTOR responsable, también en SQL.

Commit único por operación y rollback ante fallo, sin reintentos SQL automáticos.
SQL conserva claves, estado, eventos y notificaciones en su transacción. La API no
inserta notificaciones adicionales. Un commit ambiguo no se declara exitoso; el
cliente debe reintentar con la misma clave y cuerpo. No se borran objetos Storage.

## Errores y compatibilidad

- 400: datos nuevos de evaluación inválidos, resultado desconocido, observaciones
  vacías/excesivas, clave/versiones de entrada inválidas; SQLSTATE 22023/22001/22003.
- 401: bearer ausente/malformado, JWT inválido o expirado.
- 403: falta de rol o autorización SQL 42501, incluida pérdida de asignación.
- 404: P0404/recurso no disponible.
- 409: P0409, restricciones 23503/23505/23514, deadlock 40P01,
  serialización 40001 y lock timeout 55P03. Reconsultar y reintentar idempotentemente.
- 503: fallo desconocido, respuesta SQL incoherente o dependencia no disponible.

E04 incorpora `Cache-Control: no-store` en las respuestas exitosas y errores HTTP
controlados, incluidos los de validación, exclusivamente mediante `AcademicRoute`.
Conserva JSON, códigos y cabeceras como `WWW-Authenticate` y `Retry-After`; no cambia
la caché global ni los manejadores globales de errores inesperados.

Los mensajes son públicos y genéricos; no se devuelve el texto de PostgreSQL.
El manejo 400 de validación y OpenAPI es local al router nuevo. Validaciones de
esquemas anteriores (informes, cierre y asignación) conservan 422; sus errores SQL
nuevos sí se traducen. Por diseño de B, `docente_autorizado` combina autorización y
EN_CURSO: iniciar/resolver en una práctica finalizada puede producir 42501/403,
no 409. No se infiere el motivo desde mensajes privados ni se altera B para ocultarlo.

Cierre: conserva URL, cuerpo y JSON de éxito. Cambia el guard a GESTOR y la sesión
a la restringida. Push posterior usa, como antes, la conexión general de
notificaciones, separada de la transacción de cierre y sin volver a crear avisos.
No se amplían privilegios del ejecutor para Firebase. El envío es best effort;
las notificaciones persistidas son las de la transacción SQL.

S4.1: se añade traducción de conflicto/auto-evaluación y límite de motivo, y se
preservan errores de autorización tras una carrera en listado DOCENTE que antes
se convertían erróneamente a 503. No cambia el contrato HTTP ni la asignación SQL.

El único fixture antiguo adaptado es test_ep07_practicas: añade el override de la
nueva dependencia restringida y una cabecera bearer sintética (la identidad ya
estaba simulada). No se eliminan ni relajan aserciones. Las pruebas nuevas usan
sesiones de autorización y académicas distintas para verificar la separación.

## Validación local y reproducción

Tras E04: **29 pruebas focalizadas y 54 de regresión aprobadas**, con base y
proveedores simulados. La integración HTTP + PostgreSQL 18.6 también fue reportada
PASS; utiliza SQL real y JWT, pero Storage y push simulados. No acredita servicios remotos.
El registro consolidado, los 19 fallos históricos de la suite completa, E01/E02 y
los requisitos de despliegue están en [S43_EVALUACION.md](../../tests/integration/S43_EVALUACION.md).

Comandos ejecutados tras E04, desde `PracticaLink/backend`:

```bash
.venv/bin/python -B -m unittest tests.test_evaluaciones -v
.venv/bin/python -B -m unittest tests.test_evaluaciones_database tests.test_ep07_practicas tests.test_docentes tests.test_informes -v
```

Comandos para reproducir la suite completa y la integración HTTP:

```bash
.venv/bin/python -B -m unittest discover -s tests -v
.venv/bin/python -B tests/integration/run_evaluacion_backend.py --docker-local
```

La integración requiere dependencias locales e imagen `postgres:18.6` disponible.
Reutiliza LocalPostgres: red interna sin puertos, recursos aleatorios etiquetados y
limpieza solo de los que creó. Rechaza Docker remoto, no descarga imágenes ni acepta
URLs externas. Aísla variables y evita leer `.env`. Usa SQLAlchemy/psycopg y login
restringido reales; Storage es un diccionario simulado y push se sustituye.
No prueba Supabase Storage ni Firebase. TestClient emite una advertencia de deprecación
sobre httpx; E04 no cambió dependencias para resolverla.

Modo opcional para comprobar solo el SQL exacto del preflight, sin dependencias del proyecto:

```bash
python3 -B tests/integration/run_evaluacion_backend.py --docker-local --sql-preflight-only
```

Este modo extrae la consulta con AST y verifica aceptación del ejecutor y rechazo
ante DML, membresía de propietario y EXECUTE faltante. No acredita ORM, JWT ni HTTP.
Si faltan dependencias o permisos, informar; no instalarlos automáticamente.
E06 únicamente actualizó documentación y no repitió suites.

## Despliegue

Pendiente de autorización y verificación del destino: coordinar SQL, backend e
interfaz; configurar y verificar `INFORME_DATABASE_URL`, principal restringido,
ACL/RLS/EXECUTE y bucket privado S4.2. No usar una conexión administrativa como fallback.
Comprobar que el proxy preserve `Cache-Control: no-store`.
Nunca restaurar las funciones de cierre anteriores que omitan la evaluación aprobatoria.
