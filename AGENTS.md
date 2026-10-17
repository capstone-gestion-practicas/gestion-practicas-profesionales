# PracticaLink — Instrucciones de desarrollo para Codex

## Alcance y forma de trabajo

Estas instrucciones cubren todo el repositorio. Respeta las instrucciones
explícitas del usuario y el alcance autorizado para cada tarea.

- Analiza el código, los contratos y las pruebas relacionadas antes de implementar.
- Revisa el estado Git y preserva modificaciones locales ajenas a la tarea.
- Trabaja mediante cambios pequeños, coherentes y revisables. No mezcles
  movimientos de archivos con correcciones funcionales no autorizadas.
- Si se solicita diagnóstico o propuesta, no implementes cambios.
- Explica decisiones relevantes, riesgos y limitaciones. No amplíes el alcance
  sin autorización.

## Arquitectura y responsabilidades

PracticaLink es un monolito modular con Angular/TypeScript/Ionic,
FastAPI/Python y PostgreSQL en Supabase.

- Organiza funcionalidades backend por dominio siguiendo el patrón existente:
  `routes.py`, `schemas.py` y `service.py`.
- El backend está en transición: comprueba la estructura real antes de mover
  componentes desde `api/routes/`, `services/` y `schemas/`.
- Mantén las rutas centradas en HTTP, contratos y dependencias; los casos de uso
  pertenecen a servicios. Reserva `core/` para responsabilidades transversales.
- Evita ciclos de imports, imports de rutas desde servicios y nuevas dependencias
  desde `core/` hacia módulos de negocio.
- Documenta dependencias SQL entre dominios: separar carpetas no garantiza
  independencia de datos.
- No introduzcas microservicios, repositorios genéricos, buses ni otras
  abstracciones sin una necesidad concreta y acordada.
- Refactoriza un módulo o responsabilidad por vez; no reorganices todo el backend
  en una sola intervención.

## Preservación de contratos

Durante refactorizaciones estructurales, conserva:

- Métodos y URLs, códigos HTTP y mensajes actuales.
- Modelos públicos, nombres de campos, tipos, obligatoriedad, defaults y nulabilidad.
- Autenticación, roles y uso del identificador del usuario autenticado.
- Funciones PostgreSQL, parámetros, casts y serialización JSON.
- Commit, rollback, bloqueos, sesión utilizada y atomicidad.
- Contratos TypeScript, consumidores frontend y compatibilidad OpenAPI.

`GET /auth/context` combina identidad, roles y datos académicos. No cambies su
contrato, consulta o semántica de autorización como efecto secundario de mover
archivos. No descompongas una operación SQL atómica en escrituras independientes.
Los cambios de comportamiento requieren un alcance explícito y pruebas propias.

## Seguridad y operaciones sensibles

- No expongas secretos, tokens, contraseñas, cadenas de conexión ni datos
  personales en código, pruebas, documentación, logs o respuestas.
- No vuelques archivos `.env` ni uses credenciales de demostración documentadas
  para acceder a servicios. Usa información sintética en pruebas.
- No modifiques bases reales ni ejecutes SQL, migraciones o cambios de permisos
  automáticamente. Requieren autorización explícita para el entorno y la operación.
- No conectes pruebas unitarias a Supabase ni a proveedores externos.
- No instales o actualices dependencias, ejecutes servicios externos, inicies o
  detengas servicios, despliegues o cambies configuración de seguridad sin
  autorización dentro de la tarea.
- Reporta vulnerabilidades con evidencia sin revelar secretos. No las corrijas
  automáticamente dentro de una refactorización estructural.
- Prepara un resultado revisable y espera revisión humana antes de operaciones
  sensibles. No interpretes un permiso técnico como autorización funcional.

## Frontend

- Conserva el tipado estricto y las comprobaciones de plantillas de Angular.
- Mantén HTTP en servicios y utiliza los mecanismos existentes de estado,
  incluyendo los métodos de `AuthStore` para modificar el contexto.
- Conserva guards y permisos backend: ocultar botones no sustituye autorización.
- Respeta la nulabilidad de `perfil` y `practica_actual`.
- Mantén estados de carga, error y recuperación en operaciones asíncronas.
- Respeta `.editorconfig` y la configuración Prettier de `package.json`.
  Evita cambios masivos de formato y renombrados ajenos a la tarea.

## Pruebas y validación

- Backend: utiliza `unittest`, `unittest.mock` y `TestClient`, según las
  convenciones actuales. Antes de trasladar una funcionalidad, agrega pruebas
  de caracterización donde falten.
- Prueba comportamiento observable, permisos, identidad autenticada y errores
  relevantes. Conserva pruebas existentes; no debilites assertions para ocultar fallos.
- Aísla base de datos y proveedores con mocks. Restaura patches y
  `dependency_overrides`; al mover símbolos, actualiza mocks donde se utilizan.
- Distingue pruebas con mocks de integración real con PostgreSQL. Los mocks
  no acreditan funciones SQL, bloqueos ni transacciones reales.
- Ejecuta las suites pertinentes; amplía la validación cuando el alcance o
  las dependencias afectadas lo justifiquen.

Desde `PracticaLink/backend`, usa el entorno virtual existente. Ejemplo para
Estudiantes y permisos:

```bash
.venv/bin/python -B -m unittest tests.test_estudiantes tests.test_permissions -v
```

En Windows:

```powershell
.\.venv\Scripts\python.exe -B -m unittest tests.test_estudiantes tests.test_permissions -v
```

Para validar todo el backend, utiliza el mismo intérprete con
`-B -m unittest discover -s tests -v`.

Desde `PracticaLink/frontend`:

```bash
npm test -- --watch=false --browsers=ChromeHeadless
npm run build
```

Ejecuta el build para cambios frontend relevantes. Las pruebas y el build frontend
pueden generar caché y artefactos: informa antes de ejecutarlos y respeta las
restricciones de la tarea. No hay comandos de lint o formato automatizado definidos
actualmente; no inventes comandos ni descargues herramientas mediante `npx`.

Si falta una dependencia, navegador o permiso, informa el bloqueo sin instalar
herramientas automáticamente. Reporta comandos y resultados reales; distingue
pruebas aprobadas, fallidas y no ejecutadas.

## Git y revisión humana

- Trabaja en ramas `feature/*` o `fix/*` derivadas de `develop` actualizado.
- Integra mediante Pull Request hacia `develop`; reserva `main` para versiones
  estabilizadas y su promoción mediante un PR separado.
- No crees o cambies ramas, hagas commits, push, merges ni operaciones destructivas
  sin autorización explícita. No actualices automáticamente un checkout con trabajo
  pendiente.
- Preserva archivos modificados y sin seguimiento ajenos a la tarea; no los
  descartes, sobrescribas ni incluyas en la entrega.
- No uses `git add .` indiscriminadamente. Cuando esté autorizado preparar cambios,
  selecciona archivos explícitos y revisa el diff preparado.
- Mantén las entregas pequeñas para revisión humana antes de integrarlas.
- Antes de modificar archivos, verifica la rama activa mediante
  `git branch --show-current`. Si estás en `main` o `develop`, detente y solicita
  instrucciones para preparar una rama de trabajo.
- Mantén separados los cambios de documentación general, refactorización,
  nuevas funcionalidades y correcciones de seguridad cuando tengan
  objetivos independientes.

## Code Review Rules

- Señala permisos omitidos, identidad tomada del cliente y exposición de secretos.
- Revisa compatibilidad HTTP, OpenAPI, TypeScript y PostgreSQL.
- Revisa atomicidad, commit/rollback, dependencias circulares y acoplamientos nuevos.
- Exige evidencia de pruebas proporcional al cambio; no confundas tests existentes
  con tests ejecutados o comportamiento real verificado.
- Distingue defectos confirmados, riesgos potenciales y aspectos no verificados.

## Documentación y entrega

Consulta según el área:

- `README.md`: propósito y flujo Git.
- `DOCUMENTACION_INSTALACION.md`: instalación y ejecución local.
- `PracticaLink/backend/app/BACK_CONTEXT.md`: contexto backend.
- `PracticaLink/frontend/src/app/APP_CONTEXT.md`: contexto frontend.
- `scripts/BD/`: esquema y correcciones SQL versionadas.
- Pruebas cercanas a la funcionalidad modificada.

Contrasta la documentación con el código y reporta discrepancias. Actualiza la
documentación pertinente cuando el cambio autorizado la afecte; no presentes
funcionalidades pendientes como implementadas.

Al entregar, resume archivos modificados, decisiones, comandos ejecutados,
pruebas y resultados, riesgos y verificaciones pendientes. Indica cualquier
cambio de comportamiento expresamente autorizado. No afirmes que algo funciona
solo porque su código o su prueba existen.
