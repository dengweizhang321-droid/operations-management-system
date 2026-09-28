# Loaded by the installed PostgreSQL maintenance operator, under its existing mutex.
$MaintenanceArchiveRoot = 'E:\运营管理系统业务数据'

function Get-MaintenanceRetentionPolicy {
  $file = Assert-RuntimeChildPath (Join-Path $MaintenanceRequest.RuntimeRoot 'run\backup-retention-v2.json')
  if (-not (Test-Path -LiteralPath $file)) { return $null }
  Assert-MaintenanceNoReparsePoints $file 'Backup retention policy'
  $policy = Read-JsonFile $file 'Backup retention policy'
  Assert-MaintenanceExactPropertySet $policy @('version','maximumRecoveryPoints','archiveRoot','pins') 'Backup retention policy'
  if ($policy.version -cne 'teruisi-backup-retention-v2' -or $policy.maximumRecoveryPoints -ne 3 -or
      $policy.archiveRoot -cne $MaintenanceArchiveRoot -or @($policy.pins).Count -gt 2) { throw 'Invalid backup retention policy' }
  $seen = @{}
  foreach ($pin in @($policy.pins)) {
    Assert-MaintenanceExactPropertySet $pin @('backupId','manifestSha256') 'Backup protection'
    if ($pin.backupId -cnotmatch '^daily-\d{8}T\d{6}Z-[0-9a-f]{12}$' -or
        $pin.manifestSha256 -cnotmatch '^[0-9a-f]{64}$' -or $seen.ContainsKey($pin.backupId)) { throw 'Invalid backup protection' }
    $seen[$pin.backupId] = $true
  }
  return $policy
}

function Assert-MaintenanceArchiveRoot([bool]$Create = $false) {
  if ($Create -and -not (Test-Path -LiteralPath $MaintenanceArchiveRoot)) {
    New-Item -ItemType Directory -Path $MaintenanceArchiveRoot | Out-Null
  }
  if (-not (Test-Path -LiteralPath $MaintenanceArchiveRoot -PathType Container)) { throw 'E-drive backup directory is unavailable' }
  $item = Get-Item -LiteralPath $MaintenanceArchiveRoot -Force
  $cursor = $item
  while ($null -ne $cursor) {
    if (($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Backup root cannot contain a reparse point' }
    $cursor = $cursor.Parent
  }
  if ($Create) {
    # The runtime DACL setter intentionally refuses external directories.
    # Only this already-validated, fixed archive root receives its own DACL.
    $dacl = New-RuntimeRootDacl
    if ($null -ne ('System.IO.FileSystemAclExtensions' -as [type])) {
      [IO.FileSystemAclExtensions]::SetAccessControl([IO.DirectoryInfo]$item, $dacl)
    } else {
      $item.SetAccessControl($dacl)
    }
  }
  $allowed = @((Get-AllowedAclSids) | ForEach-Object { $_.Value })
  Assert-ExactRuntimeAclEntry $item (Get-RuntimeItemAccessControl $item) $allowed $MaintenanceArchiveRoot
  return $MaintenanceArchiveRoot
}

function Write-MaintenanceRetentionAudit([object]$Value) {
  $root = Assert-RuntimeChildPath (Join-Path $MaintenanceRequest.RuntimeRoot 'audits\postgres-retention')
  if (-not (Test-Path -LiteralPath $root)) { New-Item -ItemType Directory -Path $root -Force | Out-Null }
  Assert-MaintenanceNoReparsePoints $root 'Retention audit root'
  $file = Join-Path $root ($script:MaintenanceRetentionRunId + '.jsonl')
  $bytes = $MaintenanceUtf8NoBom.GetBytes(($Value | ConvertTo-Json -Depth 12 -Compress) + "`n")
  $stream = [IO.FileStream]::new($file, [IO.FileMode]::Append, [IO.FileAccess]::Write, [IO.FileShare]::Read)
  try { $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
}

function Get-MaintenanceRecoveryPoints {
  $result = @{}
  foreach ($root in @((Get-MaintenanceBackupRoot $false), (Assert-MaintenanceArchiveRoot))) {
    if (-not (Test-Path -LiteralPath $root)) { continue }
    $directories = @(Get-ChildItem -LiteralPath $root -Directory -Force | Where-Object { $_.Name -cmatch '^daily-\d{8}T\d{6}Z-[0-9a-f]{12}$' })
    if ($directories.Count -gt 4096) { throw 'Backup inventory exceeds bound' }
    foreach ($directory in $directories) {
      # An invalid eligible archive stops the entire plan; it is never skipped for deletion.
      $archive = Resolve-MaintenanceBackupArchive $directory.FullName
      if ([DateTimeOffset]::Parse($archive.Manifest.completedAt) -gt [DateTimeOffset]::UtcNow) { throw 'Backup completion is in the future' }
      $id = [string]$archive.Manifest.backupId
      if ($result.ContainsKey($id)) {
        if ($result[$id].manifestSha256 -cne $archive.ManifestSha256) { throw 'Conflicting copies of the same backup' }
        $result[$id].copies += $archive
      } else {
        $result[$id] = [pscustomobject]@{backupId=$id; manifestSha256=$archive.ManifestSha256;
          completedAt=[DateTimeOffset]::Parse($archive.Manifest.completedAt); copies=@($archive)}
      }
    }
  }
  return @($result.Values | Sort-Object @{Expression='completedAt';Descending=$true}, @{Expression='backupId';Descending=$true})
}

function Invoke-MaintenanceRetention {
  Assert-MaintenanceRuntimeContext | Out-Null
  $policy = Get-MaintenanceRetentionPolicy
  if ($null -eq $policy) { throw 'Backup retention has not been adopted' }
  $points = @(Get-MaintenanceRecoveryPoints)
  $keep = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  foreach ($pin in @($policy.pins)) {
    $matching = @($points | Where-Object { $_.backupId -ceq $pin.backupId -and $_.manifestSha256 -ceq $pin.manifestSha256 })
    if ($matching.Count -ne 1) { throw 'Protected recovery point is missing or changed' }
    [void]$keep.Add($pin.backupId)
  }
  foreach ($point in $points) { if ($keep.Count -lt 3) { [void]$keep.Add($point.backupId) } }
  $plan = [pscustomobject]@{version='teruisi-backup-retention-plan-v2'; maximumRecoveryPoints=3;
    retained=@($points | Where-Object {$keep.Contains($_.backupId)} | ForEach-Object {$_.backupId});
    removed=@($points | Where-Object {-not $keep.Contains($_.backupId)} | ForEach-Object {$_.backupId}); serviceStateChanged=$false}
  if (-not $MaintenanceRequest.Execute) { return $plan }
  if (-not $MaintenanceRequest.ConfirmedPrune) { throw 'Retention requires ConfirmedPrune' }
  $script:MaintenanceRetentionRunId = [Guid]::NewGuid().ToString('N')
  Write-MaintenanceRetentionAudit @{event='plan';plan=$plan;at=[DateTimeOffset]::UtcNow.ToString('o')}
  # First publish and revalidate every survivor on E. Never delete to make room for a backup.
  foreach ($point in @($points | Where-Object {$keep.Contains($_.backupId)})) {
    $target = Join-Path $MaintenanceArchiveRoot $point.backupId
    if (-not (Test-Path -LiteralPath $target)) {
      $source = Resolve-MaintenanceBackupArchive $point.copies[0].Directory $point.manifestSha256
      $stage = Join-Path $MaintenanceArchiveRoot ('.' + $point.backupId + '.' + $script:MaintenanceRetentionRunId + '.incomplete')
      if (Test-Path -LiteralPath $stage) { throw 'Archive staging already exists' }
      New-Item -ItemType Directory -Path $stage | Out-Null
      try {
        foreach ($name in @('teruisi-sales.dump','backup-manifest.json','backup-manifest.json.sha256')) {
          Copy-Item -LiteralPath (Join-Path $source.Directory $name) -Destination (Join-Path $stage $name)
        }
        Assert-MaintenanceNoReparsePoints $stage 'Archive staging'
        Read-MaintenanceArchive $stage $point.manifestSha256 | Out-Null
        Move-Item -LiteralPath $stage -Destination $target
      } finally {
        if (Test-Path -LiteralPath $stage) {
          if ((Get-MaintenanceCanonicalPath (Split-Path -Parent $stage)) -ine $MaintenanceArchiveRoot -or
              [IO.Path]::GetFileName($stage) -cne ('.' + $point.backupId + '.' + $script:MaintenanceRetentionRunId + '.incomplete')) { throw 'Staging cleanup escaped scope' }
          Assert-MaintenanceNoReparsePoints $stage 'Archive staging cleanup'
          foreach ($entry in @(Get-ChildItem -LiteralPath $stage -Force)) {
            if ($entry.PSIsContainer -or $entry.Name -cnotin @('teruisi-sales.dump','backup-manifest.json','backup-manifest.json.sha256')) { throw 'Unexpected staging content' }
            Remove-Item -LiteralPath $entry.FullName -Force -ErrorAction Stop
          }
          [IO.Directory]::Delete($stage, $false)
        }
      }
    }
    Resolve-MaintenanceBackupArchive $target $point.manifestSha256 | Out-Null
  }
  $survivorStreams = [Collections.Generic.List[IDisposable]]::new()
  try {
    foreach ($survivor in @($points | Where-Object {$keep.Contains($_.backupId)})) {
      $survivorDirectory = Join-Path $MaintenanceArchiveRoot $survivor.backupId
      foreach ($name in @('teruisi-sales.dump','backup-manifest.json','backup-manifest.json.sha256')) {
        $survivorStreams.Add([IO.FileStream]::new((Join-Path $survivorDirectory $name), [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read))
      }
      Resolve-MaintenanceBackupArchive $survivorDirectory $survivor.manifestSha256 | Out-Null
    }
  foreach ($point in $points) {
    foreach ($copy in $point.copies) {
      if ($keep.Contains($point.backupId) -and (Split-Path -Parent $copy.Directory) -ieq $MaintenanceArchiveRoot) { continue }
      # Verified survivors remain open without write/delete sharing throughout pruning.
      $checked = Resolve-MaintenanceBackupArchive $copy.Directory $point.manifestSha256
      $parent = Get-MaintenanceCanonicalPath (Split-Path -Parent $checked.Directory)
      if ($parent -ine (Get-MaintenanceBackupRoot $false) -and $parent -ine $MaintenanceArchiveRoot) { throw 'Delete escaped backup roots' }
      Write-MaintenanceRetentionAudit @{event='delete-reserved';backupId=$point.backupId;manifestSha256=$point.manifestSha256;path=$checked.Directory}
      Remove-Item -LiteralPath $checked.Directory -Recurse -Force -ErrorAction Stop
      if (Test-Path -LiteralPath $checked.Directory) { throw 'Backup cleanup incomplete' }
      Write-MaintenanceRetentionAudit @{event='deleted';backupId=$point.backupId;path=$checked.Directory}
    }
  }
  Write-MaintenanceRetentionAudit @{event='completed';plan=$plan}
  } finally {
    foreach ($stream in $survivorStreams) { $stream.Dispose() }
  }
  return $plan
}

function Set-MaintenanceRecoveryProtection {
  Assert-MaintenanceRuntimeContext | Out-Null
  if (-not $MaintenanceRequest.Execute) { throw 'Protection changes require Execute' }
  $policy = Get-MaintenanceRetentionPolicy
  if ($MaintenanceRequest.Action -ceq 'AdoptRetention') {
    if ($null -ne $policy) { throw 'Retention already adopted; use Protect or Unprotect' }
    Assert-MaintenanceArchiveRoot $true | Out-Null
    $policy = [pscustomobject]@{version='teruisi-backup-retention-v2';maximumRecoveryPoints=3;archiveRoot=$MaintenanceArchiveRoot;pins=@()}
  } elseif ($null -eq $policy) { throw 'Retention has not been adopted' }
  $archive = Resolve-MaintenanceBackupArchive $MaintenanceRequest.BackupDirectory $MaintenanceRequest.ApprovedManifestSha256
  if ($MaintenanceRequest.ApprovedManifestSha256 -cnotmatch '^[0-9a-f]{64}$') { throw 'Protection requires approved manifest SHA' }
  $pins = @($policy.pins | Where-Object {$_.backupId -cne $archive.Manifest.backupId})
  if ($MaintenanceRequest.Action -cne 'Unprotect') {
    $pins += [pscustomobject]@{backupId=[string]$archive.Manifest.backupId;manifestSha256=[string]$archive.ManifestSha256}
  }
  if ($pins.Count -gt 2) { throw 'Keep one free slot for new recovery points' }
  $policy.pins = $pins
  $script:MaintenanceRetentionRunId = [Guid]::NewGuid().ToString('N')
  Write-MaintenanceRetentionAudit @{event='protection-change';action=$MaintenanceRequest.Action;policy=$policy}
  Write-AtomicJson (Assert-RuntimeChildPath (Join-Path $MaintenanceRequest.RuntimeRoot 'run\backup-retention-v2.json')) $policy
  return [pscustomobject]@{status='completed';policy=$policy;serviceStateChanged=$false}
}
