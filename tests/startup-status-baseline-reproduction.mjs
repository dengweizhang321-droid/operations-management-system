// Controlled reproduction against HEAD's pre-fix function bytes, never runtime.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const before = {};
for (const file of ['django-local-service.ps1', 'operations-system-watchdog.ps1']) {
  const r = spawnSync('git', ['show', `HEAD:tools/${file}`]);
  assert.equal(r.status, 0); before[file] = r.stdout.toString('base64');
}
for (const shell of ['powershell.exe','pwsh.exe']) {
  const code = String.raw`
$ErrorActionPreference='Stop'
$d=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__DJANGO__'))
$w=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__WATCH__'))
foreach($entry in @(@{source=$d;names=@('Get-ProcessSnapshot','Resolve-OwnedProcess','ConvertTo-CanonicalCreationDate')},@{source=$w;names=@('Resolve-WatchStatusControl')})){
 $t=$null;$e=$null;$ast=[Management.Automation.Language.Parser]::ParseInput($entry.source,[ref]$t,[ref]$e)
 foreach($name in $entry.names){$fn=$ast.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name},$true);Invoke-Expression ($fn.Extent.Text.Replace('$PSScriptRoot','$FixtureRoot'))}
}
$FixtureRoot='C:\fixture';$ProjectRoot=$FixtureRoot;$BackendRoot=$FixtureRoot;$WorkerPath='worker';$ControlPath='control';$Action='Status';$script:removed=0
function Get-CimInstance{[CmdletBinding()]param([string]$ClassName,[string]$Filter);return [pscustomobject]@{ProcessId=123;ExecutablePath=$null;CommandLine=$null;CreationDate='2026-10-12T00:00:00.0000000Z'}}
function Start-Sleep{}
function Test-Path{return $true}
function Read-JsonFile{return [pscustomobject]@{version=2;service='fixture';processId=123;configFingerprint=('a'*64);launcherPath='C:\fixture\python.exe';creationDate='2026-10-12T00:00:00.0000000Z'}}
function Remove-Item{$script:removed++}
function Write-LauncherEvent{}
Resolve-OwnedProcess fixture fixture 'C:\fixture\python.exe'|Out-Null
if($script:removed -ne 1){throw 'Baseline unsafe deletion was not reproduced'}
function Read-WatchJson{return [pscustomobject]@{version=1;assetHashes=[pscustomobject]@{control=('a'*64);worker='4c315221d5722b1b90abd8b25f16f95c3df588ab111f4ce4dd070f1b433ded80';backend=('a'*64);transport=('a'*64)}}}
function Get-WatchHash{return '717408ad7b7880617967b5e230ea110c15c58b887532d02bef8eb42236f7bc1e'}
$selected=Resolve-WatchStatusControl
if($selected.mode -cne 'legacy' -or $selected.reason -cne 'diagnostic_predecessor_changed'){throw 'Baseline unsafe fallback was not reproduced'}
[pscustomobject]@{syntheticUnreadableRowDeleted=($script:removed -eq 1);configuredBindingMismatchLegacy=($selected.mode -eq 'legacy');productionCalls=0}|ConvertTo-Json -Compress
`.replace('__DJANGO__',before['django-local-service.ps1']).replace('__WATCH__',before['operations-system-watchdog.ps1']);
  // A temporary private script avoids Windows' argument-size limit. No secrets.
  const dir = fs.mkdtempSync(path.join(process.env.TEMP, 'teruisi-status-baseline-'));
  const script = path.join(dir,'reproduce.ps1'); fs.writeFileSync(script, '﻿'+code, { flag:'wx' });
  const r = spawnSync(shell,['-NoProfile','-NonInteractive','-File',script], { encoding:'utf8',windowsHide:true,timeout:30000 });
  assert.equal(r.status,0,r.stdout+'\n'+r.stderr);
  console.log(JSON.stringify({shell,script,...JSON.parse(r.stdout.trim())}));
}
