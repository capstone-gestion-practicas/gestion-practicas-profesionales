# Instalación y ejecución local de PracticaLink

Esta guía explica cómo descargar, configurar y levantar PracticaLink desde cero en un equipo de desarrollo.

## 1. Arquitectura local

El proyecto se ejecuta como dos procesos:

- Backend: FastAPI en `http://127.0.0.1:8000`.
- Frontend: Angular/Ionic en `http://localhost:4200`.
- Base de datos: Supabase local (PostgreSQL en Docker); los cambios de esquema se
  publican en Supabase alojado mediante migraciones revisadas.

La estructura relevante del repositorio es:

```text
gestion-practicas-profesionales/
├── PracticaLink/
│   ├── backend/
│   │   ├── app/
│   │   ├── .env.template
│   │   └── requirements.txt
│   └── frontend/
│       ├── src/
│       ├── package.json
│       └── package-lock.json
└── DOCUMENTACION_INSTALACION.md
```

## 2. Requisitos

Antes de comenzar, instalar:

- Git.
- Python 3.12.
- Node.js 20 LTS o una versión compatible con Angular 20.
- npm (incluido con Node.js).
- Docker Desktop con el motor Linux iniciado.
- Acceso autorizado a la base de datos Supabase del equipo.

Comprobar las instalaciones:

```powershell
git --version
python --version
node --version
npm --version
```

## 3. Descargar el repositorio

Para realizar pruebas compartidas, el equipo debe usar la rama `develop`. La rama `main` se reserva para versiones estables.

Clonar el repositorio y entrar en él:

```powershell
git clone https://github.com/capstone-gestion-practicas/gestion-practicas-profesionales.git
cd gestion-practicas-profesionales
git switch develop
git pull origin develop
```

Si el repositorio ya está descargado:

```powershell
git switch develop
git pull origin develop
```

## 3.1. Crear una rama de funcionalidad

Todas las ramas `feature/*` deben crearse desde `develop` actualizado:

```powershell
git switch develop
git pull --ff-only origin develop
git switch -c feature/nombre-de-la-feature
```

Al finalizar, la rama se publica y se abre un Pull Request cuyo destino es
obligatoriamente `develop`:

```powershell
git push -u origin feature/nombre-de-la-feature
gh pr create --base develop --head feature/nombre-de-la-feature
```

No se deben crear features desde `main` ni abrir Pull Requests de features
directamente hacia `main`. La integración de `develop` hacia `main` corresponde
a un proceso separado de publicación de una versión estable.

## 4. Configurar el backend

Entrar en el backend:

```powershell
cd PracticaLink/backend
```

Crear un entorno virtual:

```powershell
python -m venv .venv
```

Activarlo en PowerShell:

```powershell
.\.venv\Scripts\Activate.ps1
```

Si PowerShell bloquea la activación, no es necesario cambiar permanentemente su política. Se pueden ejecutar los comandos usando directamente el Python del entorno:

```powershell
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Si el entorno fue activado correctamente:

```powershell
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

### Variables de entorno

Crear `.env` desde la plantilla:

```powershell
Copy-Item .env.template .env
```

Completar `PracticaLink/backend/.env`:

```env
SUPABASE_DATABASE_URL=postgresql+psycopg://USUARIO:CONTRASENA_CODIFICADA@HOST:5432/postgres
JWT_SECRET_KEY=CLAVE_ALEATORIA_LARGA
JWT_ALGORITHM=HS256
JWT_ACCESS_TOKEN_EXPIRE_MINUTES=60

# Integraciones externas - Chile RUT Empresa
CHILE_RUT_EMPRESA_API_KEY=API_KEY_DEL_AMBIENTE
CHILE_RUT_EMPRESA_API_URL=https://chilerutempresa.cl/api
```

Consideraciones:

- Solicitar `SUPABASE_DATABASE_URL` y `JWT_SECRET_KEY` al responsable del proyecto por un canal privado.
- Si la contraseña contiene caracteres especiales, debe estar codificada para una URL. Por ejemplo, `@` se representa como `%40`.
- Nunca publicar `.env` en Git, chats, capturas ni documentación.
- `.env` ya está excluido mediante `.gitignore`.
- `.env.template` solo debe contener nombres de variables y valores de ejemplo.

### Base de datos

El esquema reproducible de Supabase local está en
`PracticaLink/supabase/migrations`. Para instalar las dependencias de la CLI y
del frontend desde la raíz del repositorio:

```powershell
cd PracticaLink
npm ci
cd frontend
npm ci
cd ..
```

Iniciar Supabase local y la aplicación:

```powershell
.\start-local.cmd
```

El script local inicia Supabase en Docker y ejecuta el backend con la base local,
sin cambiar el `.env` ni conectarse a la base alojada. La primera inicialización
usa la migración inicial y crea el esquema, pero no copia datos de la nube. Para
recrear la base local desde cero y aplicar todas las migraciones:

```powershell
npx.cmd supabase db reset --local
```

Este comando **borra los datos de la base local**. No usar `--linked` ni una URL
de la base alojada para este reinicio.

Para un cambio de esquema, crear una migración, editar el SQL generado y probar
la secuencia completa localmente:

```powershell
npx.cmd supabase migration new nombre_del_cambio
npx.cmd supabase db reset --local
```

El trabajo diario y la validación de migraciones se hacen en Supabase local; no
se requiere un branch remoto de Supabase. Los branches remotos no están
disponibles en el plan Free del proyecto.

Para preparar el envío de migraciones al proyecto alojado, enlazar la CLI al
proyecto y revisar primero su historial y esquema:

```powershell
npx.cmd supabase link --project-ref <PROJECT_REF>
npx.cmd supabase migration list --linked
npx.cmd supabase db diff --linked
```

La migración inicial de este repositorio describe un esquema que ya existe en
la base alojada. **No aplicar `db push` hasta confirmar que el esquema remoto
coincide con esa migración y que no hay una migración inicial registrada.** Si
coincide y el historial remoto no tiene ese baseline, registrar la migración
inicial como ya aplicada (esto solo actualiza el historial):

```powershell
npx.cmd supabase migration repair --status applied --linked 20261017000000
```

Para migraciones nuevas, probarlas localmente y revisar el plan que se aplicará
al proyecto enlazado:

```powershell
npx.cmd supabase db push --dry-run --linked
```

No ejecutar `db push` si el plan incluye la migración inicial contra tablas que
ya existen. Las migraciones versionan cambios de esquema; no copian datos de
usuarios ni reemplazan una copia de seguridad.

Como el destino es producción y no hay un branch remoto de preview disponible,
confirmar el plan, coordinar el cambio con el equipo y tener una copia de
seguridad antes de ejecutar `npx.cmd supabase db push --linked`. Si el proyecto
usa la integración de GitHub para desplegar migraciones automáticamente,
seguir ese flujo y no ejecutar `db push` manualmente sobre el mismo proyecto.

Si se necesita ejecutar la aplicación directamente contra la base alojada, se
puede crear `PracticaLink/backend/.env.cloud` a partir de
`.env.cloud.template` y ejecutar `.\start-cloud.cmd`. En ese modo, las
operaciones del backend se hacen contra la base remota; para el trabajo diario
local se debe usar `.\start-local.cmd`.

El esquema histórico adicional del proyecto está en `scripts/BD/schema.sql`.
Para actualizar una base existente con el caché de empresas, ejecutar en
Supabase SQL Editor:

```text
scripts/BD/fixes/release-1.1-cache-empresas.sql
```

El script crea la tabla `empresa`, habilita RLS y registra las funciones
`fn_obtener_empresa_cache` y `fn_guardar_empresa_cache` utilizadas por el backend.

## 5. Ejecutar el backend

Desde `PracticaLink/backend`, con el entorno virtual activo:

```powershell
python -m uvicorn app.main:app --reload
```

Sin activar el entorno:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

Verificar en el navegador:

- Estado de la API: `http://127.0.0.1:8000/`
- Documentación Swagger: `http://127.0.0.1:8000/docs`
- Conexión con PostgreSQL: `http://127.0.0.1:8000/health/database`

La terminal debe permanecer abierta mientras se use la aplicación.

## 6. Configurar y ejecutar el frontend

Abrir una segunda terminal. Desde la raíz del repositorio:

```powershell
cd PracticaLink/frontend
npm ci
npm start
```

`npm ci` instala exactamente las versiones registradas en `package-lock.json`. Si se modifican deliberadamente las dependencias, usar `npm install` y versionar el `package-lock.json` resultante.

Abrir `http://localhost:4200`.

El frontend está configurado para comunicarse con `http://127.0.0.1:8000`, por lo que el backend debe seguir ejecutándose en esa dirección.

## 7. Comprobación completa

Con ambas terminales abiertas:

1. Visitar `http://127.0.0.1:8000/` y comprobar que devuelva `status: ok`.
2. Visitar `http://127.0.0.1:8000/health/database` y comprobar la conexión.
3. Abrir `http://localhost:4200`.

## Ejecución conjunta en Windows

Después de completar la instalación del backend y frontend, ambos servidores se
pueden iniciar desde la raíz del repositorio con:

```powershell
.\scripts\start-dev.cmd
```

El script valida que existan `.env`, el entorno virtual del backend y
`node_modules`; luego inicia FastAPI en `http://127.0.0.1:8000` y Angular en
`http://127.0.0.1:4200`. Presionar `Ctrl+C` detiene ambos procesos.

Para instalar un comando disponible desde cualquier carpeta, ejecutar una sola
vez desde la raíz del repositorio:

```powershell
.\scripts\install-dev-command.cmd
```

Después de cerrar y abrir la terminal, iniciar el proyecto desde cualquier
ubicación con:

```powershell
practicalink-dev
```

### Uso inmediato y solución de problemas

Sin instalar el comando global, o si todavía se está usando la misma terminal,
se puede iniciar el proyecto desde la raíz con:

```powershell
.\scripts\practicalink-dev.cmd
```

Después de ejecutar `install-dev-command.cmd`, es necesario cerrar completamente
la terminal y abrir una nueva para que Windows cargue el `PATH` actualizado. Se
puede comprobar que el comando esté disponible con:

```powershell
Get-Command practicalink-dev
```

Si se necesita utilizar el comando inmediatamente sin abrir otra terminal, se
puede actualizar solo la sesión actual:

```powershell
$env:Path += ";$PWD\scripts"
practicalink-dev
```

Si PowerShell muestra que `practicalink-dev` no se reconoce, utilizar
`.\scripts\practicalink-dev.cmd` desde la raíz o repetir la instalación y abrir
una terminal nueva.

### Comandos globales de pruebas

Las pruebas se ejecutan de manera independiente:

```powershell
practicalink-back-test
practicalink-front-test
```

`practicalink-back-test` ejecuta `unittest` utilizando el entorno virtual del
backend. `practicalink-front-test` ejecuta las pruebas Angular con
ChromeHeadless.

Sin instalar los comandos globales, se pueden utilizar desde la raíz:

```powershell
.\scripts\practicalink-back-test.cmd
.\scripts\practicalink-front-test.cmd
```
4. Iniciar sesión con un usuario existente en la base de datos o crear una
   cuenta desde `Registrarme`. El registro solicita nombre, apellido, correo y
   contraseña; el perfil académico se completa después desde el Home.
5. Confirmar que se muestre la página de inicio y el contexto del usuario.

### Credenciales de prueba

Para comprobar el inicio de sesión en el entorno de desarrollo:

```text
Correo: demo@practicalink.cl
Contraseña: 123456.abc
```

Esta cuenta es únicamente para demostración y pruebas locales sobre la rama `develop`. No debe reutilizarse en producción ni almacenar información sensible.

## 8. Problemas frecuentes

### `python` no se reconoce

Instalar Python 3.12 y habilitar la opción para agregar Python al `PATH`. Cerrar y volver a abrir la terminal.

### PowerShell no permite ejecutar `Activate.ps1`

Usar directamente `.\.venv\Scripts\python.exe`, como muestran los comandos anteriores.

### `npm` no se reconoce

Instalar Node.js, cerrar la terminal y abrir una nueva. En Windows también se puede ejecutar `npm.cmd`.

### Error de conexión con la base de datos

Revisar que:

- `SUPABASE_DATABASE_URL` no contenga comillas adicionales.
- La contraseña esté codificada para URL.
- El proyecto Supabase esté activo.
- El usuario tenga permisos y conexión a Internet.

### El frontend muestra un error al iniciar sesión

Comprobar que:

- FastAPI esté ejecutándose en `http://127.0.0.1:8000`.
- `/health/database` responda correctamente.
- El usuario exista en la base y tenga una contraseña válida.
- La consola del navegador y la terminal del backend no muestren errores.

### El puerto ya está ocupado

Cerrar el proceso anterior que usa el puerto 8000 o 4200. El frontend espera actualmente que el backend use el puerto 8000.

## 9. Resumen de comandos

Terminal 1, backend:

```powershell
cd PracticaLink/backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.template .env
# Completar .env antes de continuar
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

Terminal 2, frontend:

```powershell
cd PracticaLink/frontend
npm ci
npm start
```

## Credenciales de acceso rápido

```text
Correo: demo@practicalink.cl
Contraseña: 123456.abc
```

Usar únicamente para demostración y pruebas locales en la rama `develop`.

## Aplicación Android de QA

La guía completa de requisitos, configuración, emulador, dispositivo físico,
generación de APK y solución de problemas está disponible en
[`DOCUMENTACION_ANDROID.md`](DOCUMENTACION_ANDROID.md).

La rama `feature/apk-release-1.1` contiene un proyecto Capacitor en
`PracticaLink/frontend/android`. El build Android consume el backend HTTPS:

```text
https://practicalink-api-qa.onrender.com
```

Instalar Android Studio con el Android SDK y JDK. Luego ejecutar:

```powershell
cd PracticaLink/frontend
npm ci
npm run apk:sync
npm run android:open
```

Para preparar QA y abrir Android Studio:

```powershell
npm run build-android:qa
```

En Android Studio seleccionar `Build > Build App Bundles or APKs > Build APKs`.
La APK de depuración también puede generarse, con Java y el SDK configurados,
mediante:

```powershell
cd PracticaLink/frontend/android
.\gradlew.bat assembleDebug
```

El archivo resultante queda en:

```text
PracticaLink/frontend/android/app/build/outputs/apk/debug/app-debug.apk
```
