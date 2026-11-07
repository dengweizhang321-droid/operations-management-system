param(
  [Parameter(Mandatory)][ValidateSet('RestoreRunner','ReleaseKeeper')][string]$Action,
  [Parameter(Mandatory)][string]$Invocation,
  [switch]$Json
)
$ErrorActionPreference = 'Stop'
$requestedAction = $Action
$runtime = 'D:\teruisi-runtime\django-sales'
$original = 'D:\codex-isolated\main-release-packages\e030caba1271-aaab2674-b0c1080e\publish-e030caba1271'
$resumeRoot = Join-Path $original 'resume-ai159\attempts'
$startGuard = Join-Path $original 'PiRunnerRecovery-started.json'
$native = Join-Path $runtime 'app\tools\django-local-service.ps1'
$maintenanceIdExpected = 'eaf8c8abb0984e2482a9eb3edfed1429'
$commit = 'e030caba1271d47fced663649f288855234a02e2'
$operation = '88b7e64f18dd4afdb67869895c5d7f1e'

function Assert-PlainPath([string]$File) {
  $item = Get-Item -LiteralPath $File -Force
  while ($item) {
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Runner recovery path contains a reparse point' }
    $item = if ($item.PSIsContainer) { $item.Parent } else { $item.Directory }
  }
}

function Assert-OriginalFile([string]$File, [string]$Digest) {
  Assert-PlainPath $File
  if ((Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash.ToLowerInvariant() -cne $Digest) { throw 'Runner recovery original bytes changed' }
}

function Save-RecoveryRecord([string]$File, [object]$Value) {
  $bytes = [Text.UTF8Encoding]::new($false).GetBytes(($Value | ConvertTo-Json -Depth 8 -Compress) + "`n")
  $stream = [IO.File]::Open($File, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
  try { $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
}

$Invocation = [IO.Path]::GetFullPath($Invocation)
if ((Split-Path -Parent $Invocation) -ine $resumeRoot -or (Split-Path -Leaf $Invocation) -cnotmatch '^[a-f0-9]{32}$' -or
    -not (Test-Path -LiteralPath $Invocation -PathType Container)) { throw 'Runner recovery invocation path is outside the original recovery directory' }
Assert-PlainPath $Invocation
$principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Runner recovery requires the ordinary publisher identity' }
Assert-OriginalFile $native '37c6dc571aeefe4954f977f5b3a64ec08516362a67775729f45f60b17bca99a6'
Assert-OriginalFile (Join-Path $original 'FAILED.json') '2b70da417a977fb6a32b666181adcf3b70402f5449fa986239a0687bb8ad8ef0'
Assert-OriginalFile (Join-Path $original 'STARTED.json') 'fa16a6ba406f55213bdac1d9c1c92120ca76cb78eb8191c5704c5d405045a01b'
Assert-OriginalFile (Join-Path $original 'PiUpgrade-original-failure.json') '1b0a1481ea31f38ba64ef3722f51e9e6f806d95949b515ee790b1b4daa1a1b68'
$previous = [Environment]::GetEnvironmentVariable('TERUISI_DJANGO_SERVICE_LIBRARY_ONLY', 'Process')
try {
  $env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY = '1'
  . $native -RuntimeRoot $runtime
} finally {
  [Environment]::SetEnvironmentVariable('TERUISI_DJANGO_SERVICE_LIBRARY_ONLY', $previous, 'Process')
}
$Action = $requestedAction
$wsl = Join-Path $env:SystemRoot 'System32\wsl.exe'
$keeperPath = Join-Path $Invocation 'RunnerKeeper.json'
$keeperArguments = @('-d','TERUISI-Pandas','-u','teruisi-pandas','--exec','/usr/bin/sleep','2147483647')
$formalArguments = @('-d','TERUISI-Pandas','-u','teruisi-pandas','--exec','/usr/bin/sleep','infinity')
$keeperCommandPattern = '^(?:"[^"\r\n]+"|\S+)\s+' + [regex]::Escape(($keeperArguments -join ' ')) + '$'
$formalCommandPattern = '^(?:"[^"\r\n]+"|\S+)\s+' + [regex]::Escape(($formalArguments -join ' ')) + '$'

function Read-RecoveryRecord([string]$File) {
  Assert-PlainPath $File
  return Read-JsonFile $File 'AI159 Runner recovery record'
}

function Get-RecoveryKeeper([object]$Record) {
  if ($Record.operationId -cne $operation -or $Record.sourceCommit -cne $commit -or
      -not (Test-ExactStringArray @($Record.arguments) $keeperArguments) -or
      [string]$Record.executablePath -ine $wsl -or [int]$Record.processId -le 0) { throw 'Recovery keeper receipt binding changed' }
  $current = Get-ProcessSnapshot ([int]$Record.processId) 1
  if (-not $current -or $current.CreationDate -cne (ConvertTo-CanonicalCreationDate $Record.creationDate) -or
      $current.ExecutablePath -ine $wsl -or $current.CommandLine -cne $Record.commandLine -or
      $current.CommandLine -cnotmatch $keeperCommandPattern) { throw 'Recovery keeper process identity changed' }
  return $current
}

Invoke-WithServiceMutex {
  Assert-DeployedApplication
  Assert-RuntimeAclHardened
  if ($requestedAction -ceq 'RestoreRunner') {
    Assert-ProductionMaintenance 'AI159 Runner recovery'
    $maintenance = Read-SystemMaintenance
    if ($maintenance.id -cne $maintenanceIdExpected -or $maintenance.keepPostgres -cne $true) { throw 'Original maintenance identity changed' }
    if ((Test-Path -LiteralPath $startGuard) -or (Test-Path -LiteralPath (Join-Path $original 'PiReconcile-started.json'))) {
      throw 'Original Runner recovery or reconciliation already started'
    }
    if (Get-ProcessSnapshot 30664 1) { throw 'Original Runner upgrade controller PID is still occupied' }
    foreach ($port in @(8111,8112,8123)) {
      if (@(Get-PortListeners $port).Count -gt 0) { throw 'An AI or Runner port still has an owner' }
    }
    if (Resolve-OwnedProcess 'django-ai-pi-worker' (Join-Path $RunDirectory 'django-ai-pi-worker.pid.json') $Python -ReadOnly) {
      throw 'The original Pi worker is still present'
    }
    $participants = @(Get-CimInstance Win32_Process -Filter "Name = 'wsl.exe' OR Name = 'python.exe' OR Name = 'pythonw.exe'" -ErrorAction Stop)
    foreach ($participant in $participants) {
      if ($participant.CommandLine -cmatch '(?:^|\s)ai_assistant\.pi_worker(?:\s|$)' -or
          $participant.CommandLine -cmatch $keeperCommandPattern -or $participant.CommandLine -cmatch $formalCommandPattern) {
        throw 'A Pi worker or a conflicting WSL keeper is already present'
      }
    }
    Save-RecoveryRecord (Join-Path $Invocation 'RunnerKeeper-started.json') ([ordered]@{
      at=[DateTimeOffset]::UtcNow.ToString('o'); operationId=$operation; sourceCommit=$commit; arguments=$keeperArguments
    })
    $previousWslEnv = [Environment]::GetEnvironmentVariable('WSLENV', 'Process')
    try {
      $env:WSLENV = ''
      $keeper = Start-Process -FilePath $wsl -ArgumentList $keeperArguments -WorkingDirectory $Invocation -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $Invocation 'RunnerKeeper.stdout.log') -RedirectStandardError (Join-Path $Invocation 'RunnerKeeper.stderr.log')
    } finally {
      [Environment]::SetEnvironmentVariable('WSLENV', $previousWslEnv, 'Process')
    }
    $snapshot = Get-ProcessSnapshot $keeper.Id
    if (-not $snapshot -or $snapshot.ExecutablePath -ine $wsl -or $snapshot.CommandLine -cnotmatch $keeperCommandPattern) {
      throw 'The new recovery keeper could not be identified'
    }
    $record = [ordered]@{
      at=[DateTimeOffset]::UtcNow.ToString('o'); operationId=$operation; sourceCommit=$commit; processId=$snapshot.ProcessId
      creationDate=$snapshot.CreationDate; executablePath=$snapshot.ExecutablePath; commandLine=$snapshot.CommandLine; arguments=$keeperArguments
    }
    Save-RecoveryRecord $keeperPath $record
    $tool = Join-Path $PSScriptRoot 'ai159_pi_source_recovery.py'
    Assert-PlainPath $tool
    $run = Invoke-BoundedNativeProcess $Python @('-I','-B',$tool,'--invocation',$Invocation) $BackendRoot
    if ($run.ExitCode -ne 0 -and @($run.Output).Count -eq 1 -and [string]$run.Output[0] -cmatch '^\{"activeSuccessorVerified": false, "reason": "([a-z_]+)"\}$') {
      throw ('Runner recovery stopped: ' + $Matches[1])
    }
    $result = ConvertFrom-UniqueNativeJson $run 'AI159 Runner recovery'
    if ($result.activeSuccessorVerified -cne $true) { throw 'Exact successor activation is unproved' }
    Get-RecoveryKeeper (Read-RecoveryRecord $keeperPath) | Out-Null
    $result | ConvertTo-Json -Depth 8 -Compress
    return
  }

  Assert-NoSystemMaintenance
  $record = Read-RecoveryRecord $keeperPath
  $guard = Read-RecoveryRecord $startGuard
  if ([string]$guard.invocation -ine $Invocation -or $guard.operationId -cne $operation -or
      $guard.keeper.processId -ne $record.processId -or $guard.keeper.creationDate -cne $record.creationDate) { throw 'Original Runner start guard and keeper do not match' }
  $releasedPath = Join-Path $Invocation 'RunnerKeeper-released.json'
  if (Test-Path -LiteralPath $releasedPath) {
    $receipt = Read-RecoveryRecord $releasedPath
    if ($receipt.released -cne $true -or $receipt.processId -ne $record.processId -or $receipt.operationId -cne $operation -or
        $receipt.formalProcessId -le 0 -or $receipt.formalProcessId -eq $record.processId) { throw 'Recorded keeper release binding changed' }
    $receipt | ConvertTo-Json -Compress
    return
  }
  $formal = Resolve-OwnedProcess 'ai-pandas-wsl' (Join-Path $RunDirectory 'ai-pandas-wsl.pid.json') $wsl $formalArguments -ReadOnly
  if (-not $formal -or $formal.ProcessId -eq $record.processId -or $formal.CommandLine -cnotmatch $formalCommandPattern -or
      [DateTimeOffset]::Parse($formal.CreationDate) -le [DateTimeOffset]::Parse($record.creationDate)) {
    throw 'Formal Pandas keeper handoff is unproved'
  }
  $snapshot = Get-RecoveryKeeper $record
  $process = [Diagnostics.Process]::GetProcessById($snapshot.ProcessId)
  try {
    # Hold the exact process handle across identity recheck and termination.
    $null = $process.Handle
    Get-RecoveryKeeper $record | Out-Null
    $process.Kill()
    if (-not $process.WaitForExit(10000)) { throw 'Recovery keeper did not exit' }
  } finally { $process.Dispose() }
  $receipt = [ordered]@{ released=$true; processId=$record.processId; formalProcessId=$formal.ProcessId; operationId=$operation }
  Save-RecoveryRecord $releasedPath $receipt
  $receipt | ConvertTo-Json -Compress
}
