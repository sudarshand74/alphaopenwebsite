[CmdletBinding()]
param(
  [ValidateRange(24, 168)]
  [int]$MaxAgeHours = 36
)

$ErrorActionPreference = "Stop"
$helper = Join-Path $PSScriptRoot "firebase-backup-admin.cjs"

if (-not (Get-Command firebase.cmd -ErrorAction SilentlyContinue)) {
  throw "firebase.cmd is required. Install Firebase CLI and run firebase login."
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js is required."
}

$globalNodeModules = (& npm.cmd root -g).Trim()
$env:FIREBASE_TOOLS_LIB = Join-Path $globalNodeModules "firebase-tools\lib"
if (-not (Test-Path -LiteralPath $env:FIREBASE_TOOLS_LIB)) {
  throw "The global Firebase CLI library could not be found."
}

& node $helper status "--max-age-hours=$MaxAgeHours"
exit $LASTEXITCODE
