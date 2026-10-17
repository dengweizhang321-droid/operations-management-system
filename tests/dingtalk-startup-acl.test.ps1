$ErrorActionPreference='Stop'
$fixture=Join-Path ([IO.Path]::GetTempPath()) ('teruisi-ding-acl-'+[guid]::NewGuid().ToString('N'))
$previousLibrary=$env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY
$contextName='TERUISI_DJANGO_ORCHESTRATED_LIFECYCLE_ACL_CONTEXT'
$saved=Get-Variable -Scope Global -Name $contextName -ErrorAction SilentlyContinue
$savedValue=if($null -ne $saved){$saved.Value}else{$null}
try {
  $env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY='1'
  . (Join-Path $PSScriptRoot '..\tools\django-local-service.ps1') -Action Start -RuntimeRoot $fixture
  [IO.Directory]::CreateDirectory($InstalledAppRoot) | Out-Null
  [IO.File]::WriteAllText($DeploymentManifestPath,'{"version":2}')
  $ExecutionRoot=$InstalledAppRoot
  $tokens=$null;$errors=$null
  $ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '..\tools\django-ai.ps1'),[ref]$tokens,[ref]$errors)
  if($errors.Count){throw 'AI controller parse failure'}
  foreach($name in @('Assert-AiRuntimeEntry','Start-ConfiguredDingTalkReceiver','Start-DingTalkWorkers','Invoke-DingTalkReceiver')) {
    $fn=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name},$true)
    . ([scriptblock]::Create($fn.Extent.Text))
  }
  $DingTalkStartupPath=Join-Path $fixture 'startup.json'
  $DingTalkConfigPath=Join-Path $fixture 'config.json'
  $DingTalkBotCredentialPath=Join-Path $fixture 'bot.json'
  [IO.File]::WriteAllText($DingTalkConfigPath,'{"enabled":true}')
  [IO.File]::WriteAllText($DingTalkBotCredentialPath,'{}')
  $approval=@{authorityEpoch='fixture';cutoverId='fixture';configSha256=(Get-FileSha256 $DingTalkConfigPath)}
  [IO.File]::WriteAllText($DingTalkStartupPath,($approval|ConvertTo-Json))
  $DingTalkScreenshotProfile='';$DingTalkSchedulePidPath='fixture-schedule';$DingTalkPidPath='fixture-receiver'
  $AiWriterHealthUrl='fixture-health';$AiWriterMaxBodyBytes=1;$WriterStatementTimeoutMs=1
  $script:scans=0;$script:treeChecks=0;$script:roots=0;$script:authorityChecks=0
  $script:enabled=$true;$script:failReceiver=$false;$script:changeManifest=$false;$script:workers=@{}
  function Write-LauncherEvent {}
  function Assert-RuntimeRootAclHardened { $script:roots++ }
  function Assert-DeployedApplication { $script:treeChecks++ }
  function Assert-RuntimeAclHardened { $script:scans++ }
  function Read-DingTalkStartup { $script:enabled }
  function Assert-PostgresListenerOwnership {}
  function Test-PostgresReady { $true }
  function Read-Secrets { @{} }
  function Read-AiCredentials { @{WriterPassword='fixture'} }
  function Get-AiWriteAuthority {
    $script:authorityChecks++
    if($script:changeManifest -and $script:authorityChecks -eq 1) {
      [IO.File]::WriteAllText($DeploymentManifestPath,'{"version":3}')
    }
    if($script:failReceiver -and $script:authorityChecks -eq 2) { throw 'Synthetic receiver failure' }
    @{status='postgres';authorityEpoch='fixture';cutoverId='fixture'}
  }
  function Database-Url { 'fixture-db' }
  function Wait-DjangoReady {}
  function Invoke-WithAiEnvironment($a,$b,$c,$d,$e,$f,$g,[scriptblock]$Operation){ & $Operation }
  function Invoke-BoundedNativeProcess { 'fixture-dependencies' }
  function Get-ConfigFingerprint { 'fixture-fingerprint' }
  function Resolve-OwnedProcess($Service) { if($script:workers.ContainsKey($Service)){@{ProcessId=42}} }
  function Start-ManagedProcess($Service) { $script:workers[$Service]=42 }
  $sentinel=[pscustomobject]@{sentinel='original-context'}
  Set-Variable -Scope Global -Name $contextName -Value $sentinel -Force
  Start-ConfiguredDingTalkReceiver | Out-Null
  if($script:scans -ne 1 -or $script:treeChecks -ne 1 -or $script:roots -ne 3 -or
      $script:authorityChecks -ne 2 -or $script:workers.Count -ne 2) { throw 'Automatic startup did not reuse exactly one full audit while retaining dynamic checks' }
  if(-not [object]::ReferenceEquals((Get-Variable -Scope Global -Name $contextName).Value,$sentinel)) { throw 'Outer context was not restored' }
  Remove-Variable -Scope Global -Name $contextName
  $script:scans=0;$script:authorityChecks=0;$script:failReceiver=$true
  $denied=$false;try{Start-ConfiguredDingTalkReceiver|Out-Null}catch{$denied=$true}
  if(-not $denied -or (Get-Variable -Scope Global -Name $contextName -ErrorAction SilentlyContinue)) { throw 'Failure leaked reusable context' }
  $script:failReceiver=$false;$script:scans=0;$script:authorityChecks=0;$script:changeManifest=$true
  Start-ConfiguredDingTalkReceiver | Out-Null
  if($script:scans -ne 2) { throw 'Changed manifest did not force a full audit' }
  $script:changeManifest=$false;$script:scans=0
  Start-DingTalkWorkers | Out-Null
  if($script:scans -ne 2) { throw 'Independent manual entry inherited an automatic startup proof' }
  $script:enabled=$false;$script:scans=0;$script:authorityChecks=0
  Start-ConfiguredDingTalkReceiver | Out-Null
  if($script:scans -ne 1 -or $script:authorityChecks -ne 0 -or
      (Get-Variable -Scope Global -Name $contextName -ErrorAction SilentlyContinue)) { throw 'Disabled startup created a context or dispatched workers' }
  'PASS: automatic audits 3 -> 1; live authority checks retained; manifest invalidation, independent entry and failure cleanup'
} finally {
  $env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY=$previousLibrary
  if($null -ne $saved){Set-Variable -Scope Global -Name $contextName -Value $savedValue -Force}
  else{Remove-Variable -Scope Global -Name $contextName -ErrorAction SilentlyContinue}
  $resolved=[IO.Path]::GetFullPath($fixture)
  if((Split-Path -Parent $resolved).TrimEnd('\') -ine ([IO.Path]::GetTempPath()).TrimEnd('\') -or
      (Split-Path -Leaf $resolved) -notlike 'teruisi-ding-acl-*'){throw 'Unsafe private fixture path'}
  Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction SilentlyContinue
}
