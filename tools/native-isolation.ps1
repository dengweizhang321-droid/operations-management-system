# Shared installation binding. No lifecycle operation or readiness shortcut here.
function Read-NativeIsolation {
  $ErrorActionPreference = 'Stop'
  $file = $env:TERUISI_NATIVE_ISOLATION_FILE
  $digest = $env:TERUISI_NATIVE_ISOLATION_SHA256
  if (-not $file -and -not $digest) {
    if ($PSScriptRoot -match '(?i)[\\/]native-control-[^\\/]+[\\/]') { throw 'Private installation requires explicit isolation binding' }
    return $null
  }
  if (-not $file -or $digest -cnotmatch '^[a-f0-9]{64}$') { throw 'Incomplete native isolation binding' }
  $absolute = [IO.Path]::GetFullPath($file)
  $current = $absolute
  while ($current) {
    $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Isolation binding may not traverse a reparse point' }
    $parent = Split-Path -Parent $current
    if ($parent -eq $current) { break }
    $current = $parent
  }
  if ((Get-Item -LiteralPath $absolute).Length -gt 4096) { throw 'Isolation binding too large' }
  $bytes = [IO.File]::ReadAllBytes($absolute)
  $hasher = [Security.Cryptography.SHA256]::Create()
  try { $actual = ([BitConverter]::ToString($hasher.ComputeHash($bytes))).Replace('-','').ToLowerInvariant() } finally { $hasher.Dispose() }
  if ($bytes.Length -gt 4096 -or $actual -cne $digest) { throw 'Isolation binding changed' }
  $config = ([Text.UTF8Encoding]::new($false,$true).GetString($bytes)) | ConvertFrom-Json
  if ((($config.PSObject.Properties.Name | Sort-Object) -join ',') -cne 'id,root,sourceRoot,version,wslDistribution' -or
      $config.version -ne 1 -or $config.id -cnotmatch '^[a-z0-9-]{8,64}$' -or $config.wslDistribution -cne 'Codex-AI-Batch2-20261108') { throw 'Invalid native isolation profile' }
  $expectedRoot = 'D:\codex-isolated\native-control-' + $config.id
  if ($config.root -cne $expectedRoot -or $absolute -ine (Join-Path $expectedRoot 'isolation.json') -or
      $config.sourceRoot -cnotmatch '^D:\\\.codex\\worktrees\\[a-z0-9]+\\[^\\]+$') { throw 'Isolation roots are not private' }
  return $config
}

$NativeIsolation = Read-NativeIsolation
$NativePorts = @{}
foreach ($nativePort in @(3000,5791,5432,8001,8002,8011,8012,8021,8022,8031,8032,8041,8042,8051,8052,8061,8062,8071,8072,8081,8091,8092,8101,8102,8111,8112,8121,8123)) {
  $NativePorts[$nativePort] = $nativePort + $(if ($NativeIsolation) { 20000 } else { 0 })
}
function Get-NativeRuntimeRoot([string]$Role, [string]$Requested, [bool]$Explicit) {
  if ($Role -cnotin @('django','worker')) { throw 'Invalid native runtime role' }
  if ($NativeIsolation) {
    if ($Action -notin @('Configure','ProvisionRoles','ProvisionFinanceRoles','EnableStartup','DisableStartup',
        'PrepareApp','VerifyPreparedApp','DeployApp','HardenAcl','Start','Stop','Status','AggregateStatus','FinanceStatus',
        'StartFinance','StopFinance','Deploy','Verify','Restart','RestartFull','MaintenanceStatus','PiCheck','PandasCheck',
        'InstallStartup','VerifyStartup','RemoveStartup')) {
      throw 'Action is outside the private native lifecycle scope'
    }
    if ($Role -cne 'worker' -and $Action -in @('InstallStartup','VerifyStartup','RemoveStartup')) { throw 'Private login startup is forbidden' }
    $expected = Join-Path $NativeIsolation.root $Role
    if (Test-Path -LiteralPath (Join-Path $NativeIsolation.root 'django\config\dingtalk-startup.json')) { throw 'Private native installation forbids external receivers and schedules' }
    if ($Explicit -and [IO.Path]::GetFullPath($Requested).TrimEnd('\') -ine $expected) { throw 'Isolation runtime does not match binding' }
    return $expected
  }
  if ($Requested -match '(?i)[\\/]native-control-[^\\/]+[\\/]') { throw 'Private runtime requires explicit native isolation binding' }
  return $Requested
}
function Get-NativeMutexName([string]$Name) {
  if ($NativeIsolation) { return $Name + '.isolated.' + $NativeIsolation.id }
  return $Name
}
