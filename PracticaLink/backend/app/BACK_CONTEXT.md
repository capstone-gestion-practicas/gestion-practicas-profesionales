# Contexto de la aplicación backend

Este archivo entrega contexto técnico y funcional a desarrolladores y asistentes de IA que trabajen dentro de `backend/app`.

## Propósito

El backend de PracticaLink expone una API para autenticar usuarios y consultar su contexto dentro del proceso de práctica profesional. Actualmente contiene la base del módulo de autenticación y se conecta a PostgreSQL alojado en Supabase.

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

El archivo `.env` es local y está ignorado por Git. La plantilla pública es `PracticaLink/backend/.env.template`.

## Base de datos

`core/database.py` crea el engine de SQLAlchemy y `SessionLocal`. La dependencia `get_db()` entrega una sesión por solicitud y garantiza su cierre.

El código usa SQL textual sobre PostgreSQL. Las consultas deben usar parámetros enlazados, nunca interpolación directa de valores.

### Operaciones transaccionales

Las rutas autentican y autorizan; Pydantic valida la entrada; los servicios de Python ejecutan SQL textual parametrizado mediante SQLAlchemy y gestionan `commit()`/`rollback()`. El backend no debe invocar funciones almacenadas de PostgreSQL. Una operación con varias escrituras debe ejecutarse en una sola transacción, validar nuevamente los datos persistidos y bloquear con `SELECT ... FOR UPDATE` cuando puedan ocurrir cambios concurrentes.

Las restricciones, claves foráneas e índices de la base siguen protegiendo la integridad. Las excepciones de dominio se traducen a respuestas HTTP sin exponer errores internos del motor. Los `SELECT` pueden permanecer en servicios o moverse a repositorios cuando el módulo lo justifique.
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
sede se incorporan posteriormente mediante una transacción SQL del backend.
El registro nunca devuelve ni almacena la contraseña en texto plano.

### `GET /auth/context`

Requiere el encabezado:

```text
Authorization: Bearer <token>
```

El backend valida el JWT, exige uno de los roles conocidos, obtiene `id_usuario` desde `sub` y consulta usuario, roles, perfil y práctica actual mediante SQL parametrizado.

### `POST /practicas`

Requiere autenticación y rol `ESTUDIANTE`. Registra de forma transaccional el
centro de práctica, la práctica profesional y su primer historial con estado
`REGISTRADA`. El estudiante se obtiene desde el usuario autenticado; nunca se
acepta un `id_estudiante` enviado por el cliente.

El endpoint rechaza el registro cuando el usuario no posee perfil de estudiante
o ya tiene una práctica cuyo estado no es final. Si se informa el RUT de una
empresa existente, reutiliza ese centro en lugar de duplicarlo.

El servicio ejecuta las consultas SQL parametrizadas y confirma la transacción solo cuando el centro, la práctica y el historial inicial se guardan correctamente. La autorización y la obtención del usuario desde el JWT permanecen en FastAPI.

### Centro de notificaciones

- `GET /notificaciones`: devuelve las notificaciones del usuario autenticado y
  el total de avisos sin leer.
- `PATCH /notificaciones/{id_notificacion}/leida` y
  `PATCH /notificaciones/leidas`: marcan avisos como leídos.

Cada práctica nueva avisa a los gestores y administradores activos; cada cambio
de estado avisa al estudiante. La tabla persistente se crea con la migración
`supabase/migrations/20261017010000_create_notificacion.sql`.

### Revisión de prácticas (EP03)

Los endpoints bajo `/revisiones` requieren rol `GESTOR` o `ADMINISTRADOR`:

- `GET /revisiones/solicitudes`: lista solicitudes pendientes de revisión.
- `GET /revisiones/solicitudes/{id_practica}`: entrega los antecedentes del
  estudiante, centro y práctica.
- `PATCH /revisiones/solicitudes/{id_practica}`: aprueba, observa o rechaza la
  solicitud con consultas SQL transaccionales y registra la trazabilidad en
  `historial_estado`.

Las decisiones `OBSERVADA` y `RECHAZADA` requieren una observación.

### Gestión de usuarios (EP01)

Los endpoints bajo `/usuarios` requieren el rol `ADMINISTRADOR`:

- `GET /usuarios`: lista las cuentas con su estado y roles.
- `GET /usuarios/roles`: lista los roles activos disponibles.
- `POST /usuarios`: crea una cuenta y asigna roles mediante SQL transaccional.
- `PATCH /usuarios/{id_usuario}`: actualiza nombre, apellido, estado y roles
  mediante SQL transaccional.

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
- Las funciones almacenadas históricas del esquema no son llamadas por el backend.
- No existe renovación de tokens.
- No existe revocación ni lista de tokens invalidados.
- CORS está configurado solamente para el frontend local.
- La lógica actual cubre autenticación y consulta de contexto; los demás módulos del dominio aún deben implementarse.
