# HU016 — cambio de estado e historial HTTP

## Endpoints y contratos

PATCH /practicas/{id_practica}/incidencias/{id_incidencia}/estado

~~~json
{
  "estado_esperado": "PENDIENTE",
  "estado_nuevo": "EN_ATENCION",
  "comentario": "  Se inició la revisión.  "
}
~~~

Respuesta 200, únicamente después del commit (ejemplo sintético):

~~~json
{
  "id_incidencia": 42,
  "id_practica": 15,
  "id_historial": 91,
  "estado_anterior": "PENDIENTE",
  "estado_nuevo": "EN_ATENCION",
  "id_usuario": 101,
  "comentario": "Se inició la revisión.",
  "fecha": "2026-11-01T15:00:00Z"
}
~~~

Estados conocidos: PENDIENTE, EN_ATENCION y RESUELTA. Solo se permiten
PENDIENTE→EN_ATENCION, PENDIENTE→RESUELTA y EN_ATENCION→RESUELTA.
Las repeticiones, retrocesos y reaperturas son conflictos SQL, no se convierten
en errores de enum del esquema. El estado esperado no sustituye la fila bloqueada.

Comentario opcional para EN_ATENCION, obligatorio con contenido para RESUELTA.
Se retiran espacios U+0020 de borde, según btrim; whitespace sin contenido se
normaliza a null. Máximo 2000 caracteres tras normalización, no bytes/UTF-16.
Se rechazan campos adicionales, actor, fecha y parámetros query del PATCH.
No se recibe fecha ni se genera localmente: proviene de PostgreSQL.

GET /practicas/{id_practica}/incidencias/{id_incidencia}/historial?limit=50&offset=0

~~~json
{
  "id_practica": 15,
  "id_incidencia": 42,
  "items": [
    {
      "id_historial": 91,
      "id_usuario": 101,
      "estado_anterior": "PENDIENTE",
      "estado_nuevo": "EN_ATENCION",
      "fecha": "2026-11-01T15:00:00Z",
      "comentario": "Se inició la revisión."
    },
    {
      "id_historial": 90,
      "id_usuario": 101,
      "estado_anterior": null,
      "estado_nuevo": "PENDIENTE",
      "fecha": "2026-11-01T14:00:00Z",
      "comentario": null
    }
  ],
  "limit": 50,
  "offset": 0,
  "hay_mas": false
}
~~~

IDs positivos BIGINT. limit=1..100, predeterminado 50; offset=0..BIGINT máximo,
predeterminado 0. Solo se aceptan limit/offset en query. Conserva id_historial DESC;
no ordena en Python. Rechaza un resultado SQL duplicado/desordenado como fallo interno.
Items vacío es éxito, nunca sustituto de un error. Estado anterior y comentario
pueden ser null; los estados históricos son texto libre y los comentarios no
tienen límite de creación. Se admiten timestamps históricos infinity/-infinity.
No se inventan eventos, autores ni comentarios.

## Seguridad y transacciones

Ambos endpoints reutilizan app/incidencias y exclusivamente INCIDENCIAS_DATABASE_URL
para su operación SQL. No se agregan variables, conexiones ni permisos.
El login existente debe heredar solo pl_ep06_executor y tener aplicados EP06-05,
EP06-06 y EP06-07. Ver HU016_ESTADOS.md para orden y contratos SQL.

La identidad se obtiene del JWT validado y se contrasta con el contexto persistido,
que contiene usuarios y roles activos. Solo GESTOR/ADMINISTRADOR, con alcance global.
La conexión principal se usa para autenticar el contexto según el patrón existente;
no se usa como fallback para cambiar estados o consultar eventos.
PostgreSQL repite la autorización y comprueba asociación práctica/incidencia.

PATCH llama fn_cambiar_estado_incidencia con parámetros vinculados. Valida esquema,
práctica, incidencia, actor, estado esperado/destino, comentario y transición devuelta
antes del commit. Ante cualquier error intenta rollback, sin exponer SQL y sin
reintentar la escritura. Un fallo de rollback no sustituye el error original.
Respeta íntegramente la atomicidad y los bloqueos SQL ya implementados.

GET ejecuta SET TRANSACTION READ ONLY antes de fn_consultar_historial_incidencia.
Valida identidad del recurso, paginación, cantidad, hay_mas y orden recibido.
No ejecuta commit. El cierre de sesión revierte la transacción de lectura y evita
dejar read-only como configuración permanente del pool.

Se pueden gestionar incidencias modernas existentes en prácticas finalizadas,
sin habilitar altas allí ni modificar la práctica. Los históricos incompatibles
continúan solo lectura. POST/GET HU015 y HU013/HU014 no cambian.

## HTTP y errores SQL

| Caso | HTTP |
|---|---|
| JWT inválido/expirado | 401 |
| Falta de autenticación | Conserva HTTPBearer existente: 401 o 403 según versión |
| USUARIO_NO_AUTORIZADO o contexto sin rol/identidad válida | 403 |
| PRACTICA_NO_ENCONTRADA, INCIDENCIA_NO_ENCONTRADA | 404 |
| ESTADO_DESACTUALIZADO, TRANSICION_NO_PERMITIDA | 409 PATCH |
| INCIDENCIA_NO_GESTIONABLE, HISTORIAL_INCONSISTENTE | 409 PATCH |
| SQLSTATE 40001, 40P01, 55P03 | 409 PATCH y rollback |
| IDENTIFICADOR_INVALIDO, ESTADO_INVALIDO, COMENTARIO_INVALIDO | 422 |
| PAGINACION_INVALIDA | 422 GET |
| Validación Pydantic, campos/query adicionales | 422 |
| Conexión requerida ausente/indisponible, SQLSTATE clase 08 | 503 |
| Resultado inesperado, SQL desconocido, otros fallos de commit | 500 |

Mensajes públicos genéricos, sin códigos SQL internos ni detalles de conexión.
Un código de conflicto de escritura inesperado en GET se trata como fallo 500.
El cliente debe consultar después de un resultado de escritura incierto;
no reenviar automáticamente.

## Pruebas y reproducción

Desde PracticaLink/backend:

~~~bash
.venv/bin/python -B -m unittest discover -s tests -v
~~~

Desde la raíz, con imagen postgres:18.6 ya disponible y Docker Unix local:

~~~bash
PracticaLink/backend/.venv/bin/python -B PracticaLink/backend/tests/integration/run_estado_incidencia_http.py --docker-local
~~~

El runner reutiliza el aislamiento y las suites existentes sin editarlas:
contenedor/red/volumen nuevos con propiedad verificada, sin descargas ni .env.
Primero ejecuta SQL; después TestClient con funciones PostgreSQL reales.
No hay overrides de los endpoints ni mocks de sus resultados SQL.
Solo se sustituye configuración de conexión del laboratorio. JWT sintéticos se
firman con un secreto efímero; la autorización consulta realmente PostgreSQL.
La conexión principal administrativa del helper pertenece únicamente al laboratorio;
la operación EP06 usa ep06_test_login sin DML directo, comprobado mediante la sesión.
No es una prueba E2E de navegador ni valida permisos de despliegue.

Resultado ejecutado:
- Backend: 304/304 (288 anteriores y 16 nuevas); mocks, sin servicios externos.
- SQL real: 84/84, incluida la suite HU016 y regresiones HU015/HU013/HU014/EP04.
- HTTP + PostgreSQL real: 35/35 (9 nuevas HU016 y 26 anteriores).
- Carrera HTTP: un 200 y un 409, un único evento adicional.
- Fallo entre UPDATE/INSERT y fallo diferido al commit: HTTP 500, estado e historial
  iguales a la instantánea previa desde conexión independiente.
- Roles activos/inactivos, finalizadas, históricos, asociación errónea, cadena
  incompleta, comentarios, paginación, GET sin efectos y pool reutilizable.
- Regresión HTTP incluye contexto EP03 e inicio EP04.
- Recursos Docker exclusivos eliminados al finalizar.

TestClient se detuvo en el sandbox y la suite se completó fuera de él con permiso.
Se observó la advertencia existente de deprecación Starlette/httpx; no se instalaron
ni actualizaron dependencias. No se ejecutó Angular ni navegador HU016.

## Límites

No se modificaron scripts SQL, Angular ni permisos. HU017 sigue fuera de alcance.
Continúan los límites de idempotencia, desplazamiento offset, BIGINT en JavaScript
y validación pendiente del despliegue. El historial completo HU016 aún no tiene
interfaz Angular. La publicación de estos endpoints requiere aplicar primero los
scripts HU016 en un entorno expresamente autorizado.
