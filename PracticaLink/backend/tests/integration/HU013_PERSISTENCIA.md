# HU013 WEB — Persistencia de seguimientos (incremento 01)

Base: `develop` local `8882036`, verificada con fetch de `develop` y `main`
el 24-10-2026. Sin endpoints FastAPI ni cambios Angular. Los datos locales del
navegador son demostrativos y no se importan.

## Instalación propuesta, aún no validada en PostgreSQL

Solo en una base vacía y exclusiva se aplica primero `scripts/BD/schema.sql`.
Los scripts de este incremento se aplican en orden:

1. `scripts/BD/fixes/ep05-01-seguimiento-calendario.sql`.
2. `scripts/BD/fixes/ep05-02-permisos-seguimiento.sql`.
3. `scripts/BD/fixes/ep05-03-registrar-seguimiento.sql`.

No ejecutar `schema.sql` sobre una base existente. Cada script tiene su propia
transacción; el conjunto de tres no es una única transacción de despliegue.
Son scripts de una sola aplicación, fallan ante nombres existentes. No eliminan
datos ni sustituyen funciones previas. Requieren revisión humana y autorización
específica antes de cualquier aplicación fuera del laboratorio exclusivo.

`fecha_seguimiento DATE` contiene el día funcional. Para filas previas se deriva
de `fecha AT TIME ZONE 'America/Santiago'`; `fecha`, `fecha_creacion`, IDs,
autor, tipo y observación permanecen intactos. Para nuevas filas los timestamps
guardan el instante de registro, y el día ingresado se almacena por separado.
No se añade próxima fecha. Las restricciones de texto/medio son `NOT VALID`:
se aplican a escrituras nuevas sin rechazar, alterar o borrar datos históricos
incompatibles. Su validación global requerirá una revisión separada de esos datos.

La FK práctica→seguimiento pasa de `CASCADE` a `RESTRICT`; incluso una eliminación
de práctica iniciada por otra cascada falla si existen seguimientos. El usuario
responsable ya tiene FK `RESTRICT`. No se concede DELETE/TRUNCATE al ejecutor ni
al propietario funcional. Los propietarios de tablas/superusuarios son autoridades
de confianza: pueden cambiar el esquema o borrar datos directamente; esta función
no constituye inmutabilidad contra administradores de la base.

## Contrato SQL y confianza

`seguimientos_privados.fn_registrar_seguimiento(bigint,bigint,date,text,text)`:

- Práctica, usuario responsable, fecha calendario, medio y observación.
- Responsable existente, activo y con GESTOR o ADMINISTRADOR activo.
- Práctica EN_CURSO, estado activo y no final.
- Fecha obligatoria, finita y no posterior al día actual en America/Santiago.
- Medio exacto: Reunión presencial, Videollamada, Llamada telefónica,
  Correo electrónico u Otro.
- Observación con contenido distinto de whitespace y hasta 2.000 caracteres
  PostgreSQL (no bytes). Se conserva el texto; los espacios cuentan para el límite.

Éxito JSONB: `id_seguimiento`, `id_practica`, `id_usuario`, `fecha` (día ISO),
`tipo`, `observacion`, `fecha_creacion` (timestamp).
Errores de negocio JSONB: `USUARIO_NO_AUTORIZADO`, `PRACTICA_NO_ENCONTRADA`,
`PRACTICA_NO_EN_CURSO`, `FECHA_INVALIDA`, `MEDIO_INVALIDO`,
`OBSERVACION_INVALIDA`. No se define todavía un contrato HTTP.
Un INSERT suprimido por trigger lanza `SEGUIMIENTO_NO_CONFIRMADO`; los errores
SQL se propagan. El llamador debe hacer rollback ante cualquier error y confirmar
solo una respuesta de éxito validada. No hay reintento ni commit interno.

El ejecutor técnico puede afirmar cualquiera de los usuarios autorizados: es una
capacidad reservada al backend de confianza. La función no verifica JWT. En la
siguiente tarea el backend deberá obtener el responsable exclusivamente de la
identidad autenticada y rechazar IDs de autor enviados por el cliente. Ningún rol
cliente debe recibir el ejecutor; el esquema privado no debe exponerse en Data API.

El propietario de función es NOLOGIN, sin BYPASSRLS ni propiedad de tablas.
El ejecutor solo tiene USAGE/EXECUTE. El bootstrap verifica RLS y privilegios
ambientales de columnas/tablas; aborta si resultan incompatibles. Los permisos
UPDATE usados para locks no permiten modificar datos gracias a políticas RLS
restrictivas. La función califica las tablas y fija `search_path` seguro.
El login futuro y sus membresías/permisos heredados se provisionarán y auditarán
por separado; los scripts no modifican usuarios ni conexiones existentes.

Locks: usuario → asignaciones ordenadas → roles ordenados → práctica → estado.
El estado se consulta después de bloquear la práctica, evitando lecturas previas
a la espera. Un cambio de estado concurrente espera o termina antes del registro;
en este último caso se valida el nuevo estado. No se escribe historial de estados.
Las revocaciones de usuario/rol/asignación y cambios del catálogo esperan los locks.
No se garantiza ausencia general de deadlocks frente a otros escritores. Errores
40001/40P01/55P03 requieren rollback de la transacción completa.

## Prueba reproducible en PostgreSQL real

Desde la raíz, con dependencias ya instaladas:

```bash
PracticaLink/backend/.venv/bin/python -B \
  PracticaLink/backend/tests/integration/run_registro_seguimiento.py --docker-local
```

Requiere Docker local por socket Unix y una imagen PostgreSQL 18.6 ya disponible
(`--image` permite elegir la referencia). No instala paquetes ni descarga imágenes.
Reutiliza únicamente el helper de recursos de `run_inicio_practica.py`, con nombres
exclusivos `ep05-hu013-*`, red interna, volumen propio y sin puertos publicados.
La etiqueta de propiedad sigue la convención del helper EP04. Usa sus controles
de colisión y limpieza por propiedad e ID; nunca usa ni modifica `db_lab`.
El nombre interno de base sigue siendo `ep04_integration` por reutilización del
helper, pero se crea dentro de un contenedor nuevo, separado en cada ejecución.
Se instalan EP04 y sus fixtures sintéticos para comprobar también compatibilidad.
No importa la aplicación, no carga `.env` ni admite URLs de servidores externos.
Las conexiones de pruebas usan el login restringido real; no hay mocks de SQL.

Los 20 tests cubren reglas, autor/roles, fechas y zonas, todos los medios, límite
Unicode, rollback e INSERT fallido/suprimido, locks reales (ambos órdenes y rollback
de transición), revocación concurrente, ACL/RLS, search_path, bloqueo de borrado
directo/indirecto, conservación de filas previas y compatibilidad con inicio EP04.
La preparación incluye dos ensayos de rechazo y rollback del bootstrap: RLS
deshabilitada y grant ambiental de INSERT a PUBLIC. También verifica la eliminación
de permisos de función provenientes de default privileges.
Las fixtures antiguas incluyen datos fuera de las nuevas reglas para demostrar
que la migración los conserva. Los ensayos no acreditan la configuración de Supabase.

## Resultado de esta sesión

Sintaxis Python y entrada `--help` comprobadas. La ejecución real se intentó,
pero Docker denegó acceso al socket, también fuera del sandbox; `sudo -n` requiere
contraseña. La suite terminó antes de crear recursos y antes de ejecutar SQL.
**No hay pruebas PostgreSQL aprobadas ni se considera validado este incremento.**
La revisión/ejecución pendiente debe incluir los scripts y la suite juntos.
