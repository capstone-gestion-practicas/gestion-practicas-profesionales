# HU015 — FastAPI y PostgreSQL 18.6

Desde la raíz, con el entorno virtual existente, Docker disponible e imagen
`postgres:18.6` previamente descargada:

```bash
PracticaLink/backend/.venv/bin/python -B PracticaLink/backend/tests/integration/run_incidencia_http.py --docker-local
```

Crea red interna, volumen y contenedor exclusivos mediante el helper existente;
verifica nombres y etiquetas de propiedad antes de eliminarlos. No instala paquetes,
no descarga imágenes, no lee `.env` y no usa Supabase ni bases existentes. Todas las
credenciales son sintéticas, generadas en memoria y omitidas de los resultados.
La configuración y el cwd se aíslan antes de importar FastAPI. El login HU015
hereda solo `pl_ep06_executor`. El principal privilegiado pertenece exclusivamente
al laboratorio: permite comprobar que HU015 no recurre a él ante falta de permisos.

Ejecuta las suites SQL HU015/HU013/HU014 y las suites HTTP HU013/HU014 existentes,
incluido contexto EP03 e inicio EP04, junto con pruebas HTTP HU015 de:

- 201 confirmado desde conexión independiente; práctica/autor, fecha, prioridad
  técnica y evento inicial correctos para GESTOR y ADMINISTRADOR.
- Autenticación, usuario/rol inactivo, ESTUDIANTE rechazado y validaciones.
- Estados incompatibles, práctica inexistente y tipo inactivo en PostgreSQL.
- Fallo entre inserciones y fallo diferido durante commit: 500 sin filas parciales.
- Permisos efectivos, ausencia de acceso directo y ausencia de fallback.

TestClient ejecuta FastAPI con PostgreSQL real; no es una prueba E2E de navegador.
No hay mocks de SQL, identidad, contexto ni funciones de negocio. Los patches
únicamente aíslan configuración de conexiones y permiten ensayar su ausencia.
Las pruebas unitarias `test_incidencias_*.py` sí utilizan mocks y se ejecutan con
el comando backend habitual `-B -m unittest discover -s tests -v`.

No acredita despliegue Supabase. Falta integración Angular y no hay idempotencia
ante pérdida de respuesta. La eliminación de históricos permanece prohibida.
Ante SIGKILL o interrupción del daemon, revisar solo los recursos exclusivos
identificados en la salida; nunca limpiar otros laboratorios.
