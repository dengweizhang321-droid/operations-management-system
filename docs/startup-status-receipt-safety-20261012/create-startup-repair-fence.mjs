// Single fixed maintenance-intent marker. Never Stop/Start/Status/SQL, schedule,
// WAL, ownership repair, reconciliation or removal. Execution needs exact intent.
import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {spawnSync} from 'node:child_process';import {fileURLToPath,pathToFileURL} from 'node:url';
const own=path.dirname(fileURLToPath(import.meta.url));
export const fenceFixed=Object.freeze({repairId:'12c465652dbc4b5f9f54d0b0f30eeb3a',batch:'f15d06a159073927ba3565712027aa645869333a3210c54e1858738756ca110f',batchId:'first-adoption-live-guard-20261011',head:'1a614e58caf56a243ea8dead3ce1609993fd993c3ed39cac296bf83c64617bd4',worker:'6cff8886e533244997b65d2a8668776cee5178b95e4e2a99ed14bd25bf2733f4',django:'85cf0699925aad21f98ae682f458789236d206723b10865939915d1bcacddd09',desired:'1cfe7abb6b6b4d16bba5745dc440e02068a8ddfe744ca8e96d5e5452345a9fc4',service:'95331de5035e8c7a284eb3a8508b547ff6511e3d712078822f2d74bd63087b1c',sid:'S-1-5-21-815909789-107973518-1379257801-1001'});
const runtime='D:/teruisi-runtime/django-sales',marker=runtime+'/run/system-maintenance.json',drain=runtime+'/run/automation-drain.json',desired=runtime+'/run/django-supervisor-desired-state.json',journalRoot='D:/teruisi-runtime/teruisi-worker-sales/state/release-batches';
const specPath='E:/codex-artifacts/release-site-blockers-20261011/ADOPTION_BATCH_LIVE_V1.json',evidence='E:/codex-artifacts/startup-status-receipt-safety-20261012/repair-fence-v1';
const ps='C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',psHash='7600ffe12da441fe89d035b13801e8e91d064bc544a27b19a5cf49f6ab8b18f5';
export const canonical=x=>x===null||typeof x!=='object'?JSON.stringify(x):Array.isArray(x)?'['+x.map(canonical).join(',')+']':'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';
export const hash=x=>createHash('sha256').update(typeof x==='string'||Buffer.isBuffer(x)?x:canonical(x)).digest('hex');
async function physical(p){p=path.resolve(p);const result=[];for(let q=p;;q=path.dirname(q)){const s=await fs.lstat(q,{bigint:true});assert(!s.isSymbolicLink(),'Reparse denied');assert.equal((await fs.realpath(q)).toLowerCase(),q.toLowerCase());result.push([q,String(s.dev),String(s.ino)]);if(q===path.dirname(q))return result;}}
async function file(p,expected){const parents=await physical(p),a=await fs.lstat(p,{bigint:true});assert(a.isFile());const system=path.resolve(p).toLowerCase()===path.resolve(ps).toLowerCase();assert.equal(a.nlink,system?2n:1n);if(system)assert.equal(expected,psHash);const raw=await fs.readFile(p),b=await fs.lstat(p,{bigint:true});for(const k of ['dev','ino','nlink','size','mtimeNs','ctimeNs'])assert.equal(a[k],b[k]);assert.deepEqual(await physical(p),parents);if(expected)assert.equal(hash(raw),expected);return raw;}
async function absent(p){try{await fs.lstat(p);return false;}catch(e){if(e.code==='ENOENT')return true;throw e;}}
export function makeFenceMarker(intentSha){assert.match(intentSha,/^[a-f0-9]{64}$/);return {version:'teruisi-system-maintenance-v1',id:fenceFixed.repairId,runtimeRoot:path.win32.normalize('D:/teruisi-runtime/django-sales'),keepPostgres:true,drainedStopped:false,repairIntentSha256:intentSha,batchSha256:fenceFixed.batch};}
export function assertFenceMarker(value,intentSha){assert.deepEqual(value,makeFenceMarker(intentSha));}
export function assertFenceContext(v){
 assert.equal(v.count,49);assert.equal(v.head,fenceFixed.head);assert.deepEqual(v.owner,{batchSha256:fenceFixed.batch,id:fenceFixed.batchId});
 assert.deepEqual(v.unknown,['op-startworker-switch']);assert.equal(v.startStatus,'unknown');assert.equal(v.startHead,fenceFixed.head);
 assert.deepEqual(v.passed,['op-prepare','backup-pre','op-entermaintenance-drain','op-stopworker-switch','op-apply','previous-reference-guard','op-deployapp-switch','op-hardenacl-switch','installed-recovery-consumer','restore-installed','op-exitmaintenance-switch']);
 assert.equal(v.worker,fenceFixed.worker);assert.equal(v.django,fenceFixed.django);assert.equal(v.desiredSha256,fenceFixed.desired);
 assert.equal(v.desired.version,'teruisi-django-supervisor-desired-state-v1');assert.equal(v.desired.desiredState,'running');assert.equal(v.desired.serviceScriptSha256,fenceFixed.service);assert.equal(v.drainAbsent,true);
}
export function assertFenceActor(v,phase,now=Date.now()){
 assert.equal(v.version,'repair-fence-actor-acl-v1');assert.equal(v.sid,fenceFixed.sid);assert.equal(v.administrator,true);assert.equal(v.phase,phase);assert.equal(v.rootAclVerified,true);assert.equal(v.parentAclVerified,true);assert.equal(v.markerAclVerified,phase==='After');
 const time=Date.parse(v.observedAt);assert(Number.isFinite(time)&&Number.isFinite(now)&&time<=now&&now-time<=5000,'Actor/ACL observation expired');
}
export async function publishCreateOnly(p,raw){const parents=await physical(path.dirname(p));assert(await absent(p),'Target already exists');const handle=await fs.open(p,'wx');try{await handle.writeFile(raw);await handle.sync();}finally{await handle.close();}assert.deepEqual(await physical(path.dirname(p)),parents);assert.equal(hash(await file(p)),hash(raw));}
async function observeContext(api,batch){
 const state=await api.journalState(journalRoot,batch),d=await file(desired,fenceFixed.desired);
 return {count:state.events.length,head:state.previous,owner:JSON.parse(await file(journalRoot+'/active.json')),unknown:state.unknown.map(x=>x.operationId),startStatus:state.latest.get('op-startworker-switch')?.status,startHead:state.latest.get('op-startworker-switch')?.eventSha256,passed:batch.operations.filter(o=>state.latest.get(o.id)?.status==='passed').map(o=>o.id),worker:hash(await file('D:/teruisi-runtime/teruisi-worker-sales/releases/20261011T090355Z-21c2645a63247749/deployment-manifest.json',fenceFixed.worker)),django:hash(await file(runtime+'/app/deployment.json',fenceFixed.django)),desiredSha256:hash(d),desired:JSON.parse(d),drainAbsent:await absent(drain)};
}
async function actor(source,phase){
 await file(ps,psHash);const decodedSource=Buffer.from(source.toString('utf8').replace(/^\ufeff/,''),'utf8');const code=`& ([scriptblock]::Create([Text.UTF8Encoding]::new($false,$true).GetString([Convert]::FromBase64String('${decodedSource.toString('base64')}')))) -Phase '${phase}'`;
 const env={...process.env};for(const k of Object.keys(env))if(['PSMODULEPATH','TERUISI_DJANGO_SERVICE_LIBRARY_ONLY','TERUISI_DJANGO_MAINTENANCE_LIBRARY_ONLY'].includes(k.toUpperCase()))delete env[k];env.PSModulePath=path.win32.normalize('C:/Windows/System32/WindowsPowerShell/v1.0/Modules');
 const r=spawnSync(ps,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:1048576,env});
 await file(ps,psHash);assert.equal(r.error,undefined);assert.equal(r.status,0,'Actor/ACL failed');const value=JSON.parse(r.stdout);assertFenceActor(value,phase);
 return {value,stdoutSha256:hash(r.stdout),stderrSha256:hash(r.stderr),stderrBytes:Buffer.byteLength(r.stderr)};
}
export async function createStartupRepairFence(intentPath,intentSha){
 assert(!Object.keys(process.env).some(k=>/^NODE_/i.test(k)));assert.match(intentSha,/^[a-f0-9]{64}$/);
 const intent=JSON.parse(await file(intentPath,intentSha));assert.deepEqual(Object.keys(intent).sort(),['files','fixed','version']);assert.equal(intent.version,'startup-repair-fence-intent-v1');assert.deepEqual(intent.fixed,fenceFixed);
 const expected=['create-startup-repair-fence.mjs','Read-RepairFenceActorAcl.ps1','fence-original-bootstrap.mjs'].map(n=>path.join(own,n));assert.deepEqual(intent.files.map(x=>path.resolve(x.path)).sort(),expected.map(x=>path.resolve(x)).sort());assert.equal(new Set(intent.files.map(x=>path.resolve(x.path))).size,3);
 async function ownPins(){await file(intentPath,intentSha);for(const f of intent.files){assert.deepEqual(Object.keys(f).sort(),['path','sha256']);await file(f.path,f.sha256);}await file(runtime+'/app/tools/django-local-service.ps1',fenceFixed.service);}
 await ownPins();const bootstrap=path.join(own,'fence-original-bootstrap.mjs');await file(bootstrap,'13e6700181cad60e7576cd60a8f523c36c935f734f63cae5f348f025a5c5de25');await file(specPath,'960c5c3e99da1f5cd7bacf57ae3aa0889fcecb9cd522d9165870560668c7678b');
 const {bootstrapReconciliation}=await import(pathToFileURL(bootstrap));const {spec,api,verifyPins}=await bootstrapReconciliation(specPath,fenceFixed.batch);
 await physical(evidence);const actorSource=await file(path.join(own,'Read-RepairFenceActorAcl.ps1'),intent.files.find(x=>path.basename(x.path)==='Read-RepairFenceActorAcl.ps1').sha256);
 return api.withRotationLock(async()=>{
  await verifyPins();await ownPins();const before=await observeContext(api,spec.batch);assertFenceContext(before);assert(await absent(marker),'Maintenance exists');await physical(path.dirname(marker));
  const beforeActor=await actor(actorSource,'Before');const finalBefore=await observeContext(api,spec.batch);assertFenceContext(finalBefore);assert.deepEqual(finalBefore,before);assert(await absent(marker));assertFenceActor(beforeActor.value,'Before');
  const value=makeFenceMarker(intentSha),raw=Buffer.from(canonical(value)+'\n');
  await publishCreateOnly(evidence+'/BEFORE.json',Buffer.from(canonical({intentSha256:intentSha,before,beforeActor,markerSha256:hash(raw)})+'\n'));
  // The one production write. Failure leaves the file for exact reconciliation;
  // never remove or rewrite a partial/existing marker, owner, WAL or drain.
  try{
   assert(await absent(marker));assertFenceActor(beforeActor.value,'Before');await publishCreateOnly(marker,raw);
   await verifyPins();await ownPins();const afterActor=await actor(actorSource,'After');const after=await observeContext(api,spec.batch);assertFenceContext(after);assert.deepEqual(after,before);assertFenceMarker(JSON.parse(await file(marker,hash(raw))),intentSha);assertFenceActor(afterActor.value,'After');
   const result={status:'maintenance-intent-created-only',intentSha256:intentSha,repairId:fenceFixed.repairId,markerSha256:hash(raw),before,after,afterActor,drainedStopped:false,servicesStopped:false,alreadyRunningDiagnosticsEnded:false,taskChanged:false,walChanged:false,ownerReleased:false};
   await publishCreateOnly(evidence+'/RESULT.json',Buffer.from(canonical(result)+'\n'));return result;
  }catch(e){try{await publishCreateOnly(evidence+'/FAILURE.json',Buffer.from(canonical({status:'unknown',intentSha256:intentSha,errorType:e.name,errorMessageSha256:hash(e.message),markerMayExist:true,noAutomaticCleanup:true})+'\n'));}catch(saveError){e.fenceEvidenceSaveFailure={code:saveError.code??null,messageSha256:hash(saveError.message)};}throw e;}
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){assert.equal(process.argv.length,4);createStartupRepairFence(...process.argv.slice(2)).then(x=>console.log(canonical(x))).catch(e=>{console.error(JSON.stringify({status:'failed',errorType:e.name,errorMessageSha256:hash(e.message),saveFailure:e.fenceEvidenceSaveFailure??null}));process.exitCode=1;});}
