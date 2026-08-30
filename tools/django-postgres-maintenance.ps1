[CmdletBinding()]
param(
  [ValidateSet("Backup", "Verify", "RestoreRehearsal", "Prune", "Status")]
  [string]$Action = "Status",
  [string]$RuntimeRoot = "D:\teruisi-runtime\django-sales",
  [string]$BackupDirectory = "",
  [string]$ApprovedManifestSha256 = "",
  [string]$RehearsalId = "",
  [ValidateRange(55432, 55999)]
  [int]$RehearsalPort = 55432,
  [ValidateRange(7, 3650)]
  [int]$RetentionDays = 30,
  [ValidateRange(3, 365)]
  [int]$MinimumSuccessfulBackups = 7,
  [switch]$Execute,
  [switch]$ConfirmedIsolatedRestore,
  [switch]$ConfirmedPrune
)

$ErrorActionPreference = "Stop"
$MaintenanceUtf8NoBom = [Text.UTF8Encoding]::new($false)
$MaintenanceFixedRuntimeRoot = "D:\teruisi-runtime\django-sales"
$MaintenanceBackupVersion = "teruisi-postgres-daily-backup-v1"
$MaintenanceRestoreVersion = "teruisi-postgres-restore-rehearsal-v1"
$MaintenancePruneVersion = "teruisi-postgres-backup-prune-v1"
$MaintenanceRequest = [pscustomobject][ordered]@{
  Action = $Action
  RuntimeRoot = $RuntimeRoot
  BackupDirectory = $BackupDirectory
  ApprovedManifestSha256 = $ApprovedManifestSha256
  RehearsalId = $RehearsalId
  RehearsalPort = $RehearsalPort
  RetentionDays = $RetentionDays
  MinimumSuccessfulBackups = $MinimumSuccessfulBackups
  Execute = $Execute.IsPresent
  ConfirmedIsolatedRestore = $ConfirmedIsolatedRestore.IsPresent
  ConfirmedPrune = $ConfirmedPrune.IsPresent
}

function Test-MaintenanceFullyQualifiedPath([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path)) { return $false }
  try { [void][IO.Path]::GetFullPath($Path) } catch { return $false }
  if ([IO.Path]::DirectorySeparatorChar -eq "\") {
    return $Path -match "^[A-Za-z]:[\\/]" -or
      $Path -match "^[\\/]{2}[^\\/]+[\\/]+[^\\/]+(?:[\\/]|$)"
  }
  return $Path.StartsWith("/", [StringComparison]::Ordinal)
}

function Get-MaintenanceCanonicalPath([string]$Path) {
  return [IO.Path]::GetFullPath($Path).TrimEnd(
    [IO.Path]::DirectorySeparatorChar,
    [IO.Path]::AltDirectorySeparatorChar
  )
}

function Assert-MaintenanceExactPropertySet(
  [object]$Value,
  [string[]]$Expected,
  [string]$Label
) {
  if ($null -eq $Value -or $Value -isnot [pscustomobject]) {
    throw "$Label 必须是 JSON 对象"
  }
  $actual = @($Value.PSObject.Properties.Name | Sort-Object)
  $wanted = @($Expected | Sort-Object)
  if ($actual.Count -ne $wanted.Count) { throw "$Label 字段集合无效" }
  for ($index = 0; $index -lt $wanted.Count; $index++) {
    if ([string]$actual[$index] -cne [string]$wanted[$index]) {
      throw "$Label 字段集合无效"
    }
  }
}

function Test-MaintenanceInteger([object]$Value) {
  if ($null -eq $Value) { return $false }
  return [Type]::GetTypeCode($Value.GetType()) -in @(
    [TypeCode]::SByte, [TypeCode]::Byte,
    [TypeCode]::Int16, [TypeCode]::UInt16,
    [TypeCode]::Int32, [TypeCode]::UInt32,
    [TypeCode]::Int64, [TypeCode]::UInt64
  )
}

function Assert-MaintenanceNoReparsePoints([string]$Path, [string]$Label) {
  $root = Get-Item -LiteralPath $Path -Force
  if (($root.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "$Label 不得是重解析点"
  }
  if (-not $root.PSIsContainer) { return }
  $directories = [Collections.Queue]::new()
  $directories.Enqueue($root)
  while ($directories.Count -gt 0) {
    $directory = $directories.Dequeue()
    foreach ($item in @(Get-ChildItem -LiteralPath $directory.FullName -Force)) {
      if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "$Label 不得包含重解析点"
      }
      if ($item.PSIsContainer) { $directories.Enqueue($item) }
    }
  }
}

function Resolve-MaintenanceDirectChildDirectory(
  [string]$Path,
  [string]$Parent,
  [string]$NamePattern,
  [string]$Label
) {
  if (-not (Test-MaintenanceFullyQualifiedPath $Path)) {
    throw "$Label 必须是绝对路径"
  }
  $resolved = Get-MaintenanceCanonicalPath $Path
  $resolvedParent = Get-MaintenanceCanonicalPath $Parent
  if (-not (Test-Path -LiteralPath $resolved -PathType Container) -or
      (Get-MaintenanceCanonicalPath (Split-Path -Parent $resolved)) -ine $resolvedParent -or
      [IO.Path]::GetFileName($resolved) -cnotmatch $NamePattern) {
    throw "$Label 不是受控根目录的合法直接子目录"
  }
  Assert-MaintenanceNoReparsePoints $resolved $Label
  return $resolved
}

function Write-MaintenanceAtomicText([string]$Path, [string]$Value) {
  $directory = Split-Path -Parent $Path
  $temporary = Join-Path $directory (
    ".{0}.{1}.tmp" -f [IO.Path]::GetFileName($Path), [Guid]::NewGuid().ToString("N")
  )
  try {
    [IO.File]::WriteAllText($temporary, $Value, $MaintenanceUtf8NoBom)
    Move-Item -LiteralPath $temporary -Destination $Path -Force
  } finally {
    if (Test-Path -LiteralPath $temporary) {
      Remove-Item -LiteralPath $temporary -Force
    }
  }
}

function Invoke-MaintenancePgEnvironment(
  [hashtable]$Values,
  [scriptblock]$Operation
) {
  $names = @(
    "PGHOST", "PGPORT", "PGUSER", "PGDATABASE", "PGPASSWORD",
    "PGAPPNAME", "PGOPTIONS", "PGCLIENTENCODING"
  )
  $previous = @{}
  foreach ($name in $names) {
    $previous[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
    [Environment]::SetEnvironmentVariable($name, $null, "Process")
  }
  try {
    foreach ($name in $Values.Keys) {
      if ($name -notin $names) { throw "拒绝设置未批准的 libpq 环境变量" }
      [Environment]::SetEnvironmentVariable($name, [string]$Values[$name], "Process")
    }
    & $Operation
  } finally {
    foreach ($name in $names) {
      [Environment]::SetEnvironmentVariable($name, $previous[$name], "Process")
    }
  }
}

function Invoke-MaintenanceMutex([scriptblock]$Operation) {
  $name = "Local\TERUISI-DjangoPostgresMaintenance-" + (
    Get-Sha256Text (Get-MaintenanceCanonicalPath $MaintenanceRequest.RuntimeRoot)
  ).Substring(0, 20)
  $mutex = [Threading.Mutex]::new($false, $name)
  $acquired = $false
  try {
    try {
      $acquired = $mutex.WaitOne([TimeSpan]::FromSeconds(5))
    } catch [Threading.AbandonedMutexException] {
      $acquired = $true
    }
    if (-not $acquired) { throw "另一个 PostgreSQL 维护操作仍在运行" }
    & $Operation
  } finally {
    if ($acquired) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
  }
}

function Get-MaintenanceBackupRoot([bool]$Create = $false) {
  $root = Assert-RuntimeChildPath (
    Join-Path $MaintenanceRequest.RuntimeRoot "backups\postgres-daily"
  )
  if ($Create -and -not (Test-Path -LiteralPath $root)) {
    New-Item -ItemType Directory -Path $root -Force | Out-Null
  }
  if (Test-Path -LiteralPath $root -PathType Container) {
    $item = Get-Item -LiteralPath $root -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "PostgreSQL 日常备份根目录不得是重解析点"
    }
  } elseif ($Create) {
    throw "PostgreSQL 日常备份根目录无效"
  }
  return $root
}

function Assert-MaintenanceRuntimeContext {
  Assert-DeployedApplication
  Assert-RuntimeRootAclHardened
  $config = Read-JsonFile $ConfigPath "Django 本机服务配置"
  if ([int]$config.version -ne 3 -or
      [string]$config.postgresAddress -cne "127.0.0.1:5432") {
    throw "Django 本机 PostgreSQL 配置不符合固定回环契约"
  }
  $expectedTool = Join-Path $InstalledAppRoot "tools\postgres-consistent-backup.py"
  if (-not (Test-Path -LiteralPath $expectedTool -PathType Leaf)) {
    throw "runtime app 缺少一致性备份工具"
  }
  return $expectedTool
}

function Assert-MaintenanceEvidence(
  [object]$Evidence,
  [string]$ExpectedDatabase,
  [string]$ExpectedUser,
  [int]$ExpectedPort
) {
  Assert-MaintenanceExactPropertySet $Evidence @(
    "database", "tables", "migrations", "revisions", "writeAuthority",
    "contentSha256", "canonicalSha256"
  ) "PostgreSQL 证据"
  foreach ($digest in @(
    [string]$Evidence.contentSha256,
    [string]$Evidence.canonicalSha256
  )) {
    if ($digest -cnotmatch "^[0-9a-f]{64}$") {
      throw "PostgreSQL 证据摘要无效"
    }
  }

  Assert-MaintenanceExactPropertySet $Evidence.database @(
    "name", "user", "serverAddress", "serverPort", "inRecovery",
    "serverVersionNumber"
  ) "PostgreSQL 身份证据"
  if ([string]$Evidence.database.name -cne $ExpectedDatabase -or
      [string]$Evidence.database.user -cne $ExpectedUser -or
      [string]$Evidence.database.serverAddress -notin @("127.0.0.1", "::1") -or
      -not (Test-MaintenanceInteger $Evidence.database.serverPort) -or
      [int]$Evidence.database.serverPort -ne $ExpectedPort -or
      [bool]$Evidence.database.inRecovery -or
      -not (Test-MaintenanceInteger $Evidence.database.serverVersionNumber) -or
      [int]$Evidence.database.serverVersionNumber -lt 170000) {
    throw "PostgreSQL 身份证据不符合批准目标"
  }

  if ($Evidence.tables -isnot [pscustomobject]) {
    throw "PostgreSQL 表行数证据无效"
  }
  $requiredTables = @(
    "django_migrations", "sales_data_revisions", "sales_import_batches",
    "sales_order_lines", "sales_write_authority", "erp_product_master"
  )
  $tableNames = @($Evidence.tables.PSObject.Properties.Name)
  foreach ($required in $requiredTables) {
    if ($required -notin $tableNames) { throw "PostgreSQL 证据缺少关键表" }
  }
  foreach ($property in $Evidence.tables.PSObject.Properties) {
    if ($property.Name -cne "django_migrations" -and
        $property.Name -cnotmatch "^(?:sales|erp|finance)_[a-z0-9_]+$") {
      throw "PostgreSQL 证据包含越界表"
    }
    if (-not (Test-MaintenanceInteger $property.Value) -or
        [int64]$property.Value -lt 0) {
      throw "PostgreSQL 表行数证据无效"
    }
  }

  $migrations = @($Evidence.migrations)
  if ($migrations.Count -lt 1) { throw "Django migration 证据为空" }
  foreach ($migration in $migrations) {
    Assert-MaintenanceExactPropertySet $migration @("app", "name") "Django migration 证据"
    if ([string]$migration.app -cnotmatch "^[A-Za-z0-9_]{1,100}$" -or
        [string]$migration.name -cnotmatch "^[A-Za-z0-9_]{1,200}$") {
      throw "Django migration 身份无效"
    }
  }

  if ($Evidence.revisions -isnot [pscustomobject] -or
      $null -eq $Evidence.revisions.PSObject.Properties["sales"] -or
      $null -eq $Evidence.revisions.PSObject.Properties["erp"]) {
    throw "PostgreSQL revision 证据不完整"
  }
  foreach ($property in $Evidence.revisions.PSObject.Properties) {
    if ($property.Name -cnotmatch "^[a-z][a-z0-9_-]{0,63}$" -or
        -not (Test-MaintenanceInteger $property.Value) -or
        [int64]$property.Value -lt 0) {
      throw "PostgreSQL revision 证据无效"
    }
  }

  Assert-MaintenanceExactPropertySet $Evidence.writeAuthority @(
    "status", "authorityEpoch", "cutoverId"
  ) "销售写入权威证据"
  if ([string]$Evidence.writeAuthority.status -cne "active" -or
      [string]$Evidence.writeAuthority.authorityEpoch -cnotmatch "^[0-9a-fA-F-]{36}$" -or
      [string]$Evidence.writeAuthority.cutoverId -cnotmatch "^[A-Za-z0-9._:-]{8,128}$") {
    throw "销售写入权威证据无效"
  }
}

function Assert-MaintenanceBackupPayload([object]$Payload) {
  Assert-MaintenanceExactPropertySet $Payload @(
    "version", "status", "snapshotIdSha256", "evidence", "nativeDiagnostic"
  ) "一致性备份工具结果"
  if ([string]$Payload.version -cne "teruisi-postgres-consistent-backup-v1" -or
      [string]$Payload.status -cne "completed" -or
      [string]$Payload.snapshotIdSha256 -cnotmatch "^[0-9a-f]{64}$") {
    throw "一致性备份工具结果无效"
  }
  Assert-MaintenanceExactPropertySet $Payload.nativeDiagnostic @(
    "exitCode", "outputBytes", "capturedBytes", "outputTruncated", "outputSha256"
  ) "pg_dump 诊断"
  if ([int]$Payload.nativeDiagnostic.exitCode -ne 0 -or
      [string]$Payload.nativeDiagnostic.outputSha256 -cnotmatch "^[0-9a-f]{64}$") {
    throw "pg_dump 诊断未通过"
  }
  Assert-MaintenanceEvidence $Payload.evidence "teruisi_sales" "teruisi_sales_owner" 5432
}

function Read-MaintenanceArchive(
  [string]$Directory,
  [string]$ApprovedSha256 = "",
  [switch]$RequireCurrentDeployment
) {
  $manifestPath = Join-Path $Directory "backup-manifest.json"
  $sidecarPath = Join-Path $Directory "backup-manifest.json.sha256"
  $dumpPath = Join-Path $Directory "teruisi-sales.dump"
  $expectedFiles = @(
    "backup-manifest.json", "backup-manifest.json.sha256", "teruisi-sales.dump"
  )
  $actualFiles = @(
    Get-ChildItem -LiteralPath $Directory -Force | ForEach-Object {
      if ($_.PSIsContainer) { throw "PostgreSQL 备份目录不得包含子目录" }
      $_.Name
    } | Sort-Object
  )
  $wantedFiles = @($expectedFiles | Sort-Object)
  if ($actualFiles.Count -ne $wantedFiles.Count) {
    throw "PostgreSQL 备份文件集合无效"
  }
  for ($index = 0; $index -lt $wantedFiles.Count; $index++) {
    if ([string]$actualFiles[$index] -cne [string]$wantedFiles[$index]) {
      throw "PostgreSQL 备份文件集合无效"
    }
  }

  $manifestSha = Get-FileSha256 $manifestPath
  $sidecarSha = (Get-Content -Raw -LiteralPath $sidecarPath -Encoding UTF8).Trim()
  if ($manifestSha -cnotmatch "^[0-9a-f]{64}$" -or
      $sidecarSha -cne $manifestSha -or
      (-not [string]::IsNullOrWhiteSpace($ApprovedSha256) -and
        $ApprovedSha256 -cne $manifestSha)) {
    throw "PostgreSQL 备份 manifest 摘要未获批准或已变化"
  }

  $manifest = Read-JsonFile $manifestPath "PostgreSQL 备份 manifest"
  Assert-MaintenanceExactPropertySet $manifest @(
    "version", "status", "backupId", "createdAt", "completedAt", "database",
    "dump", "evidence", "software"
  ) "PostgreSQL 备份 manifest"
  if ([string]$manifest.version -cne $MaintenanceBackupVersion -or
      [string]$manifest.status -cne "completed" -or
      [string]$manifest.backupId -cnotmatch "^daily-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}$") {
    throw "PostgreSQL 备份 manifest 身份无效"
  }
  $created = [DateTimeOffset]::MinValue
  $completed = [DateTimeOffset]::MinValue
  if (-not [DateTimeOffset]::TryParse([string]$manifest.createdAt, [ref]$created) -or
      -not [DateTimeOffset]::TryParse([string]$manifest.completedAt, [ref]$completed) -or
      $completed -lt $created) {
    throw "PostgreSQL 备份时间证据无效"
  }

  Assert-MaintenanceExactPropertySet $manifest.database @(
    "name", "host", "port", "sourceRole", "consistency"
  ) "PostgreSQL 备份数据库身份"
  if ([string]$manifest.database.name -cne "teruisi_sales" -or
      [string]$manifest.database.host -cne "127.0.0.1" -or
      [int]$manifest.database.port -ne 5432 -or
      [string]$manifest.database.sourceRole -cne "teruisi_sales_owner" -or
      [string]$manifest.database.consistency -cne "exported-snapshot") {
    throw "PostgreSQL 备份数据库身份无效"
  }

  Assert-MaintenanceExactPropertySet $manifest.dump @(
    "fileName", "sizeBytes", "sha256", "archiveEntryCount", "snapshotIdSha256"
  ) "PostgreSQL dump 证据"
  if ([string]$manifest.dump.fileName -cne "teruisi-sales.dump" -or
      -not (Test-MaintenanceInteger $manifest.dump.sizeBytes) -or
      [int64]$manifest.dump.sizeBytes -lt 1 -or
      [int64](Get-Item -LiteralPath $dumpPath).Length -ne [int64]$manifest.dump.sizeBytes -or
      [string]$manifest.dump.sha256 -cnotmatch "^[0-9a-f]{64}$" -or
      (Get-FileSha256 $dumpPath) -cne [string]$manifest.dump.sha256 -or
      -not (Test-MaintenanceInteger $manifest.dump.archiveEntryCount) -or
      [int]$manifest.dump.archiveEntryCount -lt 10 -or
      [string]$manifest.dump.snapshotIdSha256 -cnotmatch "^[0-9a-f]{64}$") {
    throw "PostgreSQL dump 证据无效"
  }

  Assert-MaintenanceEvidence $manifest.evidence "teruisi_sales" "teruisi_sales_owner" 5432
  Assert-MaintenanceExactPropertySet $manifest.software @(
    "deploymentManifestSha256", "serviceConfigSha256", "serviceScriptSha256",
    "operatorScriptSha256", "evidenceToolSha256", "pgDumpSha256", "pgRestoreSha256"
  ) "PostgreSQL 备份软件证据"
  foreach ($property in $manifest.software.PSObject.Properties) {
    if ([string]$property.Value -cnotmatch "^[0-9a-f]{64}$") {
      throw "PostgreSQL 备份软件摘要无效"
    }
  }
  if ($RequireCurrentDeployment.IsPresent -and
      ((Get-FileSha256 $DeploymentManifestPath) -cne [string]$manifest.software.deploymentManifestSha256 -or
       (Get-FileSha256 $ConfigPath) -cne [string]$manifest.software.serviceConfigSha256)) {
    throw "PostgreSQL 备份与当前部署或服务配置不一致"
  }

  $pgRestore = Join-Path $PostgresBin "pg_restore.exe"
  $archiveRun = Invoke-BoundedNativeProcess $pgRestore @("--list", $dumpPath) $Directory
  if ($archiveRun.ExitCode -ne 0 -or
      @($archiveRun.Output).Count -ne [int]$manifest.dump.archiveEntryCount) {
    throw "PostgreSQL dump 归档目录复验失败（$(Get-NativeFailureSummary $archiveRun)）"
  }
  return [pscustomobject][ordered]@{
    Directory = $Directory
    ManifestPath = $manifestPath
    ManifestSha256 = $manifestSha
    DumpPath = $dumpPath
    Manifest = $manifest
  }
}

function Resolve-MaintenanceBackupArchive(
  [string]$RequestedDirectory,
  [string]$ApprovedSha256 = "",
  [switch]$RequireCurrentDeployment
) {
  $backupRoot = Get-MaintenanceBackupRoot $false
  if (-not (Test-Path -LiteralPath $backupRoot -PathType Container)) {
    throw "PostgreSQL 日常备份根目录不存在"
  }
  $directory = Resolve-MaintenanceDirectChildDirectory (
    $RequestedDirectory
  ) $backupRoot "^daily-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}$" "PostgreSQL 备份目录"
  $archive = Read-MaintenanceArchive $directory $ApprovedSha256 $RequireCurrentDeployment
  if ([IO.Path]::GetFileName($directory) -cne [string]$archive.Manifest.backupId) {
    throw "PostgreSQL 备份目录与 manifest 身份不一致"
  }
  return $archive
}

function Remove-MaintenanceIncompleteDirectory(
  [string]$Directory,
  [string]$BackupRoot,
  [string]$ExpectedName
) {
  if (-not (Test-Path -LiteralPath $Directory)) { return }
  $resolved = Get-MaintenanceCanonicalPath $Directory
  if ((Get-MaintenanceCanonicalPath (Split-Path -Parent $resolved)) -ine
      (Get-MaintenanceCanonicalPath $BackupRoot) -or
      [IO.Path]::GetFileName($resolved) -cne $ExpectedName -or
      $ExpectedName -cnotmatch "^\.daily-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}\.[0-9a-f]{32}\.incomplete$") {
    throw "拒绝清理身份不明确的未发布备份目录"
  }
  Assert-MaintenanceNoReparsePoints $resolved "未发布 PostgreSQL 备份目录"
  Remove-Item -LiteralPath $resolved -Recurse -Force
}

function Invoke-MaintenanceBackup {
  if (-not $MaintenanceRequest.Execute) {
    throw "创建日常 PostgreSQL 备份必须显式提供 -Execute"
  }
  $evidenceTool = Assert-MaintenanceRuntimeContext
  if (@(Get-PortListeners 5432).Count -ne 1) {
    throw "权威 PostgreSQL 当前未运行；日常备份不会自动启停服务"
  }
  Assert-PostgresListenerOwnership | Out-Null
  if (-not (Test-PostgresReady)) {
    throw "权威 PostgreSQL 未就绪；日常备份不会自动启停服务"
  }

  $backupRoot = Get-MaintenanceBackupRoot $true
  $timestamp = [DateTimeOffset]::UtcNow
  $backupId = "daily-{0}-{1}" -f (
    $timestamp.ToString("yyyyMMdd'T'HHmmss'Z'")
  ), ([Guid]::NewGuid().ToString("N").Substring(0, 12))
  $finalDirectory = Assert-RuntimeChildPath (Join-Path $backupRoot $backupId)
  if (Test-Path -LiteralPath $finalDirectory) { throw "目标日常备份目录已存在" }
  $nonce = [Guid]::NewGuid().ToString("N")
  $workingName = ".$backupId.$nonce.incomplete"
  $workingDirectory = Assert-RuntimeChildPath (Join-Path $backupRoot $workingName)
  $published = $false
  $secrets = $null
  try {
    New-Item -ItemType Directory -Path $workingDirectory | Out-Null
    $dumpPath = Join-Path $workingDirectory "teruisi-sales.dump"
    $pgDump = Join-Path $PostgresBin "pg_dump.exe"
    $pgRestore = Join-Path $PostgresBin "pg_restore.exe"
    foreach ($tool in @($Python, $pgDump, $pgRestore, $evidenceTool)) {
      if (-not (Test-Path -LiteralPath $tool -PathType Leaf)) {
        throw "PostgreSQL 日常备份缺少受控运行工具"
      }
    }

    $secrets = Read-Secrets
    $payload = Invoke-MaintenancePgEnvironment @{
      PGHOST = "127.0.0.1"
      PGPORT = "5432"
      PGUSER = "teruisi_sales_owner"
      PGDATABASE = "teruisi_sales"
      PGPASSWORD = $secrets.OwnerPassword
      PGAPPNAME = "teruisi_daily_backup"
      PGOPTIONS = "-c statement_timeout=1800000 -c idle_in_transaction_session_timeout=1860000"
      PGCLIENTENCODING = "UTF8"
    } {
      $run = Invoke-BoundedNativeProcess $Python @(
        $evidenceTool, "backup",
        "--pg-dump", $pgDump,
        "--output", $dumpPath,
        "--expected-database", "teruisi_sales",
        "--expected-user", "teruisi_sales_owner",
        "--port", "5432",
        "--timeout-seconds", "1800"
      ) $InstalledAppRoot
      return ConvertFrom-UniqueNativeJson $run "创建 PostgreSQL 一致性备份"
    }
    Assert-MaintenanceBackupPayload $payload

    $archiveRun = Invoke-BoundedNativeProcess $pgRestore @("--list", $dumpPath) $workingDirectory
    $archiveEntries = @($archiveRun.Output)
    if ($archiveRun.ExitCode -ne 0 -or $archiveEntries.Count -lt 10) {
      throw "PostgreSQL dump 归档目录验证失败（$(Get-NativeFailureSummary $archiveRun)）"
    }
    $manifest = [pscustomobject][ordered]@{
      version = $MaintenanceBackupVersion
      status = "completed"
      backupId = $backupId
      createdAt = $timestamp.ToString("o")
      completedAt = [DateTimeOffset]::UtcNow.ToString("o")
      database = [pscustomobject][ordered]@{
        name = "teruisi_sales"
        host = "127.0.0.1"
        port = 5432
        sourceRole = "teruisi_sales_owner"
        consistency = "exported-snapshot"
      }
      dump = [pscustomobject][ordered]@{
        fileName = "teruisi-sales.dump"
        sizeBytes = [int64](Get-Item -LiteralPath $dumpPath).Length
        sha256 = Get-FileSha256 $dumpPath
        archiveEntryCount = [int]$archiveEntries.Count
        snapshotIdSha256 = [string]$payload.snapshotIdSha256
      }
      evidence = $payload.evidence
      software = [pscustomobject][ordered]@{
        deploymentManifestSha256 = Get-FileSha256 $DeploymentManifestPath
        serviceConfigSha256 = Get-FileSha256 $ConfigPath
        serviceScriptSha256 = Get-FileSha256 $InstalledScriptPath
        operatorScriptSha256 = Get-FileSha256 $PSCommandPath
        evidenceToolSha256 = Get-FileSha256 $evidenceTool
        pgDumpSha256 = Get-FileSha256 $pgDump
        pgRestoreSha256 = Get-FileSha256 $pgRestore
      }
    }
    $manifestPath = Join-Path $workingDirectory "backup-manifest.json"
    Write-AtomicJson $manifestPath $manifest
    Write-MaintenanceAtomicText (
      Join-Path $workingDirectory "backup-manifest.json.sha256"
    ) ((Get-FileSha256 $manifestPath) + [Environment]::NewLine)
    Read-MaintenanceArchive $workingDirectory | Out-Null

    Move-Item -LiteralPath $workingDirectory -Destination $finalDirectory
    $published = $true
    $verified = Resolve-MaintenanceBackupArchive $finalDirectory (
      Get-FileSha256 (Join-Path $finalDirectory "backup-manifest.json")
    ) -RequireCurrentDeployment
    return [pscustomobject][ordered]@{
      status = "completed"
      backupId = $backupId
      backupDirectory = $finalDirectory
      manifestSha256 = $verified.ManifestSha256
      dumpSha256 = [string]$verified.Manifest.dump.sha256
      contentSha256 = [string]$verified.Manifest.evidence.contentSha256
      completedAt = [string]$verified.Manifest.completedAt
      serviceStateChanged = $false
    }
  } finally {
    $secrets = $null
    if (-not $published) {
      Remove-MaintenanceIncompleteDirectory $workingDirectory $backupRoot $workingName
    }
  }
}

function Assert-MaintenanceRehearsalListenerOwnership(
  [int]$Port,
  [string]$DataDirectory
) {
  $listeners = @(Get-PortListeners $Port)
  if ($listeners.Count -ne 1 -or
      [string]$listeners[0].LocalAddress -ne "127.0.0.1") {
    throw "隔离恢复 PostgreSQL 未严格绑定批准的回环端口"
  }
  $snapshot = Get-ProcessSnapshot ([int]$listeners[0].OwningProcess) 3
  $expectedExecutable = Get-MaintenanceCanonicalPath (Join-Path $PostgresBin "postgres.exe")
  if ($null -eq $snapshot -or $snapshot.ExecutablePath -ine $expectedExecutable) {
    throw "隔离恢复端口不是受控 PostgreSQL 17 进程"
  }
  $matches = [regex]::Matches(
    $snapshot.CommandLine,
    '(?:^|\s)(?:"-D"|-D)\s+(?:"([^"]+)"|(\S+))'
  )
  if ($matches.Count -ne 1) { throw "隔离恢复 PostgreSQL 缺少唯一数据目录" }
  $raw = if ($matches[0].Groups[1].Success) {
    $matches[0].Groups[1].Value
  } else {
    $matches[0].Groups[2].Value
  }
  if ((Get-MaintenanceCanonicalPath ($raw.Replace("/", "\"))) -ine
      (Get-MaintenanceCanonicalPath $DataDirectory)) {
    throw "隔离恢复 PostgreSQL 使用了非批准数据目录"
  }
  return $snapshot
}

function Remove-MaintenanceRehearsalData(
  [string]$DataDirectory,
  [string]$RehearsalRoot,
  [string]$ExpectedRehearsalId,
  [int]$Port
) {
  if (-not (Test-Path -LiteralPath $DataDirectory)) { return }
  $root = Get-MaintenanceCanonicalPath $RehearsalRoot
  $data = Get-MaintenanceCanonicalPath $DataDirectory
  $expectedParent = Assert-RuntimeChildPath (
    Join-Path $MaintenanceRequest.RuntimeRoot "rehearsals\postgres-restore"
  )
  if ([IO.Path]::GetFileName($root) -cne "restore-$ExpectedRehearsalId" -or
      (Get-MaintenanceCanonicalPath (Split-Path -Parent $root)) -ine
        (Get-MaintenanceCanonicalPath $expectedParent) -or
      (Get-MaintenanceCanonicalPath (Split-Path -Parent $data)) -ine $root -or
      [IO.Path]::GetFileName($data) -cne "data" -or
      $ExpectedRehearsalId -cnotmatch "^[0-9a-f]{12}$" -or
      @(Get-PortListeners $Port).Count -ne 0) {
    throw "拒绝清理身份不明确或仍在运行的隔离恢复数据目录"
  }
  Assert-MaintenanceNoReparsePoints $data "隔离恢复数据目录"
  Remove-Item -LiteralPath $data -Recurse -Force
}

function Invoke-MaintenanceRestoreRehearsal {
  if (-not $MaintenanceRequest.Execute -or
      -not $MaintenanceRequest.ConfirmedIsolatedRestore -or
      $MaintenanceRequest.RehearsalId -cnotmatch "^[0-9a-f]{12}$" -or
      $MaintenanceRequest.ApprovedManifestSha256 -cnotmatch "^[0-9a-f]{64}$" -or
      [string]::IsNullOrWhiteSpace($MaintenanceRequest.BackupDirectory)) {
    throw "隔离恢复演练必须提供 -Execute、-ConfirmedIsolatedRestore、12 位 RehearsalId、备份目录与批准 manifest SHA-256"
  }
  $evidenceTool = Assert-MaintenanceRuntimeContext
  $backup = Resolve-MaintenanceBackupArchive (
    $MaintenanceRequest.BackupDirectory
  ) $MaintenanceRequest.ApprovedManifestSha256
  if (@(Get-PortListeners $MaintenanceRequest.RehearsalPort).Count -ne 0) {
    throw "隔离恢复端口已被占用；拒绝接管或终止现有进程"
  }

  $rehearsalParent = Assert-RuntimeChildPath (
    Join-Path $MaintenanceRequest.RuntimeRoot "rehearsals\postgres-restore"
  )
  New-Item -ItemType Directory -Path $rehearsalParent -Force | Out-Null
  $rehearsalRoot = Assert-RuntimeChildPath (
    Join-Path $rehearsalParent "restore-$($MaintenanceRequest.RehearsalId)"
  )
  if (Test-Path -LiteralPath $rehearsalRoot) {
    throw "相同 RehearsalId 的隔离恢复记录已存在；拒绝覆盖或复用"
  }
  New-Item -ItemType Directory -Path $rehearsalRoot | Out-Null
  $dataDirectory = Join-Path $rehearsalRoot "data"
  $logPath = Join-Path $rehearsalRoot "postgres.log"
  $passwordPath = Join-Path $rehearsalRoot ".postgres-password.tmp"
  $resultPath = Join-Path $rehearsalRoot "rehearsal-result.json"
  $startedAt = [DateTimeOffset]::UtcNow
  $isolatedStarted = $false
  $cleanupStatus = "not_required"
  $result = $null
  $failure = $null

  $initDb = Join-Path $PostgresBin "initdb.exe"
  $pgCtl = Join-Path $PostgresBin "pg_ctl.exe"
  $createdb = Join-Path $PostgresBin "createdb.exe"
  $pgRestore = Join-Path $PostgresBin "pg_restore.exe"
  $pgIsReady = Join-Path $PostgresBin "pg_isready.exe"
  foreach ($tool in @($initDb, $pgCtl, $createdb, $pgRestore, $pgIsReady, $Python, $evidenceTool)) {
    if (-not (Test-Path -LiteralPath $tool -PathType Leaf)) {
      throw "隔离恢复演练缺少受控 PostgreSQL/Python 工具"
    }
  }

  $password = New-RandomSecret
  try {
    Write-MaintenanceAtomicText $passwordPath ($password + [Environment]::NewLine)
    $initRun = Invoke-BoundedNativeProcess $initDb @(
      "--pgdata=$dataDirectory", "--username=postgres", "--pwfile=$passwordPath",
      "--auth-host=scram-sha-256", "--auth-local=scram-sha-256",
      "--encoding=UTF8", "--locale=C"
    ) $rehearsalRoot
    if ($initRun.ExitCode -ne 0) {
      throw "隔离 PostgreSQL initdb 失败（$(Get-NativeFailureSummary $initRun)）"
    }
    Remove-Item -LiteralPath $passwordPath -Force

    $serverOptions = "-p $($MaintenanceRequest.RehearsalPort) -h 127.0.0.1 -c max_connections=10 -c shared_buffers=128MB -c log_min_messages=warning"
    $startRun = Invoke-BoundedNativeProcess $pgCtl @(
      "start", "-D", $dataDirectory, "-l", $logPath,
      "-w", "-t", "30", "-o", $serverOptions
    ) $rehearsalRoot
    if ($startRun.ExitCode -ne 0) {
      throw "隔离 PostgreSQL 启动失败（$(Get-NativeFailureSummary $startRun)）"
    }
    $isolatedStarted = $true
    Assert-MaintenanceRehearsalListenerOwnership (
      $MaintenanceRequest.RehearsalPort
    ) $dataDirectory | Out-Null
    $readyRun = Invoke-BoundedNativeProcess $pgIsReady @(
      "-q", "-h", "127.0.0.1", "-p", [string]$MaintenanceRequest.RehearsalPort,
      "-U", "postgres", "-d", "postgres"
    ) $rehearsalRoot
    if ($readyRun.ExitCode -ne 0) { throw "隔离 PostgreSQL 未就绪" }

    $probe = Invoke-MaintenancePgEnvironment @{
      PGHOST = "127.0.0.1"
      PGPORT = [string]$MaintenanceRequest.RehearsalPort
      PGUSER = "postgres"
      PGDATABASE = "postgres"
      PGPASSWORD = $password
      PGAPPNAME = "teruisi_restore_rehearsal"
      PGOPTIONS = "-c statement_timeout=1800000 -c idle_in_transaction_session_timeout=1860000"
      PGCLIENTENCODING = "UTF8"
    } {
      $createRun = Invoke-BoundedNativeProcess $createdb @(
        "--host=127.0.0.1", "--port=$($MaintenanceRequest.RehearsalPort)",
        "--username=postgres", "--owner=postgres", "teruisi_sales"
      ) $rehearsalRoot
      if ($createRun.ExitCode -ne 0) {
        throw "隔离恢复数据库创建失败（$(Get-NativeFailureSummary $createRun)）"
      }
      $restoreRun = Invoke-BoundedNativeProcess $Python @(
        $evidenceTool, "restore",
        "--pg-restore", $pgRestore,
        "--archive", $backup.DumpPath,
        "--expected-database", "teruisi_sales",
        "--expected-user", "postgres",
        "--port", [string]$MaintenanceRequest.RehearsalPort,
        "--timeout-seconds", "1800"
      ) $InstalledAppRoot
      $restorePayload = ConvertFrom-UniqueNativeJson $restoreRun "隔离 PostgreSQL restore"
      Assert-MaintenanceExactPropertySet $restorePayload @(
        "version", "status", "nativeDiagnostic"
      ) "隔离 PostgreSQL restore 结果"
      if ([string]$restorePayload.version -cne "teruisi-postgres-consistent-backup-v1" -or
          [string]$restorePayload.status -cne "completed" -or
          [int]$restorePayload.nativeDiagnostic.exitCode -ne 0) {
        throw "隔离 PostgreSQL restore 结果无效"
      }
      [Environment]::SetEnvironmentVariable("PGDATABASE", "teruisi_sales", "Process")
      $probeRun = Invoke-BoundedNativeProcess $Python @(
        $evidenceTool, "probe",
        "--expected-database", "teruisi_sales",
        "--expected-user", "postgres"
      ) $InstalledAppRoot
      return ConvertFrom-UniqueNativeJson $probeRun "读取隔离恢复证据"
    }
    Assert-MaintenanceExactPropertySet $probe @("version", "status", "evidence") "隔离恢复探针结果"
    if ([string]$probe.version -cne "teruisi-postgres-consistent-backup-v1" -or
        [string]$probe.status -cne "completed") {
      throw "隔离恢复探针结果无效"
    }
    Assert-MaintenanceEvidence $probe.evidence "teruisi_sales" "postgres" (
      $MaintenanceRequest.RehearsalPort
    )
    if ([string]$probe.evidence.contentSha256 -cne
        [string]$backup.Manifest.evidence.contentSha256) {
      throw "隔离恢复内容证据与备份快照不一致"
    }

    $stopRun = Invoke-BoundedNativeProcess $pgCtl @(
      "stop", "-D", $dataDirectory, "-m", "fast", "-w", "-t", "30"
    ) $rehearsalRoot
    if ($stopRun.ExitCode -ne 0) {
      throw "隔离 PostgreSQL 停止失败（$(Get-NativeFailureSummary $stopRun)）"
    }
    $isolatedStarted = $false
    if (@(Get-PortListeners $MaintenanceRequest.RehearsalPort).Count -ne 0) {
      throw "隔离 PostgreSQL 停止后端口仍被占用"
    }
    Remove-MaintenanceRehearsalData $dataDirectory $rehearsalRoot (
      $MaintenanceRequest.RehearsalId
    ) $MaintenanceRequest.RehearsalPort
    $cleanupStatus = "isolated_data_removed"
    $result = [pscustomobject][ordered]@{
      version = $MaintenanceRestoreVersion
      status = "completed"
      rehearsalId = $MaintenanceRequest.RehearsalId
      startedAt = $startedAt.ToString("o")
      completedAt = [DateTimeOffset]::UtcNow.ToString("o")
      backupId = [string]$backup.Manifest.backupId
      backupManifestSha256 = [string]$backup.ManifestSha256
      dumpSha256 = [string]$backup.Manifest.dump.sha256
      expectedContentSha256 = [string]$backup.Manifest.evidence.contentSha256
      restoredContentSha256 = [string]$probe.evidence.contentSha256
      isolatedPort = [int]$MaintenanceRequest.RehearsalPort
      productionDatabaseTouched = $false
      serviceStateChanged = $false
      cleanupStatus = $cleanupStatus
    }
  } catch {
    $failure = $_.Exception
    if ($isolatedStarted) {
      try {
        Assert-MaintenanceRehearsalListenerOwnership (
          $MaintenanceRequest.RehearsalPort
        ) $dataDirectory | Out-Null
        $stopRun = Invoke-BoundedNativeProcess $pgCtl @(
          "stop", "-D", $dataDirectory, "-m", "fast", "-w", "-t", "30"
        ) $rehearsalRoot
        if ($stopRun.ExitCode -ne 0) { throw "受控 stop 未成功" }
        $isolatedStarted = $false
      } catch {
        $cleanupStatus = "isolated_process_requires_manual_review"
      }
    }
    if (-not $isolatedStarted -and (Test-Path -LiteralPath $dataDirectory)) {
      try {
        Remove-MaintenanceRehearsalData $dataDirectory $rehearsalRoot (
          $MaintenanceRequest.RehearsalId
        ) $MaintenanceRequest.RehearsalPort
        $cleanupStatus = "isolated_data_removed_after_failure"
      } catch {
        $cleanupStatus = "isolated_data_requires_manual_review"
      }
    }
    $result = [pscustomobject][ordered]@{
      version = $MaintenanceRestoreVersion
      status = "failed"
      rehearsalId = $MaintenanceRequest.RehearsalId
      startedAt = $startedAt.ToString("o")
      completedAt = [DateTimeOffset]::UtcNow.ToString("o")
      backupId = [string]$backup.Manifest.backupId
      backupManifestSha256 = [string]$backup.ManifestSha256
      failureSha256 = Get-Sha256Text (Protect-LogText $failure.Message)
      isolatedPort = [int]$MaintenanceRequest.RehearsalPort
      productionDatabaseTouched = $false
      serviceStateChanged = $false
      cleanupStatus = $cleanupStatus
    }
  } finally {
    $password = $null
    if (Test-Path -LiteralPath $passwordPath) {
      Remove-Item -LiteralPath $passwordPath -Force
    }
    if ($null -ne $result) {
      Write-AtomicJson $resultPath $result
      Write-MaintenanceAtomicText "$resultPath.sha256" (
        (Get-FileSha256 $resultPath) + [Environment]::NewLine
      )
    }
  }
  if ($null -ne $failure) {
    throw "隔离恢复演练失败；已保留脱敏结果：$resultPath"
  }
  return $result
}

function Get-MaintenancePrunePlan {
  $backupRoot = Get-MaintenanceBackupRoot $false
  $verified = @()
  $skipped = @()
  if (-not (Test-Path -LiteralPath $backupRoot -PathType Container)) {
    return [pscustomobject][ordered]@{
      version = $MaintenancePruneVersion
      generatedAt = [DateTimeOffset]::UtcNow.ToString("o")
      retentionDays = [int]$MaintenanceRequest.RetentionDays
      minimumSuccessfulBackups = [int]$MaintenanceRequest.MinimumSuccessfulBackups
      verifiedBackupCount = 0
      candidates = @()
      skippedInvalid = @()
    }
  }
  foreach ($directory in @(
    Get-ChildItem -LiteralPath $backupRoot -Directory -Force |
      Where-Object { $_.Name -cmatch "^daily-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}$" }
  )) {
    try {
      $archive = Resolve-MaintenanceBackupArchive $directory.FullName
      $verified += [pscustomobject]@{
        archive = $archive
        completedAt = [DateTimeOffset]::Parse([string]$archive.Manifest.completedAt)
      }
    } catch {
      $skipped += [pscustomobject][ordered]@{
        backupId = $directory.Name
        reasonSha256 = Get-Sha256Text (Protect-LogText $_.Exception.Message)
      }
    }
  }
  $ordered = @($verified | Sort-Object completedAt -Descending)
  $cutoff = [DateTimeOffset]::UtcNow.AddDays(-1 * $MaintenanceRequest.RetentionDays)
  $candidates = @()
  for ($index = 0; $index -lt $ordered.Count; $index++) {
    if ($index -lt $MaintenanceRequest.MinimumSuccessfulBackups) { continue }
    if ($ordered[$index].completedAt -ge $cutoff) { continue }
    $candidates += [pscustomobject][ordered]@{
      backupId = [string]$ordered[$index].archive.Manifest.backupId
      directory = [string]$ordered[$index].archive.Directory
      manifestSha256 = [string]$ordered[$index].archive.ManifestSha256
      completedAt = $ordered[$index].completedAt.ToString("o")
    }
  }
  return [pscustomobject][ordered]@{
    version = $MaintenancePruneVersion
    generatedAt = [DateTimeOffset]::UtcNow.ToString("o")
    retentionDays = [int]$MaintenanceRequest.RetentionDays
    minimumSuccessfulBackups = [int]$MaintenanceRequest.MinimumSuccessfulBackups
    verifiedBackupCount = [int]$ordered.Count
    candidates = @($candidates)
    skippedInvalid = @($skipped)
  }
}

function Invoke-MaintenancePrune {
  Assert-MaintenanceRuntimeContext | Out-Null
  $plan = Get-MaintenancePrunePlan
  if (-not $MaintenanceRequest.Execute) {
    return [pscustomobject][ordered]@{
      status = "planned"
      plan = $plan
      serviceStateChanged = $false
    }
  }
  if (-not $MaintenanceRequest.ConfirmedPrune) {
    throw "删除过期 PostgreSQL 备份必须显式提供 -ConfirmedPrune"
  }
  $auditRoot = Assert-RuntimeChildPath (
    Join-Path $MaintenanceRequest.RuntimeRoot "audits\postgres-backup-prune"
  )
  New-Item -ItemType Directory -Path $auditRoot -Force | Out-Null
  $auditId = "prune-{0}-{1}" -f (
    [DateTimeOffset]::UtcNow.ToString("yyyyMMdd'T'HHmmss'Z'")
  ), ([Guid]::NewGuid().ToString("N").Substring(0, 12))
  $auditDirectory = Join-Path $auditRoot $auditId
  New-Item -ItemType Directory -Path $auditDirectory | Out-Null
  Write-AtomicJson (Join-Path $auditDirectory "plan.json") $plan

  $backupRoot = Get-MaintenanceBackupRoot $false
  $removed = @()
  foreach ($candidate in @($plan.candidates)) {
    $archive = Resolve-MaintenanceBackupArchive (
      [string]$candidate.directory
    ) ([string]$candidate.manifestSha256)
    if ([string]$archive.Manifest.backupId -cne [string]$candidate.backupId) {
      throw "待清理备份身份在执行前发生变化"
    }
    $quarantineName = ".prune-$([Guid]::NewGuid().ToString('N')).quarantine"
    $quarantine = Assert-RuntimeChildPath (Join-Path $backupRoot $quarantineName)
    Move-Item -LiteralPath $archive.Directory -Destination $quarantine
    if ((Get-MaintenanceCanonicalPath (Split-Path -Parent $quarantine)) -ine
        (Get-MaintenanceCanonicalPath $backupRoot) -or
        [IO.Path]::GetFileName($quarantine) -cnotmatch "^\.prune-[0-9a-f]{32}\.quarantine$") {
      throw "备份隔离清理目录身份无效"
    }
    Assert-MaintenanceNoReparsePoints $quarantine "待清理 PostgreSQL 备份"
    Remove-Item -LiteralPath $quarantine -Recurse -Force
    $removed += [pscustomobject][ordered]@{
      backupId = [string]$candidate.backupId
      manifestSha256 = [string]$candidate.manifestSha256
    }
  }
  $result = [pscustomobject][ordered]@{
    version = $MaintenancePruneVersion
    status = "completed"
    auditId = $auditId
    completedAt = [DateTimeOffset]::UtcNow.ToString("o")
    removed = @($removed)
    skippedInvalid = @($plan.skippedInvalid)
    serviceStateChanged = $false
  }
  $resultPath = Join-Path $auditDirectory "result.json"
  Write-AtomicJson $resultPath $result
  Write-MaintenanceAtomicText "$resultPath.sha256" (
    (Get-FileSha256 $resultPath) + [Environment]::NewLine
  )
  return $result
}

function Show-MaintenanceStatus {
  Assert-MaintenanceRuntimeContext | Out-Null
  $backupRoot = Get-MaintenanceBackupRoot $false
  $directories = @()
  if (Test-Path -LiteralPath $backupRoot -PathType Container) {
    $directories = @(
      Get-ChildItem -LiteralPath $backupRoot -Directory -Force |
        Where-Object { $_.Name -cmatch "^daily-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}$" } |
        Sort-Object Name -Descending
    )
  }
  $latest = $null
  if ($directories.Count -gt 0) {
    try {
      $archive = Resolve-MaintenanceBackupArchive $directories[0].FullName
      $latest = [pscustomobject][ordered]@{
        backupId = [string]$archive.Manifest.backupId
        completedAt = [string]$archive.Manifest.completedAt
        manifestSha256 = [string]$archive.ManifestSha256
        contentSha256 = [string]$archive.Manifest.evidence.contentSha256
      }
    } catch {
      $latest = [pscustomobject][ordered]@{
        backupId = $directories[0].Name
        status = "invalid"
        reasonSha256 = Get-Sha256Text (Protect-LogText $_.Exception.Message)
      }
    }
  }
  return [pscustomobject][ordered]@{
    status = "completed"
    backupCount = [int]$directories.Count
    latestBackup = $latest
    serviceStateChanged = $false
  }
}

if ($env:TERUISI_DJANGO_MAINTENANCE_LIBRARY_ONLY -ne "1") {
  if (-not (Test-MaintenanceFullyQualifiedPath $MaintenanceRequest.RuntimeRoot)) {
    throw "RuntimeRoot 必须是绝对路径"
  }
  $canonicalRuntime = Get-MaintenanceCanonicalPath $MaintenanceRequest.RuntimeRoot
  if ($canonicalRuntime -ine $MaintenanceFixedRuntimeRoot) {
    throw "PostgreSQL 维护只允许固定受保护 Django runtime"
  }
  $serviceScript = Join-Path $canonicalRuntime "app\tools\django-local-service.ps1"
  $expectedSelf = Join-Path $canonicalRuntime "app\tools\django-postgres-maintenance.ps1"
  if (-not (Test-Path -LiteralPath $serviceScript -PathType Leaf) -or
      (Get-MaintenanceCanonicalPath $PSCommandPath) -ine
        (Get-MaintenanceCanonicalPath $expectedSelf)) {
    throw "PostgreSQL 维护只能从受保护的 runtime app operator 执行"
  }
  $previousLibraryOnly = [Environment]::GetEnvironmentVariable(
    "TERUISI_DJANGO_SERVICE_LIBRARY_ONLY", "Process"
  )
  $env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY = "1"
  try {
    . $serviceScript -Action Status -RuntimeRoot $canonicalRuntime
  } finally {
    [Environment]::SetEnvironmentVariable(
      "TERUISI_DJANGO_SERVICE_LIBRARY_ONLY", $previousLibraryOnly, "Process"
    )
  }

  $output = Invoke-MaintenanceMutex {
    switch ($MaintenanceRequest.Action) {
      "Backup" { Invoke-MaintenanceBackup }
      "Verify" {
        if ([string]::IsNullOrWhiteSpace($MaintenanceRequest.BackupDirectory)) {
          throw "Verify 必须提供 BackupDirectory"
        }
        $archive = Resolve-MaintenanceBackupArchive (
          $MaintenanceRequest.BackupDirectory
        ) $MaintenanceRequest.ApprovedManifestSha256
        [pscustomobject][ordered]@{
          status = "completed"
          backupId = [string]$archive.Manifest.backupId
          manifestSha256 = [string]$archive.ManifestSha256
          dumpSha256 = [string]$archive.Manifest.dump.sha256
          contentSha256 = [string]$archive.Manifest.evidence.contentSha256
          serviceStateChanged = $false
        }
      }
      "RestoreRehearsal" { Invoke-MaintenanceRestoreRehearsal }
      "Prune" { Invoke-MaintenancePrune }
      "Status" { Show-MaintenanceStatus }
    }
  }
  Write-Output ($output | ConvertTo-Json -Depth 12 -Compress)
}
