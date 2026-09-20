$ErrorActionPreference = "Stop"

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
  & $nodePath --import tsx (Join-Path $PSScriptRoot "jackyun-browser-controller.ts") @args
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
