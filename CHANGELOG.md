# Changelog

Todos los cambios relevantes de PracticaLink se documentarán en este archivo.

El formato está basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el proyecto seguirá [Versionado Semántico](https://semver.org/lang/es/) cuando se publiquen versiones etiquetadas.

## Sin publicar

### Agregado

- Proyecto Android de PracticaLink generado con Capacitor para la release 1.1.
- Guía completa para configurar Android Studio, ejecutar en emulador o teléfono,
  generar APK de QA y versiones firmadas, y resolver errores frecuentes.
- Configuración del proyecto para permitir su ejecución mediante `ionic serve`.
- Versión Android actualizada a `1.1.0` con código interno de build `2`.
- Sincronización automática de la versión de `package.json` con Gradle antes de
  ejecutar `build-android:qa`.
- Comando `npm run build-android:qa` para compilar el frontend QA, sincronizar
  Capacitor y abrir el proyecto directamente en Android Studio.
- Configuración de ambientes Angular para usar FastAPI local durante desarrollo
  y `https://practicalink-api-qa.onrender.com` en builds QA/Android.
- Soporte CORS del backend para los orígenes utilizados por Capacitor Android.
- Buscador de empresas por RUT dentro del modal de registro de práctica.
- Integración backend con Chile RUT Empresa mediante una API key de entorno.
- Tabla `empresa` y funciones `fn_obtener_empresa_cache` y
  `fn_guardar_empresa_cache` para mantener un caché tributario de 30 días.
- Visualización de razón social, actividades, giro, rubro, ubicación y otros
  antecedentes tributarios devueltos por la integración.
- Validación del formato y dígito verificador de RUT en frontend y backend.
- Panel administrativo de EP01 para listar, crear y editar usuarios mediante modales.
- Asignación de roles y activación o desactivación de cuentas por administradores.
- Endpoints protegidos `GET/POST/PATCH /usuarios` y consulta de roles activos.
- Funciones PostgreSQL `fn_crear_usuario_admin` y `fn_actualizar_usuario_admin`.
- Guards de autenticación y autorización por roles en el frontend.
- Autorización reutilizable por roles en endpoints del backend.
- Saludo del home basado en el nombre y los roles del contexto.
- Pruebas unitarias para guards, store, home y permisos del backend.
- Registro público simplificado con nombre, apellido, correo y contraseña.

### Cambiado

- El registro de práctica se presenta como modal, utiliza toasts para errores y
  mantiene habilitado el ingreso manual cuando no se encuentra una empresa.
- `practicalink-dev` detecta entornos virtuales rotos antes de iniciar servicios.
- Se documentó como política obligatoria que las ramas `feature/*` nacen desde
  `develop` y que sus Pull Requests tienen `develop` como destino.

- El perfil estudiantil ya no se crea durante el registro. RUT, carrera y sede
  se completan posteriormente desde el modal disponible en el Home.
- El administrador puede crear cuentas con roles `ESTUDIANTE`, `GESTOR` y
  `ADMINISTRADOR` sin requerir datos académicos.

## 0.1.0 - 2026-08-30

### Agregado

- Backend inicial desarrollado con FastAPI y SQLAlchemy.
- Conexión a PostgreSQL alojado en Supabase mediante variables de entorno.
- Autenticación de usuarios mediante correo, contraseña y tokens JWT.
- Endpoints de inicio de sesión y consulta del contexto del usuario.
- Comprobaciones de estado para la API y la conexión con la base de datos.
- Frontend inicial desarrollado con Angular e Ionic.
- Páginas de inicio de sesión y página principal.
- Servicio, modelos y store de autenticación en el frontend.
- Interceptor HTTP para enviar el token de acceso en solicitudes autenticadas.
- Persistencia temporal de la sesión mediante `sessionStorage`.
- Script SQL para la relación entre usuarios y roles.
- Guía para instalar y ejecutar el proyecto en un entorno local.
- Credenciales de demostración para pruebas compartidas en la rama `develop`.

### Cambiado

- El archivo `.env.template` ahora utiliza valores genéricos y seguros.
- El README principal enlaza la documentación de instalación local.

### Seguridad

- Los archivos `.env`, entornos virtuales, dependencias instaladas, cachés y artefactos de compilación quedaron excluidos del control de versiones.
