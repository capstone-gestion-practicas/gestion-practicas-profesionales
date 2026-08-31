[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$scriptsDirectory = $PSScriptRoot.TrimEnd('\')
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$pathEntries = @(
    $userPath -split ';' |
        ForEach-Object { $_.Trim().TrimEnd('\') } |
        Where-Object { $_ }
)

if ($pathEntries -contains $scriptsDirectory) {
    Write-Host 'El comando practicalink-dev ya está instalado.' -ForegroundColor Green
    exit 0
}

$newUserPath = if ([string]::IsNullOrWhiteSpace($userPath)) {
    $scriptsDirectory
} else {
    "$($userPath.TrimEnd(';'));$scriptsDirectory"
}

[Environment]::SetEnvironmentVariable('Path', $newUserPath, 'User')

Write-Host 'Comando practicalink-dev instalado correctamente.' -ForegroundColor Green
Write-Host 'Cierra y abre la terminal antes de usarlo.' -ForegroundColor Yellow
