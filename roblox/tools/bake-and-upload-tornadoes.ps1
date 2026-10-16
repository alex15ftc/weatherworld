# One click (Bake and upload tornadoes.bat): bakes every tornado type from the owner's tornado
# (Art/tornado/tz_0037_cone_R.blend) one at a time in Blender, packs them into sheets and uploads
# them to Roblox, rewriting Shared/Weather/Textures.luau.
#
# Frames go to %LOCALAPPDATA%\WeatherWorldBake\frames (a short path: Blender and Python fail on
# Windows paths past 260 characters) and a frame already there is not baked again, so a run that
# is stopped picks up where it left off. Uploads are recorded in Textures/uploaded.json; nothing
# uploads twice. Asks for the Open Cloud key (tools/set-opencloud-key.ps1) if none is stored.
#
#   -Types cone,wedge   only these types        -Frames 64 / -Size 128   as bake_tornado_types.py
#   -SkipBake           pack and upload only     -SkipUpload              bake and pack only
param(
    [string[]]$Types = @("cone", "stovepipe", "wedge", "partial-wedge", "drillbit", "rope", "elephant-trunk", "uncondensed"),
    [int]$Frames = 64,
    [int]$Size = 128,
    [switch]$SkipBake,
    [switch]$SkipUpload
)
$ErrorActionPreference = "Stop"
$roblox = Split-Path -Parent $PSScriptRoot
$repo = Split-Path -Parent $roblox
$work = Join-Path $env:LOCALAPPDATA "WeatherWorldBake"
# (PowerShell names ignore case: $Frames is the parameter, so the folder is $frameDir.)
$frameDir = Join-Path $work "frames"
$build = Join-Path $roblox "Textures\build"
New-Item -ItemType Directory -Force $frameDir, $build | Out-Null

function Step($text) { Write-Host ""; Write-Host "== $text" -ForegroundColor Cyan }
# Runs a program (arguments as an array, so PowerShell passes "--" and "-b" through as they are).
function Run([string]$exe, [object[]]$arguments) {
    & $exe @arguments
    if ($LASTEXITCODE -ne 0) { throw "$(Split-Path -Leaf $exe) failed (exit $LASTEXITCODE)" }
}

if (-not $SkipBake) {
    $blender = $env:BLENDER
    if (-not $blender) {
        $blender = Get-ChildItem "$env:ProgramFiles\Blender Foundation\*\blender.exe" -ErrorAction SilentlyContinue |
            Sort-Object { [version]($_.Directory.Name -replace '[^\d.]', '') } | Select-Object -Last 1 -ExpandProperty FullName
    }
    if (-not $blender -or -not (Test-Path $blender)) { throw "Blender not found: install it, or set BLENDER to blender.exe" }
    # Blender works on copies in the short folder; the repository's .blend is never changed.
    Copy-Item (Join-Path $roblox "Art\tornado\tz_0037_cone_R.blend") $work -Force
    Copy-Item (Join-Path $repo "scripts\blender\bake_tornado_types.py") $work -Force
    $i = 0
    foreach ($type in $Types) {
        $i++
        Step "Baking $type ($i of $($Types.Count)) with $blender"
        Run $blender @("-b", (Join-Path $work "tz_0037_cone_R.blend"), "--python", (Join-Path $work "bake_tornado_types.py"), "--",
            "--out", $frameDir, "--types", $type, "--frames", $Frames, "--size", $Size)
    }
}

# The cloud art (and the original tornado bake) come from the repository's history; a fresh
# checkout has no build folder yet.
if (-not (Test-Path (Join-Path $build "manifest.json"))) {
    Step "Packing the cloud art from history"
    $art = Join-Path $work "art"
    New-Item -ItemType Directory -Force $art | Out-Null
    Push-Location $repo
    try { Run git @("archive", "6d941ae", "data/cloud-textures", "data/tornado-bake", "-o", (Join-Path $work "art.tar")) } finally { Pop-Location }
    Run tar @("-xf", (Join-Path $work "art.tar"), "-C", $art)
    Run python @("-I", (Join-Path $roblox "tools\pack-textures.py"), $art, $build)
}

Step "Packing the tornado sheets"
Run python @("-I", (Join-Path $repo "scripts\pack-tornado-strips.py"), $frameDir, $build)

if (-not $SkipUpload) {
    if (-not $env:DEVFLOW_OPENCLOUD_KEY -and -not (Test-Path (Join-Path $env:LOCALAPPDATA "devflow\opencloud-key.dat"))) {
        Step "No Open Cloud key stored yet"
        & (Join-Path $PSScriptRoot "set-opencloud-key.ps1")
    }
    Step "Uploading to Roblox"
    Run node @((Join-Path $PSScriptRoot "upload-images.mjs"), "upload", $build)
    Write-Host ""
    Write-Host "Done. Shared/Weather/Textures.luau has the new ids; Rojo syncs them into Studio. New images show once Roblox approves them." -ForegroundColor Green
}
