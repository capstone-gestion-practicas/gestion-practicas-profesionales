# Integración local de HU04.2

Suite optativa `unittest` para el endpoint real
`PATCH /practicas/{id_practica}/estado`. No modifica código ni scripts SQL.
Usa FastAPI/TestClient, SQLAlchemy y PostgreSQL reales; solo simula identidad,
contexto de permisos y la dependencia principal de lectura. No simula la sesión
restringida, la función PostgreSQL, commit ni rollback.

## Requisitos de un checkout limpio

- Python y entorno virtual del backend con las dependencias de `requirements.txt`
  ya instaladas. La suite no instala paquetes.
- Docker local accesible mediante socket Unix y una imagen PostgreSQL **18.6**
  previamente disponible. No descarga imágenes (`--pull=never`).
- Linux con conectividad del host hacia la IP privada de un contenedor en una
  red Docker interna. Docker Desktop, daemons remotos y rootless no están
  validados. No se publican puertos ni se utiliza el PostgreSQL existente.
- No se necesita `.env`, Supabase, credenciales reales ni servicios del proyecto
  ejecutándose. El directorio temporal de trabajo y el entorno sintético evitan
  cargar `.env` y opciones libpq heredadas.

Desde `PracticaLink/backend`:

```bash
.venv/bin/python -B tests/integration/run_inicio_practica.py --docker-local
```

La imagen predeterminada es `postgres:18`; se comprueba que su servidor sea 18.6.
Si ya existe otra referencia local de esa versión:

```bash
.venv/bin/python -B tests/integration/run_inicio_practica.py --docker-local --image postgres:18.6
```

El tag no acredita la versión: si el servidor no es exactamente 18.6 la ejecución
falla. No se actualizan imágenes automáticamente. Una imagen ausente o falta de
permisos Docker constituye un bloqueo, no una prueba aprobada.

La suite queda fuera del discovery unitario habitual: es un runner optativo,
sin `__init__.py` en esta carpeta ni nombre `test_*.py`. Invocarlo sin
`--docker-local` termina antes de crear recursos. No admite una URL de base de
datos ni reutiliza las variables de conexión del entorno.

## Aislamiento y ciclo de vida

Cada ejecución crea nombres aleatorios y etiquetas exclusivas para contenedor,
red interna y volumen. Registra e imprime cada candidato **antes** de ejecutar
su creación, por lo que una interrupción o timeout no lo excluye de la limpieza.
Comprueba colisiones y verifica la propiedad de cada objeto tras crearlo, antes
de usarlo. Aplica, en este orden, exclusivamente dentro del contenedor:

1. `scripts/BD/schema.sql`.
2. `scripts/BD/fixes/ep04-01-permisos-iniciar-practica.sql`.
3. `scripts/BD/fixes/ep04-fn-iniciar-practica.sql`.

Genera contraseñas sintéticas en memoria y un login miembro únicamente de
`pl_ep04_executor`. La conexión principal apunta a un destino sintético sin uso
y `SessionLocal` está bloqueada en las pruebas HTTP para impedir fallback.
La escritura apunta a la IP del contenedor recién creado en la red interna,
sin aceptar destinos externos.

Al finalizar, dispone los engines y revisa los candidatos en orden inverso.
Solo elimina un recurso si su nombre inspeccionado y su etiqueta de propiedad
coinciden exactamente con la ejecución. Usa el ID inspeccionado para contenedores
y redes; Docker elimina volúmenes por nombre, después de verificar su etiqueta.
No usa prune ni elimina recursos por prefijo.

- Recurso inexistente: no requiere eliminación. Un fallo de `inspect` solo se
  considera ausencia si una enumeración exitosa del mismo tipo no contiene el nombre.
- Recurso propio: puede eliminarse.
- Recurso ajeno, resultado ambiguo o inspección/enumeración fallida: no se
  elimina; se informa tipo, nombre y causa para revisión manual.
- Si falla una eliminación, se intentan las demás. Un fallo de preparación o
  ejecución permanece visible aunque también falle la limpieza, y se devuelve error.

Dos procesos usan candidatos y etiquetas independientes, sin puertos compartidos.
Esto no es un bloqueo global contra terceros que sustituyan objetos mientras se
inspeccionan/eliminan. Los nombres aleatorios no deben reutilizarse manualmente.
Ctrl+C/SIGTERM intentan ejecutar la limpieza; SIGKILL, caída del host, pérdida del
daemon o una creación que el daemon complete tarde tras cancelar el cliente
pueden dejar recursos. Los candidatos se imprimen antes de crearlos para permitir
revisión humana incluso en esos casos. No eliminar recursos ajenos ni usar prune.
No genera informes ni archivos de resultados en el repositorio.

## Pruebas de limpieza sin Docker

```bash
.venv/bin/python -B tests/integration/run_inicio_practica.py --unit-cleanup
```

Usan `unittest.mock` en el mismo runner, sin importar el backend ni cargar `.env`.
Cubren interrupción y timeout para red/volumen/contenedor, tanto antes como después
de la creación simulada; recursos ajenos, inexistentes y ambiguos; fallo de
inspección/enumeración; continuidad de limpieza; conservación del error original;
y dos ciclos de vida paralelos con identificadores independientes. Este modo no
sustituye la integración real con Docker.

## Cobertura

- GESTOR/ADMINISTRADOR: HTTP 200, estado EN_CURSO, un solo evento nuevo,
  responsable autenticado e instante compartido entre práctica, historial y API.
- Autenticación ausente/inválida, estudiante y usuario sin rol; segunda barrera
  PostgreSQL incluso si el contexto simulado permite el acceso.
- 404/422, destinos y campos adicionales inválidos, límite de observación.
- Estados finales, origen inválido, repetición e historial ausente/inconsistente;
  rechazo sin modificar los datos.
- Fallo real de INSERT mediante trigger sintético temporal, después del UPDATE:
  HTTP 500 seguro, rollback de estado/historial y recuperación posterior.
- Login efectivo, membresía exclusiva, denegación de UPDATE/INSERT directos y
  `SET ROLE` al propietario técnico.
- Configuración restringida ausente: HTTP 503 sin fallback.
- Dos solicitudes HTTP concurrentes: un 200, un 409 y exactamente un evento nuevo.

El trigger de fallo existe únicamente en el contenedor de pruebas y se retira
en `finally`. El esquema y las funciones versionadas se cargan sin alteraciones.

## Otras validaciones y límites

La suite unitaria se ejecuta por separado:

```bash
.venv/bin/python -B -m unittest discover -s tests -v
```

Esta integración no reemplaza las pruebas de carreras de administración de roles,
catálogo, todos los casos adversos de RLS/search_path ni la regresión concurrente
de EP03 del harness exploratorio anterior. Tampoco verifica Supabase, su Data API,
login real, autenticación JWT completa, UI Angular, rendimiento ni ausencia general
de deadlocks. Los resultados históricos 39/39 y 90/91 no se atribuyen a esta suite:
el runner informa sus propios tests y subtests en cada ejecución.
