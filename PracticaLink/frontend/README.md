# PracticalinkFrontend

## Android (release 1.1 QA)

La guía completa se encuentra en
[`DOCUMENTACION_ANDROID.md`](../../DOCUMENTACION_ANDROID.md).

La aplicación Android utiliza Capacitor y consume el backend QA publicado en:

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

Para preparar el build QA y abrir el proyecto en Android Studio:

```powershell
npm run build-android:qa
```

El comando usa la configuración de producción de Angular, que apunta al backend
QA de Render, sincroniza Capacitor y abre Android Studio. La APK se genera desde
`Build > Build App Bundles or APKs > Build APKs`.

Para abrirlo en Android Studio:

```powershell
npm run android:open
```

Desde Android Studio se puede ejecutar en un dispositivo o generar una APK
mediante `Build > Build App Bundles or APKs > Build APKs`.

La configuración de desarrollo conserva `http://127.0.0.1:8000`; los builds de
producción y Android utilizan la URL HTTPS de Render.

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
