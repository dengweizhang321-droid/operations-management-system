param([string]$ChildShell)
# Targeted check: the detached observer process that Start dispatches does not linger after it
# finishes, and the observation record file does not grow unboundedly (one file per attempt,
# repeated invocations for the same attempt do not add files). A real child process runs the
# original ObserveDingTalkStartup action in an isolated RuntimeRoot. No production paths, no
# messages, no production lifecycle. Comments stay ASCII so Windows PowerShell 5.1 parses the
# file identically with or without a BOM.
$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$ChildShell = (Get-Command $ChildShell -ErrorAction Stop).Source
$root = Join-Path ([IO.Path]::GetTempPath()) ('teruisi-start-observation-' + [guid]::NewGuid().ToString('N'))
$obsRoot = Join-Path $root 'observer'
$obsLogs = Join-Path $obsRoot 'logs'
[IO.Directory]::CreateDirectory($obsLogs) | Out-Null
$serviceScript = Join-Path $workspace 'tools/worker-local-service.ps1'
$script:checks = [Collections.Generic.List[string]]::new()
function Check($Condition, [string]$Message) { if (-not $Condition) { throw $Message }; $script:checks.Add($Message) }
function Start-ObserverChild([string]$ObservationId) {
  $psi = [Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = $ChildShell
  $psi.Arguments = '-NoProfile -NonInteractive -File "' + $serviceScript + '" -Action ObserveDingTalkStartup -StartupObservationId ' + $ObservationId + ' -RuntimeRoot "' + $obsRoot + '" -AllowTestRuntimeRoot -Json'
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true
  # The observer has its own lifetime; a completed Start budget is not inherited.
  $saved = $env:TERUISI_PROCESS_DEADLINE_UNIX_MS
  try { $env:TERUISI_PROCESS_DEADLINE_UNIX_MS = $null; return [Diagnostics.Process]::Start($psi) }
  finally { $env:TERUISI_PROCESS_DEADLINE_UNIX_MS = $saved }
}
$savedDeadline = $env:TERUISI_PROCESS_DEADLINE_UNIX_MS
try {
  $obsId = [guid]::NewGuid().ToString('N')
  $clock = [Diagnostics.Stopwatch]::StartNew()
  $observer = Start-ObserverChild $obsId
  $observerPid = $observer.Id
  $exited = $observer.WaitForExit(30000)
  $clock.Stop()
  $obsLifetimeMs = [int]$clock.ElapsedMilliseconds
  $obsExitedOnItsOwn = [bool]$exited
  $observer.StandardOutput.ReadToEnd() | Out-Null
  $observer.StandardError.ReadToEnd() | Out-Null
  Check ($exited -and $observer.HasExited) 'observer-child-exits-without-orphan'
  Check ([int]$observer.ExitCode -eq 1) 'observer-child-fails-closed-without-release'
  $observer.Dispose()
  $residual = $null
  try { $residual = Get-Process -Id $observerPid -ErrorAction Stop } catch { $residual = $null }
  Check ($null -eq $residual -or $residual.HasExited) 'observer-child-no-residual-process'
  # Lifecycle is recorded explicitly: transient by design, exits on its own, no silent orphan.
  Check (($obsExitedOnItsOwn -eq $true) -and ($obsLifetimeMs -ge 0) -and ($obsLifetimeMs -lt 30000)) 'observer-lifecycle-bounded'

  $recordPath = Join-Path $obsLogs ('dingtalk-startup-' + $obsId + '.json')
  Check ([IO.File]::Exists($recordPath)) 'observer-record-created'
  Check (@(Get-ChildItem -LiteralPath $obsLogs -Filter 'dingtalk-startup-*.json').Count -eq 1) 'observer-record-one-per-attempt'
  $recordBytes = [Convert]::ToBase64String([IO.File]::ReadAllBytes($recordPath))
  $record = [IO.File]::ReadAllText($recordPath) | ConvertFrom-Json
  Check ($record.observationId -eq $obsId -and $record.requiredForStart -eq $false) 'observer-record-identity'

  $repeat = Start-ObserverChild $obsId
  $repeatExited = $repeat.WaitForExit(30000)
  $repeat.Dispose()
  Check ($repeatExited) 'observer-repeat-child-exits'
  Check (@(Get-ChildItem -LiteralPath $obsLogs -Filter 'dingtalk-startup-*.json').Count -eq 1) 'observer-record-repeat-no-growth'
  Check ([Convert]::ToBase64String([IO.File]::ReadAllBytes($recordPath)) -ceq $recordBytes) 'observer-record-create-only-preserved'

  $secondId = [guid]::NewGuid().ToString('N')
  $second = Start-ObserverChild $secondId
  $secondExited = $second.WaitForExit(30000)
  $second.Dispose()
  Check ($secondExited) 'observer-second-child-exits'
  Check (@(Get-ChildItem -LiteralPath $obsLogs -Filter 'dingtalk-startup-*.json').Count -eq 2) 'observer-record-one-per-distinct-attempt'

  [Console]::Out.WriteLine((@{ passed = $true; checks = @($script:checks.ToArray()); observerLifetimeMilliseconds = $obsLifetimeMs; observerExitedOnItsOwn = $obsExitedOnItsOwn; observerDesignTransient = $true } | ConvertTo-Json -Compress -Depth 6))
} finally {
  $env:TERUISI_PROCESS_DEADLINE_UNIX_MS = $savedDeadline
}
