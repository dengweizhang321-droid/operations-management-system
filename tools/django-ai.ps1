[CmdletBinding()]
param(
  [ValidateSet(
    "ConfigureCredentials", "ProvisionRoles", "Start", "Stop", "Status",
    "EnableStartup", "DisableStartup", "DingTalkCheck", "StartDingTalk", "StopDingTalk",
    "EnableDingTalkStartup", "DisableDingTalkStartup", "AutoStartDingTalk", "ConfigureDingTalkBotCredentials", "ConfigurePandas", "PandasCheck", "PreparePandasRotation", "PandasRotationCheck", "SwitchPandasRotation", "CompletePandasRotation", "PreparePi", "PreparePiUpgrade", "PiUpgradeCheck", "UpgradePi", "ReconcilePiUpgrade", "PiUpgradeStatus", "VerifyPiUpgradeResult", "PiCheck"
  )]
  [string]$Action = "Status",
  [string]$RuntimeRoot = "D:\teruisi-runtime\django-sales",
  [string]$OrchestratedLifecycleAclToken = "",
  [string]$AiEncryptionSource = "D:\运营管理系统\.dev.vars",
  [string]$ModelOriginAllowlist = "",
  [string]$PandasImage = "",
  [string]$PandasPreparedAppId = "",
  [string]$PandasPreparedAppSha256 = "",
  [string]$PandasPlanSha256 = "",
  [string]$PandasSourceCommit = "",
  [string]$PandasMaintenanceId = "",
  [int]$PandasPublicationOwnerPid = 0,
  [string]$PiImage = "",
  [string]$PiSkillVersion = "1.0.0",
  [string]$PiUpgradePlanSha256 = "",
  [string]$PiPreparedAppId = "",
  [string]$PiPreparedAppSha256 = "",
  [switch]$Json
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "native-isolation.ps1")
$RuntimeRoot = Get-NativeRuntimeRoot "django" $RuntimeRoot ($PSBoundParameters.ContainsKey("RuntimeRoot"))
$RequestedAiEncryptionSource = $AiEncryptionSource
$RequestedModelOriginAllowlist = $ModelOriginAllowlist
$RequestedPandasImage = $PandasImage
$RequestedPandasRotation = [pscustomobject]@{
  preparedAppId = $PandasPreparedAppId; preparedAppSha256 = $PandasPreparedAppSha256
  registeredPlanSha256 = $PandasPlanSha256; sourceCommit = $PandasSourceCommit
  maintenanceId = $PandasMaintenanceId; publicationOwnerPid = $PandasPublicationOwnerPid
}
$RequestedPiImage = $PiImage
$RequestedPiSkillVersion = $PiSkillVersion
$RequestedPiUpgradePlanSha256 = $PiUpgradePlanSha256
$RequestedPiPreparedAppId = $PiPreparedAppId
$RequestedPiPreparedAppSha256 = $PiPreparedAppSha256
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
$AiReaderHealthUrl = "http://127.0.0.1:$($NativePorts[8111])/health/ready"
$AiWriterHealthUrl = "http://127.0.0.1:$($NativePorts[8112])/health/ready"
$AiStartupPath = Join-Path $RuntimeRoot "ai-enabled.json"
$DingTalkConfigPath = Join-Path $RuntimeRoot "config\dingtalk-ask.json"
$DingTalkSchedulePidPath = Join-Path $RunDirectory "django-ai-dingtalk-schedule.pid.json"
$DingTalkBotCredentialPath = Join-Path $RuntimeRoot "secrets\dingtalk-bot.dpapi.json"
$DingTalkPidPath = Join-Path $RunDirectory "django-ai-dingtalk.pid.json"
$DingTalkStartupPath = Join-Path $RuntimeRoot "config\dingtalk-startup.json"
$DingTalkScreenshotRoot = "$RuntimeRoot-screenshot-profile"
$DingTalkScreenshotProfile = Join-Path $DingTalkScreenshotRoot "Chrome"
$AiReaderMaxBodyBytes = 1048576
$AiWriterMaxBodyBytes = 1048576
$PandasConfigPath = Join-Path $RuntimeRoot "config\pandas-sandbox.json"
$PandasKeyPath = Join-Path $RuntimeRoot "secrets\pandas-sandbox.dpapi.json"
$PandasPidPath = Join-Path $RunDirectory "ai-pandas-wsl.pid.json"
$PandasWsl = Join-Path $env:SystemRoot "System32\wsl.exe"
$PandasDistribution = if ($NativeIsolation) { $NativeIsolation.wslDistribution } else { "TERUISI-Pandas" }
$PandasKeepaliveArguments = @("-d", $PandasDistribution, "-u", "teruisi-pandas", "--exec", "/usr/bin/sleep", "infinity")
$PiConfigPath = Join-Path $RuntimeRoot "config\pi-agent.json"
$PiKeyPath = Join-Path $RuntimeRoot "secrets\pi-agent.dpapi.json"
$PiWorkerPidPath = Join-Path $RunDirectory "django-ai-pi-worker.pid.json"
$PiWorkerControlPath = Join-Path $RunDirectory "django-ai-pi-worker.control.json"

function Prepare-PiRuntime {
  Assert-AiRuntimeEntry
  Assert-AiPortsFree "PreparePi"
  if ($RequestedPiImage -cnotmatch '^sha256:[a-f0-9]{64}$' -or $RequestedPiSkillVersion -cnotmatch '^[0-9]+\.[0-9]+\.[0-9]+$') { throw "Exact reviewed Pi image and skill version required" }
  if ((Test-Path -LiteralPath $PiConfigPath) -or (Test-Path -LiteralPath $PiKeyPath) -or (Test-Path -LiteralPath (Join-Path $RuntimeRoot 'config\pi-agent-prepare-intent.json'))) { throw "Existing or unknown Pi preparation retained; inspect the original operation before any retry" }
  $runtimeSecrets = Read-Secrets; $aiSecrets = Read-AiCredentials
  try {
    $authority = Get-AiWriteAuthority $runtimeSecrets $aiSecrets
    if ([string]$authority.status -cne "postgres") { throw "Pi preparation requires the existing AI authority" }
    $sourceRun = Invoke-BoundedNativeProcess $Python @('-B','-c','from pi_runner.install_linux import source_digest; print(source_digest())') $BackendRoot
    if ($sourceRun.ExitCode -ne 0) { throw "Cannot freeze reviewed Pi source" }
    $sourceDigest = [string](@($sourceRun.Output) -join '').Trim()
    if ($sourceDigest -cnotmatch '^[a-f0-9]{64}$') { throw "Invalid reviewed Pi source identity" }
    $prepare = Join-Path $InstalledAppRoot 'tools\pi_agent_prepare_runtime.py'
    $arguments = @('-B',$prepare,'--runtime',$RuntimeRoot,'--image',$RequestedPiImage,'--source-sha256',$sourceDigest,'--authority-epoch',[string]$authority.authorityEpoch,'--cutover-id',[string]$authority.cutoverId,'--skill-version',$RequestedPiSkillVersion,'--execute')
    $prepared = Invoke-BoundedNativeProcess $Python $arguments $BackendRoot
    $proof = ConvertFrom-UniqueNativeJson $prepared 'Prepare independent Pi runtime without starting it'
    if ($proof.prepared -cne $true -or $proof.started -cne $false) { throw "Pi preparation result unknown; preserve its original intent" }
    Set-RuntimeAcl
    $proof | ConvertTo-Json -Compress
  } finally { $runtimeSecrets = $null; $aiSecrets = $null }
}

function Read-PiConfig {
  if (-not (Test-Path -LiteralPath $PiConfigPath -PathType Leaf)) { return $null }
  $config = Read-JsonFile $PiConfigPath "Pi independent runtime configuration"
  if (-not (Test-ExactObjectPropertyNames $config @("version", "enabled", "keyFileSha256", "channelKeySha256", "skillVersion", "authorityEpoch", "cutoverId", "runnerImage", "runnerSourceSha256")) -or
      ($config.version -isnot [int] -and $config.version -isnot [long]) -or $config.version -ne 1 -or $config.enabled -isnot [bool]) {
    throw "Invalid Pi runtime configuration"
  }
  if (-not $config.enabled) { return $null }
  if ([string]$config.keyFileSha256 -cnotmatch '^[a-f0-9]{64}$' -or [string]$config.channelKeySha256 -cnotmatch '^[a-f0-9]{64}$' -or [string]$config.runnerImage -cnotmatch '^sha256:[a-f0-9]{64}$' -or
      [string]$config.runnerSourceSha256 -cnotmatch '^[a-f0-9]{64}$' -or [string]$config.skillVersion -cnotmatch '^[0-9]+\.[0-9]+\.[0-9]+$' -or
      -not (Test-Path -LiteralPath $PiKeyPath -PathType Leaf) -or (Get-FileSha256 $PiKeyPath) -cne [string]$config.keyFileSha256) {
    throw "Pi runtime key, source or image identity is invalid"
  }
  return $config
}

function Upgrade-PiRuntime([bool]$PrepareOnly, [bool]$ReconcileOnly = $false) {
  $upgradeExecutionRoot = if ($PrepareOnly) { Get-PiUpgradePreparedExecutionRoot } else { Assert-AiRuntimeEntry; $InstalledAppRoot }
  $config = Read-PiConfig
  if ($null -eq $config) { throw 'Independent Pi upgrade requires an existing enabled runtime' }
  $tool = Join-Path $upgradeExecutionRoot 'tools\pi_agent_upgrade_runtime.py'
  $upgradeBackendRoot = Join-Path $upgradeExecutionRoot 'backend'
  $arguments = @('-B',$tool)
  if ($PrepareOnly) {
    if ($RequestedPiImage -cnotmatch '^sha256:[a-f0-9]{64}$') { throw 'Exact reviewed successor Pi image required' }
    $sourceRun = Invoke-BoundedNativeProcess $Python @('-B','-c','from pi_runner.install_linux import source_digest; print(source_digest())') $upgradeBackendRoot
    if ($sourceRun.ExitCode -ne 0) { throw 'Cannot freeze successor Runner source' }
    $sourceDigest = [string](@($sourceRun.Output) -join '').Trim()
    if ($sourceDigest -cnotmatch '^[a-f0-9]{64}$') { throw 'Invalid successor Runner source' }
    $arguments += @('prepare','--runtime',$RuntimeRoot,'--image',$RequestedPiImage,'--source-sha256',$sourceDigest,'--skill-version',$RequestedPiSkillVersion,'--execute')
  } else {
    Assert-AiPortsFree 'UpgradePi'
    if (Resolve-OwnedProcess 'django-ai-pi-worker' $PiWorkerPidPath $Python) { throw 'Pi worker must finish its exact native stop before independent Runner upgrade' }
    if ($RequestedPiUpgradePlanSha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'Registered immutable Pi upgrade plan hash required' }
    $upgradeVerb = if ($ReconcileOnly) { 'reconcile' } else { 'apply' }
    $arguments += @($upgradeVerb,'--runtime',$RuntimeRoot,'--expected-plan-sha256',$RequestedPiUpgradePlanSha256,'--execute')
  }
  $result = ConvertFrom-UniqueNativeJson (Invoke-BoundedNativeProcess $Python $arguments $upgradeBackendRoot) 'Independent Pi source upgrade'
  if ($PrepareOnly) {
    if ($result.prepared -cne $true -or $result.started -cne $false) { throw 'Independent Runner preparation outcome unknown' }
  } elseif ($result.upgraded -cne $true -or $result.windowsConfigUpdated -cne $true) { throw 'Independent Runner upgrade outcome unknown; keep the original intent' }
  Assert-PiUpgradeLeafAcl ([string]$result.sourceSha256)
  $result | ConvertTo-Json -Compress
}

function Assert-PiUpgradeLeafAcl([string]$SourceSha256 = "") {
  $allowedValues = @((Get-AllowedAclSids) | ForEach-Object { $_.Value })
  $upgradeLeaves = @('config\pi-agent.json','secrets\pi-agent.dpapi.json','config\pi-agent-upgrade-prepared.json','config\pi-agent-upgrade-intent.json','config\pi-agent-upgrade-result.json')
  if ($SourceSha256 -cmatch '^[a-f0-9]{64}$') {
    $upgradeDirectory = 'config\pi-agent-upgrades\' + $SourceSha256
    $upgradeLeaves += @('config\pi-agent-upgrades', $upgradeDirectory)
    foreach ($name in @('preparing.json','prepared.json','intent.json','result.json')) { $upgradeLeaves += ($upgradeDirectory + '\' + $name) }
  }
  foreach ($relative in $upgradeLeaves) {
    $path = Join-Path $RuntimeRoot $relative
    if (-not (Test-Path -LiteralPath $path)) { continue }
    $item = Get-Item -LiteralPath $path -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Pi upgrade leaf cannot be a reparse point' }
    Assert-ExactRuntimeAclEntry $item (Get-RuntimeItemAccessControl $item) $allowedValues (Get-CanonicalPath $RuntimeRoot)
  }
}

function Get-PiUpgradeStatus([bool]$VerifyResult = $false) {
  Assert-AiRuntimeEntry
  if ($RequestedPiUpgradePlanSha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'Registered immutable Pi upgrade plan hash required' }
  $tool = Join-Path $InstalledAppRoot 'tools\pi_agent_upgrade_status.py'
  $arguments = @('-B',$tool,'--runtime',$RuntimeRoot,'--expected-plan-sha256',$RequestedPiUpgradePlanSha256)
  $result = ConvertFrom-UniqueNativeJson (Invoke-BoundedNativeProcess $Python $arguments $BackendRoot) 'Observe exact independent Pi upgrade without replay'
  if ([string]$result.status -cnotin @('windows_complete','reconcile_available','blocked') -or
      [string]$result.registeredPlanSha256 -cne $RequestedPiUpgradePlanSha256 -or $result.postconditionsVerified -isnot [bool] -or $result.postconditionsVerified) {
    throw 'Independent Runner upgrade observation contract changed'
  }
  if ($VerifyResult) {
    if ([string]$result.status -cne 'windows_complete' -or $null -eq $result.upgradeReceipt -or
        $result.upgradeReceipt.upgraded -cne $true -or $result.upgradeReceipt.windowsConfigUpdated -cne $true -or
        $result.upgradeReceipt.sameDpapiOwner -cne $true) { throw 'Independent Runner original Windows completion remains unproved' }
    Assert-PiUpgradeLeafAcl ([string]$result.sourceSha256)
    $result.postconditionsVerified = $true
  }
  $result | ConvertTo-Json -Depth 8 -Compress
}

function Check-PiUpgradePlan {
  $upgradeExecutionRoot = Get-PiUpgradePreparedExecutionRoot
  if ($RequestedPiUpgradePlanSha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'Registered immutable Pi upgrade plan hash required' }
  $tool = Join-Path $upgradeExecutionRoot 'tools\pi_agent_upgrade_runtime.py'
  $upgradeBackendRoot = Join-Path $upgradeExecutionRoot 'backend'
  $arguments = @('-B',$tool,'check','--runtime',$RuntimeRoot,'--expected-plan-sha256',$RequestedPiUpgradePlanSha256,'--execute')
  $result = ConvertFrom-UniqueNativeJson (Invoke-BoundedNativeProcess $Python $arguments $upgradeBackendRoot) 'Verify independent Pi upgrade plan'
  if ($result.checked -cne $true -or $result.started -cne $false) { throw 'Independent Runner upgrade plan verification failed' }
  $result | ConvertTo-Json -Compress
}

function Get-PiUpgradePreparedExecutionRoot {
  if ((Get-CanonicalPath $ExecutionRoot) -ieq (Get-CanonicalPath $InstalledAppRoot)) {
    Assert-AiRuntimeEntry
    return $InstalledAppRoot
  }
  return Get-ReviewedPreparedExecutionRoot $RequestedPiPreparedAppId $RequestedPiPreparedAppSha256
}

function Get-ReviewedPreparedExecutionRoot([string]$Id, [string]$ReceiptSha256) {
  Assert-DeployedApplication
  Assert-RuntimeAclHardened
  $prepared = Get-PreparedApplication $Id $ReceiptSha256
  $manifest = Read-JsonFile (Join-Path $prepared 'deployment.json') 'Prepared application manifest'
  if ((Get-CanonicalPath $manifest.sourceRoot) -cne (Get-CanonicalPath $ExecutionRoot)) { throw 'Prepared application belongs to a different source' }
  $sourceBackend = Get-CanonicalPath (Join-Path $ExecutionRoot 'backend')
  $expected = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  foreach ($file in Get-ChildItem -LiteralPath $sourceBackend -File -Recurse -Force) {
    $relative = $file.FullName.Substring($sourceBackend.Length + 1)
    if ($file.Extension -in @('.pyc','.pyo') -or @(($relative -split '[\\/]') | Where-Object {$_ -in @('.runtime','__pycache__','.pytest_cache','.mypy_cache','tests')}).Count) { continue }
    [void]$expected.Add($relative)
  }
  $actual = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  foreach ($directory in @('backend','config','tools','drizzle')) {
    foreach ($file in Get-ChildItem -LiteralPath (Join-Path $prepared $directory) -File -Recurse -Force) {
      if ($file.Extension -in @('.pyc','.pyo') -or $file.FullName -match '[\\/](__pycache__|\.pytest_cache|\.mypy_cache)[\\/]') { continue }
      $relative = $file.FullName.Substring($prepared.Length + 1)
      if ($directory -ceq 'backend') { [void]$actual.Add($relative.Substring('backend\'.Length)) }
      $source = Join-Path $ExecutionRoot $relative
      if (-not (Test-Path -LiteralPath $source -PathType Leaf) -or (Get-FileSha256 $file.FullName) -cne (Get-FileSha256 $source)) { throw 'Prepared application differs from frozen source' }
    }
  }
  if (-not $expected.SetEquals($actual)) { throw 'Prepared backend inventory differs from frozen source' }
  return $prepared
}

function Invoke-PiLifecycle([string]$Verb) {
  if ($Verb -cnotin @("start", "stop", "probe")) { throw "Invalid Pi lifecycle verb" }
  $nativeRun = Invoke-BoundedNativeProcess $Python @("-B", "-m", "pi_runner.wsl_control", $Verb, "--config", $PiConfigPath, "--key-file", $PiKeyPath) $BackendRoot
  return ConvertFrom-UniqueNativeJson $nativeRun "Pi independent runner lifecycle"
}

function Get-PiWorkerArguments([string]$Token) {
  if ($Token -cnotmatch '^[a-f0-9]{32}$') { throw "Invalid Pi worker lifecycle token" }
  return @("-u", "-B", "-m", "ai_assistant.pi_worker", "--control-file", $PiWorkerControlPath, "--control-token", $Token)
}

function Start-PiRuntime([object]$RuntimeSecrets, [object]$AiSecrets, [object]$Authority) {
  $config = Read-PiConfig
  if ($null -eq $config) { return $false }
  if ([string]$config.authorityEpoch -cne [string]$Authority.authorityEpoch -or [string]$config.cutoverId -cne [string]$Authority.cutoverId) { throw "Pi configuration authority changed" }
  $control = $null
  if (Test-Path -LiteralPath $PiWorkerControlPath -PathType Leaf) {
    $control = Read-JsonFile $PiWorkerControlPath "Pi worker lifecycle"
    if (-not (Test-ExactObjectPropertyNames $control @("version", "token", "intent")) -or $control.version -ne 1 -or [string]$control.intent -cnotin @("running", "stop")) { throw "Invalid Pi worker lifecycle state" }
  }
  $token = if ($null -ne $control) { [string]$control.token } else { [Guid]::NewGuid().ToString("N") }
  $arguments = @(Get-PiWorkerArguments $token)
  $fingerprint = Get-Sha256Text ((Get-ConfigFingerprint "django-ai-pi-worker" $Python $arguments) + (Get-FileSha256 $AiCredentialPath) + (Get-FileSha256 $PiConfigPath) + (Get-FileSha256 $PiKeyPath) + [string]$Authority.authorityEpoch + [string]$Authority.cutoverId)
  if (Resolve-OwnedProcess "django-ai-pi-worker" $PiWorkerPidPath $Python $arguments $fingerprint) {
    if ([string]$control.intent -cne "running") { throw "Pi worker is still stopping" }
    Invoke-PiLifecycle "probe" | Out-Null
    return $false
  }
  Invoke-PiLifecycle "start" | Out-Null
  Invoke-PiLifecycle "probe" | Out-Null
  $token = [Guid]::NewGuid().ToString("N")
  $arguments = @(Get-PiWorkerArguments $token)
  $fingerprint = Get-Sha256Text ((Get-ConfigFingerprint "django-ai-pi-worker" $Python $arguments) + (Get-FileSha256 $AiCredentialPath) + (Get-FileSha256 $PiConfigPath) + (Get-FileSha256 $PiKeyPath) + [string]$Authority.authorityEpoch + [string]$Authority.cutoverId)
  $stoppedPath = "$PiWorkerControlPath.stopped"
  if (Test-Path -LiteralPath $stoppedPath -PathType Leaf) { Remove-Item -LiteralPath $stoppedPath }
  Write-AtomicJson $PiWorkerControlPath ([ordered]@{version=1;token=$token;intent="running"})
  $url = Database-Url "teruisi_ai_writer" $AiSecrets.WriterPassword "teruisi_ai_pi_queue" $WriterStatementTimeoutMs
  try {
    Invoke-WithAiEnvironment $RuntimeSecrets $AiSecrets $url "ai_writer" $false $AiWriterMaxBodyBytes $Authority {
      $check = Invoke-BoundedNativeProcess $Python @("-B", "-m", "ai_assistant.pi_worker", "--check") $BackendRoot
      $value = ConvertFrom-UniqueNativeJson $check "Pi independent queue preflight"
      if ([string]$value.status -cne "verified" -or [int]$value.providerCalls -ne 0 -or [string]$value.skillVersion -cne [string]$config.skillVersion) { throw "Pi queue preflight failed" }
      Start-ManagedProcess "django-ai-pi-worker" $Python $arguments $BackendRoot $PiWorkerPidPath $fingerprint `
        (Join-Path $LogDirectory "django-ai-pi-worker.$RunId.stdout.log") (Join-Path $LogDirectory "django-ai-pi-worker.$RunId.stderr.log") | Out-Null
    }
  } finally { $url = $null }
  return $true
}

function Wait-PiWorkerExit([object]$Expected, [string]$ReceiptSha256, [string]$ControlSha256, [DateTimeOffset]$Deadline) {
  # This observer is used only after an exact Resolve and our token-bound stop
  # write. Missing CIM fields during exit are unknown, not proof of absence.
  while ($true) {
    if ([DateTimeOffset]::UtcNow -ge $Deadline) { throw "Pi queue stop remains unknown; writer and runner were preserved" }
    if ((Get-FileSha256 $PiWorkerPidPath) -cne $ReceiptSha256 -or
        (Get-FileSha256 $PiWorkerControlPath) -cne $ControlSha256) { throw "Pi stop ownership or control record changed" }
    $rows = @(Get-CimInstance Win32_Process -Filter ("ProcessId = " + [int]$Expected.ProcessId) -ErrorAction Stop)
    if ($rows.Count -gt 1) { throw "Ambiguous Pi worker process metadata" }
    if ($rows.Count -eq 0) { return }
    $current = $rows[0]
    if (($current.CreationDate -and (Get-ProcessCreation $current) -cne $Expected.CreationDate) -or
        (-not [string]::IsNullOrWhiteSpace([string]$current.ExecutablePath) -and
          (Get-CanonicalPath ([string]$current.ExecutablePath)) -ine $Expected.ExecutablePath) -or
        (-not [string]::IsNullOrWhiteSpace([string]$current.CommandLine) -and
          [string]$current.CommandLine -cne $Expected.CommandLine)) { throw "Pi worker PID identity changed during stop" }
    Start-Sleep -Milliseconds 250
  }
}

function Stop-PiRuntime {
  $config = Read-PiConfig
  $receiptSha256 = if (Test-Path -LiteralPath $PiWorkerPidPath -PathType Leaf) { Get-FileSha256 $PiWorkerPidPath } else { $null }
  $owned = Resolve-OwnedProcess "django-ai-pi-worker" $PiWorkerPidPath $Python
  if ($owned) {
    if ((Get-FileSha256 $PiWorkerPidPath) -cne $receiptSha256) { throw "Pi worker ownership record changed before stop" }
    if ($null -eq $config) { throw "Running Pi worker lacks its exact enabled configuration" }
    $control = Read-JsonFile $PiWorkerControlPath "Pi worker lifecycle"
    if (-not (Test-ExactObjectPropertyNames $control @("version", "token", "intent")) -or $control.version -ne 1) { throw "Invalid Pi worker lifecycle state" }
    Get-PiWorkerArguments ([string]$control.token) | Out-Null
    Write-AtomicJson $PiWorkerControlPath ([ordered]@{version=1;token=[string]$control.token;intent="stop"})
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds(45)
    Wait-PiWorkerExit $owned $receiptSha256 (Get-FileSha256 $PiWorkerControlPath) $deadline
    $stopped = Read-JsonFile "$PiWorkerControlPath.stopped" "Pi queue stop receipt"
    if (-not (Test-ExactObjectPropertyNames $stopped @("version", "token", "status")) -or $stopped.version -ne 1 -or [string]$stopped.token -cne [string]$control.token -or [string]$stopped.status -cne "stopped") { throw "Pi queue stop receipt mismatch" }
  }
  Stop-OwnedProcess "django-ai-pi-worker" $PiWorkerPidPath $Python
  if ($null -ne $config) { Invoke-PiLifecycle "stop" | Out-Null }
}

function Read-PandasConfig {
  if (-not (Test-Path -LiteralPath $PandasConfigPath)) { return $null }
  $config = Read-JsonFile $PandasConfigPath "pandas sandbox configuration"
  if (-not (Test-ExactObjectPropertyNames $config @("version", "image", "keySha256")) -or [int]$config.version -ne 1 -or
      [string]$config.image -cnotmatch '^sha256:[a-f0-9]{64}$' -or
      (Get-FileHash -LiteralPath $PandasKeyPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne [string]$config.keySha256) {
    throw "pandas sandbox configuration or credential fingerprint is invalid"
  }
  return $config
}

function Invoke-PandasProbe([object]$Config, [bool]$SelfTest = $false) {
  $arguments = @("-B", "-m", "pandas_runner.probe", "--key-file", $PandasKeyPath, "--image", [string]$Config.image)
  if ($SelfTest) { $arguments += "--self-test" }
  $nativeRun = Invoke-BoundedNativeProcess $Python $arguments $BackendRoot
  return ConvertFrom-UniqueNativeJson $nativeRun "pandas signed readiness"
}

function Invoke-PandasSystemctl([string]$Verb) {
  if ($Verb -cnotin @("start", "stop")) { throw "invalid pandas lifecycle verb" }
  $nativeRun = Invoke-BoundedNativeProcess $Python @("-B", "-m", "pandas_runner.wsl_control", $Verb) $BackendRoot
  ConvertFrom-UniqueNativeJson $nativeRun "pandas Linux service lifecycle" | Out-Null
}

function Assert-PandasRotationBinding([object]$Binding, [bool]$Plan, [bool]$Owner) {
  if ([string]$Binding.preparedAppId -cnotmatch '^[a-f0-9]{32}$' -or
      [string]$Binding.preparedAppSha256 -cnotmatch '^[a-f0-9]{64}$' -or
      [string]$Binding.sourceCommit -cnotmatch '^[a-f0-9]{40}$' -or
      ($Plan -and [string]$Binding.registeredPlanSha256 -cnotmatch '^[a-f0-9]{64}$') -or
      ($Owner -and ([string]$Binding.maintenanceId -cnotmatch '^[a-f0-9]{32}$' -or
        ($Binding.publicationOwnerPid -isnot [int] -and $Binding.publicationOwnerPid -isnot [long]) -or
        $Binding.publicationOwnerPid -le 0))) { throw 'Invalid Pandas rotation binding' }
}

function Read-PandasRotationJson([string]$Path, [int]$MaxBytes = 8192) {
  $entry = Get-Item -LiteralPath (Assert-RuntimeChildPath $Path) -Force -ErrorAction Stop
  if ($entry.PSIsContainer -or $entry.Length -gt $MaxBytes -or
      ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Unsafe Pandas rotation receipt' }
  return Read-JsonFile $entry.FullName 'Pandas rotation receipt'
}

function Write-PandasRotationJson([string]$Path, [object]$Record) {
  $bytes = $Utf8NoBom.GetBytes(($Record | ConvertTo-Json -Depth 8 -Compress))
  if ($bytes.Length -gt 8192) { throw 'Pandas rotation receipt exceeds its bound' }
  $stream = [IO.File]::Open((Assert-RuntimeChildPath $Path), [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  try { $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true) }
  finally { $stream.Dispose() }
}

function Get-PandasRotationPath([string]$Plan, [string]$Suffix) {
  if ($Plan -cnotmatch '^[a-f0-9]{64}$' -or $Suffix -cnotin @('pending','startup-attempt','startup','complete')) {
    throw 'Invalid Pandas rotation record identity'
  }
  return Join-Path $RunDirectory ("pandas-rotation-" + $Plan + "." + $Suffix + ".json")
}

function Assert-SamePandasRotation([object]$Actual, [object]$Expected, [bool]$Owner) {
  $keys = @('preparedAppId','preparedAppSha256','registeredPlanSha256','sourceCommit')
  if ($Owner) { $keys += @('maintenanceId','publicationOwnerPid') }
  foreach ($key in $keys) {
    if ($Actual.$key -cne $Expected.$key) { throw 'Pandas rotation receipt belongs to another operation' }
  }
}

function Get-PendingPandasRotation {
  if (-not (Test-Path -LiteralPath $RunDirectory)) { return $null }
  $entries = @(Get-ChildItem -LiteralPath $RunDirectory -Filter 'pandas-rotation-*.pending.json' -Force)
  if ($entries.Count -gt 127) { throw 'Pandas rotation journal inventory exceeds its bound' }
  $pending = $null
  foreach ($entry in $entries) {
    $record = Read-PandasRotationJson $entry.FullName
    if (-not (Test-ExactObjectPropertyNames $record @('preparedAppId','preparedAppSha256','registeredPlanSha256','sourceCommit','maintenanceId','publicationOwnerPid'))) {
      throw 'Pandas rotation intent is malformed'
    }
    Assert-PandasRotationBinding $record $true $true
    if ($entry.FullName -cne (Get-PandasRotationPath $record.registeredPlanSha256 'pending')) { throw 'Pandas rotation intent filename mismatch' }
    $complete = Get-PandasRotationPath $record.registeredPlanSha256 'complete'
    if (Test-Path -LiteralPath $complete) {
      $result = Read-PandasRotationJson $complete
      Assert-SamePandasRotation $result $record $true
      $startup = Get-PandasRotationPath $record.registeredPlanSha256 'startup'
      $null = Read-PandasRotationJson $startup
      if ($result.status -cne 'ready_verified' -or $result.completed -cne $true -or $result.postconditionsVerified -cne $true -or
          [string]$result.intentSha256 -cnotmatch '^[a-f0-9]{64}$' -or
          (Get-FileSha256 $startup) -cne $result.startupReceiptSha256) { throw 'Pandas rotation completion is invalid' }
      continue
    }
    if ($null -ne $pending) { throw 'More than one Pandas rotation has an unresolved outcome' }
    $pending = $record
  }
  return $pending
}

function Assert-PandasInstalledBinding([object]$Binding) {
  $receiptPath = Join-Path $RuntimeRoot ('app.prepare-' + $Binding.preparedAppId + '.json')
  $receipt = Read-PandasRotationJson $receiptPath 4096
  if ((Get-FileSha256 $receiptPath) -cne $Binding.preparedAppSha256 -or
      -not (Test-ExactObjectPropertyNames $receipt @('version','id','runtimeRoot','predecessorManifestSha256','candidateManifestSha256')) -or
      $receipt.version -cne 'teruisi-django-prepared-app-v1' -or $receipt.id -cne $Binding.preparedAppId -or
      $receipt.runtimeRoot -ine (Get-CanonicalPath $RuntimeRoot) -or
      $receipt.candidateManifestSha256 -cne (Get-FileSha256 $DeploymentManifestPath)) {
    throw 'Pandas rotation requires the original prepared Django app to be installed'
  }
}

function Assert-PandasPublicationOwner([object]$Binding) {
  $lease = Read-PandasRotationJson (Join-Path $RunDirectory 'release-publication-lease.json')
  $owner = Get-Process -Id $Binding.publicationOwnerPid -ErrorAction Stop
  $created = [DateTimeOffset]::Parse([string]$lease.createdAt)
  $expires = [DateTimeOffset]::Parse([string]$lease.expiresAt)
  if ($lease.version -cne 'teruisi-release-publication-lease-v1' -or
      $lease.ownerPid -cne $Binding.publicationOwnerPid -or $lease.maintenanceId -cne $Binding.maintenanceId -or
      $lease.mainCommit -cne $Binding.sourceCommit -or $owner.ProcessName -cne 'node' -or
      [DateTimeOffset]$owner.StartTime -gt $created -or $expires -le [DateTimeOffset]::UtcNow) {
    throw 'Pandas rotation requires the original live publication owner'
  }
}

function Invoke-PandasRotationNative([string]$Verb, [string]$AppRoot, [object]$Binding, [object]$Config) {
  $arguments = @('-I', '-B', (Join-Path $AppRoot 'tools\pandas_broker_rotation.py'), $Verb,
    '--prepared-app-id', $Binding.preparedAppId, '--prepared-app-sha256', $Binding.preparedAppSha256,
    '--source-commit', $Binding.sourceCommit, '--windows-config-sha256', (Get-FileSha256 $PandasConfigPath),
    '--windows-key-sha256', (Get-FileSha256 $PandasKeyPath), '--image', [string]$Config.image)
  if ($Verb -cne 'prepare') { $arguments += @('--plan-sha256', $Binding.registeredPlanSha256) }
  if ($Verb -cnotin @('prepare','check')) {
    $arguments += @('--maintenance-id', $Binding.maintenanceId, '--publication-owner-pid', [string]$Binding.publicationOwnerPid)
  }
  $result = ConvertFrom-UniqueNativeJson (Invoke-BoundedNativeProcess $Python $arguments (Join-Path $AppRoot 'backend')) 'Pandas Broker rotation'
  if ($Verb -ceq 'prepare') {
    if ($result.preparedAppId -cne $Binding.preparedAppId -or $result.preparedAppSha256 -cne $Binding.preparedAppSha256 -or
        $result.sourceCommit -cne $Binding.sourceCommit) { throw 'Pandas preparation response binding mismatch' }
  } else {
    Assert-SamePandasRotation $result $Binding ($Verb -cne 'check')
  }
  if ($result.configured -cne $true -or $result.image -cne $Config.image -or
      [string]$result.registeredPlanSha256 -cnotmatch '^[a-f0-9]{64}$' -or
      [string]$result.sourceSha256 -cnotmatch '^[a-f0-9]{64}$' -or
      [string]$result.predecessorSourceSha256 -cnotmatch '^[a-f0-9]{64}$') {
    throw 'Pandas rotation result is not bound to the reviewed source and image'
  }
  return $result
}

function Invoke-PandasRotationPreparation([bool]$Check) {
  $binding = $RequestedPandasRotation
  Assert-PandasRotationBinding $binding $false $false
  if ((Get-CanonicalPath $ExecutionRoot) -ieq (Get-CanonicalPath $InstalledAppRoot)) {
    throw 'Pandas preparation requires the original frozen source controller'
  }
  $prepared = Get-ReviewedPreparedExecutionRoot $binding.preparedAppId $binding.preparedAppSha256
  if ($null -ne (Get-PendingPandasRotation)) { throw 'The original Pandas rotation is still unresolved' }
  $config = Read-PandasConfig
  if ($null -eq $config) {
    if ($binding.registeredPlanSha256) { throw 'Previously configured Pandas was removed after preparation' }
    $native = Invoke-BoundedNativeProcess $Python @('-B','-c','from pandas_runner.protocol import package_digest; print(package_digest())') (Join-Path $prepared 'backend')
    $source = [string](@($native.Output) -join '').Trim()
    if ($native.ExitCode -ne 0 -or $source -cnotmatch '^[a-f0-9]{64}$') { throw 'Invalid Pandas candidate source identity' }
    $result = [ordered]@{prepared=$true; started=$false; configured=$false; registeredPlanSha256=$null;
      sourceSha256=$source; preparedAppId=$binding.preparedAppId; preparedAppSha256=$binding.preparedAppSha256; sourceCommit=$binding.sourceCommit}
    if ($Check) { $result.checked = $true }
    return $result | ConvertTo-Json -Compress
  }
  if ($Check) { Assert-PandasRotationBinding $binding $true $false }
  $verb = if ($Check) { 'check' } else { 'prepare' }
  $result = Invoke-PandasRotationNative $verb $prepared $binding $config
  if ($result.prepared -cne $true -or $result.started -cne $false -or ($Check -and $result.checked -cne $true)) {
    throw 'Pandas preparation outcome is not verified'
  }
  return $result | ConvertTo-Json -Compress
}

function Invoke-PandasRotationSwitch {
  $binding = $RequestedPandasRotation
  Assert-PandasRotationBinding $binding $true $true
  Assert-AiRuntimeEntry
  Assert-PandasInstalledBinding $binding
  Assert-ProductionMaintenance 'SwitchPandasRotation'
  $maintenance = Read-SystemMaintenance
  if ($null -eq $maintenance -or $maintenance.id -cne $binding.maintenanceId) { throw 'Pandas maintenance identity changed' }
  Assert-PandasPublicationOwner $binding
  Assert-ApplicationDeploymentStopped 'SwitchPandasRotation'
  Assert-AiPortsFree 'SwitchPandasRotation'
  if ((Test-Path -LiteralPath $PandasPidPath) -or @(Get-PortListeners 8121).Count -ne 0) {
    throw 'Original Pandas stop and keepalive removal are not proved'
  }
  if ($null -ne (Get-PendingPandasRotation)) { throw 'The original Pandas rotation is still unresolved' }
  $config = Read-PandasConfig
  if ($null -eq $config) { throw 'Original Pandas configuration is missing' }
  Write-PandasRotationJson (Get-PandasRotationPath $binding.registeredPlanSha256 'pending') $binding
  $result = Invoke-PandasRotationNative 'switch' $InstalledAppRoot $binding $config
  if ($result.status -cne 'switched_stopped' -or $result.switched -cne $true -or $result.started -cne $false -or
      [string]$result.intentSha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'Pandas switch outcome is unknown' }
  return $result | ConvertTo-Json -Compress
}

function Complete-PandasRotation {
  $binding = $RequestedPandasRotation
  Assert-PandasRotationBinding $binding $true $true
  Assert-AiRuntimeEntry
  Assert-PandasInstalledBinding $binding
  $pending = Read-PandasRotationJson (Get-PandasRotationPath $binding.registeredPlanSha256 'pending')
  Assert-SamePandasRotation $pending $binding $true
  $config = Read-PandasConfig
  if ($null -eq $config) { throw 'Original Pandas configuration is missing' }
  $startup = Get-PandasRotationPath $binding.registeredPlanSha256 'startup'
  $null = Read-PandasRotationJson $startup
  $result = Invoke-PandasRotationNative 'complete' $InstalledAppRoot $binding $config
  if ($result.status -cne 'ready_verified' -or $result.completed -cne $true -or $result.postconditionsVerified -cne $true -or
      $result.startupReceiptSha256 -cne (Get-FileSha256 $startup)) { throw 'Pandas original startup is not proved' }
  $completion = Get-PandasRotationPath $binding.registeredPlanSha256 'complete'
  if (Test-Path -LiteralPath $completion) {
    $original = Read-PandasRotationJson $completion
    Assert-SamePandasRotation $original $result $true
    if ($original.startupReceiptSha256 -cne $result.startupReceiptSha256 -or $original.intentSha256 -cne $result.intentSha256 -or
        $original.status -cne 'ready_verified' -or $original.postconditionsVerified -cne $true -or $original.completed -cne $true) {
      throw 'Original Windows Pandas completion receipt changed'
    }
  } else { Write-PandasRotationJson $completion $result }
  return $result | ConvertTo-Json -Compress
}

function Start-PandasSandbox {
  $startupPhaseClock = [Diagnostics.Stopwatch]::StartNew()
  $startupPhaseAt = [DateTimeOffset]::UtcNow.ToString('o')
  $startupPhaseOutcome = 'completed'
  try {
  $config = Read-PandasConfig
  $pending = Get-PendingPandasRotation
  if ($null -eq $config) {
    if ($null -ne $pending) { throw 'Pending Pandas rotation lost its configuration' }
    return $false
  }
  $fingerprint = Get-Sha256Text ((Get-ConfigFingerprint "ai-pandas-wsl" $PandasWsl $PandasKeepaliveArguments) +
    (Get-FileHash -LiteralPath $PandasConfigPath -Algorithm SHA256).Hash)
  if (Resolve-OwnedProcess "ai-pandas-wsl" $PandasPidPath $PandasWsl $PandasKeepaliveArguments $fingerprint) {
    if ($null -ne $pending -and -not (Test-Path -LiteralPath (Get-PandasRotationPath $pending.registeredPlanSha256 'startup') -PathType Leaf)) {
      throw 'Original Pandas startup outcome is unknown; preserve its attempt'
    }
    Invoke-PandasProbe $config | Out-Null
    return $false
  }
  $switched = $null
  if ($null -ne $pending) {
    Assert-PandasInstalledBinding $pending
    Assert-PandasPublicationOwner $pending
    $switched = Invoke-PandasRotationNative 'startup-check' $InstalledAppRoot $pending $config
    Write-PandasRotationJson (Get-PandasRotationPath $pending.registeredPlanSha256 'startup-attempt') $switched
  }
  $previousWslEnv = [Environment]::GetEnvironmentVariable("WSLENV", "Process")
  try {
    $env:WSLENV = ""
    Start-ManagedProcess "ai-pandas-wsl" $PandasWsl $PandasKeepaliveArguments $BackendRoot $PandasPidPath $fingerprint `
      (Join-Path $LogDirectory "ai-pandas-wsl.$RunId.stdout.log") (Join-Path $LogDirectory "ai-pandas-wsl.$RunId.stderr.log") | Out-Null
    Invoke-PandasSystemctl "start"
    $before = if ($null -ne $pending) { Invoke-PandasRotationNative 'identity' $InstalledAppRoot $pending $config }
    $signedStatus = Invoke-PandasProbe $config
    $signedSelfTest = Invoke-PandasProbe $config $true
    if ($null -ne $pending) {
      $after = Invoke-PandasRotationNative 'identity' $InstalledAppRoot $pending $config
      if ($before.intentSha256 -cne $switched.intentSha256 -or $after.intentSha256 -cne $switched.intentSha256 -or
          $before.processIdentity.pid -ne $after.processIdentity.pid -or
          $before.processIdentity.invocationId -cne $after.processIdentity.invocationId -or
          $before.processIdentity.startTicks -cne $after.processIdentity.startTicks) {
        throw 'Pandas broker changed during the original signed startup'
      }
      $startup = [ordered]@{version=1; switch=$switched; processIdentity=$before.processIdentity; signedStatus=$signedStatus;
        signedSelfTest=$signedSelfTest; applicationManifestSha256=(Get-FileSha256 $DeploymentManifestPath)}
      Write-PandasRotationJson (Get-PandasRotationPath $pending.registeredPlanSha256 'startup') $startup
    }
    return $true
  } catch {
    # Preserve uncertain Linux state for inspection; never retry an unknown job.
    throw
  } finally { [Environment]::SetEnvironmentVariable("WSLENV", $previousWslEnv, "Process") }
  } catch {
    $startupPhaseOutcome = 'failed'
    throw
  } finally {
    try { Write-DjangoStartupTiming 'Start-PandasSandbox' $startupPhaseAt $startupPhaseClock.ElapsedMilliseconds $startupPhaseOutcome } catch { }
  }
}

function Stop-PandasSandbox {
  if ($null -eq (Read-PandasConfig)) { return }
  Invoke-PandasSystemctl "stop"
  Stop-OwnedProcess "ai-pandas-wsl" $PandasPidPath $PandasWsl
}

function Configure-PandasSandbox {
  Assert-AiRuntimeEntry
  Assert-AiPortsFree "ConfigurePandas"
  if ($null -ne (Read-PandasConfig)) { throw "pandas is already configured; rotation requires a reviewed forward deployment" }
  if ($RequestedPandasImage -cnotmatch '^sha256:[a-f0-9]{64}$') { throw "exact pandas image ID required" }
  $source = "D:\teruisi-runtime\pandas-sandbox\channel.dpapi.json"
  $item = Get-Item -LiteralPath $source
  if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "invalid pandas key source" }
  Copy-Item -LiteralPath $source -Destination $PandasKeyPath
  $config = [ordered]@{ version = 1; image = $RequestedPandasImage; keySha256 = (Get-FileHash -LiteralPath $PandasKeyPath -Algorithm SHA256).Hash.ToLowerInvariant() }
  Set-RuntimeAcl
  Invoke-PandasProbe ([pscustomobject]$config) | Out-Null
  Invoke-PandasProbe ([pscustomobject]$config) $true | Out-Null
  Write-AtomicJson $PandasConfigPath $config
  Set-RuntimeAcl
  Write-Output "pandas sandbox configured with signed probe and synthetic calculation verified"
}

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
  if (@(Get-PortListeners $NativePorts[8111]).Count -gt 0 -or @(Get-PortListeners $NativePorts[8112]).Count -gt 0) {
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
  $startupPhaseClock = [Diagnostics.Stopwatch]::StartNew()
  $startupPhaseAt = [DateTimeOffset]::UtcNow.ToString('o')
  $startupPhaseOutcome = 'completed'
  try {
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
  } catch {
    $startupPhaseOutcome = 'failed'
    throw
  } finally {
    try { Write-DjangoStartupTiming 'Get-AiWriteAuthority' $startupPhaseAt $startupPhaseClock.ElapsedMilliseconds $startupPhaseOutcome } catch { }
  }
}


function Invoke-WithAiEnvironment(
  [object]$RuntimeSecrets, [object]$AiSecrets, [string]$DatabaseUrl,
  [string]$Role, [bool]$ReadOnly, [int]$BodyBytes, [object]$Authority, [scriptblock]$AiOperation
) {
  Invoke-WithDjangoEnvironment $RuntimeSecrets $DatabaseUrl $Role $ReadOnly $BodyBytes ([string]$Authority.authorityEpoch) ([string]$Authority.cutoverId) {
    $env:AI_SECRET_ENCRYPTION_KEY = if ($Role -ceq "ai_writer") { $AiSecrets.ModelEncryptionKey } else { "" }
    $env:AI_MODEL_ENDPOINT_ORIGIN_ALLOWLIST = $AiSecrets.ModelOriginAllowlist
    $env:TERUISI_DJANGO_AI_EDGE_BASE_URL = "http://127.0.0.1:$($NativePorts[3000])"
    if ($Role -ceq "ai_writer") {
      $env:TERUISI_PI_REPORT_DINGTALK_CONFIG = ""
      $env:TERUISI_DINGTALK_BOT_CREDENTIALS = ""
      $piReportConfig = Join-Path $RuntimeRoot "config\dingtalk-ask.json"
      $piReportCredentials = Join-Path $RuntimeRoot "secrets\dingtalk-bot.dpapi.json"
      if ((Test-Path -LiteralPath $piReportConfig -PathType Leaf) -and (Test-Path -LiteralPath $piReportCredentials -PathType Leaf)) {
        $env:TERUISI_PI_REPORT_DINGTALK_CONFIG = $piReportConfig
        $env:TERUISI_DINGTALK_BOT_CREDENTIALS = $piReportCredentials
      }
      $env:PI_RUNNER_HMAC_SECRET = ""
      $env:PI_RUNNER_HMAC_KEY_FILE = ""
      $env:PI_SKILL_VERSION = ""
      $env:PI_GATEWAY_URL = ""
      $pi = Read-PiConfig
      if ($null -ne $pi) {
        $env:PI_RUNNER_HMAC_KEY_FILE = $PiKeyPath
        $env:PI_SKILL_VERSION = [string]$pi.skillVersion
        $env:PI_GATEWAY_URL = "http://127.0.0.1:$($NativePorts[8112])/api/ai/pi/gateway"
      }
      $pandas = Read-PandasConfig
      if ($null -ne $pandas) {
        $env:TERUISI_PANDAS_RUNNER_KEY_FILE = $PandasKeyPath
        $env:TERUISI_PANDAS_RUNNER_IMAGE = [string]$pandas.image
      }
    }
    & $AiOperation
  }
}

function Start-AiReader([object]$RuntimeSecrets, [object]$AiSecrets, [object]$Authority, [switch]$DeferReady) {
  $arguments = @(
    "--listen=127.0.0.1:$($NativePorts[8111])", "--threads=2", "--connection-limit=30", "--channel-timeout=35",
    "--cleanup-interval=30", "--ident=teruisi-django-ai-reader",
    "--max-request-header-size=$MaxHeaderBytes", "--max-request-body-size=$AiReaderMaxBodyBytes",
    "--no-expose-tracebacks", "teruisi_backend.wsgi:application"
  )
  $fingerprint = Get-Sha256Text ((Get-ConfigFingerprint "django-ai-reader" $Waitress $arguments) + (Get-FileHash -LiteralPath $AiCredentialPath -Algorithm SHA256).Hash + [string]$Authority.authorityEpoch + [string]$Authority.cutoverId)
  if (Resolve-OwnedProcess "django-ai-reader" $AiReaderPidPath $Waitress $arguments $fingerprint) {
    Wait-DjangoReady "ai-reader" $AiReaderHealthUrl "127.0.0.1:$($NativePorts[8111])"; return $false
  }
  if (@(Get-PortListeners $NativePorts[8111]).Count -gt 0) { throw "端口 8111 被非本部署服务占用" }
  Remove-OldServiceLogs "django-ai-reader"
  $readerUrl = Database-Url "teruisi_ai_reader" $AiSecrets.ReaderPassword "teruisi_ai_read" $ReaderStatementTimeoutMs
  Invoke-WithAiEnvironment $RuntimeSecrets $AiSecrets $readerUrl "ai_reader" $true $AiReaderMaxBodyBytes $Authority {
    Start-ManagedProcess "django-ai-reader" $Waitress $arguments $BackendRoot $AiReaderPidPath $fingerprint `
      (Join-Path $LogDirectory "django-ai-reader.$RunId.stdout.log") (Join-Path $LogDirectory "django-ai-reader.$RunId.stderr.log") | Out-Null
  }
  $readerUrl = $null
  # The stack owns rollback after launch; its final readiness barrier remains mandatory.
  if ($DeferReady) { return $true }
  try { Wait-DjangoReady "ai-reader" $AiReaderHealthUrl "127.0.0.1:$($NativePorts[8111])"; return $true }
  catch { Stop-OwnedProcess "django-ai-reader" $AiReaderPidPath $Waitress; throw }
}

function Start-AiWriter([object]$RuntimeSecrets, [object]$AiSecrets, [object]$Authority, [switch]$DeferReady) {
  if ([string]$Authority.status -cne "postgres") { throw "PostgreSQL 尚未成为AI 助理唯一写入源；拒绝启动AI 助理 writer" }
  $arguments = @(
    "--listen=127.0.0.1:$($NativePorts[8112])", "--threads=6", "--connection-limit=30", "--channel-timeout=320",
    "--cleanup-interval=30", "--ident=teruisi-django-ai-writer",
    "--max-request-header-size=$MaxHeaderBytes", "--max-request-body-size=$AiWriterMaxBodyBytes",
    "--no-expose-tracebacks", "teruisi_backend.wsgi:application"
  )
  $fingerprint = Get-Sha256Text ((Get-ConfigFingerprint "django-ai-writer" $Waitress $arguments) + (Get-FileHash -LiteralPath $AiCredentialPath -Algorithm SHA256).Hash + [string]$Authority.authorityEpoch + [string]$Authority.cutoverId)
  if ($null -ne (Read-PandasConfig)) { $fingerprint = Get-Sha256Text ($fingerprint + (Get-FileHash -LiteralPath $PandasConfigPath -Algorithm SHA256).Hash) }
  if ($null -ne (Read-PiConfig)) { $fingerprint = Get-Sha256Text ($fingerprint + (Get-FileSha256 $PiConfigPath) + (Get-FileSha256 $PiKeyPath)) }
  if (Resolve-OwnedProcess "django-ai-writer" $AiWriterPidPath $Waitress $arguments $fingerprint) {
    Wait-DjangoReady "ai-writer" $AiWriterHealthUrl "127.0.0.1:$($NativePorts[8112])"; return $false
  }
  if (@(Get-PortListeners $NativePorts[8112]).Count -gt 0) { throw "端口 8112 被非本部署服务占用" }
  Remove-OldServiceLogs "django-ai-writer"
  $writerUrl = Database-Url "teruisi_ai_writer" $AiSecrets.WriterPassword "teruisi_ai_write" $WriterStatementTimeoutMs
  Invoke-WithAiEnvironment $RuntimeSecrets $AiSecrets $writerUrl "ai_writer" $false $AiWriterMaxBodyBytes $Authority {
    Start-ManagedProcess "django-ai-writer" $Waitress $arguments $BackendRoot $AiWriterPidPath $fingerprint `
      (Join-Path $LogDirectory "django-ai-writer.$RunId.stdout.log") (Join-Path $LogDirectory "django-ai-writer.$RunId.stderr.log") | Out-Null
  }
  $writerUrl = $null
  # The stack owns new-process rollback and the final readiness barrier.
  if ($DeferReady) { return $true }
  try { Wait-DjangoReady "ai-writer" $AiWriterHealthUrl "127.0.0.1:$($NativePorts[8112])"; return $true }
  catch { Stop-OwnedProcess "django-ai-writer" $AiWriterPidPath $Waitress; throw }
}

function Start-AiStack([string]$LifecycleAclToken = "") {
  $startupPhaseClock = [Diagnostics.Stopwatch]::StartNew()
  $startupPhaseAt = [DateTimeOffset]::UtcNow.ToString('o')
  $startupPhaseOutcome = 'completed'
  try {
  Assert-AiRuntimeEntry $LifecycleAclToken
  Assert-PostgresListenerOwnership | Out-Null
  if (-not (Test-PostgresReady)) { throw "PostgreSQL 未就绪；拒绝启动AI 助理服务" }
  New-Item -ItemType Directory -Path $LogDirectory, $RunDirectory -Force | Out-Null
  $runtimeSecrets = Read-Secrets; $aiSecrets = Read-AiCredentials
  $readerStarted = $false; $writerStarted = $false; $piStarted = $false
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
    Start-PandasSandbox | Out-Null
    $readerStarted = Start-AiReader $runtimeSecrets $aiSecrets $authority -DeferReady
    $writerStarted = Start-AiWriter $runtimeSecrets $aiSecrets $authority -DeferReady
    Wait-DjangoReady "ai-reader" $AiReaderHealthUrl "127.0.0.1:$($NativePorts[8111])"
    Wait-DjangoReady "ai-writer" $AiWriterHealthUrl "127.0.0.1:$($NativePorts[8112])"
    $piStarted = Start-PiRuntime $runtimeSecrets $aiSecrets $authority
    Write-Output "Django AI 助理服务已就绪：reader=http://127.0.0.1:$($NativePorts[8111]) writer=http://127.0.0.1:$($NativePorts[8112])。"
  } catch {
    $original = $_.Exception
    if ($piStarted) { try { Stop-PiRuntime } catch {} }
    if ($writerStarted) { try { Stop-OwnedProcess "django-ai-writer" $AiWriterPidPath $Waitress } catch {} }
    if ($readerStarted) { try { Stop-OwnedProcess "django-ai-reader" $AiReaderPidPath $Waitress } catch {} }
    throw $original
  } finally { $runtimeSecrets = $null; $aiSecrets = $null }
  } catch {
    $startupPhaseOutcome = 'failed'
    throw
  } finally {
    try { Write-DjangoStartupTiming 'Start-AiStack' $startupPhaseAt $startupPhaseClock.ElapsedMilliseconds $startupPhaseOutcome } catch { }
  }
}

function Stop-AiStack([string]$LifecycleAclToken = "") {
  Assert-AiRuntimeEntry $LifecycleAclToken
  Stop-PiRuntime
  Stop-OwnedProcess "django-ai-dingtalk-schedule" $DingTalkSchedulePidPath $Python
  Stop-OwnedProcess "django-ai-dingtalk" $DingTalkPidPath $Python
  Stop-OwnedProcess "django-ai-writer" $AiWriterPidPath $Waitress
  Stop-OwnedProcess "django-ai-reader" $AiReaderPidPath $Waitress
  Stop-PandasSandbox
  Write-Output "Django AI 助理 reader/writer 已停止；其他业务域、ERP 与 PostgreSQL 未改变。"
}

function Read-DingTalkStartup {
  if (-not (Test-Path -LiteralPath $DingTalkStartupPath)) { return $false }
  $state = Read-JsonFile $DingTalkStartupPath "DingTalk automatic startup"
  if (-not (Test-ExactObjectPropertyNames $state @("version", "enabled", "configSha256", "authorityEpoch", "cutoverId")) -or
      ($state.version -isnot [int] -and $state.version -isnot [long]) -or
      $state.version -ne 1 -or $state.enabled -isnot [bool]) { throw "Invalid DingTalk automatic startup configuration" }
  if (-not $state.enabled) { return $false }
  $aiStartup = Read-JsonFile $AiStartupPath "AI startup authority"
  if ([string]$state.configSha256 -cnotmatch '^[a-f0-9]{64}$' -or
      (Get-FileSha256 $DingTalkConfigPath) -cne [string]$state.configSha256 -or
      [string]::IsNullOrWhiteSpace([string]$state.authorityEpoch) -or
      [string]::IsNullOrWhiteSpace([string]$state.cutoverId) -or
      [string]$aiStartup.authorityEpoch -cne [string]$state.authorityEpoch -or
      [string]$aiStartup.cutoverId -cne [string]$state.cutoverId) {
    throw "DingTalk automatic startup approval no longer matches configuration or authority"
  }
  return $true
}

function Set-DingTalkStartup([bool]$Enabled) {
  Assert-AiRuntimeEntry
  $configSha = ""; $epoch = ""; $cutover = ""
  if ($Enabled) {
    $config = Read-JsonFile $DingTalkConfigPath "DingTalk receiver configuration"
    if ($config.enabled -isnot [bool] -or -not $config.enabled) { throw "Enable the approved receiver configuration first" }
    $aiStartup = Read-JsonFile $AiStartupPath "AI startup authority"
    if ([string]::IsNullOrWhiteSpace([string]$aiStartup.authorityEpoch) -or [string]::IsNullOrWhiteSpace([string]$aiStartup.cutoverId)) {
      throw "AI startup authority is invalid"
    }
    # Existing operator verifies live PostgreSQL authority, bindings and DWS identity without sending.
    $configSha = Get-FileSha256 $DingTalkConfigPath
    Invoke-DingTalkReceiver $true ([pscustomobject]@{
      configSha256 = $configSha; authorityEpoch = [string]$aiStartup.authorityEpoch; cutoverId = [string]$aiStartup.cutoverId
    }) | Out-Null
    if ((Get-FileSha256 $DingTalkConfigPath) -cne $configSha) { throw "Receiver configuration changed during verification" }
    $epoch = [string]$aiStartup.authorityEpoch; $cutover = [string]$aiStartup.cutoverId
  }
  Write-AtomicJson $DingTalkStartupPath ([ordered]@{
    version = 1; enabled = $Enabled; configSha256 = $configSha; authorityEpoch = $epoch; cutoverId = $cutover
  })
  Write-LauncherEvent "INFO" "dingtalk_automatic_startup_changed" "enabled=$Enabled"
}

function Start-ConfiguredDingTalkReceiver {
  # Invoked after the single system startup engine has made the Worker and all backends ready.
  # Both the setting and process check run under the same service mutex as manual StopDingTalk.
  Assert-AiRuntimeEntry
  if (-not (Read-DingTalkStartup)) {
    Write-Output "DingTalk automatic startup is disabled."
    return
  }
  $previousContextVariable = Get-Variable -Scope Global -Name $OrchestratedLifecycleAclContextVariable -ErrorAction SilentlyContinue
  $hadPreviousContext = $null -ne $previousContextVariable
  $previousContext = if ($hadPreviousContext) { $previousContextVariable.Value } else { $null }
  try {
    # The full entry check above completed under the service mutex. Only these
    # two children may reuse its existing same-process, manifest-bound proof.
    $lifecycleAclToken = New-OrchestratedLifecycleAclToken
    Set-OrchestratedLifecycleAclContext $lifecycleAclToken
    Start-DingTalkWorkers (Read-JsonFile $DingTalkStartupPath "DingTalk automatic startup") -LifecycleAclToken $lifecycleAclToken
  } finally {
    if ($hadPreviousContext) {
      Set-Variable -Scope Global -Name $OrchestratedLifecycleAclContextVariable -Value $previousContext -Force
    } else {
      Remove-Variable -Scope Global -Name $OrchestratedLifecycleAclContextVariable -ErrorAction SilentlyContinue
    }
  }
}

function Assert-DingTalkScreenshotProfile {
  $expected = [IO.Path]::GetFullPath("$RuntimeRoot-screenshot-profile")
  if ([IO.Path]::GetFullPath($DingTalkScreenshotRoot) -cne $expected -or
      [IO.Path]::GetFullPath($DingTalkScreenshotProfile) -cne [IO.Path]::GetFullPath((Join-Path $expected "Chrome"))) {
    throw "定时截图目录未绑定独立受保护路径"
  }
  $allowed = @(
    "S-1-5-18", "S-1-5-32-544",
    [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  )
  $tolerated = @()
  foreach ($entry in @(
      @{ path = $DingTalkScreenshotRoot; root = $true },
      @{ path = $DingTalkScreenshotProfile; root = $false }
    )) {
    $item = Get-Item -LiteralPath $entry.path -Force -ErrorAction Stop
    if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
      throw "定时截图目录不是受控实体目录"
    }
    $acl = Get-Acl -LiteralPath $entry.path
    $rules = @($acl.Access)
    if ($acl.AreAccessRulesProtected -cne [bool]$entry.root -or $rules.Count -lt 3) {
      throw "定时截图目录 ACL 不符合受保护契约"
    }
    $seen = @()
    foreach ($rule in $rules) {
      $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
      if ($sid -in $allowed) {
        if ($sid -in $seen -or
            $rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or
            ([int]$rule.FileSystemRights -band [int][Security.AccessControl.FileSystemRights]::FullControl) -ne [int][Security.AccessControl.FileSystemRights]::FullControl -or
            $rule.IsInherited -eq [bool]$entry.root) {
          throw "定时截图目录 ACL 包含未授权主体或权限"
        }
        $seen += $sid
      } elseif (Test-AppContainerReadOnlyAce $rule $sid) {
        $tolerated += "$($entry.path)=$sid"
      } else {
        throw "定时截图目录 ACL 包含未授权主体或权限"
      }
    }
    if ($seen.Count -ne $allowed.Count) { throw "定时截图目录 ACL 缺少必需条目" }
  }
  if ($tolerated.Count -gt 0) {
    $note = "已放过 AppContainer 只读 ACE: " + ($tolerated -join "; ")
    Write-LauncherEvent "WARN" "dingtalk_screenshot_acl_appcontainer_readonly_tolerated" $note
    Write-Warning $note
  }
}

function Test-AppContainerReadOnlyAce([object]$Rule, [string]$Sid) {
  # Kiro's Windows sandbox (AppContainer, SID S-1-15-2-*) adds read-only ACEs to directories it
  # merely reads. Tolerate exactly that shape and nothing else: Allow + read/execute bits only.
  # Judged by bit mask (never by rights name); Deny, any write/delete/permission/owner bit,
  # generic or unknown bits, and every non-AppContainer principal stay rejected.
  # The SID must be a full AppContainer package SID (S-1-15-2- + exactly seven decimal
  # sub-authorities); the shorter capability-style SIDs (e.g. S-1-15-2-1) are rejected.
  $readOnlyMask = [int][Security.AccessControl.FileSystemRights]::ReadData -bor
    [int][Security.AccessControl.FileSystemRights]::ReadExtendedAttributes -bor
    [int][Security.AccessControl.FileSystemRights]::ExecuteFile -bor
    [int][Security.AccessControl.FileSystemRights]::ReadAttributes -bor
    [int][Security.AccessControl.FileSystemRights]::ReadPermissions -bor
    [int][Security.AccessControl.FileSystemRights]::Synchronize
  if ($Sid -cnotmatch '^S-1-15-2-\d+(-\d+){6}$' -or
      $Rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow) { return $false }
  $rights = [int]$Rule.FileSystemRights
  return ($rights -ne 0 -and ($rights -band (-bnot $readOnlyMask)) -eq 0)
}

function Start-DingTalkWorkers([object]$StartupApproval = $null, [string]$LifecycleAclToken = "") {
  # Start schedules first: an unavailable Stream SDK/connection cannot stop dispatch.
  Invoke-DingTalkReceiver $false $StartupApproval -Schedules -LifecycleAclToken $LifecycleAclToken
  Invoke-DingTalkReceiver $false $StartupApproval -LifecycleAclToken $LifecycleAclToken
}

function Configure-DingTalkBotCredentials {
  Assert-AiRuntimeEntry
  Assert-PostgresListenerOwnership | Out-Null
  if (-not (Test-PostgresReady)) { throw "PostgreSQL is not ready" }
  $runtimeSecrets = Read-Secrets; $aiSecrets = Read-AiCredentials
  try {
    $authority = Get-AiWriteAuthority $runtimeSecrets $aiSecrets
    if ([string]$authority.status -cne "postgres") { throw "AI authority is not active" }
    $url = Database-Url "teruisi_ai_writer" $aiSecrets.WriterPassword "teruisi_bot_provision" $WriterStatementTimeoutMs
    Invoke-WithAiEnvironment $runtimeSecrets $aiSecrets $url "ai_writer" $false $AiWriterMaxBodyBytes $authority {
      $nativeRun = Invoke-BoundedNativeProcess $Python @("-B", (Join-Path $BackendRoot "manage.py"),
        "dingtalk_bot_credentials", "--config", $DingTalkConfigPath, "--output", $DingTalkBotCredentialPath, "--provision") $BackendRoot
      ConvertFrom-UniqueNativeJson $nativeRun "Enterprise bot credential adoption" | ConvertTo-Json -Compress
    }
    Set-RuntimeAcl
  } finally { $runtimeSecrets = $null; $aiSecrets = $null; $url = $null }
}

function Invoke-DingTalkReceiver([bool]$CheckOnly, [object]$StartupApproval = $null, [switch]$Schedules, [string]$LifecycleAclToken = "") {
  Assert-AiRuntimeEntry $LifecycleAclToken
  Assert-PostgresListenerOwnership | Out-Null
  if (-not (Test-PostgresReady)) { throw "PostgreSQL 未就绪" }
  $config = Read-JsonFile $DingTalkConfigPath "钉钉只读问数配置"
  if (-not $CheckOnly -and $config.enabled -cne $true) { throw "钉钉问数配置未显式启用" }
  $runtimeSecrets = Read-Secrets; $aiSecrets = Read-AiCredentials
  try {
    $authority = Get-AiWriteAuthority $runtimeSecrets $aiSecrets
    if ([string]$authority.status -cne "postgres") { throw "AI 写入权威未激活" }
    if ($null -ne $StartupApproval -and (
        [string]$StartupApproval.authorityEpoch -cne [string]$authority.authorityEpoch -or
        [string]$StartupApproval.cutoverId -cne [string]$authority.cutoverId -or
        [string]$StartupApproval.configSha256 -cne (Get-FileSha256 $DingTalkConfigPath))) {
      throw "DingTalk startup approval differs from live authority or receiver configuration"
    }
    $url = Database-Url "teruisi_ai_writer" $aiSecrets.WriterPassword "teruisi_ai_dingtalk" $WriterStatementTimeoutMs
    $serviceName = if ($Schedules) { "django-ai-dingtalk-schedule" } else { "django-ai-dingtalk" }
    $pidFile = if ($Schedules) { $DingTalkSchedulePidPath } else { $DingTalkPidPath }
    $command = if ($Schedules) { "dingtalk_schedule" } else { "dingtalk_ask" }
    if (-not (Test-Path -LiteralPath $DingTalkBotCredentialPath -PathType Leaf)) { throw "Enterprise bot credentials have not been adopted" }
    $credentialHash = Get-FileSha256 $DingTalkBotCredentialPath
    $arguments = @("-u", (Join-Path $BackendRoot "manage.py"), $command, "--config", $DingTalkConfigPath,
      "--bot-credentials", $DingTalkBotCredentialPath)
    if ($Schedules -and $DingTalkScreenshotProfile -and (Test-Path -LiteralPath $DingTalkScreenshotProfile -PathType Container)) {
      Assert-DingTalkScreenshotProfile
      $arguments += @("--screenshot-profile", $DingTalkScreenshotProfile)
    }
    if ($CheckOnly) {
      $arguments += "--check"
      Invoke-WithAiEnvironment $runtimeSecrets $aiSecrets $url "ai_writer" $false $AiWriterMaxBodyBytes $authority {
        $nativeRun = Invoke-BoundedNativeProcess $Python $arguments $BackendRoot
        ConvertFrom-UniqueNativeJson $nativeRun "钉钉配置只读核验" | ConvertTo-Json -Compress
      }
      return
    }
    Wait-DjangoReady "ai-writer" $AiWriterHealthUrl "127.0.0.1:$($NativePorts[8112])"
    if (-not $Schedules) {
      Invoke-WithAiEnvironment $runtimeSecrets $aiSecrets $url "ai_writer" $false $AiWriterMaxBodyBytes $authority {
        Invoke-BoundedNativeProcess $Python @("-c", "import dingtalk_stream, websockets; print('receiver_dependencies_available')") $BackendRoot | Out-Null
      }
    }
    $fingerprint = Get-Sha256Text ((Get-ConfigFingerprint $serviceName $Python $arguments) + (Get-FileHash -LiteralPath $DingTalkConfigPath -Algorithm SHA256).Hash + $credentialHash + [string]$authority.authorityEpoch + [string]$authority.cutoverId)
    if (Resolve-OwnedProcess $serviceName $pidFile $Python $arguments $fingerprint) {
      Write-Output "$serviceName already running."; return
    }
    Invoke-WithAiEnvironment $runtimeSecrets $aiSecrets $url "ai_writer" $false $AiWriterMaxBodyBytes $authority {
      Start-ManagedProcess $serviceName $Python $arguments $BackendRoot $pidFile $fingerprint `
        (Join-Path $LogDirectory "$serviceName.$RunId.stdout.log") (Join-Path $LogDirectory "$serviceName.$RunId.stderr.log") | Out-Null
    }
    Write-Output "$serviceName started; delivery acceptance must be verified separately."
  } finally { $runtimeSecrets = $null; $aiSecrets = $null; $url = $null }
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

function Get-DingTalkConnectionState([string]$ReceiverRunId) {
  if ($ReceiverRunId -cnotmatch '^[A-Za-z0-9-]{1,128}$') { return "unknown" }
  $stdoutPath = Join-Path $LogDirectory "django-ai-dingtalk.$ReceiverRunId.stdout.log"
  if (-not (Test-Path -LiteralPath $stdoutPath -PathType Leaf)) { return "starting" }
  $state = "starting"
  foreach ($line in @(Get-Content -LiteralPath $stdoutPath -Tail 200 -Encoding UTF8 -ErrorAction Stop)) {
    try { $entry = $line | ConvertFrom-Json -ErrorAction Stop } catch { continue }
    if ([string]$entry.status -cin @("starting", "connected", "recovering", "stopped")) {
      $state = [string]$entry.status
    }
  }
  return $state
}

function Show-AiStatus {
  $reader = "stopped"; $writer = "stopped"
  try { if (Resolve-OwnedProcess "django-ai-reader" $AiReaderPidPath $Waitress) { $reader = "running" } elseif (@(Get-PortListeners $NativePorts[8111]).Count -gt 0) { $reader = "foreign_port_owner" } } catch { $reader = "ownership_error" }
  try { if (Resolve-OwnedProcess "django-ai-writer" $AiWriterPidPath $Waitress) { $writer = "running" } elseif (@(Get-PortListeners $NativePorts[8112]).Count -gt 0) { $writer = "foreign_port_owner" } } catch { $writer = "ownership_error" }
  $readerReady = "not_ready"; $writerReady = "not_ready"
  try { if ((Invoke-WebRequest -UseBasicParsing -Uri $AiReaderHealthUrl -TimeoutSec 2 -Headers @{ Host = "127.0.0.1:$($NativePorts[8111])" }).StatusCode -eq 200) { $readerReady = "ready" } } catch {}
  try { if ((Invoke-WebRequest -UseBasicParsing -Uri $AiWriterHealthUrl -TimeoutSec 2 -Headers @{ Host = "127.0.0.1:$($NativePorts[8112])" }).StatusCode -eq 200) { $writerReady = "ready" } } catch {}
  $pandasReady = "disabled"
  try {
    $pandas = Read-PandasConfig
    if ($null -ne $pandas) { Invoke-PandasProbe $pandas | Out-Null; $pandasReady = "ready" }
  } catch { $pandasReady = "not_ready"; $writerReady = "not_ready" }
  $status = [pscustomobject][ordered]@{ AiReader = $reader; AiWriter = $writer; ReaderReadiness = $readerReady; WriterReadiness = $writerReady; CheckedAt = [DateTimeOffset]::UtcNow.ToString("o") }
  $status | Add-Member -NotePropertyName PandasReadiness -NotePropertyValue $pandasReady
  $piProcess = "stopped"; $piReady = "disabled"
  try {
    if ($null -ne (Read-PiConfig)) { $piReady = "not_ready"; Invoke-PiLifecycle "probe" | Out-Null; $piReady = "ready" }
    if (Resolve-OwnedProcess "django-ai-pi-worker" $PiWorkerPidPath $Python) { $piProcess = "running" }
  } catch { $piProcess = "ownership_error"; $piReady = "not_ready" }
  $status | Add-Member -NotePropertyName PiWorker -NotePropertyValue $piProcess
  $status | Add-Member -NotePropertyName PiRunnerReadiness -NotePropertyValue $piReady
  $dingStartup = "disabled"; $dingProcess = "stopped"; $dingConnection = "stopped"
  try { if (Read-DingTalkStartup) { $dingStartup = "enabled" } } catch { $dingStartup = "invalid" }
  try {
    if (Resolve-OwnedProcess "django-ai-dingtalk" $DingTalkPidPath $Python) {
      $dingProcess = "running"
      $receipt = Read-JsonFile $DingTalkPidPath "DingTalk receiver process"
      $dingConnection = Get-DingTalkConnectionState ([string]$receipt.runId)
    }
  } catch { $dingProcess = "ownership_error"; $dingConnection = "unknown" }
  $dingSchedule = "stopped"
  try { if (Resolve-OwnedProcess "django-ai-dingtalk-schedule" $DingTalkSchedulePidPath $Python) { $dingSchedule = "running" } } catch { $dingSchedule = "ownership_error" }
  $status | Add-Member -NotePropertyName DingTalkScheduler -NotePropertyValue $dingSchedule
  $status | Add-Member -NotePropertyName DingTalkStartup -NotePropertyValue $dingStartup
  $status | Add-Member -NotePropertyName DingTalkReceiver -NotePropertyValue $dingProcess
  $status | Add-Member -NotePropertyName DingTalkConnection -NotePropertyValue $dingConnection
  if ($RequestedJson) { Write-Output ($status | ConvertTo-Json -Compress) } else { $status | Format-List }
}

try {
  switch ($Action) {
    "ConfigureCredentials" { Invoke-WithServiceMutex { Configure-AiCredentials } }
    "ConfigureDingTalkBotCredentials" { Invoke-WithServiceMutex { Configure-DingTalkBotCredentials } }
    "ConfigurePandas" { Invoke-WithServiceMutex { Configure-PandasSandbox } }
    "PreparePandasRotation" { Invoke-WithServiceMutex { Invoke-PandasRotationPreparation $false } }
    "PandasRotationCheck" { Invoke-WithServiceMutex { Invoke-PandasRotationPreparation $true } }
    "SwitchPandasRotation" { Invoke-WithServiceMutex { Invoke-PandasRotationSwitch } }
    "CompletePandasRotation" { Invoke-WithServiceMutex { Complete-PandasRotation } }
    "PreparePi" { Invoke-WithServiceMutex { Prepare-PiRuntime } }
    "PreparePiUpgrade" { Invoke-WithServiceMutex { Upgrade-PiRuntime $true } }
    "PiUpgradeCheck" { Invoke-WithServiceMutex { Check-PiUpgradePlan } }
    "UpgradePi" { Invoke-WithServiceMutex { Upgrade-PiRuntime $false } }
    "ReconcilePiUpgrade" { Invoke-WithServiceMutex { Upgrade-PiRuntime $false $true } }
    "PiUpgradeStatus" { Invoke-WithServiceMutex { Get-PiUpgradeStatus } }
    "VerifyPiUpgradeResult" { Invoke-WithServiceMutex { Get-PiUpgradeStatus $true } }
    "PiCheck" { Assert-AiRuntimeEntry; Invoke-PiLifecycle "probe" | ConvertTo-Json -Compress }
    "PandasCheck" { Assert-AiRuntimeEntry; $config = Read-PandasConfig; if ($null -eq $config) { throw "pandas is not configured" }; Invoke-PandasProbe $config | ConvertTo-Json -Compress }
    "ProvisionRoles" { Invoke-WithServiceMutex { Provision-AiRoles } }
    "Start" { Invoke-WithServiceMutex { Start-AiStack $OrchestratedLifecycleAclToken } }
    "Stop" { Invoke-WithServiceMutex { Stop-AiStack $OrchestratedLifecycleAclToken } }
    "Status" { Show-AiStatus }
    "EnableStartup" { Invoke-WithServiceMutex { Enable-AiStartup } }
    "DisableStartup" { Invoke-WithServiceMutex { Disable-AiStartup } }
    "DingTalkCheck" { Invoke-WithServiceMutex { Invoke-DingTalkReceiver $true } }
    "StartDingTalk" { Invoke-WithServiceMutex { Start-DingTalkWorkers } }
    "StopDingTalk" { Invoke-WithServiceMutex { Set-DingTalkStartup $false; Stop-OwnedProcess "django-ai-dingtalk-schedule" $DingTalkSchedulePidPath $Python; Stop-OwnedProcess "django-ai-dingtalk" $DingTalkPidPath $Python } }
    "EnableDingTalkStartup" { Invoke-WithServiceMutex { Set-DingTalkStartup $true } }
    "DisableDingTalkStartup" { Invoke-WithServiceMutex { Set-DingTalkStartup $false } }
    "AutoStartDingTalk" { Invoke-WithServiceMutex { Start-ConfiguredDingTalkReceiver } }
  }
} catch { Write-LauncherEvent "ERROR" "ai_action_failed" $_.Exception.Message; throw }
