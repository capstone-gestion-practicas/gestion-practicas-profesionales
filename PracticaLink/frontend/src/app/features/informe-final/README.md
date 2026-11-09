# Informe final PDF/DOCX — Angular

El componente compartido conserva vistas de ESTUDIANTE, DOCENTE y GESTOR y sus
bloqueos académicos. No incorpora layouts ni modifica autorización del servidor.

Carga binaria en las rutas existentes, con Idempotency-Key estable en reintentos,
Version-Esperada y Nombre-Archivo codificado. Acepta .pdf/.docx hasta 10 MiB, no vacíos,
y exige MIME coherente cuando está presente. Con MIME vacío solo se admite una
extensión .pdf/.docx válida y se envía su MIME canónico; un MIME explícito incompatible
se rechaza. No se infiere que un ZIP sea DOCX. Estas comprobaciones no acreditan la estructura
ni sustituyen los validadores del backend (DOCX Transitional, PDF no cifrado).

Consulta formato, nombre y versión vigentes. Descarga el original desde FastAPI;
la extensión deriva del Content-Type de la respuesta, permitido por una lista
cerrada. No requiere exponer Content-Disposition mediante CORS, ni interpreta
nombres remotos, URLs de Storage o enlaces públicos. Los errores 413/415/422/429/503
mantienen estados y reintentos; el mensaje conocido de Storage PDF-only explica la
indisponibilidad DOCX sin mostrar detalles internos arbitrarios.

Validación Fase 5.1: suite Angular completa 633/633 aprobadas; build de producción
correcto con 11 advertencias de presupuesto. No se instalaron dependencias.
Comandos de reproducción desde frontend con dependencias locales:

```bash
NG_CLI_ANALYTICS=false mise exec node@22.23.4 -- npm test -- --watch=false --browsers=ChromeHeadless --include=src/app/features/informe-final/informe-final.spec.ts --include=src/app/features/evaluaciones/evaluacion-panel.spec.ts
NG_CLI_ANALYTICS=false mise exec node@22.23.4 -- npm test -- --watch=false --browsers=ChromeHeadless
NG_CLI_ANALYTICS=false mise exec node@22.23.4 -- npm run build
```

Pendiente validación visual móvil/teclado y funcionamiento en navegadores con
asociaciones MIME distintas. No se realizaron pruebas integrales finales ni despliegue.
