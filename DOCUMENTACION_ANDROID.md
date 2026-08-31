# Aplicación Android — release 1.1 QA

Esta guía explica cómo preparar, ejecutar y generar la APK de PracticaLink desde
la rama `feature/apk-release-1.1`.

## Arquitectura

La aplicación móvil reutiliza el frontend Angular + Ionic mediante Capacitor.
El proyecto nativo se encuentra en `PracticaLink/frontend/android`.

- ID Android: `cl.practicalink.app`.
- Nombre: `PracticaLink`.
- Versión Android: `1.1.0` (`versionCode 2`).
- Android mínimo: API 24.
- Android objetivo y de compilación: API 36.
- Backend QA: `https://practicalink-api-qa.onrender.com`.
- El backend está publicado en Render y la base de datos en Supabase.

El teléfono no necesita estar conectado a la misma red local del computador.
La instancia gratuita de Render puede tardar cerca de un minuto en responder
después de un periodo de inactividad.

## Dónde se ejecuta el backend

La APK no contiene ni ejecuta FastAPI. Render obtiene el código del backend
desde el repositorio Git de PracticaLink y utiliza como directorio raíz:

```text
PracticaLink/backend
```

Render inicia ese código con:

```text
uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

La rama configurada en Render determina qué versión del backend utiliza la
aplicación. Para QA debe apuntar a `feature/apk-release-1.1` o, después de su
integración, a `release-1.1`. El flujo de ejecución es:

```text
Repositorio Git → Render (FastAPI) → aplicación Android
                         ↓
                 Supabase PostgreSQL
```

Las actualizaciones del backend requieren subir los cambios al repositorio y
desplegar esa rama en Render. No es necesario volver a generar la APK mientras
la URL pública y el contrato de los endpoints se mantengan compatibles.

## Requisitos

- Git.
- Node.js con npm.
- Android Studio.
- JDK 21 seleccionado como Gradle JVM.
- Android SDK Platform 36 y sus Build Tools.

En Android Studio, seleccionar la JVM en `Settings > Build, Execution,
Deployment > Build Tools > Gradle > Gradle JDK`. Si Gradle 8.14.3 aparece como
incompatible con JVM 25, seleccionar **Use JVM 21**.

## Preparar el proyecto

Desde la raíz del repositorio:

```powershell
git switch feature/apk-release-1.1
cd PracticaLink/frontend
npm ci
```

Si PowerShell bloquea `npm.ps1`, utilizar `npm.cmd` sin modificar la política
del sistema:

```powershell
npm.cmd ci
npm.cmd run build-android:qa
```

## Compilar QA y abrir Android Studio

Desde `PracticaLink/frontend`:

```powershell
npm run build-android:qa
```

El comando compila Angular con la configuración de producción/QA, sincroniza
los archivos web con Capacitor y abre Android Studio. No genera por sí solo el
archivo APK; la compilación final se realiza desde Android Studio o con Gradle.

Antes de compilar, el comando sincroniza automáticamente la versión declarada
en `package.json` con `android/app/build.gradle`. Para una nueva entrega sólo se
deben actualizar estos dos valores en `package.json`:

```json
"version": "1.1.0",
"config": {
  "androidVersionCode": 2
}
```

`version` usa versionado semántico y `androidVersionCode` debe incrementarse en
cada APK publicada. La sincronización también puede ejecutarse manualmente con
`npm run version:sync-android`.

Para sincronizar sin abrir Android Studio:

```powershell
npm run apk:sync
```

Para abrir Android Studio sin volver a compilar:

```powershell
npm run android:open
```

## Ejecutar en un emulador

1. Abrir `Device Manager` en Android Studio.
2. Seleccionar `Add Device` y un perfil, por ejemplo Pixel 7.
3. Elegir una imagen estable de Android API 36 con Google Play.
4. Descargar la imagen si aún no está instalada y terminar la creación.
5. Seleccionar el dispositivo virtual en la barra superior.
6. Presionar **Run app**.

No es necesario usar una imagen preview de API 37. Una imagen x86_64 es adecuada
para el emulador de Windows.

## Ejecutar en un teléfono físico

1. Activar las opciones de desarrollador y la depuración USB en Android.
2. Conectar el teléfono por USB y aceptar la autorización de depuración.
3. Seleccionarlo en la barra de dispositivos de Android Studio.
4. Presionar **Run app**.

El equipo debe tener acceso a Internet para comunicarse con el backend QA.

## Generar una APK de depuración

En Android Studio seleccionar:

```text
Build > Build App Bundles or APKs > Build APKs
```

También puede generarse desde PowerShell:

```powershell
cd PracticaLink/frontend/android
.\gradlew.bat assembleDebug
```

El resultado queda en:

```text
PracticaLink/frontend/android/app/build/outputs/apk/debug/app-debug.apk
```

Esta APK sirve para QA y pruebas internas. Android la firma automáticamente con
la clave de depuración; no debe publicarse en Google Play.

## Generar una versión firmada

Para distribución formal seleccionar en Android Studio:

```text
Build > Generate Signed App Bundle or APK
```

Seleccionar `Android App Bundle` para Google Play o `APK` para distribución
directa. Crear o seleccionar un keystore y guardar sus contraseñas fuera del
repositorio. Antes de publicar, actualizar `versionCode` y `versionName` en
`PracticaLink/frontend/android/app/build.gradle`.

Nunca se deben versionar el keystore, sus contraseñas ni archivos `.env`.

## Ambientes y conectividad

- `environment.development.ts` usa `http://127.0.0.1:8000` para desarrollo web.
- `environment.ts` usa el backend HTTPS de Render para QA y Android.
- Capacitor carga la aplicación desde `https://localhost` dentro del WebView.
- FastAPI permite los orígenes de Capacitor requeridos por la aplicación.

Las variables secretas del backend se configuran en Render. No se incluyen en
Angular, en la APK ni en el repositorio.

## Verificación recomendada

Antes de compartir la APK comprobar:

- La aplicación inicia sin pantalla en blanco.
- El login responde usando una cuenta QA.
- Se puede completar el perfil y registrar una práctica.
- La búsqueda de empresa por RUT responde o permite ingreso manual.
- Los modales, toasts y animaciones funcionan en pantalla móvil.
- El cierre de sesión elimina la sesión local.

## Problemas frecuentes

### PowerShell no permite ejecutar npm.ps1

Usar `npm.cmd`, por ejemplo `npm.cmd run build-android:qa`.

### Gradle indica una JVM incompatible

Seleccionar JDK 21 como Gradle JVM. El proyecto usa Gradle 8.14.3 y no debe
importarse con JVM 25.

### Falta Android SDK Platform 36

Instalarlo desde `Tools > SDK Manager > SDK Platforms`, aceptar las licencias y
sincronizar nuevamente Gradle.

### El backend demora o parece no responder

Abrir `https://practicalink-api-qa.onrender.com` en el navegador y esperar a que
la instancia gratuita despierte. Luego reintentar desde la aplicación.

### Los cambios web no aparecen en Android

Ejecutar nuevamente `npm run apk:sync` antes de compilar o ejecutar la app.

### Error CORS

Confirmar que la aplicación apunta al backend QA HTTPS y que Render tiene
desplegado el soporte para `https://localhost` y `capacitor://localhost`.
