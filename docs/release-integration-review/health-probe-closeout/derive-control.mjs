// Development-only exact-source derivation; no Status or release import.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const directory=path.dirname(fileURLToPath(import.meta.url)),source=path.resolve(directory,'../../../tools/operations-system-control.ps1'),sha=b=>createHash('sha256').update(b).digest('hex');
export const reviewedControllerSha256='37d329c1a9e5a06f5d04ffd2d73be415d327f1e9c5d66957197a189bd9c09529';
export const reviewedRetrySha256='1139287b2f9633dce57d7ea0b525e082c66382f521577c594817119f3f234ef6';
function once(s,a,b){const newline=s.includes('\r\n')?'\r\n':'\n';a=a.replaceAll('\n',newline);b=b.replaceAll('\r\n','\n').replaceAll('\n',newline);assert.equal(s.split(a).length,2,'Unique derived transform');return s.replace(a,()=>b);}
export async function derive({create=false,refresh=false}={}){
  const raw=await readFile(source);assert.equal(sha(raw),reviewedControllerSha256);let s=raw.toString('utf8');
  s=once(s,'[CmdletBinding()]\nparam(\n','[CmdletBinding()]\nparam(\n  [Parameter(Mandatory=$true)][string]$SourceScriptRoot,\n');
  s=once(s,'$ErrorActionPreference = "Stop"',`$ErrorActionPreference = "Stop"
if($SourceScriptRoot -cne 'D:/运营管理系统/tools' -or $Action -cne 'Status' -or -not $Json -or $Open -or $Check -or $StopWorker){throw 'derived_status_only_contract'}
$script:ProducerControllerPath=$PSCommandPath`);
  s=once(s,'. (Join-Path $PSScriptRoot "process-deadline.ps1")','. (Join-Path $SourceScriptRoot "process-deadline.ps1")');
  s=once(s,'$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path','$ProjectRoot = (Resolve-Path (Join-Path $SourceScriptRoot "..")).Path');
  s=once(s,'function Get-SystemHealthState {','function Get-SourceSystemHealthState {');
  const functions=await readFile(path.join(directory,'producer-functions.ps1'),'utf8');
  s=once(s,'function Get-SystemState {',functions+'\nfunction Get-SystemState {');
  s=once(s,'if ($Action -ne "Panel") {','$script:ReadonlyProbeContext=Get-ReadonlyProbeContext\nif ($Action -ne "Panel") {');
  const target=path.join(directory,'readonly-control.ps1'),bytes=Buffer.from(s);if(create)await writeFile(target,bytes,{flag:'wx'});else if(refresh){assert.ok(directory.includes(path.join('docs','release-integration-review','health-probe-closeout'))&&source.includes(path.join('tools','operations-system-control.ps1')));await writeFile(target,bytes);}else assert.ok((await readFile(target)).equals(bytes),'Derived controller drift');
  const result={version:1,reviewedControllerSha256,reviewedRetrySha256,derivedControllerSha256:sha(bytes),producerFunctionsSha256:sha(functions),originalSourcePath:source,allowedChanges:['mandatory literal SourceScriptRoot and Status+Json only guard','two root dependencies remapped to original literal tools','rename original health function once and wrapper finally safe trace','read-only trace context before Status dispatch'],originalStandardHealthFunctionBytesUnchanged:true,productionExecuted:false};
  if(create||refresh)await writeFile(path.join(directory,'DERIVED_CONTROL_MANIFEST.json'),JSON.stringify(result,null,2)+'\n',create?{flag:'wx'}:{});return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))derive({create:process.argv[2]==='--create'}).then(v=>console.log(JSON.stringify(v))).catch(e=>{console.error(e.name);process.exitCode=1;});
