# EP06 — consulta persistente de incidencias

## Aplicación y seguridad

Aplicar `scripts/BD/fixes/ep06-04-consultar-incidencias.sql` después de EP06-01/02/03,
solo en un entorno autorizado. Script de aplicación única y transaccional;
lock_timeout 5 segundos y statement_timeout 60 segundos. No modifica filas,
restricciones, índices ni funciones existentes. Reutiliza el índice de incidencia
por práctica/fecha/ID y el índice de historial creados en EP06-01.

Conserva `pl_ep06_executor` como capacidad del login dedicado EP06: añade solo
EXECUTE sobre la consulta, sin SELECT directo ni permisos de escritura nuevos.
El ejecutor conserva su capacidad anterior de registrar incidencias; no se trata
de un login globalmente read-only. El futuro GET debe usar transacción read-only.
No se cambia ninguna conexión o configuración FastAPI en esta etapa.

Nuevo propietario `pl_ep06_read_owner`: NOLOGIN, NOSUPERUSER, NOBYPASSRLS, sin
membresía para el ejecutor ni propiedad de tablas. SELECT solo de las columnas
necesarias, políticas RLS específicas y comprobación de privilegios ambientales.
La migración aborta si falta RLS o hay accesos de tabla/columna incompatibles.
La función STABLE SECURITY DEFINER usa search_path pg_catalog,pg_temp y nombres
calificados. EXECUTE público y grants implícitos por default privileges se revocan
exclusivamente en la nueva función. No se amplían roles EP04/EP05 ni pl_ep06_owner.

## Firma y respuesta

```sql
incidencias_privadas.fn_consultar_incidencias(
    p_id_practica BIGINT,
    p_id_usuario BIGINT,
    p_limit INTEGER DEFAULT 50,
    p_offset BIGINT DEFAULT 0
) RETURNS JSONB
```

p_id_usuario es exclusivamente una afirmación del backend confiable obtenida del
JWT validado y contexto persistido; SQL no verifica JWT ni acepta identidad web
arbitraria. GESTOR o ADMINISTRADOR activos consultan todas las prácticas. El actor
se autoriza antes de comprobar existencia. No se exige EN_CURSO para lectura.
La actividad del autor original y del tipo no condiciona la visibilidad de la fila.

Orden: fecha DESC, id_incidencia DESC; limit 1–100, offset >= 0. Lee limit+1 para
hay_mas. Offset puede desplazarse si se insertan registros entre páginas.
Todas las consultas de la función STABLE comparten la instantánea de la sentencia;
no bloquea usuarios ni prácticas para garantizar prioridad a revocaciones concurrentes.

Ejemplo de respuesta (datos sintéticos):

```json
{
  "id_practica": 15,
  "items": [{
    "id_incidencia": 42,
    "id_practica": 15,
    "id_usuario": 101,
    "tipo": "SALUD",
    "descripcion": "Texto sintético",
    "estado": "PENDIENTE",
    "fecha": "2026-10-30T15:20:00+00:00",
    "sin_tipo_registrado": false,
    "fecha_resolucion": null,
    "resolucion": null
  }],
  "limit": 50,
  "offset": 0,
  "hay_mas": false
}
```

Sin registros: items=[] y hay_mas=false. Fecha y fecha_resolucion son los valores
TIMESTAMPTZ persistidos, serializados con TimeZone UTC, sin convertirlos a DATE.
Visualización futura en America/Santiago. No se devuelve prioridad, alertas,
correos, RUT ni otros datos personales adicionales. El autor se representa por ID.

Errores de negocio: objeto con única clave error y valor USUARIO_NO_AUTORIZADO,
PAGINACION_INVALIDA o PRACTICA_NO_ENCONTRADA. Fallos SQL no son colecciones vacías.
El futuro backend debe sanitizarlos; este incremento no define un endpoint HTTP.

## Históricos y resolución

- tipo=null y sin_tipo_registrado=true representan una fila sin tipo registrado,
  como los históricos anteriores a EP06. El indicador describe el dato ausente,
  no infiere una fecha de creación ni un origen que no está almacenado.
- estado mantiene literalmente ABIERTA/EN_REVISION/RESUELTA/CERRADA u otro valor
  persistido; no se reclasifica. Las descripciones vacías o extensas se conservan.
- fecha_resolucion se devuelve literalmente desde incidencia, incluso sin evento.
- resolucion es null si no existe evento RESUELTA. Si existe, es el último según
  fecha DESC,id_historial DESC y contiene id_historial,id_usuario,fecha,comentario.
  No se atribuye resolución al autor del alta. No se sintetizan comentarios.
- La fecha de la columna y la del evento se mantienen separadas: si fueran
  inconsistentes, la lectura no las corrige ni oculta. No se implementa HU016.
- No hay migración, limpieza o lectura de localStorage.

## Pruebas reproducibles

Desde la raíz, con Docker local, imagen postgres:18.6 ya descargada y venv existente:

```bash
PracticaLink/backend/.venv/bin/python -B PracticaLink/backend/tests/integration/run_consulta_incidencias.py --docker-local
```

Solo contenedor, red y volumen nuevos con nombre aleatorio y etiqueta de propiedad,
mediante el ciclo de vida existente de LocalPostgres. Sin .env, Supabase ni
credenciales reales. No descarga imágenes ni instala dependencias. Cierra conexiones
y elimina exclusivamente sus recursos también ante errores/SIGTERM. Ante SIGKILL
revisar solo candidatos enumerados, nunca limpiar recursos ajenos por prefijo.

Resultado de esta implementación: 56/56 pruebas PostgreSQL 18.6 aprobadas:
10 de consulta, 16 de registro HU015, 10 HU014 y 20 HU013 (incluido inicio EP04).
Se ensaya preflight con permisos/RLS incompatibles y rollback del bootstrap,
ACL de funciones anteriores intactas, autorización, paginación, aislamiento,
históricos finalizados, campos de resolución, autor/tipo inactivos, denegación de
acceso directo, RLS efectivo, shadowing temporal, zona horaria y transacción
read-only. Se comparan incidencia/historial/alerta/catálogo antes y después.

No se ejecutó HTTP ni navegador en esta etapa. La función necesita un futuro
endpoint GET y su integración Angular. Las pruebas locales no acreditan permisos
ni migraciones en Supabase.

Actualización posterior: GET FastAPI implementado en app/incidencias/ usando la
misma conexión restringida EP06 y una transacción read-only por consulta. Ver
HU015_HTTP.md para sus pruebas reales. La referencia anterior al endpoint futuro
corresponde al cierre de la etapa exclusivamente SQL; Angular sigue pendiente.
