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

#### HU017: indicador de incidencias pendientes en el listado

Para GESTOR y ADMINISTRADOR, cada tarjeta muestra `Pendientes: N` y `En gestión: N`
como valores separados (nunca sumados). `Pendientes` cuenta solo estado `PENDIENTE`.
Si existe `fecha_pendiente_antigua`, se muestra como `Pendiente desde …` en
America/Santiago. Las prácticas finalizadas con pendientes también se muestran.

El resumen se obtiene con `PracticaService.obtenerResumenIncidenciasPendientes(limit, offset)`,
que envía solo `limit` y `offset` (sin identidad, roles ni filtros) mediante el
interceptor JWT existente. Modelos: `PracticaIncidenciasPendientesItem` y
`ResumenIncidenciasPendientesResponse`.

Estrategia: el backend ordena el resumen por antigüedad de la incidencia pendiente y no
admite filtrar por ids ni por RUT; sus offsets no corresponden a las páginas del listado.
Por eso no se emparejan páginas. El componente carga el resumen completo una sola vez,
en páginas de 100, y lo cruza por `id_practica` con la página visible. Cambiar de
página o buscar por RUT no vuelve a pedir el resumen. Un nuevo montaje del componente
(o el reintento manual) sí lo recarga. Cuantitativamente: 1 petición de listado y
1 + ⌈N/100⌉ de resumen, donde N es el número de prácticas con pendientes. No hay
petición por práctica.

Validación del resumen antes de usarlo: `limit` y `offset` coherentes, `hay_mas`
consistente con una página completa, ids y contadores enteros seguros, fechas válidas
y sin ids duplicados. Cualquier fallo, incluido un id fuera del rango seguro de
JavaScript, deja el resumen en error. No se presentan ceros: una práctica ausente
cuenta como cero solo tras un resumen completo y válido.

Estados: cargando (`Cargando incidencias…`), listo y error. Un error del resumen muestra
un aviso con reintento manual y no oculta ni altera el listado de prácticas. Para
roles distintos de GESTOR/ADMINISTRADOR el resumen no se solicita. La UI no es una
barrera de seguridad: la autorización definitiva es del backend.

Sin localStorage. Sin lógica frontend para históricos (`ABIERTA`, `EN_REVISION`,
`CERRADA`): el backend ya los excluye.


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


### EP06 / HU015: registro Angular persistente (etapa histórica anterior al GET)

El formulario compartido `/practicas/:id/incidencias/nueva` utiliza
`PracticaService.registrarIncidencia()` y el interceptor JWT existente para
`POST /practicas/{id}/incidencias`. Envía exclusivamente tipo y descripcion;
no envía identidad, fecha, estado, prioridad ni resolución.
Los códigos son ABANDONO, PROBLEMA_CENTRO, SALUD y OTRO. La descripción exige
contenido y hasta 2000 puntos de código Unicode, conservando espacios exteriores.
El estado inicial PENDIENTE es de solo lectura; no se solicita fecha local.
Se habilita el alta solo con detalle EN_CURSO no final; FastAPI/PostgreSQL
conservan la autorización definitiva y la comprobación atómica del estado.

Solo HTTP 201 con respuesta compatible confirma éxito. Se muestra exclusivamente
la fecha recibida del servidor, formateada mediante la utilidad existente para
America/Santiago. No se navega automáticamente a un historial no implementado.
Bloquea doble envío, altas confirmadas y reenvío ante resultados inciertos.
Errores 401/403/404/409/422/500/503 tienen mensajes propios, sin detalles internos.
401 limpia sesión/contexto y navega a login. No hay reintentos automáticos.

El cambio de paramMap cancela suscripciones y limpia campos, fecha, mensajes y
bloqueos. Cancelar HTTP no garantiza deshacer una escritura ya recibida en backend.
El bloqueo es local a la instancia: no proporciona idempotencia después de navegar
ni recargar. Continúa la limitación de precisión BIGINT representados como number.

El formulario y la pestaña Incidencias del detalle ya no leen ni escriben
RegistroPracticaService/localStorage. El almacenamiento antiguo permanece intacto
como demostración, sin migración ni asignación de autor. La pestaña informa que
la consulta persistente está pendiente y no muestra contador ni historial local.
Esto sustituye la presentación de incidencias descrita en las etapas históricas
EP05 anteriores. HU013 y HU014 conservan sus contratos y operaciones.

Validación de este incremento: 149/149 pruebas Angular con Chromium Headless,
build de producción aprobado y diff sin errores de whitespace. Se cubren contrato
HTTP/JWT, tipos, validación, fecha servidor en Santiago, errores, doble envío,
Router real reutilizando componente y conservación de demostraciones sin mostrarlas.
HTTP está simulado mediante HttpTestingController; no se ejecutó E2E con backend.
Karma necesitó ejecución fuera del sandbox por EPERM en el puerto 9876.
Persisten las advertencias de presupuesto del bundle inicial y CSS home/detalle.
No se instalaron dependencias ni se modificaron FastAPI o SQL.

### EP06 / HU015: consulta Angular persistente (vigente)

La pestaña Incidencias usa PracticaService.obtenerIncidencias mediante
GET /practicas/{id}/incidencias?limit=50&offset=0 e interceptor JWT existente.
Consulta al abrir la pestaña, solo con contexto GESTOR/ADMINISTRADOR.
El contexto frontend no expone un indicador activo: la comprobación definitiva
de usuario/rol activo permanece en FastAPI/PostgreSQL, sin permisos nuevos.

Contrato: id_practica, items, limit, offset, hay_mas. Los items conservan
id_incidencia, id_practica, id_usuario, tipo nullable, descripcion, estado,
fecha, sin_tipo_registrado, fecha_resolucion nullable y resolucion nullable
(id_historial, id_usuario, fecha, comentario nullable). El autor se muestra por
ID porque la API no devuelve su nombre. No se aplican restricciones de creación
a la lectura: se conservan estados antiguos, descripciones extensas, tipo ausente
y resolución parcial. Las fechas se presentan en America/Santiago sin cambiar
el valor recibido; infinity/-infinity se muestran literalmente.

La lista respeta el orden servidor. Las páginas usan 50 registros, offset y
hay_mas; no hay total inventado. Carga, error, éxito y vacío son estados distintos.
Los errores 401/403/404/422/500/503 no muestran detalles internos. El reintento es
manual; cambiar de pestaña no reintenta un error. 401 limpia sesión y contexto.
Se impiden cargas simultáneas y se cancelan consultas y limpian datos al cambiar
de práctica o destruir el componente.

Tras POST 201 se conserva la confirmación y fecha del servidor en el formulario.
Volver al detalle abre ?vista=incidencias y ejecuta un GET nuevo. No se incorpora
el cuerpo del POST a la lista ni se simulan resultados. Esta etapa sustituye el
aviso de consulta pendiente descrito en la etapa histórica anterior.
No se lee, escribe, migra ni elimina localStorage.

Validación: suite Angular completa 166/166 con ChromeHeadless y build de producción
aprobado. Pruebas de contrato/JWT con HttpTestingController, componentes con
servicios simulados y retorno de formulario mediante RouterTestingHarness.
No se ejecutó E2E contra FastAPI/PostgreSQL en esta tarea. Karma requirió permiso
para abrir el puerto local 9876 fuera del sandbox. Persisten advertencias de
presupuesto: bundle inicial 857,31 kB; CSS detalle 5,27 kB y home 6,37 kB.
Persisten los límites de precisión BIGINT/number, desplazamiento de offset por
inserciones concurrentes y falta de idempotencia de escrituras.
HU016/HU017 permanecen fuera de alcance.

### EP06 / HU016: gestión Angular e historial completo (vigente)

La pestaña Incidencias incorpora el panel IncidenciaEstado para la selección actual.
Reutiliza PracticaService, HttpClient, interceptor JWT y contexto AuthStore.
No modifica backend, SQL ni los contratos anteriores de HU013/HU014/HU015.

PATCH /practicas/{practica}/incidencias/{incidencia}/estado envía exclusivamente
estado_esperado, estado_nuevo y comentario. El servicio selecciona esos campos
explícitamente y observa HttpResponse para exigir status 200. No envía autor,
fecha, prioridad ni datos de resolución. No hay reintentos de escritura.

GET /practicas/{practica}/incidencias/{incidencia}/historial usa limit=50 y offset.
Respeta el orden recibido id_historial DESC y hay_mas, sin total ficticio.
Presenta origen/destino, ID del responsable, fecha en America/Santiago y comentario
solo cuando existe. Preserva null, textos extensos, estados antiguos y fechas
infinity/-infinity. Carga, vacío y error son estados diferentes; reintento manual.

Los controles requieren GESTOR/ADMINISTRADOR del contexto existente, IDs numéricos
seguros, campos compatibles y cadena inicial coherente consultada desde el servidor.
La comprobación de cadena usa una copia en orden inverso, sin reordenar el listado.
No se infiere elegibilidad solo por tipo presente. Sin evento inicial, cadena
incompatible o RESUELTA, el panel permanece de solo lectura. PostgreSQL conserva
la validación definitiva, incluida actividad del usuario/rol; el contexto Angular
no expone un indicador activo independiente.

Ofrece PENDIENTE→EN_ATENCION/RESUELTA y EN_ATENCION→RESUELTA. No exige práctica
EN_CURSO para gestión: se verificó una incidencia moderna de práctica FINALIZADA.
El comentario sigue btrim U+0020 de borde, whitespace sin contenido→null,
máximo 2000 puntos de código Unicode tras normalización; RESUELTA exige contenido.

Antes de 200 no cambia el estado visible. Comprueba correspondencia del resultado
y solicita recarga del listado mediante GET, sin insertar ni modificar filas
simuladas. Responsable, fecha y comentario de resolución se muestran desde ese GET.
409 informa conflicto o historial incompatible y fuerza recarga. Red/5xx o respuesta
inesperada se presentan como resultado incierto y fuerzan consulta, nunca como
confirmación de fallo o éxito. Mientras se consulta, no quedan filas antiguas
gestionables; si GET falla se ofrece reintento de lectura.

Durante PATCH bloquea doble envío, selección de otra incidencia, paginación y
cambio de pestaña. Al cambiar de práctica o selección se limpian estado/formulario
y se cancelan suscripciones; las respuestas anteriores no actualizan la nueva
selección. Cancelar HTTP no garantiza revertir una escritura ya recibida.
No se accede a localStorage ni se migran o eliminan demostraciones.

BIGINT sigue representado como number en los contratos existentes. El panel
rechaza nuevas consultas/transiciones si los identificadores de recurso no son
enteros positivos seguros o no corresponden a la práctica. Esto evita construir
URLs con IDs redondeados; no recupera precisión ya perdida ni migra el resto de
contratos a string. Resolver ese límite global requiere un cambio posterior.

Validación ejecutada: 190/190 pruebas Angular con ChromeHeadless, incluidos
contrato HTTP/JWT, panel, retorno al listado por GET, finalizadas y regresiones.
Build de producción aprobado; git diff --check sin errores. Karma requirió permiso
fuera del sandbox para el puerto 9876. Se corrigió un literal tipado del fixture
durante compilación de tests, sin cambiar contratos.
Advertencias de presupuesto existentes: bundle inicial 857,33 kB,
CSS detalle 5,27 kB y home 6,37 kB. No se instalaron dependencias.
HTTP se simula mediante mocks/HttpTestingController: E2E HU016 queda pendiente.
Persisten límites de idempotencia y offset. HU017 permanece fuera de alcance.
