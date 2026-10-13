// Fixed read-only observations; never Stop, Start, maintain, write business data or reconcile.
import{readFile,lstat,realpath}from'node:fs/promises';import{spawnSync}from'node:child_process';import{createHash}from'node:crypto';import path from'node:path';import assert from'node:assert/strict';import{fileURLToPath}from'node:url';
const sha=b=>createHash('sha256').update(b).digest('hex'),ps='C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',specPath='E:/codex-artifacts/release-site-blockers-20261011/ADOPTION_BATCH_LIVE_V1.json';
async function physical(name){const absolute=path.resolve(name),ids=[];for(let p=absolute;;){const s=await lstat(p,{bigint:true});assert.equal(s.isSymbolicLink(),false);assert.equal((await realpath(p)).toLowerCase(),p.toLowerCase());ids.push([p,String(s.dev),String(s.ino)]);const parent=path.dirname(p);if(parent===p)break;p=parent;}return ids;}
export async function readStopEvidenceFile(name,expected){const parents=await physical(name),s=await lstat(name,{bigint:true});assert.ok(s.isFile());const system=path.resolve(name).toLowerCase()===path.resolve(ps).toLowerCase();assert.equal(s.nlink,system?2n:1n);if(system)assert.equal(expected,'7600ffe12da441fe89d035b13801e8e91d064bc544a27b19a5cf49f6ab8b18f5');const raw=await readFile(name),after=await lstat(name,{bigint:true});assert.deepEqual(await physical(name),parents);for(const k of ['dev','ino','nlink','size','mtimeNs','ctimeNs'])assert.equal(after[k],s[k]);if(expected)assert.equal(sha(raw),expected);return raw;}
const file=readStopEvidenceFile;
async function optional(name){try{const raw=await file(name);return{sha256:sha(raw),value:JSON.parse(raw),absent:false};}catch(e){if(e.code==='ENOENT')return{absent:true};throw e;}}
function command(argv){const startedAt=new Date().toISOString(),r=spawnSync(ps,argv,{windowsHide:true,timeout:30000,maxBuffer:2097152});assert.equal(r.error,undefined);assert.equal(r.status,0,'Original read-only command failed');return{argv,startedAt,finishedAt:new Date().toISOString(),exitCode:r.status,stdoutSha256:sha(r.stdout),stderrSha256:sha(r.stderr),receipt:JSON.parse(r.stdout.toString('utf8'))};}
export async function collectStopPostcondition(){
 const startedAt=new Date().toISOString(),specRaw=await file(specPath);assert.equal(sha(specRaw),'960c5c3e99da1f5cd7bacf57ae3aa0889fcecb9cd522d9165870560668c7678b');const spec=JSON.parse(specRaw),op=spec.batch.operations.find(o=>o.id==='op-stopworker-switch');
 // Every pre-switch command dependency is still the original approved byte. System PS is the exact two-link exception.
 for(const f of op.command.files)await file(f.path,f.sha256);
 const worker=command(['-NoProfile','-NonInteractive','-File','D:\\运营管理系统\\tools\\worker-local-service.ps1','-Action','Status','-Json']);
 const django=command(['-NoProfile','-NonInteractive','-File','D:\\运营管理系统-sales-django-release\\tools\\django-local-service.ps1','-Action','Status','-Json']);
 const source=String.raw`$ErrorActionPreference='Stop';$i=[Security.Principal.WindowsIdentity]::GetCurrent();$nativeAt=[DateTime]::UtcNow.ToString('o');$rows=@(Get-CimInstance Win32_Process -Filter 'ProcessId=71332 OR ProcessId=11416 OR ProcessId=49472 OR ProcessId=48744');if($rows.Count -ne 0){throw 'Original stopped process or failed operator still exists'};
Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;
public static class FixedStopAbsence {
[DllImport("kernel32.dll",SetLastError=true)]public static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
[DllImport("kernel32.dll",SetLastError=true)]public static extern bool CloseHandle(IntPtr handle);
}
'@
$missing=@();foreach($targetPid in @(71332,11416,49472,48744)){$handle=[FixedStopAbsence]::OpenProcess(0x1000,$false,[uint32]$targetPid);$nativeError=[Runtime.InteropServices.Marshal]::GetLastWin32Error();if($handle -ne [IntPtr]::Zero){try{throw 'Fixed original process still alive'}finally{[void][FixedStopAbsence]::CloseHandle($handle)}};if($nativeError -ne 87){throw 'Fixed original process absence unknown'};$missing+=[pscustomobject]@{pid=$targetPid;cimAbsent=$true;openSucceeded=$false;error=$nativeError}};$ports=@(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object {$_.LocalPort -in @(3000,5791,5432)} | ForEach-Object {[pscustomobject]@{address=$_.LocalAddress;port=$_.LocalPort;pid=$_.OwningProcess}});[Console]::Write((ConvertTo-Json -Depth 5 -Compress -InputObject ([pscustomobject]@{sid=$i.User.Value;administrator=([Security.Principal.WindowsPrincipal]::new($i)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator);startedAt=$nativeAt;completedAt=[DateTime]::UtcNow.ToString('o');missing=$missing;ports=$ports})))`;
 const native=command(['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(source,'utf16le').toString('base64')]);
 const state='D:/teruisi-runtime/teruisi-worker-sales/state/release-batches/',d='D:/teruisi-runtime/django-sales/';
 const result={version:'fixed-stop-postcondition-observation-v1',startedAt,worker,django,native:{startedAt:native.startedAt,finishedAt:native.finishedAt,exitCode:native.exitCode,stdoutSha256:native.stdoutSha256,stderrSha256:native.stderrSha256,receipt:native.receipt},active:await optional(state+'active.json'),maintenance:await optional(d+'run/system-maintenance.json'),drain:await optional(d+'run/automation-drain.json'),workerProcessReceipt:await optional('D:/teruisi-runtime/teruisi-worker-sales/state/worker-process.json'),lastControlledStop:await optional('D:/teruisi-runtime/teruisi-worker-sales/state/worker-last-controlled-stop.json'),djangoManifestSha256:sha(await file(d+'app/deployment.json')),finishedAt:new Date().toISOString()};
 for(const f of op.command.files)await file(f.path,f.sha256);
 result.finishedAt=new Date().toISOString();return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){assert.equal(process.argv.length,2);console.log(JSON.stringify(await collectStopPostcondition()));}
