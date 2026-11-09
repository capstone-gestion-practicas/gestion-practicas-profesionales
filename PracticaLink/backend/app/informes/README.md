# Informe final — PDF y DOCX

Entrega y consulta integradas con evaluación S4.3 y su barrera de cierre.
Esta ampliación no modifica las reglas académicas. El estado documental es independiente
del estado de práctica. Angular permanece fuera de esta fase.

## Configuración de destino (requiere revisión humana)

- `INFORME_DATABASE_URL`: conexión PostgreSQL dedicada a este módulo. El login debe
  ser distinto de todas las conexiones generales y S4.1; LOGIN INHERIT,
  NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE, miembro únicamente de
  `pl_s42_executor`. Sin membresía ni posibilidad de SET ROLE a `pl_s42_owner`,
  sin privilegios directos de tablas/columnas. La dependencia verifica ACL al abrir
  cada sesión y falla con 503; no hay fallback a la conexión general.
- `INFORME_STORAGE_URL`: origen HTTPS del proyecto Supabase, sin ruta ni credenciales.
- `INFORME_STORAGE_KEY`: credencial exclusivamente de servidor para Storage.
  Nunca incluirla en Angular, repositorio, logs o URLs. Una service key puede
  omitir RLS de Storage: se debe revisar expresamente su privilegio y custodia;
  no es la identidad SQL del ejecutor privado ni el JWT propio de PracticaLink.
- `INFORME_STORAGE_BUCKET`: predeterminado `informes-finales`.

No se ha configurado ni verificado un entorno remoto. La carga real NO está
operativa hasta verificar principal PostgreSQL, bucket y credencial de Storage.
El aprovisionamiento es separado; esta migración no crea buckets remotos.

El bucket debe ser privado y tener un límite positivo de hasta 10 MiB. Se aceptan
solo dos configuraciones de MIME, independientemente de su orden: `application/pdf`,
o PDF más `application/vnd.openxmlformats-officedocument.wordprocessingml.document`.
Se rechazan listas vacías, duplicados, MIME adicionales y límites inválidos.
Un bucket solo PDF conserva las operaciones PDF y la limpieza; DOCX falla con 503
antes de subir mientras su MIME no esté habilitado. Se verifica antes de subir,
descargar o eliminar; no se configura Storage automáticamente.
Auditar `storage.objects` y sus políticas existentes: ningún permiso cliente de
lectura, listado, subida, actualización o borrado debe alcanzar este bucket,
incluyendo políticas amplias para PUBLIC/authenticated de otros módulos.
No configurar el esquema SQL `informes_privados` como esquema RPC expuesto.
La configuración de políticas de Storage se revisa/aplica por separado al
aprovisionar el bucket; no se asume que el JWT propio sea válido para Storage.

Dependencias declaradas: `pypdf==7.0.0`, `defusedxml==0.7.1` y `Pillow==13.0.0`.
El servicio HTTP comparte como máximo dos validaciones PDF/DOCX por proceso API,
conservando los límites internos de los validadores. No son cuatro slots.
El PDF requiere Linux (`resource`): 512 MiB por worker,
5 segundos CPU, timeout 10 segundos, máximo expandido 32 MiB, 10000 objetos,
profundidad 80. Valida estructura, objetos y operaciones de páginas; rechaza
cifrado, acciones, JavaScript, formularios, archivos incrustados y referencias
externas. No equivale a análisis antimalware ni a sanitización/CDR; el archivo se
sirve como adjunto, nunca como HTML/visor incorporado. Mantener el parser actualizado.
DOCX Transitional usa Bubblewrap obligatorio, sin fallback, según [DOCX.md](DOCX.md).
El perfil no equivale a validación XSD completa; falta corpus real Word/LibreOffice.
La capacidad compartida es local al proceso, no una cuota global de memoria.
Las llamadas directas a los validadores conservan sus semáforos internos; toda
entrega HTTP pasa por el límite conjunto del servicio.
El proxy de despliegue debe limitar cuerpo/concurrencia y tiempo de petición;
el backend también limita los bytes leídos independientemente de Content-Length.

## HTTP

Identidad exclusivamente de `get_current_user_id` (JWT validado). SQL revalida rol
activo y asignaciones actuales; ADMINISTRADOR no concede acceso académico.

- GET `/practicas/{id}/informe-final`: estado, habilitación calculada en Chile,
  fecha de habilitación y metadatos de la versión vigente. SIN_ENTREGAR es derivado.
- POST misma ruta: cuerpo binario PDF o DOCX Transitional (sin multipart),
  Content-Type exacto del formato y cabeceras
  `Idempotency-Key` (UUID), `Version-Esperada` (0 inicial), `Nombre-Archivo`
  (nombre .pdf/.docx codificado con encodeURIComponent, solo visual). MIME,
  extensión y contenido deben coincidir. No acepta actor,
  ruta de objeto ni bucket enviados por el cliente. La respuesta conserva sus campos
  y añade `formato` (PDF/DOCX) y `mime_type`. GET incorpora esos campos también,
  null si todavía no existe informe.
- GET `/practicas/{id}/informe-final/archivo`: vigente exclusivamente, como adjunto
  con `no-store` y `nosniff`. Verifica hash/tamaño y revalida autorización/versión
  después de descargar de Storage. MIME y extensión vienen de SQL; usa el nombre
  seguro `informe-final.pdf` o `informe-final.docx`, sin interpolar el nombre original
  en cabeceras. Nunca devuelve la clave ni una URL firmada.

La interfaz consulta al abrir la sección Informe final y no expone versiones
anteriores. La habilitación del navegador es informativa; SQL vuelve a validar
estado EN_CURSO, fecha Chile >= fecha_termino y docente activo al confirmar.
Una descarga ya entregada no puede revocarse retroactivamente.

## Protocolo e integridad

Cada entrega reserva una clave inmutable UUID y versión esperada. Una reserva no
crea documento vigente. FastAPI verifica propietario antes del parser, sin bloquear
reintentos confirmados por `habilitada=false`. Valida el formato, sube sin upsert y verifica los bytes
almacenados antes de confirmar. La confirmación bloquea práctica y reserva,
revalida autorización/fecha/docente/estado del informe, crea documento, conserva
el histórico y cambia el puntero vigente. Dos confirmaciones para la misma versión
esperada no pueden ganar. El mismo UUID solo acepta el mismo actor/práctica/hash/
nombre/tamaño/versión/formato y una confirmación repetida no duplica notificaciones.
El identificador de entrega y sus metadatos persisten; no se ofrece borrado de
versiones confirmadas. Las dos notificaciones se insertan en la misma transacción.

No existe transacción distribuida con Storage. Ante error o commit ambiguo NO se
elimina el objeto inmediatamente: podría estar confirmado. Se conserva el informe
anterior si la nueva confirmación no se completó. La reserva vence en 15 minutos;
los reintentos de red usan el mismo UUID. Un conflicto vencido requiere seleccionar
el archivo de nuevo y obtener otro UUID (la UI lo indica).

Programar, con la misma configuración de servidor, sin endpoint público:

```
.venv/bin/python -B -m app.informes.cleanup
```

La limpieza reclama hasta 100 reservas vencidas con SKIP LOCKED, las cancela y
posteriormente borra por la API de Storage. Las canceladas se vuelven a procesar
tras un día incluso si el borrado anterior tuvo éxito: recupera PUT tardíos y
fallos ambiguos. El orden por próxima fecha evita inanición de reservas nuevas.
Las confirmadas jamás son candidatas. Supervisar fallos y antigüedad; sin este
job pueden acumularse objetos huérfanos. No borrar desde tablas internas de Storage.

## Dependencias SQL y académicas

Aplicar primero la migración `20261110100000_informes_pdf_docx.sql`, atómicamente y
con revisión humana. HTTP usa la reserva explícita de ocho argumentos; la firma PDF
de siete se conserva. El preflight exige ambas, S4.3 y cierre, sin DML directo ni
membresía en propietarios. La nueva firma no puede tener EXECUTE para anon,
authenticated ni service_role. No hay fallback a conexión administrativa.

S4.3 mantiene inicio explícito, vínculo a documento/versión/hash, historial inmutable,
reentrega tras CON_OBSERVACIONES y bloqueo durante EN_EVALUACION o tras APROBADO.
Se conservan los bloqueos académicos por práctica, asignaciones y autorización real.
El cierre exige GESTOR responsable y aprobación del documento vigente. Nunca
restaurar funciones anteriores que permitan cerrar sin evaluación.

Despliegue: migración -> backend compatible con bucket solo PDF -> ampliar MIME
manualmente -> verificar DOCX. Volver al backend antiguo con bucket dual provocaría
fallos de su comprobación PDF-only y requiere coordinación. No considerar operativa
la carga real hasta verificar principal SQL, políticas y Storage del destino.

## Validación local

Desde backend, con dependencias existentes y autorización para laboratorios locales:

```bash
.venv/bin/python -B -m unittest tests.test_informes tests.test_informes_formatos tests.test_docx tests.test_evaluaciones tests.test_evaluaciones_database -v
.venv/bin/python -B tests/integration/run_evaluacion_backend.py --docker-local
.venv/bin/python -B tests/integration/run_pdf_docx.py --docker-local
```

Fase 3: 85 pruebas focalizadas aprobadas e integración HTTP + PostgreSQL 18.6
aprobada con JWT real, login restringido, validadores reales y Storage en memoria.
El protocolo Storage se prueba con httpx.MockTransport; no acredita políticas ni
configuración de Supabase real. No se repitió la suite backend completa ni Angular.

El runner HTTP crea recursos Docker exclusivos etiquetados con red interna aislada,
sin puertos publicados; retira solo sus recursos al finalizar. Requiere la imagen
postgres:18.6 ya local, no descarga paquetes ni acepta URLs externas o lee .env.
DOCX requiere Bubblewrap y namespaces habilitados. Advertencia conocida de
Starlette/httpx: deprecación; no se actualizan dependencias en esta fase.
