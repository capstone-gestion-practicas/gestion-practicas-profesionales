# Validador DOCX — Fase 1 local

`docx.validar_docx(bytes)` valida el original sin modificarlo y devuelve su SHA-256.
No está conectado a rutas HTTP, Storage, SQL ni Angular. El validador PDF permanece
independiente. Las excepciones usan el patrón HTTPException existente: 413 por
archivo excesivo, 422 por documento rechazado o límites de procesamiento, 429 por
capacidad ocupada y 503 si el sandbox, dependencias o protocolo no están disponibles.
No se devuelven detalles del parser ni rutas del host.

## Perfil y presupuestos

Solo DOCX Transitional: ZIP stored/deflate, OPC con tipos/relaciones permitidos,
partes alcanzables y referencias coherentes. Se comprueban cabeceras locales y
centrales, nombres únicos sin alias, CRC, tamaños reales y límites de expansión.
No se extrae el ZIP al filesystem. XML usa defusedxml sin DTD, entidades, referencias
externas ni instrucciones de procesamiento. Todos los XML se inspeccionan, incluidos
comentarios, cambios eliminados y alternativas de compatibilidad.

Se rechazan macros, ActiveX, OLE, paquetes incrustados, altChunk, plantillas remotas,
partes desconocidas y campos activos. Las propiedades variantes usan una lista
positiva de tipos escalares de texto, números, booleanos, fechas, identificadores
y valores vacíos. Se rechazan tipos binarios/opacos y desconocidos en cualquier
nivel; los escalares no admiten hijos y los contenedores variant/vector/array
solo admiten hijos tipados coherentes y presupuestos acotados. Esto no constituye
validación XSD completa ni inspección antimalware universal de sus valores. Solo se permiten campos PAGE, NUMPAGES, REF,
PAGEREF y HYPERLINK literal restringido. Los campos divididos entre runs se ensamblan;
los campos anidados se rechazan. Las relaciones externas solo admiten hipervínculos
HTTP/HTTPS/mailto, sin consultar destinos. PNG/JPEG se verifican y decodifican con
Pillow, sin reescribirlos. No se aceptan imágenes animadas ni formatos adicionales.

| Recurso | Límite |
| --- | --- |
| Original | 10 MiB |
| Entradas ZIP | 2.048 |
| Expansión total / entrada | 64 MiB / 16 MiB |
| XML individual | 8 MiB |
| Profundidad / nodos XML acumulados | 128 / 500.000 |
| Atributos por elemento | 64 |
| Imagen / píxeles acumulados | 20 MP / 80 MP |
| Dimensión de imagen | 20.000 por eje |
| CPU / tiempo total | 5 s / 10 s |
| Espacio virtual del worker | 512 MiB |
| Respuesta del worker | 128 bytes |
| Workers simultáneos | 2 por proceso backend |

## Aislamiento

Bubblewrap es obligatorio: namespaces aislados, sin red del host, entorno vacío,
sin capacidades, sesión nueva y terminación al morir el padre. Solo se montan en
lectura el intérprete reubicado, biblioteca estándar sin site-packages, extensiones
nativas seleccionadas, dependencias necesarias y el archivo del worker. No se monta
el repositorio, home, entorno virtual completo ni archivos de configuración.
`/tmp` es temporal; escrituras a archivos regulares y core dumps tienen límite cero.
Entrada binaria por stdin y salida acotada mediante pipes no bloqueantes. Nunca hay
fallback sin sandbox. La prueba puede usar un entrypoint interno sintético; no existe
un parámetro público para seleccionar código o rutas a partir de una carga.

Runtime probado: Linux x86_64, Python 3.12.16, Bubblewrap 0.13.1,
defusedxml 0.7.1 y Pillow 13.0.0. Otros runtimes requieren validación; la ubicación del
loader y el layout reubicado son específicos de esta plataforma. El descubrimiento
de bibliotecas nativas usa ldd solo sobre binarios instalados de confianza. Estos
binarios y las dependencias deben ser inmutables para usuarios no confiables.

## Validación y límites reales

Desde backend, sin instalar dependencias:

```bash
.venv/bin/python -B -m unittest tests.test_docx tests.test_informes -v
```

Las pruebas DOCX usan fixtures sintéticos representativos y Bubblewrap real. Cubren
contenido activo, relaciones, ZIP/XML maliciosos, imágenes, conservación del original,
CPU, memoria, timeout, concurrencia y aislamiento de red/archivos/entorno. Algunas
pruebas de presupuestos reducen constantes solo en el parser de prueba para evitar
fixtures costosos. Las pruebas de informes conservan sus mocks de BD y Storage;
no acreditan integración con servicios reales.

Un DOCX básico exportado por LibreOffice fue validado dentro de Bubblewrap tras
el endurecimiento de propiedades. Pendiente: corpus representativo de Word y
LibreOffice y ajuste experimental de presupuestos.
Este es un perfil conservador de estructura y seguridad, no una validación completa
XSD de WordprocessingML ni garantía de renderizado o ausencia universal de malware.
Documentos con extensiones, firmas, imágenes o campos fuera del perfil se rechazan.
Los hipervínculos permitidos pueden ser abiertos por el lector posteriormente;
el validador no verifica su reputación ni descarga su contenido.

Los namespaces no equivalen a una VM ni incorporan seccomp/cgroups. El límite de
memoria es RLIMIT_AS, no una cuota agregada del servicio. La concurrencia es local
al proceso y separada del PDF: antes de habilitar HTTP deben dimensionarse procesos,
memoria global, límites de peticiones y política de ejecución del despliegue. Deben
revalidarse los permisos de user namespaces y Bubblewrap en el host de destino.
