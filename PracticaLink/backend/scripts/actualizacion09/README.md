# Herramientas operativas PostgreSQL y Storage

## Estado y alcance

Base de código: `00057b2` (PR #83). En el Supabase compartido autorizado se
completaron la conciliación 12–16, las migraciones 17–27 y EP06 01–09; postflight
PASS. Los seis logins runtime están configurados y el bucket `informes-finales`
está privado, con límite de 10 MiB y MIME PDF/DOCX. El ciclo E2E exclusivamente
WEB terminó PASS desde Chromium con Angular, FastAPI y Supabase reales, usando
únicamente cuentas, prácticas y documentos sintéticos.

Esto registra la validación de ese entorno; no certifica otros proyectos ni el
estado futuro del servicio. No implica despliegue público, Android o iOS.

**NO REEJECUTAR la conciliación, las migraciones ni la creación de logins en el
entorno actualizado.** `apply.py` conserva un procedimiento histórico de una sola
aplicación: exige exactamente 11 versiones y ausencia de roles privados. No es un
instalador general ni un comando para actualizar futuras versiones.

## Portabilidad y dependencias

`common.py` obtiene la raíz del checkout desde su propia ubicación. Sus consumidores
usan esa misma raíz; no requieren un directorio personal ni configuración global.
El paquete fija 27 migraciones y nueve fuentes EP06: cambios futuros requieren un
plan y manifiesto revisados, no relajar las comprobaciones de cantidades/hashes.

Se requieren Python y el entorno virtual backend existente, SQLAlchemy/psycopg,
Linux para publicación atómica `renameat2`, Docker local autorizado y una imagen
`postgres:17` previamente disponible para respaldo/ensayo. No se instalan paquetes
ni se descargan imágenes automáticamente. Docker requiere acceso a su socket local.
La CA se proporciona mediante `--ca`; TLS `verify-full` y hostname son obligatorios.
Se conserva la huella aprobada de la CA pública en los clientes; cualquier rotación
requiere revisar su procedencia y compatibilidad, nunca desactivar TLS.

## Validación local sin conexión

Desde `PracticaLink/backend`:

```bash
.venv/bin/python -B scripts/actualizacion09/test_preparacion.py
.venv/bin/python -B -m unittest tests.test_diagnostico_supabase_catalogo -v
.venv/bin/python -B scripts/actualizacion09/apply.py --plan
.venv/bin/python -B scripts/actualizacion09/backup.py --plan
```

Los tests usan datos ficticios y conexiones simuladas. Los planes no conectan ni
lanzan Docker. Para un ensayo limpio sin evidencias privadas, usar
`scripts/ensayo_supabase_pg17.py --docker-local --output-dir DIRECTORIO_NUEVO`:
el directorio debe existir y ser privado; el runner solo usa SQL versionado,
PostgreSQL aislado sin red/puertos, límites de recursos y limpieza por etiqueta.

Evidencia histórica del ensayo ampliado: 35 comprobaciones PASS y nueve pruebas
offline PASS antes del ajuste de portabilidad. SQL/HTTP real utilizó PostgreSQL
17.11 y ejecutores restringidos; Storage/push fueron simulados. No emula hooks ni
extensiones internas de Supabase 17.6. El test de portabilidad añadido se valida
por separado; no se repitieron estos ensayos extensos para editar documentación.
`DEUDA_BACKEND.md` conserva la clasificación histórica de 15 fallos y cuatro errores.

## Evidencias privadas: obtención y custodia

No versionar `.env`, perfiles de conexión, certificados privados, catálogos remotos,
recibos de respaldo/restauración, dumps, cuentas, documentos ni perfiles de navegador.
Conservarlos fuera de Git y de directorios temporales sujetos a limpieza, en un
destino cifrado autorizado: directorios 0700, archivos 0600, propietario verificado.
Definir custodia, retención y una segunda copia independiente. El cifrado del volumen
no protege frente a root, Docker o una sesión comprometida.

Definir privadamente `PL_PRIVATE_DIR`, `PL_CA` y `PL_TARGET_SHA256` sin conexiones ni
contraseñas como argumentos. Confirmar el proyecto desde el Dashboard y contrastar
la ruta de conexión; una huella calculada únicamente de settings no prueba identidad.
Obtener la CA oficial por canal autenticado y contrastar su huella independientemente.
No imprimir host, usuario, URL, tokens ni errores sin depurar.

Solo con autorización de lectura y destino confirmado:

```bash
.venv/bin/python -B scripts/diagnostico_supabase_catalogo.py \
  --execute-read-only --expected-target-sha256 "${PL_TARGET_SHA256:?}" \
  --tls-rootcert "${PL_CA:?}" --output "${PL_PRIVATE_DIR:?}/catalogo-nuevo.json"
```

Exigir salida 0, `status=complete`, `capture_exhaustive=true`, 17 secciones y ausencia
de truncamiento. El script no consulta filas personales ni historial de migraciones.
No sobrescribe informes. Para la primera captura omitir `--reference`.

El ensayo ampliado/preflight histórico requiere además `context.json`, obtenido
mediante consultas de catálogo autorizadas y revisión privada: `status=complete`,
`history_versions` (versiones ordenadas), `roles` (atributos de pg_roles sin passwords),
`memberships` (parent/child y opciones ADMIN/INHERIT/SET) y `function_contracts`
(proname, arguments, pronargdefaults y defaults_hash de las firmas conciliadas).
No existe aquí un generador completo de ese complemento: no inventar valores ni
considerar reproducido el entorno solo con las 17 secciones. Requiere una nueva
captura/revisión específica antes de reutilizar el procedimiento histórico.

`manifiesto.json` enumera 36 fuentes originales y sus hashes, con el candidato EP06
separado. `integridad.json` protege los 16 archivos del paquete (se excluye a sí mismo).
Al editar un archivo, revisar su cambio antes de regenerar hashes; actualizar también
el hash del candidato en el manifiesto. Las evidencias antiguas no certifican bytes
nuevos: cualquier uso remoto posterior requiere nueva revisión/autorización.

## Respaldo y restauración: autorizaciones independientes

Coordinar suspensión de escritores, cargas, recordatorios y limpieza con el equipo.
No deducir mantenimiento solo de la ausencia de sesiones. Acordar RPO/RTO y destino.
Preparar `pg_service.conf` privado fuera de Git, sin passwords en comandos ni logs.
Tras autorización explícita para extracción:

```bash
.venv/bin/python -B scripts/actualizacion09/backup.py \
  --authorized-backup-read --confirm-encrypted-destination \
  --service-file "${PL_SERVICE_FILE:?}" --service practicalink_test \
  --catalog "${PL_PRIVATE_DIR:?}/catalogo-nuevo.json" --ca "${PL_CA:?}" \
  --out "${PL_PRIVATE_DIR:?}/respaldo-nuevo"
```

El backup usa pg_dump17 y un snapshot READ ONLY exportado, compartido con recuentos,
para `public` y `supabase_migrations`. Conserva TOC y SHA-256; límite de 1 GiB y 600 s.
Lee metadatos/recuentos de Storage, **no sus bytes** ni toda la plataforma Supabase.
Ahora hay objetos de prueba: no asumir Storage vacío ni marcar respaldo completo sin
respaldar y verificar también objetos/versiones/hashes. No exportar hashes de roles SQL.

Una restauración real exige autorización separada y un destino aislado protegido:
Docker sin red ni puertos y socket interno, o recuperación TLS con identidad distinta
aprobada. Nunca restaurar sobre el origen. Conservar owners/ACL/RLS; no usar `--clean`,
`--no-owner` o `--no-acl` para ocultar errores. `preparar_toc.py` solo omite el esquema
public y defaults del proveedor previamente reproducidos/verificados; original intacto.
Exigir pg_restore17 `--exit-on-error --single-transaction`, revisar dependencias,
roles, ACL/RLS, triggers, índices, secuencias y todos los recuentos del snapshot.
`verificar_restore.py` solo verifica un destino TLS separado: no ejecuta el restore
ni sustituye esa revisión; checksum/recuentos no prueban igualdad criptográfica de filas.

## SQL administrativo y procedimiento histórico

`apply.py`, `common.update`, `ep06_01_compatible_roundtrip.sql` y
`runtime_principals.sql` pueden modificar datos/esquema/permisos. **No son
reejecutables ni se ejecutan automáticamente por integrar este PR.** Requieren
aprobación específica del destino y cada operación, respaldo restaurable vigente,
mantenimiento y preflight sin divergencias. Los flags técnicos no autorizan nada.

El plan histórico concilia solo historial 12–16 (sin replay ni UPDATE push), aplica
17–27 y EP06 en una única transacción y limpia membresías temporales acotadas.
El candidato EP06 acepta únicamente el CHECK esperado y su representación roundtrip;
no cambia la fuente histórica ni acepta definiciones arbitrarias. Los SQL con marcos
externos auditados se adoptan en memoria, no se editan migraciones aplicadas.
`runtime_principals.sql` crea seis logins y pide passwords interactivamente; no concede
owners, SUPERUSER/BYPASSRLS ni DML directo. No ejecutarlo donde ya existan.

El preflight histórico exige catálogo/contexto y fuentes exactas de aquella situación;
no puede reutilizarse contra las 27 migraciones actuales. `apply.py` exige además
recibo de respaldo/restauración compatible, íntegro y menor de una hora, y archivo
original con SHA-256 correcto. El adaptador local usado en la operación compartida
no forma parte del paquete reutilizable: no fabricar recibos para suplirlo.

`postflight.sql` y los SQL de catálogo son de solo lectura; sus booleanos requieren
revisión humana, no equivalen a pruebas funcionales. Ante error o COMMIT ambiguo:
parar, mantener mantenimiento y comprobar catálogo/historial antes de reintentar.
No hay down autorizado: recuperar hacia adelante. **Nunca restaurar una función de
cierre que permita omitir la aprobación académica de la versión vigente.**

## Runtime, Storage y aceptación WEB

Seis conexiones separadas: `INICIO_PRACTICA_DATABASE_URL`,
`DOCENTE_ASSIGNMENT_DATABASE_URL`, `INFORME_DATABASE_URL`,
`SEGUIMIENTOS_DATABASE_URL`, `SEGUIMIENTOS_LECTURA_DATABASE_URL` e
`INCIDENCIAS_DATABASE_URL`. Cada login solo hereda su ejecutor y debe superar su
preflight FastAPI; nunca usar el login administrativo como fallback académico.
Mantener `SUPABASE_DATABASE_URL` y `JWT_SECRET_KEY` en configuración privada.

`storage-private.json` es declarativo, no crea buckets. Comparar antes de crear:
privado, 10 MiB, PDF/DOCX exactos. `INFORME_STORAGE_URL`, `INFORME_STORAGE_KEY` e
`INFORME_STORAGE_BUCKET` son backend; ninguna clave de servidor va a Angular.
No modificar buckets existentes ni añadir políticas cliente para eludir FastAPI.

Ver `../PRUEBAS_WEB_LOCALES.md` para arranque y evidencia E2E aprobada. La aceptación
WEB se verificó con datos sintéticos; no es certificación de despliegue público,
compatibilidad con todos los navegadores, correo/push externo ni todos los ataques.
