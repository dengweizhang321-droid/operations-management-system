[CmdletBinding()]
param(
  [ValidateSet(
    "Snapshot", "MigratePlan", "MigrateApply", "MigrateVerify",
    "InstallD1Authority", "AuthorityStatus", "AuthorityPrepare",
    "AuthorityAbort", "AuthorityActivate"
  )]
  [string]$Action = "AuthorityStatus",
  [string]$RuntimeRoot = "D:\teruisi-runtime\django-sales",
  [string]$WorkflowSource = "",
  [string]$ApprovedRunId = "",
  [string]$WorkflowCutoverId = ""
)

$ErrorActionPreference = "Stop"
$CutoverAction = $Action
$ServiceScript = Join-Path $PSScriptRoot "django-local-service.ps1"
$previousLibraryMode = [Environment]::GetEnvironmentVariable(
  "TERUISI_DJANGO_SERVICE_LIBRARY_ONLY", "Process"
)
try {
  $env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY = "1"
  . $ServiceScript -Action Status -RuntimeRoot $RuntimeRoot
} finally {
  [Environment]::SetEnvironmentVariable(
    "TERUISI_DJANGO_SERVICE_LIBRARY_ONLY", $previousLibraryMode, "Process"
  )
}
$Action = $CutoverAction
$WorkflowAuditRoot = Join-Path $RuntimeRoot "audits\workflow-cutover"

function Assert-InstalledWorkflowOperator {
  if ((Get-CanonicalPath $ExecutionRoot) -ine (Get-CanonicalPath $InstalledAppRoot)) {
    throw "Workflow cutover must run from the protected runtime app after DeployApp"
  }
  Assert-DeployedApplication
  Assert-RuntimeAclHardened
  Get-ServiceConfig | Out-Null
  Assert-PostgresListenerOwnership | Out-Null
  if (-not (Test-PostgresReady)) { throw "PostgreSQL is not ready for workflow cutover"
  }
}

function Resolve-LiveWorkflowD1 {
  $config = Get-ServiceConfig
  $source = Resolve-ErpSourceD1 ([string]$config.erpSourceD1)
  return $source
}

function Resolve-WorkflowSnapshot([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value) -or -not (Test-FullyQualifiedPath $Value)) {
    throw "Workflow migration requires an absolute controlled snapshot path"
  }
  $canonical = Get-CanonicalPath $Value
  [void](Assert-RuntimeChildPath $canonical)
  $auditRoot = Get-CanonicalPath $WorkflowAuditRoot
  if (-not $canonical.StartsWith(
      $auditRoot + [IO.Path]::DirectorySeparatorChar,
      [StringComparison]::OrdinalIgnoreCase
    )) {
    throw "Workflow snapshot must be inside the protected workflow-cutover audit directory"
  }
  if (-not (Test-Path -LiteralPath $canonical -PathType Leaf) -or
      [IO.Path]::GetExtension($canonical) -ine ".sqlite") {
    throw "Workflow snapshot is missing or is not a .sqlite file"
  }
  return $canonical
}

function Resolve-WorkflowSnapshotManifest([string]$Source) {
  $manifest = Get-CanonicalPath (Join-Path (Split-Path -Parent $Source) "workflow-source-manifest.json")
  [void](Assert-RuntimeChildPath $manifest)
  if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) {
    throw "Workflow migration controlled source manifest is missing"
  }
  $payload = Read-JsonFile $manifest "Workflow migration controlled source manifest"
  if (
    [string]$payload.formatVersion -cne "workflow-launch-d1-snapshot-v1" -or
    [string]$payload.outputSha256 -cne (Get-FileSha256 $Source) -or
    [string]$payload.sourcePathSha256 -cnotmatch "^[0-9a-f]{64}$" -or
    [int]$payload.counts.records -lt 0 -or
    [int]$payload.counts.activities -lt 0 -or
    [bool]$payload.authoritySynthetic -or
    [string]$payload.authority.owner -cnotin @("legacy", "pending", "postgresql")
  ) {
    throw "Workflow migration controlled source manifest does not match the snapshot"
  }
  return $manifest
}

function Invoke-WorkflowManagementCommand([string[]]$Arguments, [string]$Operation) {
  $secrets = Read-Secrets
  $ownerUrl = Database-Url "teruisi_sales_owner" $secrets.OwnerPassword "teruisi_workflow_cutover" $WriterStatementTimeoutMs
  $manage = Join-Path $BackendRoot "manage.py"
  $commandArguments = @($manage) + @($Arguments)
  $operationLabel = [string]$Operation
  $diagnosticLogPath = Join-Path $LogDirectory "workflow-cutover.$RunId.log"
  if ($operationLabel -cnotmatch "^[a-z0-9_-]{1,64}$" -or
      @($commandArguments | Where-Object { [string]::IsNullOrWhiteSpace([string]$_) }).Count -gt 0) {
    throw "Workflow management command contract is invalid"
  }
  try {
    return Invoke-WithDjangoEnvironment $secrets $ownerUrl "migration_writer" (
      $false
    ) $WriterMaxBodyBytes "" "" {
      $nativeRun = Invoke-BoundedNativeProcess (
        $Python
      ) $commandArguments $BackendRoot
      Write-NativeDiagnosticLog $diagnosticLogPath $operationLabel $nativeRun
      return ConvertFrom-UniqueNativeJson $nativeRun $operationLabel
    }
  } finally {
    $ownerUrl = $null
    $secrets = $null
  }
}

function Invoke-WorkflowSnapshot {
  Assert-InstalledWorkflowOperator
  Assert-WorkflowWorkerStopped "创建 D1 新品迁移快照"
  $source = Resolve-LiveWorkflowD1
  $directory = Join-Path $WorkflowAuditRoot $RunId
  New-Item -ItemType Directory -Path $directory -Force | Out-Null
  $snapshot = Join-Path $directory "workflow-source.sqlite"
  $manifest = Join-Path $directory "workflow-source-manifest.json"
  $tool = Join-Path $InstalledAppRoot "tools\workflow-d1-snapshot.py"
  $nativeRun = Invoke-BoundedNativeProcess $Python @(
    $tool,
    "--source", $source,
    "--output", $snapshot,
    "--manifest", $manifest
  ) $InstalledAppRoot
  $logPath = Join-Path $LogDirectory "workflow-snapshot.$RunId.log"
  Write-NativeDiagnosticLog $logPath "workflow_snapshot" $nativeRun
  $payload = ConvertFrom-UniqueNativeJson $nativeRun "create controlled workflow D1 snapshot"
  Write-Output ([ordered]@{
    status = "succeeded"
    source = $snapshot
    sourceSha256 = Get-FileSha256 $snapshot
    manifest = $manifest
    manifestSha256 = Get-FileSha256 $manifest
    counts = $payload.counts
    authority = $payload.authority
  } | ConvertTo-Json -Compress)
}

function Invoke-WorkflowMigration([string]$Mode) {
  Assert-InstalledWorkflowOperator
  $source = Resolve-WorkflowSnapshot $WorkflowSource
  $manifest = Resolve-WorkflowSnapshotManifest $source
  $arguments = @(
    "migrate_workflow_launch_from_d1", "--source", $source
  )
  if ($Mode -eq "apply") {
    if ($ApprovedRunId -cnotmatch "^workflow-[0-9a-f]{32}$") { throw "Workflow apply requires a valid approved run id" }
    $arguments += @("--apply", "--approved-run-id", $ApprovedRunId)
  } elseif ($Mode -eq "verify") {
    if ($ApprovedRunId -cnotmatch "^workflow-[0-9a-f]{32}$") { throw "Workflow verify requires a valid approved run id" }
    $arguments += @("--verify-only", "--approved-run-id", $ApprovedRunId)
  } elseif (-not [string]::IsNullOrWhiteSpace($ApprovedRunId)) {
    throw "Workflow dry-run does not accept an approved run id"
  }
  $payload = Invoke-WorkflowManagementCommand $arguments "workflow_migration_$Mode"
  Write-Output ($payload | ConvertTo-Json -Compress -Depth 8)
}

function Assert-WorkflowWriterStopped {
  if (Resolve-OwnedProcess "django-workflow-writer" $DjangoWorkflowWriterPidPath $Waitress) {
    throw "Workflow writer must be stopped before an authority transition"
  }
  if (@(Get-PortListeners 8062).Count -gt 0) {
    throw "Port 8062 must have no listener before an authority transition"
  }
}

function Assert-WorkflowStackStopped([string]$Operation) {
  Assert-WorkflowWriterStopped
  if (Resolve-OwnedProcess "django-workflow-reader" $DjangoWorkflowReaderPidPath $Waitress) {
    throw "$Operation 前必须停止 Workflow reader"
  }
  if (@(Get-PortListeners 8061).Count -gt 0) {
    throw "$Operation 前端口 8061 必须没有监听者"
  }
}

function Assert-WorkflowWorkerStopped([string]$Operation) {
  if (@(Get-PortListeners 3000).Count -gt 0) {
    throw "$Operation 前必须通过统一控制器停止 Worker"
  }
}

function Invoke-InstallWorkflowD1Authority {
  Assert-InstalledWorkflowOperator
  Assert-WorkflowStackStopped "安装 D1 新品写入权威门禁"
  Assert-WorkflowWorkerStopped "安装 D1 新品写入权威门禁"
  $source = Resolve-LiveWorkflowD1
  $directory = Join-Path $WorkflowAuditRoot $RunId
  New-Item -ItemType Directory -Path $directory -Force | Out-Null
  $backup = Join-Path $directory "d1-before-workflow-authority.sqlite"
  $receipt = Join-Path $directory "authority-install-receipt.json"
  $tool = Join-Path $InstalledAppRoot "tools\workflow-d1-authority-install.py"
  $sql = Join-Path $InstalledAppRoot "drizzle\0103_workflow_launch_write_authority.sql"
  $nativeRun = Invoke-BoundedNativeProcess $Python @(
    $tool,
    "--source", $source,
    "--sql", $sql,
    "--backup", $backup,
    "--receipt", $receipt
  ) $InstalledAppRoot
  $logPath = Join-Path $LogDirectory "workflow-authority-install.$RunId.log"
  Write-NativeDiagnosticLog $logPath "workflow_authority_install" $nativeRun
  $payload = ConvertFrom-UniqueNativeJson $nativeRun "install D1 workflow write guard"
  Write-Output ($payload | ConvertTo-Json -Compress -Depth 6)
}

function Invoke-WorkflowAuthority([string]$Mode) {
  Assert-InstalledWorkflowOperator
  Assert-WorkflowStackStopped "切换新品写入权威"
  if ($Mode -ne "status") { Assert-WorkflowWorkerStopped "切换新品写入权威" }
  $source = Resolve-LiveWorkflowD1
  $arguments = @("workflow_write_authority", "--source", $source)
  if ($Mode -ne "status") {
    if ($ApprovedRunId -cnotmatch "^workflow-[0-9a-f]{32}$") { throw "Workflow authority transition requires a valid approved run id" }
    if ($WorkflowCutoverId -cnotmatch "^[A-Za-z0-9._:-]{8,128}$") { throw "Workflow authority transition requires a valid cutover id" }
    $flag = switch ($Mode) {
      "prepare" { "--prepare" }
      "abort" { "--abort-pending" }
      "activate" { "--activate" }
      default { throw "Unknown workflow authority action" }
    }
    $arguments += @($flag, "--approved-run-id", $ApprovedRunId, "--cutover-id", $WorkflowCutoverId)
  } elseif (
    -not [string]::IsNullOrWhiteSpace($ApprovedRunId) -or
    -not [string]::IsNullOrWhiteSpace($WorkflowCutoverId)
  ) {
    throw "Workflow authority status does not accept transition parameters"
  }
  $payload = Invoke-WorkflowManagementCommand $arguments "workflow_authority_$Mode"
  Write-Output ($payload | ConvertTo-Json -Compress -Depth 8)
}

Invoke-WithServiceMutex {
  switch ($Action) {
    "Snapshot" { Invoke-WorkflowSnapshot }
    "MigratePlan" { Invoke-WorkflowMigration "plan" }
    "MigrateApply" { Invoke-WorkflowMigration "apply" }
    "MigrateVerify" { Invoke-WorkflowMigration "verify" }
    "InstallD1Authority" { Invoke-InstallWorkflowD1Authority }
    "AuthorityStatus" { Invoke-WorkflowAuthority "status" }
    "AuthorityPrepare" { Invoke-WorkflowAuthority "prepare" }
    "AuthorityAbort" { Invoke-WorkflowAuthority "abort" }
    "AuthorityActivate" { Invoke-WorkflowAuthority "activate" }
  }
}
