"""Isolated PS5/PS7 recovery contracts; never invoke a production lifecycle."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
PYTHON = r"D:\teruisi-runtime\django-sales\venv\Scripts\python.exe"


class AbsentHelperRecoveryTests(unittest.TestCase):
    def test_ps5_and_ps7_contracts(self):
        shells=[r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe",shutil.which("pwsh.exe")]
        self.assertTrue(all(shells),"Both production PowerShell runtimes are required")
        for shell in shells:
            with self.subTest(shell=shell),tempfile.TemporaryDirectory(prefix="absent-helper-contract-") as tmp:
                script=Path(tmp)/"contract.ps1"
                script.write_text(PS_SCRIPT,encoding="utf-8-sig")
                result=subprocess.run([shell,"-NoProfile","-NonInteractive","-File",str(script),str(ROOT),PYTHON,tmp],
                    stdout=subprocess.PIPE,stderr=subprocess.PIPE,encoding="utf-8",errors="replace",timeout=90)
                self.assertEqual(result.returncode,0,result.stdout+result.stderr)
                self.assertIn("RECOVERY_CONTRACTS_PASSED",result.stdout)


PS_SCRIPT=r'''
param($Source,$Python,$Scratch)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
function Check($ok,$label){if(-not $ok){throw ('Check failed: '+$label)}}
function Reject([scriptblock]$call,$label){$failed=$false;try{& $call}catch{$failed=$true};Check $failed ('expected rejection: '+$label)}
function Load($file,$names){
 $errors=$null;$ast=[System.Management.Automation.Language.Parser]::ParseFile($file,[ref]$null,[ref]$errors)
 Check ($errors.Count -eq 0) 'source syntax'
 foreach($name in $names){$fn=$ast.Find({param($n)$n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name},$true);Check ($null -ne $fn) $name;Invoke-Expression ($fn.Extent.Text.Replace(('function '+$name),('function script:'+$name)))}
}
$django=Join-Path $Source 'tools\django-local-service.ps1';$worker=Join-Path $Source 'tools\worker-local-service.ps1'
Load $django @('ConvertTo-PythonBase64Launcher','Invoke-AbsentHelperRecoveryRead','Read-AbsentHelperRecoveryJson','Get-FileSha256','Get-CanonicalPath','Test-ExactObjectPropertyNames','Assert-AbsentHelperRecoveryProcessInventory','Wait-AutomationActivityLock','Wait-AutomationDrain','Begin-SystemMaintenance','Begin-AbsentHelperRecoveryIntent')
Load $worker @('ConvertFrom-ExactJson')
. (Join-Path $Source 'tools\process-deadline.ps1')
$ExecutionRoot=$Source
# Strict JSON reads use actual files/native transport; no runtime identity spoof.
foreach($raw in @('[]','[{}]','{"version":1,"version":2}')){
 $p=Join-Path $Scratch ('bad-'+[guid]::NewGuid().ToString('n')+'.json');[IO.File]::WriteAllText($p,$raw)
 Reject {Read-AbsentHelperRecoveryJson $p (Get-FileSha256 $p)} 'array/duplicate JSON'
}
$p=Join-Path $Scratch 'good.json';[IO.File]::WriteAllText($p,'{"ok":true}')
$good=Read-AbsentHelperRecoveryJson $p (Get-FileSha256 $p);Check ($good.ok -is [bool] -and $good.ok) 'strict JSON positive'
Reject {Read-AbsentHelperRecoveryJson $p ('a'*64)} 'wrong evidence digest'
# Paired parameter guard is the original prefix only; no lifecycle is loaded.
$prefix=([IO.File]::ReadAllText($worker) -split '\. \(Join-Path \$PSScriptRoot "process-deadline.ps1"\)',2)[0]
$parameterGuard=Join-Path $Scratch 'parameter-guard.ps1';[IO.File]::WriteAllText($parameterGuard,$prefix)
Reject {& $parameterGuard -Action Status -RecoveryProofPath 'x'} 'unpaired proof'
Reject {& $parameterGuard -Action Start -RecoveryProofPath 'x' -RecoveryProofSha256 ('a'*64)} 'other action'
Reject {& $parameterGuard -Action EnterMaintenance -MaintenanceId '779dd3efea0e485aa58aac3acc9e324f' -RecoveryProofPath 'x' -RecoveryProofSha256 ('a'*64)} 'missing KeepPostgres'
& $parameterGuard -Action EnterMaintenance -KeepPostgres -MaintenanceId '779dd3efea0e485aa58aac3acc9e324f' -RecoveryProofPath 'x' -RecoveryProofSha256 ('a'*64)
# Pure process predicate exercises full-address listeners, roots, unreadability.
Assert-AbsentHelperRecoveryProcessInventory @([pscustomobject]@{ProcessId=10;Name='idle.exe'}) @() @()
foreach($port in @(3000,5791)){Reject {Assert-AbsentHelperRecoveryProcessInventory @() @([pscustomobject]@{Port=$port;Address='::'}) @()} 'listener'}
Reject {Assert-AbsentHelperRecoveryProcessInventory @([pscustomobject]@{ProcessId=9080;Name='unrelated.exe'}) @() @()} 'original actor reused'
Reject {Assert-AbsentHelperRecoveryProcessInventory @([pscustomobject]@{ProcessId=10;Name='node.exe';CommandLine=$null;ExecutablePath=$null}) @() @()} 'unreadable relevant process'
Assert-AbsentHelperRecoveryProcessInventory @([pscustomobject]@{ProcessId=10;ParentProcessId=11;Name='powershell.exe';CommandLine=$null;ExecutablePath=$null},[pscustomobject]@{ProcessId=11;Name='WindowsTerminal.exe'}) @() @()
Reject {Assert-AbsentHelperRecoveryProcessInventory @([pscustomobject]@{ProcessId=10;ParentProcessId=11;Name='node.exe';CommandLine=$null;ExecutablePath=$null},[pscustomobject]@{ProcessId=11;Name='WindowsTerminal.exe'}) @() @()} 'opaque node in terminal ancestry'
Reject {Assert-AbsentHelperRecoveryProcessInventory @([pscustomobject]@{ProcessId=10;ParentProcessId=9080;Name='powershell.exe';CommandLine=$null;ExecutablePath=$null}) @() @()} 'opaque related control shell'
Reject {Assert-AbsentHelperRecoveryProcessInventory @([pscustomobject]@{ProcessId=10;Name='node.exe';CommandLine='node worker-local-runtime-supervisor.mjs';ExecutablePath='C:\node.exe'}) @() @()} 'supervisor without listener'
Reject {Assert-AbsentHelperRecoveryProcessInventory @([pscustomobject]@{ProcessId=10;Name='node.exe';CommandLine='node tmall-workflow-helper.mjs';ExecutablePath='C:\node.exe'}) @() @()} 'helper without listener'
# Original byte leases execute on private files. Held background/request leases
# must time out rather than claiming a drain; no production mutex is acquired.
$RunDirectory=$Scratch
function Assert-RuntimeChildPath($path){if(-not ([IO.Path]::GetFullPath($path).StartsWith([IO.Path]::GetFullPath($Scratch),[StringComparison]::OrdinalIgnoreCase))){throw 'Fixture escaped scratch'};return $path}
foreach($name in @('automation-background.lock','automation-activity.lock')){
 $held=[IO.FileStream]::new((Join-Path $Scratch $name),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::ReadWrite)
 try{$held.Lock(0,1);Reject {Wait-AutomationActivityLock $name ([DateTimeOffset]::UtcNow.AddMilliseconds(150))} $name}
 finally{$held.Unlock(0,1);$held.Dispose()}
 Wait-AutomationActivityLock $name ([DateTimeOffset]::UtcNow.AddSeconds(1))
}
# Fixed-production binding predicate is exercised only through isolated seams:
# all file/native/OS reads below are synthetic and all writes stay in Scratch.
Load $django @('Assert-AbsentHelperRecoveryWorkerOwner','Assert-AbsentHelperRecoveryBindings')
$RuntimeRoot='D:\teruisi-runtime\django-sales';$RunDirectory=$Scratch;$DeploymentManifestPath=Join-Path $Scratch 'deployment.json'
$RecoveryProofPath='D:\codex-artifacts\jd-bi-readiness-20261016\recovery-proof.json';$RecoveryProofSha256='a'*64
$MaintenanceId='779dd3efea0e485aa58aac3acc9e324f';$KeepPostgres=$true;$Action='BeginMaintenance'
$Utf8NoBom=[Text.UTF8Encoding]::new($false)
$ServiceMutex=[Threading.Mutex]::new($true,('Local\TERUISI-RecoveryUnit-'+[guid]::NewGuid().ToString('n')));$lockAcquired=$true
$script:executionFixture=[pscustomobject]@{'fixture-execution.ps1'=('a'*64)}
$script:readyFixture=[pscustomobject]@{status='ready';schemaGeneration=146;maintenanceId=$MaintenanceId;executionTools=[pscustomobject]@{};predecessorManifestSha256='installed';schemaActiveSha256='active';preparedAppId='5413';receiptSha256='prepared';candidateManifestSha256='candidate';workerHead=[pscustomobject]@{manifestSha256='worker';guardReceiptSha256='guard';releaseId='B27'};workerChainStateSha256='chain'}
$script:resolvedFixture=[pscustomobject]@{status='resolved';manifestSha256='worker';guardReceiptSha256='guard';releaseId='B27';chainStateSha256='chain'}
$script:gateFixture=[pscustomobject]@{version='teruisi-automation-drain-v1';id=$MaintenanceId;runtimeRoot=$RuntimeRoot;phase='helpers';keepPostgres=$true;createdAt='2026-10-15T17:19:00Z'}
$script:proofFixture=[pscustomobject]@{version='teruisi-absent-helper-maintenance-recovery-v1';operationId=$MaintenanceId;recoveryAttemptId=('c'*32);priorDrainSha256='fbfb6facd04e50ac824fac34dccc2b4e836ad40450c2dc0fd8ba9c76541a5ae7';ready=[pscustomobject]@{path='D:\codex-artifacts\jd-bi-readiness-20261016\final\READY.json';sha256='e1004eb842b2bbc0aeab83256c714c5ff769505866cc006a17d97ac0673e57b3'};priorFailure=[pscustomobject]@{path='D:\codex-artifacts\jd-bi-readiness-20261016\final\EnterMaintenance-failure.json';sha256='629929cec40d1d441556ec20f5b53b61fb5e06c6902a42dffe4dbcdfeac6a764'};startNeverSpawnedEvidence=[pscustomobject]@{path='D:\codex-artifacts\jd-bi-readiness-20261016\recovery-facts.json';sha256='6a0f72199d44dd412abbb165d053b146ad24a695018fd2bbcbe256c0c4062eaa'};executionFiles=$script:executionFixture;validation=[pscustomobject]@{path='fixture-validation';sha256=('d'*64)}}
function Get-PSCallStack{return [pscustomobject]@{FunctionName='Invoke-DjangoLifecycleAction';ScriptName=(Join-Path $ExecutionRoot 'tools\worker-local-service.ps1')}}
function Read-AbsentHelperRecoveryJson($path,$sha){
 if($path -ceq $RecoveryProofPath){return $script:proofFixture}
 if($path -like '*READY.json'){return $script:readyFixture}
 if($path -like '*EnterMaintenance-failure.json'){return [pscustomobject]@{processEvidence=[pscustomobject]@{processId=9080;exitCode=1;outputProtocol='direct-exit-files'}}}
 if($path -like '*recovery-facts.json'){return [pscustomobject]@{files=[pscustomobject]@{}}}
 return [pscustomobject]@{version='teruisi-absent-helper-recovery-tests-v1';status='passed';productionTouched=$false;executionFiles=$script:executionFixture}
}
function Get-AbsentHelperRecoveryExecutionFiles{return $script:executionFixture}
function Get-FileSha256($path){
 if($script:drift -and $path -like ('*'+$script:drift+'*')){return 'changed'}
 if($path -ceq $DeploymentManifestPath){return $script:readyFixture.predecessorManifestSha256}
 if($path -like '*jd-logistics-addition-active.json'){return $script:readyFixture.schemaActiveSha256}
 if($path -like '*app.prepare-*'){return $script:readyFixture.receiptSha256}
 if($path -like '*app.deploy-*'){return $script:readyFixture.candidateManifestSha256}
 if($path -like '*automation-drain.json'){return $script:proofFixture.priorDrainSha256}
 return 'b'*64
}
function Invoke-AbsentHelperRecoveryRead{return $script:resolvedFixture}
function Read-SystemMaintenance{return $script:maintenanceFixture}
function Read-AutomationDrain{return $script:gateFixture}
function Assert-AbsentHelperRecoverySnapshot{if($script:lateActor){throw 'fixture actor is present'}}
[void](Assert-AbsentHelperRecoveryBindings 'Initial')
foreach($field in @('operationId','version')){$old=$script:proofFixture.$field;$script:proofFixture.$field='foreign';Reject {Assert-AbsentHelperRecoveryBindings 'Initial'} $field;$script:proofFixture.$field=$old}
$script:proofFixture|Add-Member -NotePropertyName extra -NotePropertyValue 'x';Reject {Assert-AbsentHelperRecoveryBindings 'Initial'} 'closed keys';$script:proofFixture.PSObject.Properties.Remove('extra')
foreach($drift in @('deployment.json','jd-logistics-addition-active.json','app.prepare-','app.deploy-')){$script:drift=$drift;Reject {Assert-AbsentHelperRecoveryBindings 'Initial'} 'live binding digest'};$script:drift=$null
foreach($field in @('manifestSha256','guardReceiptSha256','chainStateSha256')){$old=$script:resolvedFixture.$field;$script:resolvedFixture.$field='changed';Reject {Assert-AbsentHelperRecoveryBindings 'Initial'} $field;$script:resolvedFixture.$field=$old}
$script:gateFixture.keepPostgres='true';Reject {Assert-AbsentHelperRecoveryBindings 'Initial'} 'string bool';$script:gateFixture.keepPostgres=$true
$script:gateFixture.id='foreign';Reject {Assert-AbsentHelperRecoveryBindings 'Initial'} 'foreign gate';$script:gateFixture.id=$MaintenanceId
$script:gateFixture.phase='requests';Reject {Assert-AbsentHelperRecoveryBindings 'Initial'} 'requests cannot replace original helpers';$script:gateFixture.phase='helpers'
$script:lateActor=$true;Reject {Assert-AbsentHelperRecoveryBindings 'Initial'} 'unknown/live actor';$script:lateActor=$false
$script:maintenanceFixture=[pscustomobject]@{id=$MaintenanceId};Reject {Assert-AbsentHelperRecoveryBindings 'Initial'} 'existing maintenance';$script:maintenanceFixture=$null
Begin-AbsentHelperRecoveryIntent
$intent=Join-Path $Scratch ('absent-helper-recovery-'+$MaintenanceId+'.intent.json');Check (Test-Path -LiteralPath $intent) 'create-only intent written in Scratch'
Reject {Begin-AbsentHelperRecoveryIntent} 'unknown or failed intent cannot replay'
$script:gateFixture.phase='requests';[void](Assert-AbsentHelperRecoveryBindings 'Requests')
$script:gateFixture.createdAt='changed';Reject {Assert-AbsentHelperRecoveryBindings 'Final'} 'origin timestamp drift';$script:gateFixture.createdAt='2026-10-15T17:19:00Z'
$ServiceMutex.ReleaseMutex();$ServiceMutex.Dispose();Remove-Item Function:Get-PSCallStack
# Drain orchestration uses explicit seams only. This is a unit fixture, never a
# positive invocation of the fixed production recovery guard.
$RuntimeRoot=Join-Path $Scratch 'runtime';$RunDirectory=Join-Path $RuntimeRoot 'run'
New-Item -ItemType Directory -Path (Join-Path $RuntimeRoot 'app\backend\teruisi_backend'),$RunDirectory -Force|Out-Null
[IO.File]::WriteAllText((Join-Path $RuntimeRoot 'app\backend\teruisi_backend\automation_drain.py'),'fixture')
$MaintenanceId='779dd3efea0e485aa58aac3acc9e324f';$RecoveryProofPath='';$KeepPostgres=$true
$script:events=[Collections.Generic.List[string]]::new()
function Set-AutomationDrainPhase($phase){$script:events.Add($phase)}
function Invoke-RestMethod{throw 'fixture helper absent'}
function Invoke-BackupConsoleMaintenanceFence([scriptblock]$Operation){$script:events.Add('backup');& $Operation}
function Begin-AbsentHelperRecoveryIntent{$script:events.Add('intent')}
function Assert-AbsentHelperRecoveryBindings($stage){$script:events.Add($stage)}
Reject {Wait-AutomationDrain 1} 'normal helper disconnected'
Check (($script:events -join ',') -ceq 'helpers') 'default ACK remains required'
function Invoke-RestMethod{return [pscustomobject]@{drainProtocol='teruisi-automation-drain-v1';drain=[pscustomobject]@{id=$MaintenanceId};ok=$true;busy=$false;storeExecutions=@([pscustomobject]@{status='quarantined'})}}
Reject {Wait-AutomationDrain 1} 'default quarantined result'
$script:events.Clear();$RecoveryProofPath='fixture-proof'
function Invoke-BackupConsoleMaintenanceFence{throw 'Backup task is still active or unresolved; maintenance refused'}
Reject {Wait-AutomationDrain 0} 'active backup retains admission'
function Invoke-BackupConsoleMaintenanceFence([scriptblock]$Operation){$script:events.Add('backup');& $Operation}
$script:events.Clear()
foreach($name in @('automation-background.lock','automation-activity.lock')){
 $held=[IO.FileStream]::new((Join-Path $RunDirectory $name),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::ReadWrite)
 try{$held.Lock(0,1);Reject {Wait-AutomationDrain 0} ('held workflow '+$name);Check (-not $script:events.Contains('Requests')) 'held lease cannot finish drain'}
 finally{$held.Unlock(0,1);$held.Dispose();$script:events.Clear()}
}
Wait-AutomationDrain 1
Check (($script:events -join ',') -ceq 'intent,helpers,backup,requests,Requests') 'recovery preserves normal drain tail'
# Constructor uses original nested PG+console fences; a changed final snapshot
# prevents the original marker write and leaves the admission/intent untouched.
function Assert-DeployedApplication{}
function Assert-RuntimeAclHardened{}
function Read-SystemMaintenance{return $null}
function Invoke-AutomationPgDrainFence([scriptblock]$Operation){$script:events.Add('pg');& $Operation}
function Write-AtomicJson($path,$record){$script:events.Add('marker')}
function Write-LauncherEvent{}
$MaintenancePath=Join-Path $RunDirectory 'system-maintenance.json'
$script:events.Clear();Begin-SystemMaintenance
Check (($script:events -join ',') -ceq 'intent,helpers,backup,requests,Requests,pg,backup,Final,marker') 'final check is inside original fences before marker'
function Assert-AbsentHelperRecoveryBindings($stage){if($stage -ceq 'Final'){throw 'fixture late process appeared'}}
$script:events.Clear();Reject {Begin-SystemMaintenance} 'final absence drift'
Check (-not $script:events.Contains('marker')) 'late drift cannot publish marker'
function Read-SystemMaintenance{return [pscustomobject]@{id=$MaintenanceId;keepPostgres=$true}}
Reject {Begin-SystemMaintenance} 'existing maintenance cannot replay recovery'
'RECOVERY_CONTRACTS_PASSED'
'''


if __name__=="__main__":unittest.main()
