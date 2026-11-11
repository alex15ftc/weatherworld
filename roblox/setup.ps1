# Installs tools and packages, then generates types for the language server.
# Run again any time you change wally.toml.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Invoke-Step([string]$exe, [string[]]$arguments) {
    & $exe @arguments
    if ($LASTEXITCODE -ne 0) { throw "$exe failed with exit code $LASTEXITCODE" }
}

Invoke-Step aftman @("install")
Invoke-Step wally @("install")
Invoke-Step rojo @("sourcemap", "default.project.json", "--output", "sourcemap.json")
Invoke-Step wally-package-types @("--sourcemap", "sourcemap.json", "Packages/")

Write-Host "Done. Run 'rojo serve' and connect from the Rojo plugin in Studio."
