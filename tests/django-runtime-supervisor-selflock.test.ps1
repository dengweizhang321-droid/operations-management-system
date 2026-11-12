[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
# Regression test for the supervisor self-lock: a state.json written by an
# earlier script generation (different supervisorScriptSha256) used to make
# Read-SupervisorState throw on every start, and the catch block in
# Invoke-SupervisorRun called the same function again, so the process died
# without any visible trace.
#
# Everything here runs against a disposable fixture runtime root under TEMP.
# Nothing touches the real runtime root, no service action runs, no process is
# started or stopped, and the Run loop never sleeps (Start-Sleep is overridden
# with a throw so a regression cannot spin forever).
$script:checks = 0
function Assert-SelfLock($Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
  $script:checks++
}

$toolsRoot = Join-Path $PSScriptRoot '..\tools'
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) (
  'teruisi-supervisor-selflock-' + [Guid]::NewGuid().ToString('N')
)
try {
  $fixtureTools = Join-Path $fixtureRoot 'app\tools'
  New-Item -ItemType Directory -Path $fixtureTools -Force | Out-Null
  foreach ($name in @('django-runtime-supervisor.ps1', 'django-local-service.ps1', 'native-isolation.ps1')) {
    Copy-Item -LiteralPath (Join-Path $toolsRoot $name) -Destination (Join-Path $fixtureTools $name)
  }
  $fixtureSupervisor = Join-Path $fixtureTools 'django-runtime-supervisor.ps1'
  # Keep the BOM: Windows PowerShell 5.1 reads a BOM-less file as the ANSI code page.
  $content = [IO.File]::ReadAllText($fixtureSupervisor, [Text.Encoding]::UTF8)
  $content = $content.Replace('D:\teruisi-runtime\django-sales', $fixtureRoot)
  [IO.File]::WriteAllText($fixtureSupervisor, $content, [Text.UTF8Encoding]::new($true))

  $env:TERUISI_DJANGO_SUPERVISOR_LIBRARY_ONLY = '1'
  try {
    . $fixtureSupervisor -Action Run -RuntimeRoot $fixtureRoot -Execute
  } finally {
    Remove-Item Env:\TERUISI_DJANGO_SUPERVISOR_LIBRARY_ONLY -ErrorAction SilentlyContinue
  }
  Assert-SelfLock ($SupervisorStatePath.StartsWith($fixtureRoot, [StringComparison]::OrdinalIgnoreCase)) 'state path must be inside the fixture root'

  $currentSha = Get-FileSha256 $SupervisorScriptPath
  $oldSha = 'b' * 64
  $utf8 = [Text.UTF8Encoding]::new($false)

  function Reset-Monitor {
    New-Item -ItemType Directory -Path $SupervisorMonitorDirectory -Force | Out-Null
    Get-ChildItem -LiteralPath $SupervisorMonitorDirectory -Force | Remove-Item -Recurse -Force
  }
  function Write-FixtureState([hashtable]$Override = @{}, [string]$Digest = $oldSha) {
    $s = New-SupervisorState
    $s.supervisorScriptSha256 = $Digest
    foreach ($key in $Override.Keys) { $s.$key = $Override[$key] }
    [IO.File]::WriteAllText($SupervisorStatePath, ($s | ConvertTo-Json -Depth 8), $utf8)
  }
  $stopped = @{ desiredState = 'stopped'; health = 'stopped'; code = 'desired_state_stopped'; recoverable = $false }
  function Get-MonitorFingerprint {
    @(Get-ChildItem -LiteralPath $SupervisorMonitorDirectory -File -Recurse | Sort-Object FullName |
      ForEach-Object { $_.Name + ':' + (Get-FileSha256 $_.FullName) }) -join '|'
  }
  function Assert-Throws([scriptblock]$Block, [string]$Message) {
    $threw = $false
    try { & $Block | Out-Null } catch { $threw = $true }
    Assert-SelfLock $threw $Message
  }

  # --- 1. Run path: clean-stopped previous generation is archived and replaced.
  Reset-Monitor
  Write-FixtureState $stopped
  $originalBytes = [IO.File]::ReadAllBytes($SupervisorStatePath)
  $fresh = Read-SupervisorState 'ArchivePreviousStopped'
  Assert-SelfLock ($fresh.code -ceq 'not_probed' -and $fresh.supervisorScriptSha256 -ceq $currentSha) 'archive mode must start from a fresh state bound to the current script'
  Assert-SelfLock (-not (Test-Path -LiteralPath $SupervisorStatePath)) 'archive mode must move the old state.json away'
  $archive = Join-Path $SupervisorMonitorDirectory "state.previous-$oldSha.json"
  Assert-SelfLock (Test-Path -LiteralPath $archive -PathType Leaf) 'archive must be named state.previous-<old digest>.json'
  Assert-SelfLock ([Convert]::ToBase64String([IO.File]::ReadAllBytes($archive)) -ceq [Convert]::ToBase64String($originalBytes)) 'archive must keep every byte of the old state'

  # --- 2. Archive target already exists: never overwritten, next free number used.
  Write-FixtureState $stopped
  Read-SupervisorState 'ArchivePreviousStopped' | Out-Null
  Assert-SelfLock ([Convert]::ToBase64String([IO.File]::ReadAllBytes($archive)) -ceq [Convert]::ToBase64String($originalBytes)) 'an existing archive must not be overwritten'
  Assert-SelfLock (Test-Path -LiteralPath (Join-Path $SupervisorMonitorDirectory "state.previous-$oldSha.1.json") -PathType Leaf) 'a colliding archive must use the first free numeric suffix'

  # --- 3. Read-only path: no archive, no write, no error; state shown as-is.
  Reset-Monitor
  Write-FixtureState $stopped
  $before = Get-MonitorFingerprint
  $allowed = Read-SupervisorState 'AllowPreviousStopped'
  Assert-SelfLock ($allowed.code -ceq 'desired_state_stopped' -and $allowed.supervisorScriptSha256 -ceq $oldSha) 'read-only mode must show the previous generation state unchanged'
  Assert-SelfLock ((Get-MonitorFingerprint) -ceq $before) 'read-only mode must not archive or write any file'

  # The real Status action body, run against the same previous-generation state.
  $source = [IO.File]::ReadAllText($fixtureSupervisor, [Text.Encoding]::UTF8)
  $statusStart = $source.IndexOf('    "Status" {')
  $statusEnd = $source.IndexOf("`n    }`n  }`n  if (`$SupervisorRequest.Action", $statusStart)
  Assert-SelfLock ($statusStart -ge 0 -and $statusEnd -gt $statusStart) 'Status action body must be locatable'
  $statusBlock = [scriptblock]::Create($source.Substring($statusStart + '    "Status" {'.Length, $statusEnd - $statusStart - '    "Status" {'.Length))
  $realResolve = ${function:Resolve-SupervisorProcess}
  function Resolve-SupervisorProcess { return $null }
  $statusResult = & $statusBlock
  Assert-SelfLock ($statusResult.status -ceq 'completed' -and $statusResult.code -ceq 'desired_state_stopped') 'Status must report a previous clean stop instead of failing'
  Assert-SelfLock ((Get-MonitorFingerprint) -ceq $before) 'Status must not archive or write any file'
  ${function:Resolve-SupervisorProcess} = $realResolve

  # --- 3b. A stop that landed in the pre-restart re-check writes the same fields with
  #         code desired_state_stopped_before_restart: it is a clean stop too.
  $stoppedBeforeRestart = @{ desiredState = 'stopped'; health = 'stopped'; code = 'desired_state_stopped_before_restart'; recoverable = $false; consecutiveFailures = 0 }
  Reset-Monitor
  Write-FixtureState $stoppedBeforeRestart
  $originalBytes = [IO.File]::ReadAllBytes($SupervisorStatePath)
  $fresh = Read-SupervisorState 'ArchivePreviousStopped'
  Assert-SelfLock ($fresh.code -ceq 'not_probed' -and $fresh.supervisorScriptSha256 -ceq $currentSha) 'archive mode must accept a previous generation that stopped before a restart'
  Assert-SelfLock (-not (Test-Path -LiteralPath $SupervisorStatePath)) 'archive mode must move a before-restart state.json away'
  Assert-SelfLock ([Convert]::ToBase64String([IO.File]::ReadAllBytes($archive)) -ceq [Convert]::ToBase64String($originalBytes)) 'the before-restart archive must keep every byte of the old state'
  Reset-Monitor
  Write-FixtureState $stoppedBeforeRestart
  $before = Get-MonitorFingerprint
  $allowed = Read-SupervisorState 'AllowPreviousStopped'
  Assert-SelfLock ($allowed.code -ceq 'desired_state_stopped_before_restart' -and $allowed.supervisorScriptSha256 -ceq $oldSha) 'read-only mode must show a before-restart state unchanged'
  Assert-SelfLock ((Get-MonitorFingerprint) -ceq $before) 'read-only mode must not touch a before-restart state'
  $realResolve = ${function:Resolve-SupervisorProcess}
  function Resolve-SupervisorProcess { return $null }
  $statusResult = & $statusBlock
  ${function:Resolve-SupervisorProcess} = $realResolve
  Assert-SelfLock ($statusResult.status -ceq 'completed' -and $statusResult.code -ceq 'desired_state_stopped_before_restart') 'Status must report a before-restart stop instead of failing'
  Assert-SelfLock ((Get-MonitorFingerprint) -ceq $before) 'Status must not write anything for a before-restart state'

  # --- 4. Anything but a clean stop stays fail-closed in every mode.
  $notClean = @(
    @{ name = 'running'; over = @{ desiredState = 'running'; health = 'healthy'; code = 'healthy'; recoverable = $false } },
    @{ name = 'unhealthy'; over = @{ desiredState = 'running'; health = 'unhealthy'; code = 'restart_failed'; recoverable = $false } },
    @{ name = 'desired-running-with-stopped-code'; over = @{ desiredState = 'running'; health = 'stopped'; code = 'desired_state_stopped'; recoverable = $false } },
    @{ name = 'unhealthy-with-stopped-code'; over = @{ desiredState = 'stopped'; health = 'unhealthy'; code = 'desired_state_stopped'; recoverable = $false } },
    @{ name = 'stopped-but-other-code'; over = @{ desiredState = 'stopped'; health = 'stopped'; code = 'something_else'; recoverable = $false } },
    @{ name = 'before-restart-but-running'; over = @{ desiredState = 'running'; health = 'stopped'; code = 'desired_state_stopped_before_restart'; recoverable = $false } },
    @{ name = 'before-restart-but-unhealthy'; over = @{ desiredState = 'stopped'; health = 'unhealthy'; code = 'desired_state_stopped_before_restart'; recoverable = $false } },
    @{ name = 'before-restart-but-recoverable'; over = @{ desiredState = 'stopped'; health = 'stopped'; code = 'desired_state_stopped_before_restart'; recoverable = $true } },
    @{ name = 'before-restart-with-failures'; over = @{ desiredState = 'stopped'; health = 'stopped'; code = 'desired_state_stopped_before_restart'; recoverable = $false; consecutiveFailures = 2 } },
    @{ name = 'stopped-but-recoverable'; over = @{ desiredState = 'stopped'; health = 'stopped'; code = 'desired_state_stopped'; recoverable = $true } },
    @{ name = 'stopped-with-failures'; over = @{ desiredState = 'stopped'; health = 'stopped'; code = 'desired_state_stopped'; recoverable = $false; consecutiveFailures = 3 } }
  )
  foreach ($case in $notClean) {
    foreach ($mode in @('Strict', 'AllowPreviousStopped', 'ArchivePreviousStopped')) {
      Reset-Monitor
      Write-FixtureState $case.over
      $before = Get-MonitorFingerprint
      $caseMode = $mode
      Assert-Throws { Read-SupervisorState $caseMode } "previous generation '$($case.name)' must be rejected in $mode mode"
      Assert-SelfLock ((Get-MonitorFingerprint) -ceq $before) "a rejected '$($case.name)' state must stay untouched in $mode mode"
    }
  }
  Reset-Monitor
  Write-FixtureState $stopped
  Assert-Throws { Read-SupervisorState } 'strict mode must keep rejecting a previous generation even when it stopped cleanly'

  # --- 5. Structurally invalid state stays rejected, even with a clean-stop shape.
  foreach ($bad in @(
      @{ restartAttemptsInWindow = -1 },
      @{ version = 'something-else' },
      @{ updatedAt = 'not-a-timestamp' })) {
    Reset-Monitor
    $over = @{} + $stopped
    foreach ($key in $bad.Keys) { $over[$key] = $bad[$key] }
    Write-FixtureState $over
    $before = Get-MonitorFingerprint
    Assert-Throws { Read-SupervisorState 'ArchivePreviousStopped' } 'a structurally invalid state must be rejected'
    Assert-SelfLock ((Get-MonitorFingerprint) -ceq $before) 'a structurally invalid state must not be archived'
  }
  Reset-Monitor
  Write-FixtureState $stopped 'not-a-digest'
  Assert-Throws { Read-SupervisorState 'ArchivePreviousStopped' } 'a malformed digest must be rejected'

  # --- 6. Fatal diagnostic: redacted, bounded, never throws.
  Reset-Monitor
  Write-SupervisorFatalDiagnostic 'connect failed postgresql://dbuser:s3cretpw@127.0.0.1/db'
  Write-SupervisorFatalDiagnostic 'second failure postgresql://dbuser:s3cretpw@127.0.0.1/db'
  $diagFile = Join-Path $SupervisorMonitorDirectory 'supervisor-fatal.json'
  Assert-SelfLock (Test-Path -LiteralPath $diagFile -PathType Leaf) 'a fatal diagnostic file must be written'
  Assert-SelfLock (@(Get-ChildItem -LiteralPath $SupervisorMonitorDirectory -File).Count -eq 1) 'repeated fatal diagnostics must overwrite one file'
  $diagText = [IO.File]::ReadAllText($diagFile)
  Assert-SelfLock ($diagText -notmatch 's3cretpw' -and $diagText -match 'postgresql://\[redacted\]@') 'the diagnostic message must be redacted'
  Assert-SelfLock ($diagText -match 'second failure') 'the latest failure must replace the older diagnostic'
  $savedMonitor = $SupervisorMonitorDirectory
  $SupervisorMonitorDirectory = Join-Path $fixtureRoot 'monitor-is-a-file'
  [IO.File]::WriteAllText($SupervisorMonitorDirectory, 'x')
  Write-SupervisorFatalDiagnostic 'must not throw even when the directory is unusable'
  $SupervisorMonitorDirectory = $savedMonitor
  $script:checks++

  # --- 7. Guarded Run: startup assertion failure becomes a visible diagnostic and exit code 1.
  $realRun = ${function:Invoke-SupervisorRun}
  function Invoke-SupervisorRun { throw 'startup assertion failed postgresql://u:pw0rd@h/db' }
  Reset-Monitor
  $exitCode = Invoke-SupervisorRunGuarded
  ${function:Invoke-SupervisorRun} = $realRun
  Assert-SelfLock ($exitCode -eq 1) 'a failing Run must return a non-zero exit code'
  $diagText = [IO.File]::ReadAllText($diagFile)
  Assert-SelfLock ($diagText -match 'startup assertion failed' -and $diagText -notmatch 'pw0rd' -and $diagText -match '"stage":\s*"startup"') 'startup failure must leave a redacted diagnostic with its stage'

  # --- 8. Real Run with a previous clean-stopped state: archived, loop ends normally.
  function Assert-DeployedApplication {}
  function Assert-RuntimeRootAclHardened {}
  function Get-SupervisorDesiredState {
    return [pscustomobject]@{ desiredState = 'running'; serviceScriptSha256 = (Get-FileSha256 $ServiceScriptPath) }
  }
  function Resolve-SupervisorProcess { return $null }
  function Write-SupervisorProcessReceipt { return [pscustomobject]@{ ProcessId = 1; CreationDate = 'fixture' } }
  function Remove-OwnSupervisorReceipt([object]$Snapshot) {}
  function Start-Sleep { throw 'loop_guard_sleep' }
  function Invoke-SupervisorCycle { return [pscustomobject]@{ shouldContinue = $false } }
  Reset-Monitor
  Write-FixtureState $stopped
  $exitCode = Invoke-SupervisorRunGuarded
  Assert-SelfLock ($exitCode -eq 0) 'Run must start after a previous generation that stopped cleanly'
  Assert-SelfLock (Test-Path -LiteralPath (Join-Path $SupervisorMonitorDirectory "state.previous-$oldSha.json") -PathType Leaf) 'Run must archive the previous generation state'

  # --- 9. Real Run with a previous running state: refuses and leaves a diagnostic.
  Reset-Monitor
  Write-FixtureState @{ desiredState = 'running'; health = 'healthy'; code = 'healthy'; recoverable = $false }
  $exitCode = Invoke-SupervisorRunGuarded
  Assert-SelfLock ($exitCode -eq 1) 'Run must refuse a previous generation that was not stopped'
  Assert-SelfLock (Test-Path -LiteralPath $diagFile -PathType Leaf) 'the refusal must leave a diagnostic file'
  Assert-SelfLock ($diagText -ne [IO.File]::ReadAllText($diagFile)) 'the refusal diagnostic must be a new write'
  Assert-SelfLock ([IO.File]::ReadAllText($diagFile) -match '"stage":\s*"state_upgrade"') 'the refusal must be attributed to the state upgrade stage'

  # --- 10. A cycle failure after which state.json is unreadable must not crash silently
  #         inside the catch block: both errors reach the diagnostic and Run exits 1.
  function Invoke-SupervisorCycle {
    [IO.File]::WriteAllText($SupervisorStatePath, '{ this is not json', $utf8)
    throw 'cycle boom postgresql://u:cyclepw@h/db'
  }
  Reset-Monitor
  Write-FixtureState $stopped $currentSha
  $exitCode = Invoke-SupervisorRunGuarded
  Assert-SelfLock ($exitCode -eq 1) 'a cycle failure with unreadable state must end in exit code 1'
  $diagText = [IO.File]::ReadAllText($diagFile)
  Assert-SelfLock ($diagText -match 'cycle boom' -and $diagText -match 'state_unrecordable') 'the diagnostic must carry both the cycle error and the state error'
  Assert-SelfLock ($diagText -notmatch 'cyclepw') 'the cycle error must be redacted in the diagnostic'
  Assert-SelfLock ($diagText -match '"stage":\s*"cycle"') 'the failure must be attributed to the cycle stage'

  # --- 11. Normal refusals exit non-zero as before but never overwrite a fault diagnostic.
  function Invoke-SupervisorCycle { return [pscustomobject]@{ shouldContinue = $false } }
  $realDesired = ${function:Get-SupervisorDesiredState}
  function Get-SupervisorDesiredState {
    return [pscustomobject]@{ desiredState = 'stopped'; serviceScriptSha256 = (Get-FileSha256 $ServiceScriptPath) }
  }
  Reset-Monitor
  Write-SupervisorFatalDiagnostic 'earlier real fault postgresql://u:faultpw@h/db'
  $faultBytes = [Convert]::ToBase64String([IO.File]::ReadAllBytes($diagFile))
  $exitCode = Invoke-SupervisorRunGuarded
  Assert-SelfLock ($exitCode -eq 1) 'a desired-state refusal must keep a non-zero exit code'
  Assert-SelfLock ([Convert]::ToBase64String([IO.File]::ReadAllBytes($diagFile)) -ceq $faultBytes) 'a desired-state refusal must not overwrite a fault diagnostic'
  Assert-SelfLock (@(Get-ChildItem -LiteralPath $SupervisorMonitorDirectory -File).Count -eq 1) 'a desired-state refusal must not write any file'
  ${function:Get-SupervisorDesiredState} = $realDesired
  function Get-SupervisorDesiredState {
    return [pscustomobject]@{ desiredState = 'running'; serviceScriptSha256 = (Get-FileSha256 $ServiceScriptPath) }
  }
  function Resolve-SupervisorProcess { return [pscustomobject]@{ ProcessId = 2 } }
  $exitCode = Invoke-SupervisorRunGuarded
  Assert-SelfLock ($exitCode -eq 1) 'an already-running supervisor refusal must keep a non-zero exit code'
  Assert-SelfLock ([Convert]::ToBase64String([IO.File]::ReadAllBytes($diagFile)) -ceq $faultBytes) 'an already-running refusal must not overwrite a fault diagnostic'
  function Resolve-SupervisorProcess { return $null }
  # A real fault right after the refusals still writes its diagnostic.
  Write-FixtureState @{ desiredState = 'running'; health = 'healthy'; code = 'healthy'; recoverable = $false }
  $exitCode = Invoke-SupervisorRunGuarded
  Assert-SelfLock ($exitCode -eq 1 -and [Convert]::ToBase64String([IO.File]::ReadAllBytes($diagFile)) -cne $faultBytes) 'a real fault must still overwrite the diagnostic after refusals'

  # --- 12. A completed startup clears an older fatal diagnostic.
  Reset-Monitor
  Write-SupervisorFatalDiagnostic 'stale fault from an earlier failed logon'
  Assert-SelfLock (Test-Path -LiteralPath $diagFile -PathType Leaf) 'fixture must start with a stale diagnostic'
  Write-FixtureState $stopped $currentSha
  $exitCode = Invoke-SupervisorRunGuarded
  Assert-SelfLock ($exitCode -eq 0) 'a healthy startup must succeed'
  Assert-SelfLock (-not (Test-Path -LiteralPath $diagFile)) 'a completed startup must remove the stale fatal diagnostic'
  # A startup that fails before completing must keep reporting, not clear it.
  Reset-Monitor
  Write-FixtureState @{ desiredState = 'running'; health = 'healthy'; code = 'healthy'; recoverable = $false }
  $exitCode = Invoke-SupervisorRunGuarded
  Assert-SelfLock ($exitCode -eq 1 -and (Test-Path -LiteralPath $diagFile -PathType Leaf)) 'a failed startup must leave its diagnostic'

  # --- 13. Real `powershell.exe -File` entry point against the fixture root.
  #         The fixture supervisor copy has the fixed runtime root rewritten to the temp
  #         fixture, so the production path check is unchanged and nothing here can
  #         reach the production runtime. The fixture service script copy gets two
  #         test-only overrides so that Run fails or refuses during startup, before
  #         the loop: it can never enter the resident loop.
  $fixtureService = Join-Path $fixtureTools 'django-local-service.ps1'
  $serviceText = [IO.File]::ReadAllText($fixtureService, [Text.Encoding]::UTF8)
  Assert-SelfLock (-not $serviceText.Contains('teruisi-fixture-startup-override')) 'service fixture copy must start unmodified'
  $override = "`n# teruisi-fixture-startup-override`nfunction Assert-DeployedApplication { if (`$env:TERUISI_FIXTURE_DEPLOY_FAIL -ceq '1') { throw 'fixture startup failure postgresql://dbuser:filepw9@127.0.0.1/db' } }`nfunction Assert-RuntimeRootAclHardened { }`n"
  [IO.File]::WriteAllText($fixtureService, $serviceText + $override, [Text.UTF8Encoding]::new($true))
  function Invoke-FixtureSupervisorFile([string]$DeployFail) {
    $outFile = Join-Path $fixtureRoot ('child-out-' + [Guid]::NewGuid().ToString('N') + '.txt')
    $errFile = Join-Path $fixtureRoot ('child-err-' + [Guid]::NewGuid().ToString('N') + '.txt')
    $env:TERUISI_FIXTURE_DEPLOY_FAIL = $DeployFail
    try {
      $argList = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $fixtureSupervisor + '"'),
        '-Action', 'Run', '-RuntimeRoot', ('"' + $fixtureRoot + '"'), '-Execute')
      $proc = Start-Process -FilePath 'powershell.exe' -ArgumentList $argList -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput $outFile -RedirectStandardError $errFile
      # Reading Handle caches the process handle; without it ExitCode stays $null.
      $null = $proc.Handle
      # Never kill: if the child does not finish, fail the test and leave it for a human.
      if (-not $proc.WaitForExit(120000)) { throw "fixture supervisor child pid $($proc.Id) did not exit within 120s; it was NOT stopped" }
      $proc.WaitForExit()
      return [pscustomobject]@{ ExitCode = $proc.ExitCode; Stderr = [IO.File]::ReadAllText($errFile); Stdout = [IO.File]::ReadAllText($outFile) }
    } finally {
      Remove-Item Env:\TERUISI_FIXTURE_DEPLOY_FAIL -ErrorAction SilentlyContinue
    }
  }
  Reset-Monitor
  $failRun = Invoke-FixtureSupervisorFile '1'
  Assert-SelfLock ($failRun.ExitCode -is [int] -and $failRun.ExitCode -eq 1) 'a real -File Run that fails at startup must exit with code 1'
  Assert-SelfLock ($failRun.Stderr -match 'fixture startup failure' -and $failRun.Stderr -match 'postgresql://\[redacted\]@') 'the real -File stderr must carry the redacted error'
  Assert-SelfLock ($failRun.Stderr -notmatch 'filepw9' -and $failRun.Stdout -notmatch 'filepw9') 'the real -File output must not leak the password'
  Assert-SelfLock (Test-Path -LiteralPath $diagFile -PathType Leaf) 'the real -File failure must write the diagnostic file'
  $diagText = [IO.File]::ReadAllText($diagFile)
  Assert-SelfLock ($diagText -match 'fixture startup failure' -and $diagText -notmatch 'filepw9' -and $diagText -match '"stage":\s*"startup"') 'the real -File diagnostic must be redacted and staged'
  $faultBytes = [Convert]::ToBase64String([IO.File]::ReadAllBytes($diagFile))
  # Desired-state file absent (fail closed to stopped): a normal refusal, still before the loop.
  $refuseRun = Invoke-FixtureSupervisorFile '0'
  Assert-SelfLock ($refuseRun.ExitCode -is [int] -and $refuseRun.ExitCode -eq 1) 'a real -File Run that is refused must exit with code 1'
  Assert-SelfLock ($refuseRun.Stderr.Length -gt 0) 'a real -File refusal must still say why on stderr'
  Assert-SelfLock ([Convert]::ToBase64String([IO.File]::ReadAllBytes($diagFile)) -ceq $faultBytes) 'a real -File refusal must not overwrite the fault diagnostic'
} finally {
  Remove-Item Env:\TERUISI_DJANGO_SUPERVISOR_LIBRARY_ONLY -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $fixtureRoot) {
    $resolved = [IO.Path]::GetFullPath($fixtureRoot)
    $temp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\', '/')
    if ((Split-Path -Parent $resolved) -ieq $temp -and
        [IO.Path]::GetFileName($resolved) -cmatch '^teruisi-supervisor-selflock-[0-9a-f]{32}$') {
      Remove-Item -LiteralPath $resolved -Recurse -Force
    }
  }
}

Write-Output ((@{ checks = $script:checks; productionTouched = $false } | ConvertTo-Json -Compress))
