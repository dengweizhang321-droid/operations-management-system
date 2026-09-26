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

  # Prove 0073 alone is sufficient: the ordinary formal path must not rely
  # on finding its 0067-0072 predecessors in the staged source tree.
  $candidateRoot = Join-Path $temporary 'candidate'
  $candidateBackend = Join-Path $candidateRoot 'backend'
  $candidateMigrations = Join-Path $candidateBackend 'ai_assistant\migrations'
  New-Item -ItemType Directory -Path $candidateMigrations -Force | Out-Null
  [IO.File]::WriteAllText((Join-Path $candidateMigrations '0073_business_promotion_budget_v11_login_attestation.py'), '# isolated test only')
  $blocked = $false
  try { Assert-NoUnapprovedProtectedAiMigration '0073-only' $candidateBackend }
  catch {
    if ($_.Exception.Message -notmatch '0073-only refuses protected AI migration release') { throw }
    $blocked = $true
  }
  if (-not $blocked) { throw 'Formal 0073-only source was not blocked before staging' }
  'protected AI migration preflight: isolated allowed, formal blocked'
} finally {
  if ($candidateRoot -and (Test-Path -LiteralPath $candidateRoot)) {
    $resolvedCandidate = [IO.Path]::GetFullPath($candidateRoot).TrimEnd('\')
    $resolvedTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $resolvedCandidate.StartsWith($resolvedTemp, [StringComparison]::OrdinalIgnoreCase)) {
      throw 'Temporary 0073 test path escaped the intended temp directory'
    }
    Remove-Item -LiteralPath $resolvedCandidate -Recurse -Force
  }
  $env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY = $previous
}
