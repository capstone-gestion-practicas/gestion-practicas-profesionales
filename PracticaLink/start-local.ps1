$ErrorActionPreference = 'Stop'

$projectRoot = $PSScriptRoot
$frontendPath = Join-Path $projectRoot 'frontend'
$localDatabaseUrl = 'postgresql+psycopg://postgres:postgres@127.0.0.1:54322/postgres'

if (-not (Test-Path (Join-Path $projectRoot 'supabase\config.toml'))) {
    throw 'No se encontró supabase/config.toml en PracticaLink.'
}
if (-not (Test-Path (Join-Path $frontendPath 'node_modules'))) {
    throw 'Faltan dependencias del frontend. Ejecuta npm.cmd install desde PracticaLink/frontend.'
}

Push-Location $projectRoot
try {
    Write-Host 'Iniciando Supabase local...'
    npx.cmd supabase start
    if ($LASTEXITCODE -ne 0) {
        throw 'No se pudo iniciar Supabase local. Revisa que Docker Desktop esté abierto.'
    }

    $env:SUPABASE_DATABASE_URL = $localDatabaseUrl.Replace('postgresql://', 'postgresql+psycopg://')
    Write-Host 'Iniciando frontend y backend contra la base local...'
    Push-Location $frontendPath
    try {
        npm.cmd run start:all
        if ($LASTEXITCODE -ne 0) {
            throw 'Frontend o backend terminó con error.'
        }
    }
    finally {
        Pop-Location
    }
}
finally {
    Pop-Location
}
