// One fixed failed backup output reconciliation. No backup, restore, cleanup, or resume.
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile,lstat,realpath} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
export const fixed=Object.freeze({
 batch:'f15d06a159073927ba3565712027aa645869333a3210c54e1858738756ca110f',
 head:'f59b6598f16ba14290b80fc2a3dc22e0c6ff6c30a33bb61d82dc8759a571ca99',
 spec:'E:/codex-artifacts/release-site-blockers-20261011/ADOPTION_BATCH_LIVE_V1.json',
 specSha:'960c5c3e99da1f5cd7bacf57ae3aa0889fcecb9cd522d9165870560668c7678b',
 audit:'D:/teruisi-runtime/django-sales/audits/postgres-operations/70abd23809cc4817a589d663e6635fc2.json',
 auditSha:'a520fd1b96e5510701c05ebd077a60c8d5bd7f85d74d8890d9e8348ee568c26c',
 directory:'E:\\运营管理系统业务数据\\daily-20261011T162958Z-49bdf7f519aa',
 backupId:'daily-20261011T162958Z-49bdf7f519aa',
 manifestSha:'a46097b7b68a3967527c4fc101063d557089fc97228012c3b0fe8f42e6d598ed',
 dumpSha:'e88b7cbbae5b2aa30449373a21de7e3d7400912718132088d07e4166a169b148',
 contentSha:'f261acde08c84455f4f8c75b99486130e4b17f26dbde6c9a29933a1940fc2c83',
 stdoutSha:'114fc0d3c0574834a96adfe48db8248810c8eebe41e2d4d9f43816e8c665b3ad',
 ps:'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
 psSha:'7600ffe12da441fe89d035b13801e8e91d064bc544a27b19a5cf49f6ab8b18f5',
 operator:'D:\\teruisi-runtime\\django-sales\\app\\tools\\django-postgres-maintenance.ps1',
 operatorSha:'542e4fb67ed96a680f76f1de9f4b124bfb7f039094ff664fe25595b4a8fb48e6',
 journal:'D:/teruisi-runtime/teruisi-worker-sales/state/release-batches',
 evidence:'E:/codex-artifacts/release-site-blockers-20261011/production-f15d06a/',
});
export const canonical=v=>Array.isArray(v)?`[${v.map(canonical).join(',')}]`:v&&typeof v==='object'?`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`:JSON.stringify(v);
export const digest=v=>createHash('sha256').update(Buffer.isBuffer(v)||typeof v==='string'?v:canonical(v)).digest('hex');
export const verifyArgs=['-NoProfile','-NonInteractive','-File',fixed.operator,'-Action','Verify','-BackupDirectory',fixed.directory,'-ApprovedManifestSha256',fixed.manifestSha];
export function reconciliationEvent(outputs,proof,at){
 assert.deepEqual(Object.keys(outputs).sort(),['backupDirectory','backupId','manifestSha256','dumpSha256','contentSha256'].sort());
 const core={batchSha256:fixed.batch,previous:fixed.head,at,operationId:'backup-pre',phase:'backup-pre',status:'passed',reason:'independently-reconciled',receiptSha256:digest(proof),outputs};
 return {...core,eventSha256:digest(core)};
}
export function validateBackupRecovery({state,active,maintenance,drain,processesAbsent,finished,direct,audit,manifest,verify,verifyExecution,verifyRaw,op}) {
 assert.equal(state.events.length,10);assert.equal(state.previous,fixed.head);
 assert.equal(state.unknown.length,1);const failure=state.latest.get('backup-pre');
 assert.equal(failure,state.unknown[0]);assert.equal(failure.eventSha256,fixed.head);assert.equal(failure.status,'unknown');assert.equal(failure.outputs,null);
 assert.equal(failure.processEvidence.processId,36576);assert.equal(failure.processEvidence.exitCode,1);
 assert.equal(failure.processEvidence.stdoutBytes,1319);assert.equal(failure.processEvidence.stdoutSha256,fixed.stdoutSha);
 assert.deepEqual(active,{batchSha256:fixed.batch,id:'first-adoption-live-guard-20261011'});
 assert.equal(maintenance,null);assert.equal(drain,null);assert.deepEqual(processesAbsent,[14972,36576]);
 assert.equal(direct.processId,14972);assert.equal(direct.batchSha256,fixed.batch);
 assert.equal(finished.batchSha256,fixed.batch);assert.equal(finished.exitCode,1);assert.equal(finished.errorCode,null);
 assert.equal(finished.status,'entry-failed-preserve-owner-gates-wal');
 assert.equal(op.id,'backup-pre');assert.equal(op.kind,'backup');assert.equal(op.phase,'backup-pre');
 assert.equal(audit.id,'70abd23809cc4817a589d663e6635fc2');assert.equal(audit.action,'Backup');assert.equal(audit.status,'completed');assert.equal(audit.failure,null);
 assert.deepEqual(audit.databaseBackup,audit.result);
 const r=audit.result;
 assert.equal(digest(Buffer.from(JSON.stringify(r)+'\r\n')),fixed.stdoutSha,'Audit is not exact captured operator stdout');
 assert.equal(r.status,'completed');assert.equal(r.serviceStateChanged,false);assert.equal(r.retention.status,'completed');
 assert.ok(r.retention.retained.includes(fixed.backupId));assert.equal(r.releaseRetention.status,'blocked');assert.equal(r.releaseRetention.stage,'release_plan');
 for(const a of op.assertions)assert.equal(canonical(a.path.split('.').reduce((v,k)=>v?.[k],r)),canonical(a.equals));
 const outputs={backupDirectory:fixed.directory,backupId:fixed.backupId,manifestSha256:fixed.manifestSha,dumpSha256:fixed.dumpSha,contentSha256:fixed.contentSha};
 for(const [k,v]of Object.entries(outputs))assert.equal(r[k],v);
 assert.equal(manifest.status,'completed');assert.equal(manifest.backupId,fixed.backupId);assert.equal(manifest.dump.sha256,fixed.dumpSha);assert.equal(manifest.evidence.contentSha256,fixed.contentSha);
 assert.equal(verify.status,'completed');assert.equal(verify.serviceStateChanged,false);
 for(const k of ['backupId','manifestSha256','dumpSha256','contentSha256'])assert.equal(verify[k],outputs[k]);
 assert.equal(verifyExecution.version,'actual-original-existing-backup-verification-v1');assert.equal(verifyExecution.status,'verified-original-recovery-point');
 assert.equal(verifyExecution.exitCode,0);assert.equal(verifyExecution.errorCode,null);assert.deepEqual(verifyExecution.argv,verifyArgs);assert.deepEqual(verifyExecution.receipt,verify);
 assert.equal(verifyExecution.stderrSha256,digest(''));assert.equal(verifyExecution.stdoutSha256,digest(verifyRaw));
 assert.ok(Number.isFinite(Date.parse(verifyExecution.startedAt))&&Date.parse(verifyExecution.startedAt)>Date.parse(failure.at));
 assert.ok(Date.parse(verifyExecution.finishedAt)>=Date.parse(verifyExecution.startedAt));
 return outputs;
}
async function physical(file){const absolute=path.resolve(file);for(let p=absolute;;){const s=await lstat(p);assert.equal(s.isSymbolicLink(),false);assert.equal((await realpath(p)).toLowerCase(),p.toLowerCase());const parent=path.dirname(p);if(parent===p)break;p=parent;}}
export function validLinkCount(file,expected,nlink,systemPowerShell){return nlink===1n&&!systemPowerShell||systemPowerShell&&file===fixed.ps&&expected===fixed.psSha&&nlink===2n;}
export function assertKernelAbsence(records){assert.deepEqual(records,[{pid:14972,cimAbsent:true,openSucceeded:false,error:87},{pid:36576,cimAbsent:true,openSucceeded:false,error:87}]);return [14972,36576];}
async function checked(file,expected,{collect=true,systemPowerShell=false}={}){
 await physical(file);const before=await lstat(file,{bigint:true});assert.ok(before.isFile());assert.ok(validLinkCount(file,expected,before.nlink,systemPowerShell));
 if(collect)assert.ok(before.size<=16n*1024n*1024n);const hash=createHash('sha256'),chunks=[];
 for await(const chunk of createReadStream(file)){hash.update(chunk);if(collect)chunks.push(chunk);}
 const after=await lstat(file,{bigint:true});await physical(file);for(const k of ['dev','ino','nlink','size','mtimeNs','ctimeNs'])assert.equal(after[k],before[k]);
 const actual=hash.digest('hex');if(expected)assert.equal(actual,expected);return collect?Buffer.concat(chunks):actual;
}
async function json(file,sha){return JSON.parse(await checked(file,sha));}
async function optional(file){try{return await json(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
export async function assertPriorProcessesAbsent(){
 await checked(fixed.ps,fixed.psSha,{collect:false,systemPowerShell:true});
 const source=String.raw`$ErrorActionPreference='Stop';$i=[Security.Principal.WindowsIdentity]::GetCurrent();if($i.User.Value -cne 'S-1-5-21-815909789-107973518-1379257801-1001' -or -not ([Security.Principal.WindowsPrincipal]::new($i)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Same approved administrator required'};$p=@(Get-CimInstance Win32_Process -Filter 'ProcessId=14972 OR ProcessId=36576');if($p.Count -ne 0){throw 'Prior batch/backup process still exists'};
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class ReconcilePidAbsence {
 [DllImport("kernel32.dll",SetLastError=true)] public static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
 [DllImport("kernel32.dll",SetLastError=true)] public static extern bool CloseHandle(IntPtr handle);
}
'@
$records=@();foreach($targetPid in @(14972,36576)){$handle=[ReconcilePidAbsence]::OpenProcess(0x1000,$false,[uint32]$targetPid);$nativeError=[Runtime.InteropServices.Marshal]::GetLastWin32Error();if($handle -ne [IntPtr]::Zero){try{throw 'Kernel process still exists'}finally{[void][ReconcilePidAbsence]::CloseHandle($handle)}};if($nativeError -ne 87){throw 'Kernel process absence unproven'};$records+=[pscustomobject]@{pid=$targetPid;cimAbsent=$true;openSucceeded=$false;error=$nativeError}};[Console]::Write((ConvertTo-Json -InputObject $records -Compress))`;
 const r=spawnSync(fixed.ps,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(source,'utf16le').toString('base64')],{windowsHide:true,encoding:'utf8',timeout:30000});assert.equal(r.error,undefined);assert.equal(r.status,0);return assertKernelAbsence(JSON.parse(r.stdout));
}
export async function reconcileBackupOnce(proofPath,approvedProofSha){
 assert.match(approvedProofSha,/^[0-9a-f]{64}$/);const proofRaw=await checked(proofPath,approvedProofSha),proof=JSON.parse(proofRaw);
 assert.equal(proof.version,'f15-backup-once-reconciliation-v1');assert.equal(proof.batchSha256,fixed.batch);assert.equal(proof.previous,fixed.head);
 assert.equal(proof.noReplay,true);assert.equal(proof.operationId,'backup-pre');
 assert.deepEqual(Object.keys(proof).sort(),['version','batchSha256','previous','noReplay','operationId','bootstrapSha256','originalAuditSha256','backupManifestSha256','dumpSha256','verifyStdout','verifyExecution'].sort());
 assert.equal(proof.originalAuditSha256,fixed.auditSha);assert.equal(proof.backupManifestSha256,fixed.manifestSha);assert.equal(proof.dumpSha256,fixed.dumpSha);
 assert.deepEqual(proof.verifyStdout,{path:fixed.evidence+'BACKUP_VERIFY_STDOUT.json',sha256:'d37d3cfdf15c623881feddbe8b775a88ef740f4bf3c8ac222bb3d604195d98c5'});
 assert.deepEqual(proof.verifyExecution,{path:fixed.evidence+'BACKUP_VERIFY_RESULT.json',sha256:'bf44a9dcc86e39ca1a7f83de006e98ab95e645dd16aa091cebe201961d6578c0'});
 // Root seals/holds this file and this exact bootstrap before launching. No caller module paths.
 const bootstrapPath=path.join(path.dirname(fileURLToPath(import.meta.url)),'backup-reconcile-bootstrap.mjs');
 assert.equal(proof.bootstrapSha256,'13e6700181cad60e7576cd60a8f523c36c935f734f63cae5f348f025a5c5de25');
 assert.equal(await checked(bootstrapPath,proof.bootstrapSha256,{collect:false}),proof.bootstrapSha256);
 const bootstrap=await import(pathToFileURL(bootstrapPath).href);
 await checked(fixed.spec,fixed.specSha);
 const {spec,verifyPins,api}=await bootstrap.bootstrapReconciliation(fixed.spec,fixed.batch);
 api.verifyBatch(spec.batch,fixed.batch);assert.equal(path.resolve(spec.journalRoot),path.resolve(fixed.journal));
 return api.withRotationLock(async()=>{
  const load=async()=>{
   await checked(proofPath,approvedProofSha);await checked(fixed.operator,fixed.operatorSha,{collect:false});
   const verifyRaw=await checked(proof.verifyStdout.path,proof.verifyStdout.sha256);
   const audit=await json(fixed.audit,fixed.auditSha),manifest=await json(path.join(fixed.directory,'backup-manifest.json'),fixed.manifestSha);
   await checked(path.join(fixed.directory,'teruisi-sales.dump'),fixed.dumpSha,{collect:false});
   return {state:await api.journalState(fixed.journal,spec.batch),active:await json(path.join(fixed.journal,'active.json')),maintenance:await optional('D:/teruisi-runtime/django-sales/run/system-maintenance.json'),drain:await optional('D:/teruisi-runtime/django-sales/run/automation-drain.json'),processesAbsent:await assertPriorProcessesAbsent(),finished:await json(fixed.evidence+'resume1/FINISHED.json'),direct:await json(fixed.evidence+'resume1/DIRECT_PROCESS.json'),audit,manifest,verify:JSON.parse(verifyRaw),verifyRaw,verifyExecution:await json(proof.verifyExecution.path,proof.verifyExecution.sha256),op:spec.batch.operations.find(o=>o.id==='backup-pre')};
  };
  await verifyPins();const context=await load(),outputs=validateBackupRecovery(context);
  // Final CAS checks after evidence collection; preserve the unresolved original event forever.
  const finalState=await api.journalState(fixed.journal,spec.batch);assert.equal(finalState.previous,fixed.head);assert.equal(finalState.events.length,10);
  assert.deepEqual(await json(path.join(fixed.journal,'active.json')),context.active);assert.equal(await optional('D:/teruisi-runtime/django-sales/run/system-maintenance.json'),null);assert.equal(await optional('D:/teruisi-runtime/django-sales/run/automation-drain.json'),null);await assertPriorProcessesAbsent();
  const event=reconciliationEvent(outputs,proof,new Date().toISOString());
  await api.writeOnce(path.join(finalState.dir,'000010.json'),event);
  const after=await api.journalState(fixed.journal,spec.batch);assert.equal(after.events.length,11);assert.equal(after.previous,event.eventSha256);assert.equal(after.unknown.length,0);assert.deepEqual(after.latest.get('backup-pre').outputs,outputs);
  return {status:'reconciled-only-not-resumed',batchSha256:fixed.batch,eventSha256:event.eventSha256,outputs,proofSha256:approvedProofSha};
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 assert.equal(process.argv.length,4);reconcileBackupOnce(...process.argv.slice(2)).then(v=>console.log(canonical(v))).catch(e=>{console.error(e.message);process.exitCode=1;});
}
