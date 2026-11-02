# HU014 WEB — Persistencia de lectura

Implementación SQL sobre base `54502ae`, sin endpoint FastAPI ni cambios Angular.
Regla PMV aprobada: GESTOR y ADMINISTRADOR activos, con rol activo, consultan todas
las prácticas, incluidas finalizadas. ESTUDIANTE no accede; no hay asignaciones.

## Aplicación propuesta

Después de schema.sql (solo base vacía) y los tres scripts HU013, aplicar:

1. `scripts/BD/fixes/ep05-04-consultar-seguimientos.sql`.
2. `scripts/BD/fixes/ep05-05-indice-lectura-seguimientos.sql`.

El primero es de aplicación única y transaccional. Falla ante roles/función ya
existentes, RLS deshabilitada o privilegios ambientales incompatibles. No crea
logins ni contraseñas. El segundo omite un Btree válido equivalente, incluso
ASC/ASC con recorrido inverso. No admite como equivalente un índice parcial,
de expresiones, inválido o con direcciones mixtas en fecha/ID. CREATE INDEX normal
puede bloquear escritores: requiere planificación y autorización antes de aplicar
fuera del laboratorio. No es un despliegue automático ni una migración ejecutada
en Supabase.

## Contrato SQL real

```sql
seguimientos_privados.fn_consultar_seguimientos(
    p_id_practica BIGINT,
    p_id_usuario BIGINT,
    p_limit INTEGER DEFAULT 50,
    p_offset BIGINT DEFAULT 0
) RETURNS JSONB
```

Éxito: `id_practica`, `items`, `limit`, `offset`, `hay_mas`.
Cada item contiene exclusivamente `id_seguimiento`, `fecha`, `tipo`,
`observacion`, `responsable: {id_usuario, nombre}`. La fecha procede de DATE,
se serializa como fecha y no se convierte en timestamp. Orden:
`fecha_seguimiento DESC, id_seguimiento DESC`. Desempate por ID determinista,
no necesariamente por orden de commit.

Consulta limit+1 y devuelve hasta limit items. Límite 1–100, offset no negativo.
Una práctica existente vacía o una página posterior al último resultado devuelve
items=[] y hay_mas=false. Errores JSON:

- `USUARIO_NO_AUTORIZADO`: actor inexistente, nulo, inactivo o sin rol activo autorizado.
- `PAGINACION_INVALIDA`: limit/offset nulos o fuera de límites.
- `PRACTICA_NO_ENCONTRADA`: práctica no existente (también ID nulo).

Se autoriza antes de informar existencia o paginación. Errores de tipos/casts SQL
quedan fuera del contrato JSON; el futuro endpoint deberá validar parámetros.
No hay contrato HTTP implementado en esta etapa.

No se reutilizan validadores de creación: medio null o antiguo, observación vacía
o larga permanecen intactos. El esquema vigente impide observacion NULL; no se
relaja esa restricción para fabricar históricos. Se muestra el nombre actual del
responsable, incluso inactivo, sin correo/RUT/teléfono y sin filtrar por autor.

## Seguridad y consistencia

`pl_ep05_read_owner`: NOLOGIN, sin superusuario ni BYPASSRLS, con SELECT solo de
columnas necesarias de usuario, usuario_rol, rol, practica y seguimiento.
`pl_ep05_read_executor`: NOLOGIN, solo USAGE del esquema privado y EXECUTE de
la función. Un futuro login HTTP dedicado deberá heredar exclusivamente este
último, con atributos y grants efectivos auditados. No se amplían roles HU013.

Función SECURITY DEFINER con search_path `pg_catalog, pg_temp`, referencias
calificadas, ejecución PUBLIC revocada y limpieza de grants de default privileges.
Políticas SELECT específicas del propietario permiten las consultas internas;
la función aplica la autorización funcional. El ejecutor no obtiene SELECT directo.
RLS restrictiva adicional puede filtrar resultados: el despliegue deberá revisar
las políticas efectivas del entorno, no asumir que son las del laboratorio.

La identidad es una afirmación del backend de confianza. PostgreSQL revalida
usuario/roles, pero no valida JWT ni demuestra quién posee la sesión web. Nunca
exponer el ejecutor al navegador/Data API. El endpoint futuro deberá obtener el
actor exclusivamente del JWT validado, no de body/query.

STABLE utiliza la instantánea de la sentencia llamadora para autorización,
existencia y página, sin locks de actualización ni escrituras. Cambios concurrentes
posteriores no invalidan retroactivamente esa instantánea. Offset no garantiza
estabilidad entre páginas ante nuevas inserciones; offsets grandes pueden ser
costosos. No se añade contador total ni se presume rendimiento medido.

## Reproducción y resultados

Desde la raíz, con dependencias existentes e imagen local PostgreSQL 18.6:

```bash
PracticaLink/backend/.venv/bin/python -B \
  PracticaLink/backend/tests/integration/run_historial_seguimiento.py --docker-local
```

`--image` permite otra referencia local, pero se exige server_version_num=180006.
No descarga imágenes ni instala paquetes. Reutiliza el helper existente con
contenedor/red interna/volumen exclusivos `ep05-hu014-*`, identificados por nombre,
etiqueta y ID cuando corresponde. Sin puertos publicados, .env o URL externa.
La base interna conserva el nombre del helper ep04_integration, en contenedor nuevo.
Los históricos se insertan ANTES de instalar HU013, sin deshabilitar sus restricciones.

Resultado observado: **30/30 pruebas reales aprobadas** (10 HU014 y 20 HU013).
Antes de ejecutar se ensayan tres rechazos con rollback del bootstrap (RLS apagada,
SELECT de correo a PUBLIC y UPDATE de observaciones a PUBLIC). Se comparan filas,
definiciones y ACL de funciones HU013/EP04 antes/después del nuevo script.

Cobertura HU014: roles/actividad, autorización antes de existencia, límites y
defaults, finalizadas, vacío, separación por práctica, orden/desempate/paginación,
históricos, nombre actual/inactivo, privilegios efectivos, separación de capacidades,
search_path, transacción read-only, RLS restrictiva y reutilización del índice.
La suite HU013 se ejecuta DESPUÉS de instalar HU014: incluye locks, rollback,
conservación histórica, FK RESTRICT e inicio EP04 seguido de registro HU013.
Esto acredita los escenarios probados; no toda EP04 ni toda la aplicación WEB.

El intento dentro del sandbox no creó recursos; la ejecución autorizada fuera del
sandbox pasó y eliminó su contenedor, red y volumen. La limpieza verifica propiedad,
no utiliza prune ni modifica db_lab. SIGKILL o caída del daemon pueden requerir
limpieza manual de candidatos acreditados. Los errores omiten parámetros y trazas
para no revelar credenciales. Los tests no prueban Supabase ni permisos desplegados.
