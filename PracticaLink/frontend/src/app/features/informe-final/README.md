# Informe final PDF/DOCX — Angular

El componente compartido conserva vistas de ESTUDIANTE, DOCENTE y GESTOR y sus
bloqueos académicos. No incorpora layouts ni modifica autorización del servidor.

Carga binaria en las rutas existentes, con Idempotency-Key estable en reintentos,
Version-Esperada y Nombre-Archivo codificado. Acepta .pdf/.docx hasta 10 MiB, no vacíos,
y exige MIME coherente. Si el navegador no informa MIME se rechaza la selección;
no se infiere que un ZIP sea DOCX. Estas comprobaciones no acreditan la estructura
ni sustituyen los validadores del backend (DOCX Transitional, PDF no cifrado).

Consulta formato, nombre y versión vigentes. Descarga el original desde FastAPI;
la extensión deriva del Content-Type de la respuesta, permitido por una lista
cerrada. No requiere exponer Content-Disposition mediante CORS, ni interpreta
nombres remotos, URLs de Storage o enlaces públicos. Los errores 413/415/422/429/503
mantienen estados y reintentos; el mensaje conocido de Storage PDF-only explica la
indisponibilidad DOCX sin mostrar detalles internos arbitrarios.

Validación pendiente: este worktree no dispone de node_modules. No se instalaron
dependencias ni se ejecutaron pruebas o build. Con dependencias instaladas por el
usuario, desde frontend:

```bash
NG_CLI_ANALYTICS=false mise exec node@22.23.4 -- npm test -- --watch=false --browsers=ChromeHeadless --include=src/app/features/informe-final/informe-final.spec.ts --include=src/app/features/evaluaciones/evaluacion-panel.spec.ts
NG_CLI_ANALYTICS=false mise exec node@22.23.4 -- npm test -- --watch=false --browsers=ChromeHeadless
NG_CLI_ANALYTICS=false mise exec node@22.23.4 -- npm run build
```

Pendiente validación visual móvil/teclado y funcionamiento en navegadores con
asociaciones MIME distintas. No se realizaron pruebas integrales finales ni despliegue.
