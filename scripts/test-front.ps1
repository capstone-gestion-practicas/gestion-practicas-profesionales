[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$frontendDirectory = Join-Path $repositoryRoot 'PracticaLink\frontend'
$frontendModules = Join-Path $frontendDirectory 'node_modules'

if (-not (Test-Path -LiteralPath $frontendModules)) {
    throw 'No se encontró node_modules. Ejecuta npm.cmd ci dentro de PracticaLink\frontend.'
}

if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    throw 'npm.cmd no está disponible en PATH.'
}

Write-Host 'Ejecutando pruebas del frontend...' -ForegroundColor Cyan
Push-Location $frontendDirectory
try {
    & npm.cmd test -- --watch=false --browsers=ChromeHeadless

    if ($LASTEXITCODE -ne 0) {
        throw "Las pruebas del frontend fallaron con código $LASTEXITCODE."
    }
}
finally {
    Pop-Location
}

Write-Host 'Las pruebas del frontend finalizaron correctamente.' -ForegroundColor Green
