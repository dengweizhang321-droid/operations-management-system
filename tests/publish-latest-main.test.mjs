import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {prepareLatestMain,inspectMainPreparation,deployReadyMain} from '../tools/publish-latest-main.mjs';
import {monitoringSchema} from '../tools/main-schema-release.mjs';

async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'latest-main-entry-'));
 assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const repository=path.join(root,'repo'),remote=path.join(root,'remote.git');await fs.mkdir(repository);
 const git=(cwd,args)=>execFileSync('git',['-C',cwd,...args],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();
 execFileSync('git',['init','--bare','--quiet',remote]);git(repository,['init','--quiet','--initial-branch=main']);
 git(repository,['config','user.name','fixture']);git(repository,['config','user.email','fixture@example.invalid']);
 await fs.mkdir(path.join(repository,'app'));await fs.writeFile(path.join(repository,'app/view.tsx'),'old');
 const lock=Buffer.from('{}\n');await fs.writeFile(path.join(repository,'package-lock.json'),lock);await fs.writeFile(path.join(repository,'.gitignore'),'node_modules/\n');
 git(repository,['add','.']);git(repository,['commit','--quiet','-m','old online']);const old=git(repository,['rev-parse','HEAD']);
 git(repository,['remote','add','origin',remote]);git(repository,['push','--quiet','origin','main']);
 await fs.writeFile(path.join(repository,'app/view.tsx'),'new merged task');git(repository,['add','.']);git(repository,['commit','--quiet','-m','new merged task']);
 const latest=git(repository,['rev-parse','HEAD']);git(repository,['push','--quiet','origin','main']);
 const stateDirectory=path.join(root,'state'),dependenciesDirectory=path.join(root,'dependencies');await fs.mkdir(stateDirectory);await fs.mkdir(dependenciesDirectory);
 // Exactly the stale state that previously hid a newer main.
 await fs.writeFile(path.join(stateDirectory,'main-release-request.json'),JSON.stringify({mainCommit:old,completedTask:{path:'OLD-SUCCESS.json',sha256:'0'.repeat(64)}}));
 const live={mainCommit:old,source:repository,head:{releaseId:'old',bindingSha256:'1'.repeat(64),manifestSha256:'2'.repeat(64)},djangoManifestSha256:'3'.repeat(64)};
 const config={repository,stateDirectory,releaseDirectory:path.join(root,'packets'),dependenciesDirectory,cacheLockSha256:createHash('sha256').update(lock).digest('hex'),pwshDirectory:'fixture-host',pwshSha256:'4'.repeat(64),npmCacheDirectory:'fixture-cache'};
 const logs=[],options={getLive:async()=>live,log:line=>logs.push(line)};
 return {root,repository,git,old,latest,live,config,logs,options};
}
test('fetches and freezes NEW main despite an old completed-task record, preserving dirty user files',async t=>{
 const f=await fixture(t);await fs.writeFile(path.join(f.repository,'user-notes.txt'),'preserve me');
 const result=await prepareLatestMain(f.config,f.options);
 assert.equal(result.status,'prepared');assert.equal(result.targetCommit,f.latest);assert.notEqual(result.targetCommit,f.old);assert.equal(result.publicationPerformed,false);
 assert.equal(await fs.readFile(path.join(result.source,'app/view.tsx'),'utf8'),'new merged task');
 assert.equal(await fs.readFile(path.join(f.repository,'user-notes.txt'),'utf8'),'preserve me');
 assert.equal(result.request.completedTask,undefined);assert.equal(result.request.resumeReviewSha256,undefined);assert.equal(result.request.schemaEvidencePath,undefined);
 assert.equal(result.request.mainCommit,f.latest);assert.deepEqual(result.request.components,['worker']);assert.equal(result.request.migrate,false);
 assert.doesNotMatch(f.logs.join('\n'),/发布成功/);
});
test('fetch failure cannot fall back to an old completed task or old main',async t=>{
 const f=await fixture(t);let readLive=false;
 await assert.rejects(prepareLatestMain(f.config,{...f.options,git:async()=>{throw Error('fetch unavailable');},getLive:async()=>{readLive=true;return f.live;}}),/fetch unavailable/);
 assert.equal(readLive,false);assert.doesNotMatch(f.logs.join('\n'),/发布成功/);
});
test('only the exact fetched main can be reported as already-current',async t=>{
 const f=await fixture(t);f.live.mainCommit=f.latest;
 const result=await prepareLatestMain(f.config,f.options);assert.equal(result.status,'already-current');assert.equal(result.targetCommit,f.latest);assert.equal(result.publicationPerformed,false);
 await assert.rejects(fs.access(f.config.releaseDirectory),{code:'ENOENT'});assert.doesNotMatch(f.logs.join('\n'),/发布成功/);
});
test('an unknown attempt for the same frozen target is preserved and blocks retry',async t=>{
 const f=await fixture(t);const prepared=await prepareLatestMain(f.config,f.options);
 const attempt=path.join(prepared.packet,'publish-'+f.latest.slice(0,12));await fs.mkdir(attempt);await fs.writeFile(path.join(attempt,'STARTED.json'),'original unknown');
 await assert.rejects(prepareLatestMain(f.config,f.options),/未知结果/);assert.equal(await fs.readFile(path.join(attempt,'STARTED.json'),'utf8'),'original unknown');
});
test('a historical SUCCESS for a target that is not online cannot become a new success',async t=>{
 const f=await fixture(t);const prepared=await prepareLatestMain(f.config,f.options);const attempt=path.join(prepared.packet,'publish-'+f.latest.slice(0,12));await fs.mkdir(attempt);
 await fs.writeFile(path.join(attempt,'SUCCESS.json'),JSON.stringify({mainCommit:f.latest}));
 await assert.rejects(prepareLatestMain(f.config,f.options),/历史成功记录/);
});
test('new migrations never reuse the old schema147 evidence',async t=>{
 const f=await fixture(t);const directory=path.join(f.repository,'backend/inventory/migrations');await fs.mkdir(directory,{recursive:true});await fs.writeFile(path.join(directory,'0016_new.py'),'# fixture migration');
 f.git(f.repository,['add','.']);f.git(f.repository,['commit','--quiet','-m','new migration']);f.git(f.repository,['push','--quiet','origin','main']);
 await assert.rejects(prepareLatestMain(f.config,f.options),/结构发布包|迁移缺少/);assert.doesNotMatch(f.logs.join('\n'),/发布成功/);
});
test('a half-switched target with STARTED and no SUCCESS cannot short-circuit as already-current',async t=>{
 const f=await fixture(t);const prepared=await prepareLatestMain(f.config,f.options);const attempt=path.join(prepared.packet,'publish-'+f.latest.slice(0,12));await fs.mkdir(attempt);
 await fs.writeFile(path.join(attempt,'STARTED.json'),'half switched');f.live.mainCommit=f.latest;f.live.source=prepared.source;
 await assert.rejects(prepareLatestMain(f.config,f.options),/半切换/);assert.doesNotMatch(f.logs.join('\n'),/发布成功/);
});
test('a reviewed0016 addition is bound automatically to the fetched source without old147 fields',async t=>{
 const f=await fixture(t),directory=path.join(f.repository,'backend/inventory/migrations');await fs.mkdir(directory,{recursive:true});await fs.writeFile(path.join(directory,'0016_jd_product_monitoring.py'),'# synthetic policy seam');
 f.git(f.repository,['add','.']);f.git(f.repository,['commit','--quiet','-m','reviewed0016']);f.git(f.repository,['push','--quiet','origin','main']);
 let called=0;
 const result=await prepareLatestMain(f.config,{...f.options,prepareSchema:async({source,packet,plan})=>{
  called++;assert.equal(f.git(source,['rev-parse','HEAD']),plan.headSha);assert.equal(plan.migrate,true);
  return {...monitoringSchema,recipeSha256:'a'.repeat(64),evidencePath:path.join(packet,'schema','inventory-0016-evidence.json'),evidenceSha256:'b'.repeat(64),validationSha256:'c'.repeat(64),codeSha256:'d'.repeat(64)};
 }});
 assert.equal(called,1);assert.equal(result.request.migrate,true);assert.equal(result.request.schemaRelease.toGeneration,148);
 assert.equal(result.request.schemaEvidencePath,undefined);assert.equal(result.request.completedTask,undefined);assert.equal(result.request.schemaRelease.evidencePath,path.join(result.packet,'schema','inventory-0016-evidence.json'));
});

async function readinessFixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'main-readiness-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const targetCommit='a'.repeat(40),tree='b'.repeat(40),request={mainCommit:targetCommit,components:['worker','django'],migrate:false};
 const prepared={packet:root,source:path.join(root,'source'),targetCommit,request};
 const attempt=path.join(root,'publish-'+targetCommit.slice(0,12)),preparation=path.join(attempt,'preparation');await fs.mkdir(preparation,{recursive:true});
 const receipt={version:'teruisi-main-preparation-v1',requestSha256:createHash('sha256').update(JSON.stringify(request)).digest('hex'),sourceIdentity:{commit:targetCommit,tree}};
 const file=path.join(preparation,'PREPARED.json'),logs=[];
 const git=async(source,args)=>{assert.equal(source,prepared.source);assert.deepEqual(args,['rev-parse','HEAD^{tree}']);return tree;};
 const progress={log:line=>logs.push(line),begin:line=>logs.push(line),complete:()=>logs.push('complete')};
 return {prepared,attempt,preparation,file,receipt,git,progress,logs};
}
for(const state of ['not-started','preparing','failed'])test('manual entry never starts a publisher for an unready package: '+state,async t=>{
 const f=await readinessFixture(t);
 if(state!=='not-started')await fs.writeFile(path.join(f.preparation,'PREPARING.json'),'original preparing');
 if(state==='failed')await fs.writeFile(path.join(f.preparation,'FAILED-original.json'),'original failed');
 const before=await fs.readdir(f.preparation);let calls=0;
 const result=await deployReadyMain(f.prepared,{git:f.git,progress:f.progress,run:async()=>{calls++;throw Error('must not acquire rotation lock');}});
 assert.equal(result.status,'not-ready');assert.equal(result.publicationPerformed,false);assert.equal(calls,0);
 assert.deepEqual(await fs.readdir(f.preparation),before);await assert.rejects(fs.access(path.join(f.attempt,'STARTED.json')),{code:'ENOENT'});
 assert.match(f.logs.join('\n'),/尚未就绪，本次未发布/);assert.doesNotMatch(f.logs.join('\n'),/发布成功|发布失败|开始原生复验|发布已准备好/);
});
test('exact prepared receipt delegates once to deploy-only; native result stays authoritative',async t=>{
 const f=await readinessFixture(t);await fs.writeFile(f.file,JSON.stringify(f.receipt));let calls=0;
 const original={status:'already-current',mainCommit:f.prepared.targetCommit,publicationPerformed:false};
 const result=await deployReadyMain(f.prepared,{git:f.git,progress:f.progress,gitDirectory:'fixture-git',run:async(source,args,directory)=>{
  calls++;assert.equal(source,f.prepared.source);assert.deepEqual(args,['--deploy-only']);assert.equal(directory,'fixture-git');return original;
 }});
 assert.equal(result,original);assert.equal(calls,1);assert.doesNotMatch(f.logs.join('\n'),/发布成功/);
});
for(const change of ['wrong-request','wrong-commit','wrong-tree','malformed'])test('invalid prepared receipt cannot start a publisher: '+change,async t=>{
 const f=await readinessFixture(t);
 if(change==='wrong-request')f.receipt.requestSha256='0'.repeat(64);
 if(change==='wrong-commit')f.receipt.sourceIdentity.commit='c'.repeat(40);
 if(change==='wrong-tree')f.receipt.sourceIdentity.tree='d'.repeat(40);
 await fs.writeFile(f.file,change==='malformed'?'not json':JSON.stringify(f.receipt));let calls=0;
 await assert.rejects(deployReadyMain(f.prepared,{git:f.git,progress:f.progress,run:async()=>{calls++;}}));assert.equal(calls,0);
});
test('unknown deployment takes precedence over missing preparation and preserves original records',async t=>{
 const f=await readinessFixture(t),file=path.join(f.attempt,'STARTED.json');await fs.writeFile(file,'unknown original');
 await assert.rejects(inspectMainPreparation(f.prepared,{git:f.git}),/未知结果/);assert.equal(await fs.readFile(file,'utf8'),'unknown original');
});
test('a success appearing after target selection must be rechecked against live state',async t=>{
 const f=await readinessFixture(t);await fs.writeFile(path.join(f.attempt,'SUCCESS.json'),'original success');
 await assert.rejects(inspectMainPreparation(f.prepared,{git:f.git}),/重新从固定入口/);assert.doesNotMatch(f.logs.join('\n'),/发布成功/);
});
test('native lock rejection is never swallowed or retried after readiness passes',async t=>{
 const f=await readinessFixture(t);await fs.writeFile(f.file,JSON.stringify(f.receipt));let calls=0;
 await assert.rejects(deployReadyMain(f.prepared,{git:f.git,progress:f.progress,run:async()=>{calls++;throw Error('Worker rotation 唯一锁不可用：EADDRINUSE');}}),/EADDRINUSE/);
 assert.equal(calls,1);await assert.rejects(fs.access(path.join(f.attempt,'STARTED.json')),{code:'ENOENT'});
});
