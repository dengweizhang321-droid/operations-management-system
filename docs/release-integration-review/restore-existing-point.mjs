// Task D isolated rehearsal of an existing retained point. Never creates a
// production backup, changes retention, switches services or restores production.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { runProcess, safeProcessEvidence } from '../../tools/worker-local-release.mjs';
import { productionCommandArguments, productionCommandEnvironment } from '../../tools/release-batch.mjs';
import { hash } from '../../tools/release-impact.mjs';
const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'evidence');
const request=JSON.parse(await readFile(path.join(root,'restore-request.json')));
const shell='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
if(request.operatorPath!=='D:\\teruisi-runtime\\django-sales\\app\\tools\\django-postgres-maintenance.ps1'
  ||request.backupDirectory!=='E:\\运营管理系统业务数据\\daily-20261009T114230Z-7117da1c1055'
  ||!Number.isInteger(request.rehearsalPort)||request.rehearsalPort<55432||request.rehearsalPort>55999
  ||!/^[a-f0-9]{12}$/.test(request.rehearsalId)||request.drive!=='E')throw Error('Isolated request binding rejected');
if(hash(await readFile(request.operatorPath))!==request.operatorSha256
  ||hash(await readFile(path.join(request.backupDirectory,'backup-manifest.json')))!==request.manifestSha256)throw Error('Bound operator/retained point changed');
async function invoke(action,extra=[]){
  const argv=['-NoProfile','-NonInteractive','-File',request.operatorPath,'-Action',action,'-BackupDirectory',request.backupDirectory,'-ApprovedManifestSha256',request.manifestSha256,...extra];
  const start=performance.now();
  try{
    const response=await runProcess(shell,productionCommandArguments(shell,argv),{env:productionCommandEnvironment(shell),timeoutMs:1800000,outputProtocol:'direct-exit-files',cleanup:'preserve',label:`existing point ${action}`});
    const value=JSON.parse(response.stdout.trim());
    const allowed=['status','backupId','rehearsalId','backupManifestSha256','dumpSha256','expectedContentSha256','restoredContentSha256','profileRestoreVerified','sequenceHealthVerified','productionDatabaseTouched','serviceStateChanged','cleanupStatus','completedAt'];
    const summary={action,elapsedMs:performance.now()-start,process:safeProcessEvidence(response.processEvidence),receiptSha256:hash(response.stdout),result:Object.fromEntries(allowed.filter(key=>['string','boolean'].includes(typeof value[key])).map(key=>[key,value[key]]))};
    await writeFile(path.join(root,`${action.toLowerCase()}-existing-point.json`),JSON.stringify(summary,null,2)+'\n');
    return value;
  }catch(error){await writeFile(path.join(root,`${action.toLowerCase()}-existing-point-failure.json`),JSON.stringify({action,elapsedMs:performance.now()-start,process:safeProcessEvidence(error.processEvidence),status:'failed-or-unknown'},null,2)+'\n');throw Error('Existing-point isolated verification failed; retain original operator audit');}
}
const verified=await invoke('Verify');
if(!['verified','completed'].includes(verified.status))throw Error('Original retained-point Verify not closed');
const restored=await invoke('RestoreRehearsal',['-Execute','-ConfirmedIsolatedRestore','-RehearsalId',request.rehearsalId,'-RehearsalPort',String(request.rehearsalPort),'-RehearsalDrive','E']);
if(restored.status!=='completed'||restored.profileRestoreVerified!==true||restored.sequenceHealthVerified!==true
  ||restored.productionDatabaseTouched!==false||restored.serviceStateChanged!==false||restored.cleanupStatus!=='isolated_data_removed'
  ||restored.backupManifestSha256!==request.manifestSha256||restored.expectedContentSha256!==restored.restoredContentSha256)throw Error('Original isolated rehearsal assertions not closed');
console.log(JSON.stringify({status:'passed',rehearsalId:request.rehearsalId,profile:true,sequences:true,productionTouched:false,cleanup:restored.cleanupStatus}));
