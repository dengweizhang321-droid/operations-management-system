$ErrorActionPreference='Stop'
$root='D:\codex-artifacts\ai-schedules-production-20261015\recovery'
$suite=Join-Path $root ('isolated-'+[Guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($suite)
$module=Import-Module (Join-Path $root 'exact-afterbackup-settlement.psm1') -Force -PassThru
$utf8=[Text.UTF8Encoding]::new($false)
$originalAudit=[IO.File]::ReadAllBytes('D:\teruisi-runtime\django-sales\audits\postgres-operations\d4ae1a82639343b8a5e2347694ebe0f4.json')
if(([BitConverter]::ToString(([Security.Cryptography.SHA256]::Create()).ComputeHash($originalAudit))).Replace('-','').ToLowerInvariant() -cne '654a9810c55600014e4d7e4d0e86ad737bb269eb5228dcd838a78213a8585de5'){throw 'Original production audit changed; no test fixture is fabricated'}
$continuity=[IO.File]::ReadAllBytes('D:\teruisi-runtime\django-sales\app\tools\postgres-backup-continuity.ps1')
function Function-Text([string]$Path,[string]$Name){$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseFile($Path,[ref]$null,[ref]$errors);if($errors){throw 'Source parse failed'};return ($ast.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $Name},$true)).Extent.Text}
$serviceLock=Function-Text 'D:\teruisi-runtime\django-sales\app\tools\django-local-service.ps1' 'Invoke-WithServiceMutex'
$pgLock=Function-Text 'D:\teruisi-runtime\django-sales\app\tools\django-postgres-maintenance.ps1' 'Invoke-MaintenanceMutex'
$atomic=Function-Text 'D:\teruisi-runtime\django-sales\app\tools\django-postgres-maintenance.ps1' 'Write-MaintenanceAtomicText'
function J([string]$Path,[object]$Value){[IO.File]::WriteAllText($Path,($Value|ConvertTo-Json -Depth 40 -Compress),$utf8)}
function Get-TestArtifactSha([string]$Path){return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()}
function New-Case([string]$Name,[string]$Fault=''){
  $base=Join-Path $suite $Name;$out=Join-Path $base 'out';$recovery=Join-Path $out 'recovery';$runtime=Join-Path $base 'runtime'
  foreach($dir in @($recovery,(Join-Path $runtime 'app\tools'),(Join-Path $runtime 'audits\postgres-operations'))){[void][IO.Directory]::CreateDirectory($dir)}
  $paths=[pscustomobject]@{Out=$out;Recovery=$recovery;Runtime=$runtime;Request=(Join-Path $out 'afterbackup-settlement-request.json');Rotation=(Join-Path $out 'afterbackup-settlement-rotation.json');Observation=(Join-Path $out 'recovery-observation.json');Audit=(Join-Path $runtime 'audits\postgres-operations\d4ae1a82639343b8a5e2347694ebe0f4.json');Retention=(Join-Path $out 'original-retention.jsonl');Unknown=(Join-Path $out 'AfterBackup-unknown.json');OriginalReview=(Join-Path $out 'original-afterbackup-exit-review.json');Service=(Join-Path $runtime 'app\tools\django-local-service.ps1');Operator=(Join-Path $runtime 'app\tools\django-postgres-maintenance.ps1');Continuity=(Join-Path $runtime 'app\tools\postgres-backup-continuity.ps1');Driver=(Join-Path $out 'continue.mjs');Adapter=(Join-Path $recovery 'reconcile-afterbackup-audit.ps1');Module=(Join-Path $recovery 'exact-afterbackup-settlement.psm1');Intent=(Join-Path $recovery 'settlement-intent.json');Receipt=(Join-Path $recovery 'settlement-receipt.json')}
  [IO.File]::WriteAllBytes($paths.Audit,$originalAudit);[IO.File]::WriteAllBytes($paths.Continuity,$continuity)
  Copy-Item -LiteralPath (Join-Path $root 'reconcile-afterbackup-audit.ps1') -Destination $paths.Adapter
  Copy-Item -LiteralPath (Join-Path $root 'exact-afterbackup-settlement.psm1') -Destination $paths.Module
  [IO.File]::WriteAllText($paths.Driver,'synthetic reviewed driver',$utf8)
  $fixtureService=@'
param([string]$Action='Status',[string]$RuntimeRoot)
function Get-CanonicalPath([string]$Path){return [IO.Path]::GetFullPath($Path).TrimEnd('\')}
function Get-Sha256Text([string]$Value){$sha=[Security.Cryptography.SHA256]::Create();try{return [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}}
function Write-LauncherEvent {}
function Assert-NoSystemMaintenance {throw 'No lifecycle operation is allowed by the fixture'}
function Assert-RuntimeChildPath([string]$Path){$p=[IO.Path]::GetFullPath($Path);if(-not $p.StartsWith(($RuntimeRoot+'\'),[StringComparison]::OrdinalIgnoreCase)){throw 'Fixture path escaped its own runtime'};return $p}
function Read-JsonFile([string]$Path,[string]$Label){return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json}
function Read-AutomationDrain {return $null}
function Read-SystemMaintenance {return $null}
'@
  [IO.File]::WriteAllText($paths.Service,($fixtureService+"`n"+$serviceLock),$utf8)
  $fixtureOperator=@'
param([string]$Action='Status',[string]$RuntimeRoot)
$MaintenanceRequest=[pscustomobject]@{Action=$Action;RuntimeRoot=$RuntimeRoot}
$MaintenanceUtf8NoBom=[Text.UTF8Encoding]::new($false)
function Get-MaintenanceCanonicalPath([string]$Path){return [IO.Path]::GetFullPath($Path).TrimEnd('\')}
. (Join-Path $PSScriptRoot 'postgres-backup-continuity.ps1')
'@
  $fixtureFault=@'
$script:OriginalAtomic=(Get-Command Write-MaintenanceAtomicText).ScriptBlock
function Write-MaintenanceAtomicText([string]$Path,[string]$Value){
  $script:FixtureSaveCalls++
  if($script:FixtureFault -ceq 'before'){throw 'Injected before save'}
  & $script:OriginalAtomic $Path $Value
  if($script:FixtureFault -ceq 'after'){throw 'Injected after save'}
  if($script:FixtureFault -ceq 'other'){[IO.File]::AppendAllText($Path,'BROKEN');throw 'Injected unknown state'}
}
'@
  [IO.File]::WriteAllText($paths.Operator,($fixtureOperator+"`n"+$atomic+"`n"+$pgLock+"`n"+$fixtureFault),$utf8)
  J $paths.Unknown @{processEvidence=@{code='process_timeout';exitCode=$null}}
  J $paths.OriginalReview @{status='incomplete-original-exit-and-final-result-not-proven'}
  $metadata=Join-Path $out 'original-identities.json';J $metadata @{identities=@(47368,9024,36384)}
  $binding=Join-Path $out 'preserved-material.bin';[IO.File]::WriteAllText($binding,'synthetic fixed material',$utf8)
  $keys=@(1..427|ForEach-Object{[pscustomobject]@{path=$binding;sha256=(Get-TestArtifactSha $binding)}})
  $preserved=@(1..3830|ForEach-Object{[pscustomobject]@{path=$binding;sha256=(Get-TestArtifactSha $binding)}})
  [IO.File]::WriteAllText($paths.Retention,(@{event='planned';plan=@{retainedKeys=$keys;preservedMetadata=$preserved}}|ConvertTo-Json -Depth 10 -Compress),$utf8)
  $now=[DateTimeOffset]::UtcNow;$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $verify=Join-Path $out 'After-Verify-completed.json';J $verify @{processEvidence=@{exitCode=0;code='completed'};value=@{status='completed';backupId='daily-20261015T041546Z-e45dddeb5a15';manifestSha256='d027dc04cfeb3cde06801b7f200ba355fb5afae84da311ca5fe295e2284fa34d';dumpSha256='aaffc32f3614663bcc5425b870758d5f166304c2bc247dd1503ba74458ad49ae';contentSha256='85caeeb71f60fd9a41241f18f75c32542eefec9b3a0740dc61a7856ffcdc40ed'}}
  $verifyStart=Join-Path $out 'After-Verify-started.json';J $verifyStart @{status='started'}
  $files=@($paths.Audit,$paths.Retention,$paths.Unknown,$paths.OriginalReview,$verifyStart,$verify,$binding)
  $stable=@(foreach($path in $files){[pscustomobject]@{role='fixture';path=$path;sha256=(Get-TestArtifactSha $path);secondSha256=(Get-TestArtifactSha $path);sizeBytes=(Get-Item -LiteralPath $path).Length;firstObservedAt=$now.AddSeconds(-2).ToString('o');secondObservedAt=$now.AddSeconds(-1).ToString('o')}})
  $stable+=@(1..200|ForEach-Object{[pscustomobject]@{role='fixture-preserved';path=$binding;sha256=(Get-TestArtifactSha $binding);secondSha256=(Get-TestArtifactSha $binding);sizeBytes=24;firstObservedAt=$now.AddSeconds(-2).ToString('o');secondObservedAt=$now.AddSeconds(-1).ToString('o')}})
  # Use the actual byte size even if an implementation changes the fixture text.
  foreach($entry in $stable){$entry.sizeBytes=(Get-Item -LiteralPath $entry.path).Length}
  $processes=@([pscustomobject]@{pid=47368;parentPid=40828;originalCreatedAt='2026-10-15T11:39:47.447657+08:00';executablePath='fixture-node';metadataPath=$metadata;metadataSha256=(Get-TestArtifactSha $metadata);disposition='absent'},[pscustomobject]@{pid=9024;parentPid=47368;originalCreatedAt='2026-10-15T12:15:16.341106+08:00';executablePath='fixture-ps';metadataPath=$metadata;metadataSha256=(Get-TestArtifactSha $metadata);disposition='absent'},[pscustomobject]@{pid=36384;parentPid=9024;originalCreatedAt='2026-10-15T12:23:43.184078+08:00';executablePath=$null;metadataPath=$metadata;metadataSha256=(Get-TestArtifactSha $metadata);disposition='absent'})
  $sample=[pscustomobject]@{matches=@();unreadableNodeOrWorkerd=@();originalExitCodeObserved=$false;originalExitCode=$null}
  $observation=[pscustomobject]@{version='ai-schedule-afterbackup-recovery-observation-v1';actorSid=$sid;independent=$true;productionWrites=$false;originalOperationId='d4ae1a82639343b8a5e2347694ebe0f4';publicationOperationId='c464667d87a162bc34c4a3365ea56b5c';maintenanceId='e1e1c62daf4c4bc4835401e53b287761';originalProcessExitCodeObserved=$false;originalProcessExitCode=$null;observedFrom=$now.AddSeconds(-3).ToString('o');observedTo=$now.AddSeconds(-1).ToString('o');stableFiles=$stable;retentionPlan=@{path=$paths.Retention;sha256=(Get-TestArtifactSha $paths.Retention);retainedKeys=$keys;preservedMetadata=$preserved};processes=$processes;processSamples=@($sample,$sample);absentPaths=@(1..20|ForEach-Object{Join-Path $out ('absent-'+$_)});checks=@(1..1000|ForEach-Object{@{match=$true}})}
  J $paths.Observation $observation
  $witness=[pscustomobject]@{version='ai-schedule-afterbackup-rotation-witness-v1';ownerPid=[int]$PID;ownerCreatedAt=$now.ToString('o');driverSha256=(Get-TestArtifactSha $paths.Driver);actorSid=$sid;createdAt=$now.ToString('o')};J $paths.Rotation $witness
  $request=[pscustomobject]@{version='ai-schedule-afterbackup-settlement-request-v1';originalOperationId=$observation.originalOperationId;publicationOperationId=$observation.publicationOperationId;maintenanceId=$observation.maintenanceId;auditSha256=(Get-TestArtifactSha $paths.Audit);observationSha256=(Get-TestArtifactSha $paths.Observation);continuitySha256=(Get-TestArtifactSha $paths.Continuity);serviceScriptSha256=(Get-TestArtifactSha $paths.Service);maintenanceOperatorSha256=(Get-TestArtifactSha $paths.Operator);continuationDriverSha256=(Get-TestArtifactSha $paths.Driver);adapterSha256=(Get-TestArtifactSha $paths.Adapter);moduleSha256=(Get-TestArtifactSha $paths.Module);actorSid=$sid};J $paths.Request $request
  & $module {param($p,$w,$f)
    $script:FixturePaths=$p;$script:FixtureWitness=$w;$script:FixtureFault=$f;$script:FixtureSaveCalls=0;$script:FixtureInventoryCalls=0;$script:FixtureLive=$false;$script:FixtureWrongOwner=$false;$script:FixtureDrift=$false
    function script:Get-ExactRecoveryPaths{return $script:FixturePaths}
    function script:Get-RecoveryRotationServerPid{if($script:FixtureWrongOwner){return 1};return $script:FixtureWitness.ownerPid}
    function script:Get-RecoveryProcessInventory{
      $script:FixtureInventoryCalls++
      if($script:FixtureDrift -and $script:FixtureInventoryCalls -eq 5){[IO.File]::AppendAllText($script:FixturePaths.Audit,"`n")}
      $owner=[pscustomobject]@{ProcessId=$script:FixtureWitness.ownerPid;ParentProcessId=1;CreationDate=[DateTimeOffset]::Parse($script:FixtureWitness.ownerCreatedAt).UtcDateTime;CommandLine=('node '+$script:FixturePaths.Driver);ExecutablePath='fixture-node';Name='node.exe'}
      if($script:FixtureLive){return @($owner,[pscustomobject]@{ProcessId=9024;ParentProcessId=47368;CreationDate=[DateTime]::UtcNow;CommandLine='fixture-original';ExecutablePath='fixture';Name='powershell.exe'})};return @($owner)
    }
  } $paths $witness $Fault
  return [pscustomobject]@{Paths=$paths;Request=$request;Observation=$observation;Witness=$witness}
}
function Run-Case($Case){return Invoke-ExactAfterBackupSettlement -ApprovedRequestSha256 (Get-TestArtifactSha $Case.Paths.Request) -ApprovedRotationWitnessSha256 (Get-TestArtifactSha $Case.Paths.Rotation) -Execute}
function Save-Observation($Case){J $Case.Paths.Observation $Case.Observation;$Case.Request.observationSha256=Get-TestArtifactSha $Case.Paths.Observation;J $Case.Paths.Request $Case.Request}
function Expect-Rejected($Case,[string]$Name){$failed=$false;try{Run-Case $Case|Out-Null}catch{$failed=$true};if(-not $failed){throw ('Unexpected acceptance: '+$Name)};if((& $module {$script:FixtureSaveCalls}) -ne 0){throw ('Negative case reached original save: '+$Name)}}
$results=[Collections.Generic.List[object]]::new()
$c=New-Case 'success';$result=Run-Case $c
if($result.status -cne 'settled_failed' -or (Get-TestArtifactSha (Join-Path $c.Paths.Recovery 'original-audit.bin')) -cne $c.Request.auditSha256){throw 'Exact successful preservation failed'}
if((& $module {$script:FixtureSaveCalls}) -ne 1){throw 'Expected one original save'}
$results.Add(@{name='original-primitive-exact-failed-and-preservation';passed=$true})
foreach($negative in @('wrong-sha','wrong-id','wrong-phase','live-process','missing-metadata','wrong-owner','wrong-head','wrong-entry','wrong-backup-verify','another-running','locked-drift')){
  $c=New-Case $negative
  switch($negative){
    wrong-sha {$c.Request.auditSha256='0'*64;J $c.Paths.Request $c.Request}
    wrong-id {$c.Request.originalOperationId='0'*32;J $c.Paths.Request $c.Request}
    wrong-phase {$a=Get-Content -LiteralPath $c.Paths.Audit -Raw -Encoding UTF8|ConvertFrom-Json;$a.phase='admission';J $c.Paths.Audit $a}
    live-process {& $module {$script:FixtureLive=$true}}
    missing-metadata {Remove-Item -LiteralPath $c.Observation.processes[0].metadataPath}
    wrong-owner {& $module {$script:FixtureWrongOwner=$true}}
    wrong-head {$c.Observation.stableFiles[6].sha256='0'*64;$c.Observation.stableFiles[6].secondSha256='0'*64;Save-Observation $c}
    wrong-entry {$c.Observation.stableFiles[6].sizeBytes++;Save-Observation $c}
    wrong-backup-verify {$v=Get-Content -LiteralPath $c.Observation.stableFiles[5].path -Raw|ConvertFrom-Json;$v.value.status='failed';J $c.Observation.stableFiles[5].path $v;$c.Observation.stableFiles[5].sha256=Get-TestArtifactSha $c.Observation.stableFiles[5].path;$c.Observation.stableFiles[5].secondSha256=$c.Observation.stableFiles[5].sha256;$c.Observation.stableFiles[5].sizeBytes=(Get-Item $c.Observation.stableFiles[5].path).Length;Save-Observation $c}
    another-running {$a=Get-Content -LiteralPath $c.Paths.Audit -Raw|ConvertFrom-Json;$a.id='a'*32;J (Join-Path (Split-Path $c.Paths.Audit) ($a.id+'.json')) $a}
    locked-drift {& $module {$script:FixtureDrift=$true}}
  }
  Expect-Rejected $c $negative;$results.Add(@{name=$negative;passed=$true})
}
foreach($fault in @('before','after','other')){
  $c=New-Case ('interrupted-'+$fault) $fault;$failed=$false;try{Run-Case $c|Out-Null}catch{$failed=$true};if(-not $failed){throw 'Injected save interruption did not fail'}
  $calls=& $module {$script:FixtureSaveCalls};if($calls -ne 1){throw 'Interrupted save was replayed'}
  & $module {$script:FixtureFault=''}
  if($fault -ceq 'after'){$r=Run-Case $c;if($r.classification -cne 'expected_failed_receipt_recovered'){throw 'Exact expected failed receipt not recovered'}}
  else{$failed=$false;try{Run-Case $c|Out-Null}catch{$failed=$true};if(-not $failed){throw 'Original/unknown state was blindly replayed'}}
  if((& $module {$script:FixtureSaveCalls}) -ne 1){throw 'Save called a second time after intent'}
  $results.Add(@{name=('interrupted-'+$fault+'-readonly-tristate');passed=$true})
}
$c=New-Case 'restore-gate';Run-Case $c|Out-Null
& $module {param($p)
  . $p.Service -Action Status -RuntimeRoot $p.Runtime;. $p.Operator -Action Status -RuntimeRoot $p.Runtime
  $MaintenanceRequest.Action='RestoreRehearsal';$script:FixtureFault='';Start-MaintenanceRun
  if($script:MaintenanceRun.action -cne 'RestoreRehearsal'){throw 'Original Restore gate did not start'}
  $blocked=$false;try{Start-MaintenanceRun}catch{$blocked=$true};if(-not $blocked){throw 'Original Start accepted another unresolved run'}
} $c.Paths
$results.Add(@{name='original-restore-start-and-other-running-refusal';passed=$true})
$summary=[ordered]@{version='exact-afterbackup-settlement-isolated-tests-v1';status='passed';powershellVersion=$PSVersionTable.PSVersion.ToString();productionWrites=$false;directory=$suite;tests=$results;moduleSha256=(Get-TestArtifactSha (Join-Path $root 'exact-afterbackup-settlement.psm1'));adapterSha256=(Get-TestArtifactSha (Join-Path $root 'reconcile-afterbackup-audit.ps1'))}
J (Join-Path $suite 'summary.json') $summary
$summary | ConvertTo-Json -Depth 8 -Compress
