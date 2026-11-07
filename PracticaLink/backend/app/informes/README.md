# S4.2 — Informe final

Implementación local de entrega/consulta. No implementa evaluación ni cambia el
cierre existente. El estado del informe es independiente del de la práctica.

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

El bucket debe ser privado, aceptar únicamente `application/pdf`, con límite de
10 MiB. El backend verifica estas propiedades antes de subir/descargar/eliminar.
Auditar `storage.objects` y sus políticas existentes: ningún permiso cliente de
lectura, listado, subida, actualización o borrado debe alcanzar este bucket,
incluyendo políticas amplias para PUBLIC/authenticated de otros módulos.
No configurar el esquema SQL `informes_privados` como esquema RPC expuesto.
La configuración de políticas de Storage se revisa/aplica por separado al
aprovisionar el bucket; no se asume que el JWT propio sea válido para Storage.

Dependencias nuevas: `pypdf>=6,<7`, declarada en requirements.txt. El validador
requiere Linux (`resource`): dos parsers simultáneos por proceso de API, 512 MiB,
5 segundos CPU, timeout 10 segundos, máximo expandido 32 MiB, 10000 objetos,
profundidad 80. Valida estructura, objetos y operaciones de páginas; rechaza
cifrado, acciones, JavaScript, formularios, archivos incrustados y referencias
externas. No equivale a análisis antimalware ni a sanitización/CDR; el archivo se
sirve como adjunto, nunca como HTML/visor incorporado. Mantener el parser actualizado.
El proxy de despliegue debe limitar cuerpo/concurrencia y tiempo de petición;
el backend también limita los bytes leídos independientemente de Content-Length.

## HTTP

Identidad exclusivamente de `get_current_user_id` (JWT validado). SQL revalida rol
activo y asignaciones actuales; ADMINISTRADOR no concede acceso académico.

- GET `/practicas/{id}/informe-final`: estado, habilitación calculada en Chile,
  fecha de habilitación y metadatos de la versión vigente. SIN_ENTREGAR es derivado.
- POST misma ruta: cuerpo binario PDF, `Content-Type: application/pdf`, cabeceras
  `Idempotency-Key` (UUID), `Version-Esperada` (0 inicial), `Nombre-Archivo`
  (nombre PDF codificado con encodeURIComponent, solo visual). No acepta actor,
  ruta de objeto ni bucket enviados por el cliente.
- GET `/practicas/{id}/informe-final/archivo`: vigente exclusivamente, como adjunto
  con `no-store` y `nosniff`. Verifica hash/tamaño y revalida autorización/versión
  después de descargar de Storage. Nunca devuelve la clave ni una URL firmada.

La interfaz consulta al abrir la sección Informe final y no expone versiones
anteriores. La habilitación del navegador es informativa; SQL vuelve a validar
estado EN_CURSO, fecha Chile >= fecha_termino y docente activo al confirmar.
Una descarga ya entregada no puede revocarse retroactivamente.

## Protocolo e integridad

Cada entrega reserva una clave inmutable UUID y versión esperada. Una reserva no
crea documento vigente. FastAPI valida PDF, sube sin upsert y verifica los bytes
almacenados antes de confirmar. La confirmación bloquea práctica y reserva,
revalida autorización/fecha/docente/estado del informe, crea documento, conserva
el histórico y cambia el puntero vigente. Dos confirmaciones para la misma versión
esperada no pueden ganar. El mismo UUID solo acepta el mismo actor/práctica/hash/
nombre/tamaño/versión y una confirmación repetida no duplica notificaciones.
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

## Dependencias S4.3/S4.4

`informe_final.estado` admite ENTREGADO/EN_EVALUACION. No existe endpoint de
inicio de evaluación. Una futura transición debe bloquear primero `practica`
y después `informe_final`, igual que reserva/confirmación. El trigger también
bloquea práctica y prohíbe cambiar versión/estado/documento desde EN_EVALUACION;
S4.3 deberá definir sus siguientes transiciones en su migración incremental.
Una operación que invierta el orden puede producir deadlock y debe reintentarse.

No se modificó `fn_cerrar_practica`: actualmente puede cerrar sin informe ni
evaluación. S4.2 tampoco marca prácticas APROBADAS o FINALIZADAS. Esa brecha sigue
pendiente de S4.4. Si el cierre gana la carrera, la confirmación rechaza la entrega;
si confirma primero, conserva el documento aunque después se cierre la práctica.

## Validación local

Desde backend, tras instalar las dependencias autorizadas en un entorno propio:

```
.venv/bin/python -B -m unittest tests.test_informes -v
.venv/bin/python -B -m unittest discover -s tests -v
python3 -B tests/integration/run_informe_final.py --docker-local
```

El runner SQL usa solo la biblioteca estándar y una imagen postgres:18.6 ya local.
Crea un contenedor aleatorio exclusivo sin red ni puertos, con tmpfs, aplica las
migraciones cronológicamente y ejecuta pruebas SQL/ACL/RLS y dos sesiones reales.
Retira únicamente su contenedor al finalizar, también ante fallo. No acepta URLs
ni utiliza .env/Supabase. Los mocks de Storage nunca hacen peticiones reales.

Desde frontend: `NG_CLI_ANALYTICS=false mise exec node@22.23.4 -- npm test -- --watch=false`
y, si pasa, `NG_CLI_ANALYTICS=false mise exec node@22.23.4 -- npm run build`.
