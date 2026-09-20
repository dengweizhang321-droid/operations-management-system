$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
$node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $node) { throw '未找到 Node.js' }
& $node --import tsx tools\jackyun-continue-helper.ts
