// Read-only preparation check: future installed pins must match the sealed plan/prepared app.
import {readFile,writeFile} from 'node:fs/promises';import{createHash}from'node:crypto';import path from'node:path';import assert from'node:assert/strict';
const root='E:/codex-artifacts/release-site-blockers-20261011/',hash=b=>createHash('sha256').update(b).digest('hex');
const spec=JSON.parse(await readFile(root+'ADOPTION_BATCH_LIVE_V1.json')),b=spec.batch;
const planRaw=await readFile('D:/teruisi-runtime/teruisi-worker-sales/state/worker-release-rotation-plans/'+b.binding.workerPlanSha256+'.json');assert.equal(hash(planRaw),b.binding.workerPlanSha256);const plan=JSON.parse(planRaw);
const candidate='D:/teruisi-runtime/teruisi-worker-sales/releases/'+plan.candidate.releaseId;
const manifestRaw=await readFile(candidate+'/deployment-manifest.json');assert.equal(hash(manifestRaw),b.binding.artifactSha256);const m=JSON.parse(manifestRaw);
const before=b.tests.scopeValidation.before.inventory;
const workerApply=b.operations.findIndex(o=>o.kind==='worker-apply'),djangoDeploy=b.operations.findIndex(o=>o.kind==='django-deploy');const findings=[];let matched=0;
for(const [index,op]of b.operations.entries())for(const f of op.command?.files??[]){
 const observed=hash(await readFile(f.path));if(observed===f.sha256){matched++;continue;}
 const service=path.resolve('D:/运营管理系统/tools/worker-local-service.ps1');
 if(path.resolve(f.path)===service){assert.ok(index>workerApply);const entry=plan.protectedEntrypoints.find(p=>p.relativePath==='tools/worker-local-service.ps1');assert.equal(observed,entry.predecessorSha256);assert.equal(f.sha256,entry.candidateSha256);assert.equal(hash(await readFile(candidate+'/tools/worker-local-service.ps1')),f.sha256);findings.push({operation:op.id,path:f.path,current:observed,expectedAfterApprovedApply:f.sha256,provenance:'Original plan protectedEntrypoint CAS; unchanged phase-aware expected transition'});continue;}
 const relative=path.relative('D:/teruisi-runtime/django-sales/app',f.path).split(path.sep).join('/');
 assert.ok(index>djangoDeploy&&['tools/worker-local-release.mjs','tools/worker-local-release-rotation.mjs'].includes(relative),'Unexpected current drift');
 assert.equal(observed,before[relative]);assert.equal(hash(await readFile('D:/teruisi-runtime/django-sales/app.deploy-'+b.binding.djangoPreparedAppId+'/'+relative)),f.sha256);
 findings.push({operation:op.id,path:f.path,current:observed,expectedAfterApprovedDeploy:f.sha256,provenance:'Complete before inventory and exact prepared app; unchanged phase-aware expected transition'});
}
await writeFile(root+'PRIMARY_OPERATION_PIN_PHASE_REVIEW_V1.json',JSON.stringify({at:new Date().toISOString(),status:'phase-specific-pins-matched',matchedCurrentOccurrences:matched,futureOccurrences:findings.length,findings,productionActions:0,limits:'Preapproval static transition check only; actual future byte mismatch must still reject at its execution boundary. Earlier all-now checker was inapplicable to approved staged installation.'},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({matched,future:findings.length,status:'phase-specific-pins-matched'}));
