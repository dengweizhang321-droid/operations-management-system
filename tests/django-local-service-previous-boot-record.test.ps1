$ErrorActionPreference = "Stop"

# A previous-boot ownership record cannot own a live process, but the numeric PID
# it names can already belong to a process whose CIM metadata this account cannot
# read (observed after an unexpected reboot, when a reused PID landed on another
# session's svchost).  Unreadable metadata is never evidence of absence, so only a
# record that provably predates the current boot may be dropped -- everything else
# must stay fail-closed.  This test pins both directions without touching any
# process other than the read-only System PID.
$WorkspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$ServiceScript = Join-Path $WorkspaceRoot "tools\django-local-service.ps1"
$TestRoot = Join-Path ([IO.Path]::GetTempPath()) (
  "tds-previous-boot-record-" + [Guid]::NewGuid().ToString("N")
)
$RunRoot = Join-Path $TestRoot "run"
$PidFile = Join-Path $RunRoot "reused-unreadable.pid.json"
$LauncherLog = Join-Path $TestRoot "logs\launcher.jsonl"
$Launcher = Join-Path $TestRoot "waitress-serve.exe"
$Fingerprint = ("a" * 64)
$ExpectedArguments = @("--listen=127.0.0.1:8112")
$Utf8NoBom = [Text.UTF8Encoding]::new($false)
$previousLibraryOnly = [Environment]::GetEnvironmentVariable(
  "TERUISI_DJANGO_SERVICE_LIBRARY_ONLY",
  "Process"
)

function Write-OwnershipRecord(
  [int]$ProcessId,
  [string]$CreationDate,
  [string]$StartedAt,
  [DateTime]$RecordWriteTimeUtc
) {
  $record = [ordered]@{
    version = 2
    service = "django-ai-writer"
    processId = $ProcessId
    creationDate = $CreationDate
    launcherPath = $Launcher
    executablePath = $Launcher
    commandLine = "waitress-serve --listen=127.0.0.1:8112"
    arguments = @($ExpectedArguments)
    configFingerprint = $Fingerprint
    startedAt = $StartedAt
    runId = "previous-boot-record-test"
  }
  [IO.File]::WriteAllText($PidFile, ($record | ConvertTo-Json -Depth 8), $Utf8NoBom)
  [IO.File]::SetLastWriteTimeUtc($PidFile, $RecordWriteTimeUtc)
}

function Get-LauncherEvents {
  if (-not (Test-Path -LiteralPath $LauncherLog -PathType Leaf)) { return "" }
  return (Get-Content -Raw -LiteralPath $LauncherLog)
}

try {
  New-Item -ItemType Directory -Path $TestRoot, $RunRoot -Force | Out-Null
  $env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY = "1"
  . $ServiceScript -Action Start -RuntimeRoot $TestRoot

  # Fixture prerequisite: this PID exists, but its metadata is unreadable here.
  $unreadableReuse = $false
  try { Get-ProcessSnapshot 4 1 | Out-Null } catch { $unreadableReuse = $true }
  if (-not $unreadableReuse) {
    throw "fixture prerequisite failed: PID 4 metadata is readable on this host"
  }
  $bootTimeUtc = Get-SystemBootTimeUtc
  $previousBootTime = $bootTimeUtc.AddMinutes(-5)
  $previousBootTimestamp = $previousBootTime.ToString("o")

  # Case 1: the record provably predates the current boot, so it cannot own a live
  # process and must be dropped instead of deadlocking every later Start.
  Write-OwnershipRecord 4 $previousBootTimestamp $previousBootTimestamp $previousBootTime
  $resolved = Resolve-OwnedProcess `
    "django-ai-writer" $PidFile $Launcher $ExpectedArguments $Fingerprint
  if ($null -ne $resolved) { throw "previous-boot record resolved to a live process" }
  if (Test-Path -LiteralPath $PidFile) { throw "previous-boot record was not removed" }
  if ((Get-LauncherEvents) -notmatch "previous_boot_process_record_removed") {
    throw "previous-boot record removal was not reported as safe cleanup"
  }
  if ((Get-LauncherEvents) -match "stale_process_record_removed") {
    throw "a cleaned previous-boot residue was rereported as a stale record"
  }
  # The reused live process itself must never be inspected for termination or stopped.
  if (@(Get-CimInstance Win32_Process -Filter "ProcessId = 4" -ErrorAction Stop).Count -ne 1) {
    throw "the reused live process was terminated or replaced"
  }

  # Case 2: a record written during the current boot cannot be previous-boot
  # evidence, so unreadable metadata must stay fail-closed and keep the record.
  $currentBootTimestamp = [DateTimeOffset]::UtcNow.ToString("o")
  Write-OwnershipRecord 4 $currentBootTimestamp $currentBootTimestamp ([DateTime]::UtcNow)
  $refused = $false
  try {
    Resolve-OwnedProcess "django-ai-writer" $PidFile $Launcher $ExpectedArguments $Fingerprint | Out-Null
  } catch {
    $refused = ([string]$_.Exception.Message) -like "Process metadata is unavailable; absence is not established:*"
  }
  if (-not $refused) { throw "unreadable reuse without previous-boot proof was not refused" }
  if (-not (Test-Path -LiteralPath $PidFile)) {
    throw "a current-boot record was removed as previous-boot residue"
  }

  # Case 3: observation-only resolution (Status) may never clean ownership records,
  # even when the record provably predates the current boot.
  Write-OwnershipRecord 4 $previousBootTimestamp $previousBootTimestamp $previousBootTime
  $readOnlyRefused = $false
  try {
    Resolve-OwnedProcess "django-ai-writer" $PidFile $Launcher $ExpectedArguments $Fingerprint -ReadOnly | Out-Null
  } catch {
    $readOnlyRefused = $true
  }
  if (-not $readOnlyRefused) { throw "read-only resolution accepted unreadable reuse" }
  if (-not (Test-Path -LiteralPath $PidFile)) {
    throw "read-only resolution removed an ownership record"
  }

  # Case 4: absence keeps its existing behaviour -- the record is dropped and the
  # stale-record event (not the previous-boot event) is reported.
  $liveProcessIds = @{}
  foreach ($process in @(Get-CimInstance Win32_Process -ErrorAction Stop)) {
    $liveProcessIds[[int]$process.ProcessId] = $true
  }
  $absentProcessId = 0
  foreach ($candidate in 64000..64020) {
    if (-not $liveProcessIds.ContainsKey($candidate)) { $absentProcessId = $candidate; break }
  }
  if ($absentProcessId -eq 0) { throw "fixture prerequisite failed: no unused PID candidate" }
  Remove-Item -LiteralPath $PidFile -Force
  Write-OwnershipRecord $absentProcessId $previousBootTimestamp $previousBootTimestamp $previousBootTime
  $absentResolution = Resolve-OwnedProcess `
    "django-ai-writer" $PidFile $Launcher $ExpectedArguments $Fingerprint
  if ($null -ne $absentResolution -or (Test-Path -LiteralPath $PidFile)) {
    throw "an absent reused PID no longer drops its stale record"
  }
  if ((Get-LauncherEvents) -notmatch "stale_process_record_removed") {
    throw "stale-record removal was not reported for an absent PID"
  }
  if (@(Get-CimInstance Win32_Process -Filter "ProcessId = $absentProcessId" -ErrorAction Stop).Count -ne 0) {
    throw "the unused PID fixture was taken by another process"
  }

  Write-Output (
    "PASS: previous-boot records are dropped only when provable; " +
    "unreadable reuse without proof and read-only observation stay fail-closed"
  )
} finally {
  [Environment]::SetEnvironmentVariable(
    "TERUISI_DJANGO_SERVICE_LIBRARY_ONLY",
    $previousLibraryOnly,
    "Process"
  )
  if (Test-Path -LiteralPath $TestRoot -PathType Container) {
    Remove-Item -LiteralPath $TestRoot -Recurse -Force
  }
}
