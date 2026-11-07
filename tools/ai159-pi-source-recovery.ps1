param(
  [Parameter(Mandatory)][ValidateSet('RestoreRunner','ReleaseKeeper')][string]$Action,
  [Parameter(Mandatory)][string]$Invocation,
  [switch]$Json
)
$ErrorActionPreference = 'Stop'
$RecoveryAction = $Action
$RecoveryInvocation = $Invocation
$RecoveryScriptRoot = $PSScriptRoot
$RecoveryRuntime = 'D:\teruisi-runtime\django-sales'
$RecoveryOriginalAttempt = 'D:\codex-isolated\main-release-packages\e030caba1271-aaab2674-b0c1080e\publish-e030caba1271'
$RecoveryInvocationRoot = Join-Path $RecoveryOriginalAttempt 'resume-ai159\attempts'
$RecoveryStartGuard = Join-Path $RecoveryOriginalAttempt 'PiRunnerRecovery-started.json'
$RecoveryNativeScript = Join-Path $RecoveryRuntime 'app\tools\django-local-service.ps1'
$RecoveryMaintenanceId = 'eaf8c8abb0984e2482a9eb3edfed1429'
[string]$RecoverySourceCommit = 'e030caba1271d47fced663649f288855234a02e2'
[string]$RecoveryOperationId = '88b7e64f18dd4afdb67869895c5d7f1e'

function Assert-PlainPath([string]$RecoveryFile) {
  $RecoveryPathItem = Get-Item -LiteralPath $RecoveryFile -Force
  while ($RecoveryPathItem) {
    if ($RecoveryPathItem.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Runner recovery path contains a reparse point' }
    $RecoveryPathItem = if ($RecoveryPathItem.PSIsContainer) { $RecoveryPathItem.Parent } else { $RecoveryPathItem.Directory }
  }
}

function Assert-OriginalFile([string]$RecoveryFile, [string]$RecoveryDigest) {
  Assert-PlainPath $RecoveryFile
  if ((Get-FileHash -LiteralPath $RecoveryFile -Algorithm SHA256).Hash.ToLowerInvariant() -cne $RecoveryDigest) { throw 'Runner recovery original bytes changed' }
}

function Save-RecoveryRecord([string]$RecoveryFile, [Collections.IDictionary]$RecoveryValue) {
  foreach ($RecoveryFieldValue in $RecoveryValue.Values) {
    if ($RecoveryFieldValue -is [string] -or $RecoveryFieldValue -is [bool] -or $RecoveryFieldValue -is [int]) { continue }
    if ($RecoveryFieldValue -is [array] -and @($RecoveryFieldValue | Where-Object { $_ -isnot [string] }).Count -eq 0) { continue }
    throw 'Recovery receipt contains a non-primitive value'
  }
  $RecoveryBytes = [Text.UTF8Encoding]::new($false).GetBytes(($RecoveryValue | ConvertTo-Json -Depth 8 -Compress) + "`n")
  $RecoveryStream = [IO.File]::Open($RecoveryFile, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
  try { $RecoveryStream.Write($RecoveryBytes, 0, $RecoveryBytes.Length); $RecoveryStream.Flush($true) } finally { $RecoveryStream.Dispose() }
}

$RecoveryInvocation = [IO.Path]::GetFullPath($RecoveryInvocation)
if ((Split-Path -Parent $RecoveryInvocation) -ine $RecoveryInvocationRoot -or (Split-Path -Leaf $RecoveryInvocation) -cnotmatch '^[a-f0-9]{32}$' -or
    -not (Test-Path -LiteralPath $RecoveryInvocation -PathType Container)) { throw 'Runner recovery invocation path is outside the original recovery directory' }
Assert-PlainPath $RecoveryInvocation
$RecoveryPrincipal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if ($RecoveryPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Runner recovery requires the ordinary publisher identity' }
Assert-OriginalFile $RecoveryNativeScript '37c6dc571aeefe4954f977f5b3a64ec08516362a67775729f45f60b17bca99a6'
Assert-OriginalFile (Join-Path $RecoveryOriginalAttempt 'FAILED.json') '2b70da417a977fb6a32b666181adcf3b70402f5449fa986239a0687bb8ad8ef0'
Assert-OriginalFile (Join-Path $RecoveryOriginalAttempt 'STARTED.json') 'fa16a6ba406f55213bdac1d9c1c92120ca76cb78eb8191c5704c5d405045a01b'
Assert-OriginalFile (Join-Path $RecoveryOriginalAttempt 'PiUpgrade-original-failure.json') '1b0a1481ea31f38ba64ef3722f51e9e6f806d95949b515ee790b1b4daa1a1b68'
$RecoveryPreviousLibraryOnly = [Environment]::GetEnvironmentVariable('TERUISI_DJANGO_SERVICE_LIBRARY_ONLY', 'Process')
try {
  $env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY = '1'
  . $RecoveryNativeScript -RuntimeRoot $RecoveryRuntime
} finally {
  [Environment]::SetEnvironmentVariable('TERUISI_DJANGO_SERVICE_LIBRARY_ONLY', $RecoveryPreviousLibraryOnly, 'Process')
}
$Action = $RecoveryAction
$RecoveryWsl = Join-Path $env:SystemRoot 'System32\wsl.exe'
$RecoveryKeeperPath = Join-Path $RecoveryInvocation 'RunnerKeeper.json'
[string[]]$RecoveryKeeperArguments = @('-d','TERUISI-Pandas','-u','teruisi-pandas','--exec','/usr/bin/sleep','2147483647')
[string[]]$RecoveryFormalArguments = @('-d','TERUISI-Pandas','-u','teruisi-pandas','--exec','/usr/bin/sleep','infinity')
$RecoveryKeeperCommandPattern = '^(?:"[^"\r\n]+"|\S+)\s+' + [regex]::Escape(($RecoveryKeeperArguments -join ' ')) + '$'
$RecoveryFormalCommandPattern = '^(?:"[^"\r\n]+"|\S+)\s+' + [regex]::Escape(($RecoveryFormalArguments -join ' ')) + '$'

function Read-RecoveryRecord([string]$RecoveryFile) {
  Assert-PlainPath $RecoveryFile
  return Read-JsonFile $RecoveryFile 'AI159 Runner recovery record'
}

function Get-RecoveryKeeper([object]$RecoveryRecord) {
  if ($RecoveryRecord.operationId -cne $RecoveryOperationId -or $RecoveryRecord.sourceCommit -cne $RecoverySourceCommit -or
      -not (Test-ExactStringArray @($RecoveryRecord.arguments) $RecoveryKeeperArguments) -or
      [string]$RecoveryRecord.executablePath -ine $RecoveryWsl -or [int]$RecoveryRecord.processId -le 0) { throw 'Recovery keeper receipt binding changed' }
  $RecoveryCurrentProcess = Get-ProcessSnapshot ([int]$RecoveryRecord.processId) 1
  if (-not $RecoveryCurrentProcess -or $RecoveryCurrentProcess.CreationDate -cne (ConvertTo-CanonicalCreationDate $RecoveryRecord.creationDate) -or
      $RecoveryCurrentProcess.ExecutablePath -ine $RecoveryWsl -or $RecoveryCurrentProcess.CommandLine -cne $RecoveryRecord.commandLine -or
      $RecoveryCurrentProcess.CommandLine -cnotmatch $RecoveryKeeperCommandPattern) { throw 'Recovery keeper process identity changed' }
  return $RecoveryCurrentProcess
}

Invoke-WithServiceMutex {
  Assert-DeployedApplication
  Assert-RuntimeAclHardened
  if ($RecoveryAction -ceq 'RestoreRunner') {
    Assert-ProductionMaintenance 'AI159 Runner recovery'
    $RecoveryMaintenance = Read-SystemMaintenance
    if ($RecoveryMaintenance.id -cne $RecoveryMaintenanceId -or $RecoveryMaintenance.keepPostgres -cne $true) { throw 'Original maintenance identity changed' }
    if ((Test-Path -LiteralPath $RecoveryStartGuard) -or (Test-Path -LiteralPath (Join-Path $RecoveryOriginalAttempt 'PiReconcile-started.json'))) {
      throw 'Original Runner recovery or reconciliation already started'
    }
    if (Get-ProcessSnapshot 30664 1) { throw 'Original Runner upgrade controller PID is still occupied' }
    foreach ($RecoveryPort in @(8111,8112,8123)) {
      if (@(Get-PortListeners $RecoveryPort).Count -gt 0) { throw 'An AI or Runner port still has an owner' }
    }
    if (Resolve-OwnedProcess 'django-ai-pi-worker' (Join-Path $RunDirectory 'django-ai-pi-worker.pid.json') $Python -ReadOnly) {
      throw 'The original Pi worker is still present'
    }
    $RecoveryParticipants = @(Get-CimInstance Win32_Process -Filter "Name = 'wsl.exe' OR Name = 'python.exe' OR Name = 'pythonw.exe'" -ErrorAction Stop)
    foreach ($RecoveryParticipant in $RecoveryParticipants) {
      if ($RecoveryParticipant.CommandLine -cmatch '(?:^|\s)ai_assistant\.pi_worker(?:\s|$)' -or
          $RecoveryParticipant.CommandLine -cmatch $RecoveryKeeperCommandPattern -or $RecoveryParticipant.CommandLine -cmatch $RecoveryFormalCommandPattern) {
        throw 'A Pi worker or a conflicting WSL keeper is already present'
      }
    }
    Save-RecoveryRecord (Join-Path $RecoveryInvocation 'RunnerKeeper-started.json') ([ordered]@{
      at=[DateTimeOffset]::UtcNow.ToString('o'); operationId=$RecoveryOperationId; sourceCommit=$RecoverySourceCommit; arguments=$RecoveryKeeperArguments
    })
    $RecoveryPreviousWslEnv = [Environment]::GetEnvironmentVariable('WSLENV', 'Process')
    try {
      $env:WSLENV = ''
      $RecoveryKeeper = Start-Process -FilePath $RecoveryWsl -ArgumentList $RecoveryKeeperArguments -WorkingDirectory $RecoveryInvocation -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $RecoveryInvocation 'RunnerKeeper.stdout.log') -RedirectStandardError (Join-Path $RecoveryInvocation 'RunnerKeeper.stderr.log')
    } finally {
      [Environment]::SetEnvironmentVariable('WSLENV', $RecoveryPreviousWslEnv, 'Process')
    }
    $RecoverySnapshot = Get-ProcessSnapshot $RecoveryKeeper.Id
    if (-not $RecoverySnapshot -or $RecoverySnapshot.ExecutablePath -ine $RecoveryWsl -or $RecoverySnapshot.CommandLine -cnotmatch $RecoveryKeeperCommandPattern) {
      throw 'The new recovery keeper could not be identified'
    }
    $RecoveryRecord = [ordered]@{
      at=[DateTimeOffset]::UtcNow.ToString('o'); operationId=$RecoveryOperationId; sourceCommit=$RecoverySourceCommit; processId=[int]$RecoverySnapshot.ProcessId
      creationDate=$RecoverySnapshot.CreationDate.ToString(); executablePath=$RecoverySnapshot.ExecutablePath.ToString()
      commandLine=$RecoverySnapshot.CommandLine.ToString(); arguments=$RecoveryKeeperArguments
    }
    Save-RecoveryRecord $RecoveryKeeperPath $RecoveryRecord
    $RecoveryTool = Join-Path $RecoveryScriptRoot 'ai159_pi_source_recovery.py'
    Assert-PlainPath $RecoveryTool
    $RecoveryRun = Invoke-BoundedNativeProcess $Python @('-I','-B',$RecoveryTool,'--invocation',$RecoveryInvocation) $BackendRoot
    if ($RecoveryRun.ExitCode -ne 0 -and @($RecoveryRun.Output).Count -eq 1 -and [string]$RecoveryRun.Output[0] -cmatch '^\{"activeSuccessorVerified": false, "reason": "([a-z_]+)"\}$') {
      throw ('Runner recovery stopped: ' + $Matches[1])
    }
    $RecoveryResult = ConvertFrom-UniqueNativeJson $RecoveryRun 'AI159 Runner recovery'
    if ($RecoveryResult.activeSuccessorVerified -cne $true) { throw 'Exact successor activation is unproved' }
    Get-RecoveryKeeper (Read-RecoveryRecord $RecoveryKeeperPath) | Out-Null
    $RecoveryResult | ConvertTo-Json -Depth 8 -Compress
    return
  }

  Assert-NoSystemMaintenance
  $RecoveryRecord = Read-RecoveryRecord $RecoveryKeeperPath
  $RecoveryGuard = Read-RecoveryRecord $RecoveryStartGuard
  if ([string]$RecoveryGuard.invocation -ine $RecoveryInvocation -or $RecoveryGuard.operationId -cne $RecoveryOperationId -or
      $RecoveryGuard.keeper.processId -ne $RecoveryRecord.processId -or $RecoveryGuard.keeper.creationDate -cne $RecoveryRecord.creationDate) { throw 'Original Runner start guard and keeper do not match' }
  $RecoveryReleasedPath = Join-Path $RecoveryInvocation 'RunnerKeeper-released.json'
  if (Test-Path -LiteralPath $RecoveryReleasedPath) {
    $RecoveryReceipt = Read-RecoveryRecord $RecoveryReleasedPath
    if ($RecoveryReceipt.released -cne $true -or $RecoveryReceipt.processId -ne $RecoveryRecord.processId -or $RecoveryReceipt.operationId -cne $RecoveryOperationId -or
        $RecoveryReceipt.formalProcessId -le 0 -or $RecoveryReceipt.formalProcessId -eq $RecoveryRecord.processId) { throw 'Recorded keeper release binding changed' }
    $RecoveryReceipt | ConvertTo-Json -Compress
    return
  }
  $RecoveryFormalKeeper = Resolve-OwnedProcess 'ai-pandas-wsl' (Join-Path $RunDirectory 'ai-pandas-wsl.pid.json') $RecoveryWsl $RecoveryFormalArguments -ReadOnly
  if (-not $RecoveryFormalKeeper -or $RecoveryFormalKeeper.ProcessId -eq $RecoveryRecord.processId -or $RecoveryFormalKeeper.CommandLine -cnotmatch $RecoveryFormalCommandPattern -or
      [DateTimeOffset]::Parse($RecoveryFormalKeeper.CreationDate) -le [DateTimeOffset]::Parse($RecoveryRecord.creationDate)) {
    throw 'Formal Pandas keeper handoff is unproved'
  }
  $RecoverySnapshot = Get-RecoveryKeeper $RecoveryRecord
  $RecoveryProcess = [Diagnostics.Process]::GetProcessById($RecoverySnapshot.ProcessId)
  try {
    # Hold the exact process handle across identity recheck and termination.
    $null = $RecoveryProcess.Handle
    Get-RecoveryKeeper $RecoveryRecord | Out-Null
    $RecoveryProcess.Kill()
    if (-not $RecoveryProcess.WaitForExit(10000)) { throw 'Recovery keeper did not exit' }
  } finally { $RecoveryProcess.Dispose() }
  $RecoveryReceipt = [ordered]@{ released=$true; processId=[int]$RecoveryRecord.processId; formalProcessId=[int]$RecoveryFormalKeeper.ProcessId; operationId=$RecoveryOperationId }
  Save-RecoveryRecord $RecoveryReleasedPath $RecoveryReceipt
  $RecoveryReceipt | ConvertTo-Json -Compress
}
