"""Execute real top-level django-ai entry in PS5/PS7 with private native seams.

Installed ACL/manifest authority and native execution are fixture boundaries; the
actual parameter binding, candidate/installed gate, Get-PreparedApplication,
receipt CAS, full source equivalence and action dispatch execute unmodified.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


@unittest.skipUnless(os.name=='nt','Windows native entry proof')
class UpgradeEntryTests(unittest.TestCase):
    def test_actual_top_level_candidate_admission_and_apply_rejection(self):
        repo=Path(__file__).resolve().parents[2]
        shells=[Path(os.environ['SystemRoot'])/'System32/WindowsPowerShell/v1.0/powershell.exe',
                Path('D:/codex-isolated/main-manual-release-20261016/control-host/pwsh.exe')]
        for shell in shells:
            self.assertTrue(shell.is_file(),str(shell))
            with self.subTest(shell=str(shell)),tempfile.TemporaryDirectory(prefix='pi-entry-') as folder:
                base=Path(folder);source=base/'source';runtime=base/'runtime';prepared=runtime/('app.deploy-'+'c'*32)
                for root in (source,prepared):
                    for name in ('backend','tools','config','drizzle'):(root/name).mkdir(parents=True,exist_ok=True)
                    (root/'backend/fixture.py').write_text('FIXTURE=1\n')
                (runtime/'app').mkdir();(runtime/'app/deployment.json').write_text('{"fixture":"installed"}')
                (runtime/'config').mkdir();(runtime/'secrets').mkdir()
                key=runtime/'secrets/pi-agent.dpapi.json';key.write_text('private-fixture-key')
                config={'version':1,'enabled':True,'keyFileSha256':hashlib.sha256(key.read_bytes()).hexdigest(),
                        'channelKeySha256':'a'*64,'skillVersion':'1.0.0','authorityEpoch':'synthetic','cutoverId':'synthetic',
                        'runnerImage':'sha256:'+'b'*64,'runnerSourceSha256':'d'*64}
                (runtime/'config/pi-agent.json').write_text(json.dumps(config))
                ai=(repo/'tools/django-ai.ps1').read_text(encoding='utf-8-sig')
                controller=(repo/'tools/django-local-service.ps1').read_text(encoding='utf-8-sig')
                seams=r'''
function Assert-DeployedApplication { if(-not(Test-Path -LiteralPath $DeploymentManifestPath)){throw 'missing fixture predecessor'} }
function Assert-RuntimeAclHardened { if(-not(Test-Path -LiteralPath $RuntimeRoot -PathType Container)){throw 'missing private runtime'} }
function Get-InstalledApplicationBinding { Get-FileSha256 $DeploymentManifestPath }
function Assert-ApplicationTreeManifest([string]$Root,[string]$Label) { Read-JsonFile (Join-Path $Root 'deployment.json') $Label }
function Invoke-WithServiceMutex([scriptblock]$Operation) { & $Operation }
function Write-LauncherEvent { }
function Set-RuntimeAcl { }
function Assert-ExactRuntimeAclEntry($Item,$Acl,$Allowed,$Root) { if(-not $Item.FullName.StartsWith($Root)){throw 'fixture ACL boundary escape'} }
function Invoke-BoundedNativeProcess($Executable,$Arguments,$WorkingDirectory) {
 $row=@{arguments=@($Arguments);workingDirectory=$WorkingDirectory}
 Add-Content -LiteralPath (Join-Path $RuntimeRoot 'native-calls.jsonl') -Value ($row|ConvertTo-Json -Compress)
 if($Arguments -contains '-c'){return [pscustomobject]@{ExitCode=0;Output=@(('a'*64))}}
 $value=if($Arguments -contains 'check'){@{prepared=$true;checked=$true;started=$false;registeredPlanSha256=('e'*64);sourceSha256=('a'*64);image=('sha256:'+('f'*64))}}else{@{prepared=$true;started=$false;registeredPlanSha256=('e'*64);sourceSha256=('a'*64);image=('sha256:'+('f'*64))}}
 return [pscustomobject]@{ExitCode=0;Output=@(($value|ConvertTo-Json -Compress))}
}
'''
                marker='if ($env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY -ne "1") {'
                self.assertIn(marker,controller);controller=controller.replace(marker,seams+'\n'+marker)
                for root in (source,prepared):
                    (root/'tools/django-ai.ps1').write_text(ai,encoding='utf-8-sig')
                    (root/'tools/django-local-service.ps1').write_text(controller,encoding='utf-8-sig')
                    (root/'tools/pi_agent_upgrade_runtime.py').write_bytes((repo/'tools/pi_agent_upgrade_runtime.py').read_bytes())
                manifest={'version':2,'sourceRoot':str(source),'fixture':'prepared'}
                (prepared/'deployment.json').write_text(json.dumps(manifest))
                receipt={'version':'teruisi-django-prepared-app-v1','id':'c'*32,'runtimeRoot':str(runtime),
                    'predecessorManifestSha256':hashlib.sha256((runtime/'app/deployment.json').read_bytes()).hexdigest(),
                    'candidateManifestSha256':hashlib.sha256((prepared/'deployment.json').read_bytes()).hexdigest()}
                receipt_path=runtime/('app.prepare-'+'c'*32+'.json');receipt_path.write_text(json.dumps(receipt))
                approved=hashlib.sha256(receipt_path.read_bytes()).hexdigest();calls=runtime/'native-calls.jsonl'
                common=[str(shell),'-NoProfile','-NonInteractive','-File',str(source/'tools/django-ai.ps1'),'-RuntimeRoot',str(runtime),
                    '-PiPreparedAppId','c'*32,'-PiPreparedAppSha256',approved,'-Json']
                result=subprocess.run(common+['-Action','PreparePiUpgrade','-PiImage','sha256:'+'f'*64],capture_output=True)
                self.assertEqual(result.returncode,0,result.stderr.decode(errors='replace'))
                events=[json.loads(line) for line in calls.read_text(encoding='utf-8-sig').splitlines()]
                self.assertEqual(len(events),2)
                self.assertTrue(all(row['workingDirectory']==str(prepared/'backend') for row in events))
                self.assertIn(str(prepared/'tools/pi_agent_upgrade_runtime.py'),events[-1]['arguments'])
                calls.unlink()
                checked=subprocess.run(common+['-Action','PiUpgradeCheck','-PiUpgradePlanSha256','e'*64],capture_output=True)
                self.assertEqual(checked.returncode,0,checked.stderr.decode(errors='replace'))
                self.assertEqual(len(calls.read_text(encoding='utf-8-sig').splitlines()),1);calls.unlink()
                denied=subprocess.run(common+['-Action','UpgradePi','-PiUpgradePlanSha256','e'*64],capture_output=True)
                self.assertNotEqual(denied.returncode,0);self.assertFalse(calls.exists())
                # A source change must be rejected before any native command.
                (source/'backend/fixture.py').write_text('CHANGED=1\n')
                denied=subprocess.run(common+['-Action','PreparePiUpgrade','-PiImage','sha256:'+'f'*64],capture_output=True)
                self.assertNotEqual(denied.returncode,0);self.assertFalse(calls.exists())
