[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$backendDirectory = Join-Path $repositoryRoot 'PracticaLink\backend'
$pythonExecutable = Join-Path $backendDirectory '.venv\Scripts\python.exe'

if (-not (Test-Path -LiteralPath $pythonExecutable)) {
    throw 'No se encontró el Python del entorno virtual del backend. Recrea PracticaLink\backend\.venv.'
}

Write-Host 'Ejecutando pruebas del backend...' -ForegroundColor Cyan
Push-Location $backendDirectory
try {
    & $pythonExecutable -m unittest discover -s tests -v

    if ($LASTEXITCODE -ne 0) {
        throw "Las pruebas del backend fallaron con código $LASTEXITCODE."
    }
}
finally {
    Pop-Location
}

Write-Host 'Las pruebas del backend finalizaron correctamente.' -ForegroundColor Green
