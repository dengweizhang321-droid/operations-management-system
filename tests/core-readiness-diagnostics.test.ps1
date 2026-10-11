$ErrorActionPreference='Stop'
$source=Join-Path $PSScriptRoot '..\tools\django-local-service.ps1'
$control=Join-Path $PSScriptRoot '..\tools\operations-system-control.ps1'
$script:checks=0
function Assert-Core($Condition,[string]$Message){if(-not $Condition){throw $Message};$script:checks++}
function Import-TestFunction([string]$Path,[string]$Name){
  $ast=[Management.Automation.Language.Parser]::ParseFile($Path,[ref]$null,[ref]$null)
  $definition=$ast.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $Name},$true)
  . ([scriptblock]::Create($definition.Extent.Text))
  Set-Item ('function:script:'+$Name) (Get-Item ('function:'+$Name)).ScriptBlock
}
foreach($name in @('Get-CoreStatusReadinessProbe','Show-ServiceStatus')){Import-TestFunction $source $name}
foreach($name in @('Get-CoreReadinessDiagnostic','Test-CoreDjangoReady')){Import-TestFunction $control $name}
$script:case='healthy';$script:httpCalls=0
$Json=[switch]$true;$DjangoReaderHealthUrl='fixture-reader';$DjangoWriterHealthUrl='fixture-writer';$StartupShortcut=Join-Path ([IO.Path]::GetTempPath()) 'nonexistent-core-diagnostic-shortcut'
function Get-PortListeners {return @(1)}
function Assert-PostgresListenerOwnership {}
function Test-PostgresReady {return $true}
function Resolve-OwnedProcess($Service){if($script:case -eq 'identity' -and $Service -eq 'django-reader'){throw 'PRIVATE_SECRET'};return $true}
function Assert-RuntimeRootAclHardened {if($script:case -eq 'acl'){throw 'PRIVATE_SECRET'}}
function Invoke-WebRequest {
  param($Uri,$TimeoutSec,$Headers,[switch]$UseBasicParsing)
  $script:httpCalls++
  Assert-Core ($TimeoutSec -eq 2 -and $UseBasicParsing) 'original two-second readiness contract changed'
  if($Uri -eq 'fixture-reader'){
    if($script:case -eq 'timeout'){throw [TimeoutException]::new('PRIVATE_SECRET')}
    if($script:case -eq 'transport'){throw 'PRIVATE_SECRET'}
    if($script:case -eq 'http'){return @{StatusCode=503;Content='PRIVATE_SECRET'}}
  }
  return @{StatusCode=200;Content='PRIVATE_SECRET'}
}
foreach($case in @('healthy','timeout','transport','http','identity','acl')){
  $script:case=$case;$script:httpCalls=0
  $raw=Show-ServiceStatus;$status=$raw|ConvertFrom-Json
  $detail=Get-CoreReadinessDiagnostic $status
  Assert-Core ($raw -notmatch 'PRIVATE_SECRET') 'raw core response or exception leaked'
  Assert-Core (($detail|ConvertTo-Json -Depth 8) -notmatch 'PRIVATE_SECRET') 'controller diagnostics leaked private data'
  if($case -eq 'healthy'){
    Assert-Core (Test-CoreDjangoReady $status) 'previously healthy core no longer ready'
    Assert-Core ($detail.probes.reader.code -eq 'none' -and $detail.probes.writer.code -eq 'none' -and $detail.probes.reader.elapsedMs -ge 0) 'successful probe trace missing'
  }else{
    Assert-Core (-not (Test-CoreDjangoReady $status)) 'diagnostics changed a failure into healthy'
    if($case -in @('timeout','transport','http')){
      $code=switch($case){timeout{'timeout'} transport{'transport_error'} http{'http_status'}}
      Assert-Core ($status.ReaderReadiness -eq 'not_ready' -and $detail.probes.reader.code -eq $code -and $status.WriterReadiness -eq 'ready') 'core failure reason or successful writer was lost'
    }
    if($case -eq 'identity'){Assert-Core ($detail.DjangoReader -eq 'ownership_error' -and -not $detail.probes.reader -and $script:httpCalls -eq 1) 'unowned reader was probed or hidden'}
    if($case -eq 'acl'){Assert-Core ($detail.RuntimeAcl -eq 'not_hardened') 'ACL failure was hidden'}
  }
}
$detail=Get-CoreReadinessDiagnostic ([pscustomobject]@{PostgreSQL='PRIVATE_SECRET';ReadinessEvidence=@{reader=@{code='PRIVATE_SECRET';elapsedMs='PRIVATE_SECRET';body='PRIVATE_SECRET'}}})
Assert-Core (($detail|ConvertTo-Json -Depth 8) -notmatch 'PRIVATE_SECRET') 'unknown diagnostic fields were not filtered'
@{passed=$script:checks;productionServicesTouched=$false;httpRequestsMade=$false}|ConvertTo-Json -Compress
