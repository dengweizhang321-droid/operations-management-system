"""Actual PS5/PS7 parameter blocks and Worker -> Django library routing.

The debugger stops inside a private-runtime mutex before lifecycle bodies. It
never substitutes a successful native maintenance result or touches production.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class Pi150RecoveryEntryTests(unittest.TestCase):
    def test_actual_entry_and_cross_file_routes(self):
        shells = [r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe", shutil.which("pwsh.exe")]
        self.assertTrue(all(shells), "Both PowerShell runtimes are required")
        for shell in shells:
            with self.subTest(shell=shell), tempfile.TemporaryDirectory(prefix="pi150-entry-") as tmp:
                script = Path(tmp) / "entry.ps1"
                script.write_text(PS_SCRIPT, encoding="utf-8-sig")
                env = dict(os.environ)
                env.pop("TERUISI_DJANGO_SERVICE_LIBRARY_ONLY", None)
                result = subprocess.run([shell, "-NoProfile", "-NonInteractive", "-File", str(script), str(ROOT), tmp],
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, encoding="utf-8", errors="replace", timeout=90, env=env)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertIn("PI150_ACTUAL_ENTRY_ROUTES_PASSED", result.stdout)
                for protocol in ("legacy", "pi"):
                    for route in ("BeginMaintenance", "CompleteDrain", "EndMaintenance"):
                        private = Path(tmp) / (protocol + "-" + route)
                        private.mkdir()
                        capture = private / "route.json"
                        result = subprocess.run([shell, "-NoProfile", "-NonInteractive", "-File", str(script), str(ROOT), str(private), protocol + ":" + route, str(capture)],
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, encoding="utf-8", errors="replace", timeout=30, env=env)
                        self.assertEqual(result.returncode, 17, result.stdout + result.stderr)
                        record = json.loads(capture.read_text(encoding="utf-8"))
                        self.assertEqual(record["action"], route)
                        self.assertEqual(record["runtime"], str(private))
                        self.assertEqual(record["maintenance"], "ca1bc9efd18d4263aeb298353ca93714" if protocol == "pi" else "779dd3efea0e485aa58aac3acc9e324f")
                        self.assertEqual(record["keepPostgres"], route == "BeginMaintenance")
                        expected_proof = (r"D:\codex-artifacts\pi-publish-recovery-20261017-v4\absent-helper-proof.json" if protocol == "pi"
                                          else r"D:\codex-artifacts\jd-bi-readiness-20261016\recovery-proof.json")
                        self.assertEqual(record["proof"], expected_proof if route == "BeginMaintenance" else "")
                        self.assertEqual(record["sha"], "a" * 64 if route == "BeginMaintenance" else "")
                        self.assertEqual(record["ownerVerified"], route == "BeginMaintenance")
                        self.assertEqual(Path(record["controller"]), ROOT / "tools" / "django-local-service.ps1")
                        self.assertFalse((private / "run").exists())


PS_SCRIPT = r'''
param($Source,$Scratch,$Route='',$Capture='')
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
function Check($ok,$label){if(-not $ok){throw ('Check failed: '+$label)}}
function Reject([scriptblock]$call,$label){$failed=$false;try{& $call}catch{$failed=$true};Check $failed ('expected rejection: '+$label)}
$worker=Join-Path $Source 'tools\worker-local-service.ps1'
$django=Join-Path $Source 'tools\django-local-service.ps1'
$legacy='779dd3efea0e485aa58aac3acc9e324f';$pi='ca1bc9efd18d4263aeb298353ca93714'
$legacyProof='D:\codex-artifacts\jd-bi-readiness-20261016\recovery-proof.json'
$piProof='D:\codex-artifacts\pi-publish-recovery-20261017-v4\absent-helper-proof.json'
if($Route){
 $parts=$Route.Split(':');$id=if($parts[0] -ceq 'pi'){$pi}else{$legacy};$proof=if($parts[0] -ceq 'pi'){$piProof}else{$legacyProof}
 . $worker -Action EnterMaintenance -KeepPostgres -MaintenanceId $id -RecoveryProofPath $proof -RecoveryProofSha256 ('a'*64) -FunctionsOnly
 $RuntimeRoot=$Scratch;$AllowTestRuntimeRoot=$true;$FixedDjangoRuntimeRoot=$Scratch;$DjangoService=$django
 $lease=Enter-WorkerServiceMutex;$ServiceMutex=$lease.Mutex;$lockAcquired=$true
 $global:CaptureFile=$Capture
 $stop=if($parts[1] -ceq 'BeginMaintenance'){'Begin-SystemMaintenance'}elseif($parts[1] -ceq 'CompleteDrain'){'Complete-AutomationMaintenanceStop'}else{'End-SystemMaintenance'}
 $bp=Set-PSBreakpoint -Command $stop -Action {
  $verified=$false;if($Action -ceq 'BeginMaintenance'){Assert-AbsentHelperRecoveryWorkerOwner;$verified=$true}
  $target=if($Action -ceq 'BeginMaintenance'){'Begin-SystemMaintenance'}elseif($Action -ceq 'CompleteDrain'){'Complete-AutomationMaintenanceStop'}else{'End-SystemMaintenance'}
  $record=[pscustomobject]@{action=$Action;runtime=$RuntimeRoot;maintenance=$MaintenanceId;keepPostgres=[bool]$KeepPostgres;proof=$RecoveryProofPath;sha=$RecoveryProofSha256;ownerVerified=$verified;controller=(Get-Command $target -CommandType Function).ScriptBlock.File}
  [IO.File]::WriteAllText($global:CaptureFile,($record|ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false))
  # Exit this private child at the debugger boundary, before any lifecycle
  # body. Throwing from a breakpoint action can be swallowed by the debugger.
  [Environment]::Exit(17)
 }
 Invoke-DjangoLifecycleAction $parts[1] $id -PreservePostgres:($parts[1] -ceq 'BeginMaintenance')
 throw 'Private child did not stop before the real lifecycle body'
}
# Execute the complete original Worker script, returning at its real existing
# FunctionsOnly boundary before public lifecycle dispatch or production locks.
foreach($id in @($legacy,$pi)){
 $proof=if($id -ceq $pi){$piProof}else{$legacyProof}
 & $worker -Action EnterMaintenance -KeepPostgres -MaintenanceId $id -RecoveryProofPath $proof -RecoveryProofSha256 ('a'*64) -FunctionsOnly
}
foreach($case in @(
 @{Action='Status';MaintenanceId=$pi;RecoveryProofPath=$piProof;RecoveryProofSha256=('a'*64);KeepPostgres=$true},
 @{Action='EnterMaintenance';MaintenanceId=('f'*32);RecoveryProofPath=$piProof;RecoveryProofSha256=('a'*64);KeepPostgres=$true},
 @{Action='EnterMaintenance';MaintenanceId=$pi;RecoveryProofPath=$piProof;RecoveryProofSha256=('a'*64);KeepPostgres=$false},
 @{Action='EnterMaintenance';MaintenanceId=$pi;RecoveryProofPath=$piProof;RecoveryProofSha256='bad';KeepPostgres=$true},
 @{Action='EnterMaintenance';MaintenanceId=$pi;RecoveryProofPath=$piProof;KeepPostgres=$true},
 @{Action='EnterMaintenance';MaintenanceId=$pi;RecoveryProofSha256=('a'*64);KeepPostgres=$true},
 @{Action='EnterMaintenance';MaintenanceId=$pi;RecoveryProofPath=$legacyProof;RecoveryProofSha256=('a'*64);KeepPostgres=$true},
 @{Action='EnterMaintenance';MaintenanceId=$pi;RecoveryProofPath=$piProof.Replace('-v4\','-v3\');RecoveryProofSha256=('a'*64);KeepPostgres=$true},
 @{Action='EnterMaintenance';MaintenanceId=$pi;RecoveryProofPath=$piProof;RecoveryProofSha256=('a'*64);KeepPostgres=$true;AllowTestRuntimeRoot=$true})){
 Reject {& $worker @case -FunctionsOnly} 'actual Worker parameter guard'
}
# The Pi entry also requires its same-source controller and bridge. These are
# byte copies in a private tree, never replacements under the installed app.
$detached=Join-Path $Scratch 'detached';New-Item -ItemType Directory -Path $detached|Out-Null
$detachedWorker=Join-Path $detached 'worker-local-service.ps1'
Copy-Item -LiteralPath $worker -Destination $detachedWorker
Copy-Item -LiteralPath (Join-Path $Source 'tools\process-deadline.ps1') -Destination (Join-Path $detached 'process-deadline.ps1')
Reject {& $detachedWorker -Action EnterMaintenance -KeepPostgres -MaintenanceId $pi -RecoveryProofPath $piProof -RecoveryProofSha256 ('a'*64) -FunctionsOnly} 'missing same-source Django controller'
Copy-Item -LiteralPath $django -Destination (Join-Path $detached 'django-local-service.ps1')
Reject {& $detachedWorker -Action EnterMaintenance -KeepPostgres -MaintenanceId $pi -RecoveryProofPath $piProof -RecoveryProofSha256 ('a'*64) -FunctionsOnly} 'missing same-source Pi bridge'
# Actual complete Django library: proof requests are internal, exact-ID and
# preserve-PG only. Nothing below calls its public CLI dispatcher.
foreach($id in @($legacy,$pi)){
 $proof=if($id -ceq $pi){$piProof}else{$legacyProof}
 & {$env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY='1';. $django -RuntimeRoot $Scratch -MaintenanceId $id -KeepPostgres -RecoveryProofPath $proof -RecoveryProofSha256 ('a'*64)}
}
foreach($case in @(
 @{MaintenanceId=('f'*32);KeepPostgres=$true;RecoveryProofPath=$piProof;RecoveryProofSha256=('a'*64)},
 @{MaintenanceId=$pi;KeepPostgres=$false;RecoveryProofPath=$piProof;RecoveryProofSha256=('a'*64)},
 @{MaintenanceId=$pi;KeepPostgres=$true;RecoveryProofPath=$legacyProof;RecoveryProofSha256=('a'*64)},
 @{MaintenanceId=$pi;KeepPostgres=$true;RecoveryProofPath=$piProof;RecoveryProofSha256='bad'})){
 Reject {& {$env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY='1';. $django -RuntimeRoot $Scratch @case}} 'actual Django internal guard'
}
Reject {& {$env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY='';. $django -RuntimeRoot $Scratch -MaintenanceId $pi -KeepPostgres -RecoveryProofPath $piProof -RecoveryProofSha256 ('a'*64)}} 'actual Django public proof rejected'
$env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY='private-original-value'
& {
 . $worker -Action EnterMaintenance -KeepPostgres -MaintenanceId $pi -RecoveryProofPath $piProof -RecoveryProofSha256 ('a'*64) -FunctionsOnly
 Reject {Invoke-DjangoLifecycleAction 'BeginMaintenance' $legacy -PreservePostgres} 'Begin operation changed after parameter guard'
 Reject {Invoke-DjangoLifecycleAction 'BeginMaintenance' $pi} 'Begin PG scope changed after parameter guard'
 $FixedDjangoRuntimeRoot=$Scratch
 Reject {Invoke-DjangoLifecycleAction 'BeginMaintenance' $pi -PreservePostgres} 'real private undeployed app fails before marker'
 Check ($env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY -ceq 'private-original-value') 'real library environment restored after failure'
}
Check (-not (Test-Path -LiteralPath (Join-Path $Scratch 'run'))) 'no lifecycle marker or intent written'
'PI150_ACTUAL_ENTRY_ROUTES_PASSED'
'''


if __name__ == "__main__":
    unittest.main()
