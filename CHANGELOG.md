# Changelog

Todos los cambios relevantes de PracticaLink se documentarán en este archivo.

El formato está basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el proyecto seguirá [Versionado Semántico](https://semver.org/lang/es/) cuando se publiquen versiones etiquetadas.

## Sin publicar

### Agregado

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
