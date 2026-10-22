import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {readWorkerSourceBinding,windowsPathSha256,canonicalJson,verifyPreparedWorkerCandidate} from '../tools/worker-local-release.mjs';
import {releaseBinding} from '../tools/worker-local-release-rotation.mjs';

const repo=path.resolve(import.meta.dirname,'..'),sha=raw=>createHash('sha256').update(raw).digest('hex');
const oldScript=await fs.readFile(path.join(repo,'tools/django-local-service.ps1'));
assert.equal(sha(oldScript),'65f057297208b32ac6d3c2e71a12016b1fd4afdc0ed7ea455fbda13181fffb61','Old native fixture must remain bound to the reviewed original producer');
const wrapper=path.join(repo,'docs/s05d-retirement-implementation-20261023/old-django-private-fixture.ps1');
const hosts=[['PS5','C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'],['PS7','D:/codex-isolated/main-manual-release-20261016/control-host/pwsh.exe']];
async function fixture(t){
 const root=path.join(os.tmpdir(),'s05d-native-'+randomUUID().replaceAll('-',''));await fs.mkdir(root);t.after(()=>fs.rm(root,{recursive:true,force:true}));
 assert.equal(path.dirname(path.resolve(root)).toLowerCase(),path.resolve(os.tmpdir()).toLowerCase());
 const runtime=path.join(root,'runtime'),source366=path.join(root,'packet366','source'),source405=path.join(root,'immutable405','source-snapshot'),archive=path.join(root,'archive');
 for(const source of [source366,source405,path.join(runtime,'app')]){await fs.mkdir(path.join(source,'tools'),{recursive:true});await fs.writeFile(path.join(source,'tools/django-local-service.ps1'),oldScript);await fs.mkdir(path.join(source,'backend'),{recursive:true});await fs.mkdir(path.join(source,'config'),{recursive:true});for(const name of ['dingtalk-replenishment.json','inventory-warehouse-mapping.json'])await fs.writeFile(path.join(source,'config',name),'{}');}
 await fs.mkdir(archive);const predecessor='1'.repeat(64);
 async function candidate(source,id){const stage=path.join(runtime,'app.deploy-'+id);await fs.mkdir(stage);const manifestRaw=Buffer.from(JSON.stringify({version:2,sourceRoot:source,fingerprintAlgorithm:'private-fixture',fileCount:1,appFingerprint:'2'.repeat(64)})+'\n');await fs.writeFile(path.join(stage,'deployment.json'),manifestRaw);const receipt=path.join(runtime,'app.prepare-'+id+'.json'),raw=Buffer.from(JSON.stringify({version:'teruisi-django-prepared-app-v1',id,runtimeRoot:path.resolve(runtime),predecessorManifestSha256:predecessor,candidateManifestSha256:sha(manifestRaw)})+'\n');await fs.writeFile(receipt,raw);return {id,receiptSha256:sha(raw),stage,receipt};}
 const old=await candidate(source366,'a'.repeat(32)),own=await candidate(source405,'b'.repeat(32));
 function invoke(host,script,args){assert.ok(path.resolve(script).toLowerCase().startsWith(path.resolve(root).toLowerCase()+path.sep)||script===wrapper);const result=spawnSync(host,['-NoProfile','-NonInteractive','-File',script,...args],{encoding:'utf8',windowsHide:true,timeout:30000,env:{...process.env,TERUISI_DJANGO_SERVICE_LIBRARY_ONLY:'0'}});if(result.error)throw result.error;return {status:result.status,stdout:result.stdout,stderr:result.stderr};}
 async function body(host,mode,source=source405,pkg=old){const input=path.join(root,randomUUID()+'.json');await fs.writeFile(input,JSON.stringify({root,runtime,script:path.join(source,'tools/django-local-service.ps1'),mode,predecessor,expectedOwnSource:source405,...pkg}));const result=invoke(host,wrapper,['-InputPath',input]);assert.equal(result.status,0,result.stderr||result.stdout);return JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));}
 async function retire(){await fs.rename(source366,path.join(archive,'source366'));await fs.rename(old.stage,path.join(archive,'app.deploy-'+old.id));await fs.rename(old.receipt,path.join(archive,'app.prepare-'+old.id+'.json'));}
 return {root,runtime,source366,source405,archive,old,own,invoke,body,retire};
}
for(const[label,host]of hosts){
 test(label+' unchanged installed-app CLI rejects PrepareApp and DeployApp before a source write',async t=>{
  const f=await fixture(t);for(const action of ['PrepareApp','DeployApp']){const result=f.invoke(host,path.join(f.runtime,'app','tools/django-local-service.ps1'),['-Action',action,'-RuntimeRoot',f.runtime]);assert.equal(result.status,1);assert.match(result.stderr+result.stdout,/must run from a source|runtime app/);assert.equal((await fs.readdir(f.runtime)).filter(name=>name.startsWith('app.deploy-')).length,2);}
 });
 test(label+' old source PrepareApp is reachable at its original address before retirement',async t=>{const f=await fixture(t);assert.equal((await f.body(host,'prepare-boundary',f.source366)).oldPrepareReachedCopy,true);});
 test(label+' unrelated immutable helper can consume an old-target candidate while its native id remains addressable',async t=>{
  const f=await fixture(t),result=await f.body(host,'deploy-present');assert.equal(result.oldPreparedAddressConsumed,true);assert.equal(result.deployedSourceRoot,f.source366);
 });
 test(label+' retiring only old-target source and native candidate addresses blocks old calls and preserves unrelated helper verify',async t=>{
  const f=await fixture(t);await f.retire();const sourceResult=f.invoke(host,path.join(f.source366,'tools/django-local-service.ps1'),['-Action','PrepareApp','-RuntimeRoot',f.runtime]);assert.notEqual(sourceResult.status,0);
  assert.equal((await f.body(host,'deploy-retired')).oldPreparedAddressRejected,true);assert.equal((await f.body(host,'verify-own',f.source405,f.own)).unrelatedHelperReadVerifyPreserved,true);assert.equal(await fs.stat(path.join(f.archive,'source366','tools/django-local-service.ps1')).then(s=>s.size),oldScript.length);
 });
 test(label+' an omitted old-target source alias remains a reachable PrepareApp entry',async t=>{
  const f=await fixture(t),alias=path.join(f.root,'forgotten366alias');await fs.cp(f.source366,alias,{recursive:true});await f.retire();assert.equal((await f.body(host,'prepare-boundary',alias)).oldPrepareReachedCopy,true);
 });
 test(label+' no-id Deploy calls Prepare for the preserved helper source, not the retired source',async t=>{const f=await fixture(t);await f.retire();const result=await f.body(host,'deploy-no-id',f.source405,f.own);assert.equal(result.noIdPrepareSource,f.source405);assert.equal(result.deployedSourceRoot,f.source405);});
}
test('old Worker bound-source reader rejects an absent original source without fixed-source fallback',async t=>{
 const f=await fixture(t),sourceRoot=path.win32.normalize(f.source366),hash='1'.repeat(64),prior=releaseBinding({releaseId:'20261022T034924Z-1667fc5e107422e1',manifestSha256:hash,guardReceiptSha256:hash});
 const toolchain=Object.fromEntries(['nodeVersion','nodeExecutablePathSha256','npmVersion','npmPackageRootRelativePath','npmPackageRootPathSha256','npmCliRelativePath','npmCliPathSha256','npmCliSha256','npmPackageJsonRelativePath','npmPackageJsonPathSha256','npmPackageJsonSha256','npmPackageTree','npmCiArguments'].map(k=>[k,k==='npmCiArguments'?[]:hash]));
 const identity={version:'teruisi-worker-preparation-identity-v1',sourceTree:{algorithm:'sha256-ordinal-path-length-content-v1',fileCount:1,sha256:hash},sourceInventorySha256:hash,nodeExecutableSha256:hash,runtimeConfigurationSha256:hash,environmentSha256:hash,externalNpmConfiguration:{userconfig:{pathSha256:hash,contentSha256:null},globalconfig:{pathSha256:hash,contentSha256:null}},toolchain};
 const raw=Buffer.from(canonicalJson({version:'teruisi-worker-source-binding-v1',sourceRoot,sourceRootPathSha256:windowsPathSha256(sourceRoot),predecessor:prior,predecessorChainStateSha256:hash,identity})+'\n'),bindingFile=path.join(f.root,'original-binding.json');await fs.writeFile(bindingFile,raw);await f.retire();await assert.rejects(readWorkerSourceBinding(bindingFile,sha(raw)),error=>error.code==='ENOENT');
});
test('old Worker candidate verification rejects the archived original manifest path without adopting another release',async t=>{
 const f=await fixture(t),id='20261022T071208Z-f5db87473edebc45',candidate=path.join(f.root,'worker','releases',id),manifestPath=path.join(candidate,'deployment-manifest.json');await fs.mkdir(candidate,{recursive:true});await fs.writeFile(manifestPath,'private original');await fs.rename(candidate,path.join(f.archive,id));let predecessorCalled=false;
 await assert.rejects(verifyPreparedWorkerCandidate({manifestPath,approvedManifestSha256:'1'.repeat(64),allowTestRuntimeRoot:true},async()=>{predecessorCalled=true;}),error=>error.code==='ENOENT');assert.equal(predecessorCalled,false);
});
