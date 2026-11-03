# HU016 WEB — gestión SQL de estados y consulta del historial

## Alcance y aplicación

Solo SQL, pruebas PostgreSQL y esta documentación. FastAPI/Angular HU016 pendientes.
No se cambia el POST/GET HU015, sus cuatro scripts ni los scripts EP04/EP05.
La integración Angular HU015 ya existe; las referencias a Angular pendiente en
BACK_CONTEXT.md y documentos de etapas SQL anteriores son históricas, no describen
el estado actual. Este incremento no modifica esos archivos.

Orden de aplicación, exclusivamente en entorno autorizado:
1. Esquema inicial, EP04 y EP05-01 a EP05-05.
2. EP06-01, EP06-02, EP06-03 y EP06-04 existentes.
3. ep06-05-permisos-estados-incidencias.sql.
4. ep06-06-cambiar-estado-incidencia.sql.
5. ep06-07-consultar-historial-incidencia.sql.

Scripts de aplicación única, con BEGIN/COMMIT, lock_timeout=5s y
statement_timeout=60s para la migración. Cada archivo es su propia transacción;
un fallo no revierte archivos anteriores confirmados. No reaplicar schema.sql
sobre una base existente. No se modifica ninguna fila histórica durante el DDL.
Se conserva la tabla, constraints, FK RESTRICT y triggers DELETE/TRUNCATE existentes.
No se agregan índices: PK incidencia y los índices EP06 de historial bastan.

El preflight comprueba dependencias, ejecutor, FK RESTRICT y triggers habilitados,
RLS, propiedad y privilegios efectivos de columnas/secuencias/esquema.
Los nuevos propietarios no pueden recibir CREATE por PUBLIC.
Un entorno incompatible aborta; no se corrigen automáticamente sus permisos.
El aprovisionamiento del login sigue siendo externo al script: hereda únicamente
pl_ep06_executor, nunca los roles propietarios. No se crean contraseñas.

## Cambio de estado

Firma real:

~~~sql
incidencias_privadas.fn_cambiar_estado_incidencia(
    p_id_practica BIGINT,
    p_id_incidencia BIGINT,
    p_id_usuario BIGINT,
    p_estado_esperado TEXT,
    p_estado_nuevo TEXT,
    p_comentario TEXT
) RETURNS JSONB
~~~

IDs de práctica e incidencia positivos; actor positivo y activo con rol activo
GESTOR o ADMINISTRADOR. SQL no valida JWT: p_id_usuario es una afirmación del
backend confiable y nunca debe provenir del body/query del cliente.
El actor se autoriza antes de revelar existencia de práctica/incidencia.
Los valores fuera del rango BIGINT fallan en el cast de PostgreSQL; el futuro
backend debe validar rango y tipos antes de invocar.

Matriz implementada:

| Actual | PENDIENTE | EN_ATENCION | RESUELTA |
|---|---|---|---|
| PENDIENTE | Rechazar | Permitir | Permitir, comentario obligatorio |
| EN_ATENCION | Rechazar | Rechazar | Permitir, comentario obligatorio |
| RESUELTA | Rechazar | Rechazar | Rechazar |
| Histórico incompatible | Rechazar | Rechazar | Rechazar |

El estado esperado se compara con la fila bloqueada. No sustituye el estado real.
Se permite gestionar incidencias modernas existentes en cualquier estado de
práctica, incluso FINALIZADA; no cambia la práctica ni permite nuevas altas allí.
La actividad del tipo o del autor original no impide actuar a otro gestor activo.

Comentarios: btrim, como EP04, elimina espacios U+0020 de borde; no elimina
arbitrariamente todo whitespace de borde. Si el resultado no contiene ningún
carácter distinto de whitespace, se convierte a NULL. EN_ATENCION admite NULL;
RESUELTA lo rechaza. Máximo 2000 caracteres PostgreSQL sobre el texto normalizado,
no bytes ni unidades UTF-16. Se conservan caracteres y espacios internos.

Respuesta de éxito (ejemplo sintético):

~~~json
{
  "id_incidencia": 42,
  "id_practica": 15,
  "id_historial": 91,
  "estado_anterior": "EN_ATENCION",
  "estado_nuevo": "RESUELTA",
  "id_usuario": 101,
  "comentario": "Situación resuelta.",
  "fecha": "2026-11-01T15:00:00+00:00"
}
~~~

id_usuario es el responsable de este cambio, no reemplaza al autor original.
Fecha TIMESTAMPTZ generada por clock_timestamp() tras los bloqueos, serializada
en UTC. La futura UI la presentará en America/Santiago.

## Historial e integridad

El estado/fecha de resolución y el evento se escriben en la misma transacción.
Se conserva el evento inicial NULL→PENDIENTE, los eventos previos y todos los
campos de creación de la incidencia. No se inventan eventos.

La comprobación recorre TODOS los eventos por id_historial ASC:
- Primer evento inicial PENDIENTE, autor y fecha iguales a los del registro.
- Continuidad exacta entre destino previo y origen siguiente.
- Cada salto permitido, sin segundo inicio, repetición, retroceso ni reapertura.
- Fechas finitas, no futuras y no decrecientes.
- Comentario con contenido en cualquier evento RESUELTA.
- Último estado coincidente con incidencia; no se acepta cadena vacía.
- Un origen abierto no puede tener fecha_resolucion ya asignada.

Los IDs expresan la secuencia de inserción; ordenar solo por fechas podría
ocultar alteraciones. La validación temporal adicional rechaza una cadena
con timestamps incompatibles. Una reversión del reloj incompatible con el último
evento se trata como HISTORIAL_INCONSISTENTE, sin inventar una fecha.

Se rechazan filas de tipo ausente, estado antiguo, descripción incompatible con
las reglas nuevas o fecha de creación infinita. No se basa toda la decisión
en sin_tipo_registrado. Las filas de aspecto moderno sin trazabilidad coherente
también se rechazan. No se clasifican, migran ni reparan históricos.

Al resolver, fecha_resolucion y fecha del evento usan exactamente el mismo instante.
El comentario/responsable quedan en el evento. La función GET HU015 ya los muestra;
no fue necesario cambiarla.

## Consulta completa del historial

~~~sql
incidencias_privadas.fn_consultar_historial_incidencia(
    p_id_practica BIGINT,
    p_id_incidencia BIGINT,
    p_id_usuario BIGINT,
    p_limit INTEGER DEFAULT 50,
    p_offset BIGINT DEFAULT 0
) RETURNS JSONB
~~~

GESTOR/ADMINISTRADOR activos, autorización antes de revelar existencia.
Comprueba práctica e incidencia asociadas. limit entre 1 y 100, offset >=0.
Obtiene limit+1 para hay_mas. Orden id_historial DESC, inverso de la secuencia real;
no reordena un histórico según fechas potencialmente incompatibles.

Respuesta: id_practica, id_incidencia, items, limit, offset, hay_mas.
Cada item contiene id_historial, id_usuario, estado_anterior nullable,
estado_nuevo, fecha y comentario nullable. No expone datos personales adicionales.
Sin eventos: items=[]; no inventa evento inicial ni trata el vacío como error.
Preserva datos existentes, sin validar reglas de creación ni normalizar comentarios.
STABLE: instantánea de la sentencia llamadora; funciona en transacción READ ONLY.
Offset no garantiza una vista inmutable entre solicitudes concurrentes.

## Errores y futura traducción HTTP

Errores de negocio: JSONB con única clave error. No hay escrituras parciales
antes de devolverlos. El llamador igualmente debe hacer rollback para liberar locks.

| Código | HTTP futuro propuesto |
|---|---|
| USUARIO_NO_AUTORIZADO | 403 |
| PRACTICA_NO_ENCONTRADA | 404 |
| INCIDENCIA_NO_ENCONTRADA | 404; también asociación incorrecta, sin revelar otra práctica |
| IDENTIFICADOR_INVALIDO | 422 |
| ESTADO_INVALIDO | 422 |
| COMENTARIO_INVALIDO | 422 |
| PAGINACION_INVALIDA | 422, solo consulta |
| INCIDENCIA_NO_GESTIONABLE | 409 |
| ESTADO_DESACTUALIZADO | 409 |
| TRANSICION_NO_PERMITIDA | 409 |
| HISTORIAL_INCONSISTENTE | 409 |

Fallo de UPDATE/INSERT suprimido: excepción P0001, CAMBIO_NO_CONFIRMADO o
HISTORIAL_NO_CONFIRMADO; futuro 500 genérico. Excepciones SQL se propagan para
rollback; nunca devolverlas literalmente al cliente.
40001 (serialización), 40P01 (deadlock), 55P03 (lock timeout): rollback completo,
futuro conflicto 409. Conexión indisponible: futuro 503.
No se ha implementado ninguno de esos endpoints HTTP en esta etapa.

## Permisos, concurrencia y rollback

pl_ep06_state_owner: NOLOGIN, NOINHERIT, NOSUPERUSER, NOBYPASSRLS y sin
administración. SELECT acotado; UPDATE solo estado/fecha_resolucion en incidencia;
INSERT de eventos con comentario. Sin UPDATE de historial ni DELETE/TRUNCATE.
En usuario/asignaciones/roles/práctica, UPDATE de una columna clave es necesario
para locks, pero políticas restrictivas WITH CHECK(false) impiden modificar filas.

pl_ep06_history_owner: propietario independiente de lectura, sin DML de escritura.
Ningún propietario funcional es dueño de las tablas. RLS tiene políticas dirigidas
a cada rol. Los permisos y políticas de HU015 permanecen intactos.

pl_ep06_executor conserva sus capacidades previas y recibe solo EXECUTE adicional.
Ningún SELECT, UPDATE, INSERT o acceso de secuencia directo. Historial usa identidad
GENERATED ALWAYS: no se requiere otorgar USAGE de su secuencia.
Ambas funciones son SECURITY DEFINER con search_path=pg_catalog,pg_temp,
referencias calificadas, sin SQL dinámico en la operación. PUBLIC y grants de
default privileges no previstos se revocan en las nuevas funciones. El CREATE
temporal para transferir propiedad se revoca dentro del mismo script.

Orden: actor FOR SHARE → asignaciones por id_rol FOR SHARE → roles por id_rol
FOR SHARE → práctica FOR UPDATE → incidencia FOR UPDATE.
Serializa también cambios distintos de una misma práctica: costo conservador
aceptado para mantener el orden existente y asociación estable.

READ COMMITTED relee después del bloqueo; el segundo gestor con estado esperado
viejo recibe ESTADO_DESACTUALIZADO. Otros aislamientos pueden abortar con 40001.
Los locks duran hasta commit/rollback externo. No hay commit ni retry interno.
Después de cualquier excepción, el backend debe revertir la transacción completa;
solo confirmar tras validar el JSON de éxito. Esto incluye fallos diferidos al commit.
No hay garantía de idempotencia ante respuesta perdida; consultar antes de repetir.

Los controles protegen roles funcionales. Una autoridad capaz de cambiar DDL,
desactivar RLS/triggers o asumir propietarios permanece fuera de ese límite.
No se propone rollback destructivo de migración: ante problemas posteriores,
retirar acceso al nuevo endpoint/capacidad bajo autorización y corregir hacia
adelante, conservando datos e historial.

## Reproducción y resultados reales

Desde la raíz, con imagen postgres:18.6 disponible, Docker local y venv existente:

~~~bash
PracticaLink/backend/.venv/bin/python -B   PracticaLink/backend/tests/integration/run_estado_incidencia.py --docker-local
~~~

Reutiliza el helper de aislamiento: socket Unix local, red interna, volumen y
contenedor exclusivos ep06-hu016- con sufijo aleatorio. No .env, Supabase ni
credenciales reales. Sin descargas ni instalaciones. Limpieza por propiedad exacta,
no por prefijo; verifica ausencia al finalizar.

Resultado de validación: 84/84 pruebas PostgreSQL 18.6:
- 28 HU016.
- 10 consulta HU015 y 16 registro HU015.
- 10 HU014 y 20 HU013; estas últimas incluyen inicio EP04.

Incluye matriz, autorización/roles inactivos, IDs inválidos incluso actor negativo
existente, comentarios Unicode, finalizadas, cadena completa/duplicada/incompleta,
conservación, DML denegado, RLS real, shadowing, lectura read-only y paginación.
El preflight también se ensaya con RLS/triggers desactivados y privilegios PUBLIC
de columna, secuencia y CREATE incompatibles; se verifica rollback de roles.
Se comparan datos y definiciones/ACL previas durante la aplicación.

Concurrencia observada mediante pg_blocking_pids: un gestor confirma y otro recibe
conflicto, sin duplicación. También se provocan 55P03, 40001 y un 40P01 real.
El deadlock usa una inversión deliberada de locks en transacciones de laboratorio,
no el orden de la función de producción. La víctima revierte y el ganador deja
un único evento. Fallos entre UPDATE e INSERT, INSERT suprimido, rollback explícito
y fallo diferido al commit no dejan estado ni historial parcial.

Durante desarrollo se corrigió una referencia ambigua en el nuevo script de
permisos, detectada antes de los tests funcionales. No se alteraron pruebas
históricas ni scripts anteriores para obtener resultados verdes.
No se ejecutó HTTP, Angular ni E2E HU016: aún no existen esas capas.
La validación local no acredita permisos/migraciones de despliegue Supabase.
