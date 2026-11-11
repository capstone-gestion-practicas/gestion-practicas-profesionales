# Auditoría del ciclo de práctica (Fases 1 a 3)

Rama: `chore/auditoria-ciclo-practica`, creada desde `06966db` (HEAD de `feature/rediseño-modulos-gestor`).
**Base del PR:** esta rama contiene 20 commits que todavía **no están en `develop`** (`develop...HEAD` = `0 20`). Un PR a `develop` incluirá esos commits además de los de esta auditoría.

Leyenda: **OK** = cadena completa verificada en código y/o en BD de prueba; **Parcial** = existe, pero falta una validación, una notificación, una pantalla o una prueba verificada; **Falta** = no existe; **Por verificar** = código correcto, pendiente de ejecución en una app real.

## 1. Matriz por paso (estado final)

| Paso | Rol | BD | API | Frontend | Notificación | Tests | Estado | Observación |
|---|---|---|---|---|---|---|---|---|
| 0a. Crear cuentas y roles | ADMIN | `fn_crear_usuario_admin` valida admin activo, correo único y roles | `POST /usuarios` (ADMIN) | `pages/usuarios` (crear, editar, eliminar lógico) | N/A | `test_usuarios` (29 OK) | OK | Creación de DOCENTE: verificación manual pendiente. |
| 0b. Reasignar gestor | ADMIN | `fn_asignar_gestor_practica` | `PATCH /practicas/{id}/gestor` (ADMIN) | `gestion-estados` | **GESTOR_REASIGNADO** al saliente y **GESTOR_ASIGNADO** al entrante (S4.5) | Integración `s45_avisos_ciclo.sql` (PG17) | OK | — |
| 0c. Dashboard y barra del admin | ADMIN | — | No consulta `/revisiones` sin GESTOR | `pages/home` (métricas independientes, «No disponible») | — | `home.spec.ts` | OK | Commit `d47c55a`. |
| 1a. Completar perfil | ESTUDIANTE | `fn_completar_perfil_estudiante` | `POST /estudiantes/...` | `completar-perfil-modal` | N/A | `test_estudiantes` OK | OK | — |
| 1b. Registrar práctica (empresa con caché) | ESTUDIANTE | `fn_registrar_practica`; caché de empresa | `POST /practicas`; `GET /empresas/consulta/{rut}` | `practice-form` | `NUEVA_PRACTICA` a gestores | `test_practicas`, `test_empresas` OK | OK | — |
| 2. Revisar solicitud (APROBADA / OBSERVADA / RECHAZADA) | GESTOR | `fn_revisar_practica`: exige GESTOR, estado origen, decisión válida | `PATCH /revisiones/solicitudes/{id}` (GESTOR) | `revision-detalle` | `CAMBIO_ESTADO` al estudiante | `test_revisiones` OK | OK | Obligatoriedad de la observación en OBSERVADA/RECHAZADA: por verificar en UI. |
| 2a. Responder observación → revisión | ESTUDIANTE | `fn_responder_observacion_practica`: exige OBSERVADA y pasa a EN_REVISION | `PATCH /practicas/{id}/respuesta-observacion` | `student-practice` | `RESPUESTA_OBSERVACION` al gestor | Por verificar | OK | — |
| 2b. RECHAZADA (terminal) | GESTOR → ESTUDIANTE | RECHAZADA es `es_final` | Revisión rechaza nuevas decisiones (`SOLICITUD_NO_REVISABLE`) | Historial con observación | `CAMBIO_ESTADO` | Por verificar | Parcial | Falta comprobar en UI que no queden acciones activas. |
| 3. Iniciar práctica (APROBADA → EN_CURSO) | GESTOR (ADMIN también) | `fn_iniciar_practica`: `TRANSICION_NO_PERMITIDA` si origen ≠ APROBADA | `PATCH /practicas/{id}/estado` | `gestion-estados`, `practica-detalle` | **PRACTICA_INICIADA** al estudiante (S4.5) | Integración PG17 (inicio avisa) | OK | Permiso del ADMIN: ver §3 (decisión pendiente). |
| 4a. Seguimientos durante la práctica | GESTOR (ADMIN también) | `seguimientos_privados.fn_registrar_seguimiento` (versión vigente): exige **EN_CURSO** y gestor responsable | `POST /practicas/{id}/seguimientos`; 409 `PRACTICA_NO_EN_CURSO` | `practica-detalle`: acción solo en EN_CURSO, con motivo fuera de ese estado | No aplica | `test_seguimientos_*` OK; comprobación PG17 | OK | **Corrección:** la versión que leí antes en la auditoría (`public.fn_registrar_seguimiento`) es histórica; la que usa la API ya exige EN_CURSO. No fue necesario cambiar la BD. |
| 4b. Lectura de seguimientos por el estudiante | ESTUDIANTE | `seguimientos_privados.fn_consultar_seguimientos` | `GET /practicas/{id}/seguimientos` (`lector_autenticado`) | `student-practice` | No aplica | `test_seguimientos_lectura` | Por verificar | — |
| 4c. Incidencias (crear, estado, historial) | GESTOR (ADMIN también) | `fn_registrar_incidencia` | `POST /practicas/{id}/incidencias` | `pages/incidencias` | **INCIDENCIA_ALTA / INCIDENCIA_CRITICA** al gestor asignado o, sin gestor activo, a los administradores (S4.5) | Integración PG17 | Parcial | **Pendiente de decisión:** la BD acepta incidencias fuera de EN_CURSO (verificado con práctica APROBADA), pero `test_incidencias_*` y `run_registro_incidencia.py` esperan `PRACTICA_NO_EN_CURSO`. |
| 5. Asignar docente | GESTOR responsable | `fn_gestionar_asignacion` (S4.3): gestor responsable, APROBADA o EN_CURSO, historial, motivo al reemplazar | `PUT /docente/practicas/{id}/asignacion` (GESTOR) | `docente-asignacion` en `practica-detalle` (y acceso desde `gestion-estados`) | **PRACTICA_ASIGNADA** al docente (S4.4) | Integración PG17 `s44_docente_listado.sql` | OK | Migración S4.4 validada solo en PG17 local. |
| 6. Entregar informe final (≤10 MiB, versiones) | ESTUDIANTE | `informes_privados.autorizar/reservar/confirmar`: EN_CURSO, fecha de término, docente activo, sin APROBADO vigente | `POST /practicas/{id}/informe-final` | `informe-final` | `INFORME_FINAL_ENTREGADO` a docente y gestor | `test_informes` OK en 3.12 | OK | — |
| 7a. Docente ve práctica y descarga informe | DOCENTE | `fn_listar_practicas_asignadas` + resumen restringido `informes_privados.resumen_docente` (S4.4) | `GET /docente/practicas` (con estado del informe); `GET …/informe-final/archivo` | `docente-practicas` (listado con insignias y detalle), `informe-final` | Recibe `INFORME_FINAL_ENTREGADO` | `test_docentes`, `test_docente_listado_contrato`; PG17 (6 comprobaciones) | OK | El docente sin prácticas asignadas ve el mensaje correspondiente. La ruta `/home` ya redirige a `/docente/practicas` (punto 2). |
| 7b. Docente inicia evaluación | DOCENTE | `informes_privados.iniciar_evaluacion` | `POST …/evaluaciones/inicio` (DOCENTE) | `evaluacion-panel` | No aplica | `test_evaluaciones` | OK | — |
| 7c. Docente resuelve APROBADO / CON_OBSERVACIONES | DOCENTE | `informes_privados.resolver_evaluacion`: observaciones obligatorias si CON_OBSERVACIONES | `POST …/evaluaciones/{id}/resolucion` (DOCENTE) | `evaluacion-panel` (estilos de tokens, punto 8) | `INFORME_FINAL_EVALUADO` a estudiante y gestor | `test_evaluaciones` | OK | — |
| 7d. CON_OBSERVACIONES → reentrega → vuelve a 7 | ESTUDIANTE | `resolver_evaluacion` deja ENTREGADO; `autorizar` habilita la entrega | `POST …/informe-final` | `informe-final` («Reemplazar informe») | `INFORME_FINAL_EVALUADO` | Por verificar | Parcial | Confirmar en UI que el estudiante ve las observaciones antes de reentregar. |
| 8. Cerrar práctica (FINALIZADA) | GESTOR responsable | `fn_cerrar_practica` → `validar_cierre`: gestor responsable, evaluación APROBADO vigente, EN_CURSO, fecha de término | `POST /practicas/{id}/cierre` | `gestion-estados` («Finalizar», solo con aprobación vigente) | `PRACTICA_FINALIZADA` al estudiante **y al docente** (S4.5) | Integración `s43_*` y PG17 | OK | — |
| 8b. Recordatorios de cierre | Sistema | `fn_procesar_recordatorios_cierre` | `POST /practicas/tareas/recordatorios-cierre` con **token de tarea** | Sin pantalla | Recordatorio al gestor | Por verificar | Por verificar | Autenticación por token de tarea, no por rol; revisar configuración. |
| T1. Notificaciones: lectura por rol | Todos | `fn_listar_notificaciones` | `GET /notificaciones` (ESTUDIANTE, DOCENTE, GESTOR, ADMIN) | Espacios de notificaciones | — | `test_notificaciones_permisos` (3 OK) | OK | — |
| T2. Historial visible | ESTUDIANTE / GESTOR | `fn_consultar_historial_estados` | `GET /practicas/{id}/historial-estados` | `student-practice`, `gestion-estados` | — | Por verificar | OK | — |
| T3. Acciones de aviso según espacio | Todos | — | — | `notificaciones.ts` (`accionDe`, `abrir`) | — | `notificaciones-espacio.spec.ts` (57 pruebas del grupo) | OK | — |

## 2. Brechas: estado

### Bloquean el ciclo
Ninguna brecha confirmada impide recorrer el ciclo en la BD de prueba y en el código auditado.

### Confunden al usuario
| # | Brecha | Estado |
|---|---|---|
| 1 | Docente sin práctica en su home (síntoma reportado) | **Resuelto como redirección**: un docente sin rol de gestión que entra a `/home` va a `/docente/practicas` (punto 2). El síntoma sin prácticas asignadas es correcto: no tenía ninguna asignada. |
| 2 | Docente no recibe aviso al ser asignado | **Resuelto** (S4.4). |
| 3 | Listado docente sin estado del informe | **Resuelto** (S4.4). |
| 4 | Iniciar práctica no avisa al estudiante | **Resuelto** (S4.5). |
| 5 | Alertas ALTA/CRITICA solo como badge | **Resuelto** (S4.5): aviso al gestor asignado o, sin gestor activo, a los administradores. |
| 6 | Seguimientos fuera de EN_CURSO | **Ya estaba resuelto en BD y API**; la acción del front ahora solo aparece en EN_CURSO (punto 5). |
| 7 | Reasignar gestor no avisa | **Resuelto** (S4.5). |
| 8 | Cierre sin aviso al docente | **Resuelto** (S4.5). |
| 9 | Barra y dashboard del admin | **Resuelto** (commits anteriores de esta rama). |

### Cosméticas
| # | Brecha | Estado |
|---|---|---|
| 10 | Panel de evaluación sin estilos | **Resuelto** (punto 8): tokens de `styles.scss`, sin cambios de lógica. |
| 11 | `docente-layout` y páginas docentes con `ion-content` dentro del layout | **Por verificar** visualmente (no se ha ejecutado la app). |
| 12 | Pruebas backend rotas | **Resuelto** (punto 9): ver §4. |

## 3. Decisiones pendientes del equipo

- **ADMINISTRADOR (punto 10): no se cambian sus permisos.** Puede iniciar prácticas (`fn_iniciar_practica`, `PATCH /practicas/{id}/estado`), registrar seguimientos e incidencias (`fn_registrar_seguimiento`, `fn_registrar_incidencia`) como supervisión. El encargo dice GESTOR. Decisión del equipo.
- **Incidencias fuera de EN_CURSO (4c):** la BD acepta incidencias en APROBADA; las pruebas de integración esperan `PRACTICA_NO_EN_CURSO`. Hay que decidir la regla y alinear BD o pruebas.
- **Destinatario de GESTOR_ASIGNADO en la primera asignación:** el aviso se envía a cualquier gestor nuevo que reciba la práctica, incluida la primera asignación. Confirmar si es lo deseado.

## 4. Pruebas: línea base y resultado

Entorno de referencia `.venv-python312` (Python 3.12.16, con `pypdf` 7.0.0 y Pillow 13.0.0 de `requirements.txt`).

| Momento | Resultado |
|---|---|
| Línea base (3.12) | 15 fallos y 4 errores |
| Línea base (`.venv`, 3.14) | 15 fallos y 14 errores (10 extra por `pypdf`/`PIL` ausentes en ese venv) |
| Después de los cambios (3.12) | **555 pruebas, OK** |
| Después de los cambios (`.venv`, 3.14) | 516 pruebas, 10 errores de importación (`pypdf`, `PIL`, `firebase_admin`), 0 fallos de código |

Causas de la línea base (ninguna era un fallo de producción):
- **test_empresas (2 fallos), test_estudiantes (1 fallo):** aserciones de SQL exacto sin el esquema `public.` ni normalizar espacios. Se normalizó el SQL y se conservaron la función invocada, los parámetros y el commit.
- **test_practicas_service (4 errores), test_practicas (2), test_practicas_schemas (1):** fixtures y JSON esperados sin `horas_semanales`, campo que el servicio ya devuelve.
- **test_usuarios (9 fallos y errores):** mocks de listados con el contrato anterior (`mappings().all()`) frente a la función SQL JSON (`scalar_one`); el caso `SIN_ROLES` no lo emite ninguna función SQL (solo `ROLES_INVALIDOS`). Los filtros de roles activos se comprobaron contra PostgreSQL real.
- **test_informes (8 errores) y test_docx / test_informes_formatos:** dependencias ausentes en `.venv` (3.14), no en el código.

## 5. Verificación en base de datos

Se usó un contenedor PostgreSQL 17 **desechable y local** (`127.0.0.1`), con roles y esquema `auth` mínimos que emulan Supabase. **No se ha tocado Supabase QA ni producción.** Las 29 migraciones se aplicaron en orden sin error.

| Migración / prueba | Resultado |
|---|---|
| S4.4 (`tests/integration/s44_docente_listado.sql`) | 7 comprobaciones OK (asignación, notificación, listado, aislamiento, sin lectura directa) |
| S4.5 (`tests/integration/s45_avisos_ciclo.sql`) | 5 comprobaciones OK (inicio, reasignación, incidencia con gestor, incidencia sin gestor, cierre con docente) |
| Seguimientos (función vigente) | APROBADA → `PRACTICA_NO_EN_CURSO`; EN_CURSO → registrado |

No cubierto: la evaluación CON_OBSERVACIONES completa (7c/7d) en BD; la vía real de Storage y push; el login humano en la aplicación.

## 6. Cambios por commit (rama `chore/auditoria-ciclo-practica`)

| Commit | Contenido |
|---|---|
| `d47c55a` | Barra y dashboard del administrador (punto previo). |
| `e30c7bb` | Eliminación lógica de cuentas. |
| `eb08fe6` | «Ver detalle» desde Estados. |
| `37aa918` | Layout y notificaciones del espacio docente. |
| `8b5f6ef` | Redirección del docente sin rol de gestión (punto 2). |
| `54cfea8` | S4.4: listado docente con informe y aviso de asignación (punto 1). |
| `abba2ee` | Pruebas backend reparadas (punto 9). |
| `6bde6a8` | S4.5: avisos de inicio, reasignación, incidencias y cierre (puntos 3, 4, 6, 7). |
| `de6b65a` | Seguimientos solo en EN_CURSO en el detalle (punto 5). |
| `e2422e1` | Presentación del panel de evaluación (punto 8). |

## 7. Guion de prueba manual con 4 cuentas

Cuentas sintéticas: **admin**, **gestor**, **docente**, **estudiante**. No usar datos reales.

| # | Quién | Pantalla | Acción | Resultado esperado |
|---|---|---|---|---|
| 0a | admin | `/usuarios` | Crear DOCENTE sintético | Aparece con rol DOCENTE |
| 0b | admin | `/gestion-estados` | «Asignar gestor» y «Guardar gestor» | Gestor responsable actualizado; los dos gestores reciben aviso |
| 1b | estudiante | Registrar práctica | Consultar RUT de empresa y enviar | REGISTRADA; el gestor recibe aviso |
| 2 | gestor | `/revisiones` → detalle | Aprobar (o observar con texto) | APROBADA u OBSERVADA; estudiante recibe aviso |
| 2a | estudiante | Mi práctica → respuesta a observaciones | Responder y enviar | EN_REVISION; gestor recibe aviso |
| 2b | gestor | `/revisiones` → rechazar con observación | Rechazar | RECHAZADA; estudiante ve el motivo |
| 3 | gestor | `/gestion-estados` o detalle | «Iniciar» desde APROBADA | EN_CURSO; estudiante recibe «Práctica iniciada» y su clic abre Mi práctica |
| 4a | gestor | Detalle → «Registrar seguimiento» | Registrar | Aparece en el historial. En APROBADA la acción no existe y se muestra el motivo |
| 4c | gestor | `/incidencias` → incidencia ALTA | Registrar | Badge «Alerta pendiente»; el gestor asignado recibe aviso |
| 5 | gestor | Detalle → «Asignar docente» | Elegir docente y guardar | Docente recibe «Práctica asignada» y su clic abre `/docente/practicas/:id` |
| 6 | estudiante | Mi práctica → Informe final | Subir PDF ≤10 MB | Versión 1 ENTREGADO; docente y gestor reciben aviso |
| 7a | docente | `/docente/practicas` | Abrir detalle y descargar | Ve la práctica con su insignia; descarga el archivo |
| 7b | docente | Detalle → «Iniciar evaluación» | Iniciar | EN_EVALUACION |
| 7c | docente | Detalle → «Registrar resultado» | CON_OBSERVACIONES con texto | Estudiante y gestor reciben aviso |
| 7d | estudiante | Informe final | Ver observaciones y subir versión 2 | Versión 2 ENTREGADO; vuelve al paso 7 |
| 7e | docente | Detalle | Resolver APROBADO | Estudiante y gestor reciben aviso |
| 8 | gestor | `/gestion-estados` → «Finalizar» | Finalizar (con aprobación vigente) | FINALIZADA; estudiante y docente reciben aviso |

Comprobación transversal: cada aviso aparece en `/notificaciones` del rol correspondiente, y su acción abre la pantalla de ese rol.

## 8. Plan y estado final

| Punto | Estado |
|---|---|
| 2. Redirección del docente | Hecho. |
| 1. S4.4 en base local | Hecho (PG17 desechable). **No aplicado en Supabase QA.** |
| 9. Pruebas rotas | Hecho: 555 OK en 3.12. |
| 3, 4, 6, 7. Avisos (S4.5) | Hecho (PG17 desechable). **No aplicado en Supabase QA.** |
| 5. Seguimientos en EN_CURSO | Hecho en front; BD y API ya lo exigían. |
| 8. Estilos del panel | Hecho. |
| 10. Permisos del ADMIN | **No cambiado**; decisión pendiente del equipo (§3). |

Pendiente antes del push: decisión sobre incidencias fuera de EN_CURSO (§3), verificación visual de las páginas docentes en navegador, y aplicación de S4.4 y S4.5 en el entorno QA por quien corresponda.
