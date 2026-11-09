# PracticaLink — Instrucciones para Codex

## Alcance y forma de trabajo
- Estas instrucciones cubren todo el repositorio; respeta el alcance explícito del usuario.
- Trabaja exclusivamente en el worktree indicado. Antes de editar, verifica `pwd`,
  `git rev-parse --show-toplevel`, `git branch --show-current` y el estado Git.
- Si la ruta/rama no coincide o estás en `main`/`develop`, detente y solicita instrucciones.
- Analiza código, contratos y pruebas pertinentes antes de implementar.
- Diagnósticos y auditorías son de solo lectura salvo autorización expresa.
- Preserva modificaciones locales, archivos nuevos y otros worktrees; no toques el stash.
- Haz cambios pequeños y revisables. Separa documentación, refactorización, funcionalidad
  y seguridad cuando tengan objetivos independientes; evita movimientos ajenos al alcance.
- No amplíes la tarea; respeta sus etapas y puntos de detención.

## Modelos y esfuerzo
Esta matriz orienta recomendaciones; `AGENTS.md` no cambia automáticamente el modelo.

| Modelo y esfuerzo | Uso preferente |
| --- | --- |
| Luna Low | Consultas, documentación breve y cambios mínimos de bajo riesgo. |
| Luna Medium | Tests sencillos y ajustes locales de CSS/HTML. |
| Terra Medium | Angular/Ionic de complejidad moderada. |
| Sol Medium | FastAPI, PostgreSQL y desarrollo general. |
| Sol High | Arquitectura, concurrencia y depuración compleja. |
| Astra High | Seguridad crítica excepcional que requiera análisis adicional. |

- Complejidad y riesgo prevalecen sobre tecnología o cantidad de líneas. Permisos,
  identidad y transacciones críticas no son tareas simples por afectar pocos archivos.
- Antes de una tarea significativa, recomienda cambiar modelo/esfuerzo solo si conoces
  el activo y existe una ventaja clara. Explica el motivo en una frase, sin repetirlo.
- No interrumpas tareas pequeñas ni solicites confirmación solo por el modelo.
- El usuario selecciona el modelo. No inventes el activo ni anuncies cambios no realizados;
  un valor de configuración no demuestra por sí solo la selección efectiva de la sesión.
- La disponibilidad depende del entorno. No delegues ni crees subagentes salvo petición explícita.

## Eficiencia de lectura y comunicación
- Empieza por archivos y funciones citados; amplía la investigación según evidencia.
- Usa `rg`/`rg --files` con rutas y patrones concretos antes de búsquedas generales.
- Lee fragmentos relevantes; archivos completos solo cuando el contexto lo requiera.
- Agrupa consultas independientes y limita su salida. Reutiliza lo ya inspeccionado;
  relee si hubo cambios o persiste una incertidumbre relevante.
- Consulta documentación por área, sin cargarla completa de forma rutinaria.
- Resume logs y conserva causas, errores y resultados útiles; evita volcados extensos.
- Da actualizaciones y respuestas breves, sin repetir contexto, planes ni restricciones.
  Incluye el detalle necesario para revisar decisiones, evidencia y riesgos.
- La corrección y la seguridad prevalecen sobre el ahorro de tokens.

## Arquitectura y contratos
- Conserva el monolito modular Angular/TypeScript/Ionic, FastAPI y PostgreSQL/Supabase.
- Backend por dominio siguiendo `routes.py`, `schemas.py` y `service.py`. Comprueba
  la estructura real antes de mover código de `api/routes/`, `services/` o `schemas/`.
- HTTP y dependencias en rutas; casos de uso en servicios; `core/` para lo transversal.
- Evita ciclos, imports de rutas desde servicios y dependencias de `core/` hacia negocio.
- Documenta dependencias SQL entre dominios. No introduzcas microservicios, repositorios
  genéricos, buses u otras abstracciones sin necesidad acordada; refactoriza una responsabilidad a la vez.
- En refactorizaciones conserva métodos/URLs, códigos/mensajes HTTP, modelos públicos,
  campos, tipos, obligatoriedad, defaults, nulabilidad y compatibilidad OpenAPI/TypeScript.
- Preserva autenticación, roles, asignaciones e identidad del usuario autenticado;
  funciones SQL, firmas, parámetros, casts, JSON, sesión, commit/rollback y bloqueos.
- No dividas operaciones SQL atómicas en escrituras independientes.
- No cambies contrato, consulta o autorización de `GET /auth/context` como efecto
  secundario de mover archivos. Cambios de comportamiento requieren alcance explícito y pruebas propias.
- No edites migraciones aplicadas; utiliza migraciones incrementales.

## Seguridad y operaciones sensibles
- No expongas secretos, tokens, contraseñas, conexiones ni datos personales en código,
  pruebas, documentación, logs o respuestas. No vuelques `.env` ni uses credenciales
  de demostración documentadas para acceder a servicios; usa datos sintéticos en pruebas.
- No accedas a bases reales ni ejecutes SQL, migraciones o cambios de permisos sin
  autorización explícita para el entorno y la operación. Las pruebas unitarias no
  se conectan a Supabase ni a proveedores externos.
- No instales/actualices dependencias, ejecutes servicios externos, inicies/detengas
  servicios, despliegues o cambies configuración de seguridad sin autorización dentro de la tarea.
- Reporta vulnerabilidades con evidencia sin secretos; no las corrijas automáticamente
  dentro de una refactorización ni amplíes el alcance sin autorización.
- Prepara resultados revisables y espera revisión humana antes de operaciones sensibles.
  Un permiso técnico no constituye autorización funcional.
- Guards y controles visuales no sustituyen la autorización backend/SQL.

## Frontend
- Conserva TypeScript y plantillas estrictas; no uses `any` ni ignores errores para eludir controles.
- Mantén HTTP en servicios y modifica el contexto mediante los métodos de `AuthStore`.
- Respeta `perfil`/`practica_actual` nullable, guards y estados de carga, error y recuperación.
- Respeta `.editorconfig` y Prettier de `package.json`; evita formato masivo y renombrados ajenos.
- Usa `NG_CLI_ANALYTICS=false` con Angular CLI; no alteres `angular.json` por Analytics.

## Pruebas y validación
- Backend: sigue `unittest`, `unittest.mock` y `TestClient`. Antes de trasladar una
  funcionalidad, añade pruebas de caracterización donde falten.
- Prueba comportamiento observable, permisos, identidad y errores relevantes.
  Conserva pruebas y aserciones; no las debilites para ocultar fallos.
- Aísla base de datos/proveedores con mocks en pruebas unitarias. Restaura patches y
  `dependency_overrides`; al mover símbolos, actualiza mocks donde se utilizan.
- Distingue mocks de PostgreSQL real: los primeros no acreditan SQL, bloqueos ni atomicidad.
- Ejecuta primero pruebas focalizadas; amplía según riesgo, dependencias afectadas o fallos.
  Ejecuta suite completa y build cuando el alcance o el usuario lo exijan; para cambios
  frontend relevantes, ejecuta build si está permitido y hay dependencias locales.
- Respeta restricciones de solo lectura: no ejecutes validaciones que escriban artefactos
  salvo autorización. Informa antes de tests/build frontend que generen caché o artefactos.
- Si falta una dependencia, navegador o permiso, informa sin instalar herramientas.
  No inventes comandos de lint/formato ni descargues herramientas mediante `npx`.
- Reporta comandos y resultados reales: aprobados, fallidos y no ejecutados; separa deuda de regresiones.

Desde `PracticaLink/backend`, utiliza el entorno virtual existente:
```bash
.venv/bin/python -B -m unittest tests.nombre_del_modulo -v
.venv/bin/python -B -m unittest discover -s tests -v
```
Desde `PracticaLink/frontend`:
```bash
NG_CLI_ANALYTICS=false npm test -- --watch=false --browsers=ChromeHeadless
NG_CLI_ANALYTICS=false npm run build
```

## Git y revisión humana
- Codex usa Git exclusivamente en modo de lectura. Solo el usuario realiza TODAS
  las operaciones Git de escritura, incluida preparación del índice, creación/cambio
  de ramas, commits, integración y publicación. No manipules el stash ni descartes cambios.
- El flujo objetivo es `feature/*` o `fix/*` hacia `develop` mediante PR; `main` recibe
  versiones estabilizadas mediante PR separado. Esto no autoriza a Codex a ejecutar esas operaciones.
- No actualices automáticamente el checkout ni incluyas cambios ajenos en la entrega.

## Code Review Rules
- Prioriza permisos omitidos, identidad tomada del cliente y exposición de secretos.
- Revisa compatibilidad HTTP/OpenAPI/TypeScript/SQL, atomicidad, commit/rollback,
  dependencias circulares y acoplamientos nuevos.
- Exige evidencia proporcional al cambio; distingue defectos confirmados, riesgos y aspectos no verificados.

## Documentación y entrega
- Consulta según el área: `README.md`, `DOCUMENTACION_INSTALACION.md`,
  `PracticaLink/backend/app/BACK_CONTEXT.md`, `PracticaLink/frontend/src/app/APP_CONTEXT.md`,
  migraciones en `PracticaLink/supabase/migrations/`, `scripts/BD/` cuando corresponda y pruebas cercanas.
- Contrasta documentación con código, reporta discrepancias y actualiza solo la documentación
  afectada por el alcance autorizado. No presentes funcionalidades pendientes como implementadas.
- Resume archivos modificados, decisiones, cambios de comportamiento autorizados, comandos,
  pruebas/resultados, riesgos y verificaciones pendientes. No afirmes funcionamiento solo por existir código o tests.
