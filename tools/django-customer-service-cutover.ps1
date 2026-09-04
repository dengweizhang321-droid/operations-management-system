[CmdletBinding()]
param(
  [ValidateSet(
    "Snapshot", "MigrateDryRun", "MigrateApply", "MigrateVerify",
    "InstallD1Authority", "AuthorityStatus", "AuthorityPrepare",
    "AuthorityAbort", "AuthorityActivate"
  )]
  [string]$Action = "AuthorityStatus",
  [string]$RuntimeRoot = "D:\teruisi-runtime\django-sales",
  [string]$CustomerServiceD1 = "",
  [string]$CustomerServiceSource = "",
  [string]$ApprovedRunId = "",
  [string]$CustomerServiceCutoverId = ""
)

$ErrorActionPreference = "Stop"
$CutoverAction = $Action
$ServiceScript = Join-Path $PSScriptRoot "django-local-service.ps1"
$previousLibraryMode = [Environment]::GetEnvironmentVariable("TERUISI_DJANGO_SERVICE_LIBRARY_ONLY", "Process")
try {
  $env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY = "1"
  . $ServiceScript -Action Status -RuntimeRoot $RuntimeRoot
} finally { [Environment]::SetEnvironmentVariable("TERUISI_DJANGO_SERVICE_LIBRARY_ONLY", $previousLibraryMode, "Process") }
$Action = $CutoverAction
$CustomerServiceAuditRoot = Join-Path $RuntimeRoot "audits\customer-service-cutover"

function Assert-InstalledCustomerServiceOperator {
  if ((Get-CanonicalPath $ExecutionRoot) -ine (Get-CanonicalPath $InstalledAppRoot)) { throw "客服 cutover 必须从 DeployApp 后的受保护 runtime app 执行" }
  Assert-DeployedApplication
  Assert-RuntimeAclHardened
  Get-ServiceConfig | Out-Null
  Assert-PostgresListenerOwnership | Out-Null
  if (-not (Test-PostgresReady)) { throw "PostgreSQL 未就绪，拒绝执行客服 cutover" }
}

function Resolve-LiveCustomerServiceD1 {
  if ([string]::IsNullOrWhiteSpace($CustomerServiceD1) -or -not (Test-FullyQualifiedPath $CustomerServiceD1)) { throw "客服 cutover 必须提供精确的客服 D1 绝对路径" }
  $canonical = Get-CanonicalPath $CustomerServiceD1
  if (-not (Test-Path -LiteralPath $canonical -PathType Leaf) -or [IO.Path]::GetExtension($canonical) -notin @(".sqlite", ".sqlite3")) { throw "客服 D1 必须是普通 .sqlite 或 .sqlite3 文件" }
  return $canonical
}

function Resolve-CustomerServiceSnapshot([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value) -or -not (Test-FullyQualifiedPath $Value)) { throw "客服迁移需要绝对路径的受控源快照" }
  $canonical = Get-CanonicalPath $Value
  [void](Assert-RuntimeChildPath $canonical)
  $auditRoot = Get-CanonicalPath $CustomerServiceAuditRoot
  if (-not $canonical.StartsWith($auditRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "客服源快照必须位于 customer-service-cutover 审计目录" }
  if (-not (Test-Path -LiteralPath $canonical -PathType Leaf) -or [IO.Path]::GetExtension($canonical) -ine ".sqlite") { throw "客服源快照不存在或不是 .sqlite 文件" }
  return $canonical
}

function Invoke-CustomerServiceManagementCommand([string[]]$Arguments, [string]$Operation) {
  $secrets = Read-Secrets
  $ownerUrl = Database-Url "teruisi_sales_owner" $secrets.OwnerPassword "teruisi_customer_service_cutover" $WriterStatementTimeoutMs
  $commandArguments = @((Join-Path $BackendRoot "manage.py")) + $Arguments
  try {
    return Invoke-WithDjangoEnvironment $secrets $ownerUrl "migration_writer" $false $WriterMaxBodyBytes "" "" {
      $nativeRun = Invoke-BoundedNativeProcess $Python $commandArguments $BackendRoot
      Write-NativeDiagnosticLog (Join-Path $LogDirectory "customer-service-cutover.$RunId.log") $Operation $nativeRun
      return ConvertFrom-UniqueNativeJson $nativeRun $Operation
    }
  } finally { $ownerUrl = $null; $secrets = $null }
}

function Invoke-CustomerServiceSnapshot {
  Assert-InstalledCustomerServiceOperator
  $source = Resolve-LiveCustomerServiceD1
  $directory = Join-Path $CustomerServiceAuditRoot $RunId
  New-Item -ItemType Directory -Path $directory -Force | Out-Null
  $snapshot = Join-Path $directory "customer-service-source.sqlite"
  $manifest = Join-Path $directory "customer-service-source-manifest.json"
  $tool = Join-Path $InstalledAppRoot "tools\customer-service-d1-snapshot.py"
  $nativeRun = Invoke-BoundedNativeProcess $Python @($tool, "--source", $source, "--output", $snapshot, "--manifest", $manifest) $InstalledAppRoot
  Write-NativeDiagnosticLog (Join-Path $LogDirectory "customer-service-snapshot.$RunId.log") "customer_service_snapshot" $nativeRun
  $payload = ConvertFrom-UniqueNativeJson $nativeRun "创建客服受控 D1 快照"
  Write-Output ([ordered]@{ status = "succeeded"; source = $snapshot; sourceSha256 = Get-FileSha256 $snapshot; manifest = $manifest; manifestSha256 = Get-FileSha256 $manifest; counts = $payload.counts } | ConvertTo-Json -Compress -Depth 8)
}

function Invoke-CustomerServiceMigration([string]$Mode) {
  Assert-InstalledCustomerServiceOperator
  $source = Resolve-CustomerServiceSnapshot $CustomerServiceSource
  $arguments = @("migrate_customer_service_from_d1", "--source", $source)
  if ($Mode -eq "apply") {
    if ($ApprovedRunId -notmatch "^customer-service-plan-[0-9a-f]{32}$") { throw "客服 apply 需要有效 approved plan id" }
    $arguments += @("--apply", "--approved-plan-id", $ApprovedRunId)
  } elseif ($Mode -eq "verify") {
    if ($ApprovedRunId -notmatch "^customer-service-[0-9a-f]{32}$") { throw "客服 verify 需要有效 approved apply run id" }
    $arguments += @("--verify", "--approved-run-id", $ApprovedRunId)
  } elseif (-not [string]::IsNullOrWhiteSpace($ApprovedRunId)) { throw "客服 dry-run 不接受 approved run id" }
  $payload = Invoke-CustomerServiceManagementCommand $arguments "customer_service_migration_$Mode"
  Write-Output ($payload | ConvertTo-Json -Compress -Depth 8)
}

function Assert-CustomerServiceWriterStopped {
  if (Resolve-OwnedProcess "django-customer-service-writer" $DjangoCustomerServiceWriterPidPath $Waitress) { throw "客服 writer 必须在 authority 变更前停止" }
  if (@(Get-PortListeners 8072).Count -gt 0) { throw "端口 8072 在 authority 变更前不得监听" }
}

function Invoke-InstallCustomerServiceD1Authority {
  Assert-InstalledCustomerServiceOperator
  Assert-CustomerServiceWriterStopped
  $source = Resolve-LiveCustomerServiceD1
  $directory = Join-Path $CustomerServiceAuditRoot $RunId
  New-Item -ItemType Directory -Path $directory -Force | Out-Null
  $backup = Join-Path $directory "d1-before-customer-service-authority.sqlite"
  $receipt = Join-Path $directory "authority-install-receipt.json"
  $nativeRun = Invoke-BoundedNativeProcess $Python @(
    (Join-Path $InstalledAppRoot "tools\customer-service-d1-authority-install.py"),
    "--source", $source, "--sql", (Join-Path $InstalledAppRoot "drizzle\0107_customer_service_write_authority.sql"),
    "--backup", $backup, "--receipt", $receipt
  ) $InstalledAppRoot
  Write-NativeDiagnosticLog (Join-Path $LogDirectory "customer-service-authority-install.$RunId.log") "customer_service_authority_install" $nativeRun
  Write-Output ((ConvertFrom-UniqueNativeJson $nativeRun "安装客服 D1 写保护") | ConvertTo-Json -Compress -Depth 8)
}

function Invoke-CustomerServiceAuthority([string]$Mode) {
  Assert-InstalledCustomerServiceOperator
  Assert-CustomerServiceWriterStopped
  $source = Resolve-LiveCustomerServiceD1
  $arguments = @("customer_service_write_authority", "--source", $source)
  if ($Mode -ne "status") {
    if ($ApprovedRunId -notmatch "^customer-service-[0-9a-f]{32}$") { throw "客服 authority 变更需要有效 verify run id" }
    if ($CustomerServiceCutoverId -notmatch "^[A-Za-z0-9._:-]{8,128}$") { throw "客服 authority 变更需要有效 cutover id" }
    $flag = switch ($Mode) { "prepare" { "--prepare" } "abort" { "--abort-pending" } "activate" { "--activate" } default { throw "未知客服 authority 操作" } }
    $arguments += @($flag, "--approved-run-id", $ApprovedRunId, "--cutover-id", $CustomerServiceCutoverId)
  } elseif (-not [string]::IsNullOrWhiteSpace($ApprovedRunId) -or -not [string]::IsNullOrWhiteSpace($CustomerServiceCutoverId)) { throw "客服 authority status 不接受变更参数" }
  $payload = Invoke-CustomerServiceManagementCommand $arguments "customer_service_authority_$Mode"
  Write-Output ($payload | ConvertTo-Json -Compress -Depth 8)
}

Invoke-WithServiceMutex {
  switch ($Action) {
    "Snapshot" { Invoke-CustomerServiceSnapshot }
    "MigrateDryRun" { Invoke-CustomerServiceMigration "dry-run" }
    "MigrateApply" { Invoke-CustomerServiceMigration "apply" }
    "MigrateVerify" { Invoke-CustomerServiceMigration "verify" }
    "InstallD1Authority" { Invoke-InstallCustomerServiceD1Authority }
    "AuthorityStatus" { Invoke-CustomerServiceAuthority "status" }
    "AuthorityPrepare" { Invoke-CustomerServiceAuthority "prepare" }
    "AuthorityAbort" { Invoke-CustomerServiceAuthority "abort" }
    "AuthorityActivate" { Invoke-CustomerServiceAuthority "activate" }
  }
}
