# Flujos actuales de PracticaLink

Los diagramas `.drawio` son XML nativo y editable en draw.io (diagrams.net). También se conservan las versiones Mermaid `.mmd` como fuente de texto.

## Importar

Abre draw.io y selecciona **File > Open From > Device** (o arrastra el archivo `.drawio` al navegador). Cada archivo abre como diagrama editable; luego puedes guardarlo o exportarlo desde draw.io.

## Archivos

- `estudiante.mmd`: registro de perfil y práctica, seguimiento del estado, respuesta a observaciones y notificaciones.
- `gestor.mmd`: revisión de solicitudes, seguimiento, estados, incidencias y avisos.
- `administrador.mmd`: dashboard, usuarios, métricas y acceso a los flujos de gestión.
- `ciclo-practica.mmd`: flujo común de una práctica desde el registro del estudiante hasta su revisión, seguimiento y cierre.
- Los archivos homónimos `.drawio` son los diagramas listos para abrir directamente en draw.io.
- `servicios-arquitectura.drawio`: frontend, API, rutas, servicios backend, PostgreSQL/Supabase, Realtime, FCM y consulta externa de empresas.
- `clases-dominio.drawio`: clases/tablas principales y cardinalidades del esquema actual.
- `flujo-autenticacion.drawio`: login, emisión de JWT, carga del contexto y navegación por rol.
- `flujo-registro-revision.drawio`: registro de práctica y decisiones de revisión.
- `flujo-incidencias-notificaciones.drawio`: registro y resolución de incidencias, alertas, bandeja, Realtime y push.

## Alcance representado

Los diagramas muestran el comportamiento encontrado en el código actual. El gestor todavía consulta solicitudes y prácticas generales según su rol; la vista **Mis asignaciones** y la asignación obligatoria al pasar a `EN_CURSO` están propuestas en la iniciativa GitHub #67 y no se representan como funcionalidad existente.

