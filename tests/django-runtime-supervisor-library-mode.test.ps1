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

  # --- Case 3b: production-side check for ownership_check_failed and
  # ownership_error. This runs the REAL "Status" action body as currently
  # extracted from source by tools/prepare-watchdog-supervisor-status-driver.mjs
  # (the exact same extraction the generated driver uses), not a
  # hand-copied stand-in. If that catch block's classification logic is
  # ever removed or weakened, this test must go red - unlike a test that
  # only exercises the consuming side (Get-WatchDecision/
  # Get-WatchFailureText), which cannot detect that the supervisor script
  # itself stopped producing the value at all.
  #
  # Resolve-SupervisorProcess is overridden with a controlled throw so the
  # trigger is deterministic and independent of exactly which internal
  # exception type a real identity check happens to surface; the code under
  # test here is the catch block's classification logic, not
  # Resolve-SupervisorProcess's own body (that is covered separately in
  # Cases 1/2 and in watchdog-supervisor-readonly.test.mjs).
  $extractorModule = Join-Path $PSScriptRoot '..\tools\prepare-watchdog-supervisor-status-driver.mjs'
  $nodeExe = (Get-Command 'node.exe' -ErrorAction SilentlyContinue)
  if (-not $nodeExe) { $nodeExe = Get-Command 'node' -ErrorAction Stop }
  $extractScript = Join-Path ([IO.Path]::GetTempPath()) ('teruisi-extract-status-' + [Guid]::NewGuid().ToString('N') + '.mjs')
  $statusOutFile = Join-Path ([IO.Path]::GetTempPath()) ('teruisi-extract-status-' + [Guid]::NewGuid().ToString('N') + '.txt')
  try {
    # node's default ESM loader rejects a bare absolute Windows path
    # ("D:\...") as an import specifier (ERR_UNSUPPORTED_ESM_URL_SCHEME);
    # it must be converted to a file:// URL first.
    $extractorModuleEscaped = $extractorModule.Replace('\', '\\').Replace("'", "\'")
    $supervisorSourceEscaped = $supervisorSource.Replace('\', '\\').Replace("'", "\'")
    $statusOutFileEscaped = $statusOutFile.Replace('\', '\\').Replace("'", "\'")
    $extractSource = "import {pathToFileURL} from 'node:url';" +
      "import fs from 'node:fs/promises';" +
      "const {readonlySupervisor} = await import(pathToFileURL('$extractorModuleEscaped').href);" +
      "const source = await fs.readFile('$supervisorSourceEscaped', 'utf8');" +
      "const result = readonlySupervisor(source);" +
      "await fs.writeFile('$statusOutFileEscaped', result.status);"
    [IO.File]::WriteAllText($extractScript, $extractSource, [Text.UTF8Encoding]::new($false))
    $nodeProc = Start-Process -FilePath $nodeExe.Source -ArgumentList @($extractScript) -PassThru -Wait -WindowStyle Hidden -RedirectStandardOutput ([IO.Path]::GetTempFileName()) -RedirectStandardError ([IO.Path]::GetTempFileName())
    Assert-LibraryMode ($nodeProc.ExitCode -eq 0) 'extracting the real Status action body via the production .mjs failed'
    $statusBodyText = [IO.File]::ReadAllText($statusOutFile)
    Assert-LibraryMode ($statusBodyText -match 'ownership_check_failed' -and $statusBodyText -match 'ownership_error') 'the extracted production Status body no longer contains both classification labels'
    $statusBlock = [scriptblock]::Create($statusBodyText)

    & {
      $env:TERUISI_DJANGO_SUPERVISOR_LIBRARY_ONLY = '1'
      try {
        . $fixtureSupervisor -Action Status -RuntimeRoot $fixtureRoot

        # Sub-case: a genuine identity mismatch (bare "throw '<message>'",
        # exact RuntimeException) must still classify as ownership_error
        # through the real extracted body, not just in a hand-written test.
        function Resolve-SupervisorProcess { throw 'synthetic identity mismatch' }
        $result = & $statusBlock
        Assert-LibraryMode ($result.supervisorProcess -eq 'ownership_error') "the real production Status body did not classify a bare throw as ownership_error (got $($result.supervisorProcess))"
        Assert-LibraryMode ([string]::IsNullOrEmpty($result.supervisorProcessErrorType)) 'ownership_error must not carry an exception type name - that field is specific to ownership_check_failed'

        # Sub-case: a check-infrastructure failure (any exception type other
        # than the exact bare-throw RuntimeException - here a
        # MethodInvocationException, matching the real original production
        # bug's ArgumentNullException in kind, not in literal type) must
        # classify as ownership_check_failed with the exception type name
        # attached.
        function Resolve-SupervisorProcess { throw [Management.Automation.MethodInvocationException]::new('synthetic check-infrastructure failure') }
        $result = & $statusBlock
        Assert-LibraryMode ($result.supervisorProcess -eq 'ownership_check_failed') "the real production Status body did not classify a non-bare-throw exception as ownership_check_failed (got $($result.supervisorProcess))"
        Assert-LibraryMode ($result.supervisorProcessErrorType -ceq 'MethodInvocationException') "ownership_check_failed did not carry the correct exception type name (got '$($result.supervisorProcessErrorType)')"

        # Sub-case: ParameterBindingValidationException is itself a subclass
        # of RuntimeException (confirmed separately), so a naive "-is
        # [RuntimeException]" check would wrongly admit it as ownership_error.
        # It must still land in ownership_check_failed.
        function Resolve-SupervisorProcess {
          $cmd = { param([Parameter(Mandatory)][string]$X) }
          & $cmd
        }
        $result = & $statusBlock
        Assert-LibraryMode ($result.supervisorProcess -eq 'ownership_check_failed') "a RuntimeException SUBCLASS (parameter binding failure) was wrongly admitted as ownership_error (got $($result.supervisorProcess)); the discriminator must use an exact type match, not -is"
        Assert-LibraryMode (-not [string]::IsNullOrEmpty($result.supervisorProcessErrorType)) 'ownership_check_failed from a RuntimeException subclass must still carry its exception type name'
        Assert-LibraryMode ($result.supervisorProcessErrorType -cne 'RuntimeException') "ownership_check_failed reported the bare 'RuntimeException' type name for a subclass; expected the derived type name, e.g. ParameterBindingValidationException (got '$($result.supervisorProcessErrorType)')"
      } finally {
        Remove-Item Env:\TERUISI_DJANGO_SUPERVISOR_LIBRARY_ONLY -ErrorAction SilentlyContinue
      }
    }
  } finally {
    Remove-Item -LiteralPath $extractScript -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $statusOutFile -Force -ErrorAction SilentlyContinue
  }

  # --- Case 4: normal (non-library) mode must still reject a RuntimeRoot
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
