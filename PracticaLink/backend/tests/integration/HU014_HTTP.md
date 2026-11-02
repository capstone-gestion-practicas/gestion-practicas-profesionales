# HU014 — HTTP con PostgreSQL real

Desde la raíz, con Docker Unix local e imagen postgres:18.6 disponible:

```bash
PracticaLink/backend/.venv/bin/python -B \
  PracticaLink/backend/tests/integration/run_historial_seguimiento_http.py --docker-local
```

No descarga imágenes, instala dependencias, carga .env ni acepta destinos externos.
Reutiliza los helpers de HU013/HU014 con contenedor, red interna y volumen propios
`ep05-hu014-http-*`. No publica puertos. Solo ejecuta SQL en ese contenedor nuevo.
Los recursos se eliminan verificando nombre, etiqueta e ID cuando corresponde;
SIGKILL o pérdida del daemon pueden exigir limpieza manual de candidatos acreditados.

Prepara históricos antes de instalar HU013, instala SQL versionado sin modificarlo,
crea login sintético de lectura y ejecuta 30 pruebas SQL. Luego importa FastAPI con
entorno y cwd aislados mediante el helper HTTP HU013. Configura en memoria la URL
de lectura; no sustituye JWT, contexto, sesiones ni resultados SQL. La configuración
se cambia únicamente para el ensayo sin URL. Cierra todos los pools antes de Docker.
No imprime credenciales ni trazas potencialmente sensibles.

Resultado observado: **30/30 SQL + 15/15 HTTP**. Las 15 HTTP incluyen seis nuevas
HU014 y nueve HU013 existentes: POST→GET con lectura independiente, filas sin cambios
tras GET, permisos reales, transacción read-only y rechazo de SELECT directo;
roles/actividad, vacío/404/422, históricos de práctica finalizada, responsable inactivo,
paginación y ausencia de fallback. Las nueve previas cubren además contexto EP03,
inicio EP04, rollback y concurrencia HU013. No acreditan todas las funcionalidades
EP03/EP04 ni comportamiento en Supabase. El login principal privilegiado solo existe
en el laboratorio; el login de lectura tiene exclusivamente pl_ep05_read_executor.

Separadamente se ejecutó unittest discover mediante el intérprete .venv, cwd temporal,
variables sintéticas y psycopg.connect bloqueado: **247/247**. No se instalaron paquetes.
Advertencias existentes Starlette/httpx y HTTP_422_UNPROCESSABLE_ENTITY; sin fallos.
La única adaptación de prueba HU013 es aceptar GET además de POST en OpenAPI;
se mantienen sus comprobaciones del cuerpo cerrado y respuesta 201.

Pendientes: provisionamiento/auditoría del login en un entorno autorizado, conexión
Angular HU014 y prueba completa de navegador. Offset puede desplazarse entre páginas
por nuevas inserciones. No se alteran SQL validado ni contratos de escritura.
