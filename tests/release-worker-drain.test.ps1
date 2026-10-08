param([Parameter(Mandatory=$true)][string]$Scratch)
$ErrorActionPreference='Stop'
if(-not (Test-Path -LiteralPath $Scratch -PathType Container) -or @(Get-ChildItem -LiteralPath $Scratch -Force).Count) { throw 'Require an empty isolated scratch directory' }
$env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY='1'
. (Join-Path $PSScriptRoot '..\tools\django-local-service.ps1') -RuntimeRoot $Scratch
function Assert-DeployedApplication {}
function Assert-RuntimeAclHardened {}
function Write-LauncherEvent {}
New-Item -ItemType Directory -Path (Join-Path $Scratch 'app\backend\teruisi_backend'),$RunDirectory -Force | Out-Null
[IO.File]::WriteAllText((Join-Path $Scratch 'app\backend\teruisi_backend\automation_drain.py'),'# isolated capability fixture')
$MaintenanceId='a'*32
$KeepPostgres=$true
function Invoke-RestMethod {
  $gate=Read-AutomationDrain
  return @{ok=$true;busy=$false;drainProtocol='teruisi-automation-drain-v1';drain=$gate;storeExecutions=@()}
}
Invoke-WithServiceMutex { Begin-WorkerReleaseDrain }
if((Read-AutomationDrain).phase -cne 'requests' -or (Read-SystemMaintenance)) { throw 'Worker-only drain failed to retain admission without backend maintenance' }
& {
  . (Join-Path $PSScriptRoot '..\tools\worker-local-service.ps1') -FunctionsOnly -AllowTestRuntimeRoot -RuntimeRoot $Scratch
  $FixedDjangoRuntimeRoot=$Scratch
  $MaintenanceId='a'*32
  Assert-WorkerReleaseDrain $MaintenanceId
  $rejected=0
  foreach($bad in @(('b'*32),'bad')) {
    try { Assert-WorkerReleaseDrain $bad;throw 'Wrong drain accepted' }
    catch { if($_.Exception.Message -eq 'Wrong drain accepted') { throw };$rejected++ }
  }
  if($rejected -ne 2) { throw 'Wrong owner was not rejected' }
  $parseErrors=$null
  $ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '..\tools\worker-local-service.ps1'),[ref]$null,[ref]$parseErrors)
  if($parseErrors.Count) { throw 'Worker controller parse failure' }
  $node=$ast.FindAll({param($n) $n -is [Management.Automation.Language.IfStatementAst] -and $n.Extent.Text -like '*if ($Action -eq ''StopForRelease'')*'},$true) | Where-Object {$_.Extent.Text.TrimStart().StartsWith('if ($Action -eq ''StopForRelease'')')} | Select-Object -First 1
  if(-not $node) { throw 'Real stopped-after-drain branch missing' }
  $body=$node.Clauses[0].Item2.Extent.Text.Trim()
  $body=$body.Substring(1,$body.Length-2) -replace '\bexit 0\b',''
  $script:stopped=0
  function Stop-WorkerOnly($Identity) { $script:stopped++;return @{status='stopped'} }
  function Write-Result($Result) {}
  $identity=@{}
  & ([scriptblock]::Create($body))
  if($script:stopped -ne 1) { throw 'Confirmed exact drain did not stop through original primitive' }
  $IncludeBackend=$true
  try { & ([scriptblock]::Create($body));throw 'Backend stop accepted' } catch { if($_.Exception.Message -eq 'Backend stop accepted') { throw } }
  if($script:stopped -ne 1) { throw 'Rejected backend flag still stopped a service' }
}
Cancel-AutomationDrain
if(Read-AutomationDrain) { throw 'Exact original cancellation did not remove the gate' }
Write-Output 'PASS: worker-only freeze, original lease drain, exact stop, wrong owner and backend rejection'
