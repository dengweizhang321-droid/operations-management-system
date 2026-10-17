import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {prepareLatestMain} from '../tools/publish-latest-main.mjs';

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
 await assert.rejects(prepareLatestMain(f.config,f.options),/新增迁移/);assert.doesNotMatch(f.logs.join('\n'),/发布成功/);
});
test('a half-switched target with STARTED and no SUCCESS cannot short-circuit as already-current',async t=>{
 const f=await fixture(t);const prepared=await prepareLatestMain(f.config,f.options);const attempt=path.join(prepared.packet,'publish-'+f.latest.slice(0,12));await fs.mkdir(attempt);
 await fs.writeFile(path.join(attempt,'STARTED.json'),'half switched');f.live.mainCommit=f.latest;f.live.source=prepared.source;
 await assert.rejects(prepareLatestMain(f.config,f.options),/半切换/);assert.doesNotMatch(f.logs.join('\n'),/发布成功/);
});
