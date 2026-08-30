# Contexto de la aplicación frontend

Este archivo entrega contexto técnico y funcional a desarrolladores y asistentes de IA que trabajen dentro de `src/app`.

## Propósito

PracticaLink es una aplicación para gestionar y seguir procesos de práctica profesional. El frontend permite autenticar usuarios y presentar información asociada a su perfil, roles y práctica actual.

## Tecnologías y reglas generales

- Angular 20.
- Ionic 9.
- TypeScript con modo estricto.
- Componentes standalone.
- Estado reactivo mediante signals de Angular.
- RxJS para solicitudes HTTP.
- SCSS para estilos.
- Rutas con carga diferida mediante `loadComponent`.

Antes de modificar código, conservar las reglas estrictas definidas en `tsconfig.json` y evitar el uso innecesario de `any`.

## Estructura de `src/app`

```text
src/app/
├── core/
│   ├── interceptors/
│   │   └── auth.interceptor.ts
│   ├── models/
│   │   └── auth.models.ts
│   ├── services/
│   │   └── auth.service.ts
│   └── store/
│       └── auth.store.ts
├── pages/
│   ├── home/
│   └── login/
├── app.config.ts
├── app.routes.ts
├── app.html
└── app.ts
```

## Rutas disponibles

- `/`: redirige a `/login`.
- `/login`: muestra el formulario de autenticación.
- `/home`: muestra el contexto del usuario autenticado.

Las rutas están declaradas en `app.routes.ts`.

## Flujo de autenticación

1. `Login` captura correo y contraseña.
2. `AuthService.login()` envía `POST /auth/login`.
3. La respuesta contiene `access_token` y `token_type`.
4. El token se guarda en `sessionStorage` con la clave `access_token`.
5. `authInterceptor` agrega `Authorization: Bearer <token>` a las solicitudes HTTP.
6. `AuthService.obtenerContexto()` consulta `GET /auth/context`.
7. El resultado se guarda en `AuthStore`.
8. La aplicación navega a `/home`.
9. Al cerrar sesión se eliminan el token y el contexto en memoria.

No guardar contraseñas, secretos JWT ni credenciales de base de datos en el frontend.

## Contexto del usuario

El contrato principal es `ContextoUsuarioResponse`, definido en `core/models/auth.models.ts`:

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

`AuthStore` mantiene este contexto como `signal<ContextoUsuarioResponse | null>` y expone una signal de solo lectura llamada `contexto`.

El store vive únicamente en memoria. Al recargar el navegador, `Home` vuelve a solicitar el contexto si encuentra un token en `sessionStorage`.

## Comunicación con el backend

El servicio de autenticación usa actualmente:

```text
http://127.0.0.1:8000
```

Endpoints consumidos:

- `POST /auth/login`: autentica al usuario.
- `GET /auth/context`: obtiene usuario, roles, perfil y práctica actual.

El backend debe estar ejecutándose localmente en el puerto `8000`. Si se introduce configuración por ambientes, reemplazar la URL fija de `AuthService` por una configuración centralizada.

## Responsabilidad de cada pieza

- `auth.models.ts`: contratos TypeScript de autenticación y contexto.
- `auth.service.ts`: comunicación HTTP con el backend.
- `auth.store.ts`: estado del contexto del usuario en memoria.
- `auth.interceptor.ts`: incorporación del token JWT a solicitudes.
- `login.ts`: inicio de sesión y carga inicial del contexto.
- `home.ts`: restauración del contexto y cierre de sesión.
- `home.html`: presentación del contexto disponible.
- `app.config.ts`: registro del router, cliente HTTP, interceptor e Ionic.

## Criterios para cambios futuros

- Mantener sincronizados los modelos TypeScript con los esquemas de respuesta del backend.
- Tratar `perfil` y `practica_actual` como valores opcionales o nulos.
- No mutar directamente el contexto; usar los métodos de `AuthStore`.
- Mantener la lógica HTTP dentro de servicios, no dentro de plantillas.
- Manejar estados de carga y error en operaciones asíncronas.
- Limpiar token y contexto cuando la sesión sea inválida.
- No versionar credenciales reales ni información sensible.
- Ejecutar `npm run build` después de cambios relevantes.

## Estado actual y límites conocidos

- No existe todavía un guard de rutas para bloquear `/home`; la página realiza su propia comprobación de sesión.
- No existe flujo de renovación automática del token.
- No existe configuración separada para desarrollo y producción.
- El contexto no persiste fuera de la sesión del navegador.
- La API está configurada con una URL local fija.

Cuando se implemente una de estas capacidades, actualizar este archivo para que continúe representando el comportamiento real de la aplicación.
