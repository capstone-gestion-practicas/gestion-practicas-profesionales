# PracticaLink — ejecución y pruebas WEB locales

## Estado comprobado

Sobre la base `00057b2` (PR #83), el entorno compartido autorizado quedó con 27
migraciones registradas, EP06 aplicado y postflight PASS. Se configuraron los seis
logins runtime con permisos mínimos y el bucket privado `informes-finales`:
10 MiB, application/pdf y application/vnd.openxmlformats-officedocument.wordprocessingml.document.

El ciclo E2E terminó PASS en Chromium real con Angular, FastAPI y Supabase/Storage
reales, utilizando exclusivamente datos sintéticos E2E10. No se sustituyó la
interfaz por llamadas HTTP ni mocks. La aprobación académica no cerró automáticamente
la práctica: el GESTOR responsable confirmó después el cierre formal.

| Flujo desde navegador | Resultado |
| --- | --- |
| Registro y perfil ESTUDIANTE | PASS |
| Alta DOCENTE y GESTOR desde administración | PASS |
| Inscripción, observación, aprobación y autoasignación GESTOR | PASS |
| Asignación DOCENTE e inicio de práctica | PASS |
| Registro de seguimiento e incidencia | PASS |
| Entrega PDF y cambio a DOCX | PASS |
| Descargas PDF/DOCX e integridad SHA-256 | PASS |
| Inicio explícito de evaluación y bloqueo de reemplazo | PASS |
| CON_OBSERVACIONES, notificación y reentrega corregida | PASS |
| APROBADO de la versión vigente y bloqueo de reemplazo | PASS |
| Cierre formal e historial completo | PASS |
| DOCENTE no asignado: listado vacío, detalle 404 y sin descarga | PASS |

Los resultados, fixtures, documentos, cuentas y perfil del navegador se conservan
privadamente fuera de Git. No publicar identidades, credenciales ni documentos.
Estas pruebas no certifican denegación de cada endpoint directo, todos los roles
combinados, compatibilidad universal, WCAG completo o funcionamiento de push/correo.
No se repitió E2E al actualizar esta documentación.

## Requisitos de otro equipo o entorno

El estado del entorno validado no se hereda al clonar Git. Usar
`actualizacion09/README.md` para dependencias, evidencias privadas y autorizaciones.
No reaplicar sus scripts administrativos en el servicio ya actualizado.

Se utilizaron Python 3.12.16, Node 22.23.4 mediante mise y dependencias locales
existentes. DOCX requiere Bubblewrap operativo y sus límites/sandbox: falla cerrado
si no puede iniciarse; no habilitar fallback. El código exige almacenamiento privado,
TLS PostgreSQL verify-full con CA confiable y ejecutores SQL separados.
No instalar dependencias ni configurar servicios remotos sin autorización.

Variables privadas necesarias (solo nombres): `SUPABASE_DATABASE_URL`,
`JWT_SECRET_KEY`, `INICIO_PRACTICA_DATABASE_URL`, `DOCENTE_ASSIGNMENT_DATABASE_URL`,
`INFORME_DATABASE_URL`, `SEGUIMIENTOS_DATABASE_URL`,
`SEGUIMIENTOS_LECTURA_DATABASE_URL`, `INCIDENCIAS_DATABASE_URL`,
`INFORME_STORAGE_URL`, `INFORME_STORAGE_KEY`, `INFORME_STORAGE_BUCKET`.
Cargar las conexiones/clave en entorno del backend o gestor de secretos privado;
no imprimirlas, versionarlas ni pasarlas como argumentos. Los perfiles operativos
y lanzadores particulares no forman parte del repositorio.

## Arranque WEB autorizado

Desde `PracticaLink/backend`, con configuración privada cargada:

```bash
.venv/bin/python -B -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1
```

Desde `PracticaLink/frontend`, usando dependencias ya instaladas:

```bash
NG_CLI_ANALYTICS=false mise exec node@22.23.4 -- npm start -- --host 127.0.0.1 --port 4200 --configuration development
```

Frontend: http://127.0.0.1:4200; API: http://127.0.0.1:8000. La configuración
`development` es explícita para evitar usar la API QA predeterminada. CORS debe
permitir ese origen. No usar `npm run start:all` o `npm run api` en Linux: incluyen
un flujo Windows/instalación condicional. No modificar `angular.json` por Analytics.
Un worker evita multiplicar inadvertidamente pools y validadores; no es dimensionado
para producción. El healthcheck general no acredita cada ejecutor privado y no debe
publicar datos de conexión al exterior.

Las pruebas futuras que escriban en Supabase requieren autorización específica,
cuentas/documentos ficticios y prefijo de ejecución identificable. No usar cuentas
reales ni borrar datos existentes. El administrador sintético inicial requirió un
bootstrap separado; su creación no se presenta como una prueba de registro web.
La sesión puede expirar: ingresar nuevamente desde la interfaz, sin omitir JWT.

## Evidencia histórica y límites

Las validaciones previas documentaron Angular 633/633 PASS y build correcto con
11 advertencias de presupuesto. La suite backend histórica ejecutó 522 pruebas:
15 fallos y cuatro errores clasificados en `actualizacion09/DEUDA_BACKEND.md`.
No se repitieron esas suites durante el E2E ni para este ajuste documental.
Los ensayos PostgreSQL/HTTP previos utilizaron Storage/push simulado; el ciclo WEB
posterior sí verificó carga y descarga contra Storage real. No confundir evidencias.

El alcance es exclusivamente WEB. No compilar Android/iOS, utilizar Capacitor ni
generar paquetes nativos. El despliegue público requiere un procedimiento separado.
