param([string]$EvidencePath = "")
$ErrorActionPreference = "Stop"
$taskWorkspace = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$taskServiceScript = Join-Path $taskWorkspace "tools\django-local-service.ps1"
$taskScratch = Join-Path ([IO.Path]::GetTempPath()) ("teruisi-netshop-peer-env-" + [Guid]::NewGuid().ToString("N"))
$taskPeerNames = @(
  "TERUISI_DJANGO_SALES_READER_BASE_URL",
  "TERUISI_DJANGO_FINANCE_READER_BASE_URL",
  "TERUISI_DJANGO_WORKFLOW_READER_BASE_URL"
)
$taskFixedPeers = @("http://127.0.0.1:8001", "http://127.0.0.1:8011", "http://127.0.0.1:8061")
$taskCallerPeers = @("http://fixture.invalid/sales", "http://fixture.invalid/finance", "http://fixture.invalid/workflow")
$taskInitialPeers = @{}
foreach ($taskName in $taskPeerNames) { $taskInitialPeers[$taskName] = [Environment]::GetEnvironmentVariable($taskName, "Process") }
$taskInitialLibraryOnly = [Environment]::GetEnvironmentVariable("TERUISI_DJANGO_SERVICE_LIBRARY_ONLY", "Process")
$taskResults = [Collections.Generic.List[object]]::new()
$taskFakeSecrets = [pscustomobject]@{ InternalSecret = "fixture-only-no-real-secret"; DjangoSecretKey = "fixture-only-no-real-key" }
$taskDatabaseUrl = "postgresql://fixture:fixture@127.0.0.1:1/never-connect"

function Set-TaskPeerBindings([object[]]$Values) {
  for ($taskIndex = 0; $taskIndex -lt $taskPeerNames.Count; $taskIndex++) {
    $taskValue = if ($null -eq $Values[$taskIndex]) { [NullString]::Value } else { $Values[$taskIndex] }
    [Environment]::SetEnvironmentVariable($taskPeerNames[$taskIndex], $taskValue, "Process")
  }
}
function Assert-TaskPeerBindings([object[]]$Values, [string]$Context) {
  for ($taskIndex = 0; $taskIndex -lt $taskPeerNames.Count; $taskIndex++) {
    $taskActual = [Environment]::GetEnvironmentVariable($taskPeerNames[$taskIndex], "Process")
    if ($null -eq $Values[$taskIndex]) {
      if ($null -ne $taskActual) { throw "$Context left an absent peer binding present" }
    } elseif ($taskActual -cne $Values[$taskIndex]) { throw "$Context changed a peer binding" }
  }
}
function Invoke-TaskRole([string]$Role, [scriptblock]$Operation) {
  Invoke-WithDjangoEnvironment $taskFakeSecrets $taskDatabaseUrl $Role $true 4096 "" "" $Operation
}
function Add-TaskCheck([string]$Name) {
  $taskResults.Add([pscustomobject]@{ name = $Name; status = "passed" })
}

try {
  [void](New-Item -ItemType Directory -Path $taskScratch)
  # The scratch runtime is private, contains no production credentials or data,
  # and is never used to start a service, read readiness or connect to a DB.
  $taskSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $taskAcl = [Security.AccessControl.DirectorySecurity]::new()
  $taskAcl.SetOwner($taskSid)
  $taskAcl.SetAccessRuleProtection($true, $false)
  $taskAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
    $taskSid, [Security.AccessControl.FileSystemRights]::FullControl,
    [Security.AccessControl.InheritanceFlags]"ContainerInherit, ObjectInherit",
    [Security.AccessControl.PropagationFlags]::None,
    [Security.AccessControl.AccessControlType]::Allow
  ))
  Set-Acl -LiteralPath $taskScratch -AclObject $taskAcl
  $env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY = "1"
  . $taskServiceScript -Action Status -RuntimeRoot $taskScratch

  $taskBaselines = @(
    [pscustomobject]@{ name = "absent"; values = @($null, $null, $null) },
    [pscustomobject]@{ name = "existing"; values = $taskCallerPeers },
    [pscustomobject]@{ name = "mixed"; values = @($taskCallerPeers[0], $null, $taskCallerPeers[2]) }
  )
  $taskOtherRoles = @(
    "reader", "migration_writer", "writer", "finance_reader", "finance_writer",
    "netshop_writer", "market_reader", "market_writer", "products_reader", "products_writer",
    "inventory_reader", "inventory_writer", "workflow_reader", "workflow_writer",
    "customer_service_reader", "customer_service_writer", "access_control_reader", "access_control_writer",
    "ai_reader", "ai_writer", "erp_reference_reader", "erp_reference_writer", "bi_reader"
  )
  foreach ($taskBaseline in $taskBaselines) {
    Set-TaskPeerBindings $taskBaseline.values
    $taskResult = Invoke-TaskRole "netshop_reader" {
      Assert-TaskPeerBindings $taskFixedPeers "netshop reader operation"
      if ($env:TERUISI_DJANGO_PROCESS_ROLE -cne "netshop_reader" -or
          $env:TERUISI_DJANGO_EXPECT_READ_ONLY -cne "true" -or
          $env:TERUISI_DJANGO_MAX_BODY_BYTES -cne "4096") { throw "Existing role/read-only/body budget changed" }
      "fixture-result"
    }
    if ($taskResult -cne "fixture-result") { throw "Operation return value changed" }
    Assert-TaskPeerBindings $taskBaseline.values "successful caller restore"
    Add-TaskCheck ($taskBaseline.name + " caller restored after successful netshop reader operation")

    $taskThrown = $false
    try {
      Invoke-TaskRole "netshop_reader" {
        Assert-TaskPeerBindings $taskFixedPeers "failing netshop reader operation"
        Set-TaskPeerBindings @("mutated-sales", "mutated-finance", "mutated-workflow")
        throw "fixture-operation-failure"
      }
    } catch {
      if ($_.Exception.Message -cne "fixture-operation-failure") { throw }
      $taskThrown = $true
    }
    if (-not $taskThrown) { throw "Operation exception was swallowed" }
    Assert-TaskPeerBindings $taskBaseline.values "exception caller restore"
    Add-TaskCheck ($taskBaseline.name + " caller restored after mutated operation throws")

    foreach ($taskRole in $taskOtherRoles) {
      Invoke-TaskRole $taskRole { Assert-TaskPeerBindings $taskBaseline.values "subsequent other role" }
      Assert-TaskPeerBindings $taskBaseline.values "other role caller restore"
      Add-TaskCheck ($taskBaseline.name + " subsequent " + $taskRole + " receives unchanged caller peer bindings")
    }
  }

  Set-TaskPeerBindings @($null, $null, $null)
  Invoke-TaskRole "netshop_reader" {
    Assert-TaskPeerBindings $taskFixedPeers "outer netshop reader"
    Invoke-TaskRole "reader" {
      Assert-TaskPeerBindings $taskFixedPeers "nested original caller scope"
      Set-TaskPeerBindings @("nested-sales", "nested-finance", "nested-workflow")
    }
    Assert-TaskPeerBindings $taskFixedPeers "nested reader restored outer scope"
  }
  Assert-TaskPeerBindings @($null, $null, $null) "outer scope restored absence"
  Add-TaskCheck "nested role mutation restores outer netshop scope, then caller absence"

  $taskUnexpectedFiles = @(Get-ChildItem -LiteralPath $taskScratch -Force)
  if ($taskUnexpectedFiles.Count -ne 0) { throw "Library-only environment operation wrote runtime files" }
  Add-TaskCheck "library-only fake environment operations leave private runtime scratch empty"
  $taskSourceHash = (Get-FileHash -LiteralPath $taskServiceScript -Algorithm SHA256).Hash.ToLowerInvariant()
  $taskEvidence = [pscustomobject]@{
    status = "passed"; powershellVersion = $PSVersionTable.PSVersion.ToString(); checks = $taskResults.Count;
    source = $taskServiceScript; sourceSha256 = $taskSourceHash; peerURLs = $taskFixedPeers;
    results = @($taskResults.ToArray()); libraryOnly = $true; fakeSecretsOnly = $true;
    productionOperations = 0; databaseConnections = 0; networkRequests = 0; runtimeFilesWritten = 0
  }
  $taskJson = $taskEvidence | ConvertTo-Json -Depth 6
  if ($EvidencePath) {
    $taskBytes = [Text.UTF8Encoding]::new($false).GetBytes($taskJson)
    $taskStream = [IO.File]::Open($EvidencePath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $taskStream.Write($taskBytes, 0, $taskBytes.Length) } finally { $taskStream.Dispose() }
  }
  Write-Output $taskJson
} finally {
  foreach ($taskName in $taskPeerNames) {
    $taskValue = if ($null -eq $taskInitialPeers[$taskName]) { [NullString]::Value } else { $taskInitialPeers[$taskName] }
    [Environment]::SetEnvironmentVariable($taskName, $taskValue, "Process")
  }
  [Environment]::SetEnvironmentVariable("TERUISI_DJANGO_SERVICE_LIBRARY_ONLY", $taskInitialLibraryOnly, "Process")
  if (Test-Path -LiteralPath $taskScratch) {
    $taskResolvedScratch = (Resolve-Path -LiteralPath $taskScratch).Path
    $taskResolvedTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $taskResolvedScratch.StartsWith($taskResolvedTemp, [StringComparison]::OrdinalIgnoreCase) -or
        (Split-Path $taskResolvedScratch -Leaf) -notmatch '^teruisi-netshop-peer-env-[0-9a-f]{32}$') { throw "Refusing cleanup outside private task scratch" }
    Remove-Item -LiteralPath $taskResolvedScratch -Recurse -Force
  }
}
