// Fixed f15 recovery context and ONE own marker. No lifecycle, scheduler,
// process termination, arbitrary paths, WAL mutation or gate removal.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';
import {assertStartupStopDeclaration,startupEvidenceSha256,startupLaunchEvidenceSha256} from '../../tools/startup-exact-instance-policy.mjs';
export const fixed=Object.freeze({batchSha256:'f15d06a159073927ba3565712027aa645869333a3210c54e1858738756ca110f',batchId:'first-adoption-live-guard-20261011',walHead:'1a614e58caf56a243ea8dead3ce1609993fd993c3ed39cac296bf83c64617bd4',walCount:49,workerSha256:'6cff8886e533244997b65d2a8668776cee5178b95e4e2a99ed14bd25bf2733f4',djangoSha256:'85cf0699925aad21f98ae682f458789236d206723b10865939915d1bcacddd09',serviceSha256:'95331de5035e8c7a284eb3a8508b547ff6511e3d712078822f2d74bd63087b1c',desiredSha256:'1cfe7abb6b6b4d16bba5745dc440e02068a8ddfe744ca8e96d5e5452345a9fc4',repairId:'12c465652dbc4b5f9f54d0b0f30eeb3a',bundleId:'3e46d2454ddb0879c36ead3b27305d5f128e6bacc40f245d0404324b21e07280',sid:'S-1-5-21-815909789-107973518-1379257801-1001'});
const root='D:/teruisi-runtime/django-sales',journal='D:/teruisi-runtime/teruisi-worker-sales/state/release-batches',wal=journal+'/'+fixed.batchId;
const paths={marker:root+'/run/system-maintenance.json',drain:root+'/run/automation-drain.json',desired:root+'/run/django-supervisor-desired-state.json',worker:'D:/teruisi-runtime/teruisi-worker-sales/releases/20261011T090355Z-21c2645a63247749/deployment-manifest.json',django:root+'/app/deployment.json'};
export const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
export const hash=v=>createHash('sha256').update(v).digest('hex');
function ancestors(p){const out=[];for(let q=path.resolve(p);;q=path.dirname(q)){const s=fs.lstatSync(q,{bigint:true});assert(!s.isSymbolicLink());assert.equal(fs.realpathSync(q).toLowerCase(),q.toLowerCase());out.push([q,String(s.dev),String(s.ino)]);if(q===path.dirname(q))return out;}}
export function readStable(p,expected){const chain=ancestors(p),a=fs.lstatSync(p,{bigint:true});assert(a.isFile());const system=path.resolve(p).toLowerCase()===path.resolve('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe').toLowerCase();assert.equal(a.nlink,system?2n:1n);if(system)assert.equal(expected,'7600ffe12da441fe89d035b13801e8e91d064bc544a27b19a5cf49f6ab8b18f5');const b=fs.readFileSync(p),z=fs.lstatSync(p,{bigint:true});for(const k of ['dev','ino','size','nlink','mtimeNs','ctimeNs'])assert.equal(a[k],z[k]);assert.deepEqual(ancestors(p),chain);if(expected)assert.equal(hash(b),expected);return b;}
function optional(p){try{return JSON.parse(readStable(p));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
function exactKeys(v,keys){assert.deepEqual(Object.keys(v).sort(),[...keys].sort());}
export function assertRecoveryPlan(p){
 exactKeys(p,['version','fixed','createdAt','watchdogPlan','stopDeclaration','descendantEvidence','pins','walPins','evidenceRoot','deadlineMs']);assert.equal(p.version,'startup-recovery-integration-v1');assert.deepEqual(p.fixed,fixed);assert(Number.isFinite(Date.parse(p.createdAt)));assert.equal(p.deadlineMs,1800000);
 exactKeys(p.descendantEvidence,['path','sha256']);assert.equal(path.resolve(p.descendantEvidence.path),path.resolve('E:/codex-artifacts/startup-recovery-integration-20261012/RECOVERY_DESCENDANTS_V2.json'));assert.match(p.descendantEvidence.sha256,/^[a-f0-9]{64}$/);
 assert.equal(p.watchdogPlan.bundleId,fixed.bundleId);assert.match(p.watchdogPlan.planId,/^[a-f0-9]{64}$/);assert.match(p.watchdogPlan.predecessorInstallationSha256,/^[a-f0-9]{64}$/);assert.match(p.watchdogPlan.predecessorTaskSha256,/^[a-f0-9]{64}$/);
 assert.equal(path.resolve(p.evidenceRoot),path.resolve('E:/codex-artifacts/startup-recovery-integration-20261012/approved-recovery-v1'));
 assert.equal(p.walPins.length,49);for(let i=0;i<49;i++){exactKeys(p.walPins[i],['name','sha256']);assert.equal(p.walPins[i].name,String(i).padStart(6,'0')+'.json');assert.match(p.walPins[i].sha256,/^[a-f0-9]{64}$/);}
 assert(Array.isArray(p.pins)&&p.pins.length>0);const seen=new Set();for(const f of p.pins){exactKeys(f,['path','sha256']);assert(path.isAbsolute(f.path));assert(!seen.has(path.resolve(f.path).toLowerCase()));seen.add(path.resolve(f.path).toLowerCase());assert.match(f.sha256,/^[a-f0-9]{64}$/);}
 return p;
}
export function assertDescendantEvidence(plan,raw){
 assert.equal(hash(raw),plan.descendantEvidence.sha256);const capture=JSON.parse(raw);assert.equal(capture.exitCode,0);assert.equal(capture.spawnErrorCode,null);const e=capture.observation;
 const collectors=plan.pins.filter(x=>path.basename(x.path)==='Collect-RecoveryDescendants.ps1');assert.equal(collectors.length,1);assert.equal(capture.sourceSha256,collectors[0].sha256);
 assert.equal(e.version,'recovery-descendant-metadata-v1');assert.equal(e.sid,fixed.sid);assert.equal(e.roots,23);assert.equal(e.treeStableAtSamples,true);assert.deepEqual(e.unknown,[]);assert.equal(e.records.length,92);assert.equal(e.rawCommandsPersisted,false);assert.equal(e.terminateHandlesOpened,0);assert.equal(e.productionStops,0);
 const seen=new Set();for(const r of e.records){assert(!seen.has(r.processId));seen.add(r.processId);assert.equal(r.identityStable,true);}
 const descendants=e.records.filter(r=>r.depth>0).map(({processId,parentProcessId,nativeCreationFileTime,imageSha256,commandSha256,rootProcessId,depth})=>({processId,parentProcessId,nativeCreationFileTime,imageSha256,commandSha256,rootProcessId,depth}));assert.equal(descendants.length,69);assert.deepEqual(plan.stopDeclaration.descendants,descendants);
 const roots=e.records.filter(r=>r.depth===0);assert.equal(roots.length,23);for(const r of roots){const expected=plan.stopDeclaration.roots.find(x=>x.processId===r.processId);assert(expected);for(const k of ['parentProcessId','nativeCreationFileTime','imageSha256','commandSha256','depth'])assert.equal(r[k],expected[k]);assert.equal(r.rootProcessId,r.processId);}
 return e;
}
export function validatedStopTargets(plan){const base=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../startup-status-receipt-safety-20261012/evidence/actual-admin-metadata');assertDescendantEvidence(plan,readStable(plan.descendantEvidence.path,plan.descendantEvidence.sha256));return assertStartupStopDeclaration(plan.stopDeclaration,readStable(path.join(base,'ADMIN_STARTUP_IDENTITY_V1.json'),startupEvidenceSha256),readStable(path.join(base,'ASTRA_ACTUAL_READBACK.json'),startupLaunchEvidenceSha256));}
export function assertMissingOriginalReceipts(plan){validatedStopTargets(plan);ancestors(root+'/run');for(const r of plan.stopDeclaration.roots){assert.match(r.service,/^django-[a-z-]+$/);const target=path.join(root,'run',r.service+'.pid.json');try{fs.lstatSync(target);assert.fail('A previously missing service receipt has reappeared: '+r.service);}catch(e){if(e.code!=='ENOENT')throw e;}}}
export function makeRecoveryMarker(planSha){assert.match(planSha,/^[a-f0-9]{64}$/);return {version:'teruisi-system-maintenance-v1',id:fixed.repairId,runtimeRoot:path.win32.normalize(root),keepPostgres:true,drainedStopped:false,repairIntentSha256:planSha,batchSha256:fixed.batchSha256};}
export function assertOwnGates(marker,drain,sha){if(marker){exactKeys(marker,Object.keys(makeRecoveryMarker(sha)));assert.deepEqual({...marker,drainedStopped:false},makeRecoveryMarker(sha));assert.equal(typeof marker.drainedStopped,'boolean');}if(drain){assert.equal(drain.version,'teruisi-automation-drain-v1');assert.equal(drain.id,fixed.repairId);assert.equal(drain.runtimeRoot,path.win32.normalize(root));assert.equal(drain.keepPostgres,true);assert(['helpers','requests'].includes(drain.phase));}}
export function assertRecoveryStageContext(stage,v,sha){
 assertOwnGates(v.marker,v.drain,sha);
 assert.equal(v.desired.version,'teruisi-django-supervisor-desired-state-v1');assert.equal(v.desired.serviceScriptSha256,fixed.serviceSha256);assert(['running','stopped'].includes(v.desired.desiredState));
 if(['preflight','create-intent'].includes(stage)){assert.equal(v.marker,null);assert.equal(v.drain,null);assert.equal(v.desiredSha256,fixed.desiredSha256);}
 else if(['await-drain','stop-declared-instances','enter-stopped-maintenance'].includes(stage)){assert(v.marker);assert.equal(v.marker.drainedStopped,false);if(stage!=='await-drain'){assert(v.drain);assert.equal(v.drain.phase,'requests');}}
 else if(stage==='exit-stopped-maintenance'){assert(v.marker);assert.equal(v.marker.drainedStopped,true);assert(v.drain);assert.equal(v.drain.phase,'requests');assert.equal(v.desired.desiredState,'stopped');}
 else if(['start-original-stack','restore-supervisor','verify-ready','install-diagnostic','verify-installation'].includes(stage)){assert.equal(v.marker,null);assert.equal(v.drain,null);assert.equal(v.desired.desiredState,stage==='start-original-stack'?'stopped':'running');}
 else assert.equal(stage,'failure-containment');
}
export function observeRecoveryContext(plan,planSha,stage){
 assertRecoveryPlan(plan);for(const f of plan.pins)readStable(f.path,f.sha256);
 if(['preflight','create-intent','await-drain','stop-declared-instances'].includes(stage))assertMissingOriginalReceipts(plan);
 assert.deepEqual(fs.readdirSync(wal).sort(),plan.walPins.map(f=>f.name));for(const f of plan.walPins)readStable(path.join(wal,f.name),f.sha256);
 const last=JSON.parse(readStable(path.join(wal,'000048.json')));assert.equal(last.eventSha256,fixed.walHead);
 assert.deepEqual(JSON.parse(readStable(journal+'/active.json')),{batchSha256:fixed.batchSha256,id:fixed.batchId});readStable(paths.worker,fixed.workerSha256);readStable(paths.django,fixed.djangoSha256);
 const desiredRaw=readStable(paths.desired);const v={marker:optional(paths.marker),drain:optional(paths.drain),desired:JSON.parse(desiredRaw),desiredSha256:hash(desiredRaw)};assertRecoveryStageContext(stage,v,planSha);return v;
}
export function createRecoveryMarker(plan,sha,failure=false){
 const before=observeRecoveryContext(plan,sha,failure?'failure-containment':'create-intent');
 if(before.marker){assert(failure);return {status:'own-maintenance-retained',drainedStopped:before.marker.drainedStopped};}
 const chain=ancestors(path.dirname(paths.marker)),bytes=Buffer.from(canonical(makeRecoveryMarker(sha))+'\n');
 const fd=fs.openSync(paths.marker,'wx');try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 assert.deepEqual(ancestors(path.dirname(paths.marker)),chain);readStable(paths.marker,hash(bytes));
 return {status:'own-maintenance-created',markerSha256:hash(bytes),drainedStopped:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{assert.equal(process.argv.length,6);const [mode,file,sha,stage]=process.argv.slice(2);assert(['inspect','create','contain','targets'].includes(mode));const p=assertRecoveryPlan(JSON.parse(readStable(file,sha)));const r=mode==='targets'?{targets:validatedStopTargets(p)}:mode==='inspect'?observeRecoveryContext(p,sha,stage):createRecoveryMarker(p,sha,mode==='contain');console.log(JSON.stringify(r));}catch(e){console.error(JSON.stringify({status:'rejected',errorType:e.name,message:e.message}));process.exitCode=1;}
}
