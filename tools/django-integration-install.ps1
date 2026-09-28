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
  [switch]$Execute
)
$ErrorActionPreference = 'Stop'
$IntegrationRequest = [pscustomobject]@{
  Action=$Action; RuntimeRoot=$RuntimeRoot; SourceRoot=$SourceRoot; OperationId=$OperationId
  MaintenanceId=$MaintenanceId; PreparedAppId=$PreparedAppId; PreparedAppSha256=$PreparedAppSha256
  CandidateEvidencePath=$CandidateEvidencePath; CandidateEvidenceSha256=$CandidateEvidenceSha256
  BackupDirectory=$BackupDirectory; BackupManifestSha256=$BackupManifestSha256
  RestoreResultPath=$RestoreResultPath; RestoreResultSha256=$RestoreResultSha256; Execute=[bool]$Execute
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

$result = Invoke-WithServiceMutex {
  $maintenance = Assert-IntegrationStopped
  $operationRoot = Assert-RuntimeChildPath (Join-Path $RuntimeRoot ('integration-installs\' + $IntegrationRequest.OperationId))
  $evidenceRoot = Join-Path $operationRoot 'evidence'
  $snapshot = Join-Path $operationRoot 'source'
  $planPath = Assert-RuntimeChildPath (Join-Path $RuntimeRoot 'integration-install-plan.json')
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
    $gate = Join-Path $source 'tools\integration_release_gate.py'
    $candidateRun = Invoke-BoundedNativeProcess $Python @($gate,'candidate','--root',$source,
      '--evidence',$IntegrationRequest.CandidateEvidencePath,'--approved-sha256',$IntegrationRequest.CandidateEvidenceSha256) $source
    $candidate = ConvertFrom-UniqueNativeJson $candidateRun 'Verify integration source candidate'
    if ([string]$candidate.status -cne 'verified') { throw 'Candidate proof was not verified' }
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
    foreach ($property in $candidate.result.PSObject.Properties) { $plan[$property.Name]=$property.Value }
    Write-AtomicJson $planPath $plan
    $verifyPlan = Invoke-BoundedNativeProcess $Python @((Join-Path $snapshot 'tools\integration_release_gate.py'),
      'deployment','--root',$prepared,'--runtime',$RuntimeRoot) $snapshot
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
      $run = Invoke-BoundedNativeProcess $Python @((Join-Path $snapshot 'tools\integration_install.py'),
        $verb,'--runtime',$RuntimeRoot,'--execute') $snapshot
      ConvertFrom-UniqueNativeJson $run 'Run protected integration operation'
    }
  } finally {
    $env:TERUISI_INTEGRATION_ADMIN_PASSWORD=$previousAdmin
    $secrets=$null; $credentials=$null; $admin=$null; $ownerUrl=$null
  }
}
$result | ConvertTo-Json -Depth 12 -Compress
