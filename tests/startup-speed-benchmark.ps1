param([Parameter(Mandatory=$true)][string]$BaselineRoot,
  [Parameter(Mandatory=$true)][string]$HealthUrl, [int]$Rounds = 5)
$ErrorActionPreference = 'Stop'
if ($HealthUrl -notmatch '^http://127\.0\.0\.1:[0-9]+/fixture$' -or ([uri]$HealthUrl).Port -le 10000) { throw 'Isolated high loopback port required' }
$workspace = Split-Path -Parent $PSScriptRoot
$root = Join-Path ([IO.Path]::GetTempPath()) ('teruisi-startup-bench-' + [Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($root) | Out-Null
function Read-Function([string]$Path, [string]$Name) {
  $errors=$null
  $ast=[Management.Automation.Language.Parser]::ParseFile($Path,[ref]$null,[ref]$errors)
  if ($errors.Count) { throw "Invalid script $Path" }
  $node=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $Name},$true)
  if (-not $node) { throw "Missing $Name" }
  return $node
}
try {
  $env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY='1'
  . (Join-Path $workspace 'tools/django-local-service.ps1') -RuntimeRoot $root
  function Write-LauncherEvent {}
  function Get-ConfigFingerprint { 'fixture' }
  function Get-Sha256Text { 'fixture' }
  function Get-FileHash { @{Hash='fixture'} }
  function Read-PandasConfig { $null }
  function Resolve-OwnedProcess { $false }
  function Get-PortListeners {}
  function Remove-OldServiceLogs {}
  function Database-Url { 'fixture-no-database' }
  function Invoke-WithDjangoEnvironment { & ($args | Where-Object { $_ -is [scriptblock] } | Select-Object -First 1) }
  function Invoke-WithAiEnvironment { & $args[-1] }
  function Invoke-WithCustomerServiceEnvironment { & $args[-1] }
  function Invoke-WithAccessControlEnvironment { & $args[-1] }
  function Invoke-WithErpEnvironment { & $args[-1] }
  function Start-ManagedProcess {}
  function Stop-OwnedProcess { throw 'Unexpected cleanup in success benchmark' }
  $Waitress=Join-Path $root 'fixture.exe'; [IO.File]::WriteAllText($Waitress,'fixture')
  $writers=@(
    @('django-local-service.ps1','Start-DjangoWriter'), @('django-local-service.ps1','Start-DjangoFinanceWriter'),
    @('django-netshop-service.ps1','Start-NetshopWriter'), @('django-market-service.ps1','Start-MarketWriter'),
    @('django-products-service.ps1','Start-ProductsWriter'), @('django-inventory-service.ps1','Start-InventoryWriter'),
    @('django-workflow-service.ps1','Start-WorkflowWriter'), @('django-customer-service.ps1','Start-CustomerServiceWriter'),
    @('django-access-control.ps1','Start-AccessControlWriter'), @('django-ai.ps1','Start-AiWriter'),
    @('django-erp-reference.ps1','Start-ErpReferenceWriter')
  )
  $variants=@{}
  foreach ($variant in @('baseline','candidate')) {
    $source=if ($variant -eq 'baseline') { $BaselineRoot } else { $workspace }
    $variants[$variant]=@($writers | ForEach-Object { Read-Function (Join-Path $source ('tools/'+$_[0])) $_[1] })
    $variants[$variant+'Ready']=Read-Function (Join-Path $source 'tools/django-local-service.ps1') 'Wait-DjangoReady'
  }
  $samples=@()
  for ($round=0; $round -le $Rounds; $round++) {
    $order=if ($round % 2) { @('candidate','baseline') } else { @('baseline','candidate') }
    foreach ($variant in $order) {
      # Parse/JIT and setup are outside the measured readiness fragment for both variants.
      . ([scriptblock]::Create(($variants[$variant+'Ready'].Extent.Text -replace 'function Wait-DjangoReady\(', 'function Invoke-FixtureReady(')))
      $script:requests=0
      function Wait-DjangoReady {
        $script:requests++
        Invoke-FixtureReady 'fixture' $HealthUrl ([uri]$HealthUrl).Authority
      }
      $calls=@()
      foreach ($node in $variants[$variant]) {
        . ([scriptblock]::Create($node.Extent.Text))
        $call=@{}
        foreach ($parameter in $node.Parameters) {
          $name=$parameter.Name.VariablePath.UserPath
          if ($name -ne 'DeferReady') {
            $call[$name]=@{WriterPassword='fixture'; FinanceWriterPassword='fixture'; status='postgres'; operationsStatus='postgres'; authorityEpoch='fixture'; cutoverId='fixture'}
          }
        }
        if ($variant -eq 'candidate') { $call.DeferReady=$true }
        $calls+=@{name=$node.Name; parameters=$call}
      }
      $clock=[Diagnostics.Stopwatch]::StartNew()
      foreach ($call in $calls) {
        $parameters=$call.parameters
        $started=& $call.name @parameters
        if ($started -ne $true) { throw 'New writer launch ownership lost' }
        # The unchanged stack's final reader and writer readiness barriers.
        Wait-DjangoReady
        Wait-DjangoReady
      }
      $elapsed=$clock.Elapsed.TotalMilliseconds
      $expected=if ($variant -eq 'baseline') { 33 } else { 22 }
      if ($script:requests -ne $expected) { throw 'Unexpected request count' }
      if ($round -gt 0) { $samples+=@{round=$round; variant=$variant; milliseconds=$elapsed; requests=$script:requests} }
    }
  }
  @{scope='11-domain readiness fragment; process launch/DB/ACL mocked'; shell=$PSVersionTable.PSVersion.ToString(); warmupPairs=1; samples=$samples} | ConvertTo-Json -Depth 5 -Compress
} finally {
  $canonical=[IO.Path]::GetFullPath($root)
  $prefix=[IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetTempPath()) 'teruisi-startup-bench-'))
  if (-not $canonical.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe benchmark cleanup' }
  [IO.Directory]::Delete($canonical,$true)
}
