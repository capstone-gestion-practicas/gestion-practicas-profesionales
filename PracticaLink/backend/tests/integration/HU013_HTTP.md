# HU013 WEB — Integración HTTP + PostgreSQL

Ejecutar desde la raíz con el entorno virtual y las dependencias existentes:

```bash
PracticaLink/backend/.venv/bin/python -B \
  PracticaLink/backend/tests/integration/run_seguimiento_http.py \
  --docker-local --image postgres:18.6
```

Requiere Docker local por socket Unix, imagen disponible localmente y acceso
Linux a la IP del contenedor en la red interna. No descarga imágenes, instala
dependencias ni acepta URLs externas. Comprueba `server_version_num = 180006`.
Si Docker no está disponible, ejecutar manualmente en una terminal autorizada;
no cambiar permisos ni usar sudo automáticamente.

## Aislamiento y reproducción

Reutiliza `SeguimientoPostgres` y `LocalPostgres`, con recursos nuevos
`ep05-http-<identificador aleatorio>`: contenedor, red interna y volumen exclusivos,
sin puertos publicados. No utiliza bases ni contenedores existentes. Aplica el
esquema y los scripts EP04/EP05 solo a esa base vacía. Ejecuta primero las 20
pruebas SQL existentes; si fallan, no inicia las pruebas HTTP.

La suite SQL provisiona el login sintético `ep05_test_login`, heredando únicamente
`pl_ep05_executor`; verifica membresías, atributos y privilegios efectivos. La
conexión HTTP restringida usa ese login real. La conexión principal y la conexión
observadora usan el administrador exclusivamente del laboratorio: esto permite
comprobar ausencia de fallback incluso cuando la principal podría escribir.
No acredita los privilegios de una conexión principal desplegada.

Las contraseñas y la clave JWT se generan en memoria. La aplicación se importa
después de aislar variables de entorno y directorio de trabajo temporal: no se
lee `.env`. `SEGUIMIENTOS_DATABASE_URL` existe solo durante la prueba. No hay
sustitución de JWT, contexto autenticado, dependencias de sesiones ni función SQL.
El único patch funcional cambia la configuración de conexión para los casos de
indisponibilidad y login sin privilegios. Se cierran pools antes de destruir Docker.

Las fixtures SQL usan correos `example.invalid`, que `EmailStr` rechaza. Para
las pruebas HTTP se cambian únicamente los correos sintéticos de los tres usuarios
del laboratorio a `example.com`. No se modifica ningún contrato de aplicación.

La limpieza se ejecuta también ante errores y señales capturables, verifica
nombre/etiqueta de propiedad y utiliza ID cuando corresponde. Nunca hace prune
ni borra recursos ajenos. Ante SIGKILL o pérdida del daemon puede quedar limpieza
pendiente: revisar exclusivamente los nombres candidatos impresos y su propiedad.
Los fallos de tests omiten SQL, parámetros y trazas que podrían contener credenciales;
los errores de respuesta muestran solo ubicación y tipo de validación.

## Cobertura HTTP real

Nueve pruebas (con múltiples casos) verifican:

- 201 para GESTOR y ADMINISTRADOR, autor autenticado y valores exactos observados
  desde otra conexión después de responder: evidencia de commit efectivo.
- JWT ausente/inválido/expirado, estudiante, usuario inexistente/inactivo y rol
  inactivo, sin escrituras.
- Fecha futura o timestamp, observaciones vacías/whitespace/2001 caracteres,
  medio inválido e identificadores de autor enviados en el cuerpo.
- Práctica inexistente y todos los demás estados del catálogo.
- Error real de trigger AFTER INSERT y error diferido hasta COMMIT: HTTP 500,
  ausencia del nuevo registro, conservación de filas previas y siguiente solicitud
  válida exitosa. No se altera la función SQL HU013.
- Identidad efectiva de la conexión, denegación real de INSERT/UPDATE/DELETE/TRUNCATE;
  ausencia de fallback con configuración ausente y login sin EXECUTE.
- Endpoint esperando un bloqueo de transición, confirmado mediante
  `pg_stat_activity`: transición confirmada rechaza el registro (409); transición
  revertida permite confirmarlo (201). La suite SQL cubre además el orden inverso.
- `/auth/context` de estudiante y flujo real EP04
  `PATCH /practicas/{id}/estado` → POST seguimiento. No representa cobertura
  integrada completa de todas las historias EP03/EP04.

## Resultado observado — 29-10-2026

- PostgreSQL 18.6: 20/20 pruebas SQL y 9/9 pruebas HTTP aprobadas.
- Backend: 227/227 unitarias más 8/8 pruebas del helper de limpieza, con conexiones
  reales bloqueadas en esa ejecución separada (235/235 en total).
- Primera ejecución HTTP: 7 aprobadas y 1 error por la fixture de correo reservada;
  ajustada la fixture y agregada la prueba de fallo diferido, la ejecución final
  aprobó las nueve. No fue necesario modificar código de aplicación ni SQL.
- Ambos laboratorios se eliminaron; una enumeración Docker posterior no encontró
  contenedores, redes ni volúmenes `ep05-http-*`.
- Advertencias de deprecación de Starlette/httpx y de la constante HTTP 422;
  no se actualizaron dependencias.

No se accedió a Supabase. Los resultados no acreditan permisos de producción,
conectividad remota, comportamiento de un pooler ni recuperación ante pérdida de
confirmación de commit por la red. No hay idempotencia: no reenviar automáticamente
una escritura cuyo resultado sea incierto. Angular continúa fuera del alcance.
