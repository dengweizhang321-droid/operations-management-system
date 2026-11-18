# Checks the PostgreSQL shutdown guard against a stand-in pg_ctl in a temporary directory.
# Messages are only ever sent to the guard windows this test creates itself. No production
# path, process, scheduled task or database is touched. Windows PowerShell 5.1 only.
# Comments stay ASCII so the file parses identically with or without a BOM.
$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$guardScript = Join-Path $workspace 'tools\postgres-shutdown-guard.ps1'
$registerScript = Join-Path $workspace 'tools\register-postgres-shutdown-guard.ps1'
$root = Join-Path ([IO.Path]::GetTempPath()) ('teruisi-pg-guard-' + [guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($root) | Out-Null
$script:checks = [Collections.Generic.List[string]]::new()
function Check($Condition, [string]$Message) { if (-not $Condition) { throw "FAILED: $Message" }; $script:checks.Add($Message) }

. $guardScript -NoRun
. $registerScript -FunctionsOnly

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace TeruisiTest {
  public static class Messages {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);
    public static long Send(IntPtr hWnd, uint msg, long wParam, long lParam, uint timeoutMs) {
      IntPtr result;
      IntPtr ok = SendMessageTimeout(hWnd, msg, (IntPtr)wParam, (IntPtr)lParam, 2, timeoutMs, out result);
      if (ok == IntPtr.Zero) return -999999;
      return result.ToInt64();
    }
  }
}
'@

function New-Scenario([string]$Name, [int]$StatusCode, [int]$StopCode, [int]$StopSleep = 0, [int]$StopWait = 25, [int]$StopProcess = 35) {
  $dir = Join-Path $root $Name
  $data = Join-Path $dir 'postgres-data'
  $logs = Join-Path $dir 'logs'
  [IO.Directory]::CreateDirectory($data) | Out-Null
  $fake = Join-Path $dir 'pg_ctl.cmd'
  $lines = @(
    '@echo off',
    'setlocal',
    '>>"%~dp0calls.log" echo %*',
    'if /i "%~1"=="status" goto status',
    'if /i "%~1"=="stop" goto stop',
    'exit /b 99',
    ':status',
    'set /p C=<"%~dp0status.code"',
    'exit /b %C%',
    ':stop',
    'if not exist "%~dp0stop.sleep" goto stopcode',
    'set /p S=<"%~dp0stop.sleep"',
    'ping -n %S% 127.0.0.1 >nul',
    ':stopcode',
    'set /p C=<"%~dp0stop.code"',
    'exit /b %C%'
  )
  [IO.File]::WriteAllText($fake, ($lines -join "`r`n") + "`r`n", [Text.Encoding]::ASCII)
  [IO.File]::WriteAllText((Join-Path $dir 'status.code'), [string]$StatusCode)
  [IO.File]::WriteAllText((Join-Path $dir 'stop.code'), [string]$StopCode)
  if ($StopSleep -gt 0) { [IO.File]::WriteAllText((Join-Path $dir 'stop.sleep'), [string]$StopSleep) }
  $guard = New-PostgresShutdownGuardHost -PgCtl $fake -Data $data -Logs $logs -StopWait $StopWait -StopProcessSeconds $StopProcess -Reason 'test reason'
  $guard.Start()
  return [pscustomobject]@{ Guard = $guard; Dir = $dir; Data = $data; Calls = (Join-Path $dir 'calls.log'); Log = (Join-Path $logs 'postgres-shutdown-guard.jsonl') }
}
function Get-Calls($s) { if (Test-Path -LiteralPath $s.Calls) { @(Get-Content -LiteralPath $s.Calls | ForEach-Object { $_.Trim() }) } else { @() } }
function Get-LogEvents($s) { @(Get-Content -LiteralPath $s.Log | ForEach-Object { $_ | ConvertFrom-Json }) }
function Stop-Scenario($s) { $s.Guard.RequestStop(); $s.Guard.WaitForExit() }

try {
  # 1. Running database: status -> stop -m fast -w -t 25, block reason created first and removed last.
  $s = New-Scenario 'running' 0 0
  $result = [TeruisiTest.Messages]::Send($s.Guard.Handle, 0x11, 0, 0, 60000)
  Check ($result -eq 1) 'query-end-session-allows-shutdown'
  $calls = Get-Calls $s
  Check ($calls.Count -eq 2) 'running-two-pg-ctl-calls'
  Check ($calls[0] -ceq ('status -D "' + $s.Data + '"')) 'running-status-arguments'
  Check ($calls[1] -ceq ('stop -D "' + $s.Data + '" -m fast -w -t 25')) 'running-stop-arguments'
  Check (($s.Guard.GetEvents() -join ',') -ceq 'query_end_session,block_create,status,stop,block_destroy') 'block-reason-created-before-stop-removed-after'
  $names = @(Get-LogEvents $s | ForEach-Object { $_.event })
  Check (($names -join ',') -ceq 'guard_started,query_end_session,block_reason_created,status_checked,stop_started,stop_finished,block_reason_destroyed') 'jsonl-event-sequence'
  $finished = Get-LogEvents $s | Where-Object { $_.event -eq 'stop_finished' }
  Check ($finished.exitCode -eq 0 -and $finished.ok -eq $true -and $finished.elapsedMs -ge 0) 'jsonl-records-exit-code-and-duration'
  Check ($null -ne ((Get-LogEvents $s)[0].timestamp -as [datetimeoffset])) 'jsonl-has-timestamp'
  # A repeated session-end query is handled again but a stopped database needs no second stop (status only).
  [IO.File]::WriteAllText((Join-Path $s.Dir 'status.code'), '3')
  $null = [TeruisiTest.Messages]::Send($s.Guard.Handle, 0x11, 0, 0, 60000)
  Check ((Get-Calls $s).Count -eq 3 -and (Get-Calls $s)[2] -like 'status *') 'second-query-checks-status-only'
  Stop-Scenario $s

  # 2. Already stopped (pg_ctl status exit 3): no stop call, shutdown allowed.
  $s = New-Scenario 'stopped' 3 0
  $result = [TeruisiTest.Messages]::Send($s.Guard.Handle, 0x11, 0, 0, 60000)
  Check ($result -eq 1 -and (Get-Calls $s).Count -eq 1 -and ($s.Guard.GetEvents() -join ',') -ceq 'query_end_session,block_create,status,block_destroy') 'stopped-database-not-stopped-again'
  Check (@(Get-LogEvents $s | Where-Object { $_.event -eq 'postgres_not_running' }).Count -eq 1) 'stopped-database-logged'
  Stop-Scenario $s

  # 3. Unexpected status (exit 4, data directory problem): never stop blindly.
  $s = New-Scenario 'status-unexpected' 4 0
  $result = [TeruisiTest.Messages]::Send($s.Guard.Handle, 0x11, 0, 0, 60000)
  Check ($result -eq 1 -and (Get-Calls $s).Count -eq 1 -and @(Get-LogEvents $s | Where-Object { $_.event -eq 'stop_skipped' }).Count -eq 1) 'unexpected-status-skips-stop-and-allows-shutdown'
  Stop-Scenario $s

  # 4. Stop fails: shutdown still allowed, failure recorded, block reason removed.
  $s = New-Scenario 'stop-fails' 0 1
  $result = [TeruisiTest.Messages]::Send($s.Guard.Handle, 0x11, 0, 0, 60000)
  $finished = Get-LogEvents $s | Where-Object { $_.event -eq 'stop_finished' }
  Check ($result -eq 1 -and $finished.exitCode -eq 1 -and $finished.ok -eq $false) 'stop-failure-allows-shutdown-and-is-logged'
  Check (($s.Guard.GetEvents() -join ',') -ceq 'query_end_session,block_create,status,stop,block_destroy') 'stop-failure-still-removes-block-reason'
  Stop-Scenario $s

  # 5. Stop hangs: bounded by the process ceiling, then released; never blocks indefinitely.
  $s = New-Scenario 'stop-hangs' 0 0 -StopSleep 12 -StopWait 2 -StopProcess 3
  $clock = [Diagnostics.Stopwatch]::StartNew()
  $result = [TeruisiTest.Messages]::Send($s.Guard.Handle, 0x11, 0, 0, 60000)
  $elapsed = $clock.ElapsedMilliseconds
  Check ($result -eq 1 -and $elapsed -lt 9000) 'stop-timeout-allows-shutdown-within-bound'
  Check (@(Get-LogEvents $s | Where-Object { $_.event -eq 'stop_timeout' }).Count -eq 1 -and ($s.Guard.GetEvents() -join ',') -ceq 'query_end_session,block_create,status,stop,block_destroy') 'stop-timeout-logged-and-block-reason-removed'
  Stop-Scenario $s

  # 6. WM_ENDSESSION is a fallback only: stop once if the query never ran, never twice, cancel resets.
  $s = New-Scenario 'endsession' 0 0
  $result = [TeruisiTest.Messages]::Send($s.Guard.Handle, 0x16, 1, 0x80000000, 60000)
  Check ($result -eq 0 -and (Get-Calls $s).Count -eq 2) 'end-session-without-query-falls-back-to-stop'
  $null = [TeruisiTest.Messages]::Send($s.Guard.Handle, 0x16, 1, 0, 60000)
  Check ((Get-Calls $s).Count -eq 2) 'end-session-after-attempt-does-not-repeat-stop'
  $null = [TeruisiTest.Messages]::Send($s.Guard.Handle, 0x16, 0, 0, 60000)
  Check (@(Get-LogEvents $s | Where-Object { $_.event -eq 'end_session_cancelled' }).Count -eq 1 -and (Get-Calls $s).Count -eq 2) 'cancelled-end-session-only-logged'
  Stop-Scenario $s

  # 7. Fixed defaults, path validation and a missing pg_ctl.
  $ast = [Management.Automation.Language.Parser]::ParseFile($guardScript, [ref]$null, [ref]$null)
  $defaults = @{}
  foreach ($p in $ast.ParamBlock.Parameters) { $defaults[$p.Name.VariablePath.UserPath] = $p.DefaultValue }
  Check ($defaults['PgCtlPath'].Value -ceq 'D:\teruisi-runtime\django-sales\postgresql-17.11\bin\pg_ctl.exe') 'default-pg-ctl-path-is-fixed'
  Check ($defaults['DataDirectory'].Value -ceq 'D:\teruisi-runtime\django-sales\postgres-data') 'default-data-directory-is-fixed'
  Check ($defaults['LogDirectory'].Value -ceq 'D:\teruisi-runtime\django-sales\logs') 'default-log-directory-is-fixed'
  $threw = $false
  try { New-PostgresShutdownGuardHost -PgCtl (Join-Path $root 'missing\pg_ctl.exe') -Data $root -Logs $root | Out-Null } catch { $threw = $true }
  Check $threw 'missing-pg-ctl-rejected'
  $threw = $false
  try { New-PostgresShutdownGuardHost -PgCtl (Join-Path $root 'running\pg_ctl.cmd') -Data (Join-Path $root 'running\postgres-data') -Logs $root -StopWait 30 -StopProcessSeconds 30 | Out-Null } catch { $threw = $true }
  Check $threw 'process-ceiling-must-exceed-pg-ctl-wait'
  $other = Get-GuardInstanceMutexName (Join-Path $root 'other')
  Check ((Get-GuardInstanceMutexName $root) -ceq (Get-GuardInstanceMutexName ($root + '\')) -and (Get-GuardInstanceMutexName $root) -cne $other) 'single-instance-mutex-keyed-by-data-directory'

  # 8. Single instance, end to end: a second guard for the same database exits at once.
  $dir = Join-Path $root 'single'
  [IO.Directory]::CreateDirectory((Join-Path $dir 'postgres-data')) | Out-Null
  Copy-Item -LiteralPath (Join-Path $root 'running\pg_ctl.cmd') -Destination (Join-Path $dir 'pg_ctl.cmd')
  [IO.File]::WriteAllText((Join-Path $dir 'status.code'), '3'); [IO.File]::WriteAllText((Join-Path $dir 'stop.code'), '0')
  $argLine = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $guardScript + '" -PgCtlPath "' + (Join-Path $dir 'pg_ctl.cmd') + '" -DataDirectory "' + (Join-Path $dir 'postgres-data') + '" -LogDirectory "' + (Join-Path $dir 'logs') + '"'
  $first = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -ArgumentList $argLine -WindowStyle Hidden -PassThru
  try {
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    $singleLog = Join-Path $dir 'logs\postgres-shutdown-guard.jsonl'
    while (-not (Test-Path -LiteralPath $singleLog) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 200 }
    Check (Test-Path -LiteralPath $singleLog) 'first-guard-started'
    $second = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -ArgumentList $argLine -WindowStyle Hidden -PassThru
    Check ($second.WaitForExit(30000) -and $second.ExitCode -eq 0) 'second-guard-exits-immediately'
    Check (-not $first.HasExited) 'first-guard-keeps-running'
    Check (@(Get-Content -LiteralPath $singleLog | Where-Object { $_ -like '*guard_started*' }).Count -eq 1) 'only-one-guard-window'
  } finally {
    if ($first -and -not $first.HasExited) { $first.Kill() }
  }

  # 9. Scheduled task definition (in memory only: nothing is registered or started).
  $ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $def = New-PostgresShutdownGuardTaskDefinition -ScriptPath 'D:\teruisi-runtime\postgres-shutdown-guard\postgres-shutdown-guard.ps1' -PowerShell $ps -User 'TESTPC\tester'
  Check ($def.TaskName -ceq 'TERUISI Postgres Shutdown Guard') 'task-name'
  Check ($def.Action.Execute -ieq $ps -and $def.Action.Arguments -ceq '-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "D:\teruisi-runtime\postgres-shutdown-guard\postgres-shutdown-guard.ps1"') 'task-command-line'
  Check ($def.Trigger.CimClass.CimClassName -ceq 'MSFT_TaskLogonTrigger' -and $def.Trigger.UserId -ceq 'TESTPC\tester') 'task-trigger-is-user-logon'
  Check ($def.Principal.UserId -ceq 'TESTPC\tester' -and [string]$def.Principal.LogonType -ceq 'Interactive' -and [string]$def.Principal.RunLevel -ceq 'Limited') 'task-runs-as-the-logged-on-user-without-elevation'
  Check ($def.Settings.Hidden -eq $true -and [string]$def.Settings.MultipleInstances -ceq 'IgnoreNew' -and $def.Settings.ExecutionTimeLimit -ceq 'PT0S') 'task-hidden-single-instance-unlimited-runtime'
  $before = @(Get-ScheduledTask -TaskName 'TERUISI Postgres Shutdown Guard' -ErrorAction SilentlyContinue).Count
  $planJson = & $ps -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $registerScript -Action Plan -TaskName 'TERUISI Postgres Shutdown Guard TEST ONLY' -InstallRoot (Join-Path $root 'install')
  $plan = ($planJson -join "`n") | ConvertFrom-Json
  Check ($plan.status -ceq 'plan' -and $plan.hidden -eq $true -and $plan.taskExists -eq $false -and -not (Test-Path -LiteralPath (Join-Path $root 'install'))) 'plan-registers-nothing-and-copies-nothing'
  $refused = 0
  $ErrorActionPreference = 'Continue'
  foreach ($mutating in @('Install', 'Uninstall')) {
    & $ps -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $registerScript -Action $mutating -TaskName 'TERUISI Postgres Shutdown Guard TEST ONLY' -InstallRoot (Join-Path $root 'install') 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { $refused++ }
  }
  $ErrorActionPreference = 'Stop'
  Check ($refused -eq 2 -and -not (Test-Path -LiteralPath (Join-Path $root 'install')) -and $null -eq (Get-ScheduledTask -TaskName 'TERUISI Postgres Shutdown Guard TEST ONLY' -ErrorAction SilentlyContinue)) 'install-and-uninstall-refuse-without-execute'
  Check (@(Get-ScheduledTask -TaskName 'TERUISI Postgres Shutdown Guard' -ErrorAction SilentlyContinue).Count -eq $before) 'test-did-not-change-the-real-scheduler'

  [Console]::Out.WriteLine((@{ passed = $true; checks = @($script:checks.ToArray()) } | ConvertTo-Json -Compress))
} finally {
  # Temporary fixtures only; nothing else is cleaned or stopped.
  Start-Sleep -Milliseconds 300
  try { Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction Stop } catch { }
}
