[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("alphaopen-production")]
  [string]$ConfirmProject
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$helper = Join-Path $PSScriptRoot "firebase-backup-admin.cjs"
$stamp = [DateTime]::UtcNow.ToString("yyyyMMddTHHmmssZ")
$stagingRoot = Join-Path ([System.IO.Path]::GetTempPath()) "alphaopen-backup-staging"
$authFile = Join-Path $stagingRoot "PROD-auth-$stamp.json"
$authObject = "auth/PROD-auth-$stamp.json"
$logDirectory = Join-Path $repoRoot "output\backup-logs"
$logFile = Join-Path $logDirectory "manual-backup-$stamp.json"

if ($ConfirmProject -ne "alphaopen-production") {
  throw "Refusing to back up an unexpected Firebase project."
}
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

New-Item -ItemType Directory -Force -Path $stagingRoot | Out-Null
New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null

try {
  Write-Host "Creating a manual Firestore export for alphaopen-production..."
  $firestoreJson = & node $helper export-firestore "--timestamp=$stamp"
  if ($LASTEXITCODE -ne 0) { throw "Firestore export failed." }
  $firestoreResult = $firestoreJson | ConvertFrom-Json

  Write-Host "Exporting Firebase Authentication accounts to restricted temporary storage..."
  & firebase.cmd auth:export $authFile --format=json --project alphaopen-production
  if ($LASTEXITCODE -ne 0) { throw "Authentication export failed." }

  Write-Host "Uploading and verifying the Authentication export..."
  $authJson = & node $helper upload-auth "--file=$authFile" "--object=$authObject"
  if ($LASTEXITCODE -ne 0) { throw "Authentication backup upload failed." }
  $authResult = $authJson | ConvertFrom-Json

  $record = [ordered]@{
    completedAt = [DateTime]::UtcNow.ToString("o")
    projectId = "alphaopen-production"
    firestore = $firestoreResult
    authentication = $authResult
  }
  $record | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $logFile -Encoding UTF8

  Write-Host "Backup completed and verified."
  Write-Host "Firestore: $($firestoreResult.outputUriPrefix)"
  Write-Host "Authentication: gs://alphaopen-prod-backups-2026/$authObject"
  Write-Host "Non-sensitive local log: $logFile"
}
finally {
  if (Test-Path -LiteralPath $authFile) {
    Remove-Item -LiteralPath $authFile -Force
    Write-Host "Removed the temporary local Authentication export."
  }
}
