param()

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$n8nEntry = Join-Path $env:APPDATA "npm\node_modules\n8n\bin\n8n"
$nodeCommand = (Get-Command node.exe -ErrorAction Stop).Source
$logDirectory = Join-Path $projectRoot ".runtime\n8n"
$stdoutLog = Join-Path $logDirectory "service.stdout.log"
$stderrLog = Join-Path $logDirectory "service.stderr.log"

if (-not (Test-Path -LiteralPath $n8nEntry -PathType Leaf)) {
  throw "The local n8n entry point is unavailable."
}

$existingListener = @(Get-NetTCPConnection -State Listen -LocalPort 5678 -ErrorAction SilentlyContinue)
if ($existingListener.Count -gt 0) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:5678/healthz" -TimeoutSec 5
    if ([int]$response.StatusCode -eq 200) {
      exit 0
    }
  } catch {
    throw "Port 5678 is occupied, but the n8n health endpoint is unavailable."
  }
  throw "Port 5678 is occupied by an unhealthy service."
}

New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
Set-Location -LiteralPath $projectRoot

& $nodeCommand $n8nEntry start 1>> $stdoutLog 2>> $stderrLog
exit $LASTEXITCODE
