[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidateSet('Plan','Install','Finalize')][string]$Action,
  [string]$RuntimeRoot = 'D:\teruisi-runtime\django-sales',
  [string]$SourceRoot = '',
  [string]$OperationId = '',
  [string]$MaintenanceId = '',
  [string]$PreparedAppId = '',
  [string]$PreparedAppSha256 = '',
  [string]$CandidateEvidencePath = '',
  [string]$CandidateEvidenceSha256 = '',
  [string]$BackupDirectory = '',
  [string]$BackupManifestSha256 = '',
  [string]$RestoreResultPath = '',
  [string]$RestoreResultSha256 = '',
  [switch]$Execute,
  [ValidateSet('legacy138','netshop-presence139')][string]$Generation = 'legacy138'
)
$ErrorActionPreference = 'Stop'
$IntegrationRequest = [pscustomobject]@{
  Action=$Action; RuntimeRoot=$RuntimeRoot; SourceRoot=$SourceRoot; OperationId=$OperationId
  MaintenanceId=$MaintenanceId; PreparedAppId=$PreparedAppId; PreparedAppSha256=$PreparedAppSha256
  CandidateEvidencePath=$CandidateEvidencePath; CandidateEvidenceSha256=$CandidateEvidenceSha256
  BackupDirectory=$BackupDirectory; BackupManifestSha256=$BackupManifestSha256
  RestoreResultPath=$RestoreResultPath; RestoreResultSha256=$RestoreResultSha256; Execute=[bool]$Execute
  Generation=$Generation
}
if (-not $IntegrationRequest.Execute -or $IntegrationRequest.OperationId -cnotmatch '^[0-9a-f]{32}$' -or
    $IntegrationRequest.MaintenanceId -cnotmatch '^[0-9a-f]{32}$' -or
    [IO.Path]::GetFullPath($RuntimeRoot).TrimEnd('\') -ine 'D:\teruisi-runtime\django-sales') {
  throw 'Integration installation requires an explicit operation and fixed runtime'
}
$library = Join-Path $RuntimeRoot 'app\tools\django-local-service.ps1'
$oldLibraryFlag = $env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY
$env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY = '1'
try { . $library -Action Status -RuntimeRoot $RuntimeRoot }
finally { $env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY = $oldLibraryFlag }

function Copy-IntegrationProof([string]$Source, [string]$Digest, [string]$Target) {
  if ($Digest -cnotmatch '^[0-9a-f]{64}$' -or (Get-FileSha256 $Source) -cne $Digest -or
      (Test-Path -LiteralPath $Target)) { throw 'Integration proof is missing, changed or already recorded' }
  Copy-Item -LiteralPath $Source -Destination $Target
  if ((Get-FileSha256 $Target) -cne $Digest) { throw 'Integration proof copy differs' }
}

function Write-NewIntegrationPlan([string]$Path, [object]$Value) {
  $bytes = [Text.UTF8Encoding]::new($false).GetBytes(($Value | ConvertTo-Json -Depth 24 -Compress))
  $stream = [IO.File]::Open($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  try { $stream.Write($bytes,0,$bytes.Length); $stream.Flush($true) }
  finally { $stream.Dispose() }
}

function Assert-IntegrationStopped {
  Assert-DeployedApplication
  Assert-RuntimeAclHardened
  Assert-ProductionMaintenance 'Integration installation'
  Assert-ApplicationProcessesStopped 'Integration installation'
  Assert-PostgresListenerOwnership | Out-Null
  $maintenance = Read-SystemMaintenance
  if ($null -eq $maintenance -or $maintenance.id -cne $IntegrationRequest.MaintenanceId -or
      -not (Test-MaintenanceKeepsPostgres $maintenance)) { throw 'Integration maintenance ownership changed' }
  return $maintenance
}

function Assert-IntegrationPreparedSource([string]$Prepared, [string]$Source) {
  $preparedRoot = [IO.Path]::GetFullPath($Prepared).TrimEnd('\')
  $expectedBackend = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  $sourceBackend = [IO.Path]::GetFullPath((Join-Path $Source 'backend')).TrimEnd('\')
  foreach ($file in Get-ChildItem -LiteralPath $sourceBackend -File -Recurse -Force) {
    $relative = $file.FullName.Substring($sourceBackend.Length + 1)
    $segments = $relative -split '[\\/]'
    if ($file.Extension -in @('.pyc','.pyo') -or
        @($segments | Where-Object { $_ -in @('.runtime','__pycache__','.pytest_cache','.mypy_cache','tests') }).Count) { continue }
    [void]$expectedBackend.Add($relative)
  }
  $actualBackend = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  foreach ($directory in @('backend','config','tools','drizzle')) {
    foreach ($file in Get-ChildItem -LiteralPath (Join-Path $preparedRoot $directory) -File -Recurse -Force) {
      if ($file.Extension -in @('.pyc','.pyo') -or $file.FullName -match '[\\/](__pycache__|\.pytest_cache|\.mypy_cache)[\\/]') { continue }
      $relative = $file.FullName.Substring($preparedRoot.Length + 1)
      if ($directory -ceq 'backend') { [void]$actualBackend.Add($relative.Substring('backend\'.Length)) }
      $original = Join-Path $Source $relative
      if (-not (Test-Path -LiteralPath $original -PathType Leaf) -or
          (Get-FileSha256 $file.FullName) -cne (Get-FileSha256 $original)) {
        throw 'Prepared integration application differs from the reviewed source'
      }
    }
  }
  if (-not $expectedBackend.SetEquals($actualBackend)) { throw 'Prepared integration backend inventory differs from the reviewed source' }
}

$result = Invoke-WithServiceMutex {
  $maintenance = Assert-IntegrationStopped
  $isDelta = $IntegrationRequest.Generation -ceq 'netshop-presence139'
  $operationFamily = if ($isDelta) { 'integration-deltas' } else { 'integration-installs' }
  $operationRoot = Assert-RuntimeChildPath (Join-Path $RuntimeRoot ($operationFamily + '\' + $IntegrationRequest.OperationId))
  $evidenceRoot = Join-Path $operationRoot 'evidence'
  $snapshot = Join-Path $operationRoot 'source'
  $planPath = if ($isDelta) { Assert-RuntimeChildPath (Join-Path $operationRoot 'plan.json') } else { Assert-RuntimeChildPath (Join-Path $RuntimeRoot 'integration-install-plan.json') }
  if ($IntegrationRequest.Action -ceq 'Plan') {
    if ((Test-Path -LiteralPath $operationRoot) -or (Test-Path -LiteralPath $planPath)) {
      throw 'An integration operation already exists; audit it instead of overwriting'
    }
    $source = Get-CanonicalPath $IntegrationRequest.SourceRoot
    if (-not (Test-Path -LiteralPath (Join-Path $source '.git') -PathType Leaf)) {
      throw 'Integration source must be an isolated Git checkout'
    }
    $git = (Get-Command git -CommandType Application).Source
    $status = Invoke-BoundedNativeProcess $git @('-C',$source,'status','--porcelain=v1') $source
    if ($status.ExitCode -ne 0 -or @($status.Output).Count -ne 0) { throw 'Integration source must be committed and clean' }
    $tree = Invoke-BoundedNativeProcess $git @('-C',$source,'ls-tree','-r','HEAD') $source
    if ($tree.ExitCode -ne 0 -or @($tree.Output | Where-Object { [string]$_ -match '^(120000|160000) ' }).Count -gt 0) {
      throw 'Integration source must not contain symlinks or submodules'
    }
    $prepared = Get-PreparedApplication $IntegrationRequest.PreparedAppId $IntegrationRequest.PreparedAppSha256
    Assert-IntegrationPreparedSource $prepared $source
    $gate = Join-Path $source 'tools\integration_release_gate.py'
    $candidateRun = Invoke-BoundedNativeProcess $Python @($gate,'candidate','--root',$source,
      '--evidence',$IntegrationRequest.CandidateEvidencePath,'--approved-sha256',$IntegrationRequest.CandidateEvidenceSha256) $source
    $candidate = ConvertFrom-UniqueNativeJson $candidateRun 'Verify integration source candidate'
    if ([string]$candidate.status -cne 'verified') { throw 'Candidate proof was not verified' }
    $candidateDelta = [string]$candidate.result.generation -ceq 'teruisi-integration-migration-plan-v4-netshop-presence'
    if ($candidateDelta -cne $isDelta) { throw 'Explicit integration generation differs from reviewed evidence' }
    if ($isDelta -and (Test-Path -LiteralPath (Join-Path $RuntimeRoot 'integration-active-generation.json'))) {
      throw 'An adopted delta already exists; never overwrite its active reference'
    }
    # The existing installed operator validates archive bytes before any plan.
    $maintenanceOperator = Join-Path $InstalledAppRoot 'tools\django-postgres-maintenance.ps1'
    $verifyRun = Invoke-BoundedNativeProcess (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') @(
      '-NoProfile','-NonInteractive','-File',$maintenanceOperator,'-Action','Verify',
      '-BackupDirectory',$IntegrationRequest.BackupDirectory,'-ApprovedManifestSha256',$IntegrationRequest.BackupManifestSha256) $InstalledAppRoot
    $verified = ConvertFrom-UniqueNativeJson $verifyRun 'Verify integration pre-backup'
    if ([string]$verified.status -cne 'completed') { throw 'Integration pre-backup was not verified' }
    New-Item -ItemType Directory -Path $evidenceRoot -Force | Out-Null
    Copy-IntegrationProof $IntegrationRequest.CandidateEvidencePath $IntegrationRequest.CandidateEvidenceSha256 (Join-Path $evidenceRoot 'candidate.json')
    Copy-IntegrationProof (Join-Path $IntegrationRequest.BackupDirectory 'backup-manifest.json') $IntegrationRequest.BackupManifestSha256 (Join-Path $evidenceRoot 'before-backup.json')
    Copy-IntegrationProof $IntegrationRequest.RestoreResultPath $IntegrationRequest.RestoreResultSha256 (Join-Path $evidenceRoot 'before-restore.json')
    $backup = Read-JsonFile (Join-Path $evidenceRoot 'before-backup.json') 'Integration pre-backup'
    $predecessor = Get-InstalledApplicationBinding
    if ($backup.software.deploymentManifestSha256 -cne $predecessor -or
        [DateTimeOffset]::Parse($backup.createdAt) -lt [DateTimeOffset]::Parse($maintenance.createdAt)) {
      throw 'Integration requires a backup of this predecessor within this maintenance window'
    }
    $archive = Join-Path $operationRoot 'source.zip'
    $archiveRun = Invoke-BoundedNativeProcess $git @('-C',$source,'archive','--format=zip','--output',$archive,'HEAD') $source
    if ($archiveRun.ExitCode -ne 0) { throw 'Immutable integration source archive failed' }
    Expand-Archive -LiteralPath $archive -DestinationPath $snapshot
    Assert-RuntimeAclHardened
    $plan = [ordered]@{
      version='teruisi-integration-release-v1'; status='prepared'; operationId=$IntegrationRequest.OperationId
      maintenanceId=$IntegrationRequest.MaintenanceId; maintenanceSha256=Get-FileSha256 $MaintenancePath
      predecessorSha256=$predecessor; candidateManifestSha256=Get-FileSha256 (Join-Path $prepared 'deployment.json')
      beforeBackupSha256=$IntegrationRequest.BackupManifestSha256; beforeRestoreSha256=$IntegrationRequest.RestoreResultSha256
      preparedAppId=$IntegrationRequest.PreparedAppId; preparedAppSha256=$IntegrationRequest.PreparedAppSha256
    }
    if ($isDelta) { $plan.version='teruisi-netshop-presence-release-v1' }
    foreach ($property in $candidate.result.PSObject.Properties) { $plan[$property.Name]=$property.Value }
    if ($isDelta) {
      $witnessRun = Invoke-BoundedNativeProcess $Python @($gate, 'delta-witness', '--root', $source,
        '--runtime', $RuntimeRoot, '--evidence', $IntegrationRequest.CandidateEvidencePath,
        '--approved-sha256', $IntegrationRequest.CandidateEvidenceSha256,
        '--backup-manifest', (Join-Path $evidenceRoot 'before-backup.json'), '--backup-sha256', $IntegrationRequest.BackupManifestSha256,
        '--restore-result', (Join-Path $evidenceRoot 'before-restore.json'), '--restore-sha256', $IntegrationRequest.RestoreResultSha256) $source
      $witness = ConvertFrom-UniqueNativeJson $witnessRun 'Bind actual delta baseline witness'
      if ([string]$witness.status -cne 'verified') { throw 'Actual delta baseline witness refused' }
      $plan.operationWitness=$witness.result.operationWitness
      $plan.operationWitnessSha256=$witness.result.operationWitnessSha256
    }
    if ($isDelta) { Write-NewIntegrationPlan $planPath $plan } else { Write-AtomicJson $planPath $plan }
    $verifyArguments = @((Join-Path $snapshot 'tools\integration_release_gate.py'), 'deployment','--root',$prepared,'--runtime',$RuntimeRoot)
    if ($isDelta) { $verifyArguments += @('--operation-id',$IntegrationRequest.OperationId) }
    $verifyPlan = Invoke-BoundedNativeProcess $Python $verifyArguments $snapshot
    $checked = ConvertFrom-UniqueNativeJson $verifyPlan 'Verify integration deployment plan'
    if ([string]$checked.status -cne 'verified') { throw 'Integration plan did not verify' }
    return [pscustomobject]@{status='prepared'; operationId=$IntegrationRequest.OperationId; planSha256=Get-FileSha256 $planPath}
  }
  $plan = Read-JsonFile $planPath 'Integration installation plan'
  if ($plan.operationId -cne $IntegrationRequest.OperationId -or $plan.maintenanceId -cne $IntegrationRequest.MaintenanceId) {
    throw 'Integration operation ownership changed'
  }
  if ($IntegrationRequest.Action -ceq 'Finalize') {
    $verifyRun = Invoke-BoundedNativeProcess (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') @(
      '-NoProfile','-NonInteractive','-File',(Join-Path $InstalledAppRoot 'tools\django-postgres-maintenance.ps1'),
      '-Action','Verify','-BackupDirectory',$IntegrationRequest.BackupDirectory,
      '-ApprovedManifestSha256',$IntegrationRequest.BackupManifestSha256) $InstalledAppRoot
    $verified = ConvertFrom-UniqueNativeJson $verifyRun 'Verify integration post-backup'
    if ([string]$verified.status -cne 'completed') { throw 'Integration post-backup was not verified' }
    Copy-IntegrationProof (Join-Path $IntegrationRequest.BackupDirectory 'backup-manifest.json') $IntegrationRequest.BackupManifestSha256 (Join-Path $evidenceRoot 'after-backup.json')
    Copy-IntegrationProof $IntegrationRequest.RestoreResultPath $IntegrationRequest.RestoreResultSha256 (Join-Path $evidenceRoot 'after-restore.json')
  }
  $secrets = Read-Secrets
  $credentials = Read-JsonFile $CredentialPath 'Existing protected PostgreSQL credentials'
  $admin = Unprotect-Value ([string]$credentials.postgresSuperuser) 'postgresSuperuser'
  $previousAdmin = $env:TERUISI_INTEGRATION_ADMIN_PASSWORD
  try {
    $env:TERUISI_INTEGRATION_ADMIN_PASSWORD=$admin
    $ownerUrl = Database-Url 'teruisi_sales_owner' $secrets.OwnerPassword 'teruisi_integration_migrate' 900000 'teruisi_sales'
    $verb = if ($IntegrationRequest.Action -ceq 'Install') { 'install' } else { 'finalize' }
    Invoke-WithDjangoEnvironment $secrets $ownerUrl 'migration_writer' $false $WriterMaxBodyBytes '' '' {
      $installArguments = @((Join-Path $snapshot 'tools\integration_install.py'), $verb,'--runtime',$RuntimeRoot,'--execute')
      if ($isDelta) { $installArguments += @('--operation-id',$IntegrationRequest.OperationId) }
      $run = Invoke-BoundedNativeProcess $Python $installArguments $snapshot
      ConvertFrom-UniqueNativeJson $run 'Run protected integration operation'
    }
  } finally {
    $env:TERUISI_INTEGRATION_ADMIN_PASSWORD=$previousAdmin
    $secrets=$null; $credentials=$null; $admin=$null; $ownerUrl=$null
  }
}
$result | ConvertTo-Json -Depth 12 -Compress
