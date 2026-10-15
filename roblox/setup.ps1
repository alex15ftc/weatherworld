# Installs the pinned tools and Wally packages, generates package types, and exports the world
# map the place is built from if it is not there yet. Run again whenever aftman.toml or
# wally.toml changes; delete src\worlddata to re-export after changing the world generator.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Invoke-Step([string] $Command, [string[]] $Arguments) {
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Command $($Arguments -join ' ') failed ($LASTEXITCODE)" }
}

Invoke-Step aftman @("install", "--no-trust-check")
if (-not (Test-Path "src\worlddata") -or -not (Test-Path "src\shared\MapData")) {
    Push-Location ..
    try { Invoke-Step node @("scripts/export-world-roblox.mjs") } finally { Pop-Location }
}
Invoke-Step wally @("install")
Invoke-Step rojo @("sourcemap", "default.project.json", "--output", "sourcemap.json")
Invoke-Step wally-package-types @("--sourcemap", "sourcemap.json", "Packages/")

Write-Host "Ready: run 'rojo serve' here, then Connect in the Rojo plugin in Studio."
