[CmdletBinding()]
param(
  [ValidateSet(
    "ConfigureCredentials", "ProvisionRoles", "Start", "Stop", "Status",
    "EnableStartup", "DisableStartup"
  )]
  [string]$Action = "Status",
  [string]$RuntimeRoot = "D:\teruisi-runtime\django-sales",
  [string]$OrchestratedLifecycleAclToken = "",
  [string]$AiEncryptionSource = "D:\运营管理系统\.dev.vars",
  [string]$ModelOriginAllowlist = "",
  [switch]$Json
)

$ErrorActionPreference = "Stop"
$RequestedAiEncryptionSource = $AiEncryptionSource
$RequestedModelOriginAllowlist = $ModelOriginAllowlist
$RequestedAction = $Action
$RequestedJson = $Json.IsPresent
$RequestedOrchestratedLifecycleAclToken = $OrchestratedLifecycleAclToken
$BaseScript = Join-Path $PSScriptRoot "django-local-service.ps1"
if (-not (Test-Path -LiteralPath $BaseScript -PathType Leaf)) { throw "缺少 Django 本机服务基础控制器" }
$PreviousLibraryOnly = [Environment]::GetEnvironmentVariable("TERUISI_DJANGO_SERVICE_LIBRARY_ONLY", "Process")
try {
  $env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY = "1"
  . $BaseScript -RuntimeRoot $RuntimeRoot
} finally {
  [Environment]::SetEnvironmentVariable("TERUISI_DJANGO_SERVICE_LIBRARY_ONLY", $PreviousLibraryOnly, "Process")
}
$Action = $RequestedAction
$Json = [switch]$RequestedJson
$OrchestratedLifecycleAclToken = $RequestedOrchestratedLifecycleAclToken

$AiCredentialPath = Join-Path $RuntimeRoot "secrets\ai-credentials.dpapi.json"
$AiReaderPidPath = Join-Path $RunDirectory "django-ai-reader.pid.json"
$AiWriterPidPath = Join-Path $RunDirectory "django-ai-writer.pid.json"
$AiReaderHealthUrl = "http://127.0.0.1:8111/health/ready"
$AiWriterHealthUrl = "http://127.0.0.1:8112/health/ready"
$AiStartupPath = Join-Path $RuntimeRoot "ai-enabled.json"
$AiReaderMaxBodyBytes = 1048576
$AiWriterMaxBodyBytes = 1048576

function Assert-AiRuntimeEntry([string]$LifecycleAclToken = "") {
  if ((Get-CanonicalPath $ExecutionRoot) -ine (Get-CanonicalPath $InstalledAppRoot)) {
    throw "AI 助理服务操作必须从受保护的 runtime app 控制器执行；请先运行 DeployApp"
  }
  if (Test-OrchestratedLifecycleAclContext $LifecycleAclToken) {
    Write-LauncherEvent "INFO" "orchestrated_lifecycle_acl_reused" "domain=ai"
    return
  }
  Assert-DeployedApplication
  Assert-RuntimeAclHardened
}

function Assert-AiPortsFree([string]$Operation) {
  if (@(Get-PortListeners 8111).Count -gt 0 -or @(Get-PortListeners 8112).Count -gt 0) {
    throw "$Operation 前必须先停止 Django AI 助理 reader/writer"
  }
  if (Resolve-OwnedProcess "django-ai-reader" $AiReaderPidPath $Waitress) {
    throw "$Operation 前必须通过 Stop 停止 Django AI 助理 reader"
  }
  if (Resolve-OwnedProcess "django-ai-writer" $AiWriterPidPath $Waitress) {
    throw "$Operation 前必须通过 Stop 停止 Django AI 助理 writer"
  }
}

function Read-AiCredentials {
  $payload = Read-JsonFile $AiCredentialPath "Django AI 助理 DPAPI 凭据库"
  if (-not (Test-ExactObjectPropertyNames $payload @(
        "version", "databaseAiReader", "databaseAiWriter", "modelEncryptionKey", "modelOriginAllowlist", "createdAt"
      )) -or [int]$payload.version -ne 1) {
    throw "Django AI 助理 DPAPI 凭据库结构无效"
  }
  $reader = Unprotect-Value ([string]$payload.databaseAiReader) "databaseAiReader"
  $writer = Unprotect-Value ([string]$payload.databaseAiWriter) "databaseAiWriter"
  Assert-StrongSecret $reader "databaseAiReader"
  Assert-StrongSecret $writer "databaseAiWriter"
  $key = Unprotect-Value ([string]$payload.modelEncryptionKey) "modelEncryptionKey"
  Assert-StrongSecret $key "modelEncryptionKey"
  $origins = [string]$payload.modelOriginAllowlist
  foreach ($origin in $origins.Split(",", [StringSplitOptions]::RemoveEmptyEntries)) {
    $parsed = [Uri]$origin
    if ($parsed.Scheme -cne "https" -or $parsed.UserInfo -or $parsed.Query -or $parsed.Fragment -or $parsed.AbsolutePath -cne "/" -or $origin -cne $parsed.GetLeftPart([UriPartial]::Authority)) { throw "AI 模型精确 origin 配置无效" }
  }
  return [pscustomobject]@{ ReaderPassword = $reader; WriterPassword = $writer; ModelEncryptionKey = $key; ModelOriginAllowlist = $origins }
}

function Configure-AiCredentials {
  Assert-AiRuntimeEntry
  Assert-AiPortsFree "ConfigureCredentials"
  if (Test-Path -LiteralPath $AiCredentialPath -PathType Leaf) {
    Read-AiCredentials | Out-Null
    Write-Output "Django AI 助理 DPAPI 凭据已存在且通过校验；未轮换。"
    return
  }
  $sourcePath = Get-CanonicalPath $RequestedAiEncryptionSource
  if ($sourcePath -ine (Get-CanonicalPath "D:\运营管理系统\.dev.vars")) { throw "AI 加密密钥只允许从已确认的 Worker 配置转存" }
  $sourceItem = Get-Item -LiteralPath $sourcePath -ErrorAction Stop
  if ($sourceItem.PSIsContainer -or ($sourceItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "AI 密钥源必须为普通文件" }
  $keyLines = @([IO.File]::ReadAllLines($sourcePath) | Where-Object { $_ -match "^AI_SECRET_ENCRYPTION_KEY=" })
  if ($keyLines.Count -ne 1) { throw "AI 密钥源必须有唯一的既有加密密钥" }
  $key = $keyLines[0].Substring("AI_SECRET_ENCRYPTION_KEY=".Length).Trim()
  if (($key.StartsWith('"') -and $key.EndsWith('"')) -or ($key.StartsWith("'") -and $key.EndsWith("'"))) { $key = $key.Substring(1, $key.Length - 2) }
  if ($key.Contains("`n") -or $key.Contains("`r") -or $key.Contains('\')) { throw "AI 密钥源包含不支持的转义" }
  Assert-StrongSecret $key "AI_SECRET_ENCRYPTION_KEY"
  foreach ($origin in $RequestedModelOriginAllowlist.Split(",", [StringSplitOptions]::RemoveEmptyEntries)) {
    $parsed = [Uri]$origin
    if ($parsed.Scheme -cne "https" -or $parsed.UserInfo -or $parsed.Query -or $parsed.Fragment -or $parsed.AbsolutePath -cne "/" -or $origin -cne $parsed.GetLeftPart([UriPartial]::Authority)) { throw "AI 模型精确 origin 配置无效" }
  }
  $reader = New-RandomSecret
  $writer = New-RandomSecret
  try {
    Write-AtomicJson $AiCredentialPath ([ordered]@{
      version = 1
      databaseAiReader = Protect-Value $reader
      databaseAiWriter = Protect-Value $writer
      modelEncryptionKey = Protect-Value $key
      modelOriginAllowlist = $RequestedModelOriginAllowlist
      createdAt = [DateTimeOffset]::UtcNow.ToString("o")
    })
    Set-RuntimeAcl
    Write-LauncherEvent "INFO" "ai_credentials_configured"
    Write-Output "Django AI 助理 reader/writer DPAPI 凭据已创建；未配置数据库角色。"
  } finally { $reader = $null; $writer = $null; $key = $null; $keyLines = $null }
}

function Provision-AiRoles {
  Assert-AiRuntimeEntry
  Assert-AiPortsFree "ProvisionRoles"
  Assert-PostgresListenerOwnership | Out-Null
  if (-not (Test-PostgresReady)) { throw "PostgreSQL 未就绪；拒绝配置AI 助理角色" }
  $runtimeSecrets = Read-Secrets
  $aiSecrets = Read-AiCredentials
  $vault = Read-JsonFile $CredentialPath "Django 本机 DPAPI 凭据库"
  $superuser = Unprotect-Value ([string]$vault.postgresSuperuser) "postgresSuperuser"
  $previousUrl = [Environment]::GetEnvironmentVariable("TERUISI_PROVISION_DATABASE_URL", "Process")
  $previousReader = [Environment]::GetEnvironmentVariable("TERUISI_PROVISION_AI_READER_PASSWORD", "Process")
  $previousWriter = [Environment]::GetEnvironmentVariable("TERUISI_PROVISION_AI_WRITER_PASSWORD", "Process")
  try {
    $env:TERUISI_PROVISION_DATABASE_URL = Database-Url "postgres" $superuser "teruisi_ai_role_provision" $ReaderStatementTimeoutMs
    $env:TERUISI_PROVISION_AI_READER_PASSWORD = $aiSecrets.ReaderPassword
    $env:TERUISI_PROVISION_AI_WRITER_PASSWORD = $aiSecrets.WriterPassword
    $code = @'
import os, django, psycopg
django.setup()
from ai_assistant.database_contract import provision
with psycopg.connect(os.environ["TERUISI_PROVISION_DATABASE_URL"], autocommit=True) as connection:
    provision(connection, os.environ["TERUISI_PROVISION_AI_READER_PASSWORD"], os.environ["TERUISI_PROVISION_AI_WRITER_PASSWORD"])
'@
    $launcher = ConvertTo-PythonBase64Launcher $code "ai_role_provision.py"
    $nativeRun = Invoke-WithDjangoEnvironment $runtimeSecrets $env:TERUISI_PROVISION_DATABASE_URL "migration_writer" $false $AiWriterMaxBodyBytes "" "" {
      Invoke-BoundedNativeProcess $Python @("-c", $launcher) $BackendRoot
    }
    Write-NativeDiagnosticLog (Join-Path $LogDirectory "ai-role-provision.$RunId.log") "ai_role_provision" $nativeRun
    if ($nativeRun.ExitCode -ne 0) { throw "配置AI 助理最小AI 助理数据库角色失败（$(Get-NativeFailureSummary $nativeRun)）" }
    Write-LauncherEvent "INFO" "ai_database_roles_provisioned"
    Write-Output "Django AI 助理 reader/writer 最小AI 助理角色已配置。"
  } finally {
    [Environment]::SetEnvironmentVariable("TERUISI_PROVISION_DATABASE_URL", $previousUrl, "Process")
    [Environment]::SetEnvironmentVariable("TERUISI_PROVISION_AI_READER_PASSWORD", $previousReader, "Process")
    [Environment]::SetEnvironmentVariable("TERUISI_PROVISION_AI_WRITER_PASSWORD", $previousWriter, "Process")
    $runtimeSecrets = $null; $aiSecrets = $null; $superuser = $null
  }
}

function Get-AiWriteAuthority([object]$RuntimeSecrets, [object]$AiSecrets) {
  $writerUrl = Database-Url "teruisi_ai_writer" $AiSecrets.WriterPassword "teruisi_ai_authority_probe" $ReaderStatementTimeoutMs
  $code = @'
import json
from django.db import connection
from ai_assistant.control_models import AiDataRevision, AiWriteAuthority
authority = AiWriteAuthority.objects.filter(id=1).first()
revision = AiDataRevision.objects.filter(domain="ai-assistant").first()
print(json.dumps({
    "status": authority.status if authority else "missing",
    "authorityEpoch": str(authority.authority_epoch) if authority and authority.authority_epoch else "",
    "cutoverId": authority.cutover_id if authority else "",
    "migrationRunId": authority.migration_verify_run_id if authority else "",
    "revision": int(revision.revision) if revision else -1,
}, separators=(",", ":")))
'@
  $launcher = ConvertTo-PythonBase64Launcher $code "ai_authority_probe.py"
  try {
    $payload = Invoke-WithDjangoEnvironment $RuntimeSecrets $writerUrl "migration_writer" $false $AiReaderMaxBodyBytes "" "" {
      $nativeRun = Invoke-BoundedNativeProcess $Python @((Join-Path $BackendRoot "manage.py"), "shell", "-c", $launcher) $BackendRoot
      return ConvertFrom-UniqueNativeJson $nativeRun "读取 PostgreSQL AI 助理写入权威"
    }
  } finally { $writerUrl = $null }
  if (-not (Test-ExactObjectPropertyNames $payload @("status", "authorityEpoch", "cutoverId", "migrationRunId", "revision"))) { throw "PostgreSQL AI 助理写入权威探针结构无效" }
  if ([string]$payload.status -cnotin @("d1", "postgres")) { throw "PostgreSQL AI 助理写入权威状态无效" }
  if ([string]$payload.status -ceq "postgres" -and (
      -not ([string]$payload.authorityEpoch -match "^[0-9a-fA-F-]{36}$") -or
      -not ([string]$payload.cutoverId -match "^[A-Za-z0-9._:-]{8,128}$") -or
      -not ([string]$payload.migrationRunId -match "^ai-apply-[0-9a-f]{32}$") -or
      [int]$payload.revision -lt 1)) { throw "PostgreSQL AI 助理写入权威证据不完整" }
  return $payload
}


function Invoke-WithAiEnvironment(
  [object]$RuntimeSecrets, [object]$AiSecrets, [string]$DatabaseUrl,
  [string]$Role, [bool]$ReadOnly, [int]$BodyBytes, [object]$Authority, [scriptblock]$Operation
) {
  Invoke-WithDjangoEnvironment $RuntimeSecrets $DatabaseUrl $Role $ReadOnly $BodyBytes ([string]$Authority.authorityEpoch) ([string]$Authority.cutoverId) {
    $env:AI_SECRET_ENCRYPTION_KEY = if ($Role -ceq "ai_writer") { $AiSecrets.ModelEncryptionKey } else { "" }
    $env:AI_MODEL_ENDPOINT_ORIGIN_ALLOWLIST = $AiSecrets.ModelOriginAllowlist
    $env:TERUISI_DJANGO_AI_EDGE_BASE_URL = "http://127.0.0.1:3000"
    & $Operation
  }
}

function Start-AiReader([object]$RuntimeSecrets, [object]$AiSecrets, [object]$Authority) {
  $arguments = @(
    "--listen=127.0.0.1:8111", "--threads=2", "--connection-limit=30", "--channel-timeout=35",
    "--cleanup-interval=30", "--ident=teruisi-django-ai-reader",
    "--max-request-header-size=$MaxHeaderBytes", "--max-request-body-size=$AiReaderMaxBodyBytes",
    "--no-expose-tracebacks", "teruisi_backend.wsgi:application"
  )
  $fingerprint = Get-Sha256Text ((Get-ConfigFingerprint "django-ai-reader" $Waitress $arguments) + (Get-FileHash -LiteralPath $AiCredentialPath -Algorithm SHA256).Hash + [string]$Authority.authorityEpoch + [string]$Authority.cutoverId)
  if (Resolve-OwnedProcess "django-ai-reader" $AiReaderPidPath $Waitress $arguments $fingerprint) {
    Wait-DjangoReady "ai-reader" $AiReaderHealthUrl "127.0.0.1:8111"; return $false
  }
  if (@(Get-PortListeners 8111).Count -gt 0) { throw "端口 8111 被非本部署服务占用" }
  Remove-OldServiceLogs "django-ai-reader"
  $readerUrl = Database-Url "teruisi_ai_reader" $AiSecrets.ReaderPassword "teruisi_ai_read" $ReaderStatementTimeoutMs
  Invoke-WithAiEnvironment $RuntimeSecrets $AiSecrets $readerUrl "ai_reader" $true $AiReaderMaxBodyBytes $Authority {
    Start-ManagedProcess "django-ai-reader" $Waitress $arguments $BackendRoot $AiReaderPidPath $fingerprint `
      (Join-Path $LogDirectory "django-ai-reader.$RunId.stdout.log") (Join-Path $LogDirectory "django-ai-reader.$RunId.stderr.log") | Out-Null
  }
  $readerUrl = $null
  try { Wait-DjangoReady "ai-reader" $AiReaderHealthUrl "127.0.0.1:8111"; return $true }
  catch { Stop-OwnedProcess "django-ai-reader" $AiReaderPidPath $Waitress; throw }
}

function Start-AiWriter([object]$RuntimeSecrets, [object]$AiSecrets, [object]$Authority) {
  if ([string]$Authority.status -cne "postgres") { throw "PostgreSQL 尚未成为AI 助理唯一写入源；拒绝启动AI 助理 writer" }
  $arguments = @(
    "--listen=127.0.0.1:8112", "--threads=6", "--connection-limit=30", "--channel-timeout=320",
    "--cleanup-interval=30", "--ident=teruisi-django-ai-writer",
    "--max-request-header-size=$MaxHeaderBytes", "--max-request-body-size=$AiWriterMaxBodyBytes",
    "--no-expose-tracebacks", "teruisi_backend.wsgi:application"
  )
  $fingerprint = Get-Sha256Text ((Get-ConfigFingerprint "django-ai-writer" $Waitress $arguments) + (Get-FileHash -LiteralPath $AiCredentialPath -Algorithm SHA256).Hash + [string]$Authority.authorityEpoch + [string]$Authority.cutoverId)
  if (Resolve-OwnedProcess "django-ai-writer" $AiWriterPidPath $Waitress $arguments $fingerprint) {
    Wait-DjangoReady "ai-writer" $AiWriterHealthUrl "127.0.0.1:8112"; return $false
  }
  if (@(Get-PortListeners 8112).Count -gt 0) { throw "端口 8112 被非本部署服务占用" }
  Remove-OldServiceLogs "django-ai-writer"
  $writerUrl = Database-Url "teruisi_ai_writer" $AiSecrets.WriterPassword "teruisi_ai_write" $WriterStatementTimeoutMs
  Invoke-WithAiEnvironment $RuntimeSecrets $AiSecrets $writerUrl "ai_writer" $false $AiWriterMaxBodyBytes $Authority {
    Start-ManagedProcess "django-ai-writer" $Waitress $arguments $BackendRoot $AiWriterPidPath $fingerprint `
      (Join-Path $LogDirectory "django-ai-writer.$RunId.stdout.log") (Join-Path $LogDirectory "django-ai-writer.$RunId.stderr.log") | Out-Null
  }
  $writerUrl = $null
  try { Wait-DjangoReady "ai-writer" $AiWriterHealthUrl "127.0.0.1:8112"; return $true }
  catch { Stop-OwnedProcess "django-ai-writer" $AiWriterPidPath $Waitress; throw }
}

function Start-AiStack([string]$LifecycleAclToken = "") {
  Assert-AiRuntimeEntry $LifecycleAclToken
  Assert-PostgresListenerOwnership | Out-Null
  if (-not (Test-PostgresReady)) { throw "PostgreSQL 未就绪；拒绝启动AI 助理服务" }
  New-Item -ItemType Directory -Path $LogDirectory, $RunDirectory -Force | Out-Null
  $runtimeSecrets = Read-Secrets; $aiSecrets = Read-AiCredentials
  $readerStarted = $false; $writerStarted = $false
  try {
    if ((Assert-PostgresConnectionCapacity $runtimeSecrets) -lt 128) { throw "AI 完整运行栈要求 max_connections 至少 128" }
    $authority = Get-AiWriteAuthority $runtimeSecrets $aiSecrets
    if ([string]$authority.status -cne "postgres") { throw "AI PostgreSQL 权威尚未激活，拒绝启动" }
    $probeUrl = Database-Url "teruisi_ai_writer" $aiSecrets.WriterPassword "teruisi_ai_credentials_probe" $ReaderStatementTimeoutMs
    try {
      $credentialCheck = Invoke-WithAiEnvironment $runtimeSecrets $aiSecrets $probeUrl "ai_writer" $false $AiWriterMaxBodyBytes $authority {
        $nativeRun = Invoke-BoundedNativeProcess $Python @((Join-Path $BackendRoot "manage.py"), "ai_credentials_check") $BackendRoot
        return ConvertFrom-UniqueNativeJson $nativeRun "AI 原密文与模型 origin 回查"
      }
      if ([string]$credentialCheck.status -cne "verified" -or [int]$credentialCheck.providerCalls -ne 0) { throw "AI 模型凭证启动检查失败" }
    } finally { $probeUrl = $null }
    if (Test-Path -LiteralPath $AiStartupPath -PathType Leaf) {
      $startup = Read-JsonFile $AiStartupPath "Django AI 助理开机启动凭据"
      if (-not (Test-ExactObjectPropertyNames $startup @("version", "authorityEpoch", "cutoverId", "migrationRunId", "enabledAt")) -or
          [int]$startup.version -ne 1 -or [string]$startup.authorityEpoch -cne [string]$authority.authorityEpoch -or
          [string]$startup.cutoverId -cne [string]$authority.cutoverId -or [string]$startup.migrationRunId -cne [string]$authority.migrationRunId) {
        throw "Django AI 助理开机启动凭据与当前 PostgreSQL authority 不一致"
      }
    }
    $readerStarted = Start-AiReader $runtimeSecrets $aiSecrets $authority
    $writerStarted = Start-AiWriter $runtimeSecrets $aiSecrets $authority
    Wait-DjangoReady "ai-reader" $AiReaderHealthUrl "127.0.0.1:8111"
    Wait-DjangoReady "ai-writer" $AiWriterHealthUrl "127.0.0.1:8112"
    Write-Output "Django AI 助理服务已就绪：reader=http://127.0.0.1:8111 writer=http://127.0.0.1:8112。"
  } catch {
    $original = $_.Exception
    if ($writerStarted) { try { Stop-OwnedProcess "django-ai-writer" $AiWriterPidPath $Waitress } catch {} }
    if ($readerStarted) { try { Stop-OwnedProcess "django-ai-reader" $AiReaderPidPath $Waitress } catch {} }
    throw $original
  } finally { $runtimeSecrets = $null; $aiSecrets = $null }
}

function Stop-AiStack([string]$LifecycleAclToken = "") {
  Assert-AiRuntimeEntry $LifecycleAclToken
  Stop-OwnedProcess "django-ai-writer" $AiWriterPidPath $Waitress
  Stop-OwnedProcess "django-ai-reader" $AiReaderPidPath $Waitress
  Write-Output "Django AI 助理 reader/writer 已停止；其他业务域、ERP 与 PostgreSQL 未改变。"
}

function Enable-AiStartup {
  Assert-AiRuntimeEntry
  Assert-PostgresListenerOwnership | Out-Null
  if (-not (Test-PostgresReady)) { throw "PostgreSQL 未就绪；拒绝启用AI 助理开机启动" }
  $runtimeSecrets = Read-Secrets; $aiSecrets = Read-AiCredentials
  try {
    $authority = Get-AiWriteAuthority $runtimeSecrets $aiSecrets
    if ([string]$authority.status -cne "postgres") { throw "只有 PostgreSQL 已取得AI 助理唯一写权后才能启用AI 助理开机启动" }
    Start-AiStack
    Write-AtomicJson $AiStartupPath ([ordered]@{
      version = 1; authorityEpoch = [string]$authority.authorityEpoch; cutoverId = [string]$authority.cutoverId
      migrationRunId = [string]$authority.migrationRunId; enabledAt = [DateTimeOffset]::UtcNow.ToString("o")
    })
    Set-RuntimeAcl
    Write-Output "Django AI 助理域已加入现有受控开机启动链。"
  } finally { $runtimeSecrets = $null; $aiSecrets = $null }
}

function Disable-AiStartup {
  Assert-AiRuntimeEntry
  if (Test-Path -LiteralPath $AiStartupPath -PathType Leaf) { Remove-Item -LiteralPath $AiStartupPath -Force }
  Write-Output "Django AI 助理域已退出开机启动链；当前运行进程未改变。"
}

function Show-AiStatus {
  $reader = "stopped"; $writer = "stopped"
  try { if (Resolve-OwnedProcess "django-ai-reader" $AiReaderPidPath $Waitress) { $reader = "running" } elseif (@(Get-PortListeners 8111).Count -gt 0) { $reader = "foreign_port_owner" } } catch { $reader = "ownership_error" }
  try { if (Resolve-OwnedProcess "django-ai-writer" $AiWriterPidPath $Waitress) { $writer = "running" } elseif (@(Get-PortListeners 8112).Count -gt 0) { $writer = "foreign_port_owner" } } catch { $writer = "ownership_error" }
  $readerReady = "not_ready"; $writerReady = "not_ready"
  try { if ((Invoke-WebRequest -UseBasicParsing -Uri $AiReaderHealthUrl -TimeoutSec 2 -Headers @{ Host = "127.0.0.1:8111" }).StatusCode -eq 200) { $readerReady = "ready" } } catch {}
  try { if ((Invoke-WebRequest -UseBasicParsing -Uri $AiWriterHealthUrl -TimeoutSec 2 -Headers @{ Host = "127.0.0.1:8112" }).StatusCode -eq 200) { $writerReady = "ready" } } catch {}
  $status = [pscustomobject][ordered]@{ AiReader = $reader; AiWriter = $writer; ReaderReadiness = $readerReady; WriterReadiness = $writerReady; CheckedAt = [DateTimeOffset]::UtcNow.ToString("o") }
  if ($RequestedJson) { Write-Output ($status | ConvertTo-Json -Compress) } else { $status | Format-List }
}

try {
  switch ($Action) {
    "ConfigureCredentials" { Invoke-WithServiceMutex { Configure-AiCredentials } }
    "ProvisionRoles" { Invoke-WithServiceMutex { Provision-AiRoles } }
    "Start" { Invoke-WithServiceMutex { Start-AiStack $OrchestratedLifecycleAclToken } }
    "Stop" { Invoke-WithServiceMutex { Stop-AiStack $OrchestratedLifecycleAclToken } }
    "Status" { Show-AiStatus }
    "EnableStartup" { Invoke-WithServiceMutex { Enable-AiStartup } }
    "DisableStartup" { Invoke-WithServiceMutex { Disable-AiStartup } }
  }
} catch { Write-LauncherEvent "ERROR" "ai_action_failed" $_.Exception.Message; throw }
