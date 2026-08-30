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

El archivo `.env` es local y está ignorado por Git. La plantilla pública es `PracticaLink/backend/.env.template`.

## Base de datos

`core/database.py` crea el engine de SQLAlchemy y `SessionLocal`. La dependencia `get_db()` entrega una sesión por solicitud y garantiza su cierre.

El código usa SQL textual sobre PostgreSQL. Las consultas deben usar parámetros enlazados, nunca interpolación directa de valores.

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

EP02 aplica esta convención mediante
`fn_registrar_practica(id_usuario, datos_jsonb)`, llamada desde
`services/practica_service.py`.

El esquema completo y las funciones utilizadas por el backend están versionados
en `scripts/BD/schema.sql`. El archivo `scripts/BD/user_roles.sql` conserva el
bloque inicial de usuarios y roles como referencia histórica.

Entre las tablas base se encuentran:

- `usuario`
- `rol`
- `usuario_rol`

El contexto depende de `fn_contexto_usuario(id_usuario)` y el registro de una
práctica depende de `fn_registrar_practica(id_usuario, datos_jsonb)`. Ambas
definiciones están incluidas en `scripts/BD/schema.sql`.

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

Las pruebas actuales validan permisos concedidos y denegados, normalización de roles y configuración inválida.

## Estado actual y límites conocidos

- No hay migraciones versionadas ni un mecanismo automático para crear todo el esquema.
- La función `fn_contexto_usuario` debe existir previamente en Supabase.
- No existe renovación de tokens.
- No existe revocación ni lista de tokens invalidados.
- CORS está configurado solamente para el frontend local.
- La lógica actual cubre autenticación y consulta de contexto; los demás módulos del dominio aún deben implementarse.
