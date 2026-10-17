"""Private PS5/PS7 contracts. Never import or invoke a production lifecycle."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class Pi150AbsentHelperRecoveryTests(unittest.TestCase):
    def test_readonly_wsl_transport_ps5_and_ps7(self):
        shells = [r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe", shutil.which("pwsh.exe")]
        self.assertTrue(all(shells), "Both PowerShell runtimes are required")
        for shell in shells:
            with self.subTest(shell=shell), tempfile.TemporaryDirectory(prefix="pi150-wsl-") as tmp:
                script = Path(tmp) / "transport.ps1"
                script.write_text(WSL_SCRIPT, encoding="utf-8-sig")
                env = dict(os.environ)
                env.pop("TERUISI_DJANGO_SERVICE_LIBRARY_ONLY", None)
                result = subprocess.run([shell, "-NoProfile", "-NonInteractive", "-File", str(script), str(ROOT), tmp],
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, encoding="utf-8", errors="replace", timeout=90, env=env)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertIn("PI150_WSL_TRANSPORT_PASSED", result.stdout)
                print(result.stdout.strip())

    def test_private_powershell_contracts(self):
        shells = [r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe", shutil.which("pwsh.exe")]
        self.assertTrue(all(shells), "Both PowerShell runtimes are required")
        for shell in shells:
            with self.subTest(shell=shell), tempfile.TemporaryDirectory(prefix="pi150-drain-") as tmp:
                script = Path(tmp) / "contract.ps1"
                script.write_text(PS_SCRIPT, encoding="utf-8-sig")
                env = dict(os.environ)
                env.pop("TERUISI_DJANGO_SERVICE_LIBRARY_ONLY", None)
                result = subprocess.run([shell, "-NoProfile", "-NonInteractive", "-File", str(script), str(ROOT), tmp],
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, encoding="utf-8", errors="replace", timeout=90, env=env)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertIn("PI150_PRIVATE_CONTRACTS_PASSED", result.stdout)


WSL_SCRIPT = r'''
param($Source,$Scratch)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
function Check($ok,$label){if(-not $ok){throw ('Check failed: '+$label)}}
function Reject([scriptblock]$call,$label){$failed=$false;try{& $call}catch{$failed=$true};Check $failed ('expected rejection: '+$label)}
function Load($file,$names){
 $errors=$null;$ast=[Management.Automation.Language.Parser]::ParseFile($file,[ref]$null,[ref]$errors)
 Check ($errors.Count -eq 0) ('source syntax '+$file)
 foreach($name in $names){$fn=$ast.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name},$true);Check ($null -ne $fn) $name;Invoke-Expression ($fn.Extent.Text.Replace(('function '+$name),('function script:'+$name)))}
}
Load (Join-Path $Source 'tools\django-local-service.ps1') @('ConvertTo-PythonBase64Launcher','Test-ExactObjectPropertyNames','Get-FileSha256','Invoke-AbsentHelperRecoveryRead','Read-AbsentHelperRecoveryJson')
Load (Join-Path $Source 'tools\worker-local-service.ps1') @('ConvertFrom-ExactJson')
. (Join-Path $Source 'tools\process-deadline.ps1')
. (Join-Path $Source 'tools\pi150-failed-start-recovery.ps1')
$ExecutionRoot=$Source;$Python='D:\teruisi-runtime\django-sales\venv\Scripts\python.exe';$RuntimeRoot='D:\teruisi-runtime\django-sales'
# Real native path: PS5/PS7 -> unchanged Deadline -> Python -> three fixed WSL
# observations. --list is checked first so these reads never start a stopped distro.
$running=Invoke-Pi150WslRead @('--list','--running','--quiet') (Get-ProcessDeadline -TimeoutMilliseconds 15000)
Check (($running -split '\r?\n'|ForEach-Object {$_.Trim()}) -ccontains 'TERUISI-Pandas') 'bound distro already running; no start'
Assert-Pi150FailedStartRecoveryPandas
Reject {Invoke-Pi150WslRead @('--shutdown') (Get-ProcessDeadline -TimeoutMilliseconds 15000)} 'unknown WSL command'
Reject {Invoke-Pi150WslRead @('-d','another-distro','--exec','/bin/true') (Get-ProcessDeadline -TimeoutMilliseconds 15000)} 'foreign distro command'
Reject {Invoke-Pi150WslRead @('--list','--running','--quiet') ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()-1)} 'expired outer deadline'
# Run the exact adapter against a private Python argv probe. Only the fixed WSL
# subprocess seam is replaced here; real list2cmdline and all native transports run.
$probe=Join-Path $Scratch 'argv probe.py'
[IO.File]::WriteAllText($probe,'import json,sys;print(json.dumps(sys.argv[1:]))',[Text.UTF8Encoding]::new($false))
$cases=@('plain','with space','C:\with space\','embedded"quote','before\"quote','',"中文路径")
$probeInput=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject @($cases) -Compress)))
$adapter=Get-Pi150WslReadAdapterCode
$adapterEncoded=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($adapter))
$privateCode=@'
import base64,json,subprocess,sys,time
adapter=base64.b64decode(sys.argv[1]).decode('utf-8')
probe=sys.argv[2]
cases=json.loads(base64.b64decode(sys.argv[3]).decode('utf-8'))
run=subprocess.run
def private_run(command,**kw):
    assert command==[r'C:\Windows\System32\wsl.exe','--list','--running','--quiet']
    assert 'shell' not in kw and 0<kw['timeout']<=15 and kw['capture_output'] is True
    return run([sys.executable,'-B',probe]+cases,**kw)
subprocess.run=private_run
sys.argv=['adapter',base64.b64encode(b'["--list","--running","--quiet"]').decode(),str(int(time.time()*1000)+10000)]
exec(compile(adapter,'private_adapter_argv.py','exec'))
'@
$launcher=ConvertTo-PythonBase64Launcher $privateCode 'private_wsl_argv.py'
$capture=Invoke-DeadlineProcess -Executable $Python -Arguments @('-B','-c',$launcher,$adapterEncoded,$probe,$probeInput) -WorkingDirectory $Scratch -Deadline (Get-ProcessDeadline -TimeoutMilliseconds 15000) -MaxOutputBytes 65536 -Cleanup Preserve
Check ($capture.ExitCode -eq 0 -and $capture.Stderr.Length -eq 0) 'private argv probe completed'
$record=ConvertFrom-ExactJson $capture.Stdout 'Private adapter argv';$actual=ConvertFrom-Json -InputObject $record.stdout
Check ($actual.Count -eq $cases.Count) ('private argv count '+$actual.Count+'/'+$cases.Count+' '+$record.stdout)
for($i=0;$i -lt $cases.Count;$i++){Check ([string]::Equals($actual[$i],$cases[$i],[StringComparison]::Ordinal)) ('private argv '+$i)}
# Encoding, output, zero-stderr, exact-command and timeout contracts execute the
# same embedded Python code without invoking Linux or sleeping.
$negativeCode=@'
import base64,contextlib,io,json,subprocess,sys,time
adapter=base64.b64decode(sys.argv[1]).decode('utf-8')
prefix=['-d','TERUISI-Pandas','-u','teruisi-pandas','--exec']
commands={
 'list':['--list','--running','--quiet'],
 'unit':prefix+['/usr/bin/env','-i','HOME=/home/teruisi-pandas','PATH=/usr/bin:/bin','XDG_RUNTIME_DIR=/run/user/1000','DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus','/usr/bin/systemctl','--user','show','teruisi-pandas.service','--property=ActiveState','--property=SubState','--property=MainPID','--property=ControlPID'],
 'containers':prefix+['/usr/bin/docker','--host=unix:///run/user/1000/docker.sock','ps','-aq','--filter','label=teruisi.pandas-broker=v1']}
def check(name,raw,stderr=b'',code=0,expect=True,timeout=False,expired=False):
 calls=[]
 def fake(command,**kw):
  calls.append(command)
  assert command==[r'C:\Windows\System32\wsl.exe']+commands[name]
  assert 0<kw['timeout']<=15 and kw['stdin']==subprocess.DEVNULL
  if timeout:raise subprocess.TimeoutExpired(command,kw['timeout'])
  return subprocess.CompletedProcess(command,code,raw,stderr)
 subprocess.run=fake
 sys.argv=['adapter',base64.b64encode(json.dumps(commands[name]).encode()).decode(),str(int(time.time()*1000)+(-1 if expired else 9999))]
 output=io.StringIO();exited=0
 with contextlib.redirect_stdout(output):
  try:exec(compile(adapter,'private_adapter_contract.py','exec'),{})
  except SystemExit as e:exited=e.code
 value=json.loads(output.getvalue())
 assert (exited==0 and value['status']=='verified') is expect
 if expect:
  assert value['stdoutBytes']==len(raw) and value['stderrBytes']==0 and value['command']==name
  assert '\x00' not in value['stdout']
 if expired:assert not calls
check('list','TERUISI-Pandas\r\n'.encode('utf-16-le'))
check('list',b'\xff\xfe'+'中文\r\n'.encode('utf-16-le'))
check('list',b'\xff\xfe\x00',expect=False)
check('unit',b'ActiveState=inactive\n')
check('containers',b'')
check('containers',b'x'*65537,expect=False)
check('unit',b'',stderr=b' ',expect=False)
check('unit',b'',code=127,expect=False)
check('unit',b'\xff',expect=False)
check('unit',b'',timeout=True,expect=False)
check('list',b'',expired=True,expect=False)
print('{"status":"passed"}')
'@
$launcher=ConvertTo-PythonBase64Launcher $negativeCode 'private_wsl_contract.py'
$capture=Invoke-DeadlineProcess -Executable $Python -Arguments @('-B','-c',$launcher,$adapterEncoded) -WorkingDirectory $Scratch -Deadline (Get-ProcessDeadline -TimeoutMilliseconds 15000) -MaxOutputBytes 65536 -Cleanup Preserve
Check ($capture.ExitCode -eq 0 -and $capture.Stderr.Length -eq 0) 'private adapter contracts'
$previous=$env:TERUISI_PROCESS_DEADLINE_UNIX_MS
try{$env:TERUISI_PROCESS_DEADLINE_UNIX_MS=[string]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()-1);Reject {Invoke-Pi150WslRead @('--list','--running','--quiet') (Get-ProcessDeadline -TimeoutMilliseconds 15000)} 'inherited deadline'}finally{$env:TERUISI_PROCESS_DEADLINE_UNIX_MS=$previous}
('PI150_WSL_TRANSPORT_PASSED PS'+$PSVersionTable.PSVersion.Major+' list/unit/containers=verified argv/UTF16/limits/deadline=verified')
'''


PS_SCRIPT = r'''
param($Source,$Scratch)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
function Check($ok,$label){if(-not $ok){throw ('Check failed: '+$label)}}
function Reject([scriptblock]$call,$label){$failed=$false;try{& $call}catch{$failed=$true};Check $failed ('expected rejection: '+$label)}
function Load($file,$names){
 $errors=$null;$ast=[Management.Automation.Language.Parser]::ParseFile($file,[ref]$null,[ref]$errors)
 Check ($errors.Count -eq 0) ('source syntax '+$file)
 foreach($name in $names){$fn=$ast.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name},$true);Check ($null -ne $fn) $name;$text=$fn.Extent.Text.Replace(('function '+$name),('function script:'+$name));$text=$text.Replace(". (Join-Path `$ExecutionRoot 'tools\pi150-failed-start-recovery.ps1')",'# private fixture already loaded the recovery functions');Invoke-Expression $text}
}
$django=Join-Path $Source 'tools\django-local-service.ps1'
Load $django @('Get-CanonicalPath','Test-ExactObjectPropertyNames','Get-FileSha256','Wait-AutomationActivityLock','Wait-AutomationDrain','Begin-SystemMaintenance','Assert-AbsentHelperRecoveryBindings')
. (Join-Path $Source 'tools\pi150-failed-start-recovery.ps1')
$originalHash=${function:Get-FileSha256}
$pins=Get-Pi150FailedStartRecoveryFixedPins
Check (@($pins.PSObject.Properties).Count -ge 24) 'original fixed proof closure'
foreach($entry in $pins.PSObject.Properties){Check ($entry.Value -cmatch '^[a-f0-9]{64}$') 'fixed original digest'}
# All native reads below use private seams. No production JSON is opened.
Assert-Pi150FailedStartRecoveryProcessInventory @([pscustomobject]@{ProcessId=10;Name='idle.exe'}) @() @()
foreach($id in @(38776,54580,54152,63044)){
 Reject {Assert-Pi150FailedStartRecoveryProcessInventory @([pscustomobject]@{ProcessId=$id;Name='idle.exe'}) @() @()} 'original PID or reuse'
 Reject {Assert-Pi150FailedStartRecoveryProcessInventory @([pscustomobject]@{ProcessId=15;ParentProcessId=$id;Name='idle.exe'}) @() @()} 'late descendant'
}
foreach($port in @(3000,5791,8111,8121)){
 Reject {Assert-Pi150FailedStartRecoveryProcessInventory @() @([pscustomobject]@{Port=$port;Address='::'}) @()} 'full-address app listener'
}
foreach($entry in @(
 [pscustomobject]@{ProcessId=10;Name='node.exe';CommandLine=$null;ExecutablePath=$null},
 [pscustomobject]@{ProcessId=10;Name='powershell.exe';CommandLine='powershell -EncodedCommand QQ==';ExecutablePath='C:\powershell.exe'},
 [pscustomobject]@{ProcessId=10;Name='pwsh.exe';CommandLine='pwsh -ec QQ==';ExecutablePath='C:\pwsh.exe'},
 [pscustomobject]@{ProcessId=10;Name='python.exe';CommandLine='python D:/teruisi-runtime/django-sales/task.py';ExecutablePath='C:\python.exe'},
 [pscustomobject]@{ProcessId=10;Name='node.exe';CommandLine='node worker-local-runtime-supervisor.mjs';ExecutablePath='C:\node.exe'},
 [pscustomobject]@{ProcessId=10;Name='wsl.exe';CommandLine='wsl -d TERUISI-Pandas';ExecutablePath='C:\wsl.exe'})){
 Reject {Assert-Pi150FailedStartRecoveryProcessInventory @($entry) @() @()} 'late/opaque participant'
}
Assert-Pi150FailedStartRecoveryProcessInventory @([pscustomobject]@{ProcessId=10;Name='powershell.exe'}) @() @(10)
# Reproduce the observed 63044 reuse with its actual birth/image/command. A PID
# number alone cannot turn this CUA host or its later children into old publisher.
$actors=@(
 [pscustomobject]@{processId=54152;creationDate='2026-10-17T10:38:33.0208100Z';executablePath='C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe';commandLine='original bound encoded maintenance'},
 [pscustomobject]@{processId=63044;creationDate='2026-10-17T10:29:04.3368730Z';executablePath='C:\Program Files\nodejs\node.exe';commandLine='original bound publisher'},
 [pscustomobject]@{processId=38776;startedAt='2026-10-17T11:01:54.171Z';exitedAt='2026-10-17T11:04:31.123Z'},
 [pscustomobject]@{processId=54580;startedAt='2026-10-17T11:01:54.171Z';exitedAt='2026-10-17T11:04:31.123Z'})
$reused=[pscustomobject]@{ProcessId=63044;ParentProcessId=1;Name='node.exe';CreationDate=[DateTimeOffset]::Parse('2026-10-17T19:49:28.268143+08:00').UtcDateTime;ExecutablePath='C:\Users\86137\AppData\Local\OpenAI\Codex\runtimes\cua_node\78fb63cda1a9e2b2\bin\node.exe';CommandLine='"C:\Users\86137\AppData\Local\OpenAI\Codex\runtimes\cua_node\78fb63cda1a9e2b2\bin\node.exe"  ./server.mjs '}
Assert-Pi150FailedStartRecoveryProcessInventory @($reused) @() @() $actors
foreach($id in @(54152,63044,38776,54580)){
 $row=$reused|Select-Object *;$row.ProcessId=$id
 Assert-Pi150FailedStartRecoveryProcessInventory @($row) @() @() $actors
 $scoped=$row|Select-Object *;$scoped.CommandLine='node D:\teruisi-runtime\django-sales\late.js'
 Reject {Assert-Pi150FailedStartRecoveryProcessInventory @($scoped) @() @() $actors} 'four proven reuses retain runtime scope rejection'
 $encoded=$row|Select-Object *;$encoded.Name='powershell.exe';$encoded.CommandLine='powershell -EncodedCommand QQ=='
 Reject {Assert-Pi150FailedStartRecoveryProcessInventory @($encoded) @() @() $actors} 'four proven reuses retain encoded rejection'
}
foreach($birth in @([DateTimeOffset]::Parse($actors[1].creationDate).UtcDateTime,[DateTimeOffset]::Parse($actors[1].creationDate).UtcDateTime.AddSeconds(-1),$null,'2026-10-17T20:00:00Z')){
 $row=$reused|Select-Object *;$row.CreationDate=$birth
 Reject {Assert-Pi150FailedStartRecoveryProcessInventory @($row) @() @() $actors} 'original/same/earlier/unknown birth'
}
foreach($field in @('ExecutablePath','CommandLine')){
 $row=$reused|Select-Object *;$row.$field=$null
 Reject {Assert-Pi150FailedStartRecoveryProcessInventory @($row) @() @() $actors} 'reused PID metadata unreadable'
 $row.$field=@('fixture')
 Reject {Assert-Pi150FailedStartRecoveryProcessInventory @($row) @() @() $actors} 'reused PID metadata array'
}
$child=[pscustomobject]@{ProcessId=88;ParentProcessId=63044;Name='idle.exe';CreationDate=$reused.CreationDate.AddSeconds(1)}
Assert-Pi150FailedStartRecoveryProcessInventory @($reused,$child) @() @() $actors
$grandchild=[pscustomobject]@{ProcessId=89;ParentProcessId=88;Name='idle.exe';CreationDate=$child.CreationDate.AddSeconds(1)}
Assert-Pi150FailedStartRecoveryProcessInventory @($reused,$child,$grandchild) @() @() $actors
foreach($birth in @([DateTimeOffset]::Parse('2026-10-17T10:30:00Z').UtcDateTime,$reused.CreationDate,$null)){
 $row=$child|Select-Object *;$row.CreationDate=$birth
 Reject {Assert-Pi150FailedStartRecoveryProcessInventory @($reused,$row) @() @() $actors} 'possible original or unordered descendant'
}
$before=$child|Select-Object *;$before.CreationDate=[DateTimeOffset]::Parse($actors[1].creationDate).UtcDateTime.AddSeconds(-1)
Assert-Pi150FailedStartRecoveryProcessInventory @($reused,$before) @() @() $actors
Reject {Assert-Pi150FailedStartRecoveryProcessInventory @($child) @() @() $actors} 'missing current parent supplies no reuse upper bound'
Reject {Assert-Pi150FailedStartRecoveryProcessInventory @($reused,$reused) @() @() $actors} 'duplicate current PID'
foreach($id in @(38776,54580)){
 $row=$reused|Select-Object *;$row.ProcessId=$id
 Assert-Pi150FailedStartRecoveryProcessInventory @($row) @() @() $actors
 $row.CreationDate=[DateTimeOffset]::Parse('2026-10-17T11:04:31.123Z').UtcDateTime.AddTicks(1)
 Assert-Pi150FailedStartRecoveryProcessInventory @($row) @() @() $actors
 foreach($birth in @([DateTimeOffset]::Parse('2026-10-17T11:04:31.123Z').UtcDateTime,[DateTimeOffset]::Parse('2026-10-17T11:03:00Z').UtcDateTime,$null)){
  $uncertain=$row|Select-Object *;$uncertain.CreationDate=$birth
  Reject {Assert-Pi150FailedStartRecoveryProcessInventory @($uncertain) @() @() $actors} 'strict original direct-exit upper bound'
 }
}
foreach($command in @('node D:\teruisi-runtime\django-sales\task.js','node D:\codex-isolated\main-release-packages\f3748d8e03e2-60dc61d1-622cb632\source\tools\publish-main.mjs')){
 $row=$reused|Select-Object *;$row.CommandLine=$command
 Reject {Assert-Pi150FailedStartRecoveryProcessInventory @($row) @() @() $actors} 'proven reuse still rejects related scope'
}
$row=$reused|Select-Object *;$row.Name='powershell.exe';$row.CommandLine='powershell -EncodedCommand QQ=='
Reject {Assert-Pi150FailedStartRecoveryProcessInventory @($row) @() @() $actors} 'proven reuse still rejects unknown encoded control'
# The fixed, installed query-only library observes this private test actor only.
# No service PID or production lifecycle is touched, and its function overrides
# must stay in the wrapper's child scope.
. (Join-Path $Source 'tools\process-deadline.ps1')
$self=CimCmdlets\Get-CimInstance Win32_Process -Filter ('ProcessId='+$PID) -ErrorAction Stop
$opaque=$self|Select-Object *;$opaque.ExecutablePath=$null;$opaque.CommandLine=$null
function Resolve-OwnedProcess{return 'private-sentinel'}
$script:ReadonlyCensus=[pscustomobject]@{fixture='preserved'}
$completed=Complete-Pi150FailedStartRecoveryProcessMetadata $opaque
Check ($completed.ProcessId -eq $PID -and $completed.CreationDate -eq $self.CreationDate -and $completed.ExecutablePath -and $completed.CommandLine) 'native metadata supplements private actor'
Check ((Resolve-OwnedProcess) -ceq 'private-sentinel') 'overlay replacements stay child scoped'
Check ($script:ReadonlyCensus.fixture -ceq 'preserved') 'readonly census restored'
$completed=Complete-Pi150FailedStartRecoveryProcessMetadata $self
Check ($completed.ProcessId -eq $PID -and $completed.CommandLine) 'complete CIM identity still has stable native observation'
Remove-Variable -Name ReadonlyCensus -Scope Script
$script:events=[Collections.Generic.List[string]]::new()
$RuntimeRoot='D:\teruisi-runtime\django-sales';$RunDirectory=$Scratch;$ExecutionRoot=$Source
$Action='BeginMaintenance';$KeepPostgres=$true;$MaintenanceId='ca1bc9efd18d4263aeb298353ca93714'
$RecoveryProofPath='D:\codex-artifacts\pi-publish-recovery-20261017-v4\absent-helper-proof.json';$RecoveryProofSha256='a'*64
$Utf8NoBom=[Text.UTF8Encoding]::new($false)
$script:gate=$null;$script:maintenance=$null;$script:late=$false
$script:execution=[pscustomobject]@{}
foreach($name in @('pi150-failed-start-recovery.ps1','django-local-service.ps1','integration_release_gate.py')){
 $script:execution|Add-Member -NotePropertyName (Join-Path $Source ('tools\'+$name)) -NotePropertyValue ('b'*64)
}
$script:resolved=[pscustomobject]@{status='resolved';releaseId='20261017T100706Z-1090ea88f6fe3094';manifestSha256='5bc9c99602822aa3342e1548e33a7b2ba2b42bb1a446af381bfdcf6a4203041d';guardReceiptSha256=('c'*64);chainStateSha256=('d'*64);successorCount=245}
$script:proof=[pscustomobject]@{version='teruisi-pi150-failed-start-absent-helper-v1';operationId=$MaintenanceId;recoveryAttemptId=('f'*32);files=$pins;executionFiles=$script:execution;preparedAppId=('e'*32);preparedAppSha256=('a'*64);workerResolved=($script:resolved|ConvertTo-Json|ConvertFrom-Json);shortcut=[pscustomobject]@{path='fixture';sha256=('a'*64)};validation=[pscustomobject]@{path='fixture-validation';sha256=('a'*64)};ready=[pscustomobject]@{path='D:\codex-artifacts\pi-publish-recovery-20261017-v4\READY.json';sha256=('a'*64)}}
$script:ready=[pscustomobject]@{version='pi150-forward-recovery-v1';source=$Source;sourceIdentity=[pscustomobject]@{commit=('a'*40);tree=('b'*40)};pkg=[pscustomobject]@{id=('e'*32);receiptSha256=('a'*64)};predecessorDjangoSha256='67696b506801744faf048141b5b4e342e1afa062e48d97669f6e44cf3634fbc2';djangoManifestSha256=('b'*64);facts=[pscustomobject]@{maintenanceId=$MaintenanceId;schemaOperationId='ff28fd7d584547dea301b9f3561ae2aa'}}
$script:validation=[pscustomobject]@{version='teruisi-pi150-absent-helper-tests-v1';status='passed';productionTouched=$false;powershell5=$true;powershell7=$true;executionFiles=$script:execution}
function Get-Pi150FailedStartRecoveryExecutionFiles{return $script:execution}
function Read-AbsentHelperRecoveryJson($path,$sha){
 if($script:badPin -and $path -ceq $script:badPin){throw 'fixture pinned bytes changed'}
 if($path -ceq $RecoveryProofPath){return $script:proof}
 if($path -ceq 'fixture-validation'){return $script:validation}
 if($path -ceq $script:proof.ready.path){return $script:ready}
 if($path -like '*maintenance-first-actor.json'){return [pscustomobject]@{actor=$actors[0];rotationOwner=$actors[1]}}
 if($path -like '*FAILED.json'){return $script:originalFailure}
 if($path -like '*启动服务-started.json'){return [pscustomobject]@{at='2026-10-17T11:01:54.171Z';action='Start'}}
 return [pscustomobject]@{fixture=$true}
}
$script:originalFailure=[pscustomobject]@{at='2026-10-17T11:04:31.123Z';processEvidence=[pscustomobject]@{processId=54580;exitCode=1;stage='output';outputProtocol='direct-exit-files';engineFailure=[pscustomobject]@{processId=38776;exitCode=1;stage='completed';outputProtocol='direct-exit-file-snapshot'}}}
$originalActors=@(Get-Pi150FailedStartRecoveryOriginalActors)
Check ($originalActors.Count -eq 4 -and $originalActors[3].processId -eq 54580) 'original sealed actor lifetime records'
foreach($object in @($script:originalFailure.processEvidence,$script:originalFailure.processEvidence.engineFailure)){
 foreach($field in @('processId','exitCode','stage','outputProtocol')){
  $old=$object.$field;$object.$field=@($old);Reject {Get-Pi150FailedStartRecoveryOriginalActors} ('typed original exit field '+$field);$object.$field=$old
 }
}
$old=$script:originalFailure.at;$script:originalFailure.at='2026-10-17T11:04:32Z';Reject {Get-Pi150FailedStartRecoveryOriginalActors} 'original termination boundary changed';$script:originalFailure.at=$old
$script:originalFailure.at=@($old);Reject {Get-Pi150FailedStartRecoveryOriginalActors} 'original termination boundary nested array';$script:originalFailure.at=$old
function Read-JsonFile{return [pscustomobject]@{sourceRoot=$Source}}
function Get-PreparedApplication($id,$sha){if($script:badPrepared){throw 'fixture prepared app changed'};return (Join-Path $Scratch 'prepared')}
function Invoke-AbsentHelperRecoveryRead{return $script:resolved}
function Assert-Pi150FailedStartRecoveryShortcut{if($script:badShortcut){throw 'fixture shortcut changed'}}
function Assert-Pi150FailedStartRecoverySource{if($script:badSource){throw 'fixture source changed'}}
function Read-SystemMaintenance{return $script:maintenance}
function Read-AutomationDrain{return $script:gate}
function Assert-RuntimeChildPath($path){Check ([IO.Path]::GetFullPath($path).StartsWith([IO.Path]::GetFullPath($Scratch),[StringComparison]::OrdinalIgnoreCase)) 'private write path';return $path}
function Get-FileSha256($path){if($path.StartsWith($Scratch) -and (Test-Path -LiteralPath $path -PathType Leaf)){return & $originalHash $path};if($path -like '*pi_agent_addition.py'){return '7181c617189dac2f0760663453f88d12a682d326e2f562236c238e4526b0ef8c'};if($path -like '*watchdog-core-overlay.ps1'){return 'c86b635264807af5bb774863c7d525e4f7e6eed8ef418db9cdfa15e5bca4b183'};return 'b'*64}
function Assert-Pi150FailedStartRecoverySnapshot{if($script:late){throw 'fixture late actor'};$script:events.Add('snapshot')}
function Assert-Pi150FailedStartRecoveryPandas{if($script:badPandas){throw 'fixture pandas running'};$script:events.Add('linux')}
function Assert-AbsentHelperRecoveryWorkerOwner{if($script:badOwner){throw 'fixture owner missing'}}
[void](Assert-Pi150FailedStartRecoveryBindings 'Initial' $script:proof)
foreach($field in @('version','operationId','recoveryAttemptId','preparedAppId','preparedAppSha256')){
 $old=$script:proof.$field;$script:proof.$field=@($old);Reject {Assert-Pi150FailedStartRecoveryBindings 'Initial' $script:proof} ('nested identity array '+$field);$script:proof.$field=$old
}
$script:proof|Add-Member -NotePropertyName extra -NotePropertyValue 'x';Reject {Assert-Pi150FailedStartRecoveryBindings 'Initial' $script:proof} 'closed proof fields';$script:proof.PSObject.Properties.Remove('extra')
foreach($badCount in @('245',@(245),245.0,244)){
 $script:proof.workerResolved.successorCount=$badCount;Reject {Assert-Pi150FailedStartRecoveryBindings 'Initial' $script:proof} 'typed numeric successor count'
}
$script:proof.workerResolved.successorCount=[long]245;[void](Assert-Pi150FailedStartRecoveryBindings 'Initial' $script:proof)
$script:proof.workerResolved.successorCount=[int]245
$script:badPin=$pins.PSObject.Properties.Name[0];Reject {Assert-Pi150FailedStartRecoveryBindings 'Initial' $script:proof} 'original bytes changed';$script:badPin=$null
foreach($flag in @('badOwner','badPrepared','badShortcut','badSource','late','badPandas')){
 Set-Variable -Name $flag -Scope Script -Value $true
 $stage=if($flag -ceq 'badOwner'){'Requests'}else{'Initial'}
 Reject {Assert-Pi150FailedStartRecoveryBindings $stage $script:proof} $flag
 Set-Variable -Name $flag -Scope Script -Value $false
}
foreach($field in @('productionTouched','powershell5','powershell7')){
 $old=$script:validation.$field;$script:validation.$field=[string]$old;Reject {Assert-Pi150FailedStartRecoveryBindings 'Initial' $script:proof} 'typed validation bool';$script:validation.$field=$old
}
$script:gate=[pscustomobject]@{id=$MaintenanceId};Reject {Assert-Pi150FailedStartRecoveryBindings 'Initial' $script:proof} 'existing drain';$script:gate=$null
$script:maintenance=[pscustomobject]@{id=$MaintenanceId};Reject {Assert-Pi150FailedStartRecoveryBindings 'Initial' $script:proof} 'existing maintenance';$script:maintenance=$null
# Real create-only private intent plus original byte leases and final constructor.
function Set-AutomationDrainPhase($phase){$script:events.Add($phase);$script:gate=[pscustomobject]@{version='teruisi-automation-drain-v1';id=$MaintenanceId;runtimeRoot=$RuntimeRoot;phase=$phase;keepPostgres=$true;createdAt='2026-10-17T12:00:00Z'}}
function Invoke-BackupConsoleMaintenanceFence([scriptblock]$Operation){$script:events.Add('backup');if($script:busyBackup){throw 'Backup task is still active or unresolved; maintenance refused'};& $Operation}
$script:events.Clear();Wait-Pi150FailedStartRecoveryDrain 1 $script:proof
Check (($script:events -join ',') -ceq 'snapshot,linux,snapshot,helpers,backup,requests,snapshot,linux,snapshot') 'real helper/request recovery order'
$intent=Join-Path $Scratch ('pi150-failed-start-recovery-'+$MaintenanceId+'.intent.json')
Check (Test-Path -LiteralPath $intent -PathType Leaf) 'durable intent'
Reject {Wait-Pi150FailedStartRecoveryDrain 1 $script:proof} 'same intent cannot replay'
[void](Assert-Pi150FailedStartRecoveryBindings 'Requests' $script:proof)
$context=$script:Pi150FailedStartRecoveryContext;$script:Pi150FailedStartRecoveryContext=$null
Reject {Assert-Pi150FailedStartRecoveryBindings 'Final' $script:proof} 'new process cannot adopt intent';$script:Pi150FailedStartRecoveryContext=$context
foreach($field in @('version','id','runtimeRoot','phase','createdAt','keepPostgres')){
 $old=$script:gate.$field;$script:gate.$field=@($old);Reject {Assert-Pi150FailedStartRecoveryBindings 'Final' $script:proof} ('nested gate array '+$field);$script:gate.$field=$old
}
[IO.File]::AppendAllText($intent,' ');Reject {Assert-Pi150FailedStartRecoveryBindings 'Final' $script:proof} 'intent drift'
Remove-Item -LiteralPath $intent;$script:gate=$null;$script:Pi150FailedStartRecoveryContext=$null
$script:busyBackup=$true;Reject {Wait-Pi150FailedStartRecoveryDrain 0 $script:proof} 'backup fence'
Check ($script:gate.phase -ceq 'helpers') 'failed backup remains helper admission'
Reject {Wait-Pi150FailedStartRecoveryDrain 0 $script:proof} 'failed intent cannot replay'
$script:busyBackup=$false
foreach($name in @('automation-background.lock','automation-activity.lock')){
 Remove-Item -LiteralPath $intent;$script:gate=$null;$script:Pi150FailedStartRecoveryContext=$null
 $held=[IO.FileStream]::new((Join-Path $Scratch $name),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::ReadWrite)
 try{$held.Lock(0,1);Reject {Wait-Pi150FailedStartRecoveryDrain 0 $script:proof} ('held '+$name)}finally{$held.Unlock(0,1);$held.Dispose()}
 Check (Test-Path -LiteralPath $intent) 'held lease retains intent'
}
Remove-Item -LiteralPath $intent;$script:gate=$null;$script:Pi150FailedStartRecoveryContext=$null
# Invoke the real original marker constructor with private seams only.
function Assert-DeployedApplication{}
function Assert-RuntimeAclHardened{}
function Test-Path{param($LiteralPath,$PathType);if($LiteralPath -like '*automation_drain.py'){return $true};return Microsoft.PowerShell.Management\Test-Path -LiteralPath $LiteralPath}
function Invoke-AutomationPgDrainFence([scriptblock]$Operation){$script:events.Add('pg');& $Operation}
function Write-AtomicJson($path,$record){Check ($path -ceq (Join-Path $Scratch 'system-maintenance.json')) 'original private marker path';$script:events.Add('marker')}
function Write-LauncherEvent{}
$MaintenancePath=Join-Path $Scratch 'system-maintenance.json'
$script:events.Clear();Begin-SystemMaintenance
Check (($script:events -join ',') -ceq 'snapshot,linux,snapshot,helpers,backup,requests,snapshot,linux,snapshot,pg,backup,snapshot,linux,snapshot,marker') 'original fenced constructor only'
Remove-Item -LiteralPath $intent;$script:gate=$null;$script:Pi150FailedStartRecoveryContext=$null
$script:lateOnFinal=$true
function Invoke-AutomationPgDrainFence([scriptblock]$Operation){$script:events.Add('pg');$script:late=$true;& $Operation}
$script:events.Clear();Reject {Begin-SystemMaintenance} 'late process at final PG fence'
Check (-not $script:events.Contains('marker')) 'late drift cannot create maintenance marker'
Check (Test-Path -LiteralPath $intent) 'late drift keeps unknown intent'
'PI150_PRIVATE_CONTRACTS_PASSED'
'''


if __name__ == "__main__":
    unittest.main()
