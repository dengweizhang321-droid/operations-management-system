$ErrorActionPreference = 'Stop'
$previous = $env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY
try {
  $env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY = '1'
  $workspace = Split-Path -Parent $PSScriptRoot
  $temporary = Join-Path ([IO.Path]::GetTempPath()) ('teruisi-ai-gate-' + [Guid]::NewGuid().ToString('N'))
  . (Join-Path $workspace 'tools/django-local-service.ps1') -RuntimeRoot $temporary

  Assert-NoUnapprovedProtectedAiMigration 'isolated preview'

  $RuntimeRoot = 'D:\teruisi-runtime\django-sales'
  $blocked = $false
  try { Assert-NoUnapprovedProtectedAiMigration 'PrepareApp' }
  catch {
    if ($_.Exception.Message -notmatch 'PrepareApp refuses protected AI migration release') { throw }
    $blocked = $true
  }
  if (-not $blocked) { throw 'Formal protected AI migration candidate was not blocked before preparation' }

  $blocked = $false
  try { Assert-NoUnapprovedProtectedAiMigration 'DeployApp' (Join-Path $workspace 'backend') }
  catch {
    if ($_.Exception.Message -notmatch 'DeployApp refuses protected AI migration release') { throw }
    $blocked = $true
  }
  if (-not $blocked) { throw 'Prepared protected AI migration candidate was not blocked before deployment' }
  'protected AI migration preflight: isolated allowed, formal blocked'
} finally {
  $env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY = $previous
}
