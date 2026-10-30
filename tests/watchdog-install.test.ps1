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
 if($script:driverBindingOverride -and [IO.Path]::GetFullPath($Path) -ieq [IO.Path]::GetFullPath((Join-Path $sourceTools 'driver-binding.json'))){return $script:driverBindingOverride}
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
 $script:driverBindingOverride=@{version=1;assetHashes=@{control=Get-WatchHash $script:ControlPath;worker='f'*64;backend=Get-WatchHash $backendScript;transport=Get-WatchHash $transportScript}}
 $script:snapshotOverride=@{healthy=$false;stages=@{control=@{status='failed';elapsedMs=1}};admission=@{mode='running'};diagnosticBinding=$null;processDiagnostic=@{code='probe_stage_failed';stage='control'}}
 $script:RequalifyDriftedAssets='control,worker'
 $blocked=$false;$failure=$null;try{Install-WatchdogSafely $sourceTools|Out-Null}catch{$blocked=$true;$failure=$_.Exception.Message}
 Assert-Install ($blocked -and $failure -eq 'watchdog_requalify_asset_mismatch') 'recomputed drift (only worker) must reject an over-broad declared set'
 $script:driverBindingOverride=$null;$script:snapshotOverride=$null;$script:RequalifyDriftedAssets=''

 Setup-Fixture 'requalify-healthy-no-param-needed';$script:RequalifyDriftedAssets=''
 $result=$null;$failed=$false;try{$result=Install-WatchdogSafely $sourceTools}catch{$failed=$true}
 Assert-Install (-not $failed -and $result.status -eq 'installed') 'a healthy snapshot must still install without needing the new parameter'

 @{passed=$script:checks;productionTouched=$false;actualScheduledTasksChanged=$false;actualMessagesSent=$false}|ConvertTo-Json -Compress
}finally{if([IO.Path]::GetFullPath($fixtureBase).StartsWith([IO.Path]::GetTempPath()) -and (Split-Path $fixtureBase -Leaf) -match '^watchdog-install-tests-[0-9a-f]{32}$'){Remove-Item -LiteralPath $fixtureBase -Recurse -Force}}
