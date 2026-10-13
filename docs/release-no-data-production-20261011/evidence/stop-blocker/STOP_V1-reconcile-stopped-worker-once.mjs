// Exact stopped-postcondition reconciliation via the original engine API, never a lifecycle replay.
import assert from 'node:assert/strict';
import {readFile,lstat,realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const directory=path.dirname(fileURLToPath(import.meta.url));
const evidence='E:/codex-artifacts/release-site-blockers-20261011/production-f15d06a/';
const specPath='E:/codex-artifacts/release-site-blockers-20261011/ADOPTION_BATCH_LIVE_V1.json';
const journal='D:/teruisi-runtime/teruisi-worker-sales/state/release-batches';
const canonical=v=>Array.isArray(v)?`[${v.map(canonical).join(',')}]`:v&&typeof v==='object'?`{${Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')}}`:JSON.stringify(v);
const hash=v=>createHash('sha256').update(Buffer.isBuffer(v)||typeof v==='string'?v:canonical(v)).digest('hex');
async function checked(file,expected){const identities=[];for(let p=path.resolve(file);;){const s=await lstat(p,{bigint:true});assert.equal(s.isSymbolicLink(),false);assert.equal((await realpath(p)).toLowerCase(),p.toLowerCase());identities.push([p,String(s.dev),String(s.ino)]);const parent=path.dirname(p);if(parent===p)break;p=parent;}const a=await lstat(file,{bigint:true});assert.ok(a.isFile()&&a.nlink===1n);const raw=await readFile(file),b=await lstat(file,{bigint:true});for(const k of ['dev','ino','nlink','size','mtimeNs','ctimeNs'])assert.equal(a[k],b[k]);for(const [p,dev,ino]of identities){const s=await lstat(p,{bigint:true});assert.equal(s.isSymbolicLink(),false);assert.equal(String(s.dev),dev);assert.equal(String(s.ino),ino);assert.equal((await realpath(p)).toLowerCase(),p.toLowerCase());}if(expected)assert.equal(hash(raw),expected);return raw;}
export async function reconcileStoppedWorkerOnce(intentPath,intentSha256){
 assert.ok(!Object.keys(process.env).some(n=>/^NODE_/i.test(n)));assert.match(intentSha256,/^[a-f0-9]{64}$/);
 const intentRaw=await checked(intentPath,intentSha256),intent=JSON.parse(intentRaw);
 assert.equal(intent.version,'fixed-f15-stopped-postcondition-intent-v1');
 const expected=['reconcile-stopped-worker-once.mjs','stop-reconciliation-state.mjs','collect-stop-postcondition.mjs','backup-reconcile-bootstrap.mjs'];
 assert.deepEqual(Object.keys(intent).sort(),['version','files'].sort());assert.equal(intent.files.length,expected.length);
 assert.deepEqual(intent.files.map(f=>f.path).sort(),expected.map(n=>path.join(directory,n)).sort());
 for(const f of intent.files){assert.deepEqual(Object.keys(f).sort(),['path','sha256']);assert.match(f.sha256,/^[a-f0-9]{64}$/);await checked(f.path,f.sha256);}
 const bootPin=intent.files.find(f=>f.path===path.join(directory,'backup-reconcile-bootstrap.mjs'));assert.equal(bootPin.sha256,'13e6700181cad60e7576cd60a8f523c36c935f734f63cae5f348f025a5c5de25');
 const {stopFixed,normalizeStopObservation,validateStoppedPostcondition}=await import(pathToFileURL(path.join(directory,'stop-reconciliation-state.mjs')));
 const {collectStopPostcondition,readStopEvidenceFile}=await import(pathToFileURL(path.join(directory,'collect-stop-postcondition.mjs')));
 const {bootstrapReconciliation}=await import(pathToFileURL(bootPin.path));
 await checked(specPath,'960c5c3e99da1f5cd7bacf57ae3aa0889fcecb9cd522d9165870560668c7678b');
 const {spec,api,verifyPins}=await bootstrapReconciliation(specPath,stopFixed.batch);api.verifyBatch(spec.batch,stopFixed.batch);
 const operation=spec.batch.operations.find(o=>o.id===stopFixed.operation);
 // The original API validates this proof before entering its lock callback. The observation
 // digest is replaced ONLY after real lock-held sampling; no callback runs with the intent placeholder.
 const proof={independent:true,batchSha256:stopFixed.batch,operationId:stopFixed.operation,observationsSha256:intentSha256,noReplay:true,intentSha256,decision:'Stop target established by passed EnterMaintenance; StopForRelease call failed and is not replayed'};
 let observationSha256;
 const event=await api.reconcileOperation({root:journal,batch:spec.batch,approved:stopFixed.batch,operationId:stopFixed.operation,resolution:'passed',proof,
  lock:callback=>api.withRotationLock(async()=>{
   await verifyPins();for(const f of intent.files)await checked(f.path,f.sha256);await checked(intentPath,intentSha256);
   const chain=await api.resolveEffectiveReleaseChain();
   const observed=await collectStopPostcondition(),observation=normalizeStopObservation(observed);
   const state=await api.journalState(journal,spec.batch),active=JSON.parse(await readStopEvidenceFile(path.join(journal,'active.json')));
   const context={state,active,observation,chain,djangoManifestSha256:observed.djangoManifestSha256,operation,operations:spec.batch.operations};
   const decision=validateStoppedPostcondition(context);
   // Compare the actual gate/identity bytes at the last boundary, never rewrite a gate.
   for(const [key,file]of [['active',path.join(journal,'active.json')],['maintenance','D:/teruisi-runtime/django-sales/run/system-maintenance.json'],['drain','D:/teruisi-runtime/django-sales/run/automation-drain.json'],['lastControlledStop','D:/teruisi-runtime/teruisi-worker-sales/state/worker-last-controlled-stop.json']])await readStopEvidenceFile(file,observed[key].sha256);
   await readStopEvidenceFile('D:/teruisi-runtime/django-sales/app/deployment.json',stopFixed.django);
   try{await lstat('D:/teruisi-runtime/teruisi-worker-sales/state/worker-process.json');throw Error('Worker receipt reappeared');}catch(e){if(e.code!=='ENOENT')throw e;}
   assert.ok(Date.now()-Date.parse(observed.finishedAt)>=0&&Date.now()-Date.parse(observed.finishedAt)<=5000,'Live stopped observation expired');
   const observations={version:'fixed-stop-reconciliation-observations-v1',intentSha256,unknownEventSha256:state.previous,passedEnterMaintenanceSha256:stopFixed.entered,observed,chain:{head:chain.head,chainStateSha256:chain.chainStateSha256,successorCount:chain.successorCount},decision};
   observationSha256=hash(observations);await api.writeOnce(evidence+'stop-reconciliation/OBSERVATIONS.json',observations);
   proof.observationsSha256=observationSha256;await api.writeOnce(evidence+'stop-reconciliation/PROOF.json',proof);
   const final=await api.journalState(journal,spec.batch);assert.equal(final.previous,stopFixed.head);assert.equal(final.events.length,19);
   assert.ok(Date.now()-Date.parse(observed.finishedAt)<=5000,'Observation expired before original reconciliation');
   const result=await callback();
   const after=await api.journalState(journal,spec.batch);assert.equal(after.events.length,20);assert.equal(after.previous,result.eventSha256);assert.equal(after.unknown.length,0);assert.equal(after.latest.get(stopFixed.operation).status,'passed');assert.equal(after.latest.get(stopFixed.operation).receiptSha256,hash(proof));assert.equal(after.latest.get(stopFixed.operation).outputs,undefined);
   return result;
  })});
 return {status:'stopped-postcondition-reconciled-only',batchSha256:stopFixed.batch,operationId:stopFixed.operation,eventSha256:event.eventSha256,observationsSha256:observationSha256,proofSha256:hash(proof),originalStopForRelease:'gate-failed-not-replayed'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){assert.equal(process.argv.length,4);reconcileStoppedWorkerOnce(...process.argv.slice(2)).then(v=>console.log(canonical(v))).catch(e=>{console.error(e.message);process.exitCode=1;});}
