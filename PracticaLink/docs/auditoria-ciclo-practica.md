# Auditoría del ciclo de práctica (estado final)

Rama: `chore/auditoria-ciclo-practica`, creada desde `06966db` (HEAD de `feature/rediseño-modulos-gestor`).
**Base del PR:** la rama contiene 20 commits que **no están en `develop`** (`develop...HEAD` = `0 20`). Un PR a `develop` incluirá esos commits además de los de esta auditoría.

Leyenda: **OK** = cadena verificada en código y en PostgreSQL 17 desechable cuando aplica; **Parcial** = existe pero falta una pieza verificada; **Por verificar** = código correcto, pendiente de ejecución en una aplicación real.

## 1. Matriz por paso

| Paso | Rol | BD | API | Frontend | Notificación | Pruebas | Estado | Observación |
|---|---|---|---|---|---|---|---|---|
| 0a. Crear cuentas y roles | ADMIN | `fn_crear_usuario_admin` | `POST /usuarios` | `pages/usuarios` (crear, editar, eliminar lógico) | N/A | `test_usuarios` OK | OK | Creación de DOCENTE en QA: pendiente de verificación manual. |
| 0b. Reasignar gestor | ADMIN | `fn_asignar_gestor_practica` | `PATCH /practicas/{id}/gestor` | `gestion-estados` | **GESTOR_REASIGNADO** al saliente; **GESTOR_ASIGNADO** al entrante **solo si quien asigna es otro usuario** | PG17 `s45_avisos_ciclo.sql` (incluye autoasignación sin aviso) | OK | — |
| 0c. Dashboard y barra del admin | ADMIN | — | No consulta `/revisiones` sin GESTOR | `pages/home` | — | `home.spec.ts` | OK | — |
| 1a. Completar perfil | ESTUDIANTE | `fn_completar_perfil_estudiante` | `POST /estudiantes/...` | `completar-perfil-modal` | N/A | `test_estudiantes` OK | OK | — |
| 1b. Registrar práctica | ESTUDIANTE | `fn_registrar_practica`; caché de empresa | `POST /practicas`; `GET /empresas/consulta/{rut}` | `practice-form` | `NUEVA_PRACTICA` a gestores | `test_practicas`, `test_empresas` OK | OK | — |
| 2. Revisar solicitud | GESTOR | `fn_revisar_practica` | `PATCH /revisiones/solicitudes/{id}` | `revision-detalle` | `CAMBIO_ESTADO` al estudiante | `test_revisiones` OK | OK | Autoasignación al revisar: no emite aviso de asignación (verificado). Obligatoriedad de la observación en UI: por verificar. |
| 2a. Responder observación | ESTUDIANTE | `fn_responder_observacion_practica` | `PATCH /practicas/{id}/respuesta-observacion` | `student-practice` | `RESPUESTA_OBSERVACION` al gestor | Por verificar | OK | — |
| 2b. RECHAZADA (terminal) | GESTOR → ESTUDIANTE | RECHAZADA es `es_final` | Revisión rechaza nuevas decisiones | Historial con observación | `CAMBIO_ESTADO` | Por verificar | Parcial | Falta confirmar en UI que no quedan acciones activas. |
| 3. Iniciar práctica | GESTOR (ADMIN también) | `fn_iniciar_practica` exige APROBADA | `PATCH /practicas/{id}/estado` | `gestion-estados`, `practica-detalle` | **PRACTICA_INICIADA** al estudiante | PG17 (aviso) | OK | Permiso del ADMIN: documentado como supervisión (§3). |
| 4a. Seguimientos | GESTOR (ADMIN también) | `seguimientos_privados.fn_registrar_seguimiento` exige EN_CURSO | `POST /practicas/{id}/seguimientos`; 409 `PRACTICA_NO_EN_CURSO` | `practica-detalle`: acción solo en EN_CURSO, con motivo | No aplica | `test_seguimientos_*`; PG17 (APROBADA rechazada, EN_CURSO OK) | OK | — |
| 4b. Lectura de seguimientos por el estudiante | ESTUDIANTE | `fn_consultar_seguimientos` | `GET /practicas/{id}/seguimientos` | `student-practice` | No aplica | `test_seguimientos_lectura` | Por verificar | — |
| 4c. Incidencias | GESTOR (ADMIN también) | `fn_registrar_incidencia` (S4.6): exige EN_CURSO | `POST /practicas/{id}/incidencias`; 409 `PRACTICA_NO_EN_CURSO` | `pages/incidencias` y `practica-detalle`: acción deshabilitada u oculta fuera de EN_CURSO, con motivo | **INCIDENCIA_ALTA/CRITICA** al gestor asignado o, sin gestor activo, a los administradores (S4.5) | PG17 `s46_ciclo_7a_incidencias.sql` (A1, A2); `incidencias.spec.ts` | OK | Las incidencias ya registradas no se modificaron. |
| 5. Asignar docente | GESTOR responsable | `fn_gestionar_asignacion` (S4.3) + aviso (S4.4) | `PUT /docente/practicas/{id}/asignacion` | `docente-asignacion` | **PRACTICA_ASIGNADA** al docente | PG17 `s44_docente_listado.sql` | OK | — |
| 6. Entregar informe final | ESTUDIANTE | `informes_privados.reservar/confirmar/autorizar` | `POST /practicas/{id}/informe-final` | `informe-final` | `INFORME_FINAL_ENTREGADO` a docente y gestor | `test_informes` OK (venv 3.12); PG17 `s46` (v1 y v2) | OK | — |
| 7a. Docente ve práctica, insignia y descarga | DOCENTE | `fn_listar_practicas_asignadas` + `informes_privados.resumen_docente` (S4.4) | `GET /docente/practicas`; `GET …/informe-final/archivo` | `docente-practicas`, `informe-final` | Recibe `INFORME_FINAL_ENTREGADO` | `test_docentes`, `test_docente_listado_contrato`; PG17 `s44` (7 comprobaciones) | OK | El rol DOCENTE no lee `informe_final` ni `evaluacion_informe` directamente. |
| 7b. Docente inicia evaluación | DOCENTE | `informes_privados.iniciar_evaluacion` | `POST …/evaluaciones/inicio` | `evaluacion-panel` | No aplica | PG17 `s46` (B2) | OK | — |
| 7c. Docente resuelve | DOCENTE | `informes_privados.resolver_evaluacion`: observaciones obligatorias en CON_OBSERVACIONES | `POST …/evaluaciones/{id}/resolucion` | `evaluacion-panel` (estilos con tokens) | `INFORME_FINAL_EVALUADO` a estudiante y gestor | PG17 `s46` (B2a negativo, B2b) | OK | — |
| 7d. CON_OBSERVACIONES → reentrega v2 → vuelve a 7 | ESTUDIANTE | `resolver_evaluacion` deja ENTREGADO; `autorizar` habilita la entrega | `POST …/informe-final` (v2) | `informe-final` | `INFORME_FINAL_ENTREGADO` y `INFORME_FINAL_EVALUADO` | PG17 `s46` (B4 y B5) | OK en BD; Parcial en UI | Confirmar en UI que el estudiante ve las observaciones antes de reentregar. |
| 8. Cerrar práctica | GESTOR responsable | `fn_cerrar_practica` → `validar_cierre`: exige evaluación APROBADO vigente | `POST /practicas/{id}/cierre` | `gestion-estados` («Finalizar» con aprobación vigente) | `PRACTICA_FINALIZADA` al estudiante **y al docente** (S4.5) | PG17 `s46` (B3 negativo: cierre con CON_OBSERVACIONES rechazado; B6 cierre OK tras v2) | OK | — |
| 8b. Recordatorios de cierre | Sistema | `fn_procesar_recordatorios_cierre` | `POST /practicas/tareas/recordatorios-cierre` con **token de tarea** | Sin pantalla | Recordatorio al gestor | Por verificar | Por verificar | Autenticación por token de tarea, no por rol. |
| T1. Notificaciones: lectura por rol | Todos | `fn_listar_notificaciones` (por usuario) | `GET /notificaciones` (ESTUDIANTE, DOCENTE, GESTOR, ADMIN) | Espacios de notificaciones | — | `test_notificaciones_permisos` OK | OK | — |
| T2. Acción de cada aviso según espacio | Todos | — | — | `notificaciones.ts` (`accionDe`, `abrir`) | — | `notificaciones-espacio.spec.ts` | OK | — |

## 2. Brechas: estado

Ninguna brecha confirmada bloquea el ciclo en BD de prueba y en código.

| # | Brecha | Estado |
|---|---|---|
| 1 | Docente sin práctica en su home | Resuelto: un docente sin rol de gestión que entra a `/home` va a `/docente/practicas`. Sin prácticas asignadas, el mensaje es correcto. |
| 2 | Docente sin aviso de asignación | Resuelto (S4.4). |
| 3 | Listado docente sin estado del informe | Resuelto (S4.4). |
| 4 | Iniciar práctica sin aviso | Resuelto (S4.5). |
| 5 | Alertas ALTA/CRITICA solo como badge | Resuelto (S4.5). |
| 6 | Seguimientos fuera de EN_CURSO | Ya exigido en BD y API; acción del front oculta fuera de EN_CURSO. |
| 7 | Reasignar gestor sin aviso | Resuelto (S4.5), con la regla de «otro usuario». |
| 8 | Cierre sin aviso al docente | Resuelto (S4.5). |
| 9 | Barra y dashboard del admin | Resuelto (commits anteriores). |
| 10 | Panel de evaluación sin estilos | Resuelto (tokens, sin cambios de lógica). |
| 11 | Páginas docentes con `ion-content` dentro del layout | **Por verificar visualmente.** |
| 12 | Pruebas backend rotas | Resuelto: §4. |
| 13 | Incidencias fuera de EN_CURSO | Resuelto (S4.6). |

## 3. Decisiones

- **ADMINISTRADOR (sin cambios):** puede iniciar prácticas, registrar seguimientos e incidencias como **supervisión**. Se mantiene por decisión del equipo.
- **Harness obsoleto:** `backend/tests/integration/run_registro_incidencia.py` referencia `incidencias_privadas.fn_registrar_incidencia` y archivos `scripts/BD/fixes/ep06-*.sql` que **no existen** en el repositorio. No se ejecuta. Se sustituye por `s46_ciclo_7a_incidencias.sql` (que prueba la función vigente `public.fn_registrar_incidencia`). Propuesta: retirar o reescribir el harness en una tarea aparte.

## 4. Pruebas

### Backend (Python 3.12)
Venv limpio `venv312` creado fuera del repositorio con **todo `requirements.txt` instalado** (`pip check`: sin dependencias rotas). Mismo intérprete y mismo entorno para línea base y resultado final.

| Momento | Pruebas | Resultado |
|---|---|---|
| Línea base: `06966db` extraído con `git archive` (backend y supabase) | 550 | **15 fallos y 4 errores** |
| Final: rama `chore/auditoria-ciclo-practica` | 555 | **OK, 0 fallos, 0 errores** |

Causas de la línea base (ninguna era un fallo de producción):
- `test_empresas` (2) y `test_estudiantes` (1): aserciones de SQL exacto sin el esquema `public.` ni normalizar espacios. Se normalizó el SQL y se conservaron función, parámetros y commit.
- `test_practicas_service` (4 errores), `test_practicas` (2), `test_practicas_schemas` (1): fixtures sin `horas_semanales`, campo que el servicio ya devuelve.
- `test_usuarios` (9): mocks de listados con el contrato anterior; el caso `SIN_ROLES` no lo emite ninguna función SQL (solo `ROLES_INVALIDOS`). El filtro de roles activos se verificó contra PostgreSQL real.

Nota sobre el venv `.venv` (3.14): sin `pypdf`, `PIL` ni `firebase_admin`, produce 10 errores de importación. No son del código. Render usa 3.12.

### Frontend
| Comando | Resultado |
|---|---|
| `npx ng test --watch=false --browsers=ChromeHeadless` | **668 SUCCESS**, 0 fallos |
| `npx ng build` | Compila correctamente |

## 5. Verificación en PostgreSQL 17 desechable

Contenedor local `postgres:17`, ligado a `127.0.0.1`, con roles `anon`/`authenticated`/`service_role` y `auth.jwt()` mínimos. **Nunca se conectó a Supabase QA ni a producción.** Contenedor eliminado al terminar.

Aplicación de las **30 migraciones en orden** sin error.

| Integración | Comprobaciones |
|---|---|
| `s44_docente_listado.sql` | 7 OK: asignación, aviso al docente, listado sin/con informe, aislamiento, sin lectura directa de `informe_final` |
| `s45_avisos_ciclo.sql` | 6 OK: inicio, reasignación, autoasignación sin aviso, incidencia con gestor, incidencia sin gestor (administrador), cierre (estudiante y docente) |
| `s46_ciclo_7a_incidencias.sql` | 7 OK: incidencia APROBADA rechazada; EN_CURSO aceptada; informe v1; CON_OBSERVACIONES sin observaciones rechazado; resultado registrado; **cierre con CON_OBSERVACIONES rechazado** (`EVALUACION_APROBATORIA_VIGENTE_REQUERIDA`); reentrega v2, APROBADO y cierre permitido (FINALIZADA) |

Las tres integraciones revierten su transacción. No cubren: la vía real de Storage ni de push, ni el login humano en la aplicación.

## 6. Commits de la rama

| Commit | Contenido |
|---|---|
| `d47c55a` | Barra y dashboard del administrador. |
| `e30c7bb` | Eliminación lógica de cuentas. |
| `eb08fe6` | «Ver detalle» desde Estados. |
| `37aa918` | Layout y notificaciones del espacio docente. |
| `8b5f6ef` | Redirección del docente sin rol de gestión. |
| `54cfea8` | S4.4: listado docente con informe y aviso de asignación. |
| `abba2ee` | Pruebas backend reparadas. |
| `6bde6a8` | S4.5: avisos de inicio, reasignación, incidencias y cierre. |
| `de6b65a` | Seguimientos solo en EN_CURSO en el detalle. |
| `e2422e1` | Presentación del panel de evaluación. |
| `ea048c0` | Documento de auditoría (versión anterior). |
| `4c20e9e` | S4.5: `GESTOR_ASIGNADO` solo si asigna otro usuario. |
| `d2b5963` | S4.6: incidencias solo en EN_CURSO. |
| `415bcc1` | Integración PG17 del desvío 7a y de incidencias. |
| `434b906` | Front: registro de incidencias solo en EN_CURSO. |
| (este commit) | Este documento actualizado. |

## 7. Aplicación en QA (la realiza el equipo)

**Requisitos:** copia de seguridad o snapshot de QA antes de empezar. Los archivos no tienen `BEGIN`, así que usar `psql -1` (una transacción por archivo). **No ejecutar dos veces**: crean funciones, políticas y grants que fallarían en la segunda pasada.

### Orden
1. `supabase/migrations/20261111100000_s44_docente_listado_notificacion.sql` (S4.4)
2. `supabase/migrations/20261112100000_s45_notificaciones_ciclo.sql` (S4.5)
3. `supabase/migrations/20261112120000_s46_incidencias_en_curso.sql` (S4.6)

Comando por archivo: `psql "$QA_URL" -1 -v ON_ERROR_STOP=1 -f <archivo>` (usar la cadena de conexión de QA desde el gestor de secretos; no pegarla en el historial).

### Verificación posterior (solo lectura)
```sql
-- S4.4: función nueva y políticas
SELECT to_regprocedure('informes_privados.resumen_docente(bigint,bigint)') IS NOT NULL AS resumen_existe;
SELECT polname FROM pg_policy WHERE polname IN ('s44_docente_notify','s44_resumen_read_practica');        -- 2 filas
-- S4.5: avisos y permisos
SELECT polname FROM pg_policy WHERE polname IN ('s45_ep04_notify','s45_ep04_read_estudiante');           -- 2 filas
SELECT has_column_privilege('pl_ep04_owner','public.practica','id_estudiante','SELECT') AS ok_inicio;     -- true
SELECT has_column_privilege('pl_s43_cierre_owner','public.practica','id_docente','SELECT') AS ok_cierre;  -- true
-- S4.6: incidencias en EN_CURSO
SELECT pg_get_functiondef('public.fn_registrar_incidencia(bigint,bigint,date,text,character varying)'::regprocedure)
       LIKE '%PRACTICA_NO_EN_CURSO%' AS incidencias_en_curso;                                            -- true
```
Después: confirmar en QA que `GET /usuarios`, `GET /docente/practicas` y `GET /notificaciones` responden 200 para sus roles. **No crear datos de prueba en QA sin autorización.**

### Cómo revertir
Las migraciones son hacia adelante; no hay archivos «down». Opciones:
1. **Preferida:** restaurar el snapshot tomado antes del paso 1.
2. **Por migración nueva**, en orden inverso (S4.6 → S4.5 → S4.4):
   - **S4.6:** restaurar `fn_registrar_incidencia` a la definición de S4.5 (condición `NOT ep.es_final`, código `PRACTICA_NO_DISPONIBLE`).
   - **S4.5:** restaurar `fn_asignar_gestor_practica` (`20261109100000_s43…:352`), `fn_iniciar_practica` (`…:628`), `fn_cerrar_practica` (`…:844`) y `fn_registrar_incidencia` (`20261028030000_ep06_correo…:2`) a sus definiciones anteriores. Después:
     ```sql
     DROP POLICY IF EXISTS s45_ep04_notify ON public.notificacion;
     DROP POLICY IF EXISTS s45_ep04_read_estudiante ON public.estudiante;
     REVOKE SELECT(id_estudiante) ON public.practica FROM pl_ep04_owner;
     REVOKE SELECT(id_estudiante,id_usuario) ON public.estudiante FROM pl_ep04_owner;
     REVOKE INSERT(id_usuario,id_practica,tipo,titulo,mensaje) ON public.notificacion FROM pl_ep04_owner;
     REVOKE SELECT(id_docente) ON public.practica FROM pl_s43_cierre_owner;
     ```
   - **S4.4:** restaurar **primero** `fn_listar_practicas_asignadas` (`20261107110000_s41…:169`) y **después** `fn_gestionar_asignacion` (`20261109100000_s43…:300`, sin el aviso). Luego:
     ```sql
     DROP FUNCTION IF EXISTS informes_privados.resumen_docente(bigint,bigint);
     DROP POLICY IF EXISTS s44_docente_notify ON public.notificacion;
     DROP POLICY IF EXISTS s44_resumen_read_practica ON public.practica;
     REVOKE INSERT(id_usuario,id_practica,tipo,titulo,mensaje) ON public.notificacion FROM pl_s41_docente_owner;
     ```
   Restaurar la función del listado antes de eliminar `resumen_docente` es obligatorio: el listado la llama.

## 8. Pendientes antes del push

| Pendiente | Responsable |
|---|---|
| Decidir la base del PR (`develop` incluye 0 de los 20 commits previos) | Equipo |
| Aplicar S4.4, S4.5 y S4.6 en QA siguiendo §7 | Equipo |
| Verificación visual de páginas docentes (brecha 11) y del flujo 7d en UI | Equipo |
| Retirar o reescribir `run_registro_incidencia.py` (§3) | Tarea aparte |
| Decisión de permisos del ADMINISTRADOR (§3) | Equipo |
| `.venv` (3.14) sin dependencias de `requirements.txt`: instalarlas o usar 3.12 | Equipo |
