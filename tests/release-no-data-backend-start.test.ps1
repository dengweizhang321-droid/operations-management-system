param()
$ErrorActionPreference='Stop'
$worker=Join-Path $PSScriptRoot '..\tools\worker-local-service.ps1'
$adapter=Join-Path $PSScriptRoot '..\tools\release-lifecycle-step.ps1'
function Parse-Source([string]$Path) {
  $errors=$null
  $value=[Management.Automation.Language.Parser]::ParseFile($Path,[ref]$null,[ref]$errors)
  if($errors.Count) { throw "Original script parse failed: $Path" }
  return $value
}
$workerAst=Parse-Source $worker
foreach($name in @('Ensure-DjangoSystemReady','Invoke-WorkerSystemStart')) {
  $node=$workerAst.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true) | Select-Object -First 1
  if(-not $node) { throw "Missing original function $name" }
  . ([scriptblock]::Create($node.Extent.Text))
}
# Only the lowest external/state primitives are synthetic. Both original
# functions and the original top-level Start dispatch are executed unchanged.
$script:backendStarts=0;$script:workerStarts=0;$script:receiverStarts=0;$script:ready=$true;$script:maintenance=$false;$script:unknownOwner=$false;$script:alreadyRunning=$false
$Json=$true
function Test-IsIsolatedTestRuntime { return $false }
function Get-DjangoSystemReadiness { return [pscustomobject]@{Ready=$script:ready;Missing=@('synthetic-not-ready')} }
function Invoke-DjangoStartProcess { $script:backendStarts++;return @{ExitCode=0;StdoutTail='';StderrTail=''} }
function Write-WorkerStartupTiming {}
function Assert-WorkerMaintenanceInactive { if($script:maintenance) { throw 'synthetic retained maintenance' } }
function Get-WorkerStatusInternal { return @{State=$(if($script:unknownOwner){'foreign_process'}elseif($script:alreadyRunning){'exact_release'}else{'stopped'});Supervisor=@{ProcessId=123};Receipt=$null} }
function Invoke-ReleaseVerification { return @{supervisorPrelaunchReceiptSha256=('a'*64)} }
function Start-VerifiedWorkerSupervisor { $script:workerStarts++;return @{status='started'} }
function Start-SystemDingTalkReceiver { $script:receiverStarts++ }
function Write-Result {}
function Reject([scriptblock]$Action,[string]$Message) {
  try { & $Action;throw 'negative unexpectedly passed' } catch { if($_.Exception.Message -notmatch [regex]::Escape($Message)) { throw } }
}
Ensure-DjangoSystemReady -RequireReadyBackend
if($script:backendStarts -ne 0) { throw 'Ready guard started backend' }
$script:ready=$false
Reject { Ensure-DjangoSystemReady -RequireReadyBackend } 'backend startup is forbidden'
if($script:backendStarts -ne 0) { throw 'NotReady guard started backend' }
Ensure-DjangoSystemReady
if($script:backendStarts -ne 1) { throw 'Ordinary Start fallback changed' }
$script:backendStarts=0

$start=$workerAst.FindAll({param($n) $n -is [Management.Automation.Language.IfStatementAst] -and $n.Extent.Text.TrimStart().StartsWith('if ($Action -eq "Start")')},$true) | Select-Object -First 1
if(-not $start) { throw 'Missing original top-level Start branch' }
$body=$start.Clauses[0].Item2.Extent.Text.Trim();$body=$body.Substring(1,$body.Length-2) -replace '\bexit 0\b',''
$dispatch=[scriptblock]::Create($body)
$identity=@{};$JoinedConcurrentLifecycle=$false;$BackendStartPolicy='RequireReady'
Reject { & $dispatch } 'backend startup is forbidden'
if($script:backendStarts -ne 0 -or $script:workerStarts -ne 0 -or $script:receiverStarts -ne 0) { throw 'Guard rejection performed startup effects' }
$script:ready=$true
& $dispatch
if($script:backendStarts -ne 0 -or $script:workerStarts -ne 1 -or $script:receiverStarts -ne 0) { throw 'Ready guarded original dispatch changed backend or receiver' }
$script:alreadyRunning=$true
& $dispatch
if($script:backendStarts -ne 0 -or $script:workerStarts -ne 1 -or $script:receiverStarts -ne 0) { throw 'Already-running guarded dispatch changed backend or receiver' }
$script:alreadyRunning=$false
$script:ready=$false;$BackendStartPolicy='EnsureReady'
& $dispatch
if($script:backendStarts -ne 1 -or $script:workerStarts -ne 2 -or $script:receiverStarts -ne 1) { throw 'Ordinary original dispatch did not retain backend/receiver fallback' }
$script:ready=$true;$script:alreadyRunning=$true
& $dispatch
if($script:backendStarts -ne 1 -or $script:workerStarts -ne 2 -or $script:receiverStarts -ne 2) { throw 'Ordinary already-running dispatch did not retain receiver fallback' }
$script:alreadyRunning=$false
$script:backendStarts=0;$script:workerStarts=0;$BackendStartPolicy='RequireReady';$script:maintenance=$true
Reject { & $dispatch } 'retained maintenance'
$script:maintenance=$false;$script:unknownOwner=$true
Reject { & $dispatch } 'refusing takeover'
if($script:backendStarts -ne 0 -or $script:workerStarts -ne 0) { throw 'Owner/maintenance rejection performed startup effects' }
# Execute real script entry for invalid action. This guard precedes imports,
# runtime initialization and mutex acquisition, so no production path executes.
Reject { & $worker -Action Status -BackendStartPolicy RequireReady } 'restricted to Start'

$adapterAst=Parse-Source $adapter
$switch=$adapterAst.FindAll({param($n) $n -is [Management.Automation.Language.SwitchStatementAst]},$true) | Select-Object -First 1
$clause=$switch.Clauses | Where-Object { $_.Item1.Extent.Text -eq "'StartWorker'" } | Select-Object -First 1
if(-not $clause) { throw 'Missing original adapter StartWorker branch' }
$adapterBody=$clause.Item2.Extent.Text.Trim();$adapterBody=$adapterBody.Substring(1,$adapterBody.Length-2)
$adapterStart=[scriptblock]::Create($adapterBody)
$ExpectedWorkerManifestSha256='a'*64;$ExpectedDjangoManifestSha256='b'*64;$MaintenanceId='c'*32
$deployment='synthetic-deployment';$operationDeadline=@{}
function Get-FileHash { return @{Hash=$ExpectedDjangoManifestSha256} }
function Get-ProcessRemaining { return 10000 }
function Invoke-OriginalEngine([string]$Script,[string[]]$Arguments) { $script:observedArguments=$Arguments;throw 'captured exact Start invocation' }
foreach($ExpectedDrainId in @(('c'*32),'')) {
  Reject { & $adapterStart } 'captured exact Start invocation'
  $expected=@('-Action','Start','-Json');if($ExpectedDrainId){$expected+=@('-BackendStartPolicy','RequireReady')}
  if(($script:observedArguments -join '|') -cne ($expected -join '|')) { throw 'Adapter did not propagate exact ready-backend guard scope' }
}
# Run the original adapter's process wrapper and real process transport. The
# private child contains the actual original parameter block, then only emits
# bound values; none of the production controller body is run in this child.
. (Join-Path $PSScriptRoot '..\tools\process-deadline.ps1')
$originalInvoke=$adapterAst.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Invoke-OriginalEngine'},$true) | Select-Object -First 1
. ([scriptblock]::Create($originalInvoke.Extent.Text))
$nativeShell=(Get-Process -Id $PID).Path
$engineEvidence=[Collections.Generic.List[object]]::new()
$operationDeadline=Get-ProcessDeadline 30000
$scratch=Join-Path ([IO.Path]::GetTempPath()) ('teruisi-no-data-start-transport-'+[guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($scratch) | Out-Null
$child=Join-Path $scratch 'parameters.ps1'
try {
  [IO.File]::WriteAllText($child,$workerAst.ParamBlock.Extent.Text+"`r`n"+'[ordered]@{policy=$BackendStartPolicy;action=$Action} | ConvertTo-Json -Compress',[Text.UTF8Encoding]::new($true))
  $received=Invoke-OriginalEngine $child @('-Action','Start','-Json','-BackendStartPolicy','RequireReady') | ConvertFrom-Json
  if($received.policy -cne 'RequireReady' -or $received.action -cne 'Start') { throw 'Native original transport lost guarded Start policy' }
} finally {
  [IO.File]::Delete($child)
  [IO.Directory]::Delete($scratch)
}
Write-Output 'PASS: original Ready/NotReady fallback, fresh/existing receiver suppression, top-level Start, owner/maintenance, action restriction, drain adapter and native typed transport'
