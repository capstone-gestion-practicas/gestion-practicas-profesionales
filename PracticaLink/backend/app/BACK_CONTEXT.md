# Contexto de la aplicación backend

Este archivo entrega contexto técnico y funcional a desarrolladores y asistentes de IA que trabajen dentro de `backend/app`.

## Propósito

El backend de PracticaLink expone la API del proceso de práctica profesional y se conecta a PostgreSQL alojado en Supabase.

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
│       └── auth.py
├── core/
│   ├── config.py
│   ├── database.py
│   ├── permissions.py
│   └── security.py
├── schemas/
│   └── auth.py
├── services/
│   └── auth_service.py
├── BACK_CONTEXT.md
└── main.py
```

## Inicio de la aplicación

`main.py` crea la instancia de FastAPI, configura CORS, registra las rutas de autenticación y expone comprobaciones de estado.

Orígenes locales permitidos actualmente:

- `http://localhost:4200`
- `http://127.0.0.1:4200`

Ejecución local desde `PracticaLink/backend`:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

## Configuración

`core/config.py` carga las siguientes variables desde `PracticaLink/backend/.env`:

- `SUPABASE_DATABASE_URL`
- `JWT_SECRET_KEY`
- `JWT_ALGORITHM`
- `JWT_ACCESS_TOKEN_EXPIRE_MINUTES`
- `CHILE_RUT_EMPRESA_API_KEY`
- `CHILE_RUT_EMPRESA_API_URL`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`
- `SMTP_FROM_EMAIL` y `SMTP_USE_TLS` para recordatorios por correo

Los recordatorios persisten y publican la notificación Realtime aunque el
servidor SMTP no esté disponible; en ese caso, la respuesta indica que el correo
no se envió.

El archivo `.env` es local y está ignorado por Git. La plantilla pública es `PracticaLink/backend/.env.template`.

## Base de datos

`core/database.py` crea el engine de SQLAlchemy y `SessionLocal`. La dependencia `get_db()` entrega una sesión por solicitud y garantiza su cierre.

El código usa SQLAlchemy para invocar funciones PostgreSQL. Toda llamada debe usar parámetros enlazados, nunca interpolación directa de valores.

### Operaciones transaccionales

Las rutas autentican y autorizan; Pydantic valida la entrada; los servicios de Python invocan funciones de PostgreSQL mediante llamadas parametrizadas de SQLAlchemy. La lógica de consulta, escritura y transacción de persistencia se mantiene en funciones versionadas con migraciones de Supabase. Python conserva tareas que no son de persistencia, como verificar hashes de contraseña, firmar JWT y consultar la API externa de empresas.

Las restricciones, claves foráneas e índices de la base siguen protegiendo la integridad. Las excepciones de dominio devueltas por las funciones se traducen a respuestas HTTP sin exponer errores internos del motor. Las funciones de aplicación se ejecutan desde la conexión privada del backend y no se publican como RPC para `anon`, `authenticated` o `service_role`.
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
5. Llama a `fn_registrar_usuario_estudiante`, que crea el usuario y su asignación de rol dentro de una transacción.
6. Devuelve los datos públicos del usuario con `201 Created`.

El registro no crea el perfil de estudiante. Si corresponde, RUT, carrera y
sede se incorporan posteriormente mediante `fn_completar_perfil_estudiante`.
El registro nunca devuelve ni almacena la contraseña en texto plano.

### `GET /auth/context`

Requiere el encabezado:

```text
Authorization: Bearer <token>
```

El backend valida el JWT, exige uno de los roles conocidos, obtiene `id_usuario` desde `sub` y consulta usuario, roles, perfil y práctica actual mediante `fn_contexto_usuario`.

### `POST /practicas`

Requiere autenticación y rol `ESTUDIANTE`. Registra de forma transaccional el
centro de práctica, la práctica profesional y su primer historial con estado
`REGISTRADA`. El estudiante se obtiene desde el usuario autenticado; nunca se
acepta un `id_estudiante` enviado por el cliente.

El endpoint rechaza el registro cuando el usuario no posee perfil de estudiante
o ya tiene una práctica cuyo estado no es final. Si se informa el RUT de una
empresa existente, reutiliza ese centro en lugar de duplicarlo.

`fn_registrar_practica` confirma el centro, la práctica, el historial inicial y las notificaciones en una sola transacción. La autorización y la obtención del usuario desde el JWT permanecen en FastAPI.

El registro puede incluir `horas_semanales` (entre 1 y 45), almacenadas por separado
del campo histórico `horas` en `practica`. La restricción y las respuestas de
contexto, detalle y revisión se actualizan mediante la migración
`20261017030000_horas_semanales_practica.sql`.

### Centro de notificaciones

- `GET /notificaciones`: devuelve las notificaciones del usuario autenticado y
  el total de avisos sin leer.
- `PATCH /notificaciones/{id_notificacion}/leida` y
  `PATCH /notificaciones/leidas`: marcan avisos como leídos.

Cada práctica nueva avisa a los gestores y administradores activos; cada cambio
de estado avisa al estudiante. La tabla persistente se crea con la migración
`supabase/migrations/20261017010000_create_notificacion.sql`.

Cuando una práctica está `OBSERVADA`, el estudiante puede responder mediante
`PATCH /practicas/{id_practica}/respuesta-observacion`. La función
`fn_responder_observacion_practica` verifica que sea su práctica, la devuelve a
`EN_REVISION`, agrega la respuesta en `historial_estado.observacion` y notifica a
gestores y administradores en la misma transacción. Se incorpora con la migración
`20261017040000_respuesta_observacion_estudiante.sql`.

### Revisión de prácticas (EP03)

Los endpoints bajo `/revisiones` requieren rol `GESTOR` o `ADMINISTRADOR`:

- `GET /revisiones/solicitudes`: lista solicitudes pendientes de revisión.
- `GET /revisiones/solicitudes/{id_practica}`: entrega los antecedentes del
  estudiante, centro y práctica.
- `PATCH /revisiones/solicitudes/{id_practica}`: aprueba, observa o rechaza la
  solicitud con `fn_revisar_practica`, que registra la trazabilidad en
  `historial_estado` y notifica al estudiante en la misma transacción.

Las decisiones `OBSERVADA` y `RECHAZADA` requieren una observación.

### Seguimiento de prácticas (EP05)

- `POST /practicas/{id_practica}/seguimientos`: registra fecha y observación; requiere rol `GESTOR` o `ADMINISTRADOR` y una práctica no finalizada.
- `GET /practicas/{id_practica}/seguimientos`: consulta el historial de esa práctica para gestores y administradores.
- La migración `20261028010000_ep05_seguimientos.sql` añade las operaciones transaccionales sobre la tabla `seguimiento` ya creada por el esquema inicial.

### Incidencias y alertas (EP06)

- `POST /practicas/{id_practica}/incidencias`: registra fecha, descripción y prioridad para gestores y administradores; requiere práctica no finalizada.
- `GET /incidencias`: lista incidencias junto con la práctica, estudiante, correo, estado y prioridad.
- `PATCH /incidencias/{id_incidencia}/estado`: actualiza el estado; al resolver o cerrar conserva la fecha de resolución.
- Las prioridades `ALTA` y `CRITICA` generan una fila asociada en `alerta` dentro de la misma transacción.
- `ABIERTA` y `EN_REVISION` cuentan como pendientes. La pantalla de gestión destaca esos registros.
- La migración `20261028020000_ep06_incidencias_alertas.sql` crea las operaciones sobre las tablas `incidencia` y `alerta` existentes.

### Gestión de usuarios (EP01)

Los endpoints bajo `/usuarios` requieren el rol `ADMINISTRADOR`:

- `GET /usuarios`: lista las cuentas con su estado y roles.
- `GET /usuarios/roles`: lista los roles activos disponibles.
- `POST /usuarios`: crea una cuenta y asigna roles mediante
  `fn_crear_usuario_admin`.
- `PATCH /usuarios/{id_usuario}`: actualiza nombre, apellido, estado y roles
  mediante `fn_actualizar_usuario_admin`.

El identificador del administrador proviene siempre del JWT. El backend valida que el administrador esté activo y posea el rol `ADMINISTRADOR`. Un administrador no puede desactivar su propia cuenta ni
quitarse su propio rol administrativo.

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
- Mantener llamadas parametrizadas a funciones de PostgreSQL.
- Proteger mediante dependencia de autenticación todo endpoint privado.
- No aceptar el algoritmo JWT desde el contenido del token; usar el configurado por el servidor.

## Responsabilidad de cada pieza

- `main.py`: inicialización, middleware, routers y health checks.
- `api/routes/auth.py`: capa HTTP de autenticación.
- `schemas/auth.py`: contratos Pydantic de entrada y salida.
- `services/auth_service.py`: llamadas de persistencia y lógica de autenticación.
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

- El esquema y las funciones se versionan en `supabase/migrations`; la migración
  `20261017020000_backend_operations.sql` concentra las operaciones de persistencia
  de los módulos implementados.
- No existe renovación de tokens.
- No existe revocación ni lista de tokens invalidados.
- CORS está configurado solamente para el frontend local.
- La autorización HTTP sigue en FastAPI; las funciones de base de datos no
  sustituyen la validación JWT ni la comprobación de roles de cada ruta.
