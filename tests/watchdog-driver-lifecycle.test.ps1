$ErrorActionPreference='Stop'
# Driver lifecycle against a temporary fake root. Sources are copies of this worktree's own tools,
# the watchdog root is a temp directory, and nothing under D:\teruisi-runtime is read or written.
. (Join-Path $PSScriptRoot '..\tools\operations-system-watchdog.ps1') -FunctionsOnly
$base=Join-Path ([IO.Path]::GetTempPath()) ('watchdog-driver-lifecycle-'+[guid]::NewGuid().ToString('N'))
$tools=Join-Path $PSScriptRoot '..\tools'
$script:checks=0
function Assert-Lifecycle($Condition,[string]$Message){if(-not $Condition){throw $Message};$script:checks++}
$nodeExe='C:\Program Files\nodejs\node.exe'
if(-not(Test-Path -LiteralPath $nodeExe)){throw 'node is required for this test'}
$script:WatchNodePathOverride=$nodeExe
$WatchdogRoot=Join-Path $base 'root';$StatePath=Join-Path $WatchdogRoot 'state.json'
function Assert-WatchContainedDirectory([string]$Root,[string]$Directory){
  $r=[IO.Path]::GetFullPath($Root).TrimEnd('\');$d=[IO.Path]::GetFullPath($Directory).TrimEnd('\')
  if(-not($d -ieq $r -or $d.StartsWith($r+'\',[StringComparison]::OrdinalIgnoreCase))){throw 'path_escapes_root'}
  if(-not ($d.StartsWith($base+'\',[StringComparison]::OrdinalIgnoreCase))){throw 'test escaped fixture root'}
}
$srcDir=Join-Path $base 'sources'
function Reset-Sources {
  Remove-Item -LiteralPath $srcDir -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Path $srcDir -Force|Out-Null
  $map=@{control='operations-system-control.ps1';worker='worker-local-service.ps1';transport='process-deadline.ps1';isolation='native-isolation.ps1';backendIsolation='native-isolation.ps1';backend='django-local-service.ps1';supervisor='django-runtime-supervisor.ps1'}
  foreach($k in $map.Keys){Copy-Item -LiteralPath (Join-Path $tools $map[$k]) -Destination (Join-Path $srcDir ($k+'.ps1')) -Force}
}
function Get-WatchDriverSources {
  $o=[ordered]@{};foreach($k in 'control','worker','transport','isolation','backendIsolation','backend','supervisor'){$o[$k]=Join-Path $srcDir ($k+'.ps1')};$o
}
function Get-Failure([scriptblock]$Block){try{& $Block|Out-Null;return $null}catch{return $_.Exception}}
try {
  New-Item -ItemType Directory -Path $WatchdogRoot -Force|Out-Null
  Reset-Sources

  # 1. Generation, then reuse.
  $first=Invoke-WatchDriverEnsure
  Assert-Lifecycle ($first.regenerated -and (Test-Path -LiteralPath (Join-Path $first.directory 'watchdog-status-control.ps1'))) 'first ensure did not generate a driver'
  Assert-Lifecycle ((Split-Path -Leaf $first.directory) -ceq $first.digest) 'driver directory is not content addressed'
  Assert-Lifecycle (@(Get-ChildItem -LiteralPath (Join-Path $WatchdogRoot 'drivers') -Force|Where-Object {$_.Name -like '.staging-*'}).Count -eq 0) 'staging was left behind'
  $second=Invoke-WatchDriverEnsure
  Assert-Lifecycle (-not $second.regenerated -and $second.digest -ceq $first.digest) 'an unchanged source set was regenerated'

  # 2. A harmless source change gives a NEW driver, and the old one is kept.
  Add-Content -LiteralPath (Join-Path $srcDir 'worker.ps1') -Value "`r`n# harmless drift"
  $third=Invoke-WatchDriverEnsure
  Assert-Lifecycle ($third.regenerated -and $third.digest -cne $first.digest -and (Test-Path -LiteralPath $first.directory)) 'drift did not produce a second driver beside the first'

  # 3. A structural change is rejected, the rejection is cached, and a cached rejection never runs node.
  Set-Content -LiteralPath (Join-Path $srcDir 'control.ps1') -Value 'Write-Output 1' -Encoding UTF8
  $rej=Get-Failure {Invoke-WatchDriverEnsure}
  Assert-Lifecycle ($rej -and $rej.Message -ceq 'diagnostic_regeneration_rejected') 'a structural change was not rejected'
  Assert-Lifecycle ($rej.Data['DiagnosticBinding'].reason -cin $WatchDriverRejectionReasons) 'rejection reason is not a fixed enum'
  Assert-Lifecycle (@(Get-ChildItem -LiteralPath (Join-Path $WatchdogRoot 'drivers') -File -Filter 'rejected-*.json').Count -eq 1) 'rejection was not cached'
  $script:WatchNodePathOverride='C:\nonexistent\node.exe'
  $again=Get-Failure {Invoke-WatchDriverEnsure}
  Assert-Lifecycle ($again.Message -ceq 'diagnostic_regeneration_rejected') 'a cached rejection reached the generator'
  $script:WatchNodePathOverride=$nodeExe

  # 4. Restoring the sources finds the original driver again; no cleanup step is needed.
  Reset-Sources
  $restored=Invoke-WatchDriverEnsure
  Assert-Lifecycle ($restored.digest -ceq $first.digest -and -not $restored.regenerated) 'restored sources did not return to the first driver'

  # 5. Transient failure (no node) is reported as unavailable and is NOT cached.
  Add-Content -LiteralPath (Join-Path $srcDir 'backend.ps1') -Value "`r`n# another harmless drift"
  $script:WatchNodePathOverride='C:\nonexistent\node.exe'
  $before=@(Get-ChildItem -LiteralPath (Join-Path $WatchdogRoot 'drivers') -File -Filter 'rejected-*.json').Count
  $noNode=Get-Failure {Invoke-WatchDriverEnsure}
  Assert-Lifecycle ($noNode.Message -ceq 'diagnostic_generator_unavailable') 'a missing node was not reported as unavailable'
  Assert-Lifecycle (@(Get-ChildItem -LiteralPath (Join-Path $WatchdogRoot 'drivers') -File -Filter 'rejected-*.json').Count -eq $before) 'a transient failure was cached as a rejection'
  $script:WatchNodePathOverride=$nodeExe

  # 6. A damaged existing driver is reported, never repaired or deleted.
  $good=Invoke-WatchDriverEnsure
  Add-Content -LiteralPath (Join-Path $good.directory 'watchdog-status-control.ps1') -Value '# tampered'
  $bad=Get-Failure {Invoke-WatchDriverEnsure}
  Assert-Lifecycle ($bad.Message -ceq 'invalid_diagnostic_bundle') 'a tampered driver was accepted'
  Assert-Lifecycle (Test-Path -LiteralPath $good.directory) 'a damaged driver was deleted instead of reported'

  # 6b. A source that changes WHILE the generator runs: retryable diagnostic_sources_changing, nothing published, nothing cached.
  $script:origDeadline=${function:Invoke-DeadlineProcess}
  $script:mutateDuringGeneration=$null
  function Invoke-DeadlineProcess([string]$Executable,$Arguments,[string]$WorkingDirectory,$Deadline,[string]$Cleanup){
    $result=& $script:origDeadline @PSBoundParameters
    if($script:mutateDuringGeneration){& $script:mutateDuringGeneration;$script:mutateDuringGeneration=$null}
    $result
  }
  $driversDir=Join-Path $WatchdogRoot 'drivers'
  $countDrivers={@(Get-ChildItem -LiteralPath $driversDir -Directory -Force|Where-Object {$_.Name -match '^[0-9a-f]{64}$'}).Count}
  $countRejected={@(Get-ChildItem -LiteralPath $driversDir -File -Filter 'rejected-*.json').Count}

  # 6b-i. Valid sources, changed during generation (production-file recheck after generation).
  Reset-Sources
  Add-Content -LiteralPath (Join-Path $srcDir 'worker.ps1') -Value "`r`n# drift before generation 6b-i"
  $driversBefore=& $countDrivers;$rejectedBefore=& $countRejected
  $script:mutateDuringGeneration={Add-Content -LiteralPath (Join-Path $srcDir 'backend.ps1') -Value "`r`n# changed during generation"}
  $changing=Get-Failure {Invoke-WatchDriverEnsure}
  Assert-Lifecycle ($changing -and $changing.Message -ceq 'diagnostic_sources_changing') 'a source changed during generation was not reported as diagnostic_sources_changing'
  Assert-Lifecycle ((& $countDrivers) -eq $driversBefore) 'a driver was published from sources that changed during generation'
  Assert-Lifecycle ((& $countRejected) -eq $rejectedBefore) 'a changing source wrote a rejection cache'

  # 6b-ii. Structurally rejected sources that ALSO changed during generation: not cached (the verdict is on stale bytes).
  Reset-Sources
  Set-Content -LiteralPath (Join-Path $srcDir 'control.ps1') -Value 'Write-Output 2' -Encoding UTF8
  $rejectedBefore=& $countRejected
  $script:mutateDuringGeneration={Add-Content -LiteralPath (Join-Path $srcDir 'worker.ps1') -Value "`r`n# changed during rejected generation"}
  $staleReject=Get-Failure {Invoke-WatchDriverEnsure}
  Assert-Lifecycle ($staleReject -and $staleReject.Message -ceq 'diagnostic_sources_changing') 'a rejection on sources that moved was not downgraded to diagnostic_sources_changing'
  Assert-Lifecycle ((& $countRejected) -eq $rejectedBefore) 'a rejection of stale bytes was cached'

  # 6b-iii. The same rejection with stable sources IS cached.
  Reset-Sources
  Set-Content -LiteralPath (Join-Path $srcDir 'control.ps1') -Value 'Write-Output 3' -Encoding UTF8
  $stableReject=Get-Failure {Invoke-WatchDriverEnsure}
  Assert-Lifecycle ($stableReject -and $stableReject.Message -ceq 'diagnostic_regeneration_rejected' -and (& $countRejected) -eq ($rejectedBefore+1)) 'a rejection on stable sources was not cached'
  Reset-Sources

  # 7. Containment: every path the lifecycle touched is inside the fake root.
  $escaped=@(Get-ChildItem -LiteralPath $base -Force|Where-Object {$_.Name -notin @('root','sources')})
  Assert-Lifecycle ($escaped.Count -eq 0) 'something was written beside the fake root'

  [pscustomobject]@{passed=$script:checks;productionTouched=$false}|ConvertTo-Json -Compress
} finally {
  if($base -and (Test-Path -LiteralPath $base)){[IO.Directory]::Delete($base,$true)}
}
