$ErrorActionPreference = "Stop"
$WorkspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$ServiceScript = Join-Path $WorkspaceRoot "tools\django-local-service.ps1"
$TestPython = if ($env:TERUISI_DJANGO_TEST_PYTHON) {
  $env:TERUISI_DJANGO_TEST_PYTHON
} else {
  "D:\teruisi-runtime\django-sales\venv\Scripts\python.exe"
}

if (-not (Test-Path -LiteralPath $TestPython -PathType Leaf)) {
  Write-Output "SKIP: managed venv Python is not installed"
  exit 0
}

$TestRoot = Join-Path $WorkspaceRoot (".runtime\process-snapshot-cache-test-" + [Guid]::NewGuid().ToString("N"))
$LogRoot = Join-Path $TestRoot "logs"
$RunRoot = Join-Path $TestRoot "run"
$PidFileA = Join-Path $RunRoot "cache-a.json"
$PidFileB = Join-Path $RunRoot "cache-b.json"
$StdoutA = Join-Path $LogRoot "a.stdout.log"
$StderrA = Join-Path $LogRoot "a.stderr.log"
$StdoutB = Join-Path $LogRoot "b.stdout.log"
$StderrB = Join-Path $LogRoot "b.stderr.log"
$Arguments = @("-c", "import time;time.sleep(90)")
$Fingerprint = "e" * 64
$SnapshotA = $null
$SnapshotB = $null
$env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY = "1"

try {
  # This fixture never dispatches a lifecycle action; it only loads the
  # function library, exactly like the sibling identity fixture.
  . $ServiceScript -Action Start -RuntimeRoot $TestRoot
  New-Item -ItemType Directory -Path $TestRoot, $LogRoot, $RunRoot -Force | Out-Null

  # The cache must default to off so every pre-existing call site (process
  # tree inspection, termination, Resolve-OwnedProcess) is unaffected unless
  # something explicitly opts in.
  if ($null -ne $script:ProcessSnapshotCache) {
    throw "process-snapshot cache must default to unpopulated"
  }

  Start-ManagedProcess "cache-test-a" $TestPython $Arguments $TestRoot $PidFileA $Fingerprint $StdoutA $StderrA | Out-Null
  $SnapshotA = Resolve-OwnedProcess "cache-test-a" $PidFileA $TestPython $Arguments $Fingerprint
  if (-not $SnapshotA) { throw "process A failed to start" }
  Start-ManagedProcess "cache-test-b" $TestPython $Arguments $TestRoot $PidFileB $Fingerprint $StdoutB $StderrB | Out-Null
  $SnapshotB = Resolve-OwnedProcess "cache-test-b" $PidFileB $TestPython $Arguments $Fingerprint
  if (-not $SnapshotB) { throw "process B failed to start" }

  $liveSnapshotA = Get-ProcessSnapshot ([int]$SnapshotA.ProcessId) 1
  $liveSnapshotB = Get-ProcessSnapshot ([int]$SnapshotB.ProcessId) 1
  if ($null -eq $liveSnapshotA -or $null -eq $liveSnapshotB) {
    throw "fixture processes did not resolve on the live path"
  }

  # --- Scenario 1: one populated cache serves both PIDs, with the same shape
  # as the live (uncached) result for the same PID. --------------------------
  Initialize-ProcessSnapshotCache
  try {
    if ($null -eq $script:ProcessSnapshotCache) {
      throw "Initialize-ProcessSnapshotCache left the cache unpopulated"
    }
    $cachedA = Get-ProcessSnapshot ([int]$SnapshotA.ProcessId) 1
    $cachedB = Get-ProcessSnapshot ([int]$SnapshotB.ProcessId) 1
    if ($null -eq $cachedA -or $null -eq $cachedB) {
      throw "cached lookups returned no snapshot for a live PID"
    }
    if (-not (Test-ProcessSnapshotIdentity $cachedA $liveSnapshotA)) {
      throw "cached snapshot for PID A diverged from the live snapshot"
    }
    if (-not (Test-ProcessSnapshotIdentity $cachedB $liveSnapshotB)) {
      throw "cached snapshot for PID B diverged from the live snapshot"
    }
    $cachedAProperties = @($cachedA.PSObject.Properties.Name | Sort-Object)
    $liveAProperties = @($liveSnapshotA.PSObject.Properties.Name | Sort-Object)
    if (($cachedAProperties -join ",") -cne ($liveAProperties -join ",")) {
      throw "cached snapshot shape differs from the live snapshot shape"
    }

    # --- Scenario 2: a PID absent from the cache still resolves via the live
    # path; the cache must never manufacture a false "absent". --------------
    $missingProcessId = -1
    while ($true) {
      $missingProcessId = Get-Random -Minimum 100000 -Maximum 999999
      if (-not $script:ProcessSnapshotCache.ContainsKey($missingProcessId) -and
          -not (Get-Process -Id $missingProcessId -ErrorAction SilentlyContinue)) {
        break
      }
    }
    $uncachedLookup = Get-ProcessSnapshot $missingProcessId 1
    if ($null -ne $uncachedLookup) {
      throw "a PID with no live process unexpectedly resolved to a snapshot"
    }
    # And a real, live PID that the enumeration simply didn't carry forward
    # (simulated by deleting its cache entry) must still resolve live rather
    # than report false absence.
    $script:ProcessSnapshotCache.Remove([int]$SnapshotA.ProcessId)
    $fallbackA = Get-ProcessSnapshot ([int]$SnapshotA.ProcessId) 1
    if ($null -eq $fallbackA -or -not (Test-ProcessSnapshotIdentity $fallbackA $liveSnapshotA)) {
      throw "a PID missing from the cache did not fall through to the live path"
    }

    # --- Scenario 3: a cached row with blank metadata must not satisfy the
    # request; it must fall through and still throw metadata-unavailable
    # rather than returning a usable snapshot or $null. ----------------------
    $blankRow = [pscustomobject]@{
      ProcessId = [int]$SnapshotB.ProcessId
      ExecutablePath = ""
      CommandLine = ""
      CreationDate = $null
      ParentProcessId = 0
    }
    $script:ProcessSnapshotCache[[int]$SnapshotB.ProcessId] = @($blankRow)
    $threw = $false
    $thrownMessage = ""
    try {
      Get-ProcessSnapshot ([int]$SnapshotB.ProcessId) 1 | Out-Null
    } catch {
      $threw = $true
      $thrownMessage = $_.Exception.Message
    }
    if (-not $threw) {
      throw "a blank-metadata cached row was accepted instead of falling through"
    }
    if ($thrownMessage -notmatch "absence is not established") {
      throw "blank-metadata fallback raised the wrong error: $thrownMessage"
    }
    # With more attempts available, the same blank cached row must still let
    # the live retry loop win once the cache's single first-attempt chance is
    # spent, proving the cache cannot block the existing retry/liveness path.
    $resumed = Get-ProcessSnapshot ([int]$SnapshotB.ProcessId) 3
    if ($null -eq $resumed -or -not (Test-ProcessSnapshotIdentity $resumed $liveSnapshotB)) {
      throw "a blank cached row prevented the live retry loop from resolving a real process"
    }

    # --- Ambiguity must still be honored when the cache (hypothetically)
    # carries more than one row for a PID. ------------------------------------
    $script:ProcessSnapshotCache[[int]$SnapshotA.ProcessId] = @($liveSnapshotA.Process, $liveSnapshotA.Process)
    $ambiguous = $false
    try {
      Get-ProcessSnapshot ([int]$SnapshotA.ProcessId) 1 | Out-Null
    } catch {
      $ambiguous = ($_.Exception.Message -match "Ambiguous process metadata")
    }
    if (-not $ambiguous) {
      throw "a cache row with duplicate entries for one PID did not trip the ambiguity check"
    }
  } finally {
    Clear-ProcessSnapshotCache
  }

  # --- Scenario 4: the cache must not leak past Show-AggregateServiceStatus,
  # so termination/process-tree paths can never observe it. -------------------
  if ($null -ne $script:ProcessSnapshotCache) {
    throw "cache was not cleared before exercising Show-AggregateServiceStatus"
  }
  Initialize-ProcessSnapshotCache
  if ($null -eq $script:ProcessSnapshotCache) {
    throw "re-populating the cache for the aggregate-status leak check failed"
  }
  try {
    Show-AggregateServiceStatus | Out-Null
  } catch {
    # AggregateStatus can legitimately fail outside a fully configured
    # runtime (missing config, no services installed); only the cache
    # lifecycle around it is under test here.
  }
  if ($null -ne $script:ProcessSnapshotCache) {
    throw "Show-AggregateServiceStatus did not clear the process-snapshot cache"
  }

  # The two fixture processes must still be observable live after all of the
  # above cache manipulation, proving no cached state corrupted real control.
  $postSnapshotA = Get-ProcessSnapshot ([int]$SnapshotA.ProcessId) 1
  $postSnapshotB = Get-ProcessSnapshot ([int]$SnapshotB.ProcessId) 1
  if ($null -eq $postSnapshotA -or -not (Test-ProcessSnapshotIdentity $postSnapshotA $liveSnapshotA)) {
    throw "process A identity was not stable after cache manipulation"
  }
  if ($null -eq $postSnapshotB -or -not (Test-ProcessSnapshotIdentity $postSnapshotB $liveSnapshotB)) {
    throw "process B identity was not stable after cache manipulation"
  }

  Write-Output ("PASS: cached={0}; uncachedFallback=ok; blankMetadataFallthrough=ok; ambiguityPreserved=ok; clearedAfterAggregateStatus=ok" -f $cachedA.ProcessId)
} finally {
  Remove-Item Env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY -ErrorAction SilentlyContinue
  Clear-ProcessSnapshotCache
  foreach ($snapshot in @($SnapshotA, $SnapshotB)) {
    if (-not $snapshot) { continue }
    $current = Get-ProcessSnapshot ([int]$snapshot.ProcessId) 1
    if ($current -and (Test-ProcessSnapshotIdentity $current $snapshot)) {
      Stop-Process -Id $snapshot.ProcessId -Force -ErrorAction SilentlyContinue
    }
  }
  foreach ($file in @($PidFileA, $PidFileB, $StdoutA, $StderrA, $StdoutB, $StderrB, (Join-Path $LogRoot "launcher.jsonl"))) {
    if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file -Force }
  }
  foreach ($directory in @($LogRoot, $RunRoot, $TestRoot)) {
    if ([IO.Directory]::Exists($directory)) { [IO.Directory]::Delete($directory, $true) }
  }
}
