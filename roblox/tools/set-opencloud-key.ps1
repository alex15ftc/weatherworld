# Stores this Windows user's Open Cloud API key exactly as roblox-devflow does (`devflow key
# set`): DPAPI-encrypted for this Windows user at %LOCALAPPDATA%\devflow\opencloud-key.dat, so
# devflow and tools/upload-images.mjs share it. The key is typed into its own window and never
# passes through arguments, output or logs.
#
# The key needs (Creator Hub > Open Cloud > API Keys):
#   assets: read, write          upload images (tools/upload-images.mjs)
#   legacy-asset: manage         devflow's place downloads, and looking up an upload's image id
$ErrorActionPreference = "Stop"
$dir = Join-Path $env:LOCALAPPDATA "devflow"
New-Item -ItemType Directory -Force $dir | Out-Null
$file = Join-Path $dir "opencloud-key.dat"
$pending = "$file.pending" # replaces the stored key only once a new one has been entered
Remove-Item -LiteralPath $pending -ErrorAction SilentlyContinue
$prompt = @"
`$host.UI.RawUI.WindowTitle = 'devflow: Open Cloud key'
Write-Host 'Paste your Open Cloud API key (assets: read+write, legacy-asset: manage). Input is hidden.'
Write-Host 'To paste, RIGHT-CLICK in this window (Ctrl+V may type a single character), then press Enter.'
while (`$true) {
    `$s = Read-Host 'Key' -AsSecureString
    if (`$s.Length -eq 0) { exit 1 }
    if (`$s.Length -ge 100) { break }
    Write-Host "That was `$(`$s.Length) characters; an Open Cloud key is several hundred. Try again (right-click to paste)."
}
Write-Host "Got `$(`$s.Length) characters."
ConvertFrom-SecureString `$s | Set-Content -LiteralPath '$($pending -replace "'", "''")'
exit 0
"@
$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($prompt))
Write-Host "A 'devflow: Open Cloud key' window is open; paste the key there and press Enter."
$p = Start-Process powershell.exe -Wait -PassThru -ArgumentList "-NoProfile -ExecutionPolicy Bypass -EncodedCommand $encoded"
if ($p.ExitCode -ne 0 -or -not (Test-Path $pending)) { throw "Key was not saved (window closed or nothing entered)" }
Move-Item -LiteralPath $pending -Destination $file -Force
Write-Host "Saved, encrypted for this Windows user only: $file"
