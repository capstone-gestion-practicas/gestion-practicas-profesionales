$ErrorActionPreference = 'Stop'

$frontendPath = Join-Path $PSScriptRoot 'frontend'

if (-not (Test-Path (Join-Path $frontendPath 'node_modules'))) {
    throw 'Faltan dependencias del frontend. Ejecuta npm.cmd install desde PracticaLink/frontend.'
}

Write-Host 'Iniciando solo el frontend contra la API remota de Render...'
Push-Location $frontendPath
try {
    npm.cmd run start:cloud
    if ($LASTEXITCODE -ne 0) {
        throw 'El frontend terminó con error.'
    }
}
finally {
    Pop-Location
}
