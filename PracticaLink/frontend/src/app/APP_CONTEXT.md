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
- `/portal-empresa`: portal de cuentas `EMPRESA`, asociadas por administración a un RUT.
- `/ofertas`: catálogo de ofertas publicadas y postulaciones del estudiante.
- `/gestion-ofertas`: administración de ofertas y postulaciones para gestores y administradores.
- `/practicas/nueva`: permite a un estudiante sin práctica activa registrar los antecedentes de su práctica profesional.
- `/revisiones`: lista solicitudes pendientes para gestores y administradores.
- `/revisiones/:id`: muestra los antecedentes; la decisión se registra mediante un modal.
- `/notificaciones`: muestra la bandeja persistente del usuario autenticado.
- `/envio-notificaciones`: permite a gestores y administradores enviar avisos push a un estudiante o a todos los estudiantes activos.
- `/usuarios`: panel de gestión de cuentas exclusivo para el rol `ADMINISTRADOR`.

Las rutas están declaradas en `app.routes.ts`.

El inicio prioriza tareas según el rol: gestores ven solicitudes pendientes y
accesos directos a revisión, estados, seguimientos, incidencias y envío de
avisos; estudiantes ven el paso que necesitan completar y el estado de su
práctica. Las cuentas con ambos roles pueden cambiar de espacio desde el encabezado.

Al registrar una práctica, se puede informar la jornada semanal (1 a 45 horas).
La estimación de horas transcurridas usa esa jornada y se detiene en la fecha de
término cuando ya pasó; si no se informó, la estimación lo indica.

Si el estado es `OBSERVADA`, el estudiante puede enviar una respuesta que queda
en el historial junto al cambio del estado a `EN_REVISION`.

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

Desde el acceso `Empresas`, cualquier solicitante puede enviar una solicitud
con RUT, razón social, datos de contacto y una contraseña elegida por quien
solicita. Primero se consulta el RUT y solo entonces se muestran los demás
campos. Si no se encuentra la empresa, se permite completar sus datos
manualmente y enviar la solicitud para revisión administrativa. Si el servicio
de consulta no está disponible, se debe reintentar; el formulario no habilita
el envío manual en ese caso. Enviar el formulario no crea una cuenta.

## Gestión administrativa de usuarios (EP01)

El Home muestra el acceso al panel solamente cuando el contexto contiene el rol
`ADMINISTRADOR`. La ruta `/usuarios` también está protegida por `authGuard` y
`roleGuard`.

El panel permite:

- Listar usuarios, estados y roles asignados.
- Crear cuentas mediante un modal.
- Editar nombre, apellido, estado y roles mediante un modal.
- Crear y mantener cuentas `EMPRESA` con un único RUT válido; este rol es exclusivo.
- Revisar solicitudes empresariales pendientes. Al aprobar una solicitud se crea
  la cuenta activa con el correo y la contraseña elegidos por el solicitante;
  rechazarla no crea una cuenta.
- Evitar que el administrador conectado se desactive o se quite su propio rol.

La cuenta administradora inicial debe obtenerse promoviendo una cuenta existente
directamente en la base de datos. Después de ese bootstrap, las demás cuentas
administrativas pueden crearse desde el panel.

No guardar contraseñas, secretos JWT ni credenciales de base de datos en el frontend.

## Portal laboral

Las cuentas de empresa no tienen registro público: un administrador las crea o
edita desde `/usuarios` y les asocia un RUT único. Tras iniciar sesión, una
cuenta con rol `EMPRESA` entra a `/portal-empresa`, donde administra ofertas de
su RUT, consulta las postulaciones recibidas y ve en solo lectura las prácticas
asociadas a ese RUT. Su formulario muestra el RUT vinculado y los datos de
empresa disponibles. La asignación de supervisores empresariales no forma parte
de este flujo.

La gestión administrativa de usuarios incluye la revisión de solicitudes
empresariales. Las solicitudes se mantienen pendientes hasta una decisión
administrativa; la decisión y observación quedan visibles en el panel. No se
envían correos automáticos de aprobación/rechazo: el correo y teléfono del
contacto quedan disponibles para su seguimiento.

Los estudiantes consultan ofertas publicadas en `/ofertas`, envían una
postulación y revisan sus postulaciones e historial. Gestores y administradores
pueden crear ofertas para un RUT, revisar postulaciones y actualizar su estado
desde `/gestion-ofertas`.

El backend expone los servicios de este flujo bajo `/laboral`:

- `GET /laboral/practicas`: prácticas asociadas al RUT de la cuenta `EMPRESA`.
- `GET /laboral/ofertas` y `GET /laboral/postulaciones/mias`: catálogo y postulaciones propias del estudiante.
- `POST /laboral/ofertas` y `PUT /laboral/ofertas/{id}`: guardar ofertas como empresa o gestión.
- `POST /laboral/ofertas/{id}/postulaciones`: postular como estudiante.
- `GET /laboral/ofertas/gestion`, `GET /laboral/ofertas/{id}/postulaciones` y `PATCH /laboral/postulaciones/{id}`: gestión de ofertas y postulaciones.
- `GET /laboral/postulaciones/{id}/historial`: historial accesible según estudiante, RUT asociado o rol de gestión.

En las ofertas, el cargo se elige de una lista de funciones de práctica o se
ingresa como otro cargo. El formulario solicita primero el RUT y solo muestra
los campos de la oferta tras encontrar la empresa en la consulta tributaria.
Los datos de caché vencida se identifican como potencialmente desactualizados.
La ubicación acepta texto manual o sugerencias de calles de Photon/OpenStreetMap;
el navegador envía la consulta de dirección al proveedor externo.

La migración versionada es `supabase/migrations/20261102180000_portal_laboral.sql`.
Debe aplicarse y validarse en el entorno PostgreSQL autorizado antes de desplegar
el backend que consume estas tablas y funciones; no se aplica automáticamente.

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

Los servicios usan una URL centralizada por ambiente:

```text
Desarrollo: http://127.0.0.1:8000
Producción/Android: https://practicalink-api-qa.onrender.com
```

Endpoints consumidos:

- `POST /auth/login`: autentica al usuario.
- `POST /auth/register`: crea una cuenta con rol `ESTUDIANTE`.
- `GET /auth/context`: obtiene usuario, roles, perfil y práctica actual.
- `POST /practicas`: registra el centro y la práctica del estudiante autenticado.
- `GET /practicas/{id}/seguimientos`: lista los seguimientos de una práctica para gestores y administradores.
- `POST /practicas/{id}/seguimientos`: registra fecha y observación durante el desarrollo de la práctica.
- `GET /incidencias`: lista las incidencias y su prioridad, estado y práctica asociada para gestores y administradores.
- `POST /practicas/{id}/incidencias`: registra una incidencia; las prioridades altas y críticas generan alertas.
- `PATCH /incidencias/{id}/estado`: actualiza el estado de una incidencia.
- `GET /empresas/consulta/{rut}`: consulta antecedentes tributarios con caché de backend.
- `GET /usuarios`: lista usuarios para el administrador.
- `GET /usuarios/roles`: lista roles activos.
- `POST /usuarios`: crea una cuenta y asigna sus roles.
- `PATCH /usuarios/{id}`: actualiza datos, estado y roles.

Los archivos de `src/environments` determinan la URL usada en cada build. El
proyecto nativo vive en `frontend/android` y se sincroniza con `npm run apk:sync`.

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
- `pages/seguimientos`: registro y consulta del historial EP05 por práctica.
- `pages/incidencias`: registro, gestión de estado y detección de incidencias pendientes EP06.
- `practica-form`: modal de registro, búsqueda por RUT e ingreso manual del centro.
- `practica.service.ts`: registro de prácticas y consulta de empresas.
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

El centro de notificaciones mantiene Realtime y avisos emergentes con la app
abierta. En Android nativo, permite registrar un token Firebase Cloud Messaging
por usuario para recibir avisos push cuando la app está en segundo plano o
cerrada. El usuario habilita el permiso desde el centro de notificaciones.
FCM requiere `google-services.json` en Android y la variable
`FIREBASE_SERVICE_ACCOUNT_JSON` configurada en el backend.
Cuando la app Android está abierta, el push recibido también se presenta como
una notificación local del sistema; en segundo plano, Android presenta el push
de FCM directamente.
Gestores y administradores envían desde `/envio-notificaciones` un mensaje
personalizado a un estudiante activo o a todos los estudiantes activos; el
aviso queda en la bandeja del destinatario y se envía por FCM si habilitó push.
También pueden elegir broadcast para enviar el mensaje a todos los estudiantes
activos; la interfaz pide confirmación antes de realizar el envío.

- `/home` está protegido por autenticación y roles; la página conserva una comprobación defensiva de sesión.
- No existe flujo de renovación automática del token.
- No existe configuración separada para desarrollo y producción.
- El contexto no persiste fuera de la sesión del navegador.
- La API está configurada con una URL local fija.

Cuando se implemente una de estas capacidades, actualizar este archivo para que continúe representando el comportamiento real de la aplicación.
