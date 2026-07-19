param(
  [string]$Download,
  [string]$CostSource,
  [string]$AsOf
)

$ErrorActionPreference = "Stop"

if (-not $Download -or -not $CostSource -or -not $AsOf) {
  Write-Host 'Usage: sales-import.cmd "sales.xlsx" "current-inventory-cost-source.xlsx" YYYY-MM-DD'
  Write-Host "All three arguments are required; historical files are never guessed."
  exit 2
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$nodePath = if ($nodeCommand) { $nodeCommand.Source } else { $null }

if (-not $nodePath) {
  $runtimeRoot = Join-Path $env:USERPROFILE ".cache\codex-runtimes"
  $nodePath = Get-ChildItem -LiteralPath $runtimeRoot -Directory -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    ForEach-Object { Join-Path $_.FullName "dependencies\node\bin\node.exe" } |
    Where-Object { Test-Path -LiteralPath $_ } |
    Select-Object -First 1
}

if (-not $nodePath) {
  Write-Error "Node.js 22 was not found."
  exit 1
}

Push-Location $projectRoot
try {
  & $nodePath --import tsx (Join-Path $PSScriptRoot "sales-import-runner.ts") `
    --download $Download --cost-source $CostSource --as-of $AsOf
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
