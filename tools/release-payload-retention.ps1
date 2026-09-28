param([switch]$Execute)
$ErrorActionPreference = 'Stop'
$runtime = 'D:\teruisi-runtime\teruisi-worker-sales'
$releases = Join-Path $runtime 'releases'
$mutex = [Threading.Mutex]::new($false, 'Local\TERUISI.Worker.LocalService.v1')
$held = $false
$auditStream = $null
if ($Execute) {
  $installed = 'D:\teruisi-runtime\django-sales\app\tools\release-payload-retention.ps1'
  if ([IO.Path]::GetFullPath($PSCommandPath) -ine $installed) { throw 'Release cleanup requires the installed operator' }
  $previousLibrary = $env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY
  try {
    $env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY = '1'
    . (Join-Path $PSScriptRoot 'django-local-service.ps1') -Action Status
    Assert-DeployedApplication
    Assert-RuntimeRootAclHardened
  } finally { $env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY = $previousLibrary }
}
function Write-RetentionAudit($value) {
  $bytes = [Text.Encoding]::UTF8.GetBytes(($value | ConvertTo-Json -Depth 12 -Compress) + "`n")
  $auditStream.Write($bytes, 0, $bytes.Length); $auditStream.Flush($true)
}
function Assert-RetentionTarget($target) {
  if ($target.releaseId -cnotmatch '^\d{8}T\d{6}Z-[0-9a-f]{16}$' -or
      $target.name -cnotin @('dist','helper','source-snapshot','node_modules') -or
      $plan.retainedReleaseIds -ccontains $target.releaseId) { throw 'Protected or invalid target' }
  $expected = [IO.Path]::GetFullPath((Join-Path (Join-Path $releases $target.releaseId) $target.name))
  if ([IO.Path]::GetFullPath($target.path) -ine $expected -or
      -not $expected.StartsWith($releases + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Target escaped scope' }
  $cursor = Get-Item -LiteralPath $expected -Force
  while ($null -ne $cursor) {
    if ($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Reparse ancestor rejected' }
    $cursor = $cursor.Parent
  }
  $queue = [Collections.Queue]::new(); $queue.Enqueue($expected)
  while ($queue.Count -gt 0) {
    foreach ($item in @(Get-ChildItem -LiteralPath $queue.Dequeue() -Force)) {
      if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Reparse child rejected' }
      if ($item.PSIsContainer) { $queue.Enqueue($item.FullName) }
    }
  }
  return $expected
}
try {
  $held = $mutex.WaitOne(0)
  if (-not $held) { throw 'Worker lifecycle is busy; cleanup skipped' }
  $json = & node (Join-Path $PSScriptRoot 'release-payload-retention.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'Release retention preflight failed' }
  $plan = ($json -join "`n") | ConvertFrom-Json
  if (-not $Execute) { $plan | ConvertTo-Json -Depth 15 -Compress; return }
  $audit = Join-Path $runtime 'audit\release-retention'
  if (-not (Test-Path -LiteralPath $audit)) { New-Item -ItemType Directory -Path $audit -Force | Out-Null }
  $cursor = Get-Item -LiteralPath $audit
  while ($null -ne $cursor) { if ($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Audit path is linked' }; $cursor = $cursor.Parent }
  $auditStream = [IO.FileStream]::new((Join-Path $audit ([Guid]::NewGuid().ToString('N') + '.jsonl')), [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
  Write-RetentionAudit @{event='planned';plan=$plan}
  foreach ($target in $plan.targets) {
    $path = Assert-RetentionTarget $target
    $root = Split-Path -Parent $path
    $processes = @(Get-CimInstance Win32_Process -OperationTimeoutSec 30)
    if (@($processes | Where-Object { $_.Name -in @('node.exe','workerd.exe') -and (-not $_.CommandLine -or -not $_.ExecutablePath) }).Count) { throw 'Process ownership is unknown' }
    $references = @($processes | ForEach-Object { $_.CommandLine; $_.ExecutablePath })
    $references += @(Get-CimInstance Win32_Service | ForEach-Object { $_.PathName })
    $references += @(Get-ScheduledTask | ForEach-Object { $_.Actions | ForEach-Object { $_.Execute; $_.Arguments; $_.WorkingDirectory } })
    $shell = New-Object -ComObject WScript.Shell
    foreach ($startup in @([Environment]::GetFolderPath('Startup'), [Environment]::GetFolderPath('CommonStartup'))) {
      if (Test-Path -LiteralPath $startup) {
        foreach ($link in @(Get-ChildItem -LiteralPath $startup -Filter '*.lnk')) {
          $shortcut = $shell.CreateShortcut($link.FullName)
          $references += @($shortcut.TargetPath, $shortcut.Arguments, $shortcut.WorkingDirectory)
        }
      }
    }
    if (@($references | Where-Object { $_ -and $_.Replace('/','\').IndexOf($root,[StringComparison]::OrdinalIgnoreCase) -ge 0 }).Count) { throw 'Old release still has an active reference' }
    if ((Get-FileHash -LiteralPath (Join-Path $root 'deployment-manifest.json') -Algorithm SHA256).Hash -ine $target.manifestSha256) { throw 'Target binding changed' }
    Write-RetentionAudit @{event='delete-reserved';path=$path;manifestSha256=$target.manifestSha256}
    Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction Stop
    if (Test-Path -LiteralPath $path) { throw 'Release payload cleanup incomplete' }
    Write-RetentionAudit @{event='deleted';path=$path}
  }
  foreach ($file in @($plan.retainedKeys) + @($plan.preservedMetadata)) {
    if ((Get-FileHash -LiteralPath $file.path -Algorithm SHA256).Hash -ine $file.sha256) { throw 'Preserved release material changed' }
  }
  $raw = & node (Join-Path $PSScriptRoot 'worker-local-release-rotation.mjs') resolve --json
  if ($LASTEXITCODE -ne 0) { throw 'Release chain postflight failed' }
  $after = ($raw -join "`n") | ConvertFrom-Json
  if ($after.chainStateSha256 -cne $plan.chainStateSha256) { throw 'Release chain changed during cleanup' }
  Write-RetentionAudit @{event='completed';headReleaseId=$plan.headReleaseId;removedPayloads=@($plan.targets).Count;chainStateSha256=$plan.chainStateSha256}
  @{status='completed';removedPayloads=@($plan.targets).Count;serviceStateChanged=$false} | ConvertTo-Json -Compress
} finally {
  if ($null -ne $auditStream) { $auditStream.Dispose() }
  if ($held) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
