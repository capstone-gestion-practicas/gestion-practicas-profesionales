$ErrorActionPreference = 'Stop'

$projectRoot = $PSScriptRoot
$backendPath = Join-Path $projectRoot 'backend'
$cloudEnvPath = Join-Path $backendPath '.env.cloud'
$frontendPath = Join-Path $projectRoot 'frontend'

if (-not (Test-Path $cloudEnvPath)) {
    throw 'Falta backend/.env.cloud. Créalo usando backend/.env.cloud.template y agrega la URL de tu base Supabase alojada.'
}
if (-not (Test-Path (Join-Path $frontendPath 'node_modules'))) {
    throw 'Faltan dependencias del frontend. Ejecuta npm.cmd install desde PracticaLink/frontend.'
}

$databaseLine = Get-Content $cloudEnvPath | Where-Object { $_ -match '^\s*SUPABASE_DATABASE_URL\s*=' } | Select-Object -First 1
if (-not $databaseLine) {
    throw 'backend/.env.cloud debe contener SUPABASE_DATABASE_URL=...'
}

$cloudDatabaseUrl = ($databaseLine -split '=', 2)[1].Trim().Trim('"').Trim("'")
if (-not $cloudDatabaseUrl -or $cloudDatabaseUrl -match 'TU_URL|TU_PASSWORD|PROJECT_REF') {
    throw 'Completa SUPABASE_DATABASE_URL en backend/.env.cloud con la URL real de tu proyecto alojado.'
}

$env:SUPABASE_DATABASE_URL = $cloudDatabaseUrl
Write-Host 'Iniciando frontend y backend contra Supabase alojado...'
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
