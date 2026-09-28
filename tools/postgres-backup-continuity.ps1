# Shared helpers for the installed operator. No independent scheduler or secrets.
function Get-MaintenanceFailure($Record, [string]$Stage) {
  # Never serialize native output, invocation arguments or credential-bearing text.
  if ($Record.Exception.Data['backupPhase'] -cmatch '^[a-z_]{1,64}$') { $Stage = [string]$Record.Exception.Data['backupPhase'] }
  $message = [string]$Record.Exception.Message
  $code = 'operation_failed'
  if ($message -match 'capacity_insufficient') { $code = 'capacity_insufficient' }
  elseif ($message -match 'unavailable|not ready') { $code = 'storage_unavailable' }
  elseif ($message -match 'busy|active|maintenance|维护|仍在运行') { $code = 'operation_busy' }
  elseif ($message -match 'Protected recovery point|backup protection') { $code = 'protection_invalid' }
  $known = @('Worker lifecycle is busy; cleanup skipped','Release retention preflight failed',
    'Release retention receipt invalid','Release cleanup requires the installed operator',
    'Process ownership is unknown','Old release still has an active reference','Target binding changed',
    'Release payload cleanup incomplete','Preserved release material changed','Release chain postflight failed',
    'Release chain changed during cleanup','Protected recovery point is missing or changed',
    'E-drive backup directory is unavailable','Backup volume unavailable')
  $reason = if ($message -cin $known) { $message } else { 'See exception type, source location and diagnostic hash' }
  $sha = [Security.Cryptography.SHA256]::Create()
  try { $digest = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($message)))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
  return [pscustomobject]@{status='blocked';stage=$Stage;errorCode=$code;
    reason=$reason;hresult=$Record.Exception.HResult;exceptionType=$Record.Exception.GetType().FullName;reasonSha256=$digest;
    requiredBytes=$Record.Exception.Data['requiredBytes'];availableBytes=$Record.Exception.Data['availableBytes'];
    errorId=$(if ([string]$Record.FullyQualifiedErrorId -cmatch '^[A-Za-z0-9_.\-,]{1,160}$') { [string]$Record.FullyQualifiedErrorId } else { 'redacted' });
    sourceFile=[IO.Path]::GetFileName([string]$Record.InvocationInfo.ScriptName);
    sourceLine=[int]$Record.InvocationInfo.ScriptLineNumber}
}

function Get-MaintenanceVolumeFree([string]$Path) {
  $drive = [IO.DriveInfo]::new([IO.Path]::GetPathRoot([IO.Path]::GetFullPath($Path)))
  if (-not $drive.IsReady) { throw 'Backup volume unavailable' }
  return [decimal]$drive.AvailableFreeSpace
}

function Assert-MaintenanceCapacity([string]$Path, [decimal]$RequiredBytes, [string]$Stage) {
  if ($RequiredBytes -le 0 -or $RequiredBytes -gt [long]::MaxValue) { throw 'Invalid capacity requirement' }
  $free = Get-MaintenanceVolumeFree $Path
  if ($free -lt $RequiredBytes) {
    $error = [InvalidOperationException]::new("capacity_insufficient stage=$Stage")
    $error.Data['backupPhase'] = $Stage
    $error.Data['requiredBytes'] = $RequiredBytes
    $error.Data['availableBytes'] = $free
    throw $error
  }
  $measurement = [pscustomobject]@{stage=$Stage;volume=[IO.Path]::GetPathRoot([IO.Path]::GetFullPath($Path));requiredBytes=$RequiredBytes;availableBytes=$free}
  if ($null -ne $script:MaintenanceRun) { $script:MaintenanceRun.capacity += $measurement; Save-MaintenanceRun 'running' }
  return $measurement
}

function Assert-MaintenanceAuditPath([string]$Path, [string]$Label) {
  # Only inspect the exact path and ancestors, never walk live postgres-data or
  # every installed dependency for each progress update.
  $cursor = [IO.Path]::GetFullPath($Path)
  while (-not [string]::IsNullOrEmpty($cursor)) {
    if (Test-Path -LiteralPath $cursor) {
      $entry = Get-Item -LiteralPath $cursor -Force
      if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "$Label path is linked" }
    }
    $cursor = Split-Path -Parent $cursor
  }
}

function Get-MaintenanceRunRoot {
  $root = Assert-RuntimeChildPath (Join-Path $MaintenanceRequest.RuntimeRoot 'audits\postgres-operations')
  Assert-MaintenanceAuditPath $root 'Operation audit'
  return $root
}

function Start-MaintenanceRun {
  $state = Get-MaintenanceRunStatus
  if ($null -ne $state -and @($state.unresolved).Count -gt 0) { throw 'Previous backup operation is unresolved; inspect its exact receipt before retrying' }
  $root = Get-MaintenanceRunRoot
  if (-not (Test-Path -LiteralPath $root)) { New-Item -ItemType Directory -Path $root -Force | Out-Null }
  $script:MaintenanceRun = [ordered]@{version='teruisi-postgres-operation-v1';id=[Guid]::NewGuid().ToString('N');
    action=$MaintenanceRequest.Action;startedAt=[DateTimeOffset]::UtcNow.ToString('o');
    updatedAt=$null;status='running';phase='admission';capacity=@();databaseBackup=$null;result=$null;failure=$null}
  Save-MaintenanceRun 'running'
}

function Save-MaintenanceRun([string]$Status) {
  $script:MaintenanceRun.status = $Status
  $script:MaintenanceRun.phase = $script:MaintenancePhase
  $script:MaintenanceRun.updatedAt = [DateTimeOffset]::UtcNow.ToString('o')
  $path = Join-Path (Get-MaintenanceRunRoot) ($script:MaintenanceRun.id + '.json')
  Assert-MaintenanceAuditPath (Split-Path -Parent $path) 'Operation audit'
  if (Test-Path -LiteralPath $path) { Assert-MaintenanceAuditPath $path 'Operation receipt' }
  Write-MaintenanceAtomicText $path ($script:MaintenanceRun | ConvertTo-Json -Depth 16 -Compress)
}

function Get-MaintenanceRunStatus {
  $root = Get-MaintenanceRunRoot
  if (-not (Test-Path -LiteralPath $root)) { return $null }
  $files = @(Get-ChildItem -LiteralPath $root -Filter '*.json' -Force)
  if ($files.Count -gt 10000) { throw 'Operation audit inventory exceeds bound' }
  $runs = @($files | ForEach-Object {
    Assert-MaintenanceAuditPath $_.FullName 'Operation receipt'
    if ($_.PSIsContainer -or $_.Length -gt 4194304) { throw 'Invalid operation receipt' }
    $run = Read-JsonFile $_.FullName 'Operation receipt'
    if ($run.version -cne 'teruisi-postgres-operation-v1' -or $run.id -cnotmatch '^[a-f0-9]{32}$' -or
        $_.BaseName -cne $run.id -or $run.status -cnotin @('running','completed','failed')) { throw 'Invalid operation receipt' }
    $run
  } | Sort-Object @{Expression={[DateTimeOffset]$_.startedAt};Descending=$true})
  return [pscustomobject]@{unresolved=@($runs | Where-Object {$_.status -ceq 'running'} | Select-Object id,action,phase,startedAt);latest=($runs | Select-Object -First 1);
    lastSuccessfulBackup=($runs | Where-Object {$_.action -ceq 'Backup' -and $_.status -ceq 'completed' -and ($null -eq $_.result.retention -or $_.result.retention.status -cne 'blocked')} | Select-Object -First 1)}
}

function Set-MaintenancePhase([string]$Phase) {
  $script:MaintenancePhase = $Phase
  if ($null -ne $script:MaintenanceRun) { Save-MaintenanceRun 'running' }
}
