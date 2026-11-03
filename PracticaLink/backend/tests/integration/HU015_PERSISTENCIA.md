# HU015 WEB — persistencia de incidencias

## Reproducción local

Desde la raíz del repositorio, con Docker local disponible, imagen
`postgres:18.6` ya descargada y el entorno virtual existente:

```bash
PracticaLink/backend/.venv/bin/python -B PracticaLink/backend/tests/integration/run_registro_incidencia.py --docker-local
```

No descarga imágenes ni instala dependencias. Reutiliza el ciclo de vida de
`LocalPostgres`: red interna, volumen y contenedor nuevos, identificados por
nombre aleatorio y etiqueta de propiedad. No usa `.env`, Supabase ni bases
existentes. Las contraseñas sintéticas se generan para cada ejecución y no se
imprimen. La limpieza verifica propiedad antes de eliminar recursos, también
ante errores y SIGTERM. Una interrupción no recuperable del proceso requiere
revisar exclusivamente los candidatos enumerados; nunca limpiar por prefijos
genéricos ni eliminar laboratorios ajenos.

## Orden y contratos

En el laboratorio se instala el esquema inicial y EP04 mediante el helper,
seguido de EP05-01 a EP05-05. Después:

1. `ep06-01-modelo-incidencias.sql`: catálogo, columna de tipo, restricciones,
   conservación, historial e índices.
2. `ep06-02-permisos-incidencias.sql`: roles y políticas RLS de alta.
3. `ep06-03-registrar-incidencia.sql`: función privada y ACL de ejecución.

Los scripts son transaccionales, de aplicación única. Usan `lock_timeout=5s`
y `statement_timeout=60s`. No reaplicar `schema.sql` sobre una base existente.
Fuera del laboratorio, aplicación, ventanas de bloqueo y aprovisionamiento de
logins requieren autorización y revisión del entorno. No hay migración automática.
Un fallo en un archivo revierte ese archivo, no los anteriores ya confirmados.
No se propone rollback destructivo después de registrar incidencias.

La función `incidencias_privadas.fn_registrar_incidencia(bigint,bigint,text,text)`
recibe práctica, identidad confiable del backend, código del tipo y descripción.
SQL no verifica JWT: el futuro backend debe obtener esa identidad del JWT/contexto,
nunca del body/query. Usuario y rol activos se revalidan bajo bloqueo.
Códigos: `ABANDONO`, `PROBLEMA_CENTRO`, `SALUD`, `OTRO`.

Solo admite EN_CURSO activo y no final. Asigna PENDIENTE y `clock_timestamp()`
después de los bloqueos, conserva el default técnico MEDIA y registra el evento
inicial NULL → PENDIENTE con el mismo autor/instante. No crea alertas.
Descripción: contenido no whitespace, máximo 2000 caracteres PostgreSQL;
se preservan espacios exteriores. Fecha JSON con zona UTC, visualización futura
en America/Santiago. No acepta fecha, estado, prioridad ni resolución del cliente.

Respuesta: `id_incidencia`, `id_practica`, `id_usuario`, `fecha`, `tipo`,
`descripcion`, `estado`. Error de negocio: objeto con única clave `error`,
con códigos USUARIO_NO_AUTORIZADO, PRACTICA_NO_ENCONTRADA,
PRACTICA_NO_EN_CURSO, TIPO_INVALIDO o DESCRIPCION_INVALIDA.
El llamador debe validar éxito antes del commit y revertir cualquier error.
No hay commit interno, reintentos ni idempotencia ante respuesta perdida.

## Conservación y seguridad

Los históricos mantienen todos sus valores e identificadores; tipo queda NULL.
No se crean eventos ficticios ni se clasifican estados antiguos. CHECK NOT VALID
conserva esos históricos, pero controla nuevas inserciones y actualizaciones:
los registros incompatibles requieren decisión posterior antes de HU016.
No se importan datos de localStorage.

FK práctica → incidencia RESTRICT, y triggers de rechazo DELETE/TRUNCATE sobre
incidencia e historial. Un administrador capaz de alterar el esquema o desactivar
triggers conserva facultades fuera del modelo de roles funcionales.

El login futuro recibe solo `pl_ep06_executor`, nunca `pl_ep06_owner`, y no debe
compartirse con EP04, EP05 ni conexión principal. El ejecutor carece de privilegios
directos sobre tablas y secuencias. Propietario funcional NOLOGIN, NOSUPERUSER,
NOBYPASSRLS, distinto del propietario de las tablas; políticas propias y restrictivas
para los privilegios de bloqueo. No ampliar los roles anteriores.

## Evidencia cubierta por la suite

Pruebas HU015 de permisos, catálogo, validaciones Unicode, conservación exacta de
históricos/alertas, reloj del servidor, historial inicial, rollback, bloqueos en
ambos órdenes, FK, DELETE/TRUNCATE, RLS efectivo y shadowing de tablas temporales.
Preflight rechaza FK/CHECK alterados, RLS deshabilitado y privilegios ambientales
inseguros; se verifica rollback de roles. Reutilización de índice equivalente.
Se comparan definición y ACL de funciones EP04/EP05 antes/después del incremento.
Se ejecutan además las 30 pruebas SQL HU013/HU014 existentes, incluida la operación
de inicio EP04. Esto no equivale a ejecutar toda la suite HTTP/backend EP04.

No hay endpoints ni integración Angular EP06 en este incremento. Las pruebas
PostgreSQL no acreditan permisos o migraciones de un despliegue Supabase.
