import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {maintenanceReadiness,nativePiBusinessPredecessor as k} from '../tools/manual-maintenance-continuation.mjs';

const hash=b=>createHash('sha256').update(b).digest('hex');
const other='f'.repeat(64);
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'pi-business-readiness-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const source=path.join(root,'source'),installed=path.join(root,'django/app'),runtime=path.join(root,'worker');
 await fs.mkdir(path.join(source,'tools'),{recursive:true});await fs.mkdir(path.join(installed,'tools'),{recursive:true});
 await fs.copyFile('tools/django-ai.ps1',path.join(source,'tools/django-ai.ps1'));
 // Historical source bytes only; no production state, service, or database.
 const before=execFileSync('git',['show','e9696b0d28187a4083fd0eba017187dd0a5dba26:tools/django-ai.ps1']);
 assert.equal(hash(before),k.djangoAiScriptSha256);
 await fs.writeFile(path.join(installed,'tools/django-ai.ps1'),before);
 const values={
  'deployment.json':k.djangoManifestSha256,'deployment-manifest.json':k.workerManifestSha256,
  'worker-local-service.ps1':k.workerScriptSha256,'process-deadline.ps1':k.workerTransportSha256,
 };
 const digest=async file=>path.basename(file)==='django-ai.ps1'?hash(await fs.readFile(file)):
  path.basename(file)==='django-local-service.ps1'?(file.startsWith(source)?k.candidateDjangoScriptSha256:k.djangoScriptSha256):values[path.basename(file)]??other;
 const options={source,installed,runtime,head:{releaseId:k.releaseId,manifestSha256:k.workerManifestSha256},djangoManifestSha256:k.djangoManifestSha256,sha:digest};
 return {options,digest,source,installed};
}
test('exact current predecessor qualifies unchanged native stop and pins both controllers',async t=>{
 const {options}=await fixture(t),result=await maintenanceReadiness(options);
 assert.equal(result.route,'native-exit-observer');
 assert.equal(result.pins.find(p=>p.root==='django'&&p.relative==='app/tools/django-ai.ps1').sha256,k.djangoAiScriptSha256);
 assert.equal(result.pins.find(p=>p.root==='source'&&p.relative==='django-ai.ps1').sha256,k.candidateAiScriptSha256);
});
for(const root of ['installed','source'])for(const name of ['django-ai.ps1','django-local-service.ps1','worker-local-service.ps1','process-deadline.ps1'])test(root+' '+name+' drift is rejected',async t=>{
 const {options,digest,source}=await fixture(t);
 options.sha=async file=>path.basename(file)===name&&(file.startsWith(source)===(root==='source'))?other:digest(file);
 await assert.rejects(maintenanceReadiness(options));
});
for(const field of ['releaseId','manifestSha256'])test('unknown predecessor '+field+' is rejected',async t=>{
 const {options}=await fixture(t);options.head[field]=field==='releaseId'?'unknown':other;
 await assert.rejects(maintenanceReadiness(options));
});
test('installed bytes changing after qualification cannot reuse the original hash',async t=>{
 const {options,digest,installed}=await fixture(t);let count=0;
 options.sha=async file=>{const result=await digest(file);if(file===path.join(installed,'tools/django-ai.ps1')&&++count===1)await fs.appendFile(file,'\n# drift');return result;};
 await assert.rejects(maintenanceReadiness(options),/资格核验后/);
});
test('Pi receipt drift and malformed identity remain failures',async t=>{
 const {options,digest,installed}=await fixture(t),run=path.join(path.dirname(installed),'run');await fs.mkdir(run);
 const file=path.join(run,'django-ai-pi-worker.pid.json');await fs.writeFile(file,JSON.stringify({version:2,service:'wrong'}));
 options.sha=async file=>file.endsWith('pid.json')?other:digest(file);
 await assert.rejects(maintenanceReadiness(options),/ownership changed/);
 options.sha=digest; // digest returns other for the receipt, so bind its actual bytes.
 options.sha=async p=>p===file?hash(await fs.readFile(p)):digest(p);
 await assert.rejects(maintenanceReadiness(options));
});
