$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '..\tools\operations-system-watchdog.ps1') -FunctionsOnly
${script:realReadWatchJson}=${function:Read-WatchJson}
$fixtureBase=Join-Path ([IO.Path]::GetTempPath()) ('watchdog-install-tests-'+[guid]::NewGuid().ToString('N'))
$sourceTools=Join-Path $PSScriptRoot '..\tools';$script:checks=0
function Assert-Install($Condition,$Message){if(-not $Condition){throw $Message};$script:checks++}
function Assert-WatchdogInstallRoot($Root){if(-not [IO.Path]::GetFullPath($Root).StartsWith($fixtureBase+'\')){throw 'test escaped fixture root'}}
function Get-WatchdogMutexName {$script:testMutex}
function Get-WatchSnapshot {
 if($script:case -eq 'became-running'){$script:fakeTask.State='Running'}
 if($script:snapshotOverride){return $script:snapshotOverride}
 @{healthy=($script:case -ne 'unhealthy')}
}
function Read-WatchJson([string]$Path){
 # The gate reads the INSTALLED binding (beside the entry script for a flat legacy install),
 # not the candidate's, so serve the override from the fixture root.
 if($script:driverBindingOverride -and [IO.Path]::GetFullPath($Path) -ieq [IO.Path]::GetFullPath((Join-Path $WatchdogRoot 'driver-binding.json'))){return $script:driverBindingOverride}
 & $script:realReadWatchJson $Path
}
function Get-ScheduledTask { $script:fakeTask }
function Export-ScheduledTask { $script:fakeTask|ConvertTo-Json -Depth 8 -Compress }
function New-ScheduledTaskAction {param($Execute,$WorkingDirectory,$Argument) [pscustomobject]@{Execute=$Execute;WorkingDirectory=$WorkingDirectory;Arguments=$Argument}}
function Set-ScheduledTask {param($TaskName,$Action,$ErrorAction) $script:taskWrites++;$script:fakeTask.Actions=@($Action);if($script:case -eq 'set-after'){throw 'synthetic set failure'};if($script:case -eq 'foreign-after'){$script:fakeTask.Actions[0].Arguments='foreign'}}
function Enable-ScheduledTask {$script:taskWrites++;$script:fakeTask.State='Ready';if($script:case -eq 'enable-after'){throw 'synthetic enable failure'}}
function Register-ScheduledTask {param($TaskName,$Xml,[switch]$Force,$ErrorAction) if(-not $Xml){throw 'unexpected create in upgrade fixture'};$script:taskWrites++;$script:fakeTask=$Xml|ConvertFrom-Json}
function Unregister-ScheduledTask {throw 'unexpected unregister in upgrade fixture'}
function Start-ScheduledTask {throw 'installer must wait for natural trigger'}
function Setup-Fixture([string]$Name){
 $script:case=$Name;$script:taskWrites=0;$script:testMutex='Local\TERUISI.Install.Test.'+[guid]::NewGuid().ToString('N')
 $script:WatchdogRoot=Join-Path $fixtureBase $Name;$script:StatePath=Join-Path $WatchdogRoot 'state.json'
 New-Item -ItemType Directory -Path $WatchdogRoot -Force|Out-Null
 [IO.File]::WriteAllText((Join-Path $WatchdogRoot 'operations-system-watchdog.ps1'),'legacy script')
 [IO.File]::WriteAllText((Join-Path $WatchdogRoot 'process-deadline.ps1'),'legacy helper')
 $csHash=Get-WatchAssetHash (Join-Path $sourceTools 'watchdog-launcher\NoConsoleLauncher.cs')
 $gui=Join-Path $WatchdogRoot ('Watchdog.NoConsole-'+$csHash.Substring(0,16)+'.exe');[IO.File]::WriteAllText($gui,'fixture GUI, never executed')
 Write-WatchJson (Join-Path $WatchdogRoot 'installation.json') @{version=$WatchdogVersion;scriptSha256=Get-WatchAssetHash (Join-Path $WatchdogRoot 'operations-system-watchdog.ps1');transportSha256=Get-WatchAssetHash (Join-Path $WatchdogRoot 'process-deadline.ps1');launcherSourceSha256=$csHash;launcherSha256=Get-WatchAssetHash $gui}
 [IO.File]::WriteAllText($StatePath,'{"notification":"unknown","incident":"original"}')
 $script:fakeTask=[pscustomobject]@{State='Ready';Actions=@([pscustomobject]@{Execute=$gui;Arguments=('"'+$PowerShellPath+'" "'+(Join-Path $WatchdogRoot 'operations-system-watchdog.ps1')+'"');WorkingDirectory=$WatchdogRoot});Triggers=@(@{},@{Repetition=@{Interval='PT1M'}})}
 $script:ApprovedInstallPlanId=(Get-WatchInstallContext $sourceTools).planId
 $script:Execute=[switch]$true
}
function File-Inventory {
 @(Get-ChildItem -LiteralPath $WatchdogRoot -Recurse -File|Sort-Object FullName|ForEach-Object {$_.FullName+':'+(Get-WatchHash $_.FullName)}) -join "`n"
}
function Write-PSSingleQuoted([string]$Path){"'"+$Path.Replace("'","''")+"'"}
function New-InstalledDiagnosticDriverFiles([string]$ControlPath,[string]$WorkerPath,[string]$BackendPath,[string]$TransportPath,[string]$SupervisorPath){
 # Mirrors the exact literal shapes the real generators (prepare-watchdog-status-driver.mjs,
 # prepare-watchdog-supervisor-status-driver.mjs) write into the installed driver, so
 # Get-WatchInstalledDiagnosticSources's regex has real text to parse against, not a
 # placeholder body. Only the two literal lines the parser reads are load-bearing here.
 $control="`$diagnosticSources=@{control="+(Write-PSSingleQuoted $ControlPath)+";backend="+(Write-PSSingleQuoted $BackendPath)+";worker="+(Write-PSSingleQuoted $WorkerPath)+";transport="+(Write-PSSingleQuoted $TransportPath)+"}`n"
 [IO.File]::WriteAllText((Join-Path $WatchdogRoot 'watchdog-status-control.ps1'),$control)
 $backend=if($SupervisorPath){"`$diagnosticSupervisor="+(Write-PSSingleQuoted $SupervisorPath)+"`n"}else{''}
 [IO.File]::WriteAllText((Join-Path $WatchdogRoot 'watchdog-status-backend.ps1'),$backend)
}
try{
 foreach($case in @('running','foreign','bad-hash','wrong-plan','unhealthy','became-running')){
  Setup-Fixture $case
  if($case -eq 'running'){$script:fakeTask.State='Running'}
  if($case -eq 'foreign'){$script:fakeTask.Actions[0].Arguments='foreign'}
  if($case -eq 'bad-hash'){[IO.File]::AppendAllText((Join-Path $WatchdogRoot 'process-deadline.ps1'),'modified')}
  if($case -eq 'wrong-plan'){$script:ApprovedInstallPlanId='b'*64}
  $before=File-Inventory;$blocked=$false
  try{Install-WatchdogSafely $sourceTools|Out-Null}catch{$blocked=$true}
  Assert-Install ($blocked -and $script:taskWrites -eq 0 -and (File-Inventory) -ceq $before) "$case admission changed files or task"
 }
 foreach($case in @('set-after','enable-after')){
  Setup-Fixture $case
  $configHash=Get-WatchHash (Join-Path $WatchdogRoot 'installation.json');$xml=Export-ScheduledTask;$stateHash=Get-WatchHash $StatePath
  $scriptHash=Get-WatchHash (Join-Path $WatchdogRoot 'operations-system-watchdog.ps1');$helperHash=Get-WatchHash (Join-Path $WatchdogRoot 'process-deadline.ps1')
  $blocked=$false;$failure=$null;try{Install-WatchdogSafely $sourceTools|Out-Null}catch{$blocked=$true;$failure=$_.Exception.Message}
  if($failure -eq 'watchdog_install_rollback_unconfirmed'){$debugJournal=Get-ChildItem (Join-Path $WatchdogRoot 'install-transactions') -Recurse -Filter journal.json|Select-Object -First 1;$debug=Read-WatchJson $debugJournal.FullName;$failure+=' '+$debug.rollbackCode+' '+$debug.rollbackStage+' '+$debug.rollbackErrorType}
  Assert-Install ($blocked -and (Get-WatchHash (Join-Path $WatchdogRoot 'installation.json')) -ceq $configHash -and (Export-ScheduledTask) -ceq $xml) "$case did not restore exact old references: $failure"
  Assert-Install ((Get-WatchHash $StatePath) -ceq $stateHash -and (Get-WatchHash (Join-Path $WatchdogRoot 'operations-system-watchdog.ps1')) -ceq $scriptHash -and (Get-WatchHash (Join-Path $WatchdogRoot 'process-deadline.ps1')) -ceq $helperHash) 'rollback replayed notification state or overwrote a loaded legacy script'
  $journal=Get-ChildItem (Join-Path $WatchdogRoot 'install-transactions') -Recurse -Filter journal.json|Select-Object -First 1
  Assert-Install ((Read-WatchJson $journal.FullName).phase -eq 'rolled_back') 'rollback journal did not confirm restoration'
 }
 Setup-Fixture 'success';$stateHash=Get-WatchHash $StatePath;$oldHash=Get-WatchHash (Join-Path $WatchdogRoot 'operations-system-watchdog.ps1')
 $result=Install-WatchdogSafely $sourceTools
 $after=Read-WatchJson (Join-Path $WatchdogRoot 'installation.json')
 Assert-Install ($result.status -eq 'installed' -and $after.layout -eq 'immutable-v1' -and $script:fakeTask.Actions[0].Arguments.Contains('versions\')) 'successful install did not use a fixed version path'
 Assert-Install ((Get-WatchHash $StatePath) -ceq $stateHash -and (Get-WatchHash (Join-Path $WatchdogRoot 'operations-system-watchdog.ps1')) -ceq $oldHash) 'successful installation overwrote live state or loaded legacy file'
 $script:ApprovedInstallPlanId=(Get-WatchInstallContext $sourceTools).planId
 $result=Install-WatchdogSafely $sourceTools
 Assert-Install ($result.status -eq 'installed') 'versioned predecessor cannot be verified and safely reused'
 Setup-Fixture 'busy-mutex'
 $holderScript=Join-Path $fixtureBase 'holder.ps1';$readyFile=Join-Path $fixtureBase 'holder.ready';$releaseFile=Join-Path $fixtureBase 'holder.release'
 [IO.File]::WriteAllText($holderScript,@'
param($Name,$ReadyFile,$ReleaseFile)
$m=[Threading.Mutex]::new($false,$Name);$held=$m.WaitOne(1000)
if(-not $held){exit 10}
try{[IO.File]::WriteAllText($ReadyFile,'held');$until=[DateTimeOffset]::UtcNow.AddSeconds(15);while(-not(Test-Path -LiteralPath $ReleaseFile) -and [DateTimeOffset]::UtcNow -lt $until){Start-Sleep -Milliseconds 20}}finally{$m.ReleaseMutex();$m.Dispose()}
'@)
 $holder=Start-Process -FilePath $PowerShellPath -ArgumentList @('-NoProfile','-File',('"'+$holderScript+'"'),'-Name',$script:testMutex,'-ReadyFile',('"'+$readyFile+'"'),'-ReleaseFile',('"'+$releaseFile+'"')) -WindowStyle Hidden -PassThru
 try{
  $until=[DateTimeOffset]::UtcNow.AddSeconds(5);while(-not(Test-Path $readyFile) -and [DateTimeOffset]::UtcNow -lt $until){Start-Sleep -Milliseconds 20}
  Assert-Install (Test-Path $readyFile) 'mutex holder failed to start'
  $before=File-Inventory;$blocked=$false;try{Install-WatchdogSafely $sourceTools|Out-Null}catch{$blocked=$_.Exception.Message -eq 'watchdog_install_busy'}
  Assert-Install ($blocked -and $script:taskWrites -eq 0 -and (File-Inventory) -ceq $before) 'concurrent check was not rejected before writes'
 }finally{[IO.File]::WriteAllText($releaseFile,'release');if(-not $holder.WaitForExit(5000)){$holder.Kill();$holder.WaitForExit(1000)|Out-Null};$holder.Dispose()}
 Setup-Fixture 'foreign-after';$blocked=$false;try{Install-WatchdogSafely $sourceTools|Out-Null}catch{$blocked=$_.Exception.Message -eq 'watchdog_install_rollback_unconfirmed'}
 Assert-Install ($blocked -and $script:fakeTask.Actions[0].Arguments -eq 'foreign') 'rollback took over an unknown task'

 # RequalifyDriftedAssets: the narrow deadlock-break gate.
 function New-DriftSnapshot([string[]]$Assets,[string]$FailedExtraStage,[string]$AdmissionMode='running'){
  $stages=@{control=@{status='failed';elapsedMs=1}}
  if($FailedExtraStage){$stages[$FailedExtraStage]=@{status='failed';elapsedMs=1}}
  @{healthy=$false;stages=$stages;admission=@{mode=$AdmissionMode};diagnosticBinding=@{code='diagnostic_predecessor_changed';assets=$Assets};processDiagnostic=@{code='probe_stage_failed';stage='control'}}
 }
 Setup-Fixture 'requalify-default-unchanged'
 $script:snapshotOverride=New-DriftSnapshot @('control','worker')
 $script:RequalifyDriftedAssets=''
 $blocked=$false;$failure=$null;try{Install-WatchdogSafely $sourceTools|Out-Null}catch{$blocked=$true;$failure=$_.Exception.Message}
 Assert-Install ($blocked -and $failure -eq 'watchdog_install_requires_healthy_status' -and $script:taskWrites -eq 0) 'default behaviour must still require healthy status without RequalifyDriftedAssets'

 Setup-Fixture 'requalify-exact-match'
 $script:snapshotOverride=New-DriftSnapshot @('control','worker')
 $script:RequalifyDriftedAssets='worker,control'
 $result=$null;$failed=$false;try{$result=Install-WatchdogSafely $sourceTools}catch{$failed=$true}
 Assert-Install (-not $failed -and $result.status -eq 'installed') 'exact declared/drifted match with only control stage failed must pass the health gate'
 $script:snapshotOverride=$null

 foreach($bad in @(@('control'),@('control','worker','backend'),@('worker','backend'))){
  Setup-Fixture ('requalify-mismatch-'+($bad -join '-'))
  $script:snapshotOverride=New-DriftSnapshot @('control','worker')
  $script:RequalifyDriftedAssets=($bad -join ',')
  $blocked=$false;$failure=$null;try{Install-WatchdogSafely $sourceTools|Out-Null}catch{$blocked=$true;$failure=$_.Exception.Message}
  Assert-Install ($blocked -and $failure -eq 'watchdog_requalify_asset_mismatch' -and $script:taskWrites -eq 0) "declared set $($bad -join ',') must throw watchdog_requalify_asset_mismatch"
 }
 $script:snapshotOverride=$null

 Setup-Fixture 'requalify-other-stage-failed'
 $script:snapshotOverride=New-DriftSnapshot @('control','worker') 'supervisor'
 $script:RequalifyDriftedAssets='control,worker'
 $blocked=$false;$failure=$null;try{Install-WatchdogSafely $sourceTools|Out-Null}catch{$blocked=$true;$failure=$_.Exception.Message}
 Assert-Install ($blocked -and $failure -eq 'watchdog_install_requires_healthy_status') 'a different failed stage must still require healthy status even with assets declared'
 $script:snapshotOverride=$null

 Setup-Fixture 'requalify-not-drift-code'
 $script:snapshotOverride=@{healthy=$false;stages=@{control=@{status='failed';elapsedMs=1}};admission=@{mode='running'};diagnosticBinding=@{code='invalid_diagnostic_binding';assets=@('control')};processDiagnostic=@{code='probe_stage_failed';stage='control'}}
 $script:RequalifyDriftedAssets='control'
 $blocked=$false;$failure=$null;try{Install-WatchdogSafely $sourceTools|Out-Null}catch{$blocked=$true;$failure=$_.Exception.Message}
 Assert-Install ($blocked -and $failure -eq 'watchdog_install_requires_healthy_status') 'a non-drift diagnosticBinding code must still require healthy status'
 $script:snapshotOverride=$null

 Setup-Fixture 'requalify-admission-not-running'
 $script:snapshotOverride=New-DriftSnapshot @('control','worker') $null 'maintenance'
 $script:RequalifyDriftedAssets='control,worker'
 $blocked=$false;$failure=$null;try{Install-WatchdogSafely $sourceTools|Out-Null}catch{$blocked=$true;$failure=$_.Exception.Message}
 Assert-Install ($blocked -and $failure -eq 'watchdog_install_requires_healthy_status') 'admission.mode other than running must still require healthy status'
 $script:snapshotOverride=$null

 # Production-matching path: the running predecessor predates diagnosticBinding and only
 # reports the generic control-stage probe failure. The gate must self-recompute drift from
 # driver-binding.json and the four tracked sources instead of trusting an absent asset list.
 Setup-Fixture 'requalify-no-binding-recompute'
 $script:ControlPath=Join-Path $WatchdogRoot 'fixture-control.ps1';[IO.File]::WriteAllText($script:ControlPath,'control v1')
 $script:WorkerPath=Join-Path $WatchdogRoot 'fixture-worker.ps1';[IO.File]::WriteAllText($script:WorkerPath,'worker v1')
 $script:BackendRoot=Join-Path $WatchdogRoot 'backend';New-Item -ItemType Directory -Path (Join-Path $script:BackendRoot 'app\tools') -Force|Out-Null
 $backendScript=Join-Path $script:BackendRoot 'app\tools\django-local-service.ps1';[IO.File]::WriteAllText($backendScript,'backend v1')
 $script:ProjectRoot=Join-Path $WatchdogRoot 'project';New-Item -ItemType Directory -Path (Join-Path $script:ProjectRoot 'tools') -Force|Out-Null
 $transportScript=Join-Path $script:ProjectRoot 'tools\process-deadline.ps1';[IO.File]::WriteAllText($transportScript,'transport v1')
 New-InstalledDiagnosticDriverFiles $script:ControlPath $script:WorkerPath $backendScript $transportScript
 $script:driverBindingOverride=@{version=1;assetHashes=@{control=Get-WatchHash $script:ControlPath;worker='f'*64;backend=Get-WatchHash $backendScript;transport=Get-WatchHash $transportScript}}
 $script:snapshotOverride=@{healthy=$false;stages=@{control=@{status='failed';elapsedMs=1}};admission=@{mode='running'};diagnosticBinding=$null;processDiagnostic=@{code='probe_stage_failed';stage='control'}}
 $script:RequalifyDriftedAssets='worker'
 $result=$null;$failed=$false;try{$result=Install-WatchdogSafely $sourceTools}catch{$failed=$true}
 Assert-Install (-not $failed -and $result.status -eq 'installed') 'no-diagnosticBinding snapshot must recompute drift from driver-binding.json and pass when it matches'
 Setup-Fixture 'requalify-no-binding-recompute-mismatch'
 $script:ControlPath=Join-Path $WatchdogRoot 'fixture-control.ps1';[IO.File]::WriteAllText($script:ControlPath,'control v1')
 $script:WorkerPath=Join-Path $WatchdogRoot 'fixture-worker.ps1';[IO.File]::WriteAllText($script:WorkerPath,'worker v1')
 $script:BackendRoot=Join-Path $WatchdogRoot 'backend';New-Item -ItemType Directory -Path (Join-Path $script:BackendRoot 'app\tools') -Force|Out-Null
 $backendScript=Join-Path $script:BackendRoot 'app\tools\django-local-service.ps1';[IO.File]::WriteAllText($backendScript,'backend v1')
 $script:ProjectRoot=Join-Path $WatchdogRoot 'project';New-Item -ItemType Directory -Path (Join-Path $script:ProjectRoot 'tools') -Force|Out-Null
 $transportScript=Join-Path $script:ProjectRoot 'tools\process-deadline.ps1';[IO.File]::WriteAllText($transportScript,'transport v1')
 New-InstalledDiagnosticDriverFiles $script:ControlPath $script:WorkerPath $backendScript $transportScript
 $script:driverBindingOverride=@{version=1;assetHashes=@{control=Get-WatchHash $script:ControlPath;worker='f'*64;backend=Get-WatchHash $backendScript;transport=Get-WatchHash $transportScript}}
 $script:snapshotOverride=@{healthy=$false;stages=@{control=@{status='failed';elapsedMs=1}};admission=@{mode='running'};diagnosticBinding=$null;processDiagnostic=@{code='probe_stage_failed';stage='control'}}
 $script:RequalifyDriftedAssets='control,worker'
 $blocked=$false;$failure=$null;try{Install-WatchdogSafely $sourceTools|Out-Null}catch{$blocked=$true;$failure=$_.Exception.Message}
 Assert-Install ($blocked -and $failure -eq 'watchdog_requalify_asset_mismatch') 'recomputed drift (only worker) must reject an over-broad declared set'
 $script:driverBindingOverride=$null;$script:snapshotOverride=$null;$script:RequalifyDriftedAssets=''

 # Supervisor-stage drift: control completed, supervisor failed because the supervisor probe
 # (a child process) hit the same driver-binding hash check as control, but that check throws
 # inside the child and only ever surfaces here as processDiagnostic probe_stage_failed with
 # exitCode 1 -- never as diagnosticBinding. The gate must recompute all five tracked sources,
 # including supervisor, from the installed binding to admit this shape.
 function New-SupervisorFixtureRoots {
  $script:ControlPath=Join-Path $WatchdogRoot 'fixture-control.ps1';[IO.File]::WriteAllText($script:ControlPath,'control v1')
  $script:WorkerPath=Join-Path $WatchdogRoot 'fixture-worker.ps1';[IO.File]::WriteAllText($script:WorkerPath,'worker v1')
  $script:BackendRoot=Join-Path $WatchdogRoot 'backend';New-Item -ItemType Directory -Path (Join-Path $script:BackendRoot 'app\tools') -Force|Out-Null
  $backendScript=Join-Path $script:BackendRoot 'app\tools\django-local-service.ps1';[IO.File]::WriteAllText($backendScript,'backend v1')
  # The installed supervisor driver has been found in production to hash-check the repo-tree
  # copy of django-runtime-supervisor.ps1, not $SupervisorPath's deployed copy under
  # $BackendRoot\app\tools. Fixture both locations with different content so a test that
  # recomputes against the wrong one is caught by a wrong-path hash rather than coincidence.
  $script:SupervisorPath=Join-Path $script:BackendRoot 'app\tools\django-runtime-supervisor.ps1';[IO.File]::WriteAllText($script:SupervisorPath,'deployed supervisor copy, not compared')
  $script:ProjectRoot=Join-Path $WatchdogRoot 'project';New-Item -ItemType Directory -Path (Join-Path $script:ProjectRoot 'tools') -Force|Out-Null
  $transportScript=Join-Path $script:ProjectRoot 'tools\process-deadline.ps1';[IO.File]::WriteAllText($transportScript,'transport v1')
  $repoTreeSupervisor=Join-Path $script:ProjectRoot 'tools\django-runtime-supervisor.ps1';[IO.File]::WriteAllText($repoTreeSupervisor,'repo tree supervisor copy, actually compared')
  New-InstalledDiagnosticDriverFiles $script:ControlPath $script:WorkerPath $backendScript $transportScript $repoTreeSupervisor
  return @{backendScript=$backendScript;transportScript=$transportScript;repoTreeSupervisor=$repoTreeSupervisor}
 }
 function New-SupervisorDriftSnapshot([int]$ExitCode=1,[string]$Code='probe_stage_failed',[string]$ControlStatus='completed'){
  @{healthy=$false;stages=@{control=@{status=$ControlStatus;elapsedMs=1};supervisor=@{status='failed';elapsedMs=1}};admission=@{mode='running'};diagnosticBinding=$null;processDiagnostic=@{code=$Code;stage='supervisor';process=@{exitCode=$ExitCode}}}
 }

 Setup-Fixture 'requalify-supervisor-drift-allowed'
 $paths=New-SupervisorFixtureRoots
 $script:driverBindingOverride=@{version=1;assetHashes=@{control=Get-WatchHash $script:ControlPath;worker=Get-WatchHash $script:WorkerPath;backend='f'*64;transport=Get-WatchHash $paths.transportScript;supervisor='e'*64}}
 $script:snapshotOverride=New-SupervisorDriftSnapshot
 $script:RequalifyDriftedAssets='backend,supervisor'
 $result=$null;$failed=$false;try{$result=Install-WatchdogSafely $sourceTools}catch{$failed=$true}
 Assert-Install (-not $failed -and $result.status -eq 'installed') 'control completed + supervisor failed by pin drift must pass when the correct asset set (backend,supervisor) is declared'

 Setup-Fixture 'requalify-supervisor-drift-requires-param'
 $paths=New-SupervisorFixtureRoots
 $script:driverBindingOverride=@{version=1;assetHashes=@{control=Get-WatchHash $script:ControlPath;worker=Get-WatchHash $script:WorkerPath;backend='f'*64;transport=Get-WatchHash $paths.transportScript;supervisor='e'*64}}
 $script:snapshotOverride=New-SupervisorDriftSnapshot
 $script:RequalifyDriftedAssets=''
 $blocked=$false;$failure=$null;try{Install-WatchdogSafely $sourceTools|Out-Null}catch{$blocked=$true;$failure=$_.Exception.Message}
 Assert-Install ($blocked -and $failure -eq 'watchdog_install_requires_healthy_status' -and $script:taskWrites -eq 0) 'the same supervisor-drift shape must still require -RequalifyDriftedAssets; the exemption is never default'

 Setup-Fixture 'requalify-supervisor-drift-mismatch'
 $paths=New-SupervisorFixtureRoots
 $script:driverBindingOverride=@{version=1;assetHashes=@{control=Get-WatchHash $script:ControlPath;worker=Get-WatchHash $script:WorkerPath;backend='f'*64;transport=Get-WatchHash $paths.transportScript;supervisor='e'*64}}
 $script:snapshotOverride=New-SupervisorDriftSnapshot
 $script:RequalifyDriftedAssets='backend'
 $blocked=$false;$failure=$null;try{Install-WatchdogSafely $sourceTools|Out-Null}catch{$blocked=$true;$failure=$_.Exception.Message}
 Assert-Install ($blocked -and $failure -eq 'watchdog_requalify_asset_mismatch' -and $script:taskWrites -eq 0) 'declaring only backend when supervisor also drifted must throw watchdog_requalify_asset_mismatch'

 Setup-Fixture 'requalify-supervisor-non-drift-failure-rejected'
 $paths=New-SupervisorFixtureRoots
 # Everything actually matches the installed binding: this is a non-drift supervisor failure
 # (e.g. a timed-out or crashed child), not a pinned-asset mismatch. Must still be rejected
 # even though the caller declares an asset set and the stage shape matches exactly. supervisor
 # must be hashed against the repo-tree copy (what the installed driver literal actually
 # compares), not $SupervisorPath's deployed copy, or this fixture would report a false drift.
 $script:driverBindingOverride=@{version=1;assetHashes=@{control=Get-WatchHash $script:ControlPath;worker=Get-WatchHash $script:WorkerPath;backend=Get-WatchHash $paths.backendScript;transport=Get-WatchHash $paths.transportScript;supervisor=Get-WatchHash $paths.repoTreeSupervisor}}
 $script:snapshotOverride=New-SupervisorDriftSnapshot -ExitCode 2
 $script:RequalifyDriftedAssets='backend,supervisor'
 $blocked=$false;$failure=$null;try{Install-WatchdogSafely $sourceTools|Out-Null}catch{$blocked=$true;$failure=$_.Exception.Message}
 Assert-Install ($blocked -and $failure -eq 'watchdog_install_requires_healthy_status' -and $script:taskWrites -eq 0) 'a supervisor failure with a non-1 exit code (not a pin-drift throw) must still require healthy status'

 Setup-Fixture 'requalify-supervisor-timeout-rejected'
 $paths=New-SupervisorFixtureRoots
 $script:driverBindingOverride=@{version=1;assetHashes=@{control=Get-WatchHash $script:ControlPath;worker=Get-WatchHash $script:WorkerPath;backend='f'*64;transport=Get-WatchHash $paths.transportScript;supervisor='e'*64}}
 $script:snapshotOverride=New-SupervisorDriftSnapshot -Code 'process_deadline_exhausted'
 $script:RequalifyDriftedAssets='backend,supervisor'
 $blocked=$false;$failure=$null;try{Install-WatchdogSafely $sourceTools|Out-Null}catch{$blocked=$true;$failure=$_.Exception.Message}
 Assert-Install ($blocked -and $failure -eq 'watchdog_install_requires_healthy_status' -and $script:taskWrites -eq 0) 'a supervisor-stage timeout (process_deadline_exhausted) must still require healthy status, not be treated as drift'

 Setup-Fixture 'requalify-supervisor-control-not-completed-rejected'
 $paths=New-SupervisorFixtureRoots
 $script:driverBindingOverride=@{version=1;assetHashes=@{control=Get-WatchHash $script:ControlPath;worker=Get-WatchHash $script:WorkerPath;backend='f'*64;transport=Get-WatchHash $paths.transportScript;supervisor='e'*64}}
 $script:snapshotOverride=New-SupervisorDriftSnapshot -ControlStatus 'failed'
 $script:RequalifyDriftedAssets='backend,supervisor'
 $blocked=$false;$failure=$null;try{Install-WatchdogSafely $sourceTools|Out-Null}catch{$blocked=$true;$failure=$_.Exception.Message}
 Assert-Install ($blocked -and $failure -eq 'watchdog_install_requires_healthy_status' -and $script:taskWrites -eq 0) 'supervisor failed without control having completed first must still require healthy status'

 # Path-consistency lock: the recompute must hash the installed driver's OWN literal path for
 # supervisor (the repo-tree copy), not this script's $SupervisorPath (the deployed copy under
 # $BackendRoot). The two fixture copies have deliberately different content with nothing
 # actually pinned to the deployed one, so a recompute that used $SupervisorPath would see a
 # mismatch against the repo-tree-pinned hash and misreport supervisor as drifted when it is
 # not -- silently narrowing the admitted set and rejecting a caller who correctly declared
 # only the one asset (backend) that really drifted.
 Setup-Fixture 'requalify-supervisor-path-must-match-driver-literal'
 $paths=New-SupervisorFixtureRoots
 Assert-Install ((Get-WatchHash $script:SupervisorPath) -cne (Get-WatchHash $paths.repoTreeSupervisor)) 'fixture setup bug: deployed and repo-tree supervisor copies must differ for this lock to mean anything'
 # supervisor is pinned to the repo-tree copy's CURRENT hash (matches what the driver really
 # compares, so supervisor has not drifted); backend is pinned to a foreign hash so it has.
 $script:driverBindingOverride=@{version=1;assetHashes=@{control=Get-WatchHash $script:ControlPath;worker=Get-WatchHash $script:WorkerPath;backend='f'*64;transport=Get-WatchHash $paths.transportScript;supervisor=Get-WatchHash $paths.repoTreeSupervisor}}
 $script:snapshotOverride=New-SupervisorDriftSnapshot
 $script:RequalifyDriftedAssets='backend'
 $result=$null;$failed=$false;try{$result=Install-WatchdogSafely $sourceTools}catch{$failed=$true}
 Assert-Install (-not $failed -and $result.status -eq 'installed') 'recompute must use the driver-literal (repo-tree) supervisor path: hashing $SupervisorPath instead would wrongly report supervisor as also drifted here'
 $script:driverBindingOverride=$null;$script:snapshotOverride=$null;$script:RequalifyDriftedAssets=''

 # Get-WatchInstalledDiagnosticSources itself: parses the exact literal shapes the real
 # generators write, and falls closed (no recompute) when the installed driver predates the
 # literal or cannot be read, instead of guessing a path.
 Setup-Fixture 'installed-diagnostic-sources-parses-real-literal'
 $paths=New-SupervisorFixtureRoots
 $ctx=Get-WatchInstallContext $sourceTools
 $parsed=Get-WatchInstalledDiagnosticSources $ctx
 Assert-Install ($parsed.control -ceq $script:ControlPath -and $parsed.worker -ceq $script:WorkerPath -and $parsed.backend -ceq $paths.backendScript -and $parsed.transport -ceq $paths.transportScript -and $parsed.supervisor -ceq $paths.repoTreeSupervisor) 'parsed sources did not match the literal written into the installed driver files'

 Setup-Fixture 'installed-diagnostic-sources-no-supervisor-literal'
 $script:ControlPath=Join-Path $WatchdogRoot 'fixture-control.ps1';[IO.File]::WriteAllText($script:ControlPath,'control v1')
 $script:WorkerPath=Join-Path $WatchdogRoot 'fixture-worker.ps1';[IO.File]::WriteAllText($script:WorkerPath,'worker v1')
 $script:BackendRoot=Join-Path $WatchdogRoot 'backend';New-Item -ItemType Directory -Path (Join-Path $script:BackendRoot 'app\tools') -Force|Out-Null
 $backendScript=Join-Path $script:BackendRoot 'app\tools\django-local-service.ps1';[IO.File]::WriteAllText($backendScript,'backend v1')
 $script:ProjectRoot=Join-Path $WatchdogRoot 'project';New-Item -ItemType Directory -Path (Join-Path $script:ProjectRoot 'tools') -Force|Out-Null
 $transportScript=Join-Path $script:ProjectRoot 'tools\process-deadline.ps1';[IO.File]::WriteAllText($transportScript,'transport v1')
 New-InstalledDiagnosticDriverFiles $script:ControlPath $script:WorkerPath $backendScript $transportScript
 $ctx=Get-WatchInstallContext $sourceTools
 $parsed=Get-WatchInstalledDiagnosticSources $ctx
 Assert-Install ($parsed -and -not $parsed.ContainsKey('supervisor')) 'a driver without the supervisor literal must parse without a supervisor key, not fabricate one'

 Setup-Fixture 'installed-diagnostic-sources-missing-driver-falls-closed'
 $ctx=Get-WatchInstallContext $sourceTools
 $parsed=Get-WatchInstalledDiagnosticSources $ctx
 Assert-Install ($null -eq $parsed) 'no installed driver files at all must return null, not a guessed source map'

 # Unusable installed driver: a driver that cannot parse blocks the install that would
 # replace it, so it is admitted without declared assets, but only when measured. A real
 # candidate carries its generated driver, so these cases mirror a bundle directory.
 $unusableSnapshot={@{healthy=$false;stages=@{control=@{status='failed';elapsedMs=1}};admission=@{mode='running'};diagnosticBinding=$null;processDiagnostic=@{code='probe_stage_failed';stage='control'}}}
 function New-CandidateWithDriver([string]$Body){
  $candidate=Join-Path $fixtureBase ('candidate-'+[guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path (Join-Path $candidate 'watchdog-launcher') -Force|Out-Null
  foreach($name in @('operations-system-watchdog.ps1','process-deadline.ps1','watchdog-install.ps1')){Copy-Item -LiteralPath (Join-Path $sourceTools $name) -Destination (Join-Path $candidate $name) -Force}
  Copy-Item -LiteralPath (Join-Path $sourceTools 'watchdog-launcher\NoConsoleLauncher.cs') -Destination (Join-Path $candidate 'watchdog-launcher\NoConsoleLauncher.cs') -Force
  # The driver is all-or-nothing: Get-WatchInstallContext accepts 0 or 4 of its files.
  [IO.File]::WriteAllText((Join-Path $candidate 'watchdog-status-control.ps1'),$Body)
  [IO.File]::WriteAllText((Join-Path $candidate 'watchdog-status-backend.ps1'),"'candidate backend'`n")
  [IO.File]::WriteAllText((Join-Path $candidate 'watchdog-core-overlay.ps1'),"'candidate overlay'`n")
  Write-WatchJson (Join-Path $candidate 'driver-binding.json') @{version=1;assetHashes=@{control='a'*64;worker='b'*64;backend='c'*64;transport='d'*64}}
  return $candidate
 }
 Setup-Fixture 'unusable-driver-repair'
 [IO.File]::WriteAllText((Join-Path $WatchdogRoot 'watchdog-status-control.ps1'),"@{ A = 1`n  A = 2 }`n")
 $candidate=New-CandidateWithDriver "'sound candidate driver'`n"
 $script:ApprovedInstallPlanId=(Get-WatchInstallContext $candidate).planId
 $script:snapshotOverride=&$unusableSnapshot;$script:RequalifyDriftedAssets=''
 $result=$null;$failed=$false;try{$result=Install-WatchdogSafely $candidate}catch{$failed=$true}
 Assert-Install (-not $failed -and $result.status -eq 'installed') 'an unparseable installed driver must admit the install that replaces it'

 Setup-Fixture 'unusable-driver-bad-candidate'
 [IO.File]::WriteAllText((Join-Path $WatchdogRoot 'watchdog-status-control.ps1'),"@{ A = 1`n  A = 2 }`n")
 $candidate=New-CandidateWithDriver "@{ B = 1`n  B = 2 }`n"
 $script:ApprovedInstallPlanId=(Get-WatchInstallContext $candidate).planId
 $script:snapshotOverride=&$unusableSnapshot;$script:RequalifyDriftedAssets=''
 $blocked=$false;$failure=$null;try{Install-WatchdogSafely $candidate|Out-Null}catch{$blocked=$true;$failure=$_.Exception.Message}
 Assert-Install ($blocked -and $failure -eq 'watchdog_candidate_driver_invalid' -and $script:taskWrites -eq 0) 'a candidate driver that also fails to parse must be refused'

 Setup-Fixture 'unusable-driver-sound-installed'
 [IO.File]::WriteAllText((Join-Path $WatchdogRoot 'watchdog-status-control.ps1'),"'sound driver'`n")
 $candidate=New-CandidateWithDriver "'sound candidate driver'`n"
 $script:ApprovedInstallPlanId=(Get-WatchInstallContext $candidate).planId
 $script:snapshotOverride=&$unusableSnapshot;$script:RequalifyDriftedAssets=''
 $blocked=$false;$failure=$null;try{Install-WatchdogSafely $candidate|Out-Null}catch{$blocked=$true;$failure=$_.Exception.Message}
 Assert-Install ($blocked -and $failure -eq 'watchdog_install_requires_healthy_status' -and $script:taskWrites -eq 0) 'a driver that parses must keep the ordinary healthy requirement'
 $script:snapshotOverride=$null

 Setup-Fixture 'requalify-healthy-no-param-needed';$script:RequalifyDriftedAssets=''
 $result=$null;$failed=$false;try{$result=Install-WatchdogSafely $sourceTools}catch{$failed=$true}
 Assert-Install (-not $failed -and $result.status -eq 'installed') 'a healthy snapshot must still install without needing the new parameter'

 @{passed=$script:checks;productionTouched=$false;actualScheduledTasksChanged=$false;actualMessagesSent=$false}|ConvertTo-Json -Compress
}finally{if([IO.Path]::GetFullPath($fixtureBase).StartsWith([IO.Path]::GetTempPath()) -and (Split-Path $fixtureBase -Leaf) -match '^watchdog-install-tests-[0-9a-f]{32}$'){Remove-Item -LiteralPath $fixtureBase -Recurse -Force}}
