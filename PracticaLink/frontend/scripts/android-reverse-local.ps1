$ErrorActionPreference = 'Stop'

$sdkDirectory = $env:ANDROID_SDK_ROOT
if (-not $sdkDirectory) {
    $sdkDirectory = $env:ANDROID_HOME
}
if (-not $sdkDirectory) {
    $sdkDirectory = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
}

$adbPath = Join-Path $sdkDirectory 'platform-tools\adb.exe'
if (-not (Test-Path $adbPath)) {
    throw "No se encontró adb en '$adbPath'. Configura ANDROID_SDK_ROOT o instala Android SDK Platform-Tools."
}

& $adbPath reverse tcp:8000 tcp:8000
if ($LASTEXITCODE -ne 0) {
    throw 'No se pudo reenviar el puerto 8000. Confirma que el emulador esté iniciado.'
}

& $adbPath reverse tcp:54321 tcp:54321
if ($LASTEXITCODE -ne 0) {
    throw 'No se pudo reenviar el puerto 54321 de Supabase local.'
}

Write-Host 'Puertos locales 8000 y 54321 reenviados al emulador.'
