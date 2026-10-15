param([string]$OperatorPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'tools/django-postgres-maintenance.ps1'))
$ErrorActionPreference='Stop'
$env:TERUISI_DJANGO_MAINTENANCE_LIBRARY_ONLY='1'
. $OperatorPath -Action Status
$script:window=[pscustomobject]@{id=('e'*32);keepPostgres=$true;drainedStopped=$true;createdAt='2026-10-15T00:00:00Z'}
$script:proofStatus='verified'
$script:nativeCalls=0
$DeploymentManifestPath='installed/deployment.json'
$InstalledAppRoot='installed'
$Python='synthetic-python'
function Assert-MaintenanceOperationAdmission {}
function Read-SystemMaintenance {return $script:window}
function Get-FileSha256([string]$Path) {if($Path -ceq $DeploymentManifestPath){return ('a'*64)};return ('b'*64)}
function Invoke-BoundedNativeProcess { $script:nativeCalls++;return @{} }
function ConvertFrom-UniqueNativeJson {return [pscustomobject]@{status=$script:proofStatus;result=[pscustomobject]@{status=$script:proofStatus;predecessorSha256=('a'*64);migrationCount=142;maintenanceId=$script:window.id}}}
$MaintenanceRequest=[pscustomobject]@{Action='Backup';Execute=$true;RuntimeRoot='synthetic-runtime';PreparedToolAppId=('c'*32);PreparedToolAppSha256=('d'*64);AiScheduleEvidencePath='synthetic-evidence';AiScheduleEvidenceSha256=('f'*64);AiScheduleMaintenanceId=('e'*32);BackupDirectory='synthetic-archive';ApprovedManifestSha256=('a'*64)}
function Assert-Rejected([scriptblock]$Check) {
  $failed=$false;try { & $Check } catch {$failed=$true}
  if(-not $failed){throw 'Invalid prepared maintenance request was accepted'}
}
Assert-MaintenanceAiSchedulePreparedBackup 'synthetic-prepared'
if($script:nativeCalls -ne 1){throw 'Valid prepared backup admission was not checked'}
if(-not (Test-MaintenanceAiSchedulePreparedRetention)){throw 'Verified prepared Backup cannot use the original rotation'}
$MaintenanceRequest.Action='Verify'
if(Test-MaintenanceAiSchedulePreparedRetention){throw 'Prepared Verify gained retention'}
$MaintenanceRequest.Action='Backup'

foreach($change in @('owner','keepPostgres','stopped','execute','evidence','action','gate')) {
  $old=$MaintenanceRequest | ConvertTo-Json | ConvertFrom-Json
  $oldWindow=$script:window | ConvertTo-Json | ConvertFrom-Json
  try {
    switch($change){
      owner {$MaintenanceRequest.AiScheduleMaintenanceId='0'*32}
      keepPostgres {$script:window.keepPostgres=$false}
      stopped {$script:window.drainedStopped=$false}
      execute {$MaintenanceRequest.Execute=$false}
      evidence {$MaintenanceRequest.AiScheduleEvidenceSha256='invalid'}
      action {$MaintenanceRequest.Action='Unprotect'}
      gate {$script:proofStatus='blocked'}
    }
    Assert-Rejected {Assert-MaintenanceAiSchedulePreparedBackup 'synthetic-prepared'}
  } finally {$MaintenanceRequest=$old;$script:window=$oldWindow;$script:proofStatus='verified'}
}
$MaintenanceRequest.Action='Protect'
$script:archive=[pscustomobject]@{Manifest=[pscustomobject]@{createdAt='2026-10-15T00:01:00Z';preparedAiScheduleTools=$script:MaintenancePreparedAiScheduleTools}}
function Resolve-MaintenanceBackupArchive {param($Path,$Sha,[switch]$RequireCurrentDeployment) if(-not $RequireCurrentDeployment){throw 'Protect did not bind the installed predecessor'};return $script:archive}
Assert-MaintenanceAiSchedulePreparedBackup 'synthetic-prepared'
$script:archive.Manifest.preparedAiScheduleTools.preparedAppId='0'*32
Assert-Rejected {Assert-MaintenanceAiSchedulePreparedBackup 'synthetic-prepared'}
$script:archive.Manifest.preparedAiScheduleTools=$script:MaintenancePreparedAiScheduleTools
$script:archive.Manifest.createdAt='2026-10-14T00:00:00Z'
Assert-Rejected {Assert-MaintenanceAiSchedulePreparedBackup 'synthetic-prepared'}
@{status='passed';negativeChecks=9;productionTouched=$false} | ConvertTo-Json -Compress
