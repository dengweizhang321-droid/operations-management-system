import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root=new URL('../../',import.meta.url),dir=new URL('docs/runtime-risk-readonly-audit-20261009/evidence/',root);
await mkdir(dir,{recursive:true});
const sha=b=>createHash('sha256').update(b).digest('hex');
const captured={observedAt:new Date().toISOString(),mode:'Read existing state files/source only; no runtime probe, notifications or lifecycle action',mainBase:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),files:{},source:{},limitations:{processStopTrace:'A single Register-CimIndicationEvent Win32_ProcessStopTrace subscription was denied by OS access control; no escalation/retry; no subscription was established. Exact exit-status timeline for a natural watchdog subprocess remains unknown.',knownProductionPackageOnly:true}};
for(const [name,path] of Object.entries({watchdogLatest:'D:/teruisi-runtime/operations-watchdog/latest.json',watchdogState:'D:/teruisi-runtime/operations-watchdog/state.json',djangoSupervisorState:'D:/teruisi-runtime/django-sales/monitoring/django-runtime/state.json',workerReceipt:'D:/teruisi-runtime/teruisi-worker-sales/state/worker-process.json'})){
 const bytes=await readFile(path);captured.files[name]={path,sha256:sha(bytes),value:JSON.parse(bytes.toString().replace(/^\uFEFF/,''))};
}
for(const [name,path,repoPath] of [['installedWatchdog','D:/teruisi-runtime/operations-watchdog/operations-system-watchdog.ps1','tools/operations-system-watchdog.ps1'],['installedController','D:/运营管理系统/tools/operations-system-control.ps1','tools/operations-system-control.ps1'],['primaryWorkerService','D:/运营管理系统/tools/worker-local-service.ps1','tools/worker-local-service.ps1'],['deployedDjangoService','D:/teruisi-runtime/django-sales/app/tools/django-local-service.ps1',null]]){
 const bytes=await readFile(path);const row={path,sha256:sha(bytes)};
 if(repoPath){row.repositorySourceSha256=sha(await readFile(new URL(repoPath,root)));row.samePhysicalBytesAsMainSource=row.sha256===row.repositorySourceSha256;}
 captured.source[name]=row;
 if(name==='installedWatchdog')await writeFile(new URL('installed-watchdog-source.ps1',dir),bytes,{flag:'wx'});
}
await writeFile(new URL('session-snapshot.json',dir),JSON.stringify(captured,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({observedAt:captured.observedAt,mainBase:captured.mainBase,source:captured.source,watchdog:{at:captured.files.watchdogLatest.value.at,probeError:captured.files.watchdogLatest.value.probeError},workerRelease:captured.files.workerReceipt.value.releaseId}));
