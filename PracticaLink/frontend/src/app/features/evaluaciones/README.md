# S4.3 — Interfaz de evaluación académica (Etapa D)

El panel académico se integra en la sección existente de Informe final, al pulsar
«Consultar disponibilidad e informe». No crea un layout ni una ruta nuevos.
El espacio DOCENTE habilita controles de inicio y resolución. ESTUDIANTE y
GESTOR reciben consulta de resultados, observaciones e historial por versión.
ADMINISTRADOR no recibe acceso académico adicional.

## Contratos FastAPI

- GET `/practicas/{id}/evaluaciones`: estado, versión, resultado e historial.
- GET `/practicas/{id}/evaluaciones/vigente`: comprobación visual antes del cierre.
- POST `/practicas/{id}/evaluaciones/inicio`: `{id_documento, version}`.
- POST `/practicas/{id}/evaluaciones/{uuid}/resolucion`:
  `{resultado: APROBADO | CON_OBSERVACIONES, observaciones: string | null}`.

Ambos POST usan `Idempotency-Key` UUID; no envían identidad del actor.
El interceptor existente agrega el JWT. Los contratos se derivan de los modelos
Pydantic de `app/evaluaciones/schemas.py`. No se muestran claves de Storage,
hashes ni identificadores técnicos de entrega.

## Estados y recuperación

Los botones quedan bloqueados durante cada envío. Las claves se conservan en
memoria por operación y contenido mientras vive el panel, incluso al consultar
nuevamente; una recarga completa del navegador pierde esos intentos. Tras recargar
se consulta el estado antes de ofrecer otra acción. No hay reintentos automáticos.
Un fallo de red/503 permite reintentar la misma operación con la misma clave.
401/403/404/409 limpian la información académica y exigen actualizar antes de actuar.
Cambiar de práctica cancela las suscripciones y limpia los intentos anteriores.

La entrega PDF reutiliza S4.2 y exige disponibilidad del servidor y consulta
académica coherente con la misma versión. EN_EVALUACION o APROBADO bloquean
reemplazos. CON_OBSERVACIONES orienta a corregir y reentregar; el resultado anterior
permanece en el historial y la nueva versión requiere otra evaluación.

Estados conserva el endpoint y las condiciones de cierre existentes y añade una
consulta explícita de aprobación vigente. El botón queda deshabilitado sin ella.
Las comprobaciones visuales no sustituyen las barreras de PostgreSQL ni garantizan
que una asignación permanezca vigente entre consulta y cierre.
No se implementa S4.4, reapertura ni rectificación.

## Validación local

**Resultado reportado por el usuario:** Angular **611/611 pruebas aprobadas** y
build correcto con **11 advertencias de presupuesto**. Estos resultados sustituyen
el bloqueo inicial por ausencia de dependencias; no se repitieron durante E06.
Las advertencias no se consideran corregidas ni se atribuyen automáticamente a S4.3.

Las pruebas usan TestBed, spies tipados y HttpTestingController; no acceden a
PostgreSQL, al backend real ni a Supabase. No equivalen a pruebas de extremo a extremo
Angular–FastAPI–Storage ni a validación visual responsive en navegador.

Comandos de reproducción desde `PracticaLink/frontend`, con Node compatible
(22.23.4 es la versión utilizada como referencia del proyecto):

```bash
NG_CLI_ANALYTICS=false npm test -- --watch=false --browsers=ChromeHeadless
NG_CLI_ANALYTICS=false npm run build
```

Si se utiliza mise y esa versión ya está disponible, anteponer
`mise exec node@22.23.4 --` a `npm`. No se afirma que esta envoltura o la opción
ChromeHeadless fueran exactamente las usadas en la validación reportada.
No instalar dependencias automáticamente si faltan; informar el bloqueo.

El [registro consolidado de S4.3](../../../../../backend/tests/integration/S43_EVALUACION.md)
detalla las correcciones locales E03/E04/E05, límites, deuda backend y riesgos de
dependencias E01/E02. La implementación local no implica despliegue: siguen pendientes
la verificación de Supabase real, permisos del principal backend, Storage y pruebas
visuales móviles/accesibilidad. No se implementó el rediseño de cierre S4.4.
