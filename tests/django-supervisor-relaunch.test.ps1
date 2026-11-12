# Fixture-only test for the Django supervisor relaunch/stop-wait logic in
# tools/django-local-service.ps1. It dot-sources the controller in library mode
# against a temporary fake runtime root, replaces every process-touching function
# with a stub, never creates a process and never touches the real runtime root.
$ErrorActionPreference = 'Stop'
$WorkspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$ServiceScript = Join-Path $WorkspaceRoot 'tools\django-local-service.ps1'
$SupervisorScript = Join-Path $WorkspaceRoot 'tools\django-runtime-supervisor.ps1'
$FixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('supervisor-relaunch-' + [guid]::NewGuid().ToString('N'))
$FixtureRoot = [IO.Path]::GetFullPath($FixtureRoot)
New-Item -ItemType Directory -Path $FixtureRoot | Out-Null
$env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY = '1'
$script:Failures = New-Object System.Collections.Generic.List[string]
$script:Passed = 0
function Check([string]$Name, [scriptblock]$Body) {
  try {
    & $Body
    $script:Passed++
  } catch {
    $script:Failures.Add(('FAIL: {0} :: {1}' -f $Name, $_.Exception.Message))
  }
}
function Assert-That([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }

try {
  . $ServiceScript -Action Start -RuntimeRoot $FixtureRoot
  $DjangoSupervisorFixedRuntimeRoot = $FixtureRoot
  $DjangoSupervisorPollMilliseconds = 50
  $DjangoSupervisorStopWaitSeconds = 1
  New-Item -ItemType Directory -Path $RunDirectory, $LogDirectory -Force | Out-Null
  # The supervisor (and the relaunch plan) compare the desired-state digest with the INSTALLED
  # script, so the fake runtime root carries a byte copy of the script under test.
  New-Item -ItemType Directory -Path (Split-Path -Parent $InstalledScriptPath) -Force | Out-Null
  function Restore-InstalledScript { Copy-Item -LiteralPath $ServiceScript -Destination $InstalledScriptPath -Force }

  $PowerShellExe = (Get-Command 'powershell.exe').Source
  $ExpectedArguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $FixtureRoot + '\app\tools\django-runtime-supervisor.ps1" -Action Run -RuntimeRoot "' + $FixtureRoot + '" -Execute'
  $ExpectedCommandLine = '"' + $PowerShellExe + '" ' + $ExpectedArguments
  $OneShotArguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $FixtureRoot + '\app\tools\django-local-service.ps1" -Action Start -RuntimeRoot "' + $FixtureRoot + '"'
  $OwnCreation = Get-ProcessCreation (Get-CimInstance Win32_Process -Filter "ProcessId = $PID" -ErrorAction Stop)

  # ---- stubs: nothing below may create or inspect a real supervisor ----
  $script:Calls = New-Object System.Collections.ArrayList
  $script:CreateMode = 'ok'
  $script:Shortcut = $null
  $script:Candidates = @()
  $script:RunningSequence = $null
  $script:RunningPolls = 0
  function Invoke-DjangoSupervisorProcessCreate([string]$CommandLine, [string]$WorkingDirectory) {
    [void]$script:Calls.Add([pscustomobject]@{ CommandLine = $CommandLine; WorkingDirectory = $WorkingDirectory })
    if ($script:CreateMode -eq 'throw') { throw 'stub create threw' }
    if ($script:CreateMode -eq 'fail') { return [pscustomobject]@{ ReturnValue = 9; ProcessId = 0 } }
    return [pscustomobject]@{ ReturnValue = 0; ProcessId = 424242 }
  }
  function Read-DjangoSupervisorStartupShortcut { return $script:Shortcut }
  function Get-DjangoSupervisorCandidates { return @($script:Candidates) }

  function Get-LauncherEvents {
    if (-not (Test-Path -LiteralPath $LauncherLogPath)) { return @() }
    return @(Get-Content -LiteralPath $LauncherLogPath -Encoding UTF8 | Where-Object { $_ } | ForEach-Object { $_ | ConvertFrom-Json })
  }
  function Reset-Fixture {
    $script:Calls.Clear()
    $script:CreateMode = 'ok'
    $script:Candidates = @()
    $script:RunningSequence = $null
    $script:RunningPolls = 0
    $script:SupervisorExpectedDesiredStateSha256 = ''
    $script:SupervisorExpectedDesiredStateSha256 = ''
    $script:DjangoSupervisorFixedRuntimeRoot = $FixtureRoot
    $script:NativeIsolation = $null
    $script:DjangoSupervisorStopWaitSeconds = 1
    Restore-InstalledScript
    $env:TERUISI_PROCESS_DEADLINE_UNIX_MS = $null
    foreach ($path in @($MaintenancePath, $DjangoSupervisorPidPath, $SupervisorDesiredStatePath, $LauncherLogPath, "$LauncherLogPath.1")) {
      if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
    }
    Write-ServiceDesiredState 'running' 'explicit_start'
    $script:Shortcut = [pscustomobject]@{ TargetPath = $PowerShellExe; Arguments = $ExpectedArguments; WorkingDirectory = $InstalledAppRoot }
  }
  function Write-Receipt([int]$ProcessId, [string]$Creation) {
    [IO.File]::WriteAllText($DjangoSupervisorPidPath, (@{ version = 'teruisi-django-supervisor-process-v1'; processId = $ProcessId; creationDate = $Creation } | ConvertTo-Json), $Utf8NoBom)
  }
  function Get-SkipReasons { return @(Get-LauncherEvents | Where-Object { $_.event -ceq 'supervisor_relaunch_skipped' } | ForEach-Object { $_.message }) }

  # ---- all preconditions met: exactly one launch with the shortcut replayed verbatim ----
  Check 'launch happens once with the exact shortcut command line' {
    Reset-Fixture
    $result = Invoke-DjangoSupervisorRelaunch
    Assert-That ($script:Calls.Count -eq 1) "expected one create call, got $($script:Calls.Count)"
    Assert-That ($script:Calls[0].CommandLine -ceq $ExpectedCommandLine) "command line differs: [$($script:Calls[0].CommandLine)] vs [$ExpectedCommandLine]"
    Assert-That ($script:Calls[0].WorkingDirectory -ceq $InstalledAppRoot) 'working directory must be the app root'
    Assert-That ($result.Launched -and $result.ProcessId -eq 424242) 'result must carry the created process id'
    Assert-That ($script:Calls[0].CommandLine -notmatch 'RedirectStandard') 'no redirection allowed'
    $requested = @(Get-LauncherEvents | Where-Object { $_.event -ceq 'supervisor_launch_requested' })
    Assert-That ($requested.Count -eq 1 -and $requested[0].message -ceq 'processId=424242') 'supervisor_launch_requested with the WMI pid missing'
    Assert-That (@(Get-LauncherEvents | Where-Object { $_.event -ceq 'supervisor_launched' -or $_.event -ceq 'supervisor_launch_unconfirmed' }).Count -eq 0) 'no confirmation events exist any more'
  }

  # ---- every skip condition ----
  $skipCases = @(
    @{ Reason = 'fence_present'; Setup = { $script:SupervisorExpectedDesiredStateSha256 = ('a' * 64) } },
    @{ Reason = 'not_fixed_runtime'; Setup = { $script:DjangoSupervisorFixedRuntimeRoot = 'D:\not-the-fixed-runtime' } },
    @{ Reason = 'native_isolation'; Setup = { $script:NativeIsolation = [pscustomobject]@{ id = 'fixture-isolation' } } },
    @{ Reason = 'maintenance_active'; Setup = {
        [IO.File]::WriteAllText($MaintenancePath, (@{ version = 'teruisi-system-maintenance-v1'; id = ('c' * 32); runtimeRoot = $FixtureRoot } | ConvertTo-Json), $Utf8NoBom) } },
    @{ Reason = 'desired_state_not_running'; Setup = { Write-ServiceDesiredState 'stopped' 'explicit_stop' } },
    @{ Reason = 'desired_state_not_running'; Setup = { Remove-Item -LiteralPath $SupervisorDesiredStatePath -Force } },
    @{ Reason = 'desired_state_digest_mismatch'; Setup = {
        $state = Get-Content -Raw -LiteralPath $SupervisorDesiredStatePath -Encoding UTF8 | ConvertFrom-Json
        $state.serviceScriptSha256 = ('d' * 64)
        [IO.File]::WriteAllText($SupervisorDesiredStatePath, ($state | ConvertTo-Json), $Utf8NoBom) } },
    @{ Reason = 'desired_state_digest_mismatch'; Setup = {
        # running copy equals the desired state, but the INSTALLED script differs (non-installed copy executing)
        [IO.File]::AppendAllText($InstalledScriptPath, "`r`n# drift`r`n") } },
    @{ Reason = 'desired_state_digest_mismatch'; Setup = { Remove-Item -LiteralPath $InstalledScriptPath -Force } },
    @{ Reason = 'startup_missing'; Setup = { $script:Shortcut = $null } },
    @{ Reason = 'startup_not_supervisor'; Setup = { $script:Shortcut = [pscustomobject]@{ TargetPath = (Join-Path $env:SystemRoot 'System32\cmd.exe'); Arguments = $ExpectedArguments; WorkingDirectory = $InstalledAppRoot } } },
    @{ Reason = 'startup_not_supervisor'; Setup = { $script:Shortcut = [pscustomobject]@{ TargetPath = $PowerShellExe; Arguments = $ExpectedArguments; WorkingDirectory = (Join-Path $FixtureRoot 'elsewhere') } } },
    @{ Reason = 'startup_not_supervisor'; Setup = { $script:Shortcut = [pscustomobject]@{ TargetPath = $PowerShellExe; Arguments = $OneShotArguments; WorkingDirectory = $InstalledAppRoot } } },
    @{ Reason = 'supervisor_already_running'; Setup = { Write-Receipt $PID $OwnCreation } },
    @{ Reason = 'supervisor_candidate_present'; Setup = { $script:Candidates = @([pscustomobject]@{ ProcessId = 1 }) } }
  )
  foreach ($case in $skipCases) {
    $label = 'skip: ' + $case.Reason
    Check $label {
      Reset-Fixture
      & $case.Setup
      $result = Invoke-DjangoSupervisorRelaunch
      Assert-That ($script:Calls.Count -eq 0) 'create must not be called'
      Assert-That (-not $result.Launched) 'result must not be launched'
      $reasons = Get-SkipReasons
      Assert-That ($reasons -contains ('reason=' + $case.Reason)) ('event reason missing, got: ' + ($reasons -join ';'))
    }
  }
  Check 'stale receipt (dead process) does not block the launch and is not deleted' {
    Reset-Fixture
    Write-Receipt 2147480000 $OwnCreation
    [void](Invoke-DjangoSupervisorRelaunch)
    Assert-That ($script:Calls.Count -eq 1) 'a dead receipt process must allow the launch'
    Assert-That (Test-Path -LiteralPath $DjangoSupervisorPidPath) 'the stale receipt belongs to the supervisor and must not be removed here'
  }
  Check 'receipt with reused pid (different creation date) does not block the launch' {
    Reset-Fixture
    Write-Receipt $PID '2001-01-01T00:00:00.0000000Z'
    [void](Invoke-DjangoSupervisorRelaunch)
    Assert-That ($script:Calls.Count -eq 1) 'pid reuse must not be mistaken for a live supervisor'
  }
  Check 'unreadable receipt skips instead of guessing' {
    Reset-Fixture
    [IO.File]::WriteAllText($DjangoSupervisorPidPath, '{not json', $Utf8NoBom)
    [void](Invoke-DjangoSupervisorRelaunch)
    Assert-That ($script:Calls.Count -eq 0) 'must not launch'
    Assert-That ((Get-SkipReasons) -contains 'reason=supervisor_receipt_unreadable') 'reason code missing'
  }

  # ---- failure never propagates ----
  Check 'create returning non-zero is recorded and does not throw' {
    Reset-Fixture
    $script:CreateMode = 'fail'
    $result = Invoke-DjangoSupervisorRelaunch
    Assert-That (-not $result.Launched) 'must not report launched'
    $failed = @(Get-LauncherEvents | Where-Object { $_.event -ceq 'supervisor_launch_failed' })
    Assert-That ($failed.Count -eq 1 -and $failed[0].message -ceq 'reason=create_returned_9' -and $failed[0].level -ceq 'ERROR') 'failure event missing'
  }
  Check 'create throwing is recorded and does not throw' {
    Reset-Fixture
    $script:CreateMode = 'throw'
    $result = Invoke-DjangoSupervisorRelaunch
    Assert-That (-not $result.Launched) 'must not report launched'
    $failed = @(Get-LauncherEvents | Where-Object { $_.event -ceq 'supervisor_launch_failed' })
    Assert-That ($failed.Count -eq 1 -and $failed[0].message -ceq 'reason=exception') 'exception event missing'
  }
  Check 'a planning error (unreadable maintenance state) is recorded and does not throw' {
    Reset-Fixture
    [IO.File]::WriteAllText($MaintenancePath, '{broken', $Utf8NoBom)
    $result = Invoke-DjangoSupervisorRelaunch
    Assert-That ($script:Calls.Count -eq 0 -and -not $result.Launched) 'must not launch'
    Assert-That (@(Get-LauncherEvents | Where-Object { $_.event -ceq 'supervisor_launch_failed' }).Count -eq 1) 'failure event missing'
  }

  # ---- Start must not wait for the supervisor receipt ----
  Check 'launch step returns promptly although the receipt never appears' {
    Reset-Fixture
    # the stub create succeeds, but no receipt is ever written (the real supervisor needs ~38 s)
    $clock = [Diagnostics.Stopwatch]::StartNew()
    $result = Invoke-DjangoSupervisorRelaunch
    Assert-That ($result.Launched) 'launch must be reported as requested'
    Assert-That ($clock.ElapsedMilliseconds -lt 700) "launch step waited for a receipt: $($clock.ElapsedMilliseconds) ms"
    Assert-That (-not (Test-Path -LiteralPath $DjangoSupervisorPidPath)) 'fixture sanity: no receipt exists'
  }
  Check 'no confirmation step exists in the controller' {
    Assert-That ($null -eq (Get-Command 'Confirm-DjangoSupervisorLaunch' -ErrorAction SilentlyContinue)) 'Confirm-DjangoSupervisorLaunch must be gone'
    Assert-That ($null -eq (Get-Command 'Test-DjangoSupervisorReceiptProcess' -ErrorAction SilentlyContinue)) 'Test-DjangoSupervisorReceiptProcess must be gone'
  }

  # ---- Stop: bounded wait, never throws, never ends a process ----
  function Test-DjangoSupervisorRunning {
    $script:RunningPolls++
    return ($script:RunningPolls -le $script:RunningSequence)
  }
  Check 'stop wait returns promptly when the supervisor exits quickly' {
    Reset-Fixture
    $script:DjangoSupervisorStopWaitSeconds = 10
    $script:RunningSequence = 3
    $clock = [Diagnostics.Stopwatch]::StartNew()
    Wait-DjangoSupervisorExitAfterStop
    Assert-That ($clock.ElapsedMilliseconds -lt 3000) "waited too long: $($clock.ElapsedMilliseconds) ms"
    Assert-That (@(Get-LauncherEvents | Where-Object { $_.event -ceq 'supervisor_exited_after_stop' }).Count -eq 1) 'exit event missing'
  }
  Check 'stop wait does not wait when no supervisor is running' {
    Reset-Fixture
    $script:RunningSequence = 0
    $clock = [Diagnostics.Stopwatch]::StartNew()
    Wait-DjangoSupervisorExitAfterStop
    Assert-That ($clock.ElapsedMilliseconds -lt 500) 'must return immediately'
    Assert-That (@(Get-LauncherEvents | Where-Object { $_.event -like 'supervisor_*' }).Count -eq 0) 'no event expected'
  }
  Check 'stop wait that times out records a WARN and does not throw' {
    Reset-Fixture
    $script:DjangoSupervisorStopWaitSeconds = 1
    $script:RunningSequence = [int]::MaxValue
    $clock = [Diagnostics.Stopwatch]::StartNew()
    Wait-DjangoSupervisorExitAfterStop
    Assert-That ($clock.ElapsedMilliseconds -ge 800) 'must wait up to the limit'
    Assert-That ($clock.ElapsedMilliseconds -lt 6000) 'wait must be bounded'
    $warn = @(Get-LauncherEvents | Where-Object { $_.event -ceq 'supervisor_stop_wait_timeout' })
    Assert-That ($warn.Count -eq 1 -and $warn[0].level -ceq 'WARN') 'timeout WARN missing'
    Assert-That (@(Get-LauncherEvents | Where-Object { $_.event -ceq 'supervisor_stop_wait_failed' }).Count -eq 0) 'the timeout path itself must not raise (an internal throw is swallowed into supervisor_stop_wait_failed)'
  }
  Check 'stop wait never outlives the caller deadline' {
    Reset-Fixture
    $script:DjangoSupervisorStopWaitSeconds = 30
    $script:RunningSequence = [int]::MaxValue
    $env:TERUISI_PROCESS_DEADLINE_UNIX_MS = [string]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + 3500)
    $clock = [Diagnostics.Stopwatch]::StartNew()
    Wait-DjangoSupervisorExitAfterStop
    $env:TERUISI_PROCESS_DEADLINE_UNIX_MS = $null
    Assert-That ($clock.ElapsedMilliseconds -lt 3500) "waited past the deadline: $($clock.ElapsedMilliseconds) ms"
  }

  # ---- static facts about the real source ----
  $source = [IO.File]::ReadAllText($ServiceScript)
  $functionTexts = @{}
  $ast = [Management.Automation.Language.Parser]::ParseFile($ServiceScript, [ref]$null, [ref]$null)
  foreach ($name in @('Invoke-DjangoSupervisorProcessCreate', 'Invoke-DjangoSupervisorRelaunch', 'Wait-DjangoSupervisorExitAfterStop', 'Get-DjangoSupervisorRelaunchPlan', 'Get-DjangoSupervisorReceiptState', 'Test-DjangoSupervisorRunning')) {
    $definition = $ast.Find({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name }, $true)
    $functionTexts[$name] = if ($definition) { $definition.Extent.Text } else { '' }
  }
  Check 'new functions contain no process-ending or process-starting calls' {
    foreach ($name in $functionTexts.Keys) {
      if ($name -ceq 'Invoke-DjangoSupervisorProcessCreate') { continue }
      Assert-That ($functionTexts[$name].Length -gt 0) "function $name missing"
      Assert-That ($functionTexts[$name] -notmatch '(?i)Stop-Process|taskkill|\.Kill\(|Start-Process|Remove-Item') "$name must not end/start processes or delete files"
    }
  }
  Check 'launch uses WMI Win32_Process.Create, not Start-Process' {
    $text = $functionTexts['Invoke-DjangoSupervisorProcessCreate']
    Assert-That ($text -match 'Invoke-CimMethod -ClassName Win32_Process -MethodName Create') 'must use Invoke-CimMethod Win32_Process Create'
    Assert-That ($text -notmatch 'Start-Process|RedirectStandard') 'must not use Start-Process or redirection'
  }
  Check 'Start branch relaunches once after the domain starts and never waits afterwards; Stop waits after the mutex' {
    $start = [regex]::Match($source, '(?s)"Start" \{.*?\r?\n      "Stop" \{').Value
    Assert-That ($start.Length -gt 0) 'Start branch not found'
    $domain = $start.IndexOf('Invoke-EnabledDjangoDomainStarts $orchestratedLifecycleAclToken')
    $relaunch = $start.IndexOf('Invoke-DjangoSupervisorRelaunch')
    Assert-That ($domain -gt 0 -and $relaunch -gt $domain) 'order must be domain starts, then relaunch'
    Assert-That ($start.IndexOf('Invoke-DjangoSupervisorRelaunch', $relaunch + 1) -lt 0) 'relaunch must be called exactly once'
    Assert-That ($start -notmatch 'Confirm-DjangoSupervisor|Start-Sleep|Wait-DjangoSupervisor') 'Start must not wait for the supervisor'
    Assert-That ($functionTexts['Invoke-DjangoSupervisorRelaunch'] -notmatch '(?i)Start-Sleep|\bwhile\b|\bdo\s*\{') 'the relaunch step must not wait or loop'
    $stop = [regex]::Match($source, '(?s)"Stop" \{.*?\r?\n      "Status" \{').Value
    $stopEnd = $stop.IndexOf('Stop-ServiceStack')
    $wait = $stop.IndexOf('Wait-DjangoSupervisorExitAfterStop')
    Assert-That ($stopEnd -gt 0 -and $wait -gt $stopEnd) 'stop wait must come after Stop-ServiceStack'
    Assert-That ($stop.Substring($stopEnd, $wait - $stopEnd) -match '(?s)\}\s*$') 'stop wait must come after the mutex block closes'
  }
  Check 'startup arguments equal the supervisor Install-SupervisorStartup and RestoreOneShot strings' {
    $supervisorSource = [IO.File]::ReadAllText($SupervisorScript)
    foreach ($variable in @('expectedArguments', 'supervisorArguments')) {
      $match = [regex]::Match($supervisorSource, '\$' + $variable + ' = "([^\r\n]*)"\r?\n')
      Assert-That $match.Success "$variable not found in supervisor"
      $template = $match.Groups[1].Value.Replace('$SupervisorScriptPath', $FixtureRoot + '\app\tools\django-runtime-supervisor.ps1').Replace('$($SupervisorRequest.RuntimeRoot)', $FixtureRoot).Replace('`"', '"')
      Assert-That ($template -ceq (Get-DjangoSupervisorStartupArguments)) "$variable differs from the relaunch arguments: [$template]"
    }
  }
} finally {
  $env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY = $null
  $env:TERUISI_PROCESS_DEADLINE_UNIX_MS = $null
  $resolved = [IO.Path]::GetFullPath($FixtureRoot)
  if ((Split-Path -Parent $resolved) -ieq ([IO.Path]::GetTempPath()).TrimEnd('\') -and (Split-Path -Leaf $resolved) -match '^supervisor-relaunch-[0-9a-f]{32}$') {
    Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction SilentlyContinue
  }
}
if ($script:Failures.Count -gt 0) {
  $script:Failures | ForEach-Object { Write-Output $_ }
  Write-Output ('passed={0} failed={1}' -f $script:Passed, $script:Failures.Count)
  exit 1
}
Write-Output ('passed={0} failed=0' -f $script:Passed)
exit 0
