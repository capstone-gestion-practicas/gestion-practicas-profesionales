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
│   ├── guards/
│   │   ├── auth.guard.ts
│   │   └── role.guard.ts
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
- `/home`: muestra el contexto del usuario autenticado y exige uno de los roles conocidos.
- `/practicas/nueva`: permite a un estudiante sin práctica activa registrar los antecedentes de su práctica profesional.
- `/revisiones`: lista solicitudes pendientes para gestores y administradores.
- `/revisiones/:id`: muestra los antecedentes; la decisión se registra mediante un modal.
- `/usuarios`: panel de gestión de cuentas exclusivo para el rol `ADMINISTRADOR`.

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

## Flujo de registro

1. Desde `/login`, el usuario selecciona `Registrarme`.
2. Ingresa nombre, apellido, correo, contraseña y confirmación.
3. El frontend comprueba que ambas contraseñas coincidan y tengan al menos 8 caracteres.
4. `AuthService.registrar()` envía `POST /auth/register`.
5. El backend crea la cuenta con el rol `ESTUDIANTE`.
6. No se crea todavía un perfil académico.
7. Tras una respuesta exitosa, el formulario vuelve al modo de inicio de sesión y conserva el correo ingresado.
8. Si la cuenta continúa como estudiante, completa RUT, carrera y sede desde el modal del Home.

El registro público no solicita datos académicos. Esto permite que una cuenta
pueda promoverse posteriormente a `GESTOR` o `ADMINISTRADOR` sin crear un perfil
de estudiante innecesario.

## Gestión administrativa de usuarios (EP01)

El Home muestra el acceso al panel solamente cuando el contexto contiene el rol
`ADMINISTRADOR`. La ruta `/usuarios` también está protegida por `authGuard` y
`roleGuard`.

El panel permite:

- Listar usuarios, estados y roles asignados.
- Crear cuentas mediante un modal.
- Editar nombre, apellido, estado y roles mediante un modal.
- Evitar que el administrador conectado se desactive o se quite su propio rol.

La cuenta administradora inicial debe obtenerse promoviendo una cuenta existente
directamente en la base de datos. Después de ese bootstrap, las demás cuentas
administrativas pueden crearse desde el panel.

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
- `POST /auth/register`: crea una cuenta con rol `ESTUDIANTE`.
- `GET /auth/context`: obtiene usuario, roles, perfil y práctica actual.
- `POST /practicas`: registra el centro y la práctica del estudiante autenticado.
- `GET /usuarios`: lista usuarios para el administrador.
- `GET /usuarios/roles`: lista roles activos.
- `POST /usuarios`: crea una cuenta y asigna sus roles.
- `PATCH /usuarios/{id}`: actualiza datos, estado y roles.

El backend debe estar ejecutándose localmente en el puerto `8000`. Si se introduce configuración por ambientes, reemplazar la URL fija de `AuthService` por una configuración centralizada.

## Responsabilidad de cada pieza

- `auth.models.ts`: contratos TypeScript de autenticación y contexto.
- `auth.service.ts`: comunicación HTTP con el backend.
- `auth.store.ts`: estado del contexto del usuario en memoria.
- `auth.interceptor.ts`: incorporación del token JWT a solicitudes.
- `auth.guard.ts`: bloqueo de rutas cuando no existe un token de acceso.
- `role.guard.ts`: autorización de rutas según los roles presentes en el contexto.
- `login.ts`: inicio de sesión y carga inicial del contexto.
- `home.ts`: restauración del contexto y cierre de sesión.
- `home.html`: presentación del contexto disponible.
- `usuario.service.ts`: comunicación con los endpoints administrativos.
- `usuarios.ts`: estado y acciones del panel de gestión de usuarios.
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

## Pruebas unitarias

Desde `PracticaLink/frontend`:

```powershell
npm test -- --watch=false --browsers=ChromeHeadless
```

Las pruebas actuales cubren guards, store de autenticación, componentes base y el saludo construido desde el contexto.

## Estado actual y límites conocidos

- `/home` está protegido por autenticación y roles; la página conserva una comprobación defensiva de sesión.
- No existe flujo de renovación automática del token.
- No existe configuración separada para desarrollo y producción.
- El contexto no persiste fuera de la sesión del navegador.
- La API está configurada con una URL local fija.

Cuando se implemente una de estas capacidades, actualizar este archivo para que continúe representando el comportamiento real de la aplicación.
