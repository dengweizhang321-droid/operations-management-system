Set-StrictMode -Version 2

function Get-ExactRecoveryPaths {
  $out='D:\codex-artifacts\ai-schedules-production-20261015'
  $runtime='D:\teruisi-runtime\django-sales'
  return [pscustomobject]@{
    Out=$out; Recovery=(Join-Path $out 'recovery'); Runtime=$runtime
    Request=(Join-Path $out 'afterbackup-settlement-request.json')
    Rotation=(Join-Path $out 'afterbackup-settlement-rotation.json')
    Observation=(Join-Path $out 'recovery-observation.json')
    Audit=(Join-Path $runtime 'audits\postgres-operations\d4ae1a82639343b8a5e2347694ebe0f4.json')
    Retention='D:\teruisi-runtime\teruisi-worker-sales\audit\release-retention\b7134d1ee0e14f418bc08b5ffda3a3c5.jsonl'
    Unknown=(Join-Path $out 'AfterBackup-unknown.json')
    OriginalReview=(Join-Path $out 'original-afterbackup-exit-review.json')
    Service=(Join-Path $runtime 'app\tools\django-local-service.ps1')
    Operator=(Join-Path $runtime 'app\tools\django-postgres-maintenance.ps1')
    Continuity=(Join-Path $runtime 'app\tools\postgres-backup-continuity.ps1')
    Driver=(Join-Path $out 'continue.mjs')
    Adapter=(Join-Path $out 'recovery\reconcile-afterbackup-audit.ps1')
    Module=(Join-Path $out 'recovery\exact-afterbackup-settlement.psm1')
    Intent=(Join-Path $out 'recovery\settlement-intent.json')
    Receipt=(Join-Path $out 'recovery\settlement-receipt.json')
  }
}

function Stop-ExactRecovery([string]$Code) { throw [InvalidOperationException]::new($Code) }
function Test-RecoveryHex([object]$Value) { return $Value -is [string] -and $Value -cmatch '^[a-f0-9]{64}$' }
function Assert-RecoveryObject([object]$Value) {
  if ($null -eq $Value -or $Value -isnot [pscustomobject]) { Stop-ExactRecovery 'json_object_required' }
}
function Assert-RecoveryKeys([object]$Value,[string[]]$Keys) {
  Assert-RecoveryObject $Value
  $actual=@($Value.PSObject.Properties.Name | Sort-Object);$wanted=@($Keys | Sort-Object)
  if ($actual.Count -ne $wanted.Count) { Stop-ExactRecovery 'json_keys_differ' }
  for($i=0;$i -lt $actual.Count;$i++){if($actual[$i] -cne $wanted[$i]){Stop-ExactRecovery 'json_keys_differ'}}
}
function Get-RecoveryPath([string]$Path) { return [IO.Path]::GetFullPath($Path).TrimEnd('\','/') }
function Assert-RecoveryRegularPath([string]$Path) {
  $entry=Get-RecoveryPath $Path
  while($entry){
    if(Test-Path -LiteralPath $entry){
      $item=Get-Item -LiteralPath $entry -Force
      if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){Stop-ExactRecovery 'linked_evidence_path'}
    }
    $entry=Split-Path -Parent $entry
  }
  if(-not(Test-Path -LiteralPath $Path -PathType Leaf)){Stop-ExactRecovery 'evidence_file_missing'}
}
function Read-RecoveryBytes([string]$Path,[long]$Maximum=33554432) {
  Assert-RecoveryRegularPath $Path
  $stream=[IO.FileStream]::new($Path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
  try{
    if($stream.Length -gt $Maximum){Stop-ExactRecovery 'evidence_size_exceeded'}
    $bytes=[byte[]]::new([int]$stream.Length);$offset=0
    while($offset -lt $bytes.Length){$read=$stream.Read($bytes,$offset,$bytes.Length-$offset);if($read -le 0){Stop-ExactRecovery 'evidence_short_read'};$offset+=$read}
    return ,$bytes
  }finally{$stream.Dispose()}
}
function Get-RecoveryBytesSha([byte[]]$Bytes) {
  $sha=[Security.Cryptography.SHA256]::Create()
  try{return [BitConverter]::ToString($sha.ComputeHash($Bytes)).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
}
function Get-RecoveryFileSha([string]$Path) {
  Assert-RecoveryRegularPath $Path
  $stream=[IO.FileStream]::new($Path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
  $sha=[Security.Cryptography.SHA256]::Create()
  try{return [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose();$stream.Dispose()}
}
function Read-RecoveryJson([string]$Path,[string]$ExpectedSha='') {
  $bytes=Read-RecoveryBytes $Path
  if($ExpectedSha -and (-not(Test-RecoveryHex $ExpectedSha) -or (Get-RecoveryBytesSha $bytes) -cne $ExpectedSha)){Stop-ExactRecovery 'evidence_sha_drift'}
  $raw=[Text.UTF8Encoding]::new($false,$true).GetString($bytes).TrimStart([char]0xfeff).Trim()
  if(-not $raw.StartsWith('{') -or -not $raw.EndsWith('}')){Stop-ExactRecovery 'json_object_required'}
  $value=ConvertFrom-Json -InputObject $raw
  Assert-RecoveryObject $value
  return $value
}
function ConvertTo-RecoveryCanonical([object]$Value,[int]$Depth=0) {
  if($Depth -gt 64){Stop-ExactRecovery 'canonical_depth_exceeded'}
  if($null -eq $Value){return 'null'}
  if($Value -is [string]){return ConvertTo-Json -InputObject $Value -Compress}
  if($Value -is [bool]){if($Value){return 'true'};return 'false'}
  if($Value -is [ValueType]){
    if($Value -is [DateTime] -or $Value -is [DateTimeOffset]){Stop-ExactRecovery 'implicit_date_conversion_refused'}
    $number=[Convert]::ToString($Value,[Globalization.CultureInfo]::InvariantCulture)
    if($number -cnotmatch '^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$'){Stop-ExactRecovery 'canonical_number_invalid'}
    return $number
  }
  if($Value -is [Collections.IDictionary] -or $Value -is [pscustomobject]){
    $keys=if($Value -is [Collections.IDictionary]){@($Value.Keys)}else{@($Value.PSObject.Properties.Name)}
    [Array]::Sort($keys,[StringComparer]::Ordinal)
    $pairs=@(foreach($key in $keys){$child=if($Value -is [Collections.IDictionary]){$Value[$key]}else{$Value.$key};(ConvertTo-Json -InputObject ([string]$key) -Compress)+':'+(ConvertTo-RecoveryCanonical $child ($Depth+1))})
    return '{'+($pairs -join ',')+'}'
  }
  if($Value -is [Collections.IEnumerable]){return '['+(@(foreach($item in $Value){ConvertTo-RecoveryCanonical $item ($Depth+1)}) -join ',')+']'}
  Stop-ExactRecovery 'canonical_type_invalid'
}
function Write-RecoveryCreateOnly([string]$Path,[byte[]]$Bytes) {
  $root=(Get-RecoveryPath (Get-ExactRecoveryPaths).Recovery)+'\'
  if(-not (Get-RecoveryPath $Path).StartsWith($root,[StringComparison]::OrdinalIgnoreCase)){Stop-ExactRecovery 'recovery_output_outside_scope'}
  if(Test-Path -LiteralPath $Path){if((Get-RecoveryFileSha $Path) -cne (Get-RecoveryBytesSha $Bytes)){Stop-ExactRecovery 'create_only_output_differs'};return}
  $parent=Split-Path -Parent $Path
  if(-not(Test-Path -LiteralPath $parent -PathType Container)){Stop-ExactRecovery 'recovery_directory_missing'}
  $stream=[IO.FileStream]::new($Path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
  try{$stream.Write($Bytes,0,$Bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}
}
function Write-RecoveryJson([string]$Path,[object]$Value) {
  Write-RecoveryCreateOnly $Path ([Text.UTF8Encoding]::new($false).GetBytes((ConvertTo-Json -InputObject $Value -Depth 32 -Compress)))
}
function Get-RecoveryActorSid {
  $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
  if(([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){Stop-ExactRecovery 'ordinary_identity_required'}
  return $identity.User.Value
}
function Get-RecoveryProcessInventory { return @(Get-CimInstance Win32_Process -ErrorAction Stop) }
function Get-RecoveryRotationServerPid {
  if(-not('ExactRecovery.PipeOwner' -as [type])){
    $paths=Get-ExactRecoveryPaths;$temp=Join-Path $paths.Recovery 'native-temp'
    if(-not(Test-Path -LiteralPath $temp)){[void][IO.Directory]::CreateDirectory($temp)}
    $oldTemp=$env:TEMP;$oldTmp=$env:TMP
    try{
      $env:TEMP=$temp;$env:TMP=$temp
      Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;using Microsoft.Win32.SafeHandles;namespace ExactRecovery{public static class PipeOwner{[DllImport("kernel32.dll",SetLastError=true)]public static extern bool GetNamedPipeServerProcessId(SafePipeHandle pipe,out uint pid);}}'
    }finally{$env:TEMP=$oldTemp;$env:TMP=$oldTmp}
  }
  $pipe=[IO.Pipes.NamedPipeClientStream]::new('.','TERUISI.Worker.ReleaseRotation.v1',[IO.Pipes.PipeDirection]::InOut)
  try{$pipe.Connect(1000);[uint32]$owner=0;if(-not [ExactRecovery.PipeOwner]::GetNamedPipeServerProcessId($pipe.SafePipeHandle,[ref]$owner)){Stop-ExactRecovery 'rotation_owner_unavailable'};return [int]$owner}finally{$pipe.Dispose()}
}
function Assert-RecoveryRotation([object]$Witness,[object]$Request) {
  Assert-RecoveryKeys $Witness @('version','ownerPid','ownerCreatedAt','driverSha256','actorSid','createdAt')
  if($Witness.version -cne 'ai-schedule-afterbackup-rotation-witness-v1' -or $Witness.ownerPid -isnot [int] -or
     $Witness.ownerPid -le 0 -or $Witness.actorSid -cne $Request.actorSid -or $Witness.driverSha256 -cne $Request.continuationDriverSha256){Stop-ExactRecovery 'rotation_witness_invalid'}
  $age=([DateTimeOffset]::UtcNow-[DateTimeOffset]::Parse($Witness.createdAt)).TotalSeconds
  if($age -lt -30 -or $age -gt 900){Stop-ExactRecovery 'rotation_witness_expired'}
  if((Get-RecoveryRotationServerPid) -ne $Witness.ownerPid){Stop-ExactRecovery 'rotation_owner_mismatch'}
  $current=@(Get-RecoveryProcessInventory | Where-Object {$_.ProcessId -eq $Witness.ownerPid})
  if($current.Count -ne 1 -or $null -eq $current[0].CreationDate -or
     ([DateTimeOffset]$current[0].CreationDate).UtcDateTime.Ticks -ne ([DateTimeOffset]::Parse($Witness.ownerCreatedAt)).UtcDateTime.Ticks -or
     [string]::IsNullOrWhiteSpace([string]$current[0].CommandLine) -or
     ([string]$current[0].CommandLine).Replace('/','\') -notlike ('*'+(Get-ExactRecoveryPaths).Driver.Replace('/','\')+'*')){Stop-ExactRecovery 'rotation_process_identity_drift'}
}
function Assert-RecoveryAudit([object]$Audit) {
  Assert-RecoveryKeys $Audit @('version','id','action','startedAt','updatedAt','status','phase','capacity','databaseBackup','result','failure')
  if($Audit.version -cne 'teruisi-postgres-operation-v1' -or $Audit.id -cne 'd4ae1a82639343b8a5e2347694ebe0f4' -or
     $Audit.action -cne 'Backup' -or $Audit.phase -cne 'release_retention' -or $Audit.status -cne 'running' -or
     $null -ne $Audit.result -or $null -ne $Audit.failure -or $Audit.capacity -isnot [array]){Stop-ExactRecovery 'original_audit_contract_drift'}
  $db=$Audit.databaseBackup
  if($null -eq $db -or $db.status -cne 'completed' -or $db.backupId -cne 'daily-20261015T041546Z-e45dddeb5a15' -or
     $db.manifestSha256 -cne 'd027dc04cfeb3cde06801b7f200ba355fb5afae84da311ca5fe295e2284fa34d' -or
     $db.dumpSha256 -cne 'aaffc32f3614663bcc5425b870758d5f166304c2bc247dd1503ba74458ad49ae' -or
     $db.contentSha256 -cne '85caeeb71f60fd9a41241f18f75c32542eefec9b3a0740dc61a7856ffcdc40ed' -or
     $db.retention.status -cne 'completed'){Stop-ExactRecovery 'database_child_contract_drift'}
}

function Assert-RecoveryReadableScope([string]$Path) {
  $target=Get-RecoveryPath $Path;$paths=Get-ExactRecoveryPaths
  $roots=@($paths.Out,$paths.Runtime,'D:\teruisi-runtime\teruisi-worker-sales','D:\运营管理系统')
  foreach($root in $roots){if($target.StartsWith((Get-RecoveryPath $root)+'\',[StringComparison]::OrdinalIgnoreCase)){return}}
  if($target -match '^E:\\[^\\]+\\daily-(20261015T041546Z-e45dddeb5a15|20261015T035103Z-ae624be091e0|20260929T012900Z-ad2817875f20)\\backup-manifest\.json(\.sha256)?$'){return}
  Stop-ExactRecovery 'witness_path_outside_fixed_scope'
}
function Assert-RecoveryWitnessFile([object]$File) {
  Assert-RecoveryReadableScope $File.path
  if(-not(Test-RecoveryHex $File.sha256) -or (Get-RecoveryFileSha $File.path) -cne $File.sha256){Stop-ExactRecovery 'witness_file_drift'}
}
function Assert-RecoveryProcesses([object]$Observation) {
  $expected=@(47368,9024,36384)
  if(@($Observation.processes).Count -ne 3 -or @($Observation.processSamples).Count -ne 2){Stop-ExactRecovery 'process_metadata_incomplete'}
  foreach($sample in $Observation.processSamples){
    if(@($sample.matches).Count -ne 0 -or @($sample.unreadableNodeOrWorkerd).Count -ne 0 -or $sample.originalExitCodeObserved -cne $false -or $null -ne $sample.originalExitCode){Stop-ExactRecovery 'independent_process_census_incomplete'}
  }
  foreach($process in $Observation.processes){
    if($process.pid -cnotin $expected -or $process.disposition -cne 'absent' -or
       [string]::IsNullOrWhiteSpace($process.originalCreatedAt) -or $process.parentPid -isnot [int] -or $process.parentPid -le 0 -or
       [string]::IsNullOrWhiteSpace($process.metadataPath) -or -not(Test-RecoveryHex $process.metadataSha256)){Stop-ExactRecovery 'process_metadata_incomplete'}
    Assert-RecoveryWitnessFile ([pscustomobject]@{path=$process.metadataPath;sha256=$process.metadataSha256})
    if($null -eq $process.executablePath -and ($process.pid -ne 36384 -or $process.parentPid -ne 9024 -or
       $process.originalCreatedAt -cne '2026-10-15T12:23:43.184078+08:00')){Stop-ExactRecovery 'process_metadata_incomplete'}
  }
  $inventory=Get-RecoveryProcessInventory
  foreach($process in $inventory){
    if($process.ProcessId -in $expected -or $process.ParentProcessId -in $expected){Stop-ExactRecovery 'original_process_or_descendant_present'}
    if($process.Name -match '^(node|workerd)\.exe$' -and
       ([string]::IsNullOrWhiteSpace([string]$process.CommandLine) -or [string]::IsNullOrWhiteSpace([string]$process.ExecutablePath))){Stop-ExactRecovery 'current_process_metadata_unavailable'}
    if([string]$process.CommandLine -match 'ai-schedules-production-20261015[\\/]publish\.mjs|release-payload-retention\.(mjs|ps1)'){
      Stop-ExactRecovery 'original_writer_path_still_active'
    }
  }
}

function Assert-RecoveryObservation([object]$Observation,[object]$Request,[switch]$AuditAlreadyFailed) {
  Assert-RecoveryObject $Observation
  if($Observation.version -cne 'ai-schedule-afterbackup-recovery-observation-v1' -or
     $Observation.actorSid -cne $Request.actorSid -or $Observation.independent -cne $true -or $Observation.productionWrites -cne $false -or
     $Observation.originalOperationId -cne $Request.originalOperationId -or $Observation.publicationOperationId -cne $Request.publicationOperationId -or
     $Observation.maintenanceId -cne $Request.maintenanceId -or $Observation.originalProcessExitCodeObserved -cne $false -or $null -ne $Observation.originalProcessExitCode){Stop-ExactRecovery 'independent_observation_identity_drift'}
  $age=([DateTimeOffset]::UtcNow-[DateTimeOffset]::Parse($Observation.observedTo)).TotalSeconds
  if($age -lt -30 -or $age -gt 1800 -or [DateTimeOffset]::Parse($Observation.observedFrom) -ge [DateTimeOffset]::Parse($Observation.observedTo)){Stop-ExactRecovery 'independent_observation_expired'}
  if(@($Observation.stableFiles).Count -lt 200 -or @($Observation.stableFiles).Count -gt 1000){Stop-ExactRecovery 'stable_file_inventory_incomplete'}
  $seen=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach($file in $Observation.stableFiles){
    if($file.sha256 -cne $file.secondSha256 -or [DateTimeOffset]::Parse($file.firstObservedAt) -gt [DateTimeOffset]::Parse($file.secondObservedAt)){Stop-ExactRecovery 'independent_samples_not_stable'}
    $full=Get-RecoveryPath $file.path;[void]$seen.Add($full)
    if(-not($AuditAlreadyFailed -and $full -ieq (Get-RecoveryPath (Get-ExactRecoveryPaths).Audit))){
      Assert-RecoveryWitnessFile $file
      if((Get-Item -LiteralPath $file.path).Length -ne $file.sizeBytes){Stop-ExactRecovery 'stable_file_length_drift'}
    }
  }
  $paths=Get-ExactRecoveryPaths
  foreach($required in @($paths.Audit,$paths.Retention,$paths.Unknown,$paths.OriginalReview,(Join-Path $paths.Out 'After-Verify-started.json'),(Join-Path $paths.Out 'After-Verify-completed.json'))){
    if(-not $seen.Contains((Get-RecoveryPath $required))){Stop-ExactRecovery 'required_witness_missing'}
  }
  if(@($Observation.retentionPlan.retainedKeys).Count -ne 427 -or @($Observation.retentionPlan.preservedMetadata).Count -ne 3830){Stop-ExactRecovery 'original_retention_plan_incomplete'}
  if((Get-RecoveryPath $Observation.retentionPlan.path) -ine (Get-RecoveryPath $paths.Retention)){Stop-ExactRecovery 'retention_identity_drift'}
  Assert-RecoveryWitnessFile $Observation.retentionPlan
  $ledger=[Text.UTF8Encoding]::new($false,$true).GetString((Read-RecoveryBytes $paths.Retention))
  $firstLine=($ledger -split '\r?\n',2)[0] | ConvertFrom-Json
  if($firstLine.event -cne 'planned' -or
     (ConvertTo-RecoveryCanonical $firstLine.plan.retainedKeys) -cne (ConvertTo-RecoveryCanonical $Observation.retentionPlan.retainedKeys) -or
     (ConvertTo-RecoveryCanonical $firstLine.plan.preservedMetadata) -cne (ConvertTo-RecoveryCanonical $Observation.retentionPlan.preservedMetadata)){
    Stop-ExactRecovery 'original_retention_explicit_lists_drift'
  }
  $explicitSeen=[Collections.Generic.Dictionary[string,string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach($file in @($Observation.retentionPlan.retainedKeys)+@($Observation.retentionPlan.preservedMetadata)){
    $full=Get-RecoveryPath $file.path
    if($explicitSeen.ContainsKey($full)){if($explicitSeen[$full] -cne $file.sha256){Stop-ExactRecovery 'retention_duplicate_binding_drift'}}
    else{Assert-RecoveryWitnessFile $file;$explicitSeen.Add($full,$file.sha256)}
  }
  foreach($path in $Observation.absentPaths){Assert-RecoveryReadableScope $path;if(Test-Path -LiteralPath $path){Stop-ExactRecovery 'later_step_or_consumption_exists'}}
  if(@($Observation.absentPaths).Count -lt 20){Stop-ExactRecovery 'later_step_absence_incomplete'}
  foreach($check in $Observation.checks){if($check.match -isnot [bool] -or -not $check.match){Stop-ExactRecovery 'independent_check_failed'}}
  if(@($Observation.checks).Count -lt 1000){Stop-ExactRecovery 'independent_checks_incomplete'}
  Assert-RecoveryProcesses $Observation
  $verify=Read-RecoveryJson (Join-Path $paths.Out 'After-Verify-completed.json')
  if($verify.processEvidence.exitCode -ne 0 -or $verify.processEvidence.code -cne 'completed' -or
     $verify.value.status -cne 'completed' -or $verify.value.backupId -cne 'daily-20261015T041546Z-e45dddeb5a15' -or
     $verify.value.manifestSha256 -cne 'd027dc04cfeb3cde06801b7f200ba355fb5afae84da311ca5fe295e2284fa34d' -or
     $verify.value.dumpSha256 -cne 'aaffc32f3614663bcc5425b870758d5f166304c2bc247dd1503ba74458ad49ae' -or
     $verify.value.contentSha256 -cne '85caeeb71f60fd9a41241f18f75c32542eefec9b3a0740dc61a7856ffcdc40ed'){Stop-ExactRecovery 'existing_backup_verify_invalid'}
}

function Get-RecoveryAuditTemplate([object]$Audit) {
  $clone=ConvertFrom-Json -InputObject (ConvertTo-Json -InputObject $Audit -Depth 32 -Compress)
  $clone.updatedAt=$null
  return ConvertTo-RecoveryCanonical $clone
}
function Get-RecoveryAuditState([object]$Intent) {
  $paths=Get-ExactRecoveryPaths
  try {
  if(@(Get-ChildItem -LiteralPath (Split-Path -Parent $paths.Audit) -Filter ('.'+[IO.Path]::GetFileName($paths.Audit)+'.*.tmp') -Force).Count -gt 0){return 'unknown'}
  if((Get-RecoveryFileSha $paths.Audit) -ceq $Intent.originalAuditSha256){return 'original_bytes'}
  $current=Read-RecoveryJson $paths.Audit
  if((Get-RecoveryAuditTemplate $current) -ceq $Intent.expectedAuditCanonical -and $current.updatedAt -is [string]){
    $at=[DateTimeOffset]::Parse($current.updatedAt)
    if($at -ge [DateTimeOffset]::Parse($Intent.createdAt) -and $at -le [DateTimeOffset]::Parse($Intent.writeWindowEndsAt)){return 'expected_failed'}
  }
  return 'unknown'
  } catch { return 'unknown' }
}
function Complete-RecoveryReceipt([object]$Intent,[string]$Classification) {
  $paths=Get-ExactRecoveryPaths
  if((Get-RecoveryAuditState $Intent) -cne 'expected_failed'){Stop-ExactRecovery 'settlement_not_exact_expected_failed'}
  $result=[pscustomobject][ordered]@{version='ai-schedule-afterbackup-settlement-receipt-v1';status='settled_failed';
    originalOperationId='d4ae1a82639343b8a5e2347694ebe0f4';databaseBackupReplayed=$false;installReplayed=$false;cleanupReplayed=$false;
    requestSha256=$Intent.requestSha256;intentSha256=(Get-RecoveryFileSha $paths.Intent);auditSha256=(Get-RecoveryFileSha $paths.Audit);
    originalAuditSha256=$Intent.originalAuditSha256;originalExitCode=$null;originalOuterOutcome='unknown';cleanupOutcome='partial_incomplete';
    databaseChildOutcome='completed_preserved';receiptPath=$paths.Receipt}
  Write-RecoveryJson $paths.Receipt $result
  return [pscustomobject]@{status='settled_failed';originalOperationId=$result.originalOperationId;databaseBackupReplayed=$false;
    auditSha256=$result.auditSha256;receiptPath=$paths.Receipt;receiptSha256=(Get-RecoveryFileSha $paths.Receipt);classification=$Classification}
}

function Invoke-ExactAfterBackupSettlement {
  param([Parameter(Mandatory)][string]$ApprovedRequestSha256,[Parameter(Mandatory)][string]$ApprovedRotationWitnessSha256,[switch]$Execute)
  if(-not $Execute){Stop-ExactRecovery 'explicit_settlement_execution_required'}
  $paths=Get-ExactRecoveryPaths
  $request=Read-RecoveryJson $paths.Request $ApprovedRequestSha256
  Assert-RecoveryKeys $request @('version','originalOperationId','publicationOperationId','maintenanceId','auditSha256','observationSha256',
    'continuitySha256','serviceScriptSha256','maintenanceOperatorSha256','continuationDriverSha256','adapterSha256','moduleSha256','actorSid')
  if($request.version -cne 'ai-schedule-afterbackup-settlement-request-v1' -or $request.originalOperationId -cne 'd4ae1a82639343b8a5e2347694ebe0f4' -or
     $request.publicationOperationId -cne 'c464667d87a162bc34c4a3365ea56b5c' -or $request.maintenanceId -cne 'e1e1c62daf4c4bc4835401e53b287761' -or
     $request.auditSha256 -cne '654a9810c55600014e4d7e4d0e86ad737bb269eb5228dcd838a78213a8585de5' -or
     $request.actorSid -cne (Get-RecoveryActorSid)){Stop-ExactRecovery 'fixed_request_identity_drift'}
  foreach($binding in @(@($paths.Service,$request.serviceScriptSha256),@($paths.Operator,$request.maintenanceOperatorSha256),
    @($paths.Continuity,$request.continuitySha256),@($paths.Driver,$request.continuationDriverSha256),@($paths.Adapter,$request.adapterSha256),@($paths.Module,$request.moduleSha256))){
    if(-not(Test-RecoveryHex $binding[1]) -or (Get-RecoveryFileSha $binding[0]) -cne $binding[1]){Stop-ExactRecovery 'approved_code_drift'}
  }
  $observation=Read-RecoveryJson $paths.Observation $request.observationSha256
  $witness=Read-RecoveryJson $paths.Rotation $ApprovedRotationWitnessSha256
  Assert-RecoveryRotation $witness $request
  # Load only original installed definitions. Neither library executes a lifecycle action.
  $priorService=[Environment]::GetEnvironmentVariable('TERUISI_DJANGO_SERVICE_LIBRARY_ONLY','Process')
  $priorOperator=[Environment]::GetEnvironmentVariable('TERUISI_DJANGO_MAINTENANCE_LIBRARY_ONLY','Process')
  try{
    $env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY='1';. $paths.Service -Action Status -RuntimeRoot $paths.Runtime
    $env:TERUISI_DJANGO_MAINTENANCE_LIBRARY_ONLY='1';. $paths.Operator -Action Status -RuntimeRoot $paths.Runtime
  }finally{[Environment]::SetEnvironmentVariable('TERUISI_DJANGO_SERVICE_LIBRARY_ONLY',$priorService,'Process');[Environment]::SetEnvironmentVariable('TERUISI_DJANGO_MAINTENANCE_LIBRARY_ONLY',$priorOperator,'Process')}
  Invoke-WithServiceMutex {
    Invoke-MaintenanceMutex {
      Assert-RecoveryRotation $witness $request
      $intentExists=Test-Path -LiteralPath $paths.Intent
      if($intentExists){
        $intent=Read-RecoveryJson $paths.Intent
        if($intent.requestSha256 -cne $ApprovedRequestSha256 -or $intent.originalAuditSha256 -cne $request.auditSha256){Stop-ExactRecovery 'original_intent_binding_drift'}
        $state=Get-RecoveryAuditState $intent
        if($state -cne 'expected_failed'){Stop-ExactRecovery ('settlement_readonly_'+$state)}
        Assert-RecoveryObservation $observation $request -AuditAlreadyFailed
        if(@((Get-MaintenanceRunStatus).unresolved).Count -ne 0){Stop-ExactRecovery 'another_unresolved_maintenance_run'}
        return Complete-RecoveryReceipt $intent 'expected_failed_receipt_recovered'
      }
      Assert-RecoveryObservation $observation $request
      if((Get-RecoveryFileSha $paths.Audit) -cne $request.auditSha256){Stop-ExactRecovery 'original_audit_sha_drift'}
      $audit=Read-RecoveryJson $paths.Audit $request.auditSha256
      Assert-RecoveryAudit $audit
      $runs=Get-MaintenanceRunStatus
      if(@($runs.unresolved).Count -ne 1 -or $runs.unresolved[0].id -cne $request.originalOperationId){Stop-ExactRecovery 'another_unresolved_maintenance_run'}
      foreach($item in @(@('original-audit.bin',$paths.Audit),@('original-retention.bin',$paths.Retention),@('original-unknown.bin',$paths.Unknown),
        @('original-exit-review.bin',$paths.OriginalReview),@('independent-observation.bin',$paths.Observation),@('settlement-request.bin',$paths.Request))){
        Write-RecoveryCreateOnly (Join-Path $paths.Recovery $item[0]) (Read-RecoveryBytes $item[1])
      }
      $created=[DateTimeOffset]::UtcNow
      $failure=[pscustomobject][ordered]@{version='ai-schedule-afterbackup-interruption-v1';status='incomplete';stage='release_retention';
        errorCode='original_outer_execution_stopped_incomplete';originalExitCode=$null;originalOuterOutcome='unknown';
        cleanupOutcome='partial_incomplete';noReplay=$true;databaseChildOutcome='completed_preserved';coordinatedAt=$created.ToString('o');
        evidence=[pscustomobject]@{requestSha256=$ApprovedRequestSha256;observationSha256=$request.observationSha256;originalAuditSha256=$request.auditSha256;
          originalRetentionSha256=(Get-RecoveryFileSha $paths.Retention);originalUnknownSha256=(Get-RecoveryFileSha $paths.Unknown);
          originalExitReviewSha256=(Get-RecoveryFileSha $paths.OriginalReview)}}
      $expected=ConvertFrom-Json -InputObject (ConvertTo-Json -InputObject $audit -Depth 32 -Compress)
      $expected.status='failed';$expected.failure=$failure;$expected.updatedAt=$null
      $intent=[pscustomobject][ordered]@{version='ai-schedule-afterbackup-settlement-intent-v1';originalOperationId=$request.originalOperationId;
        requestSha256=$ApprovedRequestSha256;observationSha256=$request.observationSha256;originalAuditSha256=$request.auditSha256;
        originalRetentionSha256=(Get-RecoveryFileSha $paths.Retention);originalUnknownSha256=(Get-RecoveryFileSha $paths.Unknown);
        createdAt=$created.ToString('o');writeWindowEndsAt=$created.AddSeconds(120).ToString('o');expectedAuditCanonical=(Get-RecoveryAuditTemplate $expected)}
      Write-RecoveryJson $paths.Intent $intent
      # Final compare within both original mutexes. The original primitive has no replay path.
      Assert-RecoveryRotation $witness $request
      Assert-RecoveryProcesses $observation
      if((Get-RecoveryFileSha $paths.Audit) -cne $request.auditSha256 -or (Get-RecoveryFileSha $paths.Retention) -cne $intent.originalRetentionSha256){Stop-ExactRecovery 'locked_input_drift'}
      $script:MaintenanceRun=$audit;$script:MaintenanceRun.failure=$failure;$script:MaintenancePhase='release_retention'
      Save-MaintenanceRun 'failed'
      Complete-RecoveryReceipt $intent 'saved'
    }
  }
}

Export-ModuleMember -Function Invoke-ExactAfterBackupSettlement
