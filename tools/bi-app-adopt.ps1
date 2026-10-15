[CmdletBinding()]
param([Parameter(Mandatory)][ValidateSet('Plan','Install','Reconcile','Finalize')][string]$Action,
 [ValidateSet('BiErpGoal','JackyunAudit','AiSchedule','JdLogistics')][string]$AdditionKind='BiErpGoal',
 [Parameter(Mandatory)][string]$SourceRoot,[Parameter(Mandatory)][string]$OperationId,
 [Parameter(Mandatory)][string]$MaintenanceId,[string]$PreparedAppId='',
 [string]$PreparedAppSha256='', [string]$CandidateEvidencePath='', [string]$CandidateEvidenceSha256='',
 [string]$BackupDirectory='', [string]$BackupManifestSha256='', [string]$RestoreResultPath='', [string]$RestoreResultSha256='', [switch]$WithoutNewBackup, [switch]$SchemaOnly, [switch]$Execute)
$ErrorActionPreference='Stop'
$biRequest=@{Action=$Action;AdditionKind=$AdditionKind;SourceRoot=$SourceRoot;OperationId=$OperationId;MaintenanceId=$MaintenanceId;PreparedAppId=$PreparedAppId;PreparedAppSha256=$PreparedAppSha256;CandidateEvidencePath=$CandidateEvidencePath;CandidateEvidenceSha256=$CandidateEvidenceSha256;BackupDirectory=$BackupDirectory;BackupManifestSha256=$BackupManifestSha256;RestoreResultPath=$RestoreResultPath;RestoreResultSha256=$RestoreResultSha256;WithoutNewBackup=$WithoutNewBackup.IsPresent;SchemaOnly=$SchemaOnly.IsPresent;Execute=$Execute.IsPresent}
if(($biRequest.AdditionKind -ceq 'JdLogistics') -ne $biRequest.SchemaOnly -or ($biRequest.SchemaOnly -and ($biRequest.WithoutNewBackup -or $biRequest.BackupDirectory -or $biRequest.BackupManifestSha256 -or $biRequest.RestoreResultPath -or $biRequest.RestoreResultSha256))){throw 'JD requires explicit schema-only policy and cannot claim backup/restore evidence'}
if($biRequest.WithoutNewBackup -and ($biRequest.AdditionKind -cne 'JackyunAudit' -or $biRequest.BackupDirectory -or $biRequest.BackupManifestSha256 -or $biRequest.RestoreResultPath -or $biRequest.RestoreResultSha256)){throw 'Explicit no-new-backup direction is restricted to the audit addition and cannot claim recovery evidence'}
if($biRequest.Action -ceq 'Reconcile' -and $biRequest.AdditionKind -cnotin @('JackyunAudit','AiSchedule','JdLogistics')){throw 'Reconcile is restricted to the reviewed audit addition'}
if(-not $biRequest.Execute -or $biRequest.OperationId -cnotmatch '^[0-9a-f]{32}$' -or $biRequest.MaintenanceId -cnotmatch '^[0-9a-f]{32}$'){throw 'Explicit BI addition operation required'}
$biRuntime='D:\teruisi-runtime\django-sales'
$biPrior=[Environment]::GetEnvironmentVariable('TERUISI_DJANGO_SERVICE_LIBRARY_ONLY','Process')
try{$env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY='1';. (Join-Path $biRuntime 'app\tools\django-local-service.ps1') -Action Status -RuntimeRoot $biRuntime}
finally{[Environment]::SetEnvironmentVariable('TERUISI_DJANGO_SERVICE_LIBRARY_ONLY',$biPrior,'Process')}
# Reuse the source/package equivalence check from the original protected
# installer without invoking that installer's migration or role operations.
function Assert-BiPreparedSource([string]$Prepared,[string]$Source) {
 $preparedRoot=Get-CanonicalPath $Prepared
 $sourceBackend=Get-CanonicalPath (Join-Path $Source 'backend')
 $expected=[Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
 foreach($file in Get-ChildItem -LiteralPath $sourceBackend -File -Recurse -Force){
  $relative=$file.FullName.Substring($sourceBackend.Length+1)
  if($file.Extension -in @('.pyc','.pyo') -or @(($relative -split '[\\/]') | Where-Object {$_ -in @('.runtime','__pycache__','.pytest_cache','.mypy_cache','tests')}).Count){continue}
  [void]$expected.Add($relative)
 }
 $actual=[Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
 foreach($directory in @('backend','config','tools','drizzle')){
  foreach($file in Get-ChildItem -LiteralPath (Join-Path $preparedRoot $directory) -File -Recurse -Force){
   if($file.Extension -in @('.pyc','.pyo') -or $file.FullName -match '[\\/](__pycache__|\.pytest_cache|\.mypy_cache)[\\/]'){continue}
   $relative=$file.FullName.Substring($preparedRoot.Length+1)
   if($directory -ceq 'backend'){[void]$actual.Add($relative.Substring('backend\'.Length))}
   $original=Join-Path $Source $relative
   if(-not (Test-Path -LiteralPath $original -PathType Leaf) -or (Get-FileSha256 $file.FullName) -cne (Get-FileSha256 $original)){throw 'BI prepared application differs from committed source'}
  }
 }
 if(-not $expected.SetEquals($actual)){throw 'BI prepared backend inventory differs from committed source'}
}
Invoke-WithServiceMutex {
 Assert-DeployedApplication
 Assert-RuntimeAclHardened
 Assert-ProductionMaintenance 'BI addition'
 Assert-ApplicationDeploymentStopped 'BI addition'
 $biMaintenance=Read-SystemMaintenance
 if($biMaintenance.id -cne $biRequest.MaintenanceId -or -not (Test-MaintenanceKeepsPostgres $biMaintenance)){throw 'Exact KeepPostgres maintenance required'}
 $biSource=Get-CanonicalPath $biRequest.SourceRoot
 if(-not (Test-Path -LiteralPath (Join-Path $biSource '.git') -PathType Leaf)){throw 'BI source must be an isolated Git checkout'}
 $biGit=(Get-Command git -CommandType Application | Select-Object -First 1).Source
 $biStatus=Invoke-BoundedNativeProcess $biGit @('-C',$biSource,'status','--porcelain=v1') $biSource
 if($biStatus.ExitCode -ne 0 -or @($biStatus.Output).Count -ne 0){throw 'BI source must be committed and clean'}
 $biTree=Invoke-BoundedNativeProcess $biGit @('-C',$biSource,'ls-tree','-r','HEAD') $biSource
 if($biTree.ExitCode -ne 0 -or @($biTree.Output | Where-Object {[string]$_ -match '^(120000|160000) '}).Count){throw 'BI source must not contain symlinks or submodules'}
 $biRoot=$InstalledAppRoot
 if($biRequest.Action -ceq 'Plan'){
  $biPrepared=Get-PreparedApplication $biRequest.PreparedAppId $biRequest.PreparedAppSha256
  Assert-BiPreparedSource $biPrepared $biSource
  $biRoot=$biSource
 }else{Assert-BiPreparedSource $InstalledAppRoot $biSource}
 $biGateName=if($biRequest.AdditionKind -ceq 'JdLogistics'){'tools\jd_logistics_addition.py'}elseif($biRequest.AdditionKind -ceq 'AiSchedule'){'tools\ai_schedule_addition.py'}elseif($biRequest.AdditionKind -ceq 'JackyunAudit'){'tools\jackyun_audit_addition.py'}else{'tools\bi_app_addition.py'}
 $biGate=Join-Path $biRoot $biGateName
 $biArgs=@($biGate,$biRequest.Action.ToLowerInvariant(),'--root',$biRoot,'--runtime',$biRuntime,'--operation',$biRequest.OperationId,'--maintenance',$biRequest.MaintenanceId)
 if($biRequest.AdditionKind -cin @('JackyunAudit','AiSchedule','JdLogistics')){$biArgs+=@('--execute')}
 if($biRequest.WithoutNewBackup){$biArgs+=@('--without-new-backup')}
 if($biRequest.SchemaOnly){$biArgs+=@('--schema-only')}
 if($biRequest.Action -ceq 'Plan'){
  $biArgs+=@('--candidate-sha',(Get-FileSha256 (Join-Path $biPrepared 'deployment.json')),'--evidence',$biRequest.CandidateEvidencePath,'--evidence-sha',$biRequest.CandidateEvidenceSha256)
  if ($biRequest.AdditionKind -cin @('AiSchedule','JdLogistics')) {$biArgs+=@('--prepared-id',$biRequest.PreparedAppId,'--prepared-receipt-sha',$biRequest.PreparedAppSha256)}
 }
 if($biRequest.Action -cin @('Plan','Finalize') -and -not $biRequest.WithoutNewBackup -and -not $biRequest.SchemaOnly){
  $biVerifyTool=Join-Path $InstalledAppRoot 'tools\django-postgres-maintenance.ps1'
  $biVerifyArgs=@('-NoProfile','-NonInteractive','-File',$biVerifyTool,'-Action','Verify','-BackupDirectory',$biRequest.BackupDirectory,'-ApprovedManifestSha256',$biRequest.BackupManifestSha256)
  if ($biRequest.AdditionKind -ceq 'AiSchedule' -and $biRequest.Action -ceq 'Plan') {
    $biVerifyArgs[3]=Join-Path $biPrepared 'tools\django-postgres-maintenance.ps1'
    $biVerifyArgs+=@('-PreparedToolAppId',$biRequest.PreparedAppId,'-PreparedToolAppSha256',$biRequest.PreparedAppSha256)
  }
  $biVerified=Invoke-BoundedNativeProcess (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') $biVerifyArgs $InstalledAppRoot
  $biBackupProof=ConvertFrom-UniqueNativeJson $biVerified 'Verify exact BI backup archive'
  if([string]$biBackupProof.status -cne 'completed'){throw 'BI backup archive verification failed'}
  $biArgs+=@('--backup',(Join-Path $biRequest.BackupDirectory 'backup-manifest.json'),'--backup-sha',$biRequest.BackupManifestSha256,'--restore',$biRequest.RestoreResultPath,'--restore-sha',$biRequest.RestoreResultSha256)
 }
 if($biRequest.Action -cin @('Install','Reconcile') -or ($biRequest.Action -ceq 'Finalize' -and ($biRequest.WithoutNewBackup -or $biRequest.SchemaOnly))){
  $biSecrets=Read-Secrets
  $biApplicationName=if($biRequest.AdditionKind -ceq 'JdLogistics'){'teruisi_jd_schema_append'}elseif($biRequest.AdditionKind -ceq 'AiSchedule'){'teruisi_ai_schedule_append'}elseif($biRequest.AdditionKind -ceq 'JackyunAudit'){'teruisi_jackyun_audit_append'}else{'teruisi_bi_goal_append'}
  $biUrl=Database-Url 'teruisi_sales_owner' $biSecrets.OwnerPassword $biApplicationName $WriterStatementTimeoutMs
  try{Invoke-WithDjangoEnvironment $biSecrets $biUrl 'migration_writer' $false $WriterMaxBodyBytes '' '' { $biRun=Invoke-BoundedNativeProcess $Python $biArgs $biRoot; $biProof=ConvertFrom-UniqueNativeJson $biRun 'Verify exact finite migration result';$biProof | ConvertTo-Json -Depth 12 -Compress }}finally{$biSecrets=$null;$biUrl=$null}
 }else{
  $biRun=Invoke-BoundedNativeProcess $Python $biArgs $biRoot
  $biProof=ConvertFrom-UniqueNativeJson $biRun 'Bind BI append evidence'
  $biProof | ConvertTo-Json -Depth 12 -Compress
 }
}
