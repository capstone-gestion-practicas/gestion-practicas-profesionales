# EP04 — Cierre técnico y trazabilidad

Fecha: 17 de octubre de 2026. Referencia de código: `71e61a0`, rama
`feature/ep04-gestion-estados`, 13 commits por delante de `origin/develop`
al redactar este documento. No constituye aprobación académica, aceptación del
PR ni autorización de despliegue.

El incremento implementa consulta de estado, inicio APROBADA → EN_CURSO e
historial de estados en un monolito modular Angular/Ionic + FastAPI + PostgreSQL.
Fue validado localmente; HU04.2 sigue pendiente de habilitación en Supabase.
No incluye nuevas transiciones, cierre de práctica ni funcionalidades de EP05.

## Fuentes y criterio de evidencia

- [Product Backlog](<../Fase 2/Evidencias Grupales/Documento 02- Product Backlog.docx>):
  Historias 010, 011 y 012, correspondientes a HU04.1, HU04.2 y HU04.3.
- [Definition of Done](<../Fase 2/Evidencias Grupales/Documento 04 - Definition of Done.docx>):
  apartados de negocio y técnicos de esas tres historias.
- [Documento de Diseño](<../Fase 2/Evidencias Grupales/Documento 05 - Documento de Diseño.docx>).
- [Contexto backend](../PracticaLink/backend/app/BACK_CONTEXT.md),
  [contexto frontend](../PracticaLink/frontend/src/app/APP_CONTEXT.md) y
  [esquema SQL](../scripts/BD/schema.sql).

Los documentos académicos originales no se modifican. «Implementado» indica
evidencia en código; «validado localmente» identifica pruebas ejecutadas, sin
extender sus conclusiones a Supabase. «Pendiente» no equivale a aprobado.
Los resultados siguientes proceden de las ejecuciones locales anteriores de
esta rama; no se repitieron para redactar este documento.

## Matriz de trazabilidad

Las rutas y archivos citados a continuación son relativos al repositorio.

| Historia / requisito | Implementación | Prueba / evidencia | Estado y límites |
| --- | --- | --- | --- |
| HU04.1: cada práctica tiene estado identificable y se consulta el actual | `practica.id_estado_actual` y catálogo `estado_practica`; `GET /practicas/me`, listado y detalle | `backend/tests/test_practicas.py`, `test_practicas_service.py`, `test_practicas_listado.py`, `test_practicas_detalle_gestion.py` | Implementado; las lecturas no reparan diferencias entre estado actual e historial |
| HU04.1 / DoD: mostrar fecha del último cambio | Subconsulta de `historial_estado` por `fecha_cambio DESC, id_historial DESC`; Home, listado y detalle | Tests de prácticas, servicio y specs de Home/detalle/listado | Validado localmente; sin historial devuelve null y muestra «Fecha no disponible» |
| HU04.1 / DoD: estudiante consulta solo su práctica | `/practicas/me` utiliza identidad autenticada, sin identificador de práctica del cliente | Tests de identidad y autorización de prácticas | Implementado y cubierto por mocks |
| HU04.1 / DoD: coordinador consulta todas | Listado con paginación y RUT exacto; detalle por ID; roles GESTOR/ADMINISTRADOR; incluye estados finales | `test_practicas_listado.py`, `test_practicas_detalle_gestion.py`; specs de listado, detalle y rutas | Implementado; equivalencia COORDINADOR–GESTOR pendiente de aceptación |
| HU04.1 / DoD: informar práctica inexistente | HTTP 404 y mensajes de interfaz | Tests de consultas/detalle y specs de detalle | Validado localmente |
| HU04.2: modificar y persistir estado por usuario autorizado | PATCH de inicio; función privada `fn_iniciar_practica`; identidad del JWT | `test_practicas_inicio.py` y suite de integración reproducible | APROBADA → EN_CURSO validado localmente; despliegue pendiente |
| HU04.2 / DoD: transiciones definidas, impedir cambios finales y explicar rechazo | Destino literal EN_CURSO, comprobación SQL del origen y de `es_final`, errores 409 | Unitarias de inicio e integración real de transiciones, repetición y estados finales | Cubierto para la transición aprobada; no se implementan destinos arbitrarios |
| HU04.2 / DoD: registrar anterior, nuevo, usuario y fecha | SQL devuelve ambos estados e inserta nuevo estado, responsable y fecha en historial; anterior derivado al consultar | Integración de persistencia/timestamp y tests del historial | Nuevo, usuario y fecha persistidos; aceptación de anterior derivado pendiente |
| HU04.2: cambio disponible para consulta | Angular recarga detalle e historial después de 200 y 409 | `practica-inicio.spec.ts` y simulación local Firefox | Validado; nunca se actualiza anticipadamente el estado visual |
| HU04.3: conservar cambios, secuencia y asociación a práctica | `GET /practicas/{id}/historial`; SQL filtrado por práctica y orden cronológico determinista | `test_practicas_historial.py`, `practica-historial.spec.ts` | Implementado; pruebas de consulta con mocks no equivalen a ejecución real de LAG |
| HU04.3 / DoD: mostrar fecha, anterior, nuevo y responsable | Modelos específicos e historial en detalle de gestión | Tests de contrato, paginación, fechas y presentación | Validado por tests; primer anterior disponible puede ser null |
| HU04.3 / DoD: no editar ni eliminar historial desde API | Ruta GET y sección sin acciones de edición/eliminación | Test de métodos y revisión de rutas/plantillas | Implementado; no acredita inmutabilidad frente a administradores de BD |
| DoD técnico común: OpenAPI, pruebas, Postman, modelo, revisión e issue Done | Esquemas FastAPI y suites versionadas; esquema y documentación técnica | Pruebas backend/frontend e integración enumeradas abajo | Parcial: pytest, Postman, aceptación académica, revisión y estado del issue pendientes |

`backend/tests/` en la tabla abrevia `PracticaLink/backend/tests/`. Los specs
Angular están en `PracticaLink/frontend/src/app/` junto a sus componentes y servicios.

## Contratos, permisos y límites funcionales

| Endpoint | Roles | Responsabilidad |
| --- | --- | --- |
| `GET /practicas/me` | ESTUDIANTE | Consulta propia, con fecha de último cambio nullable |
| `GET /practicas` | GESTOR, ADMINISTRADOR | Todas las prácticas; RUT exacto opcional, limit/offset/hay_mas |
| `GET /practicas/{id}` | GESTOR, ADMINISTRADOR | Antecedentes, estado actual y fecha del último evento |
| `GET /practicas/{id}/historial` | GESTOR, ADMINISTRADOR | Eventos cronológicos paginados |
| `PATCH /practicas/{id}/estado` | GESTOR, ADMINISTRADOR | Exclusivamente inicio APROBADA → EN_CURSO |

El RUT del listado se valida mediante el validador compartido; no se devuelve
en los resúmenes. El detalle y el historial exponen solo los datos aprobados,
sin correo, RUT o teléfono. Falta comprobar redacción efectiva de logs del
servidor/proxy: un filtro GET puede aparecer en logs de acceso.

El estudiante no tiene acceso al historial de gestión en este incremento.
El DoD de Historia 012 habla de usuario autorizado sin exigir explícitamente
acceso estudiantil; no se presupone ese permiso ni se amplía automáticamente.

### Equivalencia de roles: propuesta, no decisión académica aprobada

Los documentos utilizan «coordinador de prácticas»; el código utiliza GESTOR y
ADMINISTRADOR. Se propone considerar GESTOR equivalente funcional a COORDINADOR
para estas historias, manteniendo ADMINISTRADOR como rol adicional autorizado
según el alcance técnico aprobado. No existe un alias automático COORDINADOR
ni se cambia el catálogo de roles. Requiere aceptación académica explícita.

### Catálogo y transición aprobada

El DoD de Historia 010 enumera Registrada, Observada, Rechazada, En curso y
Finalizada. El catálogo real contiene REGISTRADA, EN_REVISION, OBSERVADA,
APROBADA, EN_CURSO, FINALIZADA y RECHAZADA. Los dos estados adicionales sostienen
el flujo existente de EP03 y el inicio de EP04. Debe aceptarse/documentarse esta
diferencia; no se interpreta como autorización para eliminar estados.

| Origen | Destino | Actor | Condiciones |
| --- | --- | --- | --- |
| APROBADA | EN_CURSO | GESTOR o ADMINISTRADOR activo | Rol vigente en PostgreSQL; práctica bloqueada; último evento existente y coincidente; destino activo y no final; observación válida |
| Cualquier otro, incluidos EN_CURSO y finales | EN_CURSO | Cualquiera | Rechazado; no se inserta evento nuevo |

La función usa SELECT FOR UPDATE en la práctica y bloqueos de autorización y
catálogo. Rechaza historial ausente, diferente o con fecha futura. Obtiene un
instante después de los bloqueos para actualizar la práctica e insertar
exactamente un evento. No contiene COMMIT; FastAPI confirma solo tras validar
éxito y revierte ante error. Las observaciones se normalizan con espacios de
extremos a null y se limitan a 500 caracteres después de normalizar.

El ejemplo «Registrada → En curso» del DoD no se convierte en una transición
implementada. Las decisiones de revisión existentes permanecen en EP03;
el cierre y otras transiciones no forman parte de este incremento.

### Estado anterior derivado y calidad del historial

`historial_estado` no tiene columna específica de estado anterior. Guarda
`id_estado`, `id_usuario`, `fecha_cambio` y `observacion`, además de sus claves.
HU04.3 calcula `LAG(id_estado)` sobre toda la secuencia de cada práctica, por
`fecha_cambio ASC, id_historial ASC`, antes de aplicar paginación.

El primer evento disponible tiene anterior null y se muestra como «Sin estado
anterior registrado»: no se afirma que sea el alta. Se conservan eventos
repetidos y observaciones nulas. No se fabrican eventos ni se reparan datos.
Con historial incompleto, el anterior real de un evento puede ser desconocido.
Las lecturas tampoco garantizan consistencia si otros escritores alteran datos
fuera del protocolo. La derivación satisface la presentación de una secuencia
completa, pero no equivale a persistir explícitamente ambos estados; requiere
aceptación frente a la redacción del DoD de Historia 011.

## Pruebas ejecutadas y alcance de la evidencia

| Validación | Resultado registrado | Alcance |
| --- | --- | --- |
| Angular completo, Firefox Headless 158.0 | **89/89**, 0 fallidas, 0 omitidas | Ejecución real tras corregir únicamente el setup de `app.spec.ts`, incluido en `71e61a0` |
| Backend unittest | **198/198** | Tests de aplicación con mocks; no acreditan por sí solos SQL real |
| Integración reproducible PostgreSQL 18.6 | **9/9 por ejecución** | Se ejecutó además en dos procesos simultáneos independientes, ambos aprobados |
| Limpieza del harness, con mocks | **8/8** | Interrupciones/timeouts, propiedad y fallos de limpieza; suite separada de las 198 |
| Build Angular y TypeScript app/spec | Correctos | Persisten advertencias: bundle inicial 834,68 kB frente a 500 kB y Home SCSS 7,37 kB frente a 4 kB |

La integración reproducible usa TestClient, router, servicio, SQLAlchemy y
PostgreSQL reales; simula únicamente identidad/contexto y la dependencia
principal de lectura. Comprueba estado persistido, evento único, responsable,
timestamp compartido, rollback tras fallo real de INSERT, denegación de
escrituras directas, configuración ausente y dos solicitudes concurrentes.
No valida el JWT completo contra una base real ni los permisos de Supabase.

Resultados exploratorios anteriores: API–PostgreSQL 39/39 y diseño SQL 90/91.
No son el conteo de la suite versionada de nueve pruebas. Sus harness e informes
originales fueron temporales y no deben considerarse evidencia reproducible
desde un checkout limpio. La suite versionada no incluye todas aquellas carreras
de catálogo/roles, ataques de search_path ni la concurrencia de EP03.

En la simulación UI se comprobaron confirmación, cancelación sin PATCH,
observación inválida, bloqueo de doble envío y respuestas 200/409/503. Un corte
abrupto produjo dos PATCH en Firefox, pese a una sola llamada al servicio y un
`XHR.send()`; también se reprodujo con XHR sin Angular. La aplicación no implementa
reintentos automáticos y ofrece consultar estado/historial ante resultado incierto.
PostgreSQL rechaza una transición repetida. No se verificó el transporte en otros
navegadores; no se promete ausencia de retransmisión HTTP.

## Reproducción

Requiere las dependencias declaradas ya instaladas. Los comandos no instalan
paquetes ni habilitan Supabase. No usar credenciales reales. Los conteos anteriores
corresponden al código de referencia y pueden cambiar en revisiones posteriores.

### Backend e integración

Desde `PracticaLink/backend`:

```bash
.venv/bin/python -B -m unittest discover -s tests -v
.venv/bin/python -B tests/integration/run_inicio_practica.py --unit-cleanup
.venv/bin/python -B tests/integration/run_inicio_practica.py --docker-local
```

El último comando crea y elimina recursos Docker locales exclusivos: necesita
socket Unix local, imagen PostgreSQL 18.6 ya disponible y conectividad Linux
del host hacia su red interna. No publica puertos, descarga imágenes ni admite
URL externa. Ver [instrucciones y límites completos del harness](../PracticaLink/backend/tests/integration/README.md).

### Angular

Desde `PracticaLink/frontend`:

```bash
npm run build
./node_modules/.bin/tsc --noEmit -p tsconfig.app.json
./node_modules/.bin/tsc --noEmit -p tsconfig.spec.json
```

Con Chrome compatible ya instalado, el comando habitual es
`npm test -- --watch=false --browsers=ChromeHeadless`. No fue el navegador de la
ejecución 89/89: se utilizó Firefox con un launcher temporal, sin instalar
`karma-firefox-launcher` ni modificar `angular.json`. Para reproducirlo en Linux
con `/usr/bin/firefox`, crear la configuración fuera del repositorio:

```bash
EP04_KARMA_TMP=$(mktemp -d)
cat > "$EP04_KARMA_TMP/karma.cjs" <<'JS'
const fs = require('node:fs');
const path = require('node:path');
const localRequire = require('node:module').createRequire(path.join(process.cwd(), 'package.json'));
function FirefoxTemporary(baseBrowserDecorator) {
  baseBrowserDecorator(this);
  this._getOptions = url => {
    fs.writeFileSync(path.join(this._tempDir, 'user.js'), [
      'user_pref("browser.shell.checkDefaultBrowser", false);',
      'user_pref("datareporting.policy.dataSubmissionEnabled", false);',
      'user_pref("toolkit.telemetry.enabled", false);',
      'user_pref("network.captive-portal-service.enabled", false);',
      'user_pref("network.connectivity-service.enabled", false);'
    ].join('\n'));
    return ['--headless', '--no-remote', '--profile', this._tempDir, url];
  };
}
FirefoxTemporary.$inject = ['baseBrowserDecorator'];
FirefoxTemporary.prototype = {
  name: 'FirefoxTemporary', DEFAULT_CMD: { linux: '/usr/bin/firefox' }, ENV_CMD: 'EP04_FIREFOX_BIN'
};
module.exports = config => config.set({
  frameworks: ['jasmine'],
  plugins: [localRequire('karma-jasmine'), {
    'launcher:FirefoxTemporary': ['type', FirefoxTemporary]
  }],
  browsers: ['FirefoxTemporary'], reporters: ['dots'],
  hostname: '127.0.0.1', listenAddress: '127.0.0.1', port: 9877,
  singleRun: true, autoWatch: false, browserNoActivityTimeout: 60000,
  client: { jasmine: { random: false } },
  customHeaders: [{match: '.*', name: 'Content-Security-Policy', value: "connect-src 'self' ws://127.0.0.1:9877"}]
});
JS
./node_modules/.bin/ng test --watch=false \
  --karma-config="$EP04_KARMA_TMP/karma.cjs" --browsers=FirefoxTemporary
```

El puerto 9877 debe estar libre; no detener servidores ajenos para liberarlo.
Karma gestiona su perfil temporal. Build y tests pueden generar caché y artefactos
ignorados por Git. Un navegador ausente o permiso insuficiente es un bloqueo de
ejecución, no un test aprobado. La configuración temporal no sustituye una futura
decisión de automatización permanente del equipo.

## Pendiente académico y limitación de EP03

El DoD exige pytest; el proyecto utiliza unittest, unittest.mock y TestClient,
según AGENTS.md. Las pruebas pasan, pero ello no acredita el cumplimiento literal
de pytest. Debe aceptarse formalmente la equivalencia o acordarse un ajuste del
criterio; este documento no la concede ni propone migrar el framework por su cuenta.

En el ensayo exploratorio concurrente, `fn_revisar_practica` esperando a un inicio
devolvió `SOLICITUD_NO_ENCONTRADA` en vez del esperado `SOLICITUD_NO_REVISABLE`.
Se informó como comportamiento preexistente; `schema.sql` y la función de EP03
no se modificaron. El estado final observado fue EN_CURSO con un solo evento
nuevo. Es una anomalía semántica de respuesta, no evidencia de una escritura
duplicada. No se reprodujo durante esta tarea documental ni está cubierta por
los nueve tests de integración; registrar su seguimiento separado antes de
considerarla resuelta. Las pruebas finitas no demuestran ausencia general de deadlocks.

## Requisitos antes de habilitar HU04.2 en Supabase

No se aplicaron scripts ni se comprobó el entorno remoto. Requiere autorización
explícita y revisión humana específica del despliegue:

1. Inspeccionar versión, esquema, datos e historial reales, propietarios, RLS,
   políticas, membresías, grants y default privileges. No reparar datos automáticamente.
2. Verificar facultades del instalador para roles, políticas, esquema privado y
   transferencia de propiedad. Los scripts fallan ante objetos ya existentes;
   no son una migración idempotente ni deben sobrescribir objetos sin revisión.
3. Revisar orden de instalación: esquema base para una base vacía; bootstrap
   `ep04-01-permisos-iniciar-practica.sql`; función `ep04-fn-iniciar-practica.sql`.
   No ejecutar `schema.sql` sobre la base existente como actualización.
4. Mantener propietario técnico NOLOGIN, sin privilegios administrativos ni
   BYPASSRLS, no propietario de tablas, con los permisos mínimos y políticas RLS
   revisadas. Mantener search_path seguro y nombres calificados.
5. Provisionar un login backend dedicado, con solo la capacidad ejecutora
   necesaria, sin escritura directa ni posibilidad de asumir el propietario.
   Auditar también permisos heredados/PUBLIC; no asignar el ejecutor a clientes.
6. Confirmar que `practicas_privadas` no esté expuesto por la Data API y que solo
   el ejecutor/propietario autorizado pueda ejecutar la firma, sin wrapper público.
7. Configurar `INICIO_PRACTICA_DATABASE_URL` mediante gestión de secretos, con
   identidad distinta de la principal y transporte adecuado al despliegue.
   No versionar URLs ni credenciales. No cambiar la conexión compartida de EP03.
8. Validar en un entorno autorizado permisos efectivos, atomicidad, concurrencia,
   compatibilidad de EP03 y respuestas HTTP. Planificar recuperación/rollback y
   tratamiento operativo de resultados inciertos sin reintentar escrituras.

Sin configuración restringida, HU04.2 devuelve 503; los endpoints previos siguen
usando su conexión existente. La identidad del actor SQL es una afirmación del
backend de confianza obtenida del JWT, no una validación JWT dentro de PostgreSQL.

## Evidencias y decisiones pendientes para cierre académico

| Pendiente | Estado / acción necesaria |
| --- | --- |
| Equivalencia COORDINADOR–GESTOR y permiso adicional ADMINISTRADOR | Solicitar aceptación académica; no aprobada por este documento |
| Catálogo de siete estados frente al DoD | Aceptar/documentar compatibilidad con EP03 e inicio APROBADA → EN_CURSO |
| Estado anterior derivado | Aceptar explícitamente su alcance ante historial completo/incompleto |
| unittest frente a pytest | Resolver criterio académico sin darlo por equivalente automáticamente |
| Colección Postman actualizada y ejecutada | No identificada en la auditoría; preparar evidencia sin credenciales reales |
| Modelo de datos académico | Contrastar sus tablas/relaciones con el esquema; validación formal pendiente |
| Verificación de criterios en entorno académico de pruebas | Evidencia local disponible; aceptación en el entorno requerido pendiente |
| PR revisado por otro integrante e integración a rama principal | Pendiente; este documento no realiza ni sustituye revisión o merge |
| Issue de GitHub Projects en Done | No verificado; actualizar solo después de aceptación |
| Habilitación Supabase y seguimiento de anomalía EP03 | Pendientes operativos separados; no presentarlos como resueltos |

Estado de cierre: incremento implementado y validado localmente con pruebas
versionadas; listo para revisión técnica. Cierre académico, integración y
habilitación del entorno real permanecen sujetos a las decisiones y evidencias
anteriores.
