// Read-only independent sealed-structure inspection. No operator/collector run.
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { sha, canonical, components } from './validators.mjs';
const [input,output]=process.argv.slice(2),root=path.resolve(input);
const raw=await readFile(path.join(root,'approved-batch.json')),spec=JSON.parse(raw),plan=JSON.parse(await readFile(path.join(root,'sealed-plan.json'))),handoff=JSON.parse(await readFile(path.join(root,'candidate-handoff.json')));
const candidate=handoff.immutableCandidateRoot,{verifyBatch}=await import(pathToFileURL(path.join(candidate,'tools/release-batch.mjs')));
verifyBatch(spec.batch,plan.batchSha256);assert.equal(sha(raw),plan.batchFileSha256);
assert.equal(spec.batch.impact.level,'strict');assert.equal(spec.batch.recovery.mode,'full');assert.equal(spec.batch.operations.length,21);
assert.equal(plan.productionApproval,false);assert.equal(plan.productionAdopted,false);assert.equal(plan.nativeSchedulerLatest,'unknown');
assert.ok(!spec.batch.operations.some(o=>o.kind==='django-deploy'||o.step==='DeployDjango'));
const allFiles=new Map(spec.collector.files.map(f=>[f.path,f.sha256]));
assert.equal(allFiles.size,spec.collector.files.length);
for(const operation of spec.batch.operations)for(const file of operation.command?.files??[]){const known=allFiles.get(file.path);if(known)assert.equal(known,file.sha256);}
const status=spec.batch.operations.find(o=>o.id==='complete-component-readiness');
assert.deepEqual(status.assertions.filter(a=>a.path.startsWith('components.')).map(a=>a.path.slice(11)).sort(),[...components].sort());
for(const a of status.assertions.filter(a=>a.path.startsWith('components.')))assert.equal(a.equals,true);
assert.equal(status.assertions.find(a=>a.path==='releaseId').equals,plan.candidate);
const start=spec.batch.operations.find(o=>o.step==='StartWorker');
for(const [arg,value] of [['-ExpectedWorkerManifestSha256',plan.manifest],['-ExpectedDjangoManifestSha256',handoff.djangoManifestSha256],['-MaintenanceId',plan.maintenanceId]])assert.equal(start.command.args[start.command.args.indexOf(arg)+1],value);
for(const label of ['pre','post']){
  assert.equal(spec.batch.operations.find(o=>o.id==='backup-'+label).kind,'backup');
  const restore=spec.batch.operations.find(o=>o.id==='restore-'+label);assert.equal(restore.kind,'restore');
  const preserve=spec.batch.operations.find(o=>o.id==='preserve-'+label+'-recovery');
  const args=preserve.command.args.slice(3);assert.equal(args[0],label);assert.equal(args[3],plan.rehearsal[label]);
  assert.ok(args[1].endsWith(':backupDirectory}'));assert.ok(args[2].endsWith(':manifestSha256}'));
}
const pinnedSupport=[];
for(const name of ['candidate-handoff.json','adapter.mjs','validators.mjs','read-watchdog-task.ps1','resource-inventory.json','production-ui.mjs','ui-audit.mjs','ui-icon-witness.json','ui-scope.json','candidate-tests.json','historical-audit-sha.json']){
  const filename=path.join(root,name),digest=sha(await readFile(filename));assert.equal(allFiles.get(filename),digest);pinnedSupport.push({name,sha256:digest});
}
const ui=spec.batch.operations.find(o=>o.id==='actual-readonly-ui'),uiSet=new Set(ui.command.files.map(f=>f.path));
for(const file of spec.collector.files.filter(f=>f.path.includes(path.join('node_modules','playwright-core'))||f.path.startsWith('C:\\Program Files\\Google\\Chrome\\Application\\')))assert.ok(uiSet.has(file.path));
const evidence={version:'task-d-independent-sealed-structure-v1',root,scope:plan.scope,batchSha256:plan.batchSha256,batchFileSha256:sha(raw),specBytes:(await stat(path.join(root,'approved-batch.json'))).size,
  sourceCommit:plan.sourceCommit,candidate:plan.candidate,manifest:plan.manifest,workerPlan:plan.plan,operations:spec.batch.operations.length,
  collectorFiles:spec.collector.files.length,uiFiles:ui.command.files.length,backupFiles:spec.batch.operations.find(o=>o.id==='backup-pre').command.files.length,
  exactComponents:components.length,pinnedSupport,strict:true,fullRecovery:true,productionApproved:false,productionAdopted:false,
  nativeSchedulerLatest:'unknown',recoveryFastPathEligible:false,operatorOrCollectorCallsPerformed:0,coverage:'Structure and listed private-file digests; not production acceptance and not future dynamic admission'};
if(output)await writeFile(path.resolve(output),JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});
console.log(canonical(evidence));
