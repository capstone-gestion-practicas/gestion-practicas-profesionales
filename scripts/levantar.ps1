$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$backendPath = Join-Path $root 'PracticaLink\backend'
$frontendPath = Join-Path $root 'PracticaLink\frontend'
$backendPython = Join-Path $backendPath '.venv\Scripts\python.exe'

if (-not (Test-Path $backendPath)) {
    throw "No se encontró el backend en $backendPath"
}

if (-not (Test-Path $frontendPath)) {
    throw "No se encontró el frontend en $frontendPath"
}

if (Test-Path $backendPython) {
    $backendCommand = "& '$backendPython' -m uvicorn app.main:app --reload"
} else {
    $backendCommand = "python -m uvicorn app.main:app --reload"
}

Start-Process powershell.exe -ArgumentList @(
    '-NoExit',
    '-Command',
    "Set-Location '$backendPath'; $backendCommand"
)

Start-Process powershell.exe -ArgumentList @(
    '-NoExit',
    '-Command',
    "Set-Location '$frontendPath'; npm start"
)

Write-Host 'Backend: http://127.0.0.1:8000' -ForegroundColor Green
Write-Host 'Frontend: http://localhost:4200' -ForegroundColor Green