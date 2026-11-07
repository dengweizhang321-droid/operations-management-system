$ErrorActionPreference = 'Stop'

function Get-FixtureAst([string]$Path) {
  $tokens = $null
  $errors = $null
  $ast = [Management.Automation.Language.Parser]::ParseFile($Path, [ref]$tokens, [ref]$errors)
  if ($errors) { throw ($errors | Select-Object -First 1 -ExpandProperty Message) }
  return $ast
}

$toolsRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'tools'
$original = Get-FixtureAst (Join-Path $toolsRoot 'django-local-service.ps1')
$candidate = Get-FixtureAst (Join-Path $toolsRoot 'ai159-pi-source-recovery.ps1')
$mutex = $original.Find({param($ast) $ast -is [Management.Automation.Language.FunctionDefinitionAst] -and $ast.Name -ceq 'Invoke-WithServiceMutex'}, $true)
$writer = $candidate.Find({param($ast) $ast -is [Management.Automation.Language.FunctionDefinitionAst] -and $ast.Name -ceq 'Save-RecoveryRecord'}, $true)
$call = $candidate.Find({param($ast) $ast -is [Management.Automation.Language.CommandAst] -and $ast.GetCommandName() -ceq 'Invoke-WithServiceMutex'}, $true)
. ([scriptblock]::Create($mutex.Extent.Text))
. ([scriptblock]::Create($writer.Extent.Text))

$candidate.FindAll({
  param($ast)
  $ast -is [Management.Automation.Language.AssignmentStatementAst] -and
  $ast.Left.Extent.Text -cmatch '\$Recovery(?:Keeper|Formal)(?:Arguments|CommandPattern)$'
}, $true) | ForEach-Object { . ([scriptblock]::Create($_.Extent.Text)) }
$observedWsl = '"C:\WINDOWS\System32\wsl.exe" -d TERUISI-Pandas -u teruisi-pandas --exec /usr/bin/sleep 2147483647 '
if ($observedWsl -cnotmatch $RecoveryKeeperCommandPattern -or
    $observedWsl.Replace('2147483647','infinity') -cnotmatch $RecoveryFormalCommandPattern -or
    ($observedWsl + 'unexpected') -cmatch $RecoveryKeeperCommandPattern) { throw 'Real WSL argv shape was not matched precisely' }

function Get-CanonicalPath([string]$Path) { return [IO.Path]::GetFullPath($Path) }
function Get-Sha256Text([string]$Text) { return [IO.Path]::GetFileName($Text) }
function Assert-DeployedApplication {}
function Assert-RuntimeAclHardened {}
function Assert-ProductionMaintenance([string]$Operation) {}
function Read-SystemMaintenance { return [pscustomobject]@{ id=$RecoveryMaintenanceId; keepPostgres=$true } }
function Get-ProcessSnapshot([int]$Id) {
  if ($Id -ne 91000) { return $null }
  return [pscustomobject]@{
    ProcessId=[long]91000; CreationDate='2026-11-07T06:00:00.0000000Z'; ExecutablePath=$RecoveryWsl; CommandLine='fixture'
  }
}
function Get-PortListeners { return @() }
function Resolve-OwnedProcess { return $null }
function Get-CimInstance { return @() }
$script:fixtureLaunches = 0
function Start-Process { $script:fixtureLaunches++; return [pscustomobject]@{ Id=91000 } }
function Assert-PlainPath([string]$Path) {}
function Invoke-BoundedNativeProcess { throw 'fixture stopped before invoking WSL' }
function Get-RecoveryKeeper {}
function Get-PreviouslyStartedRecoveryKeeper {
  return [pscustomobject]@{
    Root=(Get-ProcessSnapshot 91000)
    Child=[pscustomobject]@{ ProcessId=91001; CreationDate='2026-11-07T06:00:01.0000000Z'; CommandLine='fixture' }
  }
}

$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ([Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $fixtureRoot
try {
  # The native mutex uses the canonical runtime string when naming its lock.
  $RuntimeRoot = $fixtureRoot
  $Action = 'RestoreRunner'
  $RecoveryAction = $Action
  $RecoveryInvocation = $fixtureRoot
  $RecoveryScriptRoot = $toolsRoot
  $RecoveryOriginalAttempt = $fixtureRoot
  $RecoveryStartGuard = Join-Path $fixtureRoot 'PiRunnerRecovery-started.json'
  $RecoveryKeeperPath = Join-Path $fixtureRoot 'RunnerKeeper.json'
  $RecoveryMaintenanceId = 'a' * 32
  [string]$RecoveryOperationId = 'b' * 32
  [string]$RecoverySourceCommit = 'c' * 40
  $RecoveryKeeperArguments = @('-d','isolated-fixture','--exec','/bin/sleep','30')
  $RecoveryWsl = 'fixture'
  $RecoveryKeeperCommandPattern = '^fixture$'
  $RecoveryFormalCommandPattern = '^formal-fixture$'
  $RunDirectory = $fixtureRoot
  $Python = 'fixture'

  # Reproduce the old dynamic-scope collision through the exact native mutex.
  $operation = $RecoveryOperationId
  $negative = Join-Path $fixtureRoot 'non-primitive.json'
  try {
    Invoke-WithServiceMutex { Save-RecoveryRecord $negative ([ordered]@{ operationId=$operation }) }
    throw 'Non-primitive guard accepted a shadowed script block'
  } catch {
    if ($_.Exception.Message -cne 'Recovery receipt contains a non-primitive value') { throw }
  }
  if (Test-Path -LiteralPath $negative) { throw 'A rejected guard was written' }

  # Use the actual candidate callback with the same native mutex and an
  # isolated synthetic Windows process identity. No process or WSL is launched.
  try {
    & ([scriptblock]::Create($call.Extent.Text))
    throw 'The post-keeper launch boundary was not reached'
  } catch {
    if ($_.Exception.Message -cne 'fixture stopped before invoking WSL') { throw }
  }
  $keeper = [IO.File]::ReadAllText((Join-Path $fixtureRoot 'RunnerKeeper-started.json')) | ConvertFrom-Json
  if ($keeper.operationId -isnot [string] -or $keeper.operationId -cne $RecoveryOperationId -or
      $keeper.sourceCommit -isnot [string] -or $keeper.sourceCommit -cne $RecoverySourceCommit -or
      ($keeper.arguments -join '|') -cne ($RecoveryKeeperArguments -join '|')) { throw 'Keeper guard has the wrong typed identity' }
  $identityRaw = [IO.File]::ReadAllText((Join-Path $fixtureRoot 'RunnerKeeper.json'))
  $identity = $identityRaw | ConvertFrom-Json
  if ($identity.operationId -isnot [string] -or $identity.operationId -cne $RecoveryOperationId -or
      $identity.sourceCommit -isnot [string] -or $identity.sourceCommit -cne $RecoverySourceCommit -or
      $identity.processId -ne 91000 -or $identityRaw -cnotmatch '"creationDate":"2026-11-07T06:00:00\.0000000Z"' -or
      $identity.executablePath -isnot [string] -or $identity.executablePath -cne $RecoveryWsl -or
      $identity.commandLine -isnot [string] -or $identity.commandLine -cne 'fixture' -or
      ($identity.arguments -join '|') -cne ($RecoveryKeeperArguments -join '|')) { throw 'Keeper receipt has the wrong typed identity' }

  $Action = 'AdoptKeeper'
  $RecoveryAction = $Action
  $RecoveryKeeperPath = Join-Path $fixtureRoot 'adopted-keeper.json'
  $RecoveryPriorGuard = Join-Path $fixtureRoot 'RunnerKeeper-started.json'
  $RecoveryPriorGuardSha256 = 'd' * 64
  $RecoveryRootExeSha256 = 'e' * 64
  $RecoveryChildExeSha256 = 'f' * 64
  $RecoveryWslChild = 'fixture child'
  $prior = [IO.File]::ReadAllText($RecoveryPriorGuard)
  try {
    & ([scriptblock]::Create($call.Extent.Text))
    throw 'The adoption boundary was not reached'
  } catch {
    if ($_.Exception.Message -cne 'fixture stopped before invoking WSL') { throw }
  }
  $adopted = [IO.File]::ReadAllText($RecoveryKeeperPath) | ConvertFrom-Json
  if ($script:fixtureLaunches -ne 1 -or [IO.File]::ReadAllText($RecoveryPriorGuard) -cne $prior -or
      $adopted.adopted -cne $true -or $adopted.processId -ne 91000 -or $adopted.childProcessId -ne 91001 -or
      $adopted.startedPath -cne $RecoveryPriorGuard -or $adopted.startedSha256 -cne $RecoveryPriorGuardSha256) {
    throw 'Keeper adoption did not preserve the exact original start'
  }
  Write-Output 'Native mutex scope, observed WSL argv and exact keeper adoption passed'
} finally {
  foreach ($name in @('RunnerKeeper-started.json','RunnerKeeper.json','adopted-keeper.json','non-primitive.json')) {
    $file = Join-Path $fixtureRoot $name
    if (Test-Path -LiteralPath $file -PathType Leaf) { Remove-Item -LiteralPath $file -Force }
  }
  Remove-Item -LiteralPath $fixtureRoot
}
