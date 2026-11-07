# Exact PowerShell parameter binding and real prepared application copy, using
# a disposable Windows runtime with Pandas deliberately unconfigured.
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSEdition -eq 'Desktop') {
  $env:PSModulePath = Join-Path ([Environment]::SystemDirectory) 'WindowsPowerShell/v1.0/Modules'
}
$workspace = Split-Path -Parent $PSScriptRoot
$prefix = Join-Path ([IO.Path]::GetTempPath()) 'teruisi-w6r-'
$privateRuntime = $prefix + [Guid]::NewGuid().ToString('N')
$previous = $env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY
try {
  $env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY = '1'
  . (Join-Path $workspace 'tools/django-local-service.ps1') -RuntimeRoot $privateRuntime
  function Assert-ApplicationDeploymentStopped {
    if ((Get-CanonicalPath $RuntimeRoot) -cne (Get-CanonicalPath $privateRuntime)) { throw 'Fixture escaped its private runtime' }
  }
  & (Get-Command python.exe).Source -m venv --without-pip (Join-Path $privateRuntime 'venv')
  if ($LASTEXITCODE -ne 0) { throw 'Cannot provision isolated Python venv' }
  $first = Prepare-Application
  $PreparedAppId = $first.id; $PreparedAppSha256 = $first.receiptSha256
  Deploy-Application | Out-Null
  Set-RuntimeAcl
  $second = Prepare-Application
  $stage = Get-PreparedApplication $second.id $second.receiptSha256
  foreach ($name in @('pandas_broker_rotation.py','pandas_broker_rotation_linux.py','publish-main-pandas.mjs')) {
    if ((Get-FileSha256 (Join-Path $stage ('tools/' + $name))) -cne (Get-FileSha256 (Join-Path $workspace ('tools/' + $name)))) {
      throw 'Pandas controller copy closure differs from the reviewed source'
    }
  }
  $argsForAction = @{
    RuntimeRoot=$privateRuntime; PandasPreparedAppId=$second.id; PandasPreparedAppSha256=$second.receiptSha256
    PandasSourceCommit=('a' * 40); Json=$true
  }
  $ai = Join-Path $workspace 'tools/django-ai.ps1'
  $prepared = & $ai -Action PreparePandasRotation @argsForAction | ConvertFrom-Json
  $checked = & $ai -Action PandasRotationCheck @argsForAction | ConvertFrom-Json
  if ($prepared.prepared -cne $true -or $prepared.configured -cne $false -or $prepared.started -cne $false -or
      $checked.checked -cne $true -or $checked.configured -cne $false -or $prepared.sourceSha256 -cne $checked.sourceSha256 -or
      $prepared.sourceSha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'Unconfigured Pandas was not explicitly prepared and rechecked' }
  try {
    & $ai -Action PandasRotationCheck @argsForAction -PandasPlanSha256 ('b' * 64) | Out-Null
    throw 'Previously configured plan was treated as unconfigured'
  } catch {
    if ($_.Exception.Message -notmatch 'Previously configured Pandas was removed') { throw }
  }
  [ordered]@{prepared=$prepared; checked=$checked; closureVerified=$true; removedConfiguredPlanRejected=$true} | ConvertTo-Json -Depth 5 -Compress
} finally {
  $env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY = $previous
  $target = [IO.Path]::GetFullPath($privateRuntime)
  if (-not $target.StartsWith([IO.Path]::GetFullPath($prefix), [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe private fixture cleanup' }
  if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
}
