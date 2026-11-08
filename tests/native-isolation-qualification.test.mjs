import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {maintenanceReadiness,maintenanceSourceNames,nativeIsolationControllerQualification as q} from '../tools/manual-maintenance-continuation.mjs';

const repository=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const base='0c7d0feb33f45cfc6ae1f283b81d401c873c5768';
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const gitFile=name=>execFileSync('git',['show',base+':tools/'+name],{cwd:repository,windowsHide:true,maxBuffer:2*1024*1024});
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'native-isolation-qualification-'));
 t.after(async()=>{assert.equal(await fs.realpath(root),root);assert.ok(path.basename(root).startsWith('native-isolation-qualification-'));await fs.rm(root,{recursive:true,force:true});});
 const source=path.join(root,'source'),installed=path.join(root,'django','app'),runtime=path.join(root,'worker'),releaseId='native-main-0c7d';
 const write=async(file,bytes)=>{await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,bytes);};
 for(const name of new Set([...maintenanceSourceNames,'django-ai.ps1',...Object.keys(q.controllers),...Object.keys(q.helpers)]))
  await write(path.join(source,'tools',name),await fs.readFile(path.join(repository,'tools',name)));
 for(const name of ['django-ai.ps1','django-local-service.ps1'])await write(path.join(installed,'tools',name),gitFile(name));
 for(const name of ['worker-local-service.ps1','process-deadline.ps1'])await write(path.join(runtime,'releases',releaseId,'tools',name),gitFile(name));
 const manifest=Buffer.from('{"fixture":"private-preflight-only"}\n');
 await write(path.join(installed,'deployment.json'),manifest);
 await write(path.join(runtime,'releases',releaseId,'deployment-manifest.json'),manifest);
 const args={source,installed,runtime,head:{releaseId,manifestSha256:sha(manifest)},djangoManifestSha256:sha(manifest)};
 return {root,args,write};
}

test('native isolation maintenance admits only the exact directional tuple and helper closure',async t=>{
 const f=await fixture(t);const value=await maintenanceReadiness(f.args);
 assert.equal(value.controllerQualification,q.version);assert.equal(value.route,'native-exit-observer');
 assert.equal(value.pins.length,20);
 for(const [name,digest] of Object.entries(q.helpers))assert.equal(value.pins.find(p=>p.root==='source'&&p.relative===name)?.sha256,digest);
 for(const name of ['worker-local-service.ps1','django-local-service.ps1',...Object.keys(q.helpers)]){
  const file=path.join(f.args.source,'tools',name),raw=await fs.readFile(file);
  await fs.appendFile(file,'\n');await assert.rejects(maintenanceReadiness(f.args));await fs.writeFile(file,raw);
 }
 const worker=path.join(f.args.runtime,'releases',f.args.head.releaseId,'tools/worker-local-service.ps1');
 const oldWorker=await fs.readFile(worker);await fs.copyFile(path.join(f.args.source,'tools/worker-local-service.ps1'),worker);
 await assert.rejects(maintenanceReadiness(f.args));await fs.writeFile(worker,oldWorker);
 const installedAi=path.join(f.args.installed,'tools/django-ai.ps1');
 const sourceAi=path.join(f.args.source,'tools/django-ai.ps1');const oldAi=await fs.readFile(installedAi),newAi=await fs.readFile(sourceAi);
 await fs.writeFile(installedAi,newAi);await fs.writeFile(sourceAi,oldAi);await assert.rejects(maintenanceReadiness(f.args));
 await fs.writeFile(installedAi,oldAi);await fs.writeFile(sourceAi,newAi);
 await fs.appendFile(installedAi,'\n');await assert.rejects(maintenanceReadiness(f.args));
});

test('actual PS5 and PS7 pin gate rejects omitted, duplicate, extra and rehashed drifted helper pins',async t=>{
 if(process.platform!=='win32'){t.skip('native PowerShell qualification is Windows-only');return;}
 const f=await fixture(t);const valid=await maintenanceReadiness(f.args);
 const file=path.join(f.root,'readiness.json');
 const environment={...process.env};delete environment.PSModulePath;
 const shells=[process.env.TERUISI_NATIVE_PS5??'powershell.exe',process.env.TERUISI_NATIVE_PS7??'pwsh.exe'];
 const run=(shell)=>execFileSync(shell,['-NoProfile','-NonInteractive','-File',path.join(repository,'tests/native-maintenance-pins.ps1'),
  '-ReadinessPath',file,'-DjangoRoot',path.dirname(f.args.installed),'-WorkerRoot',f.args.runtime,'-SourceTools',path.join(f.args.source,'tools')],
  {cwd:repository,env:environment,windowsHide:true,timeout:30000,stdio:'pipe'});
 for(const shell of shells){
  await fs.writeFile(file,JSON.stringify(valid));assert.match(run(shell).toString(),/verified_private_maintenance_pins/);
  const variants=[
   {...valid,pins:valid.pins.filter(p=>p.relative!=='native-isolation.ps1')},
   {...valid,pins:[...valid.pins,valid.pins.find(p=>p.relative==='native-isolation.ps1')]},
   {...valid,pins:[...valid.pins,{root:'source',relative:'extra.ps1',sha256:'a'.repeat(64)}]},
   {...valid,controllerQualification:'unregistered'},
  ];
  for(const invalid of variants){await fs.writeFile(file,JSON.stringify(invalid));assert.throws(()=>run(shell));}
  const target=path.join(f.args.source,'tools/native-isolation.ps1'),raw=await fs.readFile(target);
  const changed=Buffer.concat([raw,Buffer.from('\n')]);await fs.writeFile(target,changed);
  const updated={...valid,pins:valid.pins.map(p=>p.root==='source'&&p.relative==='native-isolation.ps1'?{...p,sha256:sha(changed)}:p)};
  await fs.writeFile(file,JSON.stringify(updated));assert.throws(()=>run(shell));await fs.writeFile(target,raw);
 }
});

test('the previous reviewed Pandas pair remains on its original pin contract',async t=>{
 const f=await fixture(t);
 for(const name of ['django-ai.ps1','django-local-service.ps1','worker-local-service.ps1']){
  const bytes=execFileSync('git',['show','557b497dc0fe42f3693a0c6c76320a4833b46b49:tools/'+name],{cwd:repository,windowsHide:true,maxBuffer:2*1024*1024});
  await fs.writeFile(path.join(f.args.source,'tools',name),bytes);
 }
 const result=await maintenanceReadiness(f.args);
 assert.equal(result.route,'native-exit-observer');assert.equal(result.controllerQualification,undefined);
 assert.equal(result.pins.length,18);
});
