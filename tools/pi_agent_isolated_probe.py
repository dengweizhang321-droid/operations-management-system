"""Real PS5/PS7 -> CurrentUser DPAPI -> signed isolated Runner probe.

This never invokes Start/Stop, loads production configuration, or uses the
formal namespace. --state is emitted by the private live-runner test setup.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--state',required=True)
    args=parser.parse_args()
    root=Path(__file__).resolve().parents[1]
    state=json.loads(Path(args.state).read_text(encoding='utf8'))
    if not state['namespace'].startswith('pi-test-stack-'):
        raise ValueError('isolated test namespace required')
    sys.path.insert(0,str(root/'backend'))
    from pandas_runner.key_file import read_key
    from pi_runner.client import command
    from pi_runner.wsl_control import verify_probe
    keyfile=Path(state['keyFile'])
    key=read_key(keyfile)
    signed=command('http://127.0.0.1:8123',key,{},path='/v1/status')
    config={'version':1,'enabled':True,'keyFileSha256':hashlib.sha256(keyfile.read_bytes()).hexdigest(),
        'channelKeySha256':hashlib.sha256(key).hexdigest(),'skillVersion':'1.0.0',
        'authorityEpoch':'synthetic-fixture','cutoverId':'synthetic-fixture',
        'runnerImage':signed['image'],'runnerSourceSha256':signed['sourceSha256']}
    configfile=keyfile.parent/'native-probe-config.json'
    configfile.write_text(json.dumps(config),encoding='utf8')
    script=keyfile.parent/'native-probe.ps1'
    script.write_text(r'''param([string]$Source,[string]$Config,[string]$Key)
$ErrorActionPreference='Stop'
function Import-Selected([string]$File,[string[]]$Names){
 $tokens=$null;$parseErrors=$null
 $ast=[System.Management.Automation.Language.Parser]::ParseFile($File,[ref]$tokens,[ref]$parseErrors)
 if($parseErrors.Count){throw 'source parse failed'}
 foreach($name in $Names){
  $fn=$ast.Find({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name},$true)
  if($null -eq $fn){throw 'source function missing'}
  $definition=[regex]::Replace($fn.Extent.Text,'^function\s+'+[regex]::Escape($name)+'\b','function global:'+$name)
  . ([scriptblock]::Create($definition))
 }
}
Import-Selected (Join-Path $Source 'tools/django-local-service.ps1') @('Read-JsonFile','Get-FileSha256','Test-ExactObjectPropertyNames')
Import-Selected (Join-Path $Source 'tools/django-ai.ps1') @('Read-PiConfig')
$PiConfigPath=$Config;$PiKeyPath=$Key
$result=Read-PiConfig
if($null -eq $result -or $result.keyFileSha256 -ceq $result.channelKeySha256){throw 'DPAPI envelope/raw identity was confused'}
@{status='passed';ps=$PSVersionTable.PSVersion.Major;keyFileChecked=$true} | ConvertTo-Json -Compress
''',encoding='utf-8-sig')
    shells=[Path(os.environ['SystemRoot'])/'System32/WindowsPowerShell/v1.0/powershell.exe']
    pwsh=shutil.which('pwsh')
    if pwsh:shells.append(Path(pwsh))
    results=[]
    for shell in shells:
        result=subprocess.run([str(shell),'-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',str(script),'-Source',str(root),'-Config',str(configfile),'-Key',str(keyfile)],capture_output=True,text=True,timeout=30)
        if result.returncode:raise ValueError('isolated PowerShell configuration probe failed: '+result.stderr[-700:])
        results.append(json.loads(result.stdout.strip()))
    authenticated=command('http://127.0.0.1:8123',key,{},path='/v1/status')
    verify_probe(authenticated,config,state['namespace'])
    print(json.dumps({'status':'passed','productionTouched':False,'serviceLifecycleInvoked':False,
        'shells':results,'signedProbe':True,'dpapiRoundtrip':True,'image':authenticated['image'],
        'runnerSourceSha256':authenticated['sourceSha256'],'namespace':state['namespace']}))


if __name__=='__main__':main()
