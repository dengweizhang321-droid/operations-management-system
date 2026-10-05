[CmdletBinding()]
param([Parameter(Mandatory)][ValidateSet('Plan','Install','Finalize')][string]$Action,
 [Parameter(Mandatory)][string]$SourceRoot,[Parameter(Mandatory)][string]$OperationId,
 [Parameter(Mandatory)][string]$MaintenanceId,[string]$PreparedAppId='',
 [string]$PreparedAppSha256='', [string]$CandidateEvidencePath='', [string]$CandidateEvidenceSha256='',
 [string]$BackupDirectory='', [string]$BackupManifestSha256='', [string]$RestoreResultPath='', [string]$RestoreResultSha256='', [switch]$Execute)
$ErrorActionPreference='Stop'
$biRequest=@{Action=$Action;SourceRoot=$SourceRoot;OperationId=$OperationId;MaintenanceId=$MaintenanceId;PreparedAppId=$PreparedAppId;PreparedAppSha256=$PreparedAppSha256;CandidateEvidencePath=$CandidateEvidencePath;CandidateEvidenceSha256=$CandidateEvidenceSha256;BackupDirectory=$BackupDirectory;BackupManifestSha256=$BackupManifestSha256;RestoreResultPath=$RestoreResultPath;RestoreResultSha256=$RestoreResultSha256;Execute=$Execute.IsPresent}
if(-not $biRequest.Execute -or $biRequest.OperationId -cnotmatch '^[0-9a-f]{32}$' -or $biRequest.MaintenanceId -cnotmatch '^[0-9a-f]{32}$'){throw 'Explicit BI addition operation required'}
$biRuntime='D:\teruisi-runtime\django-sales'
$biPrior=[Environment]::GetEnvironmentVariable('TERUISI_DJANGO_SERVICE_LIBRARY_ONLY','Process')
try{$env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY='1';. (Join-Path $biRuntime 'app\tools\django-local-service.ps1') -Action Status -RuntimeRoot $biRuntime}
finally{[Environment]::SetEnvironmentVariable('TERUISI_DJANGO_SERVICE_LIBRARY_ONLY',$biPrior,'Process')}
Assert-DeployedApplication
Assert-RuntimeAclHardened
$biMaintenance=Read-JsonFile $MaintenancePath 'BI maintenance'
if($biMaintenance.id -cne $biRequest.MaintenanceId -or $biMaintenance.keepPostgres -ne $true){throw 'Exact KeepPostgres maintenance required'}
$biGate=Join-Path $biRequest.SourceRoot 'tools\bi_app_addition.py'
$biArgs=@($biGate,$biRequest.Action.ToLowerInvariant(),'--root',$biRequest.SourceRoot,'--runtime',$biRuntime,'--operation',$biRequest.OperationId,'--maintenance',$biRequest.MaintenanceId)
if($biRequest.Action -ceq 'Plan'){
 $biPrepared=Get-PreparedApplication $biRequest.PreparedAppId $biRequest.PreparedAppSha256
 $biArgs+=@('--candidate-sha',(Get-FileSha256 (Join-Path $biPrepared 'deployment.json')),'--evidence',$biRequest.CandidateEvidencePath,'--evidence-sha',$biRequest.CandidateEvidenceSha256)
}
if($biRequest.Action -cin @('Plan','Finalize')){
 $biArgs+=@('--backup',(Join-Path $biRequest.BackupDirectory 'backup-manifest.json'),'--backup-sha',$biRequest.BackupManifestSha256,'--restore',$biRequest.RestoreResultPath,'--restore-sha',$biRequest.RestoreResultSha256)
}
if($biRequest.Action -ceq 'Install'){
 $biSecrets=Read-Secrets
 $biUrl=Database-Url 'teruisi_sales_owner' $biSecrets.OwnerPassword 'teruisi_bi_goal_append' $WriterStatementTimeoutMs
 try{Invoke-WithDjangoEnvironment $biSecrets $biUrl 'migration_writer' $false $WriterMaxBodyBytes '' '' { $biRun=Invoke-BoundedNativeProcess $Python $biArgs $biRequest.SourceRoot; $biProof=ConvertFrom-UniqueNativeJson $biRun 'Install exactly finance ERP goals';$biProof | ConvertTo-Json -Depth 12 -Compress }}finally{$biSecrets=$null;$biUrl=$null}
}else{
 $biRun=Invoke-BoundedNativeProcess $Python $biArgs $biRequest.SourceRoot
 $biProof=ConvertFrom-UniqueNativeJson $biRun 'Bind BI append evidence'
 $biProof | ConvertTo-Json -Depth 12 -Compress
}
