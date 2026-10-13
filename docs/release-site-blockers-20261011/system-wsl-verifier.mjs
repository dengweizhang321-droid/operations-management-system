// One fixed Windows component; never a generic artifact hardlink exception.
import {readFile,lstat,realpath,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
export const SYSTEM_WSL_PATH='C:\\Windows\\System32\\wsl.exe';
const FILE_SHA='7e9f5cee6d641481e5a942f0e08563bae9c17ee55f0aad888f9aa0be9a5d4757';
const RECORD_SHA='0979916bc362a459f8f2bd30aa807d985eaa4eeab9f9b6d203bce50debc77d69';
const COLLECTOR_SHA='b74dea4831ec04acb0ab8ee7634d677073d67a374107a80583b05078306b9d34';
const EVIDENCE='E:/codex-artifacts/release-site-blockers-20261011/_live-reference-observations';
const sha=v=>createHash('sha256').update(v).digest('hex');
export function fileIdentity(s){return [s.dev,s.ino,s.nlink,s.size,s.mtimeNs,s.ctimeNs].map(String).join(':');}
async function physical(file){for(let at=path.resolve(file);;){assert.ok(!(await lstat(at)).isSymbolicLink(),'Redirected system-tool path');assert.equal((await realpath(at)).toLowerCase(),at.toLowerCase(),'System-tool path alias');const next=path.dirname(at);if(next===at)break;at=next;}}
export async function readStrictPinnedFile(file,expected){await physical(file);const before=await lstat(file,{bigint:true});assert.ok(before.isFile()&&before.nlink===1n,'Ordinary source/evidence must have one link');const raw=await readFile(file);assert.equal(fileIdentity(await lstat(file,{bigint:true})),fileIdentity(before));assert.equal(sha(raw),expected);return raw;}
export function validateSystemWslTuple({file,bytes,before,after,signature}){
 assert.equal(file,SYSTEM_WSL_PATH,'The exception is only the exact system WSL binary');
 assert.ok(before.isFile()&&after.isFile());assert.equal(before.nlink,2n);assert.equal(after.nlink,2n);assert.equal(fileIdentity(before),fileIdentity(after),'System tool identity changed');
 assert.equal(sha(bytes),FILE_SHA,'System tool bytes changed');
 assert.equal(signature.version,'teruisi-system-wsl-identity-v1');assert.equal(signature.path,SYSTEM_WSL_PATH);assert.equal(signature.sha256,FILE_SHA);
 assert.equal(signature.signatureStatus,'Valid');assert.equal(signature.owner,'NT SERVICE\\TrustedInstaller');
 assert.equal(signature.signerSubject,'CN=Microsoft Windows, O=Microsoft Corporation, L=Redmond, S=Washington, C=US');
 assert.equal(signature.signerIssuer,'CN=Microsoft Windows Production PCA 2011, O=Microsoft Corporation, L=Redmond, S=Washington, C=US');
 assert.equal(signature.signerThumbprint,'DC91E564D5BC1E3A8E02D6A8508682ABEA8A2443');assert.equal(signature.productionActionsRequested,0);
 return {path:SYSTEM_WSL_PATH,sha256:FILE_SHA,identity:fileIdentity(after)};
}
export async function verifyPinnedSystemWsl({recordPath,collectorPath}){
 const expected=JSON.parse(await readStrictPinnedFile(recordPath,RECORD_SHA));
 const collector=await readStrictPinnedFile(collectorPath,COLLECTOR_SHA);
 await physical(SYSTEM_WSL_PATH);const before=await lstat(SYSTEM_WSL_PATH,{bigint:true});assert.ok(before.isFile());assert.equal(before.nlink,2n);
 const bytes=await readFile(SYSTEM_WSL_PATH);assert.equal(sha(bytes),FILE_SHA);
 await physical(path.dirname(EVIDENCE));await mkdir(EVIDENCE,{recursive:true});await physical(EVIDENCE);
 const runId=randomUUID(),outputPath=path.join(EVIDENCE,runId+'-system-wsl.json');
 const bootstrap=String.raw`$ErrorActionPreference='Stop';[Console]::InputEncoding=[Text.UTF8Encoding]::new($false);[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$p=[Console]::In.ReadToEnd()|ConvertFrom-Json;$b=[Convert]::FromBase64String($p.source)
$s=[Security.Cryptography.SHA256]::Create();try{$h=([BitConverter]::ToString($s.ComputeHash($b))).Replace('-','').ToLowerInvariant()}finally{$s.Dispose()}
if($h -cne 'b74dea4831ec04acb0ab8ee7634d677073d67a374107a80583b05078306b9d34'){throw 'System tool collector drift'}
if($p.runId -notmatch '^[a-f0-9-]{36}$'){throw 'Evidence id rejected'}
$dir='E:\codex-artifacts\release-site-blockers-20261011\_live-reference-observations';$at=$dir
while($at){$i=Get-Item -LiteralPath $at -Force;if(($i.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Redirected evidence path'};$next=[IO.Path]::GetDirectoryName($at);if($next -eq $at){break};$at=$next}
$env:PSModulePath='C:\Windows\System32\WindowsPowerShell\v1.0\Modules;C:\Program Files\WindowsPowerShell\Modules'
& ([ScriptBlock]::Create([Text.Encoding]::UTF8.GetString($b))) -OutputPath (Join-Path $dir ($p.runId+'-system-wsl.json'))`;
 const r=spawnSync('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(bootstrap,'utf16le').toString('base64')],{input:Buffer.from(JSON.stringify({runId,source:collector.toString('base64')})),windowsHide:true,timeout:30000,maxBuffer:1048576});
 assert.equal(r.error,undefined);assert.equal(r.status,0,'System WSL identity collector failed');
 const actual=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(r.stdout));assert.deepEqual(actual,expected,'Live signature/owner differs from the exact reviewed record');
 await physical(SYSTEM_WSL_PATH);const after=await lstat(SYSTEM_WSL_PATH,{bigint:true});
 return {...validateSystemWslTuple({file:SYSTEM_WSL_PATH,bytes,before,after,signature:actual}),evidencePath:outputPath};
}
export async function assertSystemWslUnchanged(lease){
 assert.equal(lease.path,SYSTEM_WSL_PATH);assert.equal(lease.sha256,FILE_SHA);await physical(SYSTEM_WSL_PATH);
 const before=await lstat(SYSTEM_WSL_PATH,{bigint:true});assert.equal(before.nlink,2n);assert.equal(fileIdentity(before),lease.identity);
 assert.equal(sha(await readFile(SYSTEM_WSL_PATH)),FILE_SHA);const after=await lstat(SYSTEM_WSL_PATH,{bigint:true});assert.equal(fileIdentity(after),lease.identity);
}
