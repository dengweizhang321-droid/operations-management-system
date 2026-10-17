[CmdletBinding()]
param(
  [ValidatePattern('^\d{4}-\d{2}-\d{2}$')][string]$AsOf = '2026-10-16',
  [string]$OutputDir = ''
)

$ErrorActionPreference = 'Stop'
$analysisRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (-not $OutputDir) {
  $OutputDir = Join-Path $analysisRoot 'outputs\jd-zhigao-promotion-diagnosis-20261017'
}
$analysisBranch = (& git -C $analysisRoot branch --show-current).Trim()
if (-not $analysisBranch.StartsWith('codex/') -or $analysisRoot -ieq 'D:\运营管理系统') {
  throw 'Analysis must run in an isolated codex/* worktree.'
}

function Read-ProtectedField([object]$Payload, [string]$Field) {
  $secure = ConvertTo-SecureString ([string]$Payload.$Field)
  return ([Management.Automation.PSCredential]::new('local', $secure)).GetNetworkCredential().Password
}

$saved = @{}
$names = @('TERUISI_NETSHOP_RO_DSN', 'TERUISI_BI_RO_DSN', 'PYTHONIOENCODING', 'PYTHONDONTWRITEBYTECODE')
foreach ($name in $names) { $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }

try {
  $netshopVault = Get-Content -LiteralPath 'D:\teruisi-runtime\django-sales\secrets\netshop-credentials.dpapi.json' -Raw | ConvertFrom-Json
  $biVault = Get-Content -LiteralPath 'D:\teruisi-runtime\django-sales\secrets\bi-credentials.dpapi.json' -Raw | ConvertFrom-Json
  $netshopPassword = Read-ProtectedField $netshopVault 'databaseNetshopReader'
  $biPassword = Read-ProtectedField $biVault 'databaseBiReader'
  $env:TERUISI_NETSHOP_RO_DSN = "postgresql://teruisi_netshop_reader:$([Uri]::EscapeDataString($netshopPassword))@127.0.0.1:5432/teruisi_sales?sslmode=disable&connect_timeout=5&application_name=jd_zhigao_promotion_diagnosis"
  $env:TERUISI_BI_RO_DSN = "postgresql://teruisi_bi_reader:$([Uri]::EscapeDataString($biPassword))@127.0.0.1:5432/teruisi_sales?sslmode=disable&connect_timeout=5&application_name=jd_zhigao_promotion_diagnosis"
  $env:PYTHONIOENCODING = 'utf-8'
  $env:PYTHONDONTWRITEBYTECODE = '1'
  & 'D:\teruisi-runtime\django-sales\venv\Scripts\python.exe' (Join-Path $analysisRoot 'tools\jd_zhigao_promotion_analysis.py') --as-of $AsOf --output-dir $OutputDir
  if ($LASTEXITCODE -ne 0) { throw 'Read-only promotion diagnosis failed.' }
} finally {
  foreach ($name in $names) {
    if ($null -eq $saved[$name]) { Remove-Item -LiteralPath ("Env:" + $name) -ErrorAction SilentlyContinue }
    else { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
  }
  $netshopPassword = $null
  $biPassword = $null
  $netshopVault = $null
  $biVault = $null
}
