param([string]$ChildShell)
$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$ChildShell = (Get-Command $ChildShell -ErrorAction Stop).Source
$root = Join-Path ([IO.Path]::GetTempPath()) ('teruisi-start-timing-' + [guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($root) | Out-Null
[IO.Directory]::CreateDirectory((Join-Path $root 'logs')) | Out-Null
. (Join-Path $workspace 'tools/worker-local-service.ps1') -FunctionsOnly -AllowTestRuntimeRoot -RuntimeRoot $root -Action Start -Json
$script:checks = [Collections.Generic.List[string]]::new()
function Check($Condition, [string]$Message) { if (-not $Condition) { throw $Message }; $script:checks.Add($Message) }
$savedDeadline = $env:TERUISI_PROCESS_DEADLINE_UNIX_MS
$historicalFiles=@('STARTED.json','FAILED.json')
foreach($file in $historicalFiles){[IO.File]::WriteAllText((Join-Path $root $file),('{"privateFixture":true,"original":"'+$file+'"}'))}
$historicalContents=@{}
foreach($file in $historicalFiles){$historicalContents[$file]=[Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $root $file)))}
try {
  $WorkerOperationDeadline = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + 30000
  $outer = $WorkerOperationDeadline
  $defaults = @{DjangoEnsure=400000;ReleaseVerification=220000;SupervisorStart=90000;DingTalkReceiver=180000}
  foreach ($phase in $defaults.Keys) {
    Check ((Get-WorkerStartBudgetMilliseconds $phase) -eq $defaults[$phase]) "default:$phase"
    $key = 'TERUISI_START_' + $phase.ToUpperInvariant() + '_SECONDS'
    [Environment]::SetEnvironmentVariable($key, '1')
    $caught = $null
    try {
      Invoke-WorkerStartPhase $phase {
        Invoke-DeadlineProcess -Executable $ChildShell -Arguments @('-NoProfile','-NonInteractive','-Command','Start-Sleep -Seconds 5') -WorkingDirectory $root -Deadline $WorkerOperationDeadline -Cleanup Direct | Out-Null
      }
    } catch { $caught = $_ }
    $row = $script:WorkerStartPhases[$phase]
    if ($row.outcome -ne 'timed_out') { throw ('unexpected-phase:' + $caught.Exception.Message + ' ' + ($row|ConvertTo-Json -Compress -Depth 5)) }
    Check ($caught -and $row.outcome -eq 'timed_out' -and $row.code -eq ($phase + '_timeout')) "timeout:$phase"
    Check ($row.processEvidence.timeoutType -eq 'direct-exit' -and $row.processEvidence.exitCode -eq $null) "original-unknown:$phase"
    Check ($WorkerOperationDeadline -eq $outer -and $env:TERUISI_PROCESS_DEADLINE_UNIX_MS -ceq $savedDeadline) "scope-restored:$phase"
    [Environment]::SetEnvironmentVariable($key, $null)
  }
  # A sibling gets a fresh budget, not the exhausted budget of a previous phase.
  $WorkerOperationDeadline = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + 30000
  Invoke-WorkerStartPhase 'ReleaseVerification' { Check ((Get-ProcessRemaining $WorkerOperationDeadline) -gt 20000) 'fresh-sibling-budget' }
  $WorkerOperationDeadline = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + 50
  $caught = $false
  try { Invoke-WorkerStartPhase 'DjangoEnsure' { Start-Sleep -Milliseconds 80 } } catch { $caught = $true }
  Check ($caught -and $script:WorkerStartPhases.DjangoEnsure.outcome -eq 'timed_out') 'explicit-parent-deadline-retained'
  $WorkerOperationDeadline = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + 30000
  $bad = $null
  try {
    Invoke-WorkerStartPhase 'DjangoEnsure' {
      $capture = Invoke-DeadlineProcess -Executable $ChildShell -Arguments @('-NoProfile','-Command','exit 37') -WorkingDirectory $root -Deadline $WorkerOperationDeadline
      Throw-WorkerProcessFailure $capture.Evidence
    }
  } catch { $bad = $_ }
  Check ($bad.Exception.Data['ProcessEvidence'].exitCode -eq 37 -and $script:WorkerStartPhases.DjangoEnsure.outcome -eq 'failed') 'original-nonzero-exit-preserved'

  function Assert-WorkerMaintenanceInactive { if ($script:maintenance) { throw 'maintenance-active' } }
  function Get-WorkerStatusInternal { @{State=$script:state;Supervisor=@{ProcessId=42}} }
  function Ensure-DjangoSystemReady { if ($script:backendFailure) { throw 'backend-failed' } }
  function Invoke-ReleaseVerification { @{supervisorPrelaunchReceiptSha256=('a'*64)} }
  function Start-VerifiedWorkerSupervisor { @{status='started'} }
  function Write-WorkerStartupTiming {}
  $identity = @{Path=(Join-Path $root 'manifest.json');ReleaseId='private';Sha256=('a'*64)}
  # Run the real dispatcher with only native launch/config seams replaced.
  function Test-IsIsolatedTestRuntime { $false }
  function Test-Path { param($LiteralPath); if ($LiteralPath -like '*config\dingtalk-startup.json') { return $true }; Microsoft.PowerShell.Management\Test-Path -LiteralPath $LiteralPath }
  function Get-DjangoControlPowerShell { $ChildShell }
  $script:dispatchArgs = $null
  $script:delayedChild = $null
  function Start-Process {
    param($FilePath,$ArgumentList,$WorkingDirectory,$WindowStyle,$RedirectStandardOutput,$RedirectStandardError,[switch]$PassThru)
    $script:dispatchArgs = @($ArgumentList)
    Check ($WindowStyle -eq 'Hidden' -and -not $env:TERUISI_PROCESS_DEADLINE_UNIX_MS) 'observer-hidden-independent-deadline'
    $script:delayedChild = [Teruisi.DeadlineProcess]::Start($ChildShell, '-NoProfile -NonInteractive -Command "Start-Sleep -Seconds 3"', $root, (Join-Path $root 'child.out'), (Join-Path $root 'child.err'))
    return $script:delayedChild
  }
  $script:state='stopped';$script:backendFailure=$false;$script:maintenance=$false
  $watch=[Diagnostics.Stopwatch]::StartNew()
  $result=Invoke-WorkerSystemStart $identity
  Check ($result.status -eq 'started' -and $result.startCompletedAt -and $result.dingTalk.status -eq 'observing') 'start-completed-before-receiver'
  Check (-not $script:delayedChild.HasExited -and $watch.ElapsedMilliseconds -lt 2500) 'delayed-receiver-does-not-block-direct-start'
  Check ($script:dispatchArgs -contains 'ObserveDingTalkStartup' -and $script:dispatchArgs -contains ('"'+$identity.Path+'"')) 'observer-bound-manifest'
  $script:dispatchArgs=$null
  $guarded=Invoke-WorkerSystemStart $identity -RequireReadyBackend
  Check ($guarded.dingTalk.status -eq 'preserved' -and $null -eq $script:dispatchArgs) 'worker-only-preserves-receiver'
  $script:maintenance=$true;$rejected=$false
  try { Invoke-WorkerSystemStart $identity | Out-Null } catch { $rejected=$_.Exception.Message -eq 'maintenance-active' }
  Check $rejected 'maintenance-still-blocks-start'
  $script:maintenance=$false;$script:backendFailure=$true;$rejected=$false
  try { Invoke-WorkerSystemStart $identity | Out-Null } catch { $rejected=$_.Exception.Message -eq 'backend-failed' }
  Check ($rejected -and $script:WorkerStartPhases.DjangoEnsure.outcome -eq 'failed') 'backend-failure-still-blocks-start'
  $script:backendFailure=$false
  $script:state='exact_release'
  function Read-WorkerAutomationDrain { return $script:drain }
  function Enter-WorkerServiceMutex { @{Mutex=[Threading.Mutex]::new($true)} }
  $script:statusCalls=0
  function Invoke-DjangoStatusJson {
    $script:statusCalls++
    return @{DingTalkStartup='enabled';DingTalkReceiver='running';DingTalkScheduler='running';DingTalkConnection=$(if($script:statusCalls -eq 1){'starting'}else{'connected'})}
  }
  $script:receiverMode='ready'
  function Start-SystemDingTalkReceiver {
    switch ($script:receiverMode) {
      'ready' { return @{status='ready'} }
      'disabled' { return @{status='disabled'} }
      'timeout' { throw 'process_deadline_exhausted' }
      'failed' { throw 'receiver-failed' }
    }
  }
  foreach ($mode in @('ready','disabled','timeout','failed')) {
    $StartupObservationId=[guid]::NewGuid().ToString('N');$script:receiverMode=$mode
    $observation=Invoke-IndependentDingTalkObservation $identity
    $expected=if($mode -eq 'timeout'){'timed_out'}else{$mode}
    $record=[IO.File]::ReadAllText((Join-Path $root "logs\dingtalk-startup-$StartupObservationId.json"))|ConvertFrom-Json
    Check ($record.status -eq $expected -and $record.requiredForStart -eq $false -and $record.manifestSha256 -eq $identity.Sha256) "independent-result:$mode"
    Check ($result.status -eq 'started') "receiver-cannot-rewrite-start:$mode"
    if($mode -eq 'ready'){Check ($script:statusCalls -ge 2 -and $record.readiness.DingTalkConnection -eq 'connected') 'native-status-observes-delayed-connection'}
  }
  $script:drain=@{id='private-drain'};$StartupObservationId=[guid]::NewGuid().ToString('N')
  function Start-SystemDingTalkReceiver { throw 'must-not-dispatch-during-drain' }
  $drained=Invoke-IndependentDingTalkObservation $identity
  Check ($drained.status -eq 'deferred_drain') 'observer-rechecks-drain-after-lock'

  # Exercise real native output classification at the lowest transport seam.
  Remove-Item Function:Start-SystemDingTalkReceiver
  $ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $workspace 'tools/worker-local-service.ps1'),[ref]$null,[ref]$null)
  $node=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Start-SystemDingTalkReceiver'},$true)
  . ([scriptblock]::Create($node.Extent.Text))
  function Test-Path { $true }
  function Assert-NoReparsePath {}
  function Invoke-WebRequest { @{StatusCode=200} }
  $script:nativeText='DingTalk automatic startup is disabled.'
  $script:nativeExit=0
  function Invoke-DeadlineProcess { @{ExitCode=$script:nativeExit;Stdout=$script:nativeText;Evidence=@{code='completed';exitCode=$script:nativeExit}} }
  foreach($mode in @('disabled','started','already_running')) {
    $script:nativeText=if($mode -eq 'disabled'){'DingTalk automatic startup is disabled.'}else{'django-ai-dingtalk '+$mode}
    $native=Start-SystemDingTalkReceiver
    $expected=if($mode -eq 'disabled'){'disabled'}else{'native_completed'}
    Check ($native.status -eq $expected) "native-output-classification:$mode"
  }
  $script:nativeExit=37;$nativeError=$null
  try { Start-SystemDingTalkReceiver | Out-Null } catch { $nativeError=$_ }
  Check ($nativeError.Exception.Data['ProcessEvidence'].exitCode -eq 37) 'receiver-native-nonzero-evidence-preserved'
  foreach($file in $historicalFiles){Check ([Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $root $file))) -ceq $historicalContents[$file]) "historical-receipt-unchanged:$file"}
  [Console]::Out.WriteLine((@{passed=$true;checks=@($script:checks.ToArray())}|ConvertTo-Json -Compress))
} finally {
  if ($script:delayedChild) { $script:delayedChild.Kill(); $script:delayedChild.Dispose() }
  $env:TERUISI_PROCESS_DEADLINE_UNIX_MS=$savedDeadline
  foreach($phase in $defaults.Keys){[Environment]::SetEnvironmentVariable(('TERUISI_START_'+$phase.ToUpperInvariant()+'_SECONDS'),$null)}
  # Private fixture files are retained for bounded evidence; no service cleanup.
}
