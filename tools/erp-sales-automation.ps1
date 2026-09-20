$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Node = "C:\Users\86137\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

if (-not (Test-Path -LiteralPath $Node)) {
  throw "未找到项目 Node.js 运行时：$Node"
}

Push-Location $ProjectRoot
try {
  & $Node --import tsx tools/erp-sales-automation.ts @args
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
finally {
  Pop-Location
}
