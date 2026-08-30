# PracticaLink

Proyecto desarrollado como parte de la asignatura Capstone de la carrera de Ingeniería en Informática de Duoc UC.

## Descripción

PracticaLink es un sistema web orientado a la gestión y seguimiento del proceso de prácticas profesionales desde su inicio hasta su finalización.

La solución busca centralizar la información y mejorar la trazabilidad del proceso, permitiendo registrar una práctica profesional, gestionar su estado, realizar seguimientos y mantener información relevante durante su desarrollo.

Además, permitirá registrar incidencias y alertas con el propósito de facilitar la identificación oportuna de situaciones que puedan presentarse durante una práctica profesional.

## Producto Mínimo Viable (PMV)

El Producto Mínimo Viable contempla el flujo principal del proceso de práctica profesional:

1. Acceso de usuarios al sistema.
2. Registro de la práctica profesional por parte del estudiante.
3. Revisión y validación de los antecedentes registrados.
4. Gestión del estado de la práctica.
5. Seguimiento durante su desarrollo.
6. Gestión de incidencias y alertas.
7. Cierre de la práctica profesional.

## Épicas

El proyecto se encuentra organizado en las siguientes épicas:

| Código | Épica |
| ------ | ----- |
| EP01 | Acceso y gestión de usuarios |
| EP02 | Registro de práctica profesional |
| EP03 | Revisión y validación de prácticas |
| EP04 | Gestión de estado de práctica profesional |
| EP05 | Seguimiento de práctica |
| EP06 | Gestión de incidencias y alertas |
| EP07 | Cierre de práctica profesional |

## Historias de Usuario

El Product Backlog inicial está compuesto por 19 historias de usuario distribuidas entre las siete épicas.

Las historias de usuario son gestionadas mediante GitHub Issues y organizadas dentro de GitHub Projects.

## Gestión del proyecto

Para la gestión y seguimiento del desarrollo se utiliza:

- GitHub Issues para las historias de usuario.
- GitHub Projects para administrar el Product Backlog.
- Git para el control de versiones.
- Pull Requests para la revisión e integración de cambios.
- Ramas de trabajo para separar el desarrollo de nuevas funcionalidades.

## Arquitectura de la solución

PracticaLink utilizará una **arquitectura monolítica modular**.

La solución será desarrollada como una única aplicación, pero estará organizada internamente en módulos que representarán las principales responsabilidades del sistema.

Este enfoque permite mantener una estructura simple para el desarrollo, las pruebas y el despliegue, evitando la complejidad adicional de una arquitectura distribuida y manteniendo una adecuada separación de responsabilidades dentro del código.

Inicialmente, la aplicación contempla los siguientes módulos:

- Gestión de usuarios y autenticación.
- Gestión de estudiantes.
- Gestión de prácticas profesionales.
- Gestión de centros de práctica.
- Revisión y validación de prácticas.
- Gestión de estados.
- Seguimiento de prácticas.
- Gestión de incidencias y alertas.
- Cierre de prácticas profesionales.

Los módulos formarán parte de una misma aplicación y accederán a una base de datos central.

De forma general, la arquitectura puede representarse de la siguiente manera:

```text
                 Usuario
                    │
                    ▼
            Aplicación Web
                    │
        ┌───────────┴───────────┐
        │                       │
        │   Monolito Modular    │
        │                       │
        │  ┌─────────────────┐  │
        │  │ Autenticación   │  │
        │  ├─────────────────┤  │
        │  │ Estudiantes     │  │
        │  ├─────────────────┤  │
        │  │ Prácticas       │  │
        │  ├─────────────────┤  │
        │  │ Validación      │  │
        │  ├─────────────────┤  │
        │  │ Estados         │  │
        │  ├─────────────────┤  │
        │  │ Seguimientos    │  │
        │  ├─────────────────┤  │
        │  │ Incidencias     │  │
        │  ├─────────────────┤  │
        │  │ Alertas         │  │
        │  ├─────────────────┤  │
        │  │ Cierre          │  │
        │  └─────────────────┘  │
        │                       │
        └───────────┬───────────┘
                    │
                    ▼
             Base de Datos
                Central
```

## Tecnologías utilizadas

Frontend:

- Angular
- TypeScript

Backend:

- Python
- FastAPI

Base de datos:

- Supabase
- PostgreSQL

Control de versiones y colaboración:

- Git
- GitHub

## Flujo de trabajo

El flujo general de desarrollo será:

```text
feature/* → develop → main
```

Las nuevas funcionalidades se desarrollarán en ramas independientes y posteriormente serán integradas mediante Pull Request.

- main: versión estable del proyecto.
- develop: integración de funcionalidades en desarrollo.
- feature/*: desarrollo de funcionalidades o historias de usuario.

## Organización del backlog

Los estados utilizados en GitHub Projects son:

- Backlog: trabajo pendiente que todavía no ha sido seleccionado para desarrollo.
- En Desarrollo: trabajo que está siendo implementado actualmente.
- Done: trabajo terminado que cumple sus criterios de aceptación.

## Equipo

| Integrante | Rol |
| ---------- | --- |
| Carlos Seaman | Integrante del equipo |
| Freddy Neilaf | Integrante del equipo |
| **Brandon Ramirez** | Integrante del equipo |

## Repositorio

Este repositorio pertenece a la organización:

`capstone-gestion-practicas`

Repositorio principal:

`gestion-practicas-profesionales`

## Estado del proyecto

Actualmente, PracticaLink se encuentra en etapa de planificación y definición del Producto Mínimo Viable.

Se encuentran definidas:

- 7 épicas.
- 19 historias de usuario.
- Product Backlog inicial.
- Criterios de aceptación.
- Flujo principal del PMV.
- Arquitectura monolítica modular.

La estimación de las historias de usuario y la planificación de los sprints serán realizadas posteriormente mediante Planning Poker.
