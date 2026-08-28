[CmdletBinding()]
param(
  [ValidateSet(
    "Configure", "DeployApp", "HardenAcl", "Start", "Stop", "Status",
    "InstallStartup", "RemoveStartup"
  )]
  [string]$Action = "Status",
  [string]$RuntimeRoot = "D:\teruisi-runtime\django-sales",
  [string]$SourceD1 = "",
  [switch]$SkipSync
)

$ErrorActionPreference = "Stop"
$Utf8NoBom = [Text.UTF8Encoding]::new($false)
$ExecutionRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$BackendRoot = Join-Path $ExecutionRoot "backend"
$InstalledAppRoot = Join-Path $RuntimeRoot "app"
$InstalledScriptPath = Join-Path $InstalledAppRoot "tools\django-local-service.ps1"
$DeploymentManifestPath = Join-Path $InstalledAppRoot "deployment.json"
$ConfigPath = Join-Path $RuntimeRoot "service.json"
$CredentialPath = Join-Path $RuntimeRoot "secrets\credentials.dpapi.json"
$PostgresBin = Join-Path $RuntimeRoot "postgresql-17.11\bin"
$PostgresData = Join-Path $RuntimeRoot "postgres-data"
$Python = Join-Path $RuntimeRoot "venv\Scripts\python.exe"
$Waitress = Join-Path $RuntimeRoot "venv\Scripts\waitress-serve.exe"
$LogDirectory = Join-Path $RuntimeRoot "logs"
$RunDirectory = Join-Path $RuntimeRoot "run"
$DjangoPidPath = Join-Path $RunDirectory "django.pid.json"
$SyncPidPath = Join-Path $RunDirectory "projection-sync.pid.json"
$LauncherLogPath = Join-Path $LogDirectory "launcher.jsonl"
$DjangoHealthUrl = "http://127.0.0.1:8001/health/ready"
$StartupShortcut = Join-Path ([Environment]::GetFolderPath("Startup")) "TERUISI Django Sales.lnk"
$RunId = "{0}-{1}" -f (Get-Date -Format "yyyyMMdd-HHmmss"), ([Guid]::NewGuid().ToString("N").Substring(0, 8))
$ReaderStatementTimeoutMs = 7000
$WriterStatementTimeoutMs = 900000
$MaxHeaderBytes = 32768
$MaxBodyBytes = 1048576

function Get-CanonicalPath([string]$Path) {
  return [IO.Path]::GetFullPath($Path).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
}

function Assert-RuntimeChildPath([string]$Path) {
  $root = Get-CanonicalPath $RuntimeRoot
  $candidate = Get-CanonicalPath $Path
  if ($candidate -eq $root -or -not $candidate.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "拒绝操作运行目录之外的路径：$candidate"
  }
  return $candidate
}

function Get-Sha256Text([string]$Value) {
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [Text.Encoding]::UTF8.GetBytes($Value)
    return ([BitConverter]::ToString($algorithm.ComputeHash($bytes))).Replace("-", "").ToLowerInvariant()
  } finally {
    $algorithm.Dispose()
  }
}

function Get-FileSha256([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return "missing" }
  return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
}

function Protect-LogText([string]$Value) {
  if ($null -eq $Value) { return "" }
  return [regex]::Replace($Value, "postgres(?:ql)?://[^@\s]+@", "postgresql://[redacted]@")
}

function Rotate-LauncherLog {
  if (-not (Test-Path -LiteralPath $LauncherLogPath -PathType Leaf)) { return }
  if ((Get-Item -LiteralPath $LauncherLogPath).Length -lt 5MB) { return }
  for ($index = 3; $index -ge 1; $index--) {
    $source = "$LauncherLogPath.$index"
    $target = "$LauncherLogPath.$($index + 1)"
    if (Test-Path -LiteralPath $source) {
      if ($index -eq 3) {
        Remove-Item -LiteralPath $source -Force
      } else {
        Move-Item -LiteralPath $source -Destination $target -Force
      }
    }
  }
  Move-Item -LiteralPath $LauncherLogPath -Destination "$LauncherLogPath.1" -Force
}

function Write-LauncherEvent([string]$Level, [string]$Event, [string]$Message = "") {
  try {
    New-Item -ItemType Directory -Path $LogDirectory -Force | Out-Null
    Rotate-LauncherLog
    $payload = [ordered]@{
      timestamp = [DateTimeOffset]::Now.ToString("o")
      runId = $RunId
      action = $Action
      level = $Level
      event = $Event
      message = Protect-LogText $Message
    } | ConvertTo-Json -Compress
    [IO.File]::AppendAllText($LauncherLogPath, $payload + [Environment]::NewLine, $Utf8NoBom)
  } catch {
    # Logging must never replace the original deployment failure.
  }
}

function Remove-OldServiceLogs([string]$Prefix, [int]$Keep = 10) {
  if (-not (Test-Path -LiteralPath $LogDirectory -PathType Container)) { return }
  $files = @(Get-ChildItem -LiteralPath $LogDirectory -File -Filter "$Prefix.*.log" | Sort-Object LastWriteTimeUtc -Descending)
  if ($files.Count -le $Keep) { return }
  foreach ($file in $files[$Keep..($files.Count - 1)]) {
    Remove-Item -LiteralPath $file.FullName -Force
  }
}

function Write-AtomicJson([string]$Path, [object]$Value) {
  $directory = Split-Path -Parent $Path
  New-Item -ItemType Directory -Path $directory -Force | Out-Null
  $temporary = Join-Path $directory (".{0}.{1}.tmp" -f ([IO.Path]::GetFileName($Path)), [Guid]::NewGuid().ToString("N"))
  try {
    [IO.File]::WriteAllText($temporary, ($Value | ConvertTo-Json -Depth 8), $Utf8NoBom)
    Move-Item -LiteralPath $temporary -Destination $Path -Force
  } finally {
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
  }
}

function Read-JsonFile([string]$Path, [string]$Label) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "$Label 不存在：$Path"
  }
  try {
    return Get-Content -Raw -LiteralPath $Path -Encoding UTF8 | ConvertFrom-Json
  } catch {
    throw "$Label 不是有效 JSON：$Path"
  }
}

function Unprotect-Value([string]$ProtectedValue, [string]$Label) {
  if ([string]::IsNullOrWhiteSpace($ProtectedValue)) { throw "$Label 缺失" }
  try {
    $secure = ConvertTo-SecureString $ProtectedValue
    $credential = [System.Management.Automation.PSCredential]::new("local", $secure)
    return $credential.GetNetworkCredential().Password
  } catch {
    throw "$Label 无法由当前 Windows 用户解密"
  }
}

function Assert-StrongSecret([string]$Value, [string]$Label) {
  $placeholders = @(
    "unsafe-local-development-key", "replace-me",
    "replace-with-at-least-32-random-bytes", "change-me", "changeme", "placeholder"
  )
  if (
    [Text.Encoding]::UTF8.GetByteCount($Value) -lt 32 -or
    $placeholders -contains $Value.Trim().ToLowerInvariant() -or
    @($Value.ToCharArray() | Select-Object -Unique).Count -lt 4
  ) {
    throw "$Label 必须至少 32 字节且不能使用占位值"
  }
}

function Read-Secrets {
  $payload = Read-JsonFile $CredentialPath "Django 本机 DPAPI 凭据库"
  if ([int]$payload.version -ne 1) { throw "Django 本机 DPAPI 凭据库版本不受支持" }
  $reader = Unprotect-Value ([string]$payload.databaseReader) "databaseReader"
  $writer = Unprotect-Value ([string]$payload.databaseWriter) "databaseWriter"
  $django = Unprotect-Value ([string]$payload.djangoSecretKey) "djangoSecretKey"
  $internal = Unprotect-Value ([string]$payload.internalSecret) "internalSecret"
  Assert-StrongSecret $django "djangoSecretKey"
  Assert-StrongSecret $internal "internalSecret"
  if ([string]::IsNullOrWhiteSpace($reader) -or [string]::IsNullOrWhiteSpace($writer)) {
    throw "数据库 reader/writer 凭据不能为空"
  }
  return [pscustomobject]@{
    ReaderPassword = $reader
    WriterPassword = $writer
    DjangoSecretKey = $django
    InternalSecret = $internal
  }
}

function Database-Url(
  [string]$User,
  [string]$Password,
  [string]$ApplicationName,
  [int]$StatementTimeoutMilliseconds
) {
  $escapedUser = [Uri]::EscapeDataString($User)
  $escapedPassword = [Uri]::EscapeDataString($Password)
  $escapedApplication = [Uri]::EscapeDataString($ApplicationName)
  $idleTimeout = [Math]::Max($StatementTimeoutMilliseconds + 5000, 60000)
  $options = [Uri]::EscapeDataString("-c statement_timeout=$StatementTimeoutMilliseconds -c idle_in_transaction_session_timeout=$idleTimeout")
  return "postgresql://${escapedUser}:${escapedPassword}@127.0.0.1:5432/teruisi_sales?sslmode=disable&application_name=${escapedApplication}&connect_timeout=5&options=${options}"
}

function Get-ServiceConfig {
  $config = Read-JsonFile $ConfigPath "Django 本机服务配置"
  if ([int]$config.version -ne 1) { throw "Django 本机服务配置版本不受支持" }
  $source = [string]$config.sourceD1
  if ([string]::IsNullOrWhiteSpace($source) -or -not (Test-Path -LiteralPath $source -PathType Leaf)) {
    throw "Django 同步源不存在或未固定：$source"
  }
  if ([IO.Path]::GetExtension($source) -ne ".sqlite") { throw "同步源必须是精确的 SQLite 文件" }
  return $config
}

function Get-AllowedAclSids {
  $current = [Security.Principal.WindowsIdentity]::GetCurrent().User
  if ($null -eq $current) { throw "无法解析当前 Windows 用户 SID" }
  return @(
    $current,
    [Security.Principal.SecurityIdentifier]::new("S-1-5-18"),
    [Security.Principal.SecurityIdentifier]::new("S-1-5-32-544")
  )
}

function Set-RuntimeAcl {
  if (-not (Test-Path -LiteralPath $RuntimeRoot -PathType Container)) { throw "运行目录不存在：$RuntimeRoot" }
  try {
    Assert-RuntimeAclHardened
    Write-LauncherEvent "INFO" "runtime_acl_already_hardened"
    Write-Output "Django 本机运行目录 ACL 已满足限制，无需重复修改。"
    return
  } catch {
    # Continue with a complete DACL replacement below.
  }
  $root = Get-CanonicalPath $RuntimeRoot
  $allowed = @(Get-AllowedAclSids)
  # Build a fresh DACL-only descriptor. Reusing Get-Acl can carry the system
  # audit ACL back into Set-Acl and require SeSecurityPrivilege even though
  # this operation only needs to replace access rules.
  $rootAcl = [Security.AccessControl.DirectorySecurity]::new()
  $rootAcl.SetAccessRuleProtection($true, $false)
  $inheritance = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit
  foreach ($sid in $allowed) {
    $rule = [Security.AccessControl.FileSystemAccessRule]::new(
      $sid,
      [Security.AccessControl.FileSystemRights]::FullControl,
      $inheritance,
      [Security.AccessControl.PropagationFlags]::None,
      [Security.AccessControl.AccessControlType]::Allow
    )
    $rootAcl.AddAccessRule($rule)
  }
  try {
    Set-Acl -LiteralPath $root -AclObject $rootAcl
  } catch [System.Security.AccessControl.PrivilegeNotHeldException] {
    # Some Windows installations reject Set-Acl on an existing directory when
    # the process cannot write its SACL. icacls changes only the DACL here.
    $icacls = Join-Path $env:SystemRoot "System32\icacls.exe"
    $grantArguments = @($allowed | ForEach-Object { "*$($_.Value):(OI)(CI)F" })
    & $icacls $root "/inheritance:r" "/grant:r" @grantArguments | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "无法加固运行目录根 ACL（icacls exit=$LASTEXITCODE）" }
  }

  # Protect only the root. Descendants inherit the restricted root DACL; making
  # every descendant protected before granting it would create empty DACLs.
  foreach ($item in @(Get-ChildItem -LiteralPath $root -Force -Recurse)) {
    $acl = if ($item.PSIsContainer) {
      [Security.AccessControl.DirectorySecurity]::new()
    } else {
      [Security.AccessControl.FileSecurity]::new()
    }
    $acl.SetAccessRuleProtection($false, $false)
    Set-Acl -LiteralPath $item.FullName -AclObject $acl
  }
  Assert-RuntimeAclHardened
  Write-LauncherEvent "INFO" "runtime_acl_hardened"
  Write-Output "Django 本机运行目录 ACL 已限制为当前用户、SYSTEM 和 Administrators。"
}

function Assert-RuntimeAclHardened {
  if (-not (Test-Path -LiteralPath $RuntimeRoot -PathType Container)) { throw "运行目录不存在：$RuntimeRoot" }
  $allowedValues = @((Get-AllowedAclSids) | ForEach-Object { $_.Value })
  $root = Get-CanonicalPath $RuntimeRoot
  $items = @((Get-Item -LiteralPath $root)) + @(Get-ChildItem -LiteralPath $root -Force -Recurse)
  foreach ($item in $items) {
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "运行目录不得包含重解析点：$($item.FullName)"
    }
    $acl = Get-Acl -LiteralPath $item.FullName
    if ($item.FullName -eq $root -and -not $acl.AreAccessRulesProtected) {
      throw "运行目录根 ACL 尚未禁用父目录继承"
    }
    if ($item.FullName -ne $root -and $acl.AreAccessRulesProtected) {
      throw "运行目录子项必须继承受保护根 ACL：$($item.FullName)"
    }
    foreach ($rule in $acl.Access) {
      if ($rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow) { continue }
      try {
        $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
      } catch {
        throw "运行目录包含无法解析的 ACL 主体：$($rule.IdentityReference)"
      }
      if ($allowedValues -notcontains $sid) {
        throw "运行目录 ACL 包含未授权主体：$($rule.IdentityReference)"
      }
    }
  }
}

function Get-ApplicationTreeFingerprint([string]$AppRoot) {
  if (-not (Test-Path -LiteralPath $AppRoot -PathType Container)) { return "missing" }
  $root = Get-CanonicalPath $AppRoot
  $rows = foreach ($file in @(Get-ChildItem -LiteralPath $root -File -Recurse | Sort-Object FullName)) {
    if ($file.FullName -eq (Join-Path $root "deployment.json")) { continue }
    $relative = $file.FullName.Substring($root.Length).TrimStart("\", "/").Replace("\", "/")
    $segments = $relative -split "/"
    if (@($segments | Where-Object { $_ -in @("__pycache__", ".pytest_cache", ".mypy_cache") }).Count -gt 0) { continue }
    if ($file.Extension -in @(".pyc", ".pyo")) { continue }
    "$relative`n$(Get-FileSha256 $file.FullName)"
  }
  return Get-Sha256Text ($rows -join "`n")
}

function Assert-DeployedApplication {
  $manifest = Read-JsonFile $DeploymentManifestPath "Django runtime app 部署清单"
  if ([int]$manifest.version -ne 1 -or -not ([string]$manifest.appFingerprint -match "^[0-9a-f]{64}$")) {
    throw "Django runtime app 部署清单无效"
  }
  if ((Get-ApplicationTreeFingerprint $InstalledAppRoot) -ne [string]$manifest.appFingerprint) {
    throw "Django runtime app 文件与部署清单不一致"
  }
  if (-not (Test-Path -LiteralPath $InstalledScriptPath -PathType Leaf)) {
    throw "Django runtime app 缺少受保护启动脚本"
  }
}

function Copy-ApplicationTree([string]$Source, [string]$Destination) {
  $sourceRoot = Get-CanonicalPath $Source
  New-Item -ItemType Directory -Path $Destination -Force | Out-Null
  foreach ($file in @(Get-ChildItem -LiteralPath $sourceRoot -File -Recurse)) {
    $relative = $file.FullName.Substring($sourceRoot.Length).TrimStart("\", "/")
    $segments = $relative -split "[\\/]"
    if (@($segments | Where-Object { $_ -in @(".runtime", "__pycache__", ".pytest_cache", ".mypy_cache", "tests") }).Count -gt 0) {
      continue
    }
    if ($file.Extension -in @(".pyc", ".pyo")) { continue }
    $target = Join-Path $Destination $relative
    New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
    Copy-Item -LiteralPath $file.FullName -Destination $target -Force
  }
}

function Deploy-Application {
  if ((Get-CanonicalPath $ExecutionRoot) -eq (Get-CanonicalPath $InstalledAppRoot)) {
    throw "DeployApp 必须从源码工作树脚本执行，不能从 runtime app 自我覆盖"
  }
  if (-not (Test-Path -LiteralPath $BackendRoot -PathType Container)) { throw "源码 backend 不存在" }
  if (@(Get-PortListeners 8001).Count -gt 0) {
    throw "部署 runtime app 前必须先停止 Django 服务"
  }
  if (Resolve-OwnedProcess "projection-sync" $SyncPidPath $Python) {
    throw "部署 runtime app 前必须先停止销售投影同步进程"
  }
  New-Item -ItemType Directory -Path $RuntimeRoot -Force | Out-Null
  $staging = Assert-RuntimeChildPath (Join-Path $RuntimeRoot ("app.deploy-" + [Guid]::NewGuid().ToString("N")))
  $backup = Assert-RuntimeChildPath (Join-Path $RuntimeRoot "app.previous")
  try {
    New-Item -ItemType Directory -Path (Join-Path $staging "backend"), (Join-Path $staging "tools") -Force | Out-Null
    Copy-ApplicationTree $BackendRoot (Join-Path $staging "backend")
    Copy-Item -LiteralPath $PSCommandPath -Destination (Join-Path $staging "tools\django-local-service.ps1") -Force
    $fingerprint = Get-ApplicationTreeFingerprint $staging
    Write-AtomicJson (Join-Path $staging "deployment.json") ([ordered]@{
      version = 1
      deployedAt = [DateTimeOffset]::Now.ToString("o")
      sourceRoot = $ExecutionRoot
      appFingerprint = $fingerprint
    })
    if (Test-Path -LiteralPath $backup) { Remove-Item -LiteralPath $backup -Recurse -Force }
    if (Test-Path -LiteralPath $InstalledAppRoot) {
      Move-Item -LiteralPath $InstalledAppRoot -Destination $backup
    }
    try {
      Move-Item -LiteralPath $staging -Destination $InstalledAppRoot
      Assert-DeployedApplication
    } catch {
      if (Test-Path -LiteralPath $InstalledAppRoot) { Remove-Item -LiteralPath $InstalledAppRoot -Recurse -Force }
      if (Test-Path -LiteralPath $backup) { Move-Item -LiteralPath $backup -Destination $InstalledAppRoot }
      throw
    }
    Write-LauncherEvent "INFO" "runtime_app_deployed" $fingerprint
    Write-Output "Django app 已复制到受控 runtime；安装自启动前还必须执行 HardenAcl。"
  } finally {
    if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
  }
}

function Get-ProcessCreation([object]$Process) {
  return ([datetime]$Process.CreationDate).ToUniversalTime().ToString("o")
}

function ConvertTo-CanonicalCreationDate([object]$Value) {
  if ($null -eq $Value) { throw "进程所有权记录 creationDate 缺失" }
  if ($Value -is [datetime]) {
    return ([datetime]$Value).ToUniversalTime().ToString("o")
  }
  if ($Value -is [DateTimeOffset]) {
    return ([DateTimeOffset]$Value).UtcDateTime.ToString("o")
  }
  $parsed = [DateTimeOffset]::MinValue
  if (-not [DateTimeOffset]::TryParseExact(
    [string]$Value,
    "o",
    [Globalization.CultureInfo]::InvariantCulture,
    [Globalization.DateTimeStyles]::RoundtripKind,
    [ref]$parsed
  )) {
    throw "进程所有权记录 creationDate 不是规范 ISO 时间"
  }
  return $parsed.UtcDateTime.ToString("o")
}

function Get-ProcessSnapshot([int]$ProcessId, [int]$Attempts = 20) {
  for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
    if ($process -and $process.ExecutablePath -and $process.CommandLine -and $process.CreationDate) {
      return [pscustomobject]@{
        Process = $process
        ProcessId = [int]$process.ProcessId
        CreationDate = Get-ProcessCreation $process
        ExecutablePath = Get-CanonicalPath ([string]$process.ExecutablePath)
        CommandLine = [string]$process.CommandLine
      }
    }
    Start-Sleep -Milliseconds 100
  }
  return $null
}

function Test-ProcessSnapshotIdentity([object]$Left, [object]$Right) {
  return (
    [int]$Left.ProcessId -eq [int]$Right.ProcessId -and
    [string]$Left.CreationDate -ceq [string]$Right.CreationDate -and
    [string]$Left.ExecutablePath -ieq [string]$Right.ExecutablePath -and
    [string]$Left.CommandLine -ceq [string]$Right.CommandLine
  )
}

function Get-VerifiedProcessDescendants([object]$RootSnapshot) {
  $rootProcessId = [int]$RootSnapshot.ProcessId
  $pending = [Collections.Generic.Queue[object]]::new()
  $pending.Enqueue($RootSnapshot)
  $seen = @{}
  $seen[$RootProcessId] = $true
  $descendants = [Collections.Generic.List[object]]::new()
  while ($pending.Count -gt 0) {
    $parentSnapshot = $pending.Dequeue()
    $parentId = [int]$parentSnapshot.ProcessId
    $currentParent = Get-ProcessSnapshot $parentId 1
    if ($null -eq $currentParent -or -not (Test-ProcessSnapshotIdentity $currentParent $parentSnapshot)) {
      throw "服务进程谱系在枚举前发生变化，已拒绝停止：$parentId"
    }
    $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $parentId" -ErrorAction Stop)
    $currentParent = Get-ProcessSnapshot $parentId 1
    if ($null -eq $currentParent -or -not (Test-ProcessSnapshotIdentity $currentParent $parentSnapshot)) {
      throw "服务进程谱系在枚举后发生变化，已拒绝停止：$parentId"
    }
    foreach ($child in $children) {
      $childId = [int]$child.ProcessId
      if ($seen.ContainsKey($childId)) { continue }
      $seen[$childId] = $true
      $snapshot = Get-ProcessSnapshot $childId 1
      if ($null -eq $snapshot -or [int]$snapshot.Process.ParentProcessId -ne $parentId) { continue }
      if (
        $snapshot.CreationDate -cne (Get-ProcessCreation $child) -or
        $snapshot.ExecutablePath -ine (Get-CanonicalPath ([string]$child.ExecutablePath)) -or
        $snapshot.CommandLine -cne [string]$child.CommandLine
      ) {
        throw "服务子进程身份在枚举期间发生变化，已拒绝停止：$childId"
      }
      [void]$descendants.Add($snapshot)
      $pending.Enqueue($snapshot)
    }
  }
  return @($descendants.ToArray())
}

function Stop-VerifiedProcessTree([object]$RootSnapshot) {
  $currentRoot = Get-ProcessSnapshot ([int]$RootSnapshot.ProcessId) 1
  if ($null -eq $currentRoot) { return 0 }
  if (-not (Test-ProcessSnapshotIdentity $currentRoot $RootSnapshot)) {
    Write-LauncherEvent "WARN" "root_pid_reused" "pid=$($RootSnapshot.ProcessId)"
    throw "服务根 PID 已复用，已拒绝停止：$($RootSnapshot.ProcessId)"
  }
  $descendants = @(Get-VerifiedProcessDescendants $RootSnapshot)
  $currentRoot = Get-ProcessSnapshot ([int]$RootSnapshot.ProcessId) 1
  if ($currentRoot -and -not (Test-ProcessSnapshotIdentity $currentRoot $RootSnapshot)) {
    Write-LauncherEvent "WARN" "root_pid_reused" "pid=$($RootSnapshot.ProcessId)"
    throw "服务根 PID 在停止前已复用，已拒绝停止：$($RootSnapshot.ProcessId)"
  }
  if ($currentRoot) {
    Stop-Process -Id $RootSnapshot.ProcessId -Force -ErrorAction Stop
    Wait-Process -Id $RootSnapshot.ProcessId -Timeout 10 -ErrorAction SilentlyContinue
  }
  $remainingRoot = Get-ProcessSnapshot ([int]$RootSnapshot.ProcessId) 1
  if ($remainingRoot -and (Test-ProcessSnapshotIdentity $remainingRoot $RootSnapshot)) {
    throw "已验证的服务根进程未能停止：$($RootSnapshot.ProcessId)"
  }

  [array]::Reverse($descendants)
  foreach ($snapshot in $descendants) {
    $current = Get-ProcessSnapshot ([int]$snapshot.ProcessId) 1
    if ($null -eq $current) { continue }
    if (-not (Test-ProcessSnapshotIdentity $current $snapshot)) {
      Write-LauncherEvent "WARN" "descendant_pid_reused" "pid=$($snapshot.ProcessId)"
      continue
    }
    Stop-Process -Id $snapshot.ProcessId -Force -ErrorAction Stop
    Wait-Process -Id $snapshot.ProcessId -Timeout 10 -ErrorAction SilentlyContinue
    $remaining = Get-ProcessSnapshot ([int]$snapshot.ProcessId) 1
    if ($remaining -and (Test-ProcessSnapshotIdentity $remaining $snapshot)) {
      throw "已验证的服务子进程未能停止：$($snapshot.ProcessId)"
    }
  }
  return $descendants.Count
}

function Test-ExactStringArray([object[]]$Left, [object[]]$Right) {
  if ($Left.Count -ne $Right.Count) { return $false }
  for ($index = 0; $index -lt $Left.Count; $index++) {
    if ([string]$Left[$index] -cne [string]$Right[$index]) { return $false }
  }
  return $true
}

function Test-CommandLineReferencesPath([string]$CommandLine, [string]$Path) {
  $canonical = Get-CanonicalPath $Path
  $variants = @($canonical, $canonical.Replace("\", "/"))
  foreach ($variant in $variants) {
    if ($CommandLine.IndexOf($variant, [StringComparison]::OrdinalIgnoreCase) -ge 0) { return $true }
  }
  return $false
}

function Get-ConfigFingerprint([string]$Service, [string]$Executable, [string[]]$Arguments) {
  $criticalFiles = @(
    $ConfigPath, $CredentialPath, $PSCommandPath,
    (Join-Path $BackendRoot "teruisi_backend\settings.py"),
    (Join-Path $BackendRoot "teruisi_backend\health.py"),
    (Join-Path $BackendRoot "teruisi_backend\security.py"),
    (Join-Path $BackendRoot "sales\management\commands\sync_sales_projection.py")
  )
  $material = [ordered]@{
    service = $Service
    runtimeRoot = Get-CanonicalPath $RuntimeRoot
    executionRoot = Get-CanonicalPath $ExecutionRoot
    executable = Get-CanonicalPath $Executable
    executableHash = Get-FileSha256 $Executable
    arguments = @($Arguments)
    files = @($criticalFiles | ForEach-Object { [ordered]@{ path = $_; sha256 = Get-FileSha256 $_ } })
  } | ConvertTo-Json -Depth 8 -Compress
  return Get-Sha256Text $material
}

function Resolve-OwnedProcess(
  [string]$Service,
  [string]$PidPath,
  [string]$ExpectedLauncher,
  [string[]]$ExpectedArguments = $null,
  [string]$ExpectedFingerprint = ""
) {
  if (-not (Test-Path -LiteralPath $PidPath -PathType Leaf)) { return $null }
  $record = Read-JsonFile $PidPath "进程所有权记录"
  $processId = 0
  if (
    [int]$record.version -ne 2 -or
    [string]$record.service -cne $Service -or
    -not [int]::TryParse([string]$record.processId, [ref]$processId) -or
    -not ([string]$record.configFingerprint -match "^[0-9a-f]{64}$") -or
    [string]::IsNullOrWhiteSpace([string]$record.launcherPath)
  ) {
    throw "进程所有权记录格式无效：$PidPath"
  }
  $recordCreationDate = ConvertTo-CanonicalCreationDate $record.creationDate
  $snapshot = Get-ProcessSnapshot $processId 1
  if ($null -eq $snapshot) {
    Remove-Item -LiteralPath $PidPath -Force
    Write-LauncherEvent "WARN" "stale_process_record_removed" $PidPath
    return $null
  }
  $recordArguments = @($record.arguments | ForEach-Object { [string]$_ })
  $matches = (
    $snapshot.CreationDate -ceq $recordCreationDate -and
    $snapshot.ExecutablePath -ieq (Get-CanonicalPath ([string]$record.executablePath)) -and
    (Get-CanonicalPath ([string]$record.launcherPath)) -ieq (Get-CanonicalPath $ExpectedLauncher) -and
    $snapshot.CommandLine -ceq [string]$record.commandLine -and
    (Test-CommandLineReferencesPath $snapshot.CommandLine $ExpectedLauncher)
  )
  if ($null -ne $ExpectedArguments) { $matches = $matches -and (Test-ExactStringArray $recordArguments $ExpectedArguments) }
  if ($ExpectedFingerprint) { $matches = $matches -and ([string]$record.configFingerprint -ceq $ExpectedFingerprint) }
  if (-not $matches) {
    throw "PID 已复用或进程身份与所有权记录不一致；拒绝接管或终止：$PidPath"
  }
  return $snapshot
}

function ConvertTo-ProcessArgument([string]$Value) {
  if ($Value.Contains('"')) { throw "进程参数不得包含双引号" }
  if ($Value -match "\s") { return '"' + $Value + '"' }
  return $Value
}

function Start-ManagedProcess(
  [string]$Service,
  [string]$Executable,
  [string[]]$Arguments,
  [string]$WorkingDirectory,
  [string]$PidPath,
  [string]$ConfigFingerprint,
  [string]$StdoutPath,
  [string]$StderrPath
) {
  $launchArguments = @($Arguments | ForEach-Object { ConvertTo-ProcessArgument $_ })
  $process = $null
  try {
    $process = Start-Process -FilePath $Executable -ArgumentList $launchArguments `
      -WorkingDirectory $WorkingDirectory -WindowStyle Hidden `
      -RedirectStandardOutput $StdoutPath -RedirectStandardError $StderrPath -PassThru
    $snapshot = Get-ProcessSnapshot $process.Id
    if ($null -eq $snapshot) { throw "$Service 进程未能建立可验证身份" }
    Write-AtomicJson $PidPath ([ordered]@{
      version = 2
      service = $Service
      processId = $snapshot.ProcessId
      creationDate = $snapshot.CreationDate
      launcherPath = Get-CanonicalPath $Executable
      executablePath = $snapshot.ExecutablePath
      commandLine = $snapshot.CommandLine
      arguments = @($Arguments)
      configFingerprint = $ConfigFingerprint
      startedAt = [DateTimeOffset]::Now.ToString("o")
      runId = $RunId
    })
    Write-LauncherEvent "INFO" "process_started" "$Service pid=$($snapshot.ProcessId)"
    return $snapshot.Process
  } catch {
    if ($process -and -not $process.HasExited) {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path -LiteralPath $PidPath) { Remove-Item -LiteralPath $PidPath -Force }
    throw
  }
}

function Stop-OwnedProcess([string]$Service, [string]$PidPath, [string]$ExpectedExecutable) {
  $process = Resolve-OwnedProcess $Service $PidPath $ExpectedExecutable
  if ($process) {
    $descendantCount = Stop-VerifiedProcessTree $process
    Write-LauncherEvent "INFO" "process_stopped" "$Service pid=$($process.ProcessId) descendants=$descendantCount"
  }
  if (Test-Path -LiteralPath $PidPath) { Remove-Item -LiteralPath $PidPath -Force }
}

function Get-PortListeners([int]$Port) {
  try {
    return @(
      Get-NetTCPConnection -State Listen -ErrorAction Stop |
        Where-Object { [int]$_.LocalPort -eq $Port }
    )
  } catch {
    throw "无法可靠枚举本机 TCP 监听器；拒绝继续服务操作"
  }
}

function Assert-PostgresListenerOwnership {
  $listeners = @(Get-PortListeners 5432)
  if ($listeners.Count -ne 1) { throw "PostgreSQL 5432 必须且只能有一个监听器" }
  $listener = $listeners[0]
  if ([string]$listener.LocalAddress -ne "127.0.0.1") { throw "PostgreSQL 未严格绑定 127.0.0.1" }
  $snapshot = Get-ProcessSnapshot ([int]$listener.OwningProcess) 3
  $expectedExecutable = Get-CanonicalPath (Join-Path $PostgresBin "postgres.exe")
  if ($null -eq $snapshot -or $snapshot.ExecutablePath -ine $expectedExecutable) {
    throw "5432 监听器不是本部署 PostgreSQL 可执行文件"
  }
  $dataMatches = [regex]::Matches($snapshot.CommandLine, '(?:^|\s)(?:"-D"|-D)\s+(?:"([^"]+)"|(\S+))')
  if ($dataMatches.Count -ne 1) { throw "PostgreSQL 命令行缺少唯一 -D 数据目录" }
  $rawData = if ($dataMatches[0].Groups[1].Success) { $dataMatches[0].Groups[1].Value } else { $dataMatches[0].Groups[2].Value }
  if ((Get-CanonicalPath ($rawData.Replace("/", "\"))) -ine (Get-CanonicalPath $PostgresData)) {
    throw "5432 PostgreSQL 使用了非本部署数据目录"
  }
  return $snapshot.Process
}

function Test-PostgresReady {
  $pgIsReady = Join-Path $PostgresBin "pg_isready.exe"
  if (-not (Test-Path -LiteralPath $pgIsReady -PathType Leaf)) { return $false }
  & $pgIsReady -q -h 127.0.0.1 -p 5432
  return $LASTEXITCODE -eq 0
}

function Invoke-PgCtl([string[]]$Arguments, [string]$Operation, [int]$TimeoutSeconds = 40) {
  $pgCtl = Join-Path $PostgresBin "pg_ctl.exe"
  $launchArguments = @($Arguments | ForEach-Object { ConvertTo-ProcessArgument $_ })
  $stdoutPath = Join-Path $LogDirectory "pgctl.$Operation.$RunId.stdout.log"
  $stderrPath = Join-Path $LogDirectory "pgctl.$Operation.$RunId.stderr.log"
  $process = Start-Process -FilePath $pgCtl -ArgumentList $launchArguments `
    -WorkingDirectory $RuntimeRoot -WindowStyle Hidden `
    -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
  if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    throw "PostgreSQL $Operation 控制命令超时"
  }
  # Flush redirected output without waiting for the detached database process.
  $process.WaitForExit()
  return [int]$process.ExitCode
}

function Start-Postgres {
  $pgCtl = Join-Path $PostgresBin "pg_ctl.exe"
  if (-not (Test-Path -LiteralPath $pgCtl -PathType Leaf)) { throw "缺少 PostgreSQL 17 运行文件" }
  $listeners = @(Get-PortListeners 5432)
  if ($listeners.Count -gt 0) {
    Assert-PostgresListenerOwnership | Out-Null
    if (-not (Test-PostgresReady)) { throw "本部署 PostgreSQL 正在监听但未接受连接" }
    return $false
  }
  $postgresLog = Join-Path $LogDirectory "postgres.$RunId.log"
  $exitCode = Invoke-PgCtl -Arguments @("start", "-D", $PostgresData, "-l", $postgresLog, "-w", "-t", "30") -Operation "start"
  if ($exitCode -ne 0) { throw "PostgreSQL 17 启动失败" }
  try {
    Assert-PostgresListenerOwnership | Out-Null
    if (-not (Test-PostgresReady)) { throw "PostgreSQL 启动后未通过就绪检查" }
  } catch {
    try {
      Invoke-PgCtl -Arguments @("stop", "-D", $PostgresData, "-m", "fast", "-w", "-t", "30") -Operation "rollback-stop" | Out-Null
    } catch {}
    throw
  }
  Write-LauncherEvent "INFO" "postgres_started"
  return $true
}

function Stop-Postgres {
  $pgCtl = Join-Path $PostgresBin "pg_ctl.exe"
  if (-not (Test-Path -LiteralPath $pgCtl -PathType Leaf)) { return }
  $listeners = @(Get-PortListeners 5432)
  if ($listeners.Count -gt 0) { Assert-PostgresListenerOwnership | Out-Null }
  & $pgCtl status -D $PostgresData *> $null
  if ($LASTEXITCODE -ne 0) { return }
  $exitCode = Invoke-PgCtl -Arguments @("stop", "-D", $PostgresData, "-m", "fast", "-w", "-t", "30") -Operation "stop"
  if ($exitCode -ne 0) { throw "PostgreSQL 停止失败" }
  Write-LauncherEvent "INFO" "postgres_stopped"
}

function Invoke-WithDjangoEnvironment(
  [object]$Secrets,
  [string]$DatabaseUrl,
  [string]$ProcessRole,
  [bool]$ExpectReadOnly,
  [scriptblock]$Operation
) {
  $names = @(
    "TERUISI_DJANGO_DATABASE_URL", "TERUISI_DJANGO_INTERNAL_SECRET",
    "DJANGO_SECRET_KEY", "DJANGO_DEBUG", "DJANGO_ALLOWED_HOSTS",
    "TERUISI_DJANGO_ENVIRONMENT", "TERUISI_DJANGO_PROCESS_ROLE",
    "TERUISI_DJANGO_EXPECT_READ_ONLY", "TERUISI_DJANGO_SALES_CACHE_SECONDS",
    "TERUISI_DJANGO_LOG_LEVEL", "TERUISI_DJANGO_SIGNATURE_MAX_AGE_SECONDS",
    "TERUISI_DJANGO_DB_CONN_MAX_AGE", "TERUISI_DJANGO_SYNC_MAX_AGE_SECONDS",
    "TERUISI_DJANGO_MAX_HEADER_BYTES", "TERUISI_DJANGO_MAX_BODY_BYTES",
    "DJANGO_SETTINGS_MODULE", "PYTHONUTF8", "PYTHONPATH", "PYTHONHOME"
  )
  $previous = @{}
  foreach ($name in $names) { $previous[$name] = [Environment]::GetEnvironmentVariable($name, "Process") }
  try {
    $env:TERUISI_DJANGO_DATABASE_URL = $DatabaseUrl
    $env:TERUISI_DJANGO_INTERNAL_SECRET = $Secrets.InternalSecret
    $env:DJANGO_SECRET_KEY = $Secrets.DjangoSecretKey
    $env:DJANGO_DEBUG = "false"
    $env:DJANGO_ALLOWED_HOSTS = "127.0.0.1,localhost"
    $env:TERUISI_DJANGO_ENVIRONMENT = "production"
    $env:TERUISI_DJANGO_PROCESS_ROLE = $ProcessRole
    $env:TERUISI_DJANGO_EXPECT_READ_ONLY = if ($ExpectReadOnly) { "true" } else { "false" }
    $env:TERUISI_DJANGO_SALES_CACHE_SECONDS = "300"
    $env:TERUISI_DJANGO_LOG_LEVEL = "INFO"
    $env:TERUISI_DJANGO_SIGNATURE_MAX_AGE_SECONDS = "60"
    $env:TERUISI_DJANGO_DB_CONN_MAX_AGE = "60"
    $env:TERUISI_DJANGO_SYNC_MAX_AGE_SECONDS = "60"
    $env:TERUISI_DJANGO_MAX_HEADER_BYTES = [string]$MaxHeaderBytes
    $env:TERUISI_DJANGO_MAX_BODY_BYTES = [string]$MaxBodyBytes
    $env:DJANGO_SETTINGS_MODULE = "teruisi_backend.settings"
    $env:PYTHONUTF8 = "1"
    [Environment]::SetEnvironmentVariable("PYTHONPATH", $null, "Process")
    [Environment]::SetEnvironmentVariable("PYTHONHOME", $null, "Process")
    & $Operation
  } finally {
    foreach ($name in $names) {
      [Environment]::SetEnvironmentVariable($name, $previous[$name], "Process")
    }
    $DatabaseUrl = $null
  }
}

function Invoke-ProjectionCatchUp([string]$ResolvedSource, [object]$Secrets) {
  if ($SkipSync) {
    Write-LauncherEvent "WARN" "projection_catchup_skipped"
    return
  }
  $writerUrl = Database-Url "teruisi_sales_writer" $Secrets.WriterPassword "teruisi_projection_catchup" $WriterStatementTimeoutMs
  $logPath = Join-Path $LogDirectory "projection-sync.oneshot.$RunId.log"
  $manage = Join-Path $BackendRoot "manage.py"
  Invoke-WithDjangoEnvironment $Secrets $writerUrl "projection_writer" $false {
    $output = @(& $Python $manage "sync_sales_projection" "--source" $ResolvedSource "--max-events" "10000" 2>&1)
    $exitCode = $LASTEXITCODE
    foreach ($line in $output) {
      [IO.File]::AppendAllText($logPath, (Protect-LogText ([string]$line)) + [Environment]::NewLine, $Utf8NoBom)
    }
    if ($exitCode -ne 0) { throw "销售投影 one-shot 水位追平失败；详见 $logPath" }
    if ($output.Count -eq 0) { throw "销售投影 one-shot 未返回结果" }
    try {
      $result = [string]$output[-1] | ConvertFrom-Json
    } catch {
      throw "销售投影 one-shot 返回非 JSON 结果"
    }
    if ([string]$result.status -notin @("up_to_date", "synchronized")) {
      throw "销售投影 one-shot 未到达稳定水位"
    }
  }
  $writerUrl = $null
  Write-LauncherEvent "INFO" "projection_caught_up"
}

function Wait-DjangoReady([int]$Seconds = 30) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  $lastStatus = "connection_failed"
  do {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri $DjangoHealthUrl -TimeoutSec 2 -Headers @{ Host = "127.0.0.1:8001" }
      $lastStatus = [string]$response.StatusCode
      if ($response.StatusCode -eq 200) { return }
    } catch {
      if ($_.Exception.Response) { $lastStatus = [string][int]$_.Exception.Response.StatusCode }
      Start-Sleep -Milliseconds 300
    }
  } while ((Get-Date) -lt $deadline)
  throw "Django 服务未在 ${Seconds} 秒内就绪（lastStatus=$lastStatus）"
}

function Start-Django([object]$Secrets) {
  if (-not (Test-Path -LiteralPath $Waitress -PathType Leaf)) { throw "缺少 Waitress 运行文件" }
  $arguments = @(
    "--listen=127.0.0.1:8001", "--threads=8", "--connection-limit=100",
    "--channel-timeout=35", "--cleanup-interval=30", "--ident=teruisi-django",
    "--max-request-header-size=$MaxHeaderBytes", "--max-request-body-size=$MaxBodyBytes",
    "--no-expose-tracebacks", "teruisi_backend.wsgi:application"
  )
  $fingerprint = Get-ConfigFingerprint "django" $Waitress $arguments
  $existing = Resolve-OwnedProcess "django" $DjangoPidPath $Waitress $arguments $fingerprint
  if ($existing) {
    Wait-DjangoReady
    return $false
  }
  if (@(Get-PortListeners 8001).Count -gt 0) { throw "端口 8001 被非本部署的服务占用" }
  Remove-OldServiceLogs "django"
  $stdout = Join-Path $LogDirectory "django.$RunId.stdout.log"
  $stderr = Join-Path $LogDirectory "django.$RunId.stderr.log"
  $readerUrl = Database-Url "teruisi_sales_reader" $Secrets.ReaderPassword "teruisi_django_read" $ReaderStatementTimeoutMs
  Invoke-WithDjangoEnvironment $Secrets $readerUrl "reader" $true {
    Start-ManagedProcess "django" $Waitress $arguments $BackendRoot $DjangoPidPath $fingerprint $stdout $stderr | Out-Null
  }
  $readerUrl = $null
  try {
    Wait-DjangoReady
    return $true
  } catch {
    Stop-OwnedProcess "django" $DjangoPidPath $Waitress
    throw
  }
}

function Start-ProjectionSync([string]$ResolvedSource, [object]$Secrets) {
  if ($SkipSync) { return $false }
  if (-not (Test-Path -LiteralPath $Python -PathType Leaf)) { throw "缺少 Python 运行文件" }
  $arguments = @(
    (Join-Path $BackendRoot "manage.py"), "sync_sales_projection",
    "--source=$ResolvedSource", "--watch", "--interval-seconds=15"
  )
  $fingerprint = Get-ConfigFingerprint "projection-sync" $Python $arguments
  $existing = Resolve-OwnedProcess "projection-sync" $SyncPidPath $Python $arguments $fingerprint
  if ($existing) { return $false }
  Remove-OldServiceLogs "projection-sync"
  $stdout = Join-Path $LogDirectory "projection-sync.$RunId.stdout.log"
  $stderr = Join-Path $LogDirectory "projection-sync.$RunId.stderr.log"
  $writerUrl = Database-Url "teruisi_sales_writer" $Secrets.WriterPassword "teruisi_projection_sync" $WriterStatementTimeoutMs
  Invoke-WithDjangoEnvironment $Secrets $writerUrl "projection_writer" $false {
    Start-ManagedProcess "projection-sync" $Python $arguments $ExecutionRoot $SyncPidPath $fingerprint $stdout $stderr | Out-Null
  }
  $writerUrl = $null
  Start-Sleep -Seconds 1
  try {
    if (-not (Resolve-OwnedProcess "projection-sync" $SyncPidPath $Python $arguments $fingerprint)) {
      throw "销售投影持续同步进程启动失败"
    }
    return $true
  } catch {
    Stop-OwnedProcess "projection-sync" $SyncPidPath $Python
    throw
  }
}

function Configure-Service([string]$SourcePath) {
  if ([string]::IsNullOrWhiteSpace($SourcePath)) { throw "Configure 必须提供 -SourceD1 精确源路径" }
  $resolved = (Resolve-Path -LiteralPath $SourcePath).Path
  if ([IO.Path]::GetExtension($resolved) -ne ".sqlite") { throw "同步源必须是精确的 SQLite 文件" }
  New-Item -ItemType Directory -Path $RuntimeRoot, $LogDirectory, $RunDirectory -Force | Out-Null
  Write-AtomicJson $ConfigPath ([ordered]@{
    version = 1
    configuredAt = [DateTimeOffset]::Now.ToString("o")
    configuredFrom = $ExecutionRoot
    sourceD1 = $resolved
    djangoAddress = "127.0.0.1:8001"
    postgresAddress = "127.0.0.1:5432"
  })
  Write-LauncherEvent "INFO" "service_configured"
  Write-Output "Django 本机服务配置已固定；未启动服务，未切换读取流量。"
}

function Start-ServiceStack {
  if ((Get-CanonicalPath $ExecutionRoot) -ine (Get-CanonicalPath $InstalledAppRoot)) {
    throw "Start 必须从受保护的 runtime app 启动脚本执行；请先运行 DeployApp"
  }
  Assert-DeployedApplication
  Assert-RuntimeAclHardened
  $config = Get-ServiceConfig
  New-Item -ItemType Directory -Path $LogDirectory, $RunDirectory -Force | Out-Null
  Remove-OldServiceLogs "postgres"
  $secrets = Read-Secrets
  $postgresStarted = $false
  $djangoStarted = $false
  $syncStarted = $false
  try {
    $postgresStarted = Start-Postgres
    Invoke-ProjectionCatchUp ([string]$config.sourceD1) $secrets
    $djangoStarted = Start-Django $secrets
    $syncStarted = Start-ProjectionSync ([string]$config.sourceD1) $secrets
    Wait-DjangoReady
    Write-LauncherEvent "INFO" "service_stack_ready"
    Write-Output "Django 本机服务已就绪：http://127.0.0.1:8001"
  } catch {
    $originalError = $_.Exception
    Write-LauncherEvent "ERROR" "service_stack_start_failed" $originalError.Message
    if ($syncStarted) {
      try { Stop-OwnedProcess "projection-sync" $SyncPidPath $Python } catch {
        Write-LauncherEvent "ERROR" "rollback_failed" "projection-sync: $($_.Exception.Message)"
      }
    }
    if ($djangoStarted) {
      try { Stop-OwnedProcess "django" $DjangoPidPath $Waitress } catch {
        Write-LauncherEvent "ERROR" "rollback_failed" "django: $($_.Exception.Message)"
      }
    }
    if ($postgresStarted) {
      try { Stop-Postgres } catch {
        Write-LauncherEvent "ERROR" "rollback_failed" "postgres: $($_.Exception.Message)"
      }
    }
    throw $originalError
  } finally {
    $secrets = $null
  }
}

function Stop-ServiceStack {
  Stop-OwnedProcess "projection-sync" $SyncPidPath $Python
  Stop-OwnedProcess "django" $DjangoPidPath $Waitress
  Stop-Postgres
  Write-Output "Django 本机服务已停止；数据目录未删除。"
}

function Show-ServiceStatus {
  $postgres = "stopped"
  if (@(Get-PortListeners 5432).Count -gt 0) {
    try {
      Assert-PostgresListenerOwnership | Out-Null
      $postgres = if (Test-PostgresReady) { "running" } else { "not_ready" }
    } catch {
      $postgres = "foreign_or_unverified"
    }
  }
  $django = "stopped"
  try {
    if (Resolve-OwnedProcess "django" $DjangoPidPath $Waitress) { $django = "running" }
    elseif (@(Get-PortListeners 8001).Count -gt 0) { $django = "foreign_port_owner" }
  } catch { $django = "ownership_error" }
  $sync = "stopped"
  try { if (Resolve-OwnedProcess "projection-sync" $SyncPidPath $Python) { $sync = "running" } } catch { $sync = "ownership_error" }
  $ready = "not_ready"
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $DjangoHealthUrl -TimeoutSec 2 -Headers @{ Host = "127.0.0.1:8001" }
    if ($response.StatusCode -eq 200) { $ready = "ready" }
  } catch {}
  $acl = "not_hardened"
  try { Assert-RuntimeAclHardened; $acl = "hardened" } catch {}
  [pscustomobject]@{
    PostgreSQL = $postgres
    Django = $django
    ProjectionSync = $sync
    Readiness = $ready
    RuntimeAcl = $acl
    Startup = if (Test-Path -LiteralPath $StartupShortcut) { "installed" } else { "not_installed" }
  } | Format-List
}

function Install-StartupShortcut {
  Get-ServiceConfig | Out-Null
  Assert-DeployedApplication
  Assert-RuntimeAclHardened
  if ((Get-CanonicalPath $PSCommandPath) -ine (Get-CanonicalPath $InstalledScriptPath)) {
    if ((Get-FileSha256 $PSCommandPath) -ne (Get-FileSha256 $InstalledScriptPath)) {
      throw "runtime app 启动脚本不是当前版本；请重新执行 DeployApp"
    }
  }
  if ($InstalledScriptPath.Contains('"') -or $RuntimeRoot.Contains('"')) { throw "自启动路径不得包含双引号" }
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($StartupShortcut)
  $shortcut.TargetPath = (Get-Command "powershell.exe").Source
  $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$InstalledScriptPath`" -Action Start -RuntimeRoot `"$RuntimeRoot`""
  $shortcut.WorkingDirectory = $InstalledAppRoot
  $shortcut.WindowStyle = 7
  $shortcut.Description = "TERUISI Django sales projection service"
  $shortcut.Save()
  Write-LauncherEvent "INFO" "startup_installed"
  Write-Output "已安装当前 Windows 用户登录自启动。"
}

function Invoke-WithServiceMutex([scriptblock]$Operation) {
  $name = "Local\TERUISI-DjangoSales-" + (Get-Sha256Text (Get-CanonicalPath $RuntimeRoot)).Substring(0, 24)
  $mutex = [Threading.Mutex]::new($false, $name)
  $acquired = $false
  try {
    try {
      $acquired = $mutex.WaitOne([TimeSpan]::FromSeconds(30))
    } catch [Threading.AbandonedMutexException] {
      $acquired = $true
      Write-LauncherEvent "WARN" "abandoned_mutex_recovered"
    }
    if (-not $acquired) { throw "另一个 Django 本机服务操作仍在运行" }
    & $Operation
  } finally {
    if ($acquired) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
  }
}

if ($env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY -ne "1") {
  try {
    Write-LauncherEvent "INFO" "action_started"
    switch ($Action) {
      "Configure" { Invoke-WithServiceMutex { Configure-Service $SourceD1 } }
      "DeployApp" { Invoke-WithServiceMutex { Deploy-Application } }
      "HardenAcl" { Invoke-WithServiceMutex { Set-RuntimeAcl } }
      "Start" { Invoke-WithServiceMutex { Start-ServiceStack } }
      "Stop" { Invoke-WithServiceMutex { Stop-ServiceStack } }
      "Status" { Show-ServiceStatus }
      "InstallStartup" { Invoke-WithServiceMutex { Install-StartupShortcut } }
      "RemoveStartup" {
        Invoke-WithServiceMutex {
          if (Test-Path -LiteralPath $StartupShortcut) { Remove-Item -LiteralPath $StartupShortcut -Force }
          Write-LauncherEvent "INFO" "startup_removed"
          Write-Output "已移除当前 Windows 用户登录自启动；服务与数据未删除。"
        }
      }
    }
    Write-LauncherEvent "INFO" "action_completed"
  } catch {
    Write-LauncherEvent "ERROR" "action_failed" $_.Exception.Message
    throw
  }
}
