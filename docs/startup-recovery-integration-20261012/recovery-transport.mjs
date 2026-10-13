import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {fixed,hash,readStable,assertRecoveryPlan} from './recovery-context.mjs';
export function assertRecoveryApproval(a,planSha){assert.deepEqual(Object.keys(a).sort(),['approvedAt','kind','planSha256','scope','sid'].sort());assert.equal(a.kind,'explicit-startup-recovery-approval-v1');assert.equal(a.planSha256,planSha);assert.equal(a.sid,fixed.sid);assert.equal(a.scope,'fixed23-roots69-descendants-original-drain-stop-start-supervisor-diagnostic-action');assert(Number.isFinite(Date.parse(a.approvedAt))&&Date.parse(a.approvedAt)<=Date.now());}
export function buildRecoveryTransport(planPath,planSha,approvalPath,approvalSha){
 const plan=assertRecoveryPlan(JSON.parse(readStable(planPath,planSha)));assertRecoveryApproval(JSON.parse(readStable(approvalPath,approvalSha)),planSha);
 const node='C:/Program Files/nodejs/node.exe',nodeSha='9a4eb5f1c29c6a2e93852ead46b999e284a6a5ca8bab4d4e241d587d025a52de';
 const matches=plan.pins.filter(f=>path.basename(f.path)==='run-startup-recovery.mjs');assert.equal(matches.length,1);const runner=matches[0];
 const files=[...plan.pins,{path:path.resolve(planPath),sha256:planSha},{path:path.resolve(approvalPath),sha256:approvalSha}];for(const f of files)readStable(f.path,f.sha256);assert(files.some(f=>path.resolve(f.path).toLowerCase()===path.resolve(node).toLowerCase()&&f.sha256===nodeSha));
 return{version:'startup-recovery-transport-v1',sid:fixed.sid,planPath:path.resolve(planPath),planSha256:planSha,approvalPath:path.resolve(approvalPath),approvalSha256:approvalSha,executable:node,executableSha256:nodeSha,runnerPath:runner.path,runnerSha256:runner.sha256,files,outputRoot:plan.evidenceRoot};
}
export function recoveryBootstrap(bindingPath,bindingSha){
 assert.match(bindingSha,/^[a-f0-9]{64}$/);const encoded=Buffer.from(path.resolve(bindingPath)).toString('base64');
 return `$ErrorActionPreference='Stop'
$bindingPath=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))
Add-Type -TypeDefinition @'
using System;using System.Text;using System.Runtime.InteropServices;using Microsoft.Win32.SafeHandles;
namespace Teruisi {public static class RecoveryTransportFile {
 [StructLayout(LayoutKind.Sequential)] public struct Info {public uint attributes,creationLow,creationHigh,accessLow,accessHigh,writeLow,writeHigh,volume,sizeHigh,sizeLow,links,indexHigh,indexLow;}
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle h,out Info i);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern uint GetFinalPathNameByHandle(SafeFileHandle h,StringBuilder text,uint size,uint flags);
 public static string Identity(SafeFileHandle h){Info i;if(!GetFileInformationByHandle(h,out i))throw new System.ComponentModel.Win32Exception();var s=new StringBuilder(32768);uint n=GetFinalPathNameByHandle(h,s,32768,0);if(n==0||n>=32768)throw new System.ComponentModel.Win32Exception();return i.volume+":"+i.indexHigh+":"+i.indexLow+":"+i.links+":"+i.sizeHigh+":"+i.sizeLow+":"+i.creationHigh+":"+i.creationLow+":"+i.writeHigh+":"+i.writeLow+"|"+s.ToString();}
}}
'@
function Assert-RecoveryTransportPhysical([string]$Path){
 $full=[IO.Path]::GetFullPath($Path)
 for($q=$full;$q;$q=[IO.Path]::GetDirectoryName($q)){
  if((Get-Item -LiteralPath $q -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Reparse path rejected'}
 }
}
function Get-RecoveryTransportHash([IO.Stream]$Stream){$s=[Security.Cryptography.SHA256]::Create();try{return ([BitConverter]::ToString($s.ComputeHash($Stream))).Replace('-','').ToLowerInvariant()}finally{$s.Dispose()}}
function Assert-RecoveryHeldFile([IO.FileStream]$Stream,[string]$Path,[string]$Hash){
 $identity=[Teruisi.RecoveryTransportFile]::Identity($Stream.SafeFileHandle);$parts=$identity.Split('|');$canonical=$parts[1]
 if($canonical.StartsWith('\\\\?\\')){$canonical=$canonical.Substring(4)}
 if($canonical -ine [IO.Path]::GetFullPath($Path)){throw 'Physical path alias rejected'}
 $expectedLinks=1
 if([IO.Path]::GetFullPath($Path) -ieq 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'){
  if($Hash -cne '7600ffe12da441fe89d035b13801e8e91d064bc544a27b19a5cf49f6ab8b18f5'){throw 'System PowerShell binding changed'};$expectedLinks=2
 }
 if([uint32]$parts[0].Split(':')[3] -ne $expectedLinks){throw 'Unexpected hardlink count'}
 $Stream.Position=0;if((Get-RecoveryTransportHash $Stream) -cne $Hash){throw 'Held bytes changed'}
 if([Teruisi.RecoveryTransportFile]::Identity($Stream.SafeFileHandle) -cne $identity){throw 'Held identity changed'}
 return $identity
}
$holds=[Collections.Generic.List[object]]::new()
try{
 Assert-RecoveryTransportPhysical $bindingPath
 $bound=[IO.File]::Open($bindingPath,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);$holds.Add($bound)
 $null=Assert-RecoveryHeldFile $bound $bindingPath '${bindingSha}'
 $bound.Position=0;$reader=[IO.StreamReader]::new($bound,[Text.UTF8Encoding]::new($false,$true),$true,4096,$true);try{$raw=$reader.ReadToEnd()}finally{$reader.Dispose()}
 if(-not $raw.TrimStart().StartsWith('{')){throw 'Binding must be a JSON object'}
 $b=$raw|ConvertFrom-Json
 if($b.version -cne 'startup-recovery-transport-v1'){throw 'Transport version changed'}
 $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
 if($identity.User.Value -cne $b.sid -or $b.sid -cne '${fixed.sid}' -or -not ([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Exact same-SID administrator required'}
 if(@(Get-ChildItem Env:|Where-Object {$_.Name -match '^NODE_'}).Count){throw 'NODE environment rejected'}
 if(@(Get-ChildItem Env:|Where-Object {$_.Name -match '^TERUISI_.*(?:LIBRARY_ONLY|FUNCTIONS_ONLY)$'}).Count){throw 'Inherited library-only environment rejected'}
 $identities=[Collections.Generic.List[object]]::new()
 foreach($pin in $b.files){Assert-RecoveryTransportPhysical $pin.path;$f=[IO.File]::Open($pin.path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);$holds.Add($f);$identity=Assert-RecoveryHeldFile $f $pin.path $pin.sha256;$identities.Add(@{handle=$f;identity=$identity;path=$pin.path})}
 foreach($item in $identities){Assert-RecoveryTransportPhysical $item.path;if([Teruisi.RecoveryTransportFile]::Identity($item.handle.SafeFileHandle) -cne $item.identity){throw 'Closure member changed'}}
 Assert-RecoveryTransportPhysical $b.outputRoot
 $started=[IO.File]::Open((Join-Path $b.outputRoot 'TRANSPORT_STARTED.json'),[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
 try{$bytes=[Text.UTF8Encoding]::new($false).GetBytes((@{at=[DateTimeOffset]::UtcNow.ToString('o');processId=$PID;bindingSha256='${bindingSha}';planSha256=$b.planSha256}|ConvertTo-Json -Compress));$started.Write($bytes,0,$bytes.Length);$started.Flush($true)}finally{$started.Dispose()}
 & $b.executable $b.runnerPath $b.planPath $b.planSha256
 $code=$LASTEXITCODE
 $finished=[IO.File]::Open((Join-Path $b.outputRoot 'TRANSPORT_FINISHED.json'),[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
 try{$bytes=[Text.UTF8Encoding]::new($false).GetBytes((@{at=[DateTimeOffset]::UtcNow.ToString('o');bindingSha256='${bindingSha}';exitCode=$code}|ConvertTo-Json -Compress));$finished.Write($bytes,0,$bytes.Length);$finished.Flush($true)}finally{$finished.Dispose()}
 exit $code
}finally{foreach($f in $holds){$f.Dispose()}}
`;
}
