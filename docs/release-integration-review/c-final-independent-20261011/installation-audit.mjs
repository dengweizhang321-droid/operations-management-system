// Builtin-only, bounded read-only installation audit. No product module imports.
import assert from 'node:assert/strict';
import {readFile,lstat,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const out=path.dirname(new URL(import.meta.url).pathname.replace(/^\/(?:([A-Za-z]):)/,'$1:'));
const reportPath=new URL('./INSTALLATION_AUDIT.json',import.meta.url);
const evidence='E:/codex-artifacts/release-no-data-adoption-20261011';
const candidate='D:/teruisi-runtime/teruisi-worker-sales/releases/20261011T051645Z-3032ae332a32f1a0';
const django='D:/teruisi-runtime/django-sales';
const hashes=[];
const hash=v=>createHash('sha256').update(v).digest('hex');
const canonical=v=>Array.isArray(v)?`[${v.map(canonical).join(',')}]`:v&&typeof v==='object'?`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`:JSON.stringify(v);
async function read(file){const a=await lstat(file);assert.ok(a.isFile()&&!a.isSymbolicLink()&&a.nlink===1);assert.ok(a.size<6*1024*1024);const raw=await readFile(file),b=await lstat(file);assert.equal(a.size,b.size);assert.equal(a.mtimeMs,b.mtimeMs);assert.equal(raw.length,a.size);hashes.push({path:file,bytes:raw.length,sha256:hash(raw)});return raw;}
const specRaw=await read(path.join(evidence,'ADOPTION_BATCH_V4.json')),spec=JSON.parse(specRaw),b=spec.batch;
const {batchSha256,...core}=b;
assert.equal(hash(canonical(core)),batchSha256);
assert.equal(batchSha256,'65fc5338321efc2d79168764f7b2227002333199d038409dc6dd7277acaed8d2');
assert.equal(hash(canonical(spec.collector)),b.collectorSha256);
assert.equal(spec.productionApproved,false);assert.equal(b.recovery.mode,'full');
const guardPath=path.join(evidence,'adoption-scope-guard-v4.mjs'),guardRaw=await read(guardPath);
assert.equal(hash(guardRaw),'04655a323af97453b7ae38670a6470e495226e85c337fb9b0a72684726a54edd');
const repoGuard=await read(new URL('../../release-no-data-adoption-20261011/adapters/adoption-scope-guard-v4.mjs',import.meta.url));
assert.ok(repoGuard.equals(guardRaw));
const manifestRaw=await read(path.join(candidate,'deployment-manifest.json')),wm=JSON.parse(manifestRaw);
assert.equal(hash(manifestRaw),b.binding.artifactSha256);assert.equal(wm.source.tree.sha256,b.binding.sourceSha256);
const planRaw=await read('D:/teruisi-runtime/teruisi-worker-sales/state/worker-release-rotation-plans/'+b.binding.workerPlanSha256+'.json'),plan=JSON.parse(planRaw);
assert.equal(hash(planRaw),b.binding.workerPlanSha256);assert.equal(plan.candidate.manifestSha256,b.binding.artifactSha256);
assert.equal(hash(b.sourceBinding.raw),b.sourceBinding.sha256);assert.deepEqual(plan.sourceBinding,b.sourceBinding);
const receiptRaw=await read(path.join(django,'app.prepare-'+b.binding.djangoPreparedAppId+'.json')),dr=JSON.parse(receiptRaw);
assert.equal(hash(receiptRaw),b.binding.djangoPreparedReceiptSha256);assert.equal(dr.candidateManifestSha256,b.binding.djangoCandidateSha256);assert.equal(dr.predecessorManifestSha256,b.binding.djangoPredecessorSha256);
const installedD=await read(path.join(django,'app/deployment.json')),preparedD=await read(path.join(django,'app.deploy-'+b.binding.djangoPreparedAppId,'deployment.json'));
assert.equal(hash(installedD),b.binding.djangoPredecessorSha256);assert.equal(hash(preparedD),b.binding.djangoCandidateSha256);
const inventory=b.tests.scopeValidation,oldInv=inventory.before.inventory,newInv=inventory.after.inventory;
const changed=[...new Set([...Object.keys(oldInv),...Object.keys(newInv)])].filter(p=>oldInv[p]!==newInv[p]).sort();
assert.deepEqual(changed,['.wrangler/cache/cf.json','tools/worker-local-release-rotation.mjs','tools/worker-local-release.mjs']);
const pairedTools=[];
for(const name of ['worker-local-release.mjs','worker-local-release-rotation.mjs']){
 const w=await read(path.join(candidate,'tools',name)),d=await read(path.join(django,'app.deploy-'+b.binding.djangoPreparedAppId,'tools',name));
 assert.ok(w.equals(d));assert.equal(hash(d),newInv['tools/'+name]);
 const key=wm.artifacts.keyFiles.find(v=>v.relativePath==='tools/'+name);assert.equal(key?.sha256,hash(w));
 pairedTools.push({name,sha256:hash(w),workerAndPreparedDjangoByteEqual:true});
}
const oldService=await read(path.join(django,'app/tools/django-local-service.ps1')),newService=await read(path.join(django,'app.deploy-'+b.binding.djangoPreparedAppId,'tools/django-local-service.ps1'));
assert.ok(oldService.equals(newService));
for(const name of ['release-batch.mjs','release-batch-admission.mjs','release-impact.mjs','release-lifecycle-step.ps1','worker-local-service.ps1']){
 const raw=await read(path.join(candidate,'tools',name)),key=wm.artifacts.keyFiles.find(v=>v.relativePath==='tools/'+name);assert.equal(key?.sha256,hash(raw));
}
const oldMaintenance=await read(path.join(django,'app/tools/django-postgres-maintenance.ps1')),newMaintenance=await read(path.join(django,'app.deploy-'+b.binding.djangoPreparedAppId,'tools/django-postgres-maintenance.ps1'));
assert.ok(oldMaintenance.equals(newMaintenance));
await read(path.join(django,'app/tools/release-payload-retention.ps1'));
await read(path.join(django,'app.deploy-'+b.binding.djangoPreparedAppId,'tools/release-payload-retention.mjs'));
const fixedWorker='D:\\运营管理系统\\tools\\worker-local-service.ps1';
const workerStages=[];
for(const op of b.operations){
 const before=['EnterMaintenance','StopWorker','DeployApp'].includes(op.step)||['backup-pre','restore-pre'].includes(op.phase);
 for(const f of op.command?.files??[]){const prefix='D:\\teruisi-runtime\\django-sales\\app\\';if(f.path.startsWith(prefix)){const rel=f.path.slice(prefix.length).replaceAll('\\','/');assert.equal(f.sha256,(before?oldInv:newInv)[rel],`${op.id} ${rel}`);}}
 const entry=op.command?.files?.find(f=>f.path===fixedWorker);if(entry)workerStages.push({step:op.step,sha256:entry.sha256,expectsSuccessor:!['EnterMaintenance','StopWorker'].includes(op.step)});
}
const oldWStage=workerStages.find(v=>v.step==='EnterMaintenance'),newWStage=workerStages.find(v=>v.step==='StartWorker');
assert.notEqual(oldWStage.sha256,newWStage.sha256);assert.equal(newWStage.sha256,hash(await read(path.join(candidate,'tools/worker-local-service.ps1'))));
const index=kind=>b.operations.findIndex(op=>op.kind===kind),deploy=index('django-deploy'),apply=index('worker-apply');
assert.ok(apply<deploy);assert.ok(!b.operations.slice(apply+1,deploy).some(op=>['backup','restore'].includes(op.kind)));
assert.deepEqual(b.databaseOperations.operationIds,['backup-pre','restore-pre','backup-post','restore-post']);
const db=b.operations.filter(op=>['backup','restore'].includes(op.kind));for(const op of db)assert.equal(op.command.args[3],'D:\\teruisi-runtime\\django-sales\\app\\tools\\django-postgres-maintenance.ps1');
const preservedRaw=await read(path.join(evidence,'APP_PREVIOUS_PRESERVED.json')),preserved=JSON.parse(preservedRaw);
const oldPrevious=await read(path.join(preserved.source,'deployment.json')),preservedManifest=await read(path.join(preserved.target,'deployment.json'));assert.ok(oldPrevious.equals(preservedManifest));assert.equal(hash(oldPrevious),preserved.manifestSha256);
const guardOp=b.operations.find(op=>op.id==='previous-reference-guard');for(const [p,sha] of [[guardPath,hash(guardRaw)],[path.join(evidence,'APP_PREVIOUS_PRESERVED.json'),hash(preservedRaw)]])assert.ok(guardOp.command.files.some(f=>path.resolve(f.path)===path.resolve(p)&&f.sha256===sha));
const handoff=JSON.parse(await read(path.join(evidence,'ASTRA_GUARD_V4_HANDOFF.json')));
assert.equal(hash(await read(handoff.tests.path)),handoff.tests.sha256);assert.equal(hash(await read(handoff.tests.log)),handoff.tests.logSha256);assert.equal(handoff.tests.passed,16);assert.equal(handoff.tests.failed,0);
const refs=JSON.parse(await read(path.join(evidence,'ALL_REFERENCES_V4.json')));
assert.equal(refs.guardSha256,hash(guardRaw));
const output={version:'teruisi-v4-installation-bounded-audit-v1',observedAt:new Date().toISOString(),independent:true,productionExecutionApproved:false,
 sourceCommit:'030024542ef76be081f69023fefb0601dd4d06b5',batchSha256,batchRawSha256:hash(specRaw),guardSha256:hash(guardRaw),binding:b.binding,
 checks:{canonicalBatchAndCollectorMatched:true,sourceBindingMatchesPlan:true,workerManifestAndToolsKeyFilesMatched:true,djangoPreparedReceiptMatched:true,oldAndPreparedServiceAndMaintenanceBytesEqual:true,oldAndPreparedInventoryCounts:[Object.keys(oldInv).length,Object.keys(newInv).length],djangoDeclaredChanges:changed,pairedTools,workerStages,
 transition:{workerApplyPosition:apply+1,djangoDeployPosition:deploy+1,between:b.operations.slice(apply+1,deploy).map(op=>op.id),backupRestoreBetween:false},databaseOperations:db.map(op=>({id:op.id,kind:op.kind,operator:op.command.args[3],usesPreparedOperator:false})),
 previousPackage:{manifestMatchesPreservedCopy:true,manifestSha256:preserved.manifestSha256,declaredTree:preserved.tree,wholeTreeRehashedThisReview:false,guardAndPreservationFilePinned:true},
 author16VM:{testSha256:handoff.tests.sha256,logSha256:handoff.tests.logSha256,passed:16,failed:0,durationMs:handoff.tests.durationMs,rerunThisReview:false},priorReferenceSnapshot:{at:refs.at,filesScanned:refs.filesScanned,processes:refs.processes,scheduledTasks:refs.scheduledTasks,status:refs.status,notFreshExecutionGate:true}},
 operations:b.operations.map((op,i)=>({ordinal:i+1,id:op.id,kind:op.kind,phase:op.phase,step:op.step??null})),physicalSmallFiles:hashes,
 limitations:['No full source/build/npm or 3468-file previous tree rehash.','No native process/task scan, Status, HTTP, SQL, CLI, lock, Backup/Restore or lifecycle call.','No actual rollback, restore exercise, installation or new backup strategy qualification.']};
await writeFile(reportPath,JSON.stringify(output,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:'bounded-audit-passed',batchSha256,operations:b.operations.length,djangoInventoryCounts:output.checks.oldAndPreparedInventoryCounts,pairedTools:pairedTools.length,smallFiles:hashes.length,productionActions:0}));
