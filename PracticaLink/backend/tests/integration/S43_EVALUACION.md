# S4.3 — Evaluación académica: seguridad y validación local

Registro documental actualizado el 2026-11-08. SQL (B), FastAPI (C) e interfaz Angular
(D) están implementados localmente. E03, E04 y E05 tienen validación local; E06
actualiza este registro sin repetir suites. No se acredita despliegue ni verificación
en Supabase real. No desplegar la migración aislada sin coordinar la aplicación.

Contratos y detalles de interfaz: [backend](../../app/evaluaciones/README.md) y
[frontend](../../../frontend/src/app/features/evaluaciones/README.md).

## Modelo y operaciones

- `evaluacion_informe` fija práctica, entrega CONFIRMADA, documento, versión,
  SHA-256 y docente. Estados operativos EN_CURSO/RESUELTA/INTERRUMPIDA;
  resultados exclusivamente APROBADO/CON_OBSERVACIONES, sin notas.
- `evaluacion_evento` conserva eventos de inicio/resolución/interrupción.
  Una pendiente por práctica y una resolución final por documento. Se permiten
  nuevas evaluaciones tras interrupción, nunca rectificar una resolución final.
- `iniciar_evaluacion(p,actor,uuid_inicio,documento,version)` verifica DOCENTE
  activo asignado, no propietario estudiante, EN_CURSO, informe ENTREGADO confirmado.
- `resolver_evaluacion(p,actor,uuid_resolucion,evaluacion,resultado,observaciones)`
  revalida rol, asignación y versión; observaciones y motivos máximo 2000 caracteres.
  CON_OBSERVACIONES exige texto no blanco y habilita nueva entrega. APROBADO
  bloquea reemplazo automático, no cierra la práctica. Resultado e informe no
  comparten vocabulario: el informe vuelve a ENTREGADO, su habilitación depende
  también de que no exista aprobación definitiva de su versión vigente.
- `historial_evaluacion` autoriza estudiante propietario, gestor responsable o
  docente actualmente asignado. La identidad administrativa sola no concede acceso.
- El cambio/retiro por `docente_privado.fn_gestionar_asignacion` interrumpe la
  pendiente, conserva actor y motivo y devuelve el informe a ENTREGADO en la misma
  transacción. Un fallo de historial revierte también la interrupción.
- Una aprobación previa a la reasignación sigue siendo válida para su PDF exacto.
  El anterior docente pierde acceso inmediatamente después del commit.

El documento/entrega confirmado y los eventos no admiten alteraciones. El flag
`documento.activo` puede desactivarse al reemplazar una versión CON_OBSERVACIONES;
no cambia sus bytes, hash, ruta ni evaluación. Los PDF aprobados no se reemplazan.
La consistencia evaluación/estado/eventos/entrega vigente se valida al commit.
Una reasignación no equivale a rectificación. Reapertura/rectificación quedan pendientes.
No se escanean ni reparan asignaciones históricas: si una identidad DOCENTE coincide
con el estudiante, no puede evaluar y debe reemplazarse por el GESTOR responsable.

## Concurrencia

Las operaciones integradas toman primero un advisory transaction lock por práctica
(hash de `practicalink-academico:<id>`) y luego los bloqueos de identidad, práctica,
informe, evaluación y reserva necesarios. Una colisión de hash solo serializa.
Este orden integra S4.1, S4.2, evaluación, revisión inicial, inicio EP04, cambio
EP07 de estado y reasignación de GESTOR. No se cambiaron sus contratos de entrada.
El bloqueo de usuario de reasignación de GESTOR pasa de UPDATE a SHARE: la función
no actualiza usuarios y conserva protección frente a su desactivación concurrente.

El gate no sustituye FOR SHARE/FOR UPDATE, las verificaciones de versión ni los
índices únicos. Se mantiene hasta commit/rollback. Las invocaciones externas de
DML que no sigan el protocolo pueden provocar deadlocks: PostgreSQL debe abortar
una transacción; el backend traduce 40P01/40001/55P03 a 409, sin éxito parcial ni reintentos
no idempotentes. La evaluación no mantiene transacciones abiertas durante IO Storage.

## Cierre y transición histórica

`public.fn_cerrar_practica(bigint,bigint,text)` conserva firma y JSON de éxito,
pero ahora es SECURITY DEFINER de `pl_s43_cierre_owner`, NOLOGIN/NOBYPASSRLS,
sin propiedad de tablas y con columnas/INSERT limitados a cierre, historial,
notificación y estado de práctica. El ejecutor autorizado sigue siendo
`pl_s42_executor`; ningún rol administrativo constituye una excepción académica.

La barrera exige GESTOR activo responsable, EN_CURSO, fecha de término alcanzada
(según calendario America/Santiago), informe confirmado vigente y evaluación
RESUELTA/APROBADO de ese documento/version/hash, sin otra evaluación pendiente.
Los cierres nuevos referencian la evaluación mediante `id_evaluacion`.
La observación de cierre conserva el contrato EP07 existente de máximo 500
caracteres; las observaciones académicas y motivos de reasignación admiten 2000.

Triggers protegen INSERT/UPDATE finales de práctica, registros de cierre y eventos
FINALIZADA de historial. E03 incorpora DELETE y revisa OLD y NEW en ambos triggers:
un registro histórico FINALIZADA no admite modificación ni borrado, aunque se intente
cambiar a un estado no final. Esto también protege registros anteriores a S4.3 sin
crear evaluaciones retroactivas. El gate invocador requiere el propietario privado de cierre,
incluso si una conexión general posee DML heredado. Los triggers de contenido
revalidan evidencia y autorización; el ejecutor backend no recibe DML ni membresía
de propietarios. Superusuarios/instaladores capaces de desactivar triggers o
alterar funciones quedan fuera de este límite de confianza.

`estado_practica=APROBADA` sigue siendo aprobación INICIAL, sin evaluación académica.
No se alteran ni se rellenan cierres históricos: la FK nueva queda NULL en ellos.
No se crean evaluaciones ficticias ni se reabren prácticas FINALIZADAS. Los cierres,
evaluaciones definitivas y eventos quedan protegidos frente a UPDATE/DELETE.
El motivo máximo del historial S4.1 se incorpora NOT VALID para preservar textos
antiguos mientras se exige el límite a nuevos INSERT/UPDATE.

## ACL y despliegue pendiente

- Aplicar toda la migración en una transacción. Aborta ante nombres en conflicto,
  grants de cierre inesperados, clientes miembros de roles privados, falta de RLS
  o ejecutores con DML. Revisar manualmente el entorno; no limpiar grants a ciegas.
- Reutilizar el login backend dedicado miembro únicamente de pl_s42_executor.
  Los IDs actor de estas funciones son afirmaciones del backend confiable derivadas
  del JWT. No exponer informes_privados como RPC ni conceder sus funciones a clientes.
- `pl_s41_docente_owner` solo recibe los helpers internos indispensables para la
  interrupción; no se amplían los permisos del ejecutor S4.1 sobre evaluaciones.
- El backend ya usa la conexión restringida para evaluar y cerrar, exige el rol
  correspondiente y traduce autorización/conflictos sin exponer mensajes SQL.
  El preflight comprueba las firmas S4.3, EXECUTE y ausencia de DML académico.
- La interfaz distingue resultado académico y estado documental, bloquea reemplazos
  durante evaluación o tras APROBADO y exige consulta de aprobación antes del cierre.
  Los controles visuales no sustituyen las autorizaciones SQL.
- No hay rollback que restaure el cierre previo inseguro. Ante fallo, mantener la
  barrera, deshabilitar operaciones académicas y corregir mediante migración futura.
  No borrar evaluaciones/eventos/columnas con datos para retroceder una aplicación.
- No se verificaron principal, Storage, RPC ni permisos del Supabase de destino.

## Validación reproducible

Desde el repositorio, con Docker local e imagen postgres:18.6 ya disponible:

```
python3 -B PracticaLink/backend/tests/integration/run_evaluacion_academica.py --docker-local
```

Biblioteca estándar únicamente, sin dependencias nuevas, .env ni URLs externas.
Cada ejecución crea un contenedor aleatorio propio sin red/puertos, con tmpfs,
verifica versión/aislamiento y lo elimina al terminar, sin eliminar volúmenes.
El instalador sintético prepara fixtures; las operaciones académicas se invocan
con SET ROLE a ejecutores restringidos. Los roles cliente se prueban mediante
llamadas reales y catálogos; no se atribuye autenticación JWT a pruebas SQL.

El runner ejecuta S4.1/S4.2 originales ANTES de actualizar, preserva un cierre
preexistente y verifica S4.1 y la suite S4.3 DESPUÉS. La suite S4.2 anterior contiene
simulaciones por DML de EN_EVALUACION y cierres sin evaluación; esas premisas ya no
son válidas después de S4.3. Se conservó intacta; la suite S4.3 prueba los nuevos
flujos reales y regresiones documentales sin relajar las barreras.
Las pruebas HTTP/JWT y Angular se validaron en C/D; su alcance se distingue a continuación.


## Resultados registrados

| Validación | Resultado | Procedencia y límite |
| --- | --- | --- |
| PostgreSQL 18.6 tras E05 | **39 grupos PASS**, incluidos **20 escenarios concurrentes nuevos** y 11 anteriores | Ejecución local aislada; SQL, restricciones, ACL/RLS, rollback y bloqueos reales |
| FastAPI tras E04 | **29 focalizadas + 54 de regresión aprobadas** | TestClient/JWT y sesiones/proveedores simulados; no demuestra SQL real por sí solo |
| Integración HTTP + PostgreSQL 18.6 | **PASS** | Resultado reportado por el usuario; SQLAlchemy, JWT y login restringido reales; Storage y push simulados |
| Suite backend completa | **457 aprobadas, 19 fallidas históricas de S4.2** | Resultado y clasificación reportados por el usuario; no se atribuyen a S4.3 ni se ocultan; suite completa no repetida tras E03–E05 |
| Angular | **611/611 aprobadas** | Resultado reportado por el usuario; pruebas con mocks, no integración remota |
| Build Angular | **Correcto; 11 advertencias de presupuesto** | Resultado reportado por el usuario; advertencias pendientes, sin reclasificación automática como regresiones |

Las distintas suites pueden compartir casos: no sumar filas como pruebas únicas.
Los 19 fallos históricos requieren su diagnóstico separado; este documento no
inventa causas individuales ni considera verde la suite completa. Tras E04 se
validó regresión focalizada, no se actualizó el total histórico de la suite completa.
E06 contrastó los registros locales E04/E05 y conservó los resultados aportados de
integración/Angular; no volvió a ejecutar tests, build ni migraciones.

## Correcciones locales validadas

- **E03:** ambos triggers del historial cubren UPDATE/DELETE de OLD FINALIZADA y
  conservan la protección de NEW FINALIZADA. `s43_historial_finalizada.sql` prueba
  un principal no superusuario con DML efectivo y RLS, controles no finales,
  cada trigger por separado, rollback y preservación de cierres antiguos/nuevos.
  Los grants/políticas de prueba se revierten; no amplían permisos de producción.
- **E04:** `AcademicRoute` añade `Cache-Control: no-store` en éxitos y errores HTTP
  controlados, incluida validación, sin política global. Las pruebas verifican los
  cuatro endpoints, 400/401/403/404/409/503 y conservación de cabeceras existentes.
- **E05:** `s43_concurrencia_roles.py` incorpora 20 escenarios: desactivación de cuenta,
  retirada de membresía y desactivación del catálogo DOCENTE antes/después de inicio
  y resolución; prácticas distintas con usuarios compartidos; ambos órdenes de
  aprobación/cierre; y rollback de inicio, aprobación y desactivación.
  Las esperas se observan con `pg_blocking_pids`, con timeouts controlados. Se comprueba
  autorización después de esperar, historial consistente y ausencia de duplicados.
  No se reprodujeron defectos de producción en esos escenarios; no constituye prueba
  de ausencia de todas las carreras posibles ni de otros niveles de aislamiento.

E03–E05 están corregidos y validados **localmente**, no desplegados. La barrera de
cierre y APROBADA inicial permanecen separadas. No se modifican cierres históricos.

## Comandos de validación

El comando SQL anterior fue ejecutado tras E05: incluye E03, E05 y regresiones SQL.
Tras E04 se ejecutaron, desde `PracticaLink/backend`:

```bash
.venv/bin/python -B -m unittest tests.test_evaluaciones -v
.venv/bin/python -B -m unittest tests.test_evaluaciones_database tests.test_ep07_practicas tests.test_docentes tests.test_informes -v
```

Reproducción de integración HTTP y suite backend completa desde el mismo directorio:

```bash
.venv/bin/python -B tests/integration/run_evaluacion_backend.py --docker-local
.venv/bin/python -B -m unittest discover -s tests -v
```

La integración HTTP utiliza un laboratorio con red interna sin puertos publicados;
el runner SQL usa `NetworkMode=none`. Ambos requieren Docker local e imagen ya
presente, usan datos sintéticos y eliminan exclusivamente sus recursos temporales.
No se usó Supabase real. No instalar dependencias automáticamente para reproducirlos.
Los comandos Angular están en el README frontend enlazado.

## Riesgos de dependencias pendientes: E01 y E02

No se corrigieron versiones ni dependencias durante E03–E06. Según la auditoría:

- **E01, alta, heredado:** el lockfile fija `@angular/common` 20.3.30, dentro del rango
  afectado por [GHSA-jfgx-762w-99vr](https://github.com/angular/angular/security/advisories/GHSA-jfgx-762w-99vr)
  (corregido en 20.3.34 para esa rama). No se confirmó explotación en los flujos
  académicos, que construyen URLs controladas. Actualizar coordinadamente y validar
  requiere autorización; un build correcto no acredita ausencia de vulnerabilidades.
- **E02, media, heredado de S4.2:** `pypdf>=6,<7` permite la versión local auditada
  6.21.4, afectada por [GHSA-59jv-x5x2-gg4c](https://github.com/py-pdf/pypdf/security/advisories/GHSA-59jv-x5x2-gg4c),
  corregido en 7.0.0. El subproceso limita memoria (512 MiB), CPU (5 s), duración
  (10 s) y concurrencia, mitigando consumo excesivo sin eliminar la vulnerabilidad.
  La actualización/parche y su compatibilidad siguen pendientes de autorización.

No se realizó en E06 una nueva auditoría completa de dependencias transitivas.
Estos riesgos requieren tratamiento o aceptación explícita y justificada antes del despliegue.

## Verificaciones pendientes antes del despliegue

1. Autorizar el destino y comprobar principal backend real, TLS, membresías mínimas,
   propietarios SECURITY DEFINER sin propiedad de tablas ni BYPASSRLS, ACL/RLS y
   EXECUTE. No exponer funciones privadas como RPC ni dar acceso académico a clientes.
2. Verificar Storage S4.2: bucket privado, límites y permisos, carga/descarga y limpieza
   reintentable. El Storage simulado no acredita configuración ni disponibilidad remota.
3. Coordinar migración incremental y aplicación B/C/D, verificar preflight y que el
   proxy conserve `Cache-Control: no-store`. No modificar credenciales ni desplegar
   automáticamente por el hecho de haber pasado pruebas locales.
4. Revisar E01/E02, los 19 fallos históricos y las 11 advertencias; completar validación
   visual móvil, teclado y accesibilidad. Las suites no sustituyen esas verificaciones.
5. Ante fallo, mantener la barrera académica, deshabilitar operaciones afectadas y
   corregir hacia adelante. **Prohibido restaurar funciones de cierre que permitan
   FINALIZADA sin evaluación APROBADO vigente**, o borrar evidencia académica para
   retroceder la aplicación. Conservar intactos los cierres históricos.
