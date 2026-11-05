# PracticalinkFrontend

## Publicar en Render

El repositorio incluye [`render.yaml`](../../render.yaml), que define un sitio
estático para la aplicación Angular, publica el build de producción y configura
el fallback de rutas para Angular Router.

1. Publica en GitHub la rama que contiene esta configuración.
2. En Render, selecciona **New > Blueprint** y conecta el repositorio.
3. Render detectará `render.yaml`; revisa el servicio
   `practicalink-frontend-qa` y selecciona **Apply**.
4. Espera el primer deploy. Render asignará una URL HTTPS, por ejemplo
   `https://practicalink-frontend-qa.onrender.com`.
5. En el servicio del backend de Render, agrega la variable
   `FRONTEND_ORIGINS` con el origen exacto del sitio (solo esquema y dominio,
   sin ruta ni barra final), guarda el cambio y espera el redeploy del backend.
6. Abre la URL del frontend y valida el inicio de sesión y las llamadas al API.

El build de producción ya usa el backend QA
`https://practicalink-api-qa.onrender.com`. No configures secretos del backend
en el sitio estático. Para otro dominio, actualiza `FRONTEND_ORIGINS` en el
backend con los orígenes permitidos separados por comas. No uses `*`.

Si Render muestra un error de CORS antes de actualizar el backend, revisa que
`FRONTEND_ORIGINS` coincida exactamente con el dominio asignado y que el backend
haya terminado su redeploy.

## Android (release 1.1 QA)

La guía completa se encuentra en
[`DOCUMENTACION_ANDROID.md`](../../DOCUMENTACION_ANDROID.md).

El proyecto incluye `ionic.config.json`, por lo que también puede iniciarse
desde esta carpeta con `ionic.cmd serve` en PowerShell.

La aplicación Android usa Capacitor. El build local (`build-android:qa`) apunta
a Supabase y al backend locales; el build optimizado remoto
(`build-android:prod`) apunta al backend QA publicado en:

```text
https://practicalink-api-qa.onrender.com
```

Requisitos locales:

- Node.js y dependencias instaladas con `npm ci`.
- Android Studio con Android SDK y JDK configurados.

Para compilar el frontend y sincronizar el proyecto nativo:

```powershell
npm run apk:sync
```

Para preparar el build local y abrir el proyecto en Android Studio:

```powershell
npm run build-android:qa
```

El comando usa `environment.android-local.ts`, sincroniza Capacitor y abre
Android Studio. Para preparar una APK que use los servicios remotos QA, ejecuta:

```powershell
npm.cmd run build-android:prod
```

Ese build usa `environment.ts`, con el backend QA de Render y el proyecto QA
Supabase configurados. En Android Studio, genera la APK desde
`Build > Build App Bundles or APKs > Build APKs`. La guía completa está en
[`DOCUMENTACION_ANDROID.md`](../../DOCUMENTACION_ANDROID.md).

Para compilar directamente una APK de depuración con el frontend remoto QA:

```powershell
npm.cmd run apk:debug
```

El archivo se genera en `android/app/build/outputs/apk/debug/app-debug.apk`.
Esta APK está firmada con la clave debug y es solo para pruebas internas.

Para abrirlo en Android Studio:

```powershell
npm run android:open
```

Desde Android Studio se puede ejecutar en un dispositivo o generar una APK
mediante `Build > Build App Bundles or APKs > Build APKs`.

La configuración local conserva `http://127.0.0.1:8000`; los builds remotos
usan la URL HTTPS de Render.

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 20.3.35.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Karma](https://karma-runner.github.io) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
