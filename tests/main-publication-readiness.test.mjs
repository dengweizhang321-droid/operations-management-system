import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {mainPublicationMode,requireMainPreparation} from '../tools/publish-prepared-main.mjs';
import {writeMainPreparationPointer} from '../tools/publish-latest-main.mjs';

async function privateRoot(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'发布准备门限-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100}));
 return root;
}
test('default production mode only deploys and conflicting flags fail closed',()=>{
 assert.deepEqual(mainPublicationMode([]),{prepareOnly:false,deployOnly:true});
 assert.deepEqual(mainPublicationMode(['--prepare-only']),{prepareOnly:true,deployOnly:false});
 assert.deepEqual(mainPublicationMode(['--deploy-only']),{prepareOnly:false,deployOnly:true});
 assert.throws(()=>mainPublicationMode(['--prepare-only','--deploy-only']),/不能同时/);
});
test('missing and unfinished preparation never grant admission; unknown deployment takes precedence',async t=>{
 const root=await privateRoot(t),out=path.join(root,'attempt');
 await assert.rejects(requireMainPreparation(out),/尚未准备好/);
 await fs.mkdir(path.join(out,'preparation'),{recursive:true});
 await fs.writeFile(path.join(out,'preparation','PREPARING.json'),'{}');
 await assert.rejects(requireMainPreparation(out),/尚未准备好/);
 await fs.writeFile(path.join(out,'STARTED.json'),'{}');
 await assert.rejects(requireMainPreparation(out),/结果未知/);
 assert.deepEqual((await fs.readdir(out)).sort(),['STARTED.json','preparation'].sort());
});
test('pointer says frozen until a completed native preparation has been observed',async t=>{
 const root=await privateRoot(t),config={stateDirectory:root},prepared={status:'prepared',targetCommit:'a'.repeat(40)};
 await writeMainPreparationPointer(config,prepared,'request-frozen');
 const file=path.join(root,'LATEST-PREPARED.json');
 assert.equal(JSON.parse(await fs.readFile(file)).nativePreparationVerified,false);
 assert.equal(JSON.parse(await fs.readFile(file)).status,'request-frozen');
 await writeMainPreparationPointer(config,prepared,'prepared');
 assert.equal(JSON.parse(await fs.readFile(file)).nativePreparationVerified,true);
 await assert.rejects(writeMainPreparationPointer(config,prepared,'published'));
});
test('actual packaged Node CLI refuses missing preparation before loading native engines',async t=>{
 const root=await privateRoot(t),source=path.join(root,'候选包'),tools=path.join(source,'tools');
 await fs.mkdir(tools,{recursive:true});
 for(const name of ['publish-main.mjs','publish-main-progress.mjs','publish-main-known-resume.mjs',
  'publish-main-command.mjs','publish-prepared-main.mjs','main-schema-release.mjs','manual-maintenance-continuation.mjs']){
  const bytes=await fs.readFile(new URL('../tools/'+name,import.meta.url));
  await fs.writeFile(path.join(tools,name),bytes);
  assert.equal(createHash('sha256').update(await fs.readFile(path.join(tools,name))).digest('hex'),createHash('sha256').update(bytes).digest('hex'));
 }
 const git=args=>execFileSync('git',args,{cwd:source,encoding:'utf8',windowsHide:true}).trim();
 git(['init','--quiet']);git(['add','.']);git(['-c','user.name=fixture','-c','user.email=fixture@example.invalid','commit','--quiet','-m','private candidate']);
 const mainCommit=git(['rev-parse','HEAD']),host=path.join(root,'host'),cache=path.join(root,'cache');
 await fs.mkdir(host);await fs.writeFile(path.join(host,'pwsh.exe'),'unexecuted-host');
 await fs.mkdir(path.join(cache,'_cacache','content-v2'),{recursive:true});
 const request={version:'teruisi-frozen-latest-main-request-v1',latestMainRelease:true,mainCommit,deployedCommit:'b'.repeat(40),
  components:['worker'],migrate:false,releasePlan:{headSha:mainCommit,baseSha:'b'.repeat(40),components:['worker'],migrate:false},
  pwshDirectory:host,pwshSha256:createHash('sha256').update('unexecuted-host').digest('hex'),npmCacheDirectory:cache};
 await fs.writeFile(path.join(root,'main-release-request.json'),JSON.stringify(request));
 for(const flags of [[],['--deploy-only'],['--prepare-only','--deploy-only']]){
  const run=spawnSync(process.execPath,[path.join(tools,'publish-main.mjs'),...flags],{cwd:root,encoding:'utf8',windowsHide:true,timeout:30000});
  assert.equal(run.status,1,run.stdout+run.stderr);
  assert.match(run.stdout+run.stderr,flags.length===2?/不能同时/:/尚未准备好/);
  assert.doesNotMatch(run.stdout+run.stderr,/ERR_MODULE_NOT_FOUND/,'native modules are intentionally absent; admission must precede their import');
 }
 await assert.rejects(fs.access(path.join(root,'publish-'+mainCommit.slice(0,12))));
});
