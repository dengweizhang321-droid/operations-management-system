// Create-only unapproved successor scope; preserve f0 and every old WAL.
import {readFile,writeFile,lstat,realpath} from 'node:fs/promises';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
const out='E:/codex-artifacts/release-site-blockers-20261011',prior='E:/codex-artifacts/release-first-adoption-targeted-20261011';
const canonical=v=>Array.isArray(v)?`[${v.map(canonical).join(',')}]`:v&&typeof v==='object'?`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`:JSON.stringify(v);
const hash=v=>createHash('sha256').update(typeof v==='string'||Buffer.isBuffer(v)?v:canonical(v)).digest('hex');
async function bytes(file){const absolute=path.resolve(file);for(let c=absolute;;){assert.equal((await lstat(c)).isSymbolicLink(),false);assert.equal((await realpath(c)).toLowerCase(),c.toLowerCase());const parent=path.dirname(c);if(parent===c)break;c=parent;}const a=await lstat(absolute,{bigint:true});assert.ok(a.isFile()&&a.nlink===1n);const raw=await readFile(absolute),b=await lstat(absolute,{bigint:true});for(const k of ['dev','ino','size','nlink','mtimeNs','ctimeNs'])assert.equal(a[k],b[k]);return raw;}
const oldRaw=await bytes(prior+'/ADOPTION_BATCH_FRESH_V1.json');
assert.equal(hash(oldRaw),'eec240464811a6e954f489d8504aa6b77880f99187340b5899509a2093a5d639');
const old=JSON.parse(oldRaw),spec=structuredClone(old),batch=spec.batch;
const candidate='D:/teruisi-runtime/teruisi-worker-sales/releases/20261011T090355Z-21c2645a63247749',tools=path.join(candidate,'tools');
const manifestRaw=await bytes(path.join(candidate,'deployment-manifest.json'));assert.equal(hash(manifestRaw),batch.binding.artifactSha256);
const manifest=JSON.parse(manifestRaw);
// Pin the module import closure through the approved exact candidate manifest.
for(const key of manifest.artifacts.keyFiles.filter(k=>k.relativePath.startsWith('tools/')))assert.equal(hash(await bytes(path.join(candidate,...key.relativePath.split('/')))),key.sha256);
for(const entry of old.collector.files)assert.equal(hash(await bytes(entry.path)),entry.sha256,'Original module/toolchain/test closure drift');
const {verifyBatch}=await import(pathToFileURL(path.join(tools,'release-batch.mjs')));
verifyBatch(old.batch,old.batch.batchSha256);
const here=path.dirname(fileURLToPath(import.meta.url)),specPath=out+'/ADOPTION_BATCH_LIVE_V1.json',testsPath=out+'/ADOPTION_TESTS_LIVE_V1.json';
const final=JSON.parse(await bytes(out+'/FINAL_LIVE_GUARD_VALIDATION_V1.json'));
assert.equal(final.status,'passed-for-declared-live-guard');assert.equal(final.failed,0);
assert.equal(final.sourceSha256,batch.binding.sourceSha256);assert.equal(final.artifactSha256,batch.binding.artifactSha256);
batch.id='first-adoption-live-guard-20261011';batch.createdAt=new Date().toISOString();
const oldMaintenance=batch.binding.maintenanceId;batch.binding.maintenanceId=randomUUID().replaceAll('-','');
const oldRestore=batch.operations.find(o=>o.kind==='restore'),oldRestoreId=oldRestore.command.args[oldRestore.command.args.indexOf('-RehearsalId')+1],newRestoreId=randomUUID().replaceAll('-','').slice(0,12);
for(const op of batch.operations)if(op.command)op.command.args=op.command.args.map(v=>v===oldMaintenance?batch.binding.maintenanceId:v===oldRestoreId?newRestoreId:v);
// The new task adapters alter only the pre-deploy read-only guard contract.
const guardFiles=['adoption-scope-live-guard.mjs','live-reference-audit.mjs','live-os-instance-policy.mjs','live-wsl-policy.mjs','live-wsl-host-policy.mjs','system-wsl-verifier.mjs','collect-live-wsl.py','Collect-LiveProcessIdentity.ps1','Probe-ResidualProcessMetadataV2.ps1','Collect-SystemWslIdentity.ps1','Collect-LiveWslHostAssociation.ps1'];
const pins=[];for(const name of guardFiles){const file=path.join(here,name);pins.push({path:file,sha256:hash(await bytes(file))});}
assert.deepEqual(pins,final.guardFiles,'Tested guard closure must match sealed bytes and exact paths');
const handoffRaw=await bytes(out+'/ASTRA_LIVE_GUARD_CORE_HANDOFF_V6.json');
assert.equal(hash(handoffRaw),final.sourceHandoffSha256);
const handoff=JSON.parse(handoffRaw);
const normalized=list=>list.map(p=>({path:path.resolve(p.path).toLowerCase(),sha256:p.sha256})).sort((a,b)=>a.path.localeCompare(b.path));
assert.deepEqual(normalized(pins),normalized(handoff.files),'Independent handoff closure must match');
for(const [name,expected] of [['ADMIN_REFERENCE_DIAGNOSTIC_V1.json','4e964f0ec062f07115728dc5cb09ec05a3a794a09a29f865494927dd8b3dbd69'],['ADMIN_RESIDUAL_METADATA_V2.json','0c0c0b4074403c8b7d1a53e9d4c4ffdbdb97802bed6827bcd13e70fb264cf4d6'],['WSL_HOST_ASSOCIATION_ADMIN_V1.json','f11f84beed8e8f6645c19929f74fdd7ee88a2827dea93e72b2d2286e836eb1c4']]){
 const file=out+'/'+name;assert.equal(hash(await bytes(file)),expected);pins.push({path:file,sha256:expected});
}
const systemRecordPath=out+'/SYSTEM_WSL_IDENTITY_V1.json';pins.push({path:systemRecordPath,sha256:hash(await bytes(systemRecordPath))});
for(const op of batch.operations.filter(o=>['previous-reference-guard','unchanged-business-closure'].includes(o.id))){
 op.command.args[0]=path.join(here,'adoption-scope-live-guard.mjs');op.command.args[1]=specPath;
 op.command.files=op.command.files.filter(f=>!f.path.endsWith('adoption-scope-guard-ig04.mjs')).concat(pins);
 assert.ok(!op.command.files.some(f=>path.basename(f.path).toLowerCase()==='wsl.exe'),'System WSL uses dedicated exact identity validator; generic artifacts retain one-link rule');
}
batch.tests.evidence.push({path:out+'/FINAL_LIVE_GUARD_VALIDATION_V1.json',sha256:hash(await bytes(out+'/FINAL_LIVE_GUARD_VALIDATION_V1.json'))});
batch.tests.scope+=' New exact live guard protocol requires original references first, fresh same-instance native/guest/HCS evidence and specialized byte-bound Windows WSL system-tool verification; no saved diagnostic fallback or automatic production permission.';
batch.binding.testsSha256=hash(batch.tests);
await writeFile(testsPath,JSON.stringify(batch.tests,null,2)+'\n',{flag:'wx'});
spec.collector.args[2]=specPath;const oldTests=spec.collector.args[3];spec.collector.args[3]=testsPath;
const testsRawSha256=hash(await bytes(testsPath));
spec.collector.files=spec.collector.files.map(f=>f.path===oldTests?{path:testsPath,sha256:testsRawSha256}:f);
batch.collectorSha256=hash(spec.collector);delete batch.batchSha256;batch.batchSha256=hash(batch);
verifyBatch(batch,batch.batchSha256);
assert.equal(batch.operations.length,19);assert.equal(batch.operations.filter(o=>o.kind==='backup').length,1);assert.equal(batch.operations.filter(o=>o.kind==='restore').length,1);
assert.equal(batch.binding.sourceSha256,old.batch.binding.sourceSha256);assert.equal(batch.binding.artifactSha256,old.batch.binding.artifactSha256);
spec.execution.qualifyArgs=[spec.execution.entryPath,'qualify',specPath,batch.batchSha256];
spec.execution.executeArgs=[spec.execution.entryPath,'execute',specPath,batch.batchSha256,'<explicit-approval-UTC-timestamp>'];
spec.productionApproved=false;
await writeFile(specPath,JSON.stringify(spec,null,2)+'\n',{flag:'wx'});
await writeFile(out+'/ADOPTION_BATCH_LIVE_SEALED_V1.json',JSON.stringify({batchSha256:batch.batchSha256,specRawSha256:hash(await bytes(specPath)),specPath,priorBatchSha256:old.batch.batchSha256,sourceSha256:batch.binding.sourceSha256,workerManifestSha256:batch.binding.artifactSha256,djangoManifestSha256:batch.binding.djangoCandidateSha256,maintenanceId:batch.binding.maintenanceId,operations:batch.operations.map(o=>({id:o.id,kind:o.kind,phase:o.phase,step:o.step})),databaseOperations:batch.databaseOperations,execution:spec.execution,productionApproved:false},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({batchSha256:batch.batchSha256,operations:19,productionApproved:false}));
