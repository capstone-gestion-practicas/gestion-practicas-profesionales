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
- `GET /empresas/consulta/{rut}`: consulta antecedentes tributarios con caché de backend.
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

- `/home` está protegido por autenticación y roles; la página conserva una comprobación defensiva de sesión.
- No existe flujo de renovación automática del token.
- No existe configuración separada para desarrollo y producción.
- El contexto no persiste fuera de la sesión del navegador.
- La API está configurada con una URL local fija.

Cuando se implemente una de estas capacidades, actualizar este archivo para que continúe representando el comportamiento real de la aplicación.


## EP04 / HU04.1: consulta general de prácticas

`/practicas` es una pantalla de solo lectura protegida por authGuard y roleGuard
para GESTOR y ADMINISTRADOR. Home muestra el acceso exclusivamente a esos roles.
Consume `GET /practicas` mediante `PracticaService.listar(limit, offset, rut?)`;
los modelos `PracticasListadoResponse` y `PracticaResumen` reflejan el backend.
Incluye todos los estados, fechas en America/Santiago y paginación de 50 elementos.

El RUT se ingresa como texto, con autocomplete desactivado, sin puntos y con guion y verificador; solo se
comprueba formato básico. La API valida módulo 11. Los errores 422 se muestran
sin reproducir entradas personales. El filtro y la paginación viven únicamente
en el componente; no se guardan en almacenamiento ni en la navegación Angular.
El parámetro rut solo se envía al backend cuando existe un filtro. Las consultas
anteriores se cancelan al iniciar otra y al destruir el componente.
El listado no usa RevisionService ni ofrece acciones de revisión/cambio de estado.

El listado indica discretamente si hay un filtro aplicado sin mostrar el RUT.
Reintentar repite la consulta HTTP fallida con el filtro aplicado y el offset
conservado, independientemente del texto editado en el buscador. Los errores
locales de formato no ofrecen reintento HTTP.


### Detalle general de gestión

Ver antecedentes abre `/practicas/:id`, protegido por authGuard y roleGuard para
GESTOR y ADMINISTRADOR. El componente standalone practica-detalle consume
PracticaService.obtenerDetalle(id) y el contrato PracticaDetalleGestionResponse.
No expone RUT, correo, teléfono ni contactos. Muestra estado actual/final,
fechas, horas, cargo y descripción. No modifica el flujo de revisión EP03.

Listado y detalle comparten core/utils/fechas.ts: timestamps en America/Santiago
con horario de verano; fechas DATE por partes de calendario sin cambio de zona.
Existen estados de carga, 404, acceso denegado 401/403 y error general con
reintento. Se cancelan consultas anteriores al cambiar id o destruir la vista.
Volver navega al listado completo sin restaurar filtro ni paginación.


### EP04 / HU04.3: historial de estados en detalle

La sección Historial de estados en `/practicas/:id` consume
PracticaService.obtenerHistorial(id, limit, offset), con contratos
HistorialPracticaResponse y EventoHistorial compatibles con el backend.
Mantiene el orden recibido de la API (fecha_cambio, id_historial ascendentes),
eventos repetidos y estado anterior null como Sin estado anterior registrado.
No interpreta automáticamente ningún evento como registro inicial.

La sección tiene carga, error, vacío, reintento y paginación de 50 eventos
independientes de los antecedentes. Reintentar conserva la práctica y página.
Cambiar de práctica reinicia la paginación y cancela las peticiones anteriores;
al destruir la vista se cancelan ambas consultas. Usa el formateador compartido
America/Santiago. Observaciones por interpolación de texto, sin innerHTML.
Solo los roles de gestión existentes pueden abrir la pantalla; no se añade
acceso del estudiante ni acciones de revisión en el historial.

### EP04 / HU04.2: iniciar práctica

El detalle muestra Iniciar práctica solo a GESTOR/ADMINISTRADOR con APROBADA no
final. Solicita confirmación explícita y observación opcional; normaliza espacios
en extremos como PostgreSQL y valida hasta 500 caracteres Unicode. PracticaService
envía PATCH con destino EN_CURSO, sin identificador de responsable en el cuerpo.
Mientras se envía, bloquea confirmación/cancelación y evita solicitudes duplicadas.
Solo confirma éxito después del servidor y recarga antecedentes e historial desde
la primera página. Ante 409 explica el conflicto y refresca ambas consultas.
Ante 503 o resultado incierto ofrece consultar nuevamente el estado, sin reintentar
la escritura automáticamente. Una consulta fallida mantiene bloqueado un nuevo
intento. Cambiar de práctica o destruir la vista cancela la suscripción local;
esto no garantiza cancelar una escritura que ya llegó al servidor. No usa EP03.

En la simulación local de corte abrupto, Angular invocó una sola vez el servicio
y se observó un único `XHR.send()`, pero Firefox produjo dos solicitudes HTTP
PATCH. También se reprodujo con XHR nativo sin Angular; no se verificó en otros
navegadores. La aplicación no implementa reintentos automáticos. PostgreSQL
protege contra una transición repetida mediante bloqueo y validación del estado:
una segunda operación sobre EN_CURSO se rechaza sin añadir otro evento.

### EP05 / HU013: registrar seguimiento mediante FastAPI

Nota histórica: este apartado describe el incremento HU013; el estado vigente de
la consulta está en HU014, más abajo.

RegistroPractica conserva el componente compartido y la apariencia existente.
Para seguimientos usa PracticaService.registrarSeguimiento y POST
`/practicas/{id}/seguimientos`, enviando solo fecha, tipo y observacion. El
interceptor existente agrega el JWT de sessionStorage; las rutas conservan
los guards de autenticación y los roles GESTOR/ADMINISTRADOR. No envía autor.

Valida fecha calendario no futura en America/Santiago (también la fecha inicial),
los cinco medios existentes y observación con contenido de hasta 2000 puntos de
código Unicode, sin recortar el texto enviado. No usa maxlength HTML para este
campo porque cuenta unidades UTF-16, distinto del contrato Python/PostgreSQL.
Se retiró próxima fecha del formulario de seguimiento: no forma parte del contrato.

Bloquea envíos simultáneos. Solo HTTP 201 con cuerpo confirma éxito y deja un
mensaje en el formulario; no navega a un historial que aún no consulta el servidor.
Presenta errores diferenciados para 401/403/404/409/422/500/503. No muestra detalles
internos recibidos ni reintenta escrituras. Ante error de red, 500/503 u otro
resultado incierto bloquea un nuevo envío en esa instancia y pide verificarlo.
Este bloqueo no persiste tras recargar: no constituye idempotencia. Destruir la
vista cancela la suscripción, no garantiza cancelar una escritura en el servidor.

Los registros locales anteriores permanecen sin migración ni asignación de autor.
La pestaña existente los rotula como demostración; no consulta ni simula datos
PostgreSQL y no representa HU014 implementada. Los nuevos seguimientos no se
escriben en localStorage. El guardado local de incidencias EP06 y su servicio
compartido permanecen sin cambios de comportamiento.

Validación de este incremento: 110 pruebas Angular aprobadas con Chromium
Headless y build de producción aprobado. Se probaron HTTP/JWT con HttpTestingController,
formulario, fechas chilenas, errores, doble envío y ausencia de escritura local.
No se ejecutó una prueba de extremo a extremo Angular/FastAPI/PostgreSQL en esta
sesión. El build advierte sobre el presupuesto inicial y estilos de home/detalle;
no se modificaron presupuestos ni dependencias para ocultar esas advertencias.

### EP05 / HU014: historial de seguimientos persistidos

La pestaña Seguimientos de `/practicas/:id` ya consulta exclusivamente
`GET /practicas/{id}/seguimientos?limit=50&offset=0` mediante PracticaService y el
interceptor JWT existente. Sustituye la visualización local descrita en la etapa
HU013 anterior. Los guards de gestión permanecen: no añade acceso ESTUDIANTE.

SeguimientosHistorialResponse y SeguimientoHistorialItem son contratos de lectura
independientes del contrato de creación: medio nullable o histórico, observación
vacía o extensa y responsable con ID/nombre actual, incluso inactivo. Conserva
el orden recibido, sin sort; usa formatearFechaCalendario para DATE. Texto por
interpolación, sin innerHTML ni truncado; tipo null se presenta como Medio no registrado.

La carga de seguimientos es independiente del historial de estados EP04. Tiene
carga, error, respuesta vacía confirmada y paginación limit/offset con hay_mas.
El contador de la pestaña representa filas de la página, no el total del historial.
Una página posterior vacía no afirma que toda la práctica carece de seguimientos.
Durante solicitudes pendientes no inicia otra lectura de seguimientos; cancela
la anterior y borra datos/paginación al cambiar de práctica o destruir la vista.
Cambiar de pestaña no reintenta lecturas fallidas. Reintentar conserva la página
fallida y requiere acción explícita. Las páginas se reemplazan, no se acumulan.

401 limpia access_token y AuthStore mediante limpiar() y navega a login, como
el mecanismo de sesión existente. 403/404/422/500/503 presentan mensajes propios
sin reproducir detalles internos. Fallos de red no recurren al almacenamiento local.

El detalle utiliza RegistroPracticaService solo para los registros de incidencias;
los seguimientos locales antiguos se ignoran, sin migrarlos, borrarlos ni atribuir
responsables. EP06 mantiene su almacenamiento y presentación. HU013 conserva su
POST y bloqueo ante resultados inciertos; únicamente se actualizaron sus mensajes
para indicar que ahora se puede consultar el historial al volver al detalle.

Validación 30-10-2026: 123/123 pruebas Angular con Chromium Headless, build de
producción y git diff --check aprobados. Karma requirió ejecución fuera del sandbox
por bloqueo del puerto 9876. No se instalaron dependencias. Advertencias de tamaño
inicial y estilos de home/practica-detalle, sin cambiar presupuestos.
Pruebas de HTTP simuladas: no se ejecutó el recorrido completo navegador→FastAPI→
PostgreSQL en esta sesión. Offset puede desplazarse ante inserciones concurrentes.


### EP05: navegación y límites vigentes

El formulario de registro observa paramMap: navegar entre prácticas con la misma
instancia cancela suscripciones anteriores, reinicia campos, mensajes y bloqueos,
y carga la práctica nueva. Una cancelación local no deshace una escritura que ya
alcanzó PostgreSQL. La prueba de Router real conserva este escenario como regresión.
HU014 está integrada; sus datos proceden exclusivamente de FastAPI.

Las conexiones de servidor SEGUIMIENTOS_DATABASE_URL (escritura) y
SEGUIMIENTOS_LECTURA_DATABASE_URL (lectura) nunca se configuran en Angular. Su
separación, orden SQL y verificación de permisos están en
[la guía de instalación](../../../../DOCUMENTACION_INSTALACION.md). Si falta una
conexión, su endpoint responde 503 sin fallback. Migraciones y privilegios no se
han validado en despliegue. Persisten la falta de idempotencia ante respuestas
perdidas, desplazamientos de offset y pérdida de precisión de BIGINT como number
fuera de ±(2^53−1); esta corrección no rediseña esos contratos.
