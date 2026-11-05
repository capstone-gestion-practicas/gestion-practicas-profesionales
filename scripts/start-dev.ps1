[CmdletBinding()]
param(
    [ValidateSet('all', 'backend', 'frontend')]
    [string]$Mode = 'all'
)

$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$backendDirectory = Join-Path $repositoryRoot 'PracticaLink\backend'
$frontendDirectory = Join-Path $repositoryRoot 'PracticaLink\frontend'
$pythonExecutable = Join-Path $backendDirectory '.venv\Scripts\python.exe'
$backendEnvFile = Join-Path $backendDirectory '.env'
$frontendModules = Join-Path $frontendDirectory 'node_modules'

if ($Mode -in @('all', 'backend')) {
    if (-not (Test-Path -LiteralPath $pythonExecutable)) {
        throw 'No se encontró PracticaLink\backend\.venv\Scripts\python.exe. Crea el entorno virtual e instala requirements.txt.'
    }

    # Un entorno virtual puede conservar python.exe aunque la instalación de
    # Python usada para crearlo ya no exista. Validamos que realmente ejecute.
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & $pythonExecutable --version *> $null
    $pythonExitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousErrorActionPreference
    if ($pythonExitCode -ne 0) {
        throw @'
El entorno virtual de backend está roto o apunta a una instalación de Python que ya no existe.
Instala Python y recrea el entorno con:
  cd PracticaLink\backend
  Remove-Item .venv -Recurse
  python -m venv .venv
  .\.venv\Scripts\python.exe -m pip install -r requirements.txt
'@
    }

    if (-not (Test-Path -LiteralPath $backendEnvFile)) {
        throw 'No se encontró PracticaLink\backend\.env. Créalo desde .env.template antes de iniciar.'
    }
}

if ($Mode -in @('all', 'frontend')) {
    if (-not (Test-Path -LiteralPath $frontendModules)) {
        throw 'No se encontró PracticaLink\frontend\node_modules. Ejecuta npm ci dentro del frontend.'
    }

    if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
        throw 'npm.cmd no está disponible en PATH. Instala Node.js antes de iniciar.'
    }
}

$backendProcess = $null
$frontendProcess = $null

try {
    Write-Host "Iniciando PracticaLink ($Mode)..." -ForegroundColor Cyan

    if ($Mode -in @('all', 'backend')) {
        $backendProcess = Start-Process `
            -FilePath $pythonExecutable `
            -ArgumentList @('-m', 'uvicorn', 'app.main:app', '--reload', '--host', '127.0.0.1', '--port', '8000') `
            -WorkingDirectory $backendDirectory `
            -NoNewWindow `
            -PassThru

        Start-Sleep -Milliseconds 750
        $backendProcess.Refresh()
        if ($backendProcess.HasExited) {
            throw "El backend no pudo iniciar (código $($backendProcess.ExitCode)). Revisa el error mostrado arriba."
        }
    }

    if ($Mode -in @('all', 'frontend')) {
        $frontendProcess = Start-Process `
            -FilePath 'npm.cmd' `
            -ArgumentList @('start', '--', '--host', '127.0.0.1', '--port', '4200') `
            -WorkingDirectory $frontendDirectory `
            -NoNewWindow `
            -PassThru

        Start-Sleep -Milliseconds 750
        $frontendProcess.Refresh()
        if ($frontendProcess.HasExited) {
            throw "El frontend no pudo iniciar (código $($frontendProcess.ExitCode)). Revisa el error mostrado arriba."
        }
    }

    if ($null -ne $backendProcess) {
        Write-Host 'Backend:  http://127.0.0.1:8000' -ForegroundColor Green
        Write-Host 'Swagger:  http://127.0.0.1:8000/docs' -ForegroundColor Green
    }
    if ($null -ne $frontendProcess) {
        Write-Host 'Frontend: http://127.0.0.1:4200' -ForegroundColor Green
    }
    Write-Host 'Presiona Ctrl+C para detener el servidor.' -ForegroundColor Yellow

    while ($true) {
        Start-Sleep -Milliseconds 500

        if ($null -ne $backendProcess) {
            $backendProcess.Refresh()
            if ($backendProcess.HasExited) {
                throw "El backend terminó inesperadamente con código $($backendProcess.ExitCode)."
            }
        }

        if ($null -ne $frontendProcess) {
            $frontendProcess.Refresh()
            if ($frontendProcess.HasExited) {
                throw "El frontend terminó inesperadamente con código $($frontendProcess.ExitCode)."
            }
        }
    }
}
finally {
    Write-Host 'Deteniendo servidores...' -ForegroundColor Yellow

    foreach ($process in @($frontendProcess, $backendProcess)) {
        if ($null -ne $process -and -not $process.HasExited) {
            # /T detiene también los procesos hijo creados por Angular y Uvicorn.
            try {
                & taskkill.exe /PID $process.Id /T /F 2>$null | Out-Null
            }
            catch {
                # El error de limpieza no debe ocultar la causa del fallo inicial.
                Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
            }
        }
    }
}
