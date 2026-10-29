# Aplicación Android — PracticaLink

Esta guía explica cómo preparar y probar PracticaLink para Android en el
emulador local o conectada a los servicios en la nube.

## Arquitectura

La aplicación móvil reutiliza el frontend Angular + Ionic mediante Capacitor.
El proyecto nativo se encuentra en `PracticaLink/frontend/android`.

- ID Android: `cl.practicalink.app`.
- Nombre: `PracticaLink`.
- La versión Android se sincroniza desde `PracticaLink/frontend/package.json`.
- Android mínimo: API 24.
- Android objetivo y de compilación: API 36.
- Build `qa`: backend y Supabase locales en Docker.
- Build `prod`: configuración optimizada que usa los endpoints remotos de QA
  configurados en
  `src/environments/environment.ts`.

El build local usa `127.0.0.1` para el backend y Supabase. El build local
requiere Docker Desktop y `adb reverse` activo para reenviar esos puertos desde
el emulador al computador.

## Ambientes de ejecución

La APK no contiene ni ejecuta FastAPI. Para probar contra Docker, desde
`PracticaLink` inicia el stack local:

```powershell
.\start-local.cmd
```

Mantén esa ventana abierta. Desde otra terminal, compila la variante local:

```powershell
cd frontend
npm.cmd run android:reverse-local
npm.cmd run build-android:qa
```

Ejecuta `android:reverse-local` con el emulador encendido; reenvía los puertos
8000 y 54321 desde el emulador al computador. El build apunta a
`http://127.0.0.1:8000` y `http://127.0.0.1:54321`. En Android Studio, ejecuta
la variante **debug** en el emulador. La configuración debug permite HTTP sin
cifrar para este build local; no se incluye en el manifiesto de producción.

Para usar los servicios en la nube, ejecuta:

```powershell
npm.cmd run build-android:prod
```

El build `prod` usa `src/environments/environment.ts`, configurado actualmente
para el backend QA `https://practicalink-api-qa.onrender.com` y el proyecto
Supabase `vfiixozamcfbhypvmgmk`. La clave `sb_publishable_...` es pública y se
usa para Supabase Realtime; nunca agregues claves `service_role` ni `sb_secret`
al frontend. La base cloud ya contiene las migraciones de esta versión, y el
backend QA expone las rutas de seguimiento, incidencias y recordatorios.

Esta configuración apunta a QA, no a un backend de producción independiente.
Antes de distribuir la APK como release, confirma que ese es el entorno
intencionado. Para compilarla desde Android Studio después de preparar y
sincronizar el proyecto, selecciona `Build > Build App Bundles or APKs > Build
APKs`.

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
cd PracticaLink/frontend
npm ci
```

Si PowerShell bloquea `npm.ps1`, utilizar `npm.cmd` sin modificar la política
del sistema:

```powershell
npm.cmd ci
npm.cmd run build-android:qa
```

## Compilar y abrir Android Studio

`build-android:qa` compila para servicios locales; `build-android:prod` compila
para las URLs en la nube. Ambos sincronizan los archivos web con Capacitor y
abren Android Studio. No generan por sí solos el archivo APK; la compilación
final se realiza desde Android Studio o con Gradle.

Antes de compilar, el comando sincroniza automáticamente la versión declarada
en `package.json` con `android/app/build.gradle`. Para una nueva entrega sólo se
deben actualizar estos dos valores en `package.json`:

```json
"version": "1.2.2",
"config": {
  "androidVersionCode": 6
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

## Configurar notificaciones push

La app registra un token FCM por usuario autenticado. El permiso se solicita
desde **Notificaciones > Activar push en este dispositivo**. Para recibir avisos:

1. En Firebase Console, registra `cl.practicalink.app` y descarga
   `google-services.json` en `PracticaLink/frontend/android/app/`. No subas ese
   archivo al repositorio.
   El proyecto aplica el complemento Google Services y el plugin Capacitor de
   push incluye Firebase Messaging; no es necesario agregar Analytics ni otra
   dependencia Firebase para registrar el dispositivo.
2. Configura `FIREBASE_SERVICE_ACCOUNT_JSON` en el entorno privado del backend
   con el contenido JSON completo de la cuenta de servicio de Firebase autorizada para enviar mensajes FCM. En Render, escribe el nombre en **Key** y pega solo el objeto JSON (desde `{` hasta `}`) en **Value**, sin `FIREBASE_SERVICE_ACCOUNT_JSON=`. Guarda y vuelve a desplegar el backend. No publiques la clave ni la guardes en Git.
3. Instala dependencias actualizadas (`npm.cmd ci`) y ejecuta
   `pip install -r requirements.txt` en el backend.
4. Aplica `PracticaLink/supabase/migrations/20261028070000_push_devices.sql`.
5. Ejecuta `npm.cmd run apk:sync` y recompila la app Android. El plugin Gradle
   de Google Services procesa el JSON durante la compilación.

El canal Android `practicalink-notificaciones` se crea al iniciar la app y se declara también como canal predeterminado de FCM. Si ya existe en el dispositivo, su importancia y sonido se controlan desde los ajustes de notificaciones de Android.

Sin la configuración de Firebase no se generan tokens ni se envían pushes.
Las notificaciones siguen persistidas en el centro y usan Realtime cuando la
app está abierta. Si Android recibe un push mientras la app está abierta, se
muestra también una notificación en el sistema; con la app en segundo plano o
cerrada, Android muestra directamente el push de FCM.

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

- `environment.development.ts` usa `127.0.0.1` para desarrollo web en el PC.
- `environment.android-local.ts` usa `127.0.0.1` con el reenvío `adb reverse`.
- `environment.ts` define las URLs del ambiente remoto.
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

### El backend demora o parece no responder en la nube

Abrir `https://practicalink-api-qa.onrender.com` en el navegador y esperar a que
la instancia gratuita despierte. Luego reintentar desde la aplicación.

### El build local no conecta con Docker

Confirmar que Docker Desktop y `.\start-local.cmd` estén activos, que el
emulador esté encendido y que se haya ejecutado
`npm.cmd run android:reverse-local`. Si reinicias el emulador, vuelve a ejecutar
el reenvío de puertos.

### Los cambios web no aparecen en Android

Ejecutar nuevamente `npm run apk:sync` antes de compilar o ejecutar la app.

### Error CORS

Confirmar que la aplicación apunta al backend QA HTTPS y que Render tiene
desplegado el soporte para `https://localhost` y `capacitor://localhost`.
