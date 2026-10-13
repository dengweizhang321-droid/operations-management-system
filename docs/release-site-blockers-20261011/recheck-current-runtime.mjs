import {readFile,readdir,lstat,writeFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const output='E:/codex-artifacts/release-site-blockers-20261011/CURRENT_RUNTIME_FIRST.json';
const evidence='E:/codex-artifacts/release-first-adoption-targeted-20261011',runtime='D:/teruisi-runtime/teruisi-worker-sales';
const hash=v=>createHash('sha256').update(v).digest('hex');
const canonical=v=>Array.isArray(v)?`[${v.map(canonical).join(',')}]`:v&&typeof v==='object'?`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`:JSON.stringify(v);
async function physical(file){let p=path.parse(path.resolve(file)).root;for(const part of path.resolve(file).slice(p.length).split(path.sep).filter(Boolean)){p=path.join(p,part);assert.equal((await lstat(p)).isSymbolicLink(),false);}assert.equal((await realpath(file)).toLowerCase(),path.resolve(file).toLowerCase());}
async function checked(file){await physical(file);const a=await lstat(file,{bigint:true});assert.ok(a.isFile()&&a.nlink===1n&&a.size<=16n*1024n*1024n);const raw=await readFile(file);const b=await lstat(file,{bigint:true});for(const k of ['dev','ino','nlink','size','mtimeNs','ctimeNs'])assert.equal(a[k],b[k]);return raw;}
async function presence(file){try{const info=await lstat(file);assert.equal(info.isSymbolicLink(),false);return {path:file,present:true,sha256:info.isFile()?hash(await checked(file)):null};}catch(e){if(e.code!=='ENOENT')throw e;return {path:file,present:false};}}
const closeRoot='E:/codex-artifacts/release-integration-review-20261010/AB-health-probe-20261011-verified-final';
const receiptRaw=await checked(closeRoot+'/FINAL_AB_DELIVERY.json'),receipt=JSON.parse(receiptRaw),independent=JSON.parse(await checked(closeRoot+'/FINAL_AB_DELIVERY_INDEPENDENT.json'));
assert.equal(hash(receiptRaw),independent.finalReceiptSha256);assert.ok(receipt.fullDeliveryClosed&&receipt.necessaryAcceptanceClosed&&receipt.ownershipReleased);
const journal=runtime+'/state/release-batches/integration-ab-v2-20261010-c22d8dd69a',events=[];let previous=null;
for(const [i,name] of (await readdir(journal)).sort().entries()){assert.equal(name,String(i).padStart(6,'0')+'.json');const raw=await checked(path.join(journal,name)),event=JSON.parse(raw),{eventSha256,...core}=event;assert.equal(hash(canonical(core)),eventSha256);assert.equal(event.previous,previous);assert.equal(event.batchSha256,'9f79a27a1b2ec47095c971780efde8379940366724e975ff31b9cf88b45dce15');assert.ok(raw.equals(Buffer.from(canonical(event)+'\n')));events.push(event);previous=eventSha256;}
assert.equal(events.length,receipt.journal.records);assert.equal(previous,receipt.journal.head);
const spec=JSON.parse(await checked(evidence+'/ADOPTION_BATCH_FRESH_V1.json'));
const planRaw=await checked(runtime+'/state/worker-release-rotation-plans/'+spec.batch.binding.workerPlanSha256+'.json');assert.equal(hash(planRaw),spec.batch.binding.workerPlanSha256);const plan=JSON.parse(planRaw);
const deployedD=hash(await checked('D:/teruisi-runtime/django-sales/app/deployment.json'));assert.equal(deployedD,spec.batch.binding.djangoPredecessorSha256);
const predecessorRaw=await checked(runtime+'/releases/'+plan.predecessor.releaseId+'/deployment-manifest.json');assert.equal(hash(predecessorRaw),plan.predecessor.manifestSha256);
const candidateRaw=await checked(runtime+'/releases/'+plan.candidate.releaseId+'/deployment-manifest.json');assert.equal(hash(candidateRaw),spec.batch.binding.artifactSha256);
const states=[];for(const file of [runtime+'/state/release-batches/active.json','D:/teruisi-runtime/django-sales/run/system-maintenance.json','D:/teruisi-runtime/django-sales/run/automation-drain.json'])states.push(await presence(file));
const processRaw=await checked(runtime+'/state/worker-process.json'),processReceipt=JSON.parse(processRaw);
const query="[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false); @(Get-CimInstance Win32_Process | Where-Object {$_.Name -in @('pg_dump.exe','pg_restore.exe','postgres.exe','workerd.exe')} | Select-Object ProcessId,Name,CreationDate) | ConvertTo-Json -Compress";
const p=spawnSync('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(query,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,timeout:60000});assert.equal(p.status,0);
const result={version:'teruisi-release-site-readonly-runtime-recheck-v1',at:new Date().toISOString(),batchSha256:spec.batch.batchSha256,originalAB:{receiptSha256:hash(receiptRaw),records:events.length,journalHead:previous,originalEngineCompleted:receipt.originalBatchEngineCompleted},djangoPredecessorSha256:deployedD,workerPredecessor:plan.predecessor,workerCandidate:plan.candidate,workerProcessReceiptSha256:hash(processRaw),workerProcessReceiptKeys:Object.keys(processReceipt),states,observedDatabaseWorkerProcesses:JSON.parse(p.stdout||'[]'),productionActions:0,scope:'Pinned metadata/current gates and process census; not whole artifact/ready/ACL qualification or lock acquisition.'};
await writeFile(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:'metadata-matched',ABRecords:events.length,states,productionActions:0}));
