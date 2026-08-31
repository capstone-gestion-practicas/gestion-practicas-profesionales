# Instrucciones para agentes de auditoría

Este archivo aplica a todo el repositorio PracticaLink. Su objetivo es guiar
revisiones técnicas, de seguridad y calidad sin alterar involuntariamente el
producto.

## Alcance del proyecto

PracticaLink es un monorepositorio compuesto por:

- `PracticaLink/frontend`: Angular 20, Ionic y Capacitor Android.
- `PracticaLink/backend`: FastAPI, SQLAlchemy, JWT y PostgreSQL/Supabase.
- `scripts/BD`: esquema y funciones PostgreSQL versionadas.
- `scripts`: comandos de desarrollo y pruebas para Windows.

La aplicación Android consume por HTTPS el backend FastAPI desplegado en Render.
El backend ejecutado por Render se obtiene desde este mismo repositorio y se
conecta a PostgreSQL alojado en Supabase.

## Regla principal de auditoría

Cuando se solicite auditar, revisar o diagnosticar, trabajar en modo de sólo
lectura. No modificar archivos, dependencias, base de datos, ramas, servicios
externos ni configuración remota salvo que el usuario solicite expresamente
implementar las correcciones.

No hacer commit, push, merge, Pull Request ni despliegue durante una auditoría
sin autorización explícita.

## Protección de información sensible

- Nunca mostrar, copiar ni versionar valores de `.env`.
- No incluir contraseñas, cadenas de conexión, tokens JWT, API keys o keystores
  en informes, logs, ejemplos o capturas.
- Informar secretos expuestos indicando únicamente archivo y línea; redactar el
  valor como `[REDACTADO]`.
- Revisar que `.env`, archivos de firma Android y artefactos APK/AAB estén
  ignorados por Git.
- Las claves privadas deben permanecer en Render, Supabase o almacenamiento
  seguro, nunca dentro del frontend o de la APK.

## Prioridades de revisión

### Backend

- Autenticación, expiración y validación de JWT.
- Autorización efectiva por roles en todos los endpoints privados.
- Identificadores de usuario obtenidos desde el JWT, no desde datos manipulables
  de la solicitud.
- Validación Pydantic de correo, RUT, longitudes, fechas y campos obligatorios.
- Consultas SQL parametrizadas y ausencia de interpolación de entradas.
- Uso correcto de `commit`, `rollback` y cierre de sesiones.
- Manejo estable de errores sin filtrar detalles internos.
- CORS limitado a los orígenes web y Capacitor necesarios.
- Timeouts y tratamiento seguro de errores en integraciones externas.

### Base de datos

- Compatibilidad entre servicios Python y firmas de funciones PostgreSQL.
- Funciones de negocio transaccionales y con `search_path` explícito.
- Restricciones, claves foráneas, unicidad, índices y valores nulos.
- RLS y políticas coherentes con el modelo de acceso.
- Ausencia de SQL dinámico inseguro.
- Cambios reproducibles y versionados en `scripts/BD/schema.sql` o en el script
  correctivo correspondiente.

No ejecutar `schema.sql`, scripts correctivos ni operaciones destructivas sobre
Supabase durante una auditoría.

### Frontend web e Ionic

- Guards de autenticación y rol, recordando que el backend es la autoridad final.
- Tokens y datos sensibles fuera de logs, URL y almacenamiento persistente
  innecesario.
- Validaciones de formularios coherentes con Pydantic y PostgreSQL.
- Estados de carga, errores, botones deshabilitados, modales y toasts.
- Accesibilidad: etiquetas, navegación por teclado, contraste y reducción de
  movimiento para animaciones.
- Diseño adaptable a móvil y ausencia de desbordamientos.
- Suscripciones, temporizadores y listeners correctamente liberados.

### Android y Capacitor

- `applicationId`, `versionName` y `versionCode` consistentes.
- Backend configurado mediante HTTPS; nunca `localhost` en una APK de QA.
- Sin secretos dentro de environments, assets ni código compilado.
- Permisos Android mínimos y justificados.
- Sin APK, AAB, keystore o credenciales de firma versionados.
- `cap sync android` ejecutado después de cada build web relevante.
- Compatibilidad con API mínima 24 y objetivo 36.

## Verificaciones locales

Ejecutar sólo las verificaciones necesarias y no destructivas. En PowerShell se
prefieren los ejecutables `.cmd` para evitar bloqueos de Execution Policy.

Frontend:

```powershell
cd PracticaLink/frontend
npm.cmd run build
npm.cmd test -- --watch=false
```

Backend:

```powershell
.\scripts\practicalink-back-test.cmd
```

Android, cuando sea parte del alcance:

```powershell
cd PracticaLink/frontend
npm.cmd run version:sync-android
npm.cmd run apk:sync
cd android
.\gradlew.bat assembleDebug
```

Si una verificación no puede ejecutarse por entorno, permisos, dependencias o
servicios externos, declararlo como limitación. No presentar una prueba no
ejecutada como aprobada.

## Formato del informe

Presentar primero los hallazgos, ordenados por severidad:

- `CRÍTICO`: compromiso de datos, credenciales o control del sistema.
- `ALTO`: vulnerabilidad explotable, autorización incorrecta o pérdida de datos.
- `MEDIO`: fallo funcional relevante, inconsistencia o riesgo de mantenimiento.
- `BAJO`: problema menor, accesibilidad, rendimiento o mejora defensiva.

Cada hallazgo debe incluir:

1. Severidad y título breve.
2. Archivo y línea exacta mediante enlace local.
3. Evidencia concreta y escenario de impacto.
4. Corrección recomendada, pequeña y verificable.
5. Prueba que debería confirmar la corrección.

Después de los hallazgos, incluir:

- Preguntas o supuestos pendientes.
- Pruebas ejecutadas y sus resultados.
- Riesgos residuales o áreas no revisadas.

Si no se encuentran problemas, decirlo expresamente y señalar igualmente las
limitaciones y verificaciones realizadas. Evitar comentarios puramente estéticos
que no tengan impacto demostrable.

## Implementación posterior

Si el usuario pide corregir hallazgos, aplicar cambios mínimos y separados por
tema. Mantener sincronizados frontend, backend, funciones SQL, pruebas y
documentación. No reducir controles de seguridad para hacer pasar una prueba.

Antes de entregar una corrección:

- Ejecutar las pruebas proporcionales al riesgo.
- Revisar `git diff --check`.
- Confirmar que no se añadieron secretos ni artefactos generados.
- Informar archivos cambiados, pruebas realizadas y cualquier limitación.
