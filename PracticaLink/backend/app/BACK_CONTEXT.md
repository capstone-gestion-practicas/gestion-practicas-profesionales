# Contexto de la aplicación backend

Este archivo entrega contexto técnico y funcional a desarrolladores y asistentes de IA que trabajen dentro de `backend/app`.

## Propósito

El backend de PracticaLink expone una API modular para autenticación, prácticas, revisiones, seguimientos, incidencias y notificaciones. FastAPI centraliza las rutas y los módulos organizan esquemas y servicios por responsabilidad. La persistencia usa PostgreSQL alojado en Supabase.

## Tecnologías y reglas generales

- Python 3.12.
- FastAPI.
- SQLAlchemy para conexión y ejecución de consultas.
- PostgreSQL en Supabase.
- Pydantic para validación de solicitudes y respuestas.
- JWT para autenticación.
- Bcrypt mediante `pwdlib` para contraseñas.
- Variables de entorno gestionadas con `pydantic-settings`.

No incorporar credenciales, URL reales de base de datos, contraseñas ni claves JWT en el código o en este documento.

## Estructura de `backend/app`

```text
app/
├── api/
│   └── routes/
│       ├── incidencias.py
│       └── notificaciones.py
├── auth/
├── empresas/
├── core/
├── estudiantes/
├── practicas/
├── revisiones/
├── schemas/
├── services/
└── usuarios/
├── BACK_CONTEXT.md
└── main.py
```

## Inicio de la aplicación

`main.py` crea la instancia de FastAPI, configura CORS, registra las rutas de autenticación y expone comprobaciones de estado.

Orígenes locales y de la aplicación Android permitidos actualmente:

- `http://localhost:4200`
- `http://127.0.0.1:4200`
- `http://localhost:8100`
- `http://127.0.0.1:8100`
- `http://localhost`
- `https://localhost`
- `capacitor://localhost`

Ejecución local desde `PracticaLink/backend`:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

## Configuración

`core/config.py` carga las siguientes variables desde `PracticaLink/backend/.env`:

- `SUPABASE_DATABASE_URL`
- `INICIO_PRACTICA_DATABASE_URL` (opcional al iniciar la aplicación; obligatoria
  al usar la conexión restringida de HU04.2)
- `SEGUIMIENTOS_DATABASE_URL` (conexión exclusiva de escritura HU013)
- `SEGUIMIENTOS_LECTURA_DATABASE_URL` (conexión exclusiva de lectura HU014)
- `JWT_SECRET_KEY`
- `JWT_ALGORITHM`
- `JWT_ACCESS_TOKEN_EXPIRE_MINUTES`
- `CHILE_RUT_EMPRESA_API_KEY`
- `CHILE_RUT_EMPRESA_API_URL`

El archivo `.env` es local y está ignorado por Git. La plantilla pública es `PracticaLink/backend/.env.template`.

## Base de datos

`core/database.py` crea el engine de SQLAlchemy y `SessionLocal`. La dependencia `get_db()` entrega una sesión por solicitud y garantiza su cierre.

El código usa SQL textual sobre PostgreSQL. Las consultas deben usar parámetros enlazados, nunca interpolación directa de valores.

`core/inicio_practica_database.py` ofrece `get_inicio_practica_db()` para HU04.2.
Su engine y fábrica de sesiones se inicializan al primer uso, de forma independiente
y sin fallback a `SessionLocal`. Requiere una URL `postgresql+psycopg` con host,
base y usuario distinto del principal. Solo admite los parámetros de URL
`sslmode`, `sslrootcert` y `connect_timeout`; la conexión usa timeout de 10 segundos.
La ausencia/configuración inválida o fallo de apertura devuelve HTTP 503 genérico,
sin URLs ni credenciales. La sesión se cierra siempre y no se confirma automáticamente.
Se utiliza en `PATCH /practicas/{id_practica}/estado`. El login dedicado y sus privilegios reales
deben aprovisionarse y verificarse por separado; una URL distinta no acredita permisos.

### Inicio de práctica (HU04.2)

`PATCH /practicas/{id_practica}/estado` admite únicamente `estado: "EN_CURSO"`
y `observacion` opcional (nula/vacía o hasta 500 caracteres después de quitar
espacios en los extremos, igual que el SQL). Rechaza campos adicionales.
GESTOR y ADMINISTRADOR se autorizan mediante el mecanismo existente, que consulta
el contexto en la conexión principal. La escritura usa exclusivamente la sesión
restringida y llama a `practicas_privadas.fn_iniciar_practica` con parámetros
vinculados y el identificador autenticado; no ejecuta escrituras directas.
El servicio valida el resultado antes del commit, hace rollback ante errores y
no reintenta. La función aplica APROBADA → EN_CURSO y la segunda barrera de roles.
La respuesta incluye práctica, estados anterior/nuevo, fecha, evento y mensaje.
Errores de negocio: 403/404/409/422; catálogo inválido o fallo inesperado: 500;
conexión restringida ausente o indisponible: 503. No se exponen errores SQL.
La integración desde FastAPI con PostgreSQL y el despliegue siguen pendientes;
las pruebas backend con mocks no acreditan privilegios ni atomicidad reales.

La actualización general de estado de una práctica se expone en
`PATCH /practicas/{id_practica}/estado/actualizacion`. Se mantiene
`PATCH /practicas/{id_practica}/estado` exclusivamente para el inicio restringido
de práctica (HU04.2), evitando colisiones entre contratos.

### Convención para inserciones

Las inserciones que forman parte de una operación de negocio deben realizarse
mediante funciones PostgreSQL almacenadas en la base de datos. Esto permite que
las validaciones, los `INSERT` relacionados y el registro de trazabilidad se
ejecuten dentro de una única transacción.

La división de responsabilidades es la siguiente:

- La ruta FastAPI autentica al usuario y exige los roles correspondientes.
- Los esquemas Pydantic validan tipos, campos obligatorios y reglas de formato.
- El servicio obtiene el identificador del usuario desde el JWT y llama a la
  función PostgreSQL mediante SQL textual parametrizado.
- La función PostgreSQL valida el estado persistido, ejecuta los `INSERT`
  relacionados y retorna un objeto `JSONB` con el resultado o un código de error
  de negocio.
- El servicio interpreta ese resultado, confirma la transacción con `commit()`
  o genera una excepción para que la ruta ejecute `rollback()` y responda con el
  código HTTP correspondiente.

Ejemplo de llamada desde un servicio:

```python
resultado = db.execute(
    text("""
        SELECT fn_operacion_negocio(
            :id_usuario,
            CAST(:datos AS JSONB)
        )
    """),
    {
        "id_usuario": id_usuario,
        "datos": datos.model_dump_json(),
    },
).scalar_one()
```

### Contrato de funciones PostgreSQL

Las funciones de negocio llamadas desde el backend deben respetar este formato:

```sql
CREATE OR REPLACE FUNCTION fn_nombre_operacion(
    p_id_usuario BIGINT,
    p_datos JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_id_resultado BIGINT;
BEGIN
    -- Validar nuevamente usuarios, roles, estados y relaciones persistidas.

    IF condicion_de_error THEN
        RETURN jsonb_build_object(
            'error', 'CODIGO_ERROR_ESTABLE'
        );
    END IF;

    -- Ejecutar todas las escrituras relacionadas dentro de la función.

    RETURN jsonb_build_object(
        'id_resultado', v_id_resultado,
        'mensaje', 'Operación realizada correctamente'
    );
END;
$$;
```

Convenciones del contrato:

- Los nombres comienzan con `fn_` y describen una operación de negocio.
- Los parámetros comienzan con `p_`; los valores internos comienzan con `v_`.
- Cuando existen varios datos de entrada se agrupan en un parámetro `JSONB`.
- Los identificadores de seguridad, como `p_id_usuario`, se envían por separado
  y siempre provienen del JWT validado por FastAPI.
- El tipo de retorno es `JSONB`, tanto para resultados correctos como para
  errores esperados de negocio.
- Un resultado correcto contiene los identificadores creados o modificados y
  puede incluir un `mensaje`.
- Un error esperado contiene `{"error": "CODIGO_ESTABLE"}` y no incluye
  mensajes internos de PostgreSQL.
- Los códigos de error se escriben en mayúsculas con guiones bajos y no deben
  cambiar una vez que el servicio dependa de ellos.
- Las restricciones de integridad inesperadas pueden propagarse como errores de
  PostgreSQL; la ruta debe ejecutar `rollback()` y responder sin filtrar detalles
  técnicos.
- `SET search_path = public` evita que la resolución de tablas dependa del
  contexto de conexión.
- Para evitar condiciones de carrera se debe bloquear la fila relevante con
  `SELECT ... FOR UPDATE` cuando dos solicitudes concurrentes puedan modificar
  el mismo proceso.

El servicio traduce el contrato de la función a excepciones de dominio:

```python
resultado = db.execute(
    text("""
        SELECT fn_nombre_operacion(
            :id_usuario,
            CAST(:datos AS JSONB)
        )
    """),
    {
        "id_usuario": id_usuario,
        "datos": datos.model_dump_json(),
    },
).scalar_one()

if resultado.get("error") == "CODIGO_ERROR_ESTABLE":
    raise OperacionNoPermitidaError

db.commit()
return resultado
```

La ruta captura la excepción de dominio, revierte la sesión y la convierte en
una respuesta HTTP:

```python
try:
    return ejecutar_operacion(db, id_usuario, datos)
except OperacionNoPermitidaError as error:
    db.rollback()
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="La operación no está permitida",
    ) from error
```

Las funciones no reemplazan las validaciones Pydantic ni la autorización de
FastAPI. La aplicación valida primero la solicitud y la base de datos vuelve a
validar las reglas que dependen del estado persistido.

Inventario actual:

| Función | Servicio | Responsabilidad |
| --- | --- | --- |
| `fn_registrar_usuario_estudiante` | `auth_service.py` | Crear la cuenta base con rol estudiante |
| `fn_contexto_usuario` | `auth_service.py` | Obtener usuario, roles, perfil y práctica actual |
| `fn_completar_perfil_estudiante` | `estudiantes/service.py` | Crear el perfil faltante de un estudiante |
| `fn_registrar_practica` | `practica_service.py` | Crear centro, práctica e historial inicial |
| `fn_revisar_practica` | `revisiones/service.py` | Resolver una solicitud y registrar su nuevo estado |
| `fn_crear_usuario_admin` | `usuarios/service.py` | Crear una cuenta y asignar roles desde el panel administrativo |
| `fn_actualizar_usuario_admin` | `usuarios/service.py` | Actualizar datos, estado y roles de una cuenta |
| `fn_obtener_empresa_cache` | `empresas/service.py` | Obtener antecedentes guardados y determinar su vigencia |
| `fn_guardar_empresa_cache` | `empresas/service.py` | Insertar o actualizar antecedentes tributarios por RUT |

Reglas obligatorias para nuevas inserciones:

- El identificador del usuario debe obtenerse del JWT, nunca del cuerpo enviado
  por el cliente.
- Todos los argumentos deben enviarse como parámetros enlazados.
- Una función de negocio debe completar toda la operación o no persistir ningún
  cambio.
- Los estados, perfiles y relaciones deben comprobarse nuevamente en la base de
  datos para evitar decisiones basadas solo en datos del frontend.
- Las funciones deben retornar códigos de error estables que el backend pueda
  traducir a respuestas HTTP sin exponer detalles internos de PostgreSQL.
- La definición de cada función debe quedar versionada en `scripts/BD/schema.sql`
  o en una migración SQL antes de que el backend comience a utilizarla.
- Los `SELECT` simples pueden permanecer en servicios; si su cantidad crece,
  deben trasladarse a una capa `repositories`.

Esta convención se aplica mediante servicios que llaman funciones como
`fn_registrar_usuario_estudiante`, `fn_completar_perfil_estudiante`,
`fn_registrar_practica` y `fn_revisar_practica`.

El esquema completo y las funciones utilizadas por el backend están versionados
en `scripts/BD/schema.sql`. El archivo `scripts/BD/user_roles.sql` conserva el
bloque inicial de usuarios y roles como referencia histórica.

Entre las tablas base se encuentran:

- `usuario`
- `rol`
- `usuario_rol`
- `empresa`

La consulta `GET /empresas/consulta/{rut}` implementa una estrategia cache-aside:
usa registros con menos de 30 días, consulta Chile RUT Empresa cuando no existen
o están vencidos y conserva datos antiguos como respaldo si el proveedor falla.

Las funciones de autenticación, contexto, perfil, registro y revisión están
versionadas en `scripts/BD/schema.sql`.

## Endpoints

### `GET /`

Comprueba que la API esté activa.

### `GET /health/database`

Comprueba la conexión con PostgreSQL y devuelve base, usuario y hora del servidor.

### `POST /auth/login`

Recibe:

```json
{
  "correo": "usuario@ejemplo.cl",
  "password": "contraseña"
}
```

Flujo:

1. Busca el correo en la tabla `usuario`.
2. Rechaza usuarios inexistentes o inactivos.
3. Verifica la contraseña contra `password_hash`.
4. Genera un JWT cuyo `sub` contiene `id_usuario`.
5. Devuelve `access_token` y `token_type`.

### `POST /auth/register`

Recibe nombre, apellido, correo y una contraseña de al menos 8 caracteres.

Flujo:

1. Normaliza el correo a minúsculas.
2. Rechaza correos ya registrados con `409 Conflict`.
3. Comprueba que exista el rol activo `ESTUDIANTE`.
4. Genera un hash Bcrypt de la contraseña.
5. Crea el usuario y su asignación de rol dentro de una transacción.
6. Devuelve los datos públicos del usuario con `201 Created`.

El registro no crea el perfil de estudiante. Si corresponde, RUT, carrera y
sede se incorporan posteriormente mediante `fn_completar_perfil_estudiante`.
El registro nunca devuelve ni almacena la contraseña en texto plano.

### `GET /auth/context`

Requiere el encabezado:

```text
Authorization: Bearer <token>
```

El backend valida el JWT, exige uno de los roles conocidos, obtiene `id_usuario` desde `sub` y ejecuta `fn_contexto_usuario(:id_usuario)`.

### `POST /practicas`

Requiere autenticación y rol `ESTUDIANTE`. Registra de forma transaccional el
centro de práctica, la práctica profesional y su primer historial con estado
`REGISTRADA`. El estudiante se obtiene desde el usuario autenticado; nunca se
acepta un `id_estudiante` enviado por el cliente.

El endpoint rechaza el registro cuando el usuario no posee perfil de estudiante
o ya tiene una práctica cuyo estado no es final. Si se informa el RUT de una
empresa existente, reutiliza ese centro en lugar de duplicarlo.

La operación se ejecuta en PostgreSQL mediante
`fn_registrar_practica(id_usuario, datos_jsonb)`. El servicio envía parámetros
enlazados, interpreta los errores de negocio retornados por la función y
confirma la transacción. La autorización y la obtención del usuario desde el
JWT permanecen en FastAPI.

### Revisión de prácticas (EP03)

Los endpoints bajo `/revisiones` requieren rol `GESTOR` o `ADMINISTRADOR`:

- `GET /revisiones/solicitudes`: lista solicitudes pendientes de revisión.
- `GET /revisiones/solicitudes/{id_practica}`: entrega los antecedentes del
  estudiante, centro y práctica.
- `PATCH /revisiones/solicitudes/{id_practica}`: aprueba, observa o rechaza la
  solicitud mediante `fn_revisar_practica` y registra la trazabilidad en
  `historial_estado`.

Las decisiones `OBSERVADA` y `RECHAZADA` requieren una observación.

### Gestión de usuarios (EP01)

Los endpoints bajo `/usuarios` requieren el rol `ADMINISTRADOR`:

- `GET /usuarios`: lista las cuentas con su estado y roles.
- `GET /usuarios/roles`: lista los roles activos disponibles.
- `POST /usuarios`: crea una cuenta mediante `fn_crear_usuario_admin`.
- `PATCH /usuarios/{id_usuario}`: actualiza nombre, apellido, estado y roles
  mediante `fn_actualizar_usuario_admin`.

El identificador del administrador proviene siempre del JWT. Las funciones
vuelven a validar en PostgreSQL que la cuenta esté activa y posea el rol
`ADMINISTRADOR`. Un administrador no puede desactivar su propia cuenta ni
quitarse su propio rol administrativo.

El módulo se organiza en `usuarios/routes.py`, `usuarios/schemas.py` y
`usuarios/service.py`. Deuda técnica conservada: el resultado SQL
`ADMIN_NO_VALIDO` no tiene traducción explícita en el servicio; actualmente se
ejecuta commit y la validación de la respuesta produce HTTP 500. Las pruebas de
caracterización protegen este comportamiento hasta una corrección autorizada.

## Contexto del usuario

La respuesta está definida por `ContextoUsuarioResponse` en `schemas/auth.py`:

```text
ContextoUsuarioResponse
├── usuario
│   ├── id_usuario
│   ├── nombre
│   ├── apellido
│   └── correo
├── roles[]
├── perfil (opcional)
│   ├── id_estudiante
│   ├── rut
│   ├── carrera
│   └── sede
└── practica_actual (opcional)
    ├── id_practica
    ├── estado
    ├── centro_practica
    ├── fecha_inicio
    ├── fecha_termino
    ├── horas
    └── cargo_funcion
```

Los modelos del frontend en `frontend/src/app/core/models/auth.models.ts` deben mantenerse sincronizados con estos esquemas.

## Seguridad

`core/security.py` es responsable de:

- Crear hashes Bcrypt.
- Verificar contraseñas.
- Crear tokens JWT con expiración.
- Validar tokens enviados mediante HTTP Bearer.
- Extraer y validar `id_usuario` desde el claim `sub`.

Reglas obligatorias:

- Nunca guardar contraseñas en texto plano.
- Nunca registrar tokens, contraseñas o secretos en logs.
- No exponer `password_hash` en respuestas.
- Mantener consultas parametrizadas.
- Proteger mediante dependencia de autenticación todo endpoint privado.
- No aceptar el algoritmo JWT desde el contenido del token; usar el configurado por el servidor.

## Responsabilidad de cada pieza

- `main.py`: inicialización, middleware, routers y health checks.
- `api/routes/auth.py`: capa HTTP de autenticación.
- `schemas/auth.py`: contratos Pydantic de entrada y salida.
- `services/auth_service.py`: consultas y lógica de autenticación/contexto.
- `core/security.py`: hashing y JWT.
- `core/permissions.py`: autorización reutilizable de endpoints por roles activos.
- `core/database.py`: engine, sesiones y dependencia de base de datos.
- `core/config.py`: configuración proveniente del entorno.

## Criterios para cambios futuros

- Mantener las rutas delgadas; colocar lógica de negocio en servicios.
- Definir modelos Pydantic explícitos para entradas y respuestas públicas.
- Mantener sincronizados backend, frontend y funciones SQL.
- Usar códigos HTTP adecuados y mensajes que no filtren detalles sensibles.
- Añadir pruebas para autenticación, autorización y respuestas de error.
- Actualizar este archivo cuando cambien endpoints, modelos o arquitectura.

## Pruebas unitarias

Desde `PracticaLink/backend`:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

Las pruebas actuales validan permisos concedidos y denegados, normalización de roles, registro exitoso, correo duplicado y configuración de rol inválida.

## Estado actual y límites conocidos

- No hay migraciones versionadas ni un mecanismo automático para crear todo el esquema.
- La función `fn_contexto_usuario` debe existir previamente en Supabase.
- No existe renovación de tokens.
- No existe revocación ni lista de tokens invalidados.
- CORS está configurado solamente para el frontend local.
- La lógica actual cubre autenticación y consulta de contexto; los demás módulos del dominio aún deben implementarse.

### Fecha del último cambio de estado (HU04.1)

`GET /practicas/me` incluye `fecha_ultimo_cambio_estado`: fecha ISO 8601 o
`null` si no existe historial. La lectura obtiene el último evento de la práctica
propia por `fecha_cambio DESC, id_historial DESC`, sin usar `fecha_actualizacion`.
El frontend presenta `dd/MM/yyyy, HH:mm` en la zona `America/Santiago`,
respetando el horario de verano, y muestra «Fecha no disponible» para `null`.
El valor ISO de la API permanece sin cambios. No modifica `/auth/context` ni las transiciones de estados.


### EP04 / HU04.1: listado general de prácticas

`GET /practicas` permite a GESTOR y ADMINISTRADOR consultar prácticas de
cualquier estado, incluidas las históricas y finales. No modifica EP03 ni
`GET /practicas/me`.

Parámetros: `rut` opcional, `limit` (1–100, por defecto 50) y `offset`
(>= 0, por defecto 0). El RUT debe tener 7–8 dígitos, guion y verificador
numérico o K/k, sin puntos. Se reutiliza `normalizar_rut` para validar módulo 11
y convertir al formato con puntos y K mayúscula que guarda el alta de estudiantes.
La comparación parametrizada `e.rut = :rut` conserva la columna sin funciones
para permitir el índice único. No se verificaron formatos de datos cargados por
fuera del alta actual ni los datos de Supabase.

La respuesta contiene `items`, `limit`, `offset` y `hay_mas`. Cada item incluye
`id_practica`, `estudiante` (`id_estudiante`, `nombre`), `centro_practica` (nombre),
`fecha_registro`, `estado` (`id_estado`, `nombre`, `es_final`) y
`fecha_ultimo_cambio_estado` (ISO 8601 o null). No expone RUT ni correo.

La consulta ordena por `fecha_registro DESC, id_practica DESC`, solicita una fila
extra y obtiene la última fecha de historial mediante una subconsulta ordenada
por `fecha_cambio DESC, id_historial DESC`. No hace consultas por item desde
Python ni escrituras. Un filtro válido sin coincidencias devuelve 200 y lista
vacía; formato, verificador o paginación inválidos devuelven 422.

El endpoint no registra el RUT. Antes del despliegue debe verificarse que los
logs de acceso, proxy y observabilidad omitan o redacten el parámetro `rut`:
la URL contiene el dato por el contrato GET aprobado. La paginación offset puede
desplazarse ante inserciones concurrentes; no garantiza una instantánea entre
peticiones. Las pruebas con mocks no acreditan rendimiento o ejecución SQL real.


### EP04 / HU04.1: detalle general de gestión

`GET /practicas/{id_practica}` permite consultar una práctica seleccionada en
cualquier estado, incluidas históricas y finales, a GESTOR y ADMINISTRADOR.
La ruta dinámica se registra después de `/practicas/me`, cuyo contrato no cambia.
Usa `PracticaDetalleGestionResponse`, independiente del detalle del estudiante.

La respuesta contiene id_practica, estudiante (id_estudiante y nombre),
centro_practica (id_centro y nombre), fecha_registro, estado (id_estado, nombre y
es_final), fecha_ultimo_cambio_estado y los antecedentes nullable fecha_inicio,
fecha_termino, horas, cargo_funcion y descripcion. No incorpora RUT, correo,
teléfono ni contactos. Fechas y timestamps conservan serialización ISO 8601.

El identificador debe estar entre 1 y 9223372036854775807; valores inválidos
producen 422. Un usuario autenticado sin rol permitido recibe 403 antes de la
consulta de datos. Una práctica inexistente devuelve 404 con detalle
"La práctica no existe". Se conserva la autenticación existente.

El servicio ejecuta un SELECT parametrizado por id_practica, lee el estado de
practica.id_estado_actual y obtiene la fecha de historial ordenando por
fecha_cambio DESC, id_historial DESC; sin historial devuelve null. No escribe,
no corrige inconsistencias ni invoca funciones SQL de escritura. Las pruebas
con mocks no validan la ejecución SQL ni la consistencia de datos reales.


### EP04 / HU04.3: historial de estados para gestión

`GET /practicas/{id_practica}/historial` permite lectura a GESTOR y ADMINISTRADOR;
ESTUDIANTE recibe 403. No cambia permisos ni contratos de otros endpoints.
El identificador debe estar entre 1 y 9223372036854775807. Acepta limit de 1 a
100 (50 predeterminado), y offset >= 0 (0 predeterminado). Entradas inválidas:
422. Práctica inexistente: 404, "La práctica no existe". Práctica existente sin
eventos: 200 con items vacío. La autenticación conserva el comportamiento actual.

HistorialPracticaResponse contiene id_practica, items, limit, offset y hay_mas.
Cada evento incluye id_historial, estado_anterior nullable y estado_nuevo
(id_estado, nombre), fecha_cambio ISO 8601, responsable (id_usuario, nombre)
y observacion nullable. No añade RUT, correo, teléfono ni roles del responsable.
Las observaciones se devuelven tal como están registradas, sin fabricar textos.

El servicio hace dos SELECT parametrizados: existencia de la práctica y eventos.
LAG(id_estado) se calcula sobre todos los eventos de la práctica en una CTE,
ordenados por fecha_cambio ASC, id_historial ASC, antes de paginar con limit + 1.
El primer evento disponible tiene estado_anterior null; no se interpreta como
registro inicial ni se infieren eventos faltantes. Se preservan estados repetidos.
Se muestran nombres actuales del catálogo y del usuario, incluso si están inactivos.

La consulta no escribe ni corrige discrepancias con el estado actual. Los mocks
no acreditan ejecución SQL real, integridad o rendimiento de PostgreSQL. No se
verificaron datos reales ni índices. La comprobación de existencia y la lectura
del historial son dos sentencias: no garantizan una instantánea conjunta bajo
el aislamiento predeterminado si hay cambios concurrentes. Las observaciones
pueden contener información sensible preexistente; no deben registrarse en logs.

### EP05 / HU013: registro de seguimientos WEB

`POST /practicas/{id_practica}/seguimientos` está organizado en
`app/seguimientos/{routes,schemas,service}.py`. Autoriza GESTOR y ADMINISTRADOR
mediante el JWT y el contexto existente, cuya función SQL filtra usuarios y
roles activos. Comprueba que el usuario del contexto coincide con el JWT.
La función de escritura revalida actividad y roles bajo bloqueo.

El cuerpo admite exclusivamente `fecha` (YYYY-MM-DD, no futura según
America/Santiago), `tipo` y `observacion` (texto obligatorio, máximo 2000
caracteres, conservando espacios). Los medios son Reunión presencial,
Videollamada, Llamada telefónica, Correo electrónico y Otro. No admite campos
adicionales ni parámetros query; el autor procede exclusivamente del JWT.
El identificador de práctica debe ser positivo y caber en BIGINT.

Responde 201 con `id_seguimiento`, `id_practica`, `id_usuario`, `fecha`, `tipo`,
`observacion` y `fecha_creacion` con zona horaria. Conserva los errores de
autenticación existentes. Permisos insuficientes: 403; práctica inexistente:
404; estado distinto de EN_CURSO o conflicto concurrente: 409; entrada inválida:
422; resultado inesperado o registro no confirmado: 500; conexión o verificación
de permisos no disponible: 503. Los mensajes no contienen errores del driver.
No hay endpoints de modificación ni eliminación en este módulo.

Requiere los scripts EP05 ya versionados y `SEGUIMIENTOS_DATABASE_URL` configurada
de forma privada con un login dedicado que herede `pl_ep05_executor`, sin
privilegios directos sobre tablas, superusuario ni BYPASSRLS, ni membresías
adicionales. No usar `pl_ep05_owner`, el login principal ni el de EP04.
La aplicación rechaza URLs incompatibles y logins compartidos con esas dos
conexiones; esto no verifica los privilegios efectivos del servidor. Su
aprovisionamiento y auditoría corresponden a una operación separada autorizada.
Sin configuración, este endpoint falla con 503 y no utiliza otra conexión.

El servicio ejecuta una sola llamada parametrizada a
`seguimientos_privados.fn_registrar_seguimiento`. Valida la estructura y la
correspondencia del resultado con práctica, autor y datos enviados antes del
commit. Un error de negocio, respuesta malformada o fallo SQL produce rollback;
un fallo del rollback conserva el error original. No hay reintentos automáticos,
incluido un fallo durante commit cuyo resultado pueda ser incierto. Ante 500/503
el cliente no debe reenviar automáticamente: no se implementa idempotencia.
Los bloqueos y la comprobación atómica de EN_CURSO permanecen en PostgreSQL.
La dependencia SQL incluye usuario, usuario_rol, rol, practica, estado_practica
y seguimiento; la separación modular no elimina este acoplamiento.

Las pruebas `test_seguimientos_{routes,schemas,service,database}.py` verifican
JWT, permisos, contratos, rollback, respuesta antes de commit, errores de
concurrencia y aislamiento de conexión mediante mocks. No acreditan ejecución
del endpoint con PostgreSQL real ni permisos de un entorno desplegado.
Nota histórica: al cerrar la etapa backend HU013, Angular estaba pendiente;
actualmente HU013 y HU014 están integradas en Angular. No se migran demostraciones.

### EP05 / HU014: consulta HTTP del historial de seguimientos

`GET /practicas/{id_practica}/seguimientos?limit=50&offset=0` amplía el módulo
seguimientos. JWT y contexto deben coincidir; usuario activo GESTOR o ADMINISTRADOR
accede a todas las prácticas según el PMV, incluidas finalizadas. SQL revalida
actividad y roles. ESTUDIANTE queda excluido. Solo admite query limit/offset,
no identidad externa. No modifica la dependencia ni el POST HU013.

La respuesta 200 contiene id_practica, items, limit, offset, hay_mas. Cada item:
id_seguimiento, fecha DATE, tipo nullable/libre, observacion sin restricciones de
creación y responsable {id_usuario,nombre}. Conserva el orden SQL y los valores
históricos, incluso autor actualmente inactivo. No expone otros datos personales.
Identificadores positivos BIGINT; limit 1–100, offset 0–BIGINT máximo. No se
convierten fechas a timestamp ni se reordenan resultados en Python.

Requiere `SEGUIMIENTOS_LECTURA_DATABASE_URL` privada con login dedicado que herede
solo pl_ep05_read_executor. Configuración opcional al arrancar, necesaria al usar
GET. La conexión independiente rechaza compartir usuario con principal, EP04 o
HU013, no tiene fallback y activa transacciones PostgreSQL read-only. La validación
de URL no sustituye auditar los privilegios efectivos del login en el despliegue.
No se provisionan credenciales ni grants desde FastAPI.

El servicio invoca exclusivamente fn_consultar_seguimientos con parámetros
vinculados. Valida respuesta y correspondencia de práctica/paginación antes de
retornar. No hace commit; el cierre termina la lectura. Ante error intenta rollback
sin sustituir el error original. No registra resultados, parámetros ni errores SQL.
Errores JSON USUARIO_NO_AUTORIZADO/PRACTICA_NO_ENCONTRADA/PAGINACION_INVALIDA se
traducen a 403/404/422; autenticación conserva el comportamiento existente.
Conexión ausente/indisponible: 503; error SQL o respuesta inesperada: 500 genérico.

Validación de esta etapa: 247/247 unitarias, 30/30 SQL y 15/15 HTTP sobre PostgreSQL
18.6 exclusivo. Incluye POST→GET, transacción read-only, SELECT directo rechazado,
históricos, ausencia de fallback y regresión HU013/EP03/EP04 en escenarios existentes.
Ver tests/integration/HU014_HTTP.md. No acredita permisos de Supabase ni despliegue.
La consulta Angular HU014 y el registro Angular HU013 están implementados.
Las referencias anteriores a integración pendiente corresponden a etapas históricas.


### EP05: operación vigente y límites

El orden de aplicación es ep05-01, ep05-02, ep05-03, ep05-04 y ep05-05, según
[DOCUMENTACION_INSTALACION.md](../../../DOCUMENTACION_INSTALACION.md). Esa guía
identifica los ejecutores separados, la comprobación de privilegios efectivos y
los riesgos de aplicación parcial/bloqueos. Sin URL específica, el endpoint afectado
responde 503; no utiliza otra conexión. Las pruebas locales no validan migraciones
ni privilegios del despliegue. Permanecen sin idempotencia las escrituras con respuesta
HTTP perdida; offset puede desplazarse por inserciones y los BIGINT representados
como number en JavaScript pierden precisión fuera del rango seguro ±(2^53−1).


### EP06 / HU015: registro HTTP de incidencias

`POST /practicas/{id_practica}/incidencias`, módulo `app/incidencias/`.
Recibe exclusivamente `tipo` (ABANDONO, PROBLEMA_CENTRO, SALUD u OTRO) y
`descripcion` (contenido obligatorio, hasta 2000 caracteres, espacios conservados).
Rechaza campos adicionales y parámetros query. Identificador de práctica positivo BIGINT.
Autor exclusivamente del JWT validado, contrastado con el contexto persistido:
GESTOR/ADMINISTRADOR activos, sin asignaciones territoriales en este PMV.
PostgreSQL revalida usuario, rol, tipo activo y práctica EN_CURSO bajo bloqueo.

Requiere `INCIDENCIAS_DATABASE_URL`, login exclusivo que herede únicamente
`pl_ep06_executor`, sin privilegios directos ni membresía en `pl_ep06_owner`.
No puede reutilizar el usuario principal ni los configurados para EP04/HU013/HU014.
Inicialización perezosa, sin fallback; configuración ausente/inválida o conexión
indisponible devuelve 503. Validar la URL no acredita los privilegios efectivos:
el aprovisionamiento y su auditoría se realizan separadamente en un entorno autorizado.
No se crean permisos ni logins desde FastAPI.

Invoca solamente `incidencias_privadas.fn_registrar_incidencia(bigint,bigint,text,text)`.
Valida el JSONB y correspondencia de práctica/autor/tipo/descripción antes del commit.
Devuelve 201 después de confirmar: id_incidencia, id_practica, id_usuario, tipo,
descripcion, estado PENDIENTE y fecha con zona horaria asignada por PostgreSQL.
La fecha se muestra posteriormente en America/Santiago; no se acepta desde el cliente.
La incidencia y su historial inicial se insertan atómicamente en SQL.

Errores: autenticación existente; 403 autorización; 404 práctica inexistente;
409 práctica no EN_CURSO o conflicto concurrente; 422 entrada inválida;
503 indisponibilidad; 500 fallo inesperado. No se exponen mensajes SQL ni
parámetros. Se intenta rollback, preservando el error original. No se reintenta
la escritura, incluso si falla el commit y su resultado es incierto.
No hay idempotencia ni integración Angular EP06 en este incremento.

Orden SQL previo: EP04, EP05-01 a EP05-05, EP06-01 a EP06-03; ver
`tests/integration/HU015_PERSISTENCIA.md` y `tests/integration/HU015_HTTP.md`.
Los scripts validados no se modifican en esta implementación backend.

### EP06 / HU015: consulta HTTP de incidencias

`GET /practicas/{id_practica}/incidencias?limit=50&offset=0` reutiliza
`app/incidencias/` y la conexión `INCIDENCIAS_DATABASE_URL`. Requiere EP06-04
además de los tres scripts de registro. No amplía permisos ni ejecuta migraciones.

GESTOR/ADMINISTRADOR activos se autorizan mediante JWT y contexto confiable antes
de consultar; PostgreSQL repite la autorización. Identidad nunca desde query/body.
Parámetros: id positivo BIGINT, limit 1–100 (50), offset 0–BIGINT máximo (0).
Solo se admiten parámetros query limit y offset. POST conserva su contrato cerrado.

El servicio activa SET TRANSACTION READ ONLY en una sesión nueva antes de llamar
exclusivamente a fn_consultar_incidencias con parámetros vinculados. No hace commit,
no reintenta ni utiliza fallback; el cierre de sesión revierte la transacción y
restablece el uso normal del pool para POST. El login mantiene EXECUTE de alta y
consulta, pero no SELECT directo: read-only se aplica a la transacción GET, no a
la conexión global. Los permisos reales requieren auditoría en despliegue.

Respuesta: id_practica, items, limit, offset, hay_mas. Cada item conserva
id_incidencia, id_practica, id_usuario, tipo nullable, descripcion sin límite de
creación, estado libre, fecha, sin_tipo_registrado, fecha_resolucion nullable y
resolucion nullable (id_historial, id_usuario, fecha, comentario nullable).
Los esquemas históricos son independientes del alta. No inventan tipos ni datos
de resolución, no traducen estados antiguos ni excluyen prácticas finalizadas.
Se conservan timestamps con zona y los literales PostgreSQL infinity/-infinity.
El servicio comprueba práctica/paginación y la práctica de cada item antes de
responder. Conserva el orden SQL fecha DESC,id_incidencia DESC y hay_mas.
Offset no garantiza estabilidad entre páginas ante inserciones concurrentes.

Errores SQL de negocio: USUARIO_NO_AUTORIZADO→403, PRACTICA_NO_ENCONTRADA→404,
PAGINACION_INVALIDA→422. Conexión requerida ausente/indisponible→503;
JSON inesperado, SQL desconocido u otro fallo→500 genérico. Autenticación conserva
su comportamiento existente. Rollback se intenta sin sustituir el error original.
Una colección vacía solo representa una consulta exitosa, nunca un error.

Ver tests/integration/HU015_HTTP.md para reproducción del GET y regresión POST,
EP04 y EP05. Esta referencia corresponde al cierre de la etapa backend de HU015;
la integración Angular y su validación E2E fueron completadas posteriormente.

### EP06 / HU016: gestión HTTP de estados e historial (vigente)

HU015 ya cuenta con integración Angular y E2E local; las referencias anteriores
a Angular pendiente describen cierres de etapas previas.

Integración con develop (merge 4819a5f): el router legado conserva solo
GET /incidencias (consulta). Se retiraron del API público POST
/practicas/{id}/incidencias (legado, sustituido por el contrato EP06) y
PATCH /incidencias/{id}/estado (cambio de estado sin historial HU016). El
handler y su schema/servicio legado permanecen en el código sin registrar;
`fn_actualizar_estado_incidencia` no se modificó en SQL.

Se incorporan PATCH /practicas/{id_practica}/incidencias/{id_incidencia}/estado
y GET /practicas/{id_practica}/incidencias/{id_incidencia}/historial.
Reutilizan app/incidencias y la conexión restringida INCIDENCIAS_DATABASE_URL,
sin fallback. Requieren EP06-05/06/07; no aplican migraciones automáticamente.

PATCH recibe estado_esperado, estado_nuevo y comentario opcional, sin campos extra.
Comentario normalizado con espacios de borde U+0020, máximo 2000 caracteres;
RESUELTA exige contenido. Autor exclusivamente JWT/contexto, roles activos
GESTOR/ADMINISTRADOR; PostgreSQL repite autorización y controla la cadena,
asociación, estado esperado y transiciones. Permite incidencias modernas de
prácticas finalizadas; históricos incompatibles permanecen solo lectura.
Valida resultado antes del commit y solo entonces devuelve 200. Rollback ante
errores; sin reintentos. Conflictos SQL/estado/historial devuelven 409.

GET limita 1..100 (default 50), offset >=0 y conserva id_historial DESC.
Transacción READ ONLY, sin commit. Conserva estados textuales, comentario/origen
null, comentarios extensos y fechas históricas; no inventa eventos.
Respuesta: id_practica, id_incidencia, items, limit, offset, hay_mas.
Cada evento expone id_historial, id_usuario, estado_anterior, estado_nuevo,
fecha y comentario. No se agregan datos personales.

Ver tests/integration/HU016_HTTP.md para contratos, errores, ejemplos,
reproducción, resultados y límites. Validación de la etapa backend: backend
304/304 con mocks, SQL PostgreSQL 84/84 y HTTP + PostgreSQL 35/35 en Docker
exclusivo. La integración Angular de HU016 fue completada posteriormente y el
flujo E2E real quedó validado 91/91.

### EP06 / HU017: resumen HTTP de prácticas con incidencias pendientes (vigente)

GET /practicas/con-incidencias-pendientes?limit=50&offset=0 devuelve prácticas con al
menos una incidencia `PENDIENTE` o `EN_ATENCION` (corrección DEFECTO-001, EP06-09),
con `pendientes`, `en_atencion` (contadores independientes), `fecha_pendiente_antigua`
(null si `pendientes = 0`), `limit`, `offset` y `hay_mas`. Orden: primero las prácticas
con pendientes por fecha ascendente; después las solo EN_ATENCION; desempate por
id_practica. Una fila con ambos contadores en 0 se rechaza como incoherente.
Usa `fn_resumen_incidencias_pendientes` mediante
la conexión restringida INCIDENCIAS_DATABASE_URL, sin fallback; la conexión principal
solo valida roles. Solo GESTOR y ADMINISTRADOR activos; ESTUDIANTE e inactivos 403.
Transacción READ ONLY, una sola llamada, sin commit ni reintentos. Históricos
(ABIERTA, EN_REVISION, CERRADA) no cuentan como pendientes.

`app/main.py` incluye `incidencias_router` antes que `practicas_router`: sin ese orden,
`GET /practicas/{id_practica}` capturaba la ruta nueva y respondía 422.

Ver tests/integration/HU017_HTTP.md para contrato, errores, enrutamiento y pruebas.
Validación tras DEFECTO-001: backend unitario 331/331; HTTP + PostgreSQL 44/44 y SQL
101/101 con regresiones en Docker exclusivo; E2E real 84/84 (HU017_E2E.md).
### EP07: asignación, cierre manual y recordatorio

El frontend QA se publica como sitio estático de Render mediante el Blueprint
`render.yaml` de la raíz. El backend debe tener `FRONTEND_ORIGINS` configurado
con el origen HTTPS exacto que Render asigne al sitio; admite varios orígenes
separados por coma. La URL del API QA está definida en el entorno de producción
del frontend. Las instrucciones de publicación están en
`PracticaLink/frontend/README.md`.

La migración `supabase/migrations/20261102170000_ep07_cierre_asignaciones.sql`
agrega el gestor asignado a cada práctica, el listado de gestores activos y las
funciones de asignación, cierre y procesamiento de recordatorios. No se aplicó
esta migración a una base real durante el desarrollo.

`GET /practicas/gestores` y `PATCH /practicas/{id_practica}/gestor` son exclusivos
de ADMINISTRADOR. La asignación valida que el usuario elegido esté activo y tenga
el rol GESTOR; se puede retirar la asignación enviando `id_gestor: null`.
`GET /practicas/gestion-estados` mantiene el listado global para administradores
y limita a cada gestor a las prácticas con su propio `id_gestor`.

El cierre es manual mediante `POST /practicas/{id_practica}/cierre`. Solo admite
prácticas EN_CURSO cuya fecha de término sea hoy o anterior. Autoriza al gestor
asignado o a un administrador y, en una sola transacción, actualiza el estado,
inserta el historial y `cierre_practica`, y notifica al estudiante. El cambio
genérico de estado no puede finalizar una práctica. Los cierres registran resultado
APROBADA; el esquema existente también admite REPROBADA y ANULADA, pero este flujo
no ofrece selección de resultado.

El recordatorio se genera una sola vez cuando han transcurrido 24 horas desde la
fecha de término, mientras la práctica siga EN_CURSO. Se guarda en la bandeja de
notificaciones del gestor asignado y de los administradores activos y se intenta
enviar push con el servicio FCM existente. Para el despliegue previsto en Render,
crear un **Cron Job** separado con programación `*/15 * * * *`, URL base del
backend en `API_BASE_URL` y `EP07_REMINDER_TASK_TOKEN` como variable secreta.
Render interpreta la expresión de cron en UTC.
Comando del job:

```sh
curl --fail --silent --show-error --request POST \
  "$API_BASE_URL/practicas/tareas/recordatorios-cierre" \
  --header "X-Task-Token: $EP07_REMINDER_TASK_TOKEN"
```

El endpoint valida el secreto con comparación constante. Sin configuración
devuelve 503 y ante fallo HTTP el job debe finalizar con error. No hay un
servicio Render configurado desde el repositorio: crear el Cron Job y cargar
ambas variables sigue siendo una operación de despliegue pendiente. La llamada
es idempotente por práctica. La ejecución periódica, la migración y el envío real
de push no se verifican en pruebas unitarias.

El inicio `PATCH /practicas/{id_practica}/estado` requiere ahora un gestor activo
asignado. Un GESTOR solo puede iniciar las prácticas asignadas a su usuario;
ADMINISTRADOR puede iniciar si la práctica tiene un GESTOR activo asignado.
La función SQL `practicas_privadas.fn_iniciar_practica` verifica esta regla bajo
la sesión restringida y devuelve 409 si falta la asignación. El bootstrap EP04
también necesita permiso de lectura de la columna `practica.id_gestor`. El cambio
genérico de estado no permite iniciar EN_CURSO y no puede eludir ese flujo.
