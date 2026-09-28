$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$root = Join-Path ([IO.Path]::GetTempPath()) ('teruisi-startup-speed-' + [Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($root) | Out-Null
$previousLibrary = $env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY
function Read-Function([string]$Path, [string]$Name) {
  $errors = $null
  $ast = [Management.Automation.Language.Parser]::ParseFile($Path, [ref]$null, [ref]$errors)
  if ($errors.Count) { throw "Invalid PowerShell: $Path" }
  $node = $ast.Find({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $Name }, $true)
  if (-not $node) { throw "Missing $Name" }
  return $node
}
$domains = @(
  @('netshop-service','Netshop'), @('market-service','Market'), @('products-service','Products'),
  @('inventory-service','Inventory'), @('workflow-service','Workflow'),
  @('customer-service','CustomerService'), @('access-control','AccessControl'),
  @('ai','Ai'), @('erp-reference','ErpReference')
)
try {
  $env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY = '1'
  . (Join-Path $workspace 'tools/django-local-service.ps1') -RuntimeRoot $root
  $Action = 'Start'
  Write-DjangoStartupTiming 'fixture-stage' '2026-09-29T00:00:00Z' 12 'completed'
  $record = Get-Content -LiteralPath $LauncherLogPath | Select-Object -Last 1 | ConvertFrom-Json
  if ($record.event -ne 'startup_phase' -or $record.message -notmatch 'elapsedMilliseconds=12 outcome=completed') { throw 'Missing phase record' }
  $native = Invoke-BoundedNativeProcess (Get-Process -Id $PID).Path @('-NoProfile','-NonInteractive','-Command','exit 37') $root
  if ($native.ExitCode -ne 37 -or $native.ElapsedMilliseconds -lt 0) { throw 'Native exit code or timing changed' }
  Write-NativeDiagnosticLog (Join-Path $root 'native.log') 'django_migrate' $native
  $record = Get-Content -LiteralPath $LauncherLogPath | Select-Object -Last 1 | ConvertFrom-Json
  if ($record.message -notmatch 'stage=django-migrate .*outcome=failed') { throw 'Failed migration subprocess timing reported success' }
  $before = [IO.File]::ReadAllText($LauncherLogPath)
  Write-DjangoStartupTiming 'secret://untrusted' 'unused' 0 'failed'
  $Action = 'Status'
  Write-DjangoStartupTiming 'fixture-stage' 'unused' 0 'completed'
  if ([IO.File]::ReadAllText($LauncherLogPath) -cne $before) { throw 'Invalid stage or read-only status logged' }
  & {
    . (Join-Path $workspace 'tools/worker-local-service.ps1') -FunctionsOnly -AllowTestRuntimeRoot -RuntimeRoot $root -Action Start
    Write-WorkerStartupTiming 'fixture-stage' '2026-09-29T00:00:00Z' 42 'failed'
    $path = Join-Path $root 'logs/startup-timing.jsonl'
    $row = Get-Content -LiteralPath $path | ConvertFrom-Json
    if ($row.outcome -ne 'failed' -or $row.elapsedMilliseconds -ne 42) { throw 'Worker stage lost failure' }
    [IO.File]::WriteAllText($path, (' ' * 1048577))
    Write-WorkerStartupTiming 'fixture-stage' '2026-09-29T00:00:00Z' 1 'completed'
    if ((Get-Item -LiteralPath $path).Length -gt 1024 -or -not (Test-Path -LiteralPath ($path+'.1'))) { throw 'Unbounded timing log' }
    $before=[IO.File]::ReadAllText($path)
    $Action='Status'
    Write-WorkerStartupTiming 'fixture-stage' 'unused' 1 'completed'
    if ([IO.File]::ReadAllText($path) -cne $before) { throw 'Read-only Worker status logged' }
  }
  $script:events = [Collections.Generic.List[string]]::new()
  function Write-LauncherEvent {}
  function Write-DjangoStartupTiming { throw 'diagnostic sink failed' }
  # Timing cannot swallow a return value or replace the actual startup error.
  function Assert-PostgresListenerOwnership {}
  function Test-PostgresReady { return $true }
  function Read-Secrets { return @{} }
  function Read-PandasConfig { return $null }
  function Assert-PostgresConnectionCapacity { return 128 }
  function Start-PandasSandbox {}
  function Invoke-WithAiEnvironment { return @{status='verified'; providerCalls=0} }
  function Database-Url { return 'fixture-no-connection' }
  foreach ($domain in $domains) {
    & {
      $prefix = $domain[1]
      $node = Read-Function (Join-Path $workspace ('tools/django-' + $domain[0] + '.ps1')) ('Start-' + $prefix + 'Stack')
      . ([scriptblock]::Create($node.Extent.Text))
      foreach ($name in @(('Assert-' + $prefix + 'RuntimeEntry'), ('Read-' + $prefix + 'Credentials'))) {
        Set-Item ('Function:' + $name) -Value { return @{} }
      }
      # A few domains use abbreviated credential function names.
      function Read-CustomerServiceCredentials { return @{} }
      function Read-ErpCredentials { return @{} }
      function Read-ErpReferenceCredentials { return @{} }
      Set-Item ('Function:Get-' + $prefix + 'WriteAuthority') -Value { return @{status='postgres'; operationsStatus='postgres'} }
      Set-Item ('Function:Start-' + $prefix + 'Reader') -Value {
        if ($args -notcontains '-DeferReady') { throw 'reader overlap lost' }
        $script:events.Add('reader'); return (-not $script:existingReader)
      }
      Set-Item ('Function:Start-' + $prefix + 'Writer') -Value {
        if ($args -notcontains '-DeferReady') { throw 'writer final barrier handoff lost' }
        $script:events.Add('writer')
        if ($script:spawnFailure) { throw 'spawn failed' }
        return (-not $script:existingWriter)
      }
      Set-Variable ($prefix + 'StartupPath') (Join-Path $root 'absent.json')
      function Wait-DjangoReady($Label) {
        $script:events.Add($Label)
        if ($Label -like ('*-' + $script:failedRole)) { throw 'readiness failed' }
      }
      function Stop-OwnedProcess($Name) { $script:events.Add('stop:' + $Name) }
      foreach ($role in @('reader','writer','none')) {
        foreach ($existingReader in @($false,$true)) {
          foreach ($existingWriter in @($false,$true)) {
            $script:existingReader=$existingReader; $script:existingWriter=$existingWriter
            $script:spawnFailure=$false; $script:failedRole=$role; $script:events.Clear()
            try {
              & ('Start-' + $prefix + 'Stack') | Out-Null
              if ($role -ne 'none') { throw 'unready stack accepted' }
            } catch { if ($_.Exception.Message -ne 'readiness failed' -or $role -eq 'none') { throw } }
            $stops = @($script:events | Where-Object { $_ -like 'stop:*' })
            $expected = if ($role -eq 'none') { 0 } else { [int](-not $existingReader) + [int](-not $existingWriter) }
            if ($stops.Count -ne $expected) { throw "Wrong cleanup count: $prefix $role $script:events" }
            if ($existingReader -and @($stops | Where-Object { $_ -like '*-reader' }).Count) { throw 'existing reader stopped' }
            if ($existingWriter -and @($stops | Where-Object { $_ -like '*-writer' }).Count) { throw 'existing writer stopped' }
          }
        }
      }
      $script:spawnFailure=$true; $script:existingReader=$false; $script:existingWriter=$false; $script:events.Clear()
      try { & ('Start-' + $prefix + 'Stack'); throw 'spawn failure accepted' } catch { if ($_.Exception.Message -ne 'spawn failed') { throw } }
      if (@($script:events | Where-Object { $_ -like 'stop:*-reader' }).Count -ne 1) { throw 'spawn failure leaked reader' }
    }
  }
  Write-Output 'PASS: 9 actual domain stacks, 108 readiness/ownership cases, 9 launch failures, failing timing sink'
} finally {
  $env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY = $previousLibrary
  $canonical = [IO.Path]::GetFullPath($root)
  $prefix = [IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetTempPath()) 'teruisi-startup-speed-'))
  if (-not $canonical.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe test cleanup' }
  [IO.Directory]::Delete($canonical, $true)
}
