import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const base='D:/codex-artifacts/s05d-field-validation-20261023';
const working='D:/codex-worktrees/s05d-field-validation-20261023';
const root=path.resolve(process.argv[2]??'');
assert.equal(path.dirname(root).toLowerCase(),path.resolve(base).toLowerCase());
assert.match(path.basename(root),/^inspect-code-[a-f0-9-]{36}$/);
assert.ok(process.argv.length===3||process.argv.length===4&&process.argv[3]==='--snapshots');
const includeSnapshots=process.argv[3]==='--snapshots';assert.equal(includeSnapshots,true,'This run requires full snapshots');
const output=base+'/inspect-'+crypto.randomUUID(),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const pinRaw=await fs.readFile(root+'/PINS.json'),manifest=JSON.parse(pinRaw);
assert.equal(manifest.writeAuthority,false);assert.equal(manifest.productionWriterReady,false);
async function verify(){for(const [name,pin] of Object.entries(manifest.files)){const raw=await fs.readFile(root+'/'+name);assert.equal(raw.length,pin.size);assert.equal(hash(raw),pin.sha256,'Frozen file changed: '+name);}for(const name of ['tools/publish-latest-main.mjs','tools/install-main-prebuild.mjs'])assert.equal(hash(await fs.readFile(working+'/'+name)),manifest.files[name].sha256,'Current qualified entry changed: '+name);}
await verify();
const started=Date.now(),result={startedAt:new Date().toISOString(),codeRoot:root,readOnly:true,writeAuthority:false,complete:false,retirementProved:false,productionWriterReady:false,pinManifestSha256:hash(pinRaw),pins:manifest.files,progressEvents:0,measurements:{}};
async function stage(event){assert.ok(++result.progressEvents<=2048);await fs.appendFile(output+'.stages.jsonl',JSON.stringify({...event,trialElapsedMs:Date.now()-started})+'\n');}
async function save(){result.elapsedMs=Date.now()-started;await fs.writeFile(output+'.result.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({output,complete:result.complete,retirementProved:false,elapsedMs:result.elapsedMs,error:result.error??null,stack:result.stack??null,pinsUnchanged:result.pinsUnchanged,progressEvents:result.progressEvents,observationBytes:result.observationBytes,measurements:result.measurements}));}
const progress=setInterval(()=>fs.appendFile(output+'.progress.jsonl',JSON.stringify({elapsedMs:Date.now()-started,rss:process.memoryUsage().rss})+'\n'),5000);
const timer=setTimeout(async()=>{clearInterval(progress);result.error='Own bounded read-only closure/CAS trial exceeded 1200000ms';try{await verify();result.pinsUnchanged=true;}catch(e){result.pinsUnchanged=false;result.error+='; '+e.message;}await save();process.exit(124);},1200000);
try{
 const {retirementInspectionContext}=await import(pathToFileURL(root+'/tools/preparation-retirement-native.mjs'));
 const {collectRetirementClosure,assertRetirementClosureUnchanged}=await import(pathToFileURL(root+'/tools/preparation-retirement-collector.mjs'));
 await stage({stage:'context-start'});const context=await retirementInspectionContext('D:/codex-isolated/main-manual-release-20261016/main-publisher-config.json');assert.equal(context.writeAuthority,false);await stage({stage:'context-ready'});
 const collectStart=performance.now();const observation=await collectRetirementClosure(context,{dispatchId:'a3d53227-8976-4762-8be6-6f8c28107b5b',onProgress:stage});result.measurements.collectMs=performance.now()-collectStart;
 await stage({stage:'same-call-closure-cas-start'});const casStart=performance.now();await assertRetirementClosureUnchanged(context,observation);result.measurements.closureCasMs=performance.now()-casStart;await stage({stage:'same-call-closure-cas-complete'});
 await verify();const raw=JSON.stringify(observation,null,2)+'\n';await fs.writeFile(output+'.observation.json',raw);result.closureComplete=true;result.observationSha256=hash(raw);result.observationBytes=Buffer.byteLength(raw);result.sourceActions=observation.sourceActions.map(x=>({source:x.source,role:x.role,kind:x.kind}));result.artifactActions=observation.artifactActions.map(x=>({source:x.source,role:x.role,kind:x.kind}));
 if(includeSnapshots){
  const {snapshotRetirementObject,assertRetirementSnapshotUnchanged}=await import(pathToFileURL(root+'/tools/preparation-retirement-archive.mjs'));
  const actions=[...observation.sourceActions,...observation.artifactActions],seen=new Set(),snapshots=[];result.snapshotMeasurements=[];
  const expected=JSON.parse(await fs.readFile('D:/codex-artifacts/s05d-residual-classification-20261023/inspect-b0a2ddc1-7453-4cbf-b580-eb1e7dd3ab88.observation.json','utf8'));
  assert.deepEqual(actions.map(x=>path.resolve(x.source).toLowerCase()).sort(),[...expected.sourceActions,...expected.artifactActions].map(x=>path.resolve(x.source).toLowerCase()).sort(),'Current action scope changed; no additional object scan');

  for(const action of actions){const key=path.resolve(action.source).toLowerCase();assert.equal(seen.has(key),false,'Action source duplicated');seen.add(key);await stage({stage:'action-snapshot-start',source:action.source,role:action.role});const began=performance.now();const snapshot=await snapshotRetirementObject(action,action.source,{native:context.native});snapshots.push({action,snapshot});const row={source:action.source,role:action.role,elapsedMs:performance.now()-began,files:snapshot.kind==='file'?1:snapshot.inventory.files.length,bytes:snapshot.kind==='file'?snapshot.file.size:snapshot.inventory.bytes};result.snapshotMeasurements.push(row);await stage({stage:'action-snapshot-complete',...row});}
  await stage({stage:'combined-fs-cas-start'});const began=performance.now();await assertRetirementClosureUnchanged(context,observation);for(const {action,snapshot} of snapshots)await assertRetirementSnapshotUnchanged(action.source,snapshot);result.measurements.combinedFsCasMs=performance.now()-began;result.measurements.excludesOrdinaryTaskBootRefAndAdoptionCas=true;await stage({stage:'combined-fs-cas-complete'});
  const bytes=JSON.stringify(snapshots,null,2)+'\n';await fs.writeFile(output+'.snapshots.json',bytes);result.snapshotFileSha256=hash(bytes);result.snapshotFileBytes=Buffer.byteLength(bytes);
 }
 result.complete=true;
}catch(e){result.error=String(e.message).slice(0,1500);result.stack=String(e.stack).split('\n').slice(0,5);process.exitCode=1;}
finally{clearTimeout(timer);clearInterval(progress);try{await verify();result.pinsUnchanged=true;}catch(e){result.pinsUnchanged=false;result.complete=false;result.error=(result.error??'')+'; '+e.message;process.exitCode=1;}await save();}
