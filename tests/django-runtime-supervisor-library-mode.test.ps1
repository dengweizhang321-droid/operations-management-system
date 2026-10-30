[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
# Regression test for the exact production bug: when
# tools/django-runtime-supervisor.ps1 is dot-sourced in library mode
# (TERUISI_DJANGO_SUPERVISOR_LIBRARY_ONLY=1) without first running the real
# (non-library) initialization block, path variables such as
# $SupervisorPidPath, $RunDirectory and $SupervisorDesiredStatePath used to
# stay $null, and Resolve-SupervisorProcess / Get-SupervisorDesiredState /
# Read-SupervisorState threw ArgumentNullException (or a parameter binding
# exception on Windows PowerShell 5.1) instead of returning a clean diagnostic
# result. No existing test caught this because none exercised the library-mode
# path in isolation; watchdog-supervisor-readonly.test.mjs mocks the path
# variables directly instead of letting the real init run.
$script:checks = 0
function Assert-LibraryMode($Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
  $script:checks++
}

$supervisorSource = Join-Path $PSScriptRoot '..\tools\django-runtime-supervisor.ps1'
$localServiceSource = Join-Path $PSScriptRoot '..\tools\django-local-service.ps1'

$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) (
  'teruisi-supervisor-library-mode-' + [Guid]::NewGuid().ToString('N')
)
try {
  New-Item -ItemType Directory -Path (Join-Path $fixtureRoot 'app\tools') -Force | Out-Null
  Copy-Item -LiteralPath $supervisorSource -Destination (Join-Path $fixtureRoot 'app\tools\django-runtime-supervisor.ps1')
  Copy-Item -LiteralPath $localServiceSource -Destination (Join-Path $fixtureRoot 'app\tools\django-local-service.ps1')
  $fixtureSupervisor = Join-Path $fixtureRoot 'app\tools\django-runtime-supervisor.ps1'

  # Point the fixed protected runtime root at the fixture for this process
  # only, so the dot-source below runs against a disposable directory
  # instead of the real D:\teruisi-runtime\django-sales. This mirrors the
  # fixed-root pattern used by tools/prepare-watchdog-supervisor-status-driver.mjs's
  # generated driver at install time; it never touches the real runtime.
  # Read/write with a BOM-preserving UTF8 encoding: this source file contains
  # Chinese text and Windows PowerShell 5.1 parses a BOM-less UTF8 file as
  # the system codepage, producing exactly the misleading "unexpected token"
  # parse errors at unrelated lines that this whole task exists to avoid.
  $content = [IO.File]::ReadAllText($fixtureSupervisor, [Text.Encoding]::UTF8)
  $content = $content.Replace('D:\teruisi-runtime\django-sales', $fixtureRoot)
  [IO.File]::WriteAllText($fixtureSupervisor, $content, [Text.UTF8Encoding]::new($true))

  # --- Case 1: library mode alone, no prior real-mode run, no PID receipt ---
  # This is the exact shape of the production bug report: a caller
  # dot-sources the supervisor script in library mode and immediately calls
  # a function that depends on path variables, without the real
  # (non-library) branch ever having run in this process.
  & {
    $env:TERUISI_DJANGO_SUPERVISOR_LIBRARY_ONLY = '1'
    try {
      . $fixtureSupervisor -Action Status -RuntimeRoot $fixtureRoot
      Assert-LibraryMode ($null -ne $SupervisorPidPath) 'SupervisorPidPath must not be null after a library-mode load'
      Assert-LibraryMode ($null -ne $RunDirectory) 'RunDirectory must not be null after a library-mode load'
      Assert-LibraryMode ($null -ne $SupervisorDesiredStatePath) 'SupervisorDesiredStatePath must not be null after a library-mode load'
      $threw = $false
      $exceptionType = $null
      try {
        $process = Resolve-SupervisorProcess
        Assert-LibraryMode ($null -eq $process) 'with no PID receipt present, Resolve-SupervisorProcess must cleanly report absence'
      } catch {
        $threw = $true
        $exceptionType = $_.Exception.GetType().FullName
      }
      Assert-LibraryMode (-not $threw) "Resolve-SupervisorProcess must not throw in library mode when no receipt exists (threw $exceptionType)"
      # The two other functions that depend on the same uninitialized-in-the-
      # original-bug path variables must also complete without throwing.
      $desired = Get-SupervisorDesiredState
      Assert-LibraryMode ($desired.desiredState -ceq 'stopped' -and $desired.reason -ceq 'missing_fail_closed') 'Get-SupervisorDesiredState must fail closed, not throw, when no desired-state file exists yet'
      $state = Read-SupervisorState
      Assert-LibraryMode ($state.code -ceq 'not_probed') 'Read-SupervisorState must return the default not_probed state, not throw'
    } finally {
      Remove-Item Env:\TERUISI_DJANGO_SUPERVISOR_LIBRARY_ONLY -ErrorAction SilentlyContinue
    }
  }

  # --- Case 2: same library-mode load, but with a PID receipt whose identity
  # does not match the current operator script. This must still surface as
  # a genuine ownership mismatch (RuntimeException from a deliberate throw),
  # proving the fix does not turn every call into a false "absent" result.
  & {
    $runDir = Join-Path $fixtureRoot 'run'
    New-Item -ItemType Directory -Path $runDir -Force | Out-Null
    $receipt = [ordered]@{
      version = 'teruisi-django-supervisor-process-v1'
      processId = 999999
      creationDate = '2026-01-01T00:00:00Z'
      executablePath = 'C:\nonexistent\fake.exe'
      commandLine = 'fake command line'
      scriptPathSha256 = ('a' * 64)
      scriptSha256 = ('a' * 64)
      startedAt = '2026-01-01T00:00:00Z'
    }
    [IO.File]::WriteAllText(
      (Join-Path $runDir 'django-supervisor.pid.json'),
      ($receipt | ConvertTo-Json),
      [Text.UTF8Encoding]::new($false)
    )
    $env:TERUISI_DJANGO_SUPERVISOR_LIBRARY_ONLY = '1'
    try {
      . $fixtureSupervisor -Action Status -RuntimeRoot $fixtureRoot
      $caught = $null
      try {
        Resolve-SupervisorProcess | Out-Null
        throw 'expected a thrown identity mismatch, got none'
      } catch {
        $caught = $_.Exception
      }
      Assert-LibraryMode ($caught -is [Management.Automation.RuntimeException]) "a genuine identity mismatch must surface as RuntimeException, got $($caught.GetType().FullName)"
    } finally {
      Remove-Item Env:\TERUISI_DJANGO_SUPERVISOR_LIBRARY_ONLY -ErrorAction SilentlyContinue
      Remove-Item -LiteralPath $runDir -Recurse -Force -ErrorAction SilentlyContinue
    }
  }

  # --- Case 3: normal (non-library) mode must still reject a RuntimeRoot
  # outside the fixed protected runtime BEFORE dot-sourcing anything found
  # there. This is the security-ordering guarantee the fix must preserve:
  # path derivation becoming available in library mode must not let an
  # attacker-controlled -RuntimeRoot reach the dot-source in normal mode.
  & {
    $evilRoot = Join-Path ([IO.Path]::GetTempPath()) ('teruisi-evil-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path (Join-Path $evilRoot 'app\tools') -Force | Out-Null
    $marker = Join-Path $evilRoot 'executed.marker'
    [IO.File]::WriteAllText(
      (Join-Path $evilRoot 'app\tools\django-local-service.ps1'),
      "[IO.File]::WriteAllText('$($marker.Replace('\','\\'))','executed')`n",
      [Text.UTF8Encoding]::new($false)
    )
    try {
      $psExe = (Get-Process -Id $PID).Path
      $arguments = @(
        '-NoProfile', '-NonInteractive', '-File', $fixtureSupervisor,
        '-Action', 'Status', '-RuntimeRoot', $evilRoot
      )
      $proc = Start-Process -FilePath $psExe -ArgumentList $arguments -PassThru -Wait -WindowStyle Hidden -RedirectStandardOutput ([IO.Path]::GetTempFileName()) -RedirectStandardError ([IO.Path]::GetTempFileName())
      Assert-LibraryMode ($proc.ExitCode -ne 0) 'a RuntimeRoot outside the fixed protected runtime must fail, not succeed'
      Assert-LibraryMode (-not (Test-Path -LiteralPath $marker)) 'the fixed-root/caller-identity gate must run before any dot-source of a file under an untrusted RuntimeRoot'
    } finally {
      Remove-Item -LiteralPath $evilRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
} finally {
  if (Test-Path -LiteralPath $fixtureRoot) {
    $resolved = [IO.Path]::GetFullPath($fixtureRoot)
    $temp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\', '/')
    if ((Split-Path -Parent $resolved) -ieq $temp -and
        [IO.Path]::GetFileName($resolved) -cmatch '^teruisi-supervisor-library-mode-[0-9a-f]{32}$') {
      Remove-Item -LiteralPath $resolved -Recurse -Force
    }
  }
}

Write-Output ((@{checks = $script:checks; productionTouched = $false} | ConvertTo-Json -Compress))
