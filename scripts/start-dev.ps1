[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$backendDirectory = Join-Path $repositoryRoot 'PracticaLink\backend'
$frontendDirectory = Join-Path $repositoryRoot 'PracticaLink\frontend'
$pythonExecutable = Join-Path $backendDirectory '.venv\Scripts\python.exe'
$backendEnvFile = Join-Path $backendDirectory '.env'
$frontendModules = Join-Path $frontendDirectory 'node_modules'

if (-not (Test-Path -LiteralPath $pythonExecutable)) {
    throw 'No se encontró PracticaLink\backend\.venv\Scripts\python.exe. Crea el entorno virtual e instala requirements.txt.'
}

if (-not (Test-Path -LiteralPath $backendEnvFile)) {
    throw 'No se encontró PracticaLink\backend\.env. Créalo desde .env.template antes de iniciar.'
}

if (-not (Test-Path -LiteralPath $frontendModules)) {
    throw 'No se encontró PracticaLink\frontend\node_modules. Ejecuta npm ci dentro del frontend.'
}

if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    throw 'npm.cmd no está disponible en PATH. Instala Node.js antes de iniciar.'
}

$backendProcess = $null
$frontendProcess = $null

try {
    Write-Host 'Iniciando PracticaLink...' -ForegroundColor Cyan

    $backendProcess = Start-Process `
        -FilePath $pythonExecutable `
        -ArgumentList @('-m', 'uvicorn', 'app.main:app', '--reload', '--host', '127.0.0.1', '--port', '8000') `
        -WorkingDirectory $backendDirectory `
        -NoNewWindow `
        -PassThru

    $frontendProcess = Start-Process `
        -FilePath 'npm.cmd' `
        -ArgumentList @('start', '--', '--host', '127.0.0.1', '--port', '4200') `
        -WorkingDirectory $frontendDirectory `
        -NoNewWindow `
        -PassThru

    Write-Host 'Backend:  http://127.0.0.1:8000' -ForegroundColor Green
    Write-Host 'Swagger:  http://127.0.0.1:8000/docs' -ForegroundColor Green
    Write-Host 'Frontend: http://127.0.0.1:4200' -ForegroundColor Green
    Write-Host 'Presiona Ctrl+C para detener ambos servidores.' -ForegroundColor Yellow

    while (-not $backendProcess.HasExited -and -not $frontendProcess.HasExited) {
        Start-Sleep -Milliseconds 500
        $backendProcess.Refresh()
        $frontendProcess.Refresh()
    }

    if ($backendProcess.HasExited) {
        throw "El backend terminó inesperadamente con código $($backendProcess.ExitCode)."
    }

    throw "El frontend terminó inesperadamente con código $($frontendProcess.ExitCode)."
}
finally {
    Write-Host 'Deteniendo servidores...' -ForegroundColor Yellow

    foreach ($process in @($frontendProcess, $backendProcess)) {
        if ($null -ne $process -and -not $process.HasExited) {
            # /T detiene también los procesos hijo creados por Angular y Uvicorn.
            & taskkill.exe /PID $process.Id /T /F 2>$null | Out-Null
        }
    }
}
