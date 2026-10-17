$ErrorActionPreference = 'Stop'
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('teruisi-preboot-' + [guid]::NewGuid().ToString('N'))
$previousLibrary = $env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY
try {
  $env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY = '1'
  . (Join-Path $PSScriptRoot '..\tools\django-local-service.ps1') -Action Start -RuntimeRoot $fixture
  [IO.Directory]::CreateDirectory($RunDirectory) | Out-Null
  $receiptPath = Join-Path $RunDirectory 'fixture.pid.json'
  $launcher = Join-Path $fixture 'python.exe'
  $script:boot = [datetime]::Parse('2026-01-02T00:00:00Z').ToUniversalTime()
  $old = $script:boot.AddHours(-1)
  $live = $script:boot.AddMinutes(1)
  $script:metadata = 'unreadable'
  $script:bootCalls = 0
  $script:replaceOnBootCall = 0
  $script:bootUnavailable = $false
  $script:stops = 0
  function Write-LauncherEvent {}
  function Assert-NoSystemMaintenance {}
  function Stop-Process { $script:stops++; throw 'Must not stop a reused PID' }
  function Get-CimInstance {
    [CmdletBinding()] param([string]$ClassName, [string]$Filter)
    if ($ClassName -ceq 'Win32_OperatingSystem') {
      $script:bootCalls++
      if ($script:bootUnavailable) { throw 'Boot time unavailable' }
      if ($script:replaceOnBootCall -eq $script:bootCalls) {
        [IO.File]::WriteAllText($receiptPath, '{"replacement":true}')
      }
      return [pscustomobject]@{LastBootUpTime=$script:boot}
    }
    if ($ClassName -cne 'Win32_Process') { throw 'Unexpected CIM query' }
    if ($script:metadata -ceq 'absent') { return }
    return [pscustomobject]@{
      ProcessId=424242; CreationDate=$live; ExecutablePath=$launcher
      CommandLine=$(if ($script:metadata -ceq 'unreadable') { '' } else { '"' + $launcher + '" --fixture' })
    }
  }
  function Write-Receipt([datetime]$Creation=$old, [datetime]$Started=$old, [datetime]$Modified=$old) {
    $value = [ordered]@{
      version=2;service='fixture';processId=424242;creationDate=$Creation.ToString('o')
      startedAt=$Started.ToString('o');launcherPath=$launcher;executablePath=$launcher
      commandLine=('"' + $launcher + '" --fixture');arguments=@('--fixture');configFingerprint=('a'*64)
    }
    [IO.File]::WriteAllText($receiptPath, ($value | ConvertTo-Json -Depth 8))
    [IO.File]::SetLastWriteTimeUtc($receiptPath,$Modified)
  }
  function Assert-Rejected([scriptblock]$Operation, [string]$PreservedPath=$receiptPath) {
    $denied=$false
    try { & $Operation | Out-Null } catch { $denied=$true }
    if (-not $denied) { throw 'Expected rejection' }
    if (-not (Test-Path -LiteralPath $PreservedPath)) { throw 'Rejected receipt was removed' }
  }
  function Resolve-Fixture { Resolve-OwnedProcess 'fixture' $receiptPath $launcher @('--fixture') ('a'*64) }

  Write-Receipt
  $before=Get-FileSha256 $receiptPath
  $Action='AggregateStatus'
  if ($null -ne (Resolve-Fixture)) { throw 'Status accepted stale PID' }
  if ((Get-FileSha256 $receiptPath) -cne $before) { throw 'Status changed stale receipt' }
  $Action='Start'
  if ($null -ne (Resolve-Fixture) -or (Test-Path -LiteralPath $receiptPath)) { throw 'Preboot receipt did not recover' }
  if ($null -ne (Resolve-Fixture)) { throw 'Repeated resolution did not remain stopped' }

  # Current-boot or incomplete evidence must never authorize cleanup.
  Write-Receipt $old $old $live
  Assert-Rejected { Resolve-Fixture }
  Write-Receipt $script:boot $old $old
  Assert-Rejected { Resolve-Fixture }
  Write-Receipt $old $script:boot $old
  Assert-Rejected { Resolve-Fixture }
  Write-Receipt
  $record=Read-JsonFile $receiptPath 'fixture'; $record.startedAt='invalid'
  [IO.File]::WriteAllText($receiptPath,($record|ConvertTo-Json -Depth 8));[IO.File]::SetLastWriteTimeUtc($receiptPath,$old)
  Assert-Rejected { Resolve-Fixture }
  Write-Receipt
  $script:bootUnavailable=$true
  Assert-Rejected { Resolve-Fixture }
  $script:bootUnavailable=$false
  Write-Receipt
  Assert-Rejected { Resolve-OwnedProcess 'other' $receiptPath $launcher }
  Assert-Rejected { Resolve-OwnedProcess 'fixture' $receiptPath (Join-Path $fixture 'other.exe') }

  # A receipt replaced between classification and deletion survives.
  Write-Receipt
  $script:bootCalls=0; $script:replaceOnBootCall=2
  Assert-Rejected { Resolve-Fixture }
  if ((Read-JsonFile $receiptPath 'replacement').replacement -cne $true) { throw 'Replacement was lost' }
  $script:replaceOnBootCall=0

  # Healthy same-boot resolution adds no OS boot lookup or file writes.
  $script:metadata='readable'; $script:bootCalls=0
  Write-Receipt $live $live $live
  $before=Get-FileSha256 $receiptPath
  if ($null -eq (Resolve-Fixture)) { throw 'Live exact process rejected' }
  if ($script:bootCalls -ne 0 -or (Get-FileSha256 $receiptPath) -cne $before) { throw 'Healthy path added a boot check or write' }
  Write-Receipt $old $old $live
  Assert-Rejected { Resolve-Fixture }
  Write-Receipt
  $Action='Status'
  if ($null -ne (Resolve-Fixture) -or -not (Test-Path $receiptPath)) { throw 'Readable reused PID Status changed receipt' }
  $Action='Start'
  if ($null -ne (Resolve-Fixture) -or (Test-Path $receiptPath)) { throw 'Readable reused PID did not recover' }

  # The supervisor receipt has the same inaccessible-PID failure mode.
  $script:metadata='unreadable'
  function Get-DjangoSupervisorCandidates { @() }
  $supervisor=[ordered]@{version='teruisi-django-supervisor-process-v1';processId=424242
    creationDate=$old.ToString('o');startedAt=$old.ToString('o');executablePath=$launcher
    commandLine='fixture';scriptPathSha256=('a'*64);scriptSha256=('b'*64)}
  [IO.File]::WriteAllText($DjangoSupervisorPidPath,($supervisor|ConvertTo-Json))
  [IO.File]::SetLastWriteTimeUtc($DjangoSupervisorPidPath,$old)
  Assert-DjangoSupervisorStopped 'private test'
  if (Test-Path $DjangoSupervisorPidPath) { throw 'Supervisor preboot receipt remained' }
  $supervisorSource=Join-Path $PSScriptRoot '..\tools\django-runtime-supervisor.ps1'
  $tokens=$null;$errors=$null
  $ast=[Management.Automation.Language.Parser]::ParseFile($supervisorSource,[ref]$tokens,[ref]$errors)
  if($errors.Count){throw 'Supervisor parse failure'}
  foreach($name in @('Get-SupervisorCanonicalPath','Assert-SupervisorExactPropertySet','Resolve-SupervisorProcess')) {
    $fn=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name},$true)
    . ([scriptblock]::Create($fn.Extent.Text))
  }
  $SupervisorPidPath=$DjangoSupervisorPidPath
  $SupervisorScriptPath=(Resolve-Path $supervisorSource).Path
  $SupervisorReceiptVersion='teruisi-django-supervisor-process-v1'
  $supervisor.scriptPathSha256=Get-Sha256Text (Get-SupervisorCanonicalPath $SupervisorScriptPath)
  $supervisor.scriptSha256=Get-FileSha256 $SupervisorScriptPath
  [IO.File]::WriteAllText($SupervisorPidPath,($supervisor|ConvertTo-Json))
  [IO.File]::SetLastWriteTimeUtc($SupervisorPidPath,$old)
  $SupervisorRequest=[pscustomobject]@{Action='Status'}
  $before=Get-FileSha256 $SupervisorPidPath
  if($null -ne (Resolve-SupervisorProcess) -or (Get-FileSha256 $SupervisorPidPath) -cne $before) { throw 'Supervisor Status changed preboot receipt' }
  $SupervisorRequest.Action='Run'
  if($null -ne (Resolve-SupervisorProcess) -or (Test-Path $SupervisorPidPath)) { throw 'Boot-time supervisor retained preboot receipt' }
  [IO.File]::WriteAllText($SupervisorPidPath,($supervisor|ConvertTo-Json))
  [IO.File]::SetLastWriteTimeUtc($SupervisorPidPath,$live)
  Assert-Rejected { Resolve-SupervisorProcess } $SupervisorPidPath
  if ($script:stops -ne 0) { throw 'Reused process was stopped' }
  'PASS: preboot inaccessible PID, read-only Status, exact cleanup, replacement fence and healthy fast path'
} finally {
  $env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY=$previousLibrary
  $resolved=[IO.Path]::GetFullPath($fixture)
  if ((Split-Path -Parent $resolved).TrimEnd('\') -ine ([IO.Path]::GetTempPath()).TrimEnd('\') -or
      (Split-Path -Leaf $resolved) -notlike 'teruisi-preboot-*') { throw 'Unsafe private fixture path' }
  Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction SilentlyContinue
}
