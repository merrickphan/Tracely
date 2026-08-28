# Tracely live preview — Windows launcher.
# Keeps the app + extension showing the latest changes the Discord bot makes.
# Run from the repo root:  ./scripts/live.ps1
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")
node scripts/live.mjs
