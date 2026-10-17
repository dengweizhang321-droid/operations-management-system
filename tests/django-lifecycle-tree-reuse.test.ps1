$ErrorActionPreference = 'Stop'
# Isolated orchestration evidence, not a native cold-start test. Load real
# Start/Stop dispatch, domain admission functions, token validation and tree
# hashing. Replace process/database/ACL/CLI effects with private counters.
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$service = Join-Path $workspace 'tools\django-local-service.ps1'
$prefix = Join-Path ([IO.Path]::GetTempPath()) 'teruisi-lifecycle-tree-'
$root = $prefix + [Guid]::NewGuid().ToString('N')
$contextName = 'TERUISI_DJANGO_ORCHESTRATED_LIFECYCLE_ACL_CONTEXT'
$oldLibrary = [Environment]::GetEnvironmentVariable('TERUISI_DJANGO_SERVICE_LIBRARY_ONLY', 'Process')
$oldVariable = Get-Variable -Scope Global -Name $contextName -ErrorAction SilentlyContinue
$hadOld = $null -ne $oldVariable
$oldContext = if ($hadOld) { $oldVariable.Value } else { $null }

function Read-TestAst([string]$Path) {
  $errors = $null
  $ast = [Management.Automation.Language.Parser]::ParseFile($Path, [ref]$null, [ref]$errors)
  if ($errors.Count) { throw "Parse failed: $Path" }
  return $ast
}
function Find-TestFunction($Ast, [string]$Name) {
  $matches = @($Ast.FindAll({ param($n)
    $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $Name
  }, $true))
  if ($matches.Count -ne 1) { throw "Expected one function: $Name" }
  return $matches[0]
}
function Assert-Test([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

try {
  [IO.Directory]::CreateDirectory((Join-Path $root 'app\tools')) | Out-Null
  $env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY = '1'
  . $service -RuntimeRoot $root
  $ExecutionRoot = $InstalledAppRoot
  $content = Join-Path $InstalledAppRoot 'tools\django-local-service.ps1'
  [IO.File]::WriteAllText($content, 'synthetic-app', [Text.UTF8Encoding]::new($false))
  $empty = Join-Path $InstalledAppRoot 'empty.txt'
  [IO.File]::WriteAllBytes($empty, [byte[]]@())
  foreach ($path in @($content, $empty)) {
    Assert-Test ((Get-ExistingFileSha256 $path) -ceq (Get-FileSha256 $path)) 'Direct leaf hash changed SHA-256'
  }
  $missingPath = Join-Path $InstalledAppRoot 'never-created.txt'
  Assert-Test ((Get-FileSha256 $missingPath) -ceq 'missing') 'Public missing-file semantics changed'
  $rejected = $false
  try { Get-ExistingFileSha256 $missingPath | Out-Null } catch { $rejected = $true }
  Assert-Test $rejected 'Direct enumerated-leaf reader accepted a missing file'

  # Trace provider probes while the real fingerprint function reads the actual
  # private tree. Only the root existence probe remains; every file is opened
  # and hashed directly with the existing read/share policy.
  $script:leafProviderProbes = 0
  $script:allProviderProbes = 0
  $evidence = & {
    function Test-Path([string]$LiteralPath, [string]$PathType) {
      $script:allProviderProbes += 1
      if ($PathType -ceq 'Leaf') { $script:leafProviderProbes += 1 }
      Microsoft.PowerShell.Management\Test-Path -LiteralPath $LiteralPath -PathType $PathType
    }
    Get-ApplicationTreeFingerprintEvidence $InstalledAppRoot
  }
  Assert-Test ($script:allProviderProbes -eq 1 -and $script:leafProviderProbes -eq 0) 'Tree hashing repeated per-leaf provider probes'
  $exclusive = [IO.File]::Open($content, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
  try {
    $rejected = $false
    try { Get-ExistingFileSha256 $content | Out-Null } catch { $rejected = $true }
    Assert-Test $rejected 'Direct hash ignored a conflicting file handle'
  } finally { $exclusive.Dispose() }
  $exclusive = [IO.File]::Open($content, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
  $exclusive.Dispose()
  # A leaf removed after enumeration must fail closed, and all earlier opened
  # streams must be released even when tree verification cannot complete.
  $rejected = $false
  try {
    & {
      function Get-ChildItem([string]$LiteralPath, [switch]$File, [switch]$Recurse) {
        $files = @(Microsoft.PowerShell.Management\Get-ChildItem -LiteralPath $LiteralPath -File -Recurse)
        [IO.File]::Delete($empty)
        return $files
      }
      Get-ApplicationTreeFingerprintEvidence $InstalledAppRoot | Out-Null
    }
  } catch { $rejected = $true }
  Assert-Test $rejected 'Tree hashing accepted a leaf removed after enumeration'
  [IO.File]::WriteAllBytes($empty, [byte[]]@())
  $exclusive = [IO.File]::Open($content, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
  $exclusive.Dispose()
  $evidence = Get-ApplicationTreeFingerprintEvidence $InstalledAppRoot
  $manifestText = [ordered]@{
    version = 2; deployedAt = '2026-10-18T00:00:00Z'; sourceRoot = 'private-fixture'
    fingerprintAlgorithm = $evidence.Algorithm; fileCount = $evidence.FileCount
    appFingerprint = $evidence.Fingerprint
  } | ConvertTo-Json -Compress
  [IO.File]::WriteAllText($DeploymentManifestPath, $manifestText, [Text.UTF8Encoding]::new($false))

  $serviceAst = Read-TestAst $service
  $dispatch = @($serviceAst.FindAll({ param($n)
    $n -is [Management.Automation.Language.SwitchStatementAst] -and
    $n.Extent.Text -match '"DeployApp" \{ Invoke-WithServiceMutex'
  }, $true))
  Assert-Test ($dispatch.Count -eq 1) 'Unique lifecycle dispatch was not found'
  $bodies = @{}
  foreach ($operation in @('Start', 'Stop')) {
    $clause = @($dispatch[0].Clauses | Where-Object { $_.Item1.Value -ceq $operation })
    Assert-Test ($clause.Count -eq 1) "Missing $operation dispatch"
    $body = $clause[0].Item2.Extent.Text
    $bodies[$operation] = [scriptblock]::Create($body.Substring(1, $body.Length - 2))
  }
  $core = Find-TestFunction $serviceAst 'Start-ServiceStack'
  $coreTreeChecks = @($core.FindAll({ param($n)
    $n -is [Management.Automation.Language.CommandAst] -and
    $n.GetCommandName() -ceq 'Assert-DeployedApplication'
  }, $true))
  Assert-Test ($coreTreeChecks.Count -eq 1) 'Core Start tree-check count changed'
  # Preserve the actual core admission prefix; never execute the database and
  # process operations following Get-ServiceConfig in this fixture.
  $coreText = $core.Body.Extent.Text
  $gateEnd = $coreText.IndexOf('  $config = Get-ServiceConfig', [StringComparison]::Ordinal)
  Assert-Test ($gateEnd -gt 0) 'Core Start admission boundary changed'
  $coreGateStart = $coreText.IndexOf('  if ((Get-CanonicalPath $ExecutionRoot)', [StringComparison]::Ordinal)
  Assert-Test ($coreGateStart -gt 0) 'Core Start admission prefix changed'
  $script:coreGate = [scriptblock]::Create($coreText.Substring($coreGateStart, $gateEnd - $coreGateStart))
  $script:domainEntries = @()
  foreach ($domain in @('netshop', 'market', 'products', 'inventory', 'workflow', 'customer-service', 'access-control', 'ai', 'erp-reference', 'bi')) {
    $filename = if ($domain -in @('ai', 'access-control', 'erp-reference', 'customer-service')) { "django-$domain.ps1" } else { "django-$domain-service.ps1" }
    $domainAst = Read-TestAst (Join-Path $workspace "tools\$filename")
    $entries = @($domainAst.FindAll({ param($n)
      $n -is [Management.Automation.Language.FunctionDefinitionAst] -and
      $n.Name -match '^Assert-.*RuntimeEntry$'
    }, $true))
    Assert-Test ($entries.Count -eq 1) "Unique domain admission missing: $domain"
    . ([scriptblock]::Create($entries[0].Extent.Text))
    $script:domainEntries += $entries[0].Name
  }

  $script:realFingerprint = ${function:Get-ApplicationTreeFingerprintEvidence}
  $script:treeChecks = 0
  $script:aclChecks = 0
  $script:rootChecks = 0
  $script:failDomain = $false
  function Get-ApplicationTreeFingerprintEvidence([string]$AppRoot) {
    $script:treeChecks += 1
    & $script:realFingerprint $AppRoot
  }
  function Assert-WranglerRuntimeCli {}
  function Write-DjangoStartupTiming {}
  function Write-LauncherEvent {}
  function Assert-RuntimeRootAclHardened { $script:rootChecks += 1 }
  function Assert-RuntimeAclHardened { $script:aclChecks += 1 }
  function Invoke-WithServiceMutex([scriptblock]$Operation) { & $Operation }
  function Write-ServiceDesiredState {}
  function Start-ServiceStack { & $script:coreGate }
  function Stop-ServiceStack {}
  function Invoke-TestDomains([string]$Token) {
    foreach ($entry in $script:domainEntries) { & $entry $Token }
    if ($script:failDomain) { throw 'private-domain-failure' }
  }
  function Invoke-EnabledDjangoDomainStarts([string]$Token) { Invoke-TestDomains $Token }
  function Invoke-InstalledDjangoDomainStops([string]$Token) { Invoke-TestDomains $Token }

  $sentinel = [pscustomobject]@{ privatePreviousContext = 'preserve-reference' }
  foreach ($operation in @('Start', 'Stop')) {
    $Action = $operation
    $KeepPostgres = [switch]$false
    $SupervisorExpectedDesiredStateSha256 = ''
    Set-Variable -Scope Global -Name $contextName -Value $sentinel -Force
    $beforeTree = $script:treeChecks
    $beforeAcl = $script:aclChecks
    & $bodies[$operation]
    Assert-Test (($script:treeChecks - $beforeTree) -eq 1) "$operation rescanned the app tree in domain admissions"
    Assert-Test (($script:aclChecks - $beforeAcl) -eq 1) "$operation rescanned full ACLs in domain admissions"
    Assert-Test ([object]::ReferenceEquals((Get-Variable -Scope Global -Name $contextName).Value, $sentinel)) "$operation did not restore previous context"
    $script:failDomain = $true
    $rejected = $false
    try { & $bodies[$operation] } catch { $rejected = $_.Exception.Message -ceq 'private-domain-failure' }
    $script:failDomain = $false
    Assert-Test $rejected "$operation failure was not propagated"
    Assert-Test ([object]::ReferenceEquals((Get-Variable -Scope Global -Name $contextName).Value, $sentinel)) "$operation failure leaked its context"
    Remove-Variable -Scope Global -Name $contextName
    & $bodies[$operation]
    Assert-Test ($null -eq (Get-Variable -Scope Global -Name $contextName -ErrorAction SilentlyContinue)) "$operation leaked a new context"
  }

  foreach ($invalidCase in @('independent', 'wrong-token', 'foreign-pid', 'expired', 'future', 'damaged', 'manifest', 'runtime')) {
    $token = New-OrchestratedLifecycleAclToken
    Set-OrchestratedLifecycleAclContext $token
    $payload = (Get-Variable -Scope Global -Name $contextName).Value
    switch ($invalidCase) {
      'independent' { $token = '' }
      'wrong-token' { $token = '0' * 64 }
      'foreign-pid' { $payload.processId = [int]$PID + 1 }
      'expired' { $payload.issuedAtUnixMilliseconds = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - 900001 }
      'future' { $payload.issuedAtUnixMilliseconds = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + 60000 }
      'damaged' { $payload | Add-Member -NotePropertyName unexpected -NotePropertyValue 1 }
      'manifest' { [IO.File]::WriteAllText($DeploymentManifestPath, $manifestText + ' ', [Text.UTF8Encoding]::new($false)) }
      'runtime' { $payload.runtimeRootPathSha256 = '0' * 64 }
    }
    $beforeTree = $script:treeChecks
    $beforeAcl = $script:aclChecks
    Invoke-TestDomains $token
    Assert-Test (($script:treeChecks - $beforeTree) -eq 10) "$invalidCase did not independently revalidate all domain trees"
    Assert-Test (($script:aclChecks - $beforeAcl) -eq 10) "$invalidCase did not independently revalidate full ACLs"
    [IO.File]::WriteAllText($DeploymentManifestPath, $manifestText, [Text.UTF8Encoding]::new($false))
  }
  # No claim is made that an unchanged manifest protects mutable app content
  # during an existing token window. Independent validation must reread bytes.
  [IO.File]::WriteAllText($content, 'changed-app', [Text.UTF8Encoding]::new($false))
  $rejected = $false
  try { & $script:domainEntries[0] '' } catch { $rejected = $true }
  Assert-Test $rejected 'Independent domain admission accepted changed content with the original manifest'
  [IO.File]::WriteAllText($content, 'synthetic-app', [Text.UTF8Encoding]::new($false))

  # Repeated library loading in one PowerShell process must not turn a prior
  # invocation token into the next invocation token or erase restored context.
  $token = New-OrchestratedLifecycleAclToken
  Set-OrchestratedLifecycleAclContext $token
  $priorPayload = (Get-Variable -Scope Global -Name $contextName).Value
  . $service -RuntimeRoot $root
  function Assert-RuntimeRootAclHardened {}
  function Write-LauncherEvent {}
  Assert-Test ([object]::ReferenceEquals((Get-Variable -Scope Global -Name $contextName).Value, $priorPayload)) 'Library reload mutated global context'
  $nextToken = New-OrchestratedLifecycleAclToken
  Set-OrchestratedLifecycleAclContext $nextToken
  Assert-Test (-not (Test-OrchestratedLifecycleAclContext $token)) 'Prior invocation token survived context replacement'
  Assert-Test (Test-OrchestratedLifecycleAclContext $nextToken) 'Fresh invocation token was rejected after reload'
  Write-Output 'PASS: direct leaf SHA/missing/open failure/handle release and root-only provider probe; existing Start/Stop single-tree admission, 10 domain entries, invalid-context fallback, failure cleanup, independent tamper refusal and same-process reload (isolated orchestration; no cold start)'
} finally {
  [Environment]::SetEnvironmentVariable('TERUISI_DJANGO_SERVICE_LIBRARY_ONLY', $oldLibrary, 'Process')
  if ($hadOld) { Set-Variable -Scope Global -Name $contextName -Value $oldContext -Force }
  else { Remove-Variable -Scope Global -Name $contextName -ErrorAction SilentlyContinue }
  $resolved = [IO.Path]::GetFullPath($root)
  Assert-Test ($resolved.StartsWith([IO.Path]::GetFullPath($prefix), [StringComparison]::OrdinalIgnoreCase)) 'Private fixture path escaped temp prefix'
  if ([IO.Directory]::Exists($resolved)) { [IO.Directory]::Delete($resolved, $true) }
}
