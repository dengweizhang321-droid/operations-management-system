import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {adoptLivePublication,observeLiveIdentity,gitSucceedsAt,liveAdoptionKind,liveAdoptionReceiptVersion,readLivePublication,runLatestMainCli} from '../tools/publish-latest-main.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=(cwd,args)=>execFileSync('git',['-C',cwd,...args],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();

/**
 * Reproduces the real 2026-10-30 shape: Worker head bound to a frozen package at
 * commit W, Django deployed from a delivery tree at commit D (a descendant of W),
 * and a catalog still naming an older Django digest. Everything the entry touches
 * is inside the temp root; nothing reads or writes D:\teruisi-runtime.
 */
async function fixture(t,{split=true}={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'adopt-live-'));
 assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));
 t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100}));

 // One repository with a remote, so merge-base --is-ancestor against
 // refs/remotes/origin/main is answered by real Git rather than a stub.
 const repository=path.join(root,'repo'),remote=path.join(root,'remote.git');
 await fs.mkdir(repository);
 execFileSync('git',['init','--bare','--quiet',remote]);
 git(repository,['init','--quiet','--initial-branch=main']);
 git(repository,['config','user.name','fixture']);
 git(repository,['config','user.email','fixture@example.invalid']);
 git(repository,['config','commit.gpgsign','false']);
 await fs.mkdir(path.join(repository,'app'),{recursive:true});
 await fs.mkdir(path.join(repository,'tools'),{recursive:true});
 await fs.writeFile(path.join(repository,'app/view.tsx'),'frontend\n');
 await fs.writeFile(path.join(repository,'tools/watchdog.ps1'),'old watchdog\n');
 await fs.writeFile(path.join(repository,'.gitignore'),'node_modules/\n');
 git(repository,['add','-A']);git(repository,['commit','--quiet','-m','worker base']);
 const workerCommit=git(repository,['rev-parse','HEAD']);
 git(repository,['remote','add','origin',remote]);git(repository,['push','--quiet','origin','main']);
 // The 6-commit gap in production carried tools/ changes but no app/ payload.
 await fs.writeFile(path.join(repository,'tools/watchdog.ps1'),'new watchdog\n');
 git(repository,['add','-A']);git(repository,['commit','--quiet','-m','backend+tools only']);
 const djangoCommit=split?git(repository,['rev-parse','HEAD']):workerCommit;
 git(repository,['push','--quiet','origin','main']);

 // Two separate checkouts, as in production: a frozen worker package and a delivery tree.
 const workerSource=path.join(root,'packages','pkg','source'),djangoSource=path.join(root,'delivery','source');
 await fs.mkdir(path.dirname(workerSource),{recursive:true});
 await fs.mkdir(path.dirname(djangoSource),{recursive:true});
 git(repository,['worktree','add','--quiet','--detach',workerSource,workerCommit]);
 git(repository,['worktree','add','--quiet','--detach',djangoSource,djangoCommit]);
 t.after(()=>{try{git(repository,['worktree','remove','--force',workerSource]);}catch{}
  try{git(repository,['worktree','remove','--force',djangoSource]);}catch{}});

 const workerRuntimeRoot=path.join(root,'worker-runtime'),releaseId='20261030T013752Z-91459570a711f22e';
 const workerTree={algorithm:'sha256-ordinal-path-length-content-v1',fileCount:3,sha256:'a'.repeat(64)};
 const manifest={source:{tree:workerTree,sourceBinding:{raw:JSON.stringify({sourceRoot:workerSource})}}};
 const manifestFile=path.join(workerRuntimeRoot,'releases',releaseId,'deployment-manifest.json');
 await fs.mkdir(path.dirname(manifestFile),{recursive:true});
 await fs.writeFile(manifestFile,JSON.stringify(manifest,null,2)+'\n');
 const workerManifestSha256=sha(await fs.readFile(manifestFile));

 const runtimeRoot=path.join(root,'django-runtime');
 await fs.mkdir(path.join(runtimeRoot,'run'),{recursive:true});
 await fs.mkdir(path.join(runtimeRoot,'app'),{recursive:true});
 const deploymentFile=path.join(runtimeRoot,'app','deployment.json');
 await fs.writeFile(deploymentFile,JSON.stringify({version:2,deployedAt:'2026-10-30T14:46:15.969+08:00',
  sourceRoot:djangoSource,fingerprintAlgorithm:'relative-path-file-sha256-ordinal-v2',fileCount:3148,
  appFingerprint:'8'.repeat(64)},null,2)+'\n');
 const djangoManifestSha256=sha(await fs.readFile(deploymentFile));

 const stateDirectory=path.join(root,'state');await fs.mkdir(stateDirectory,{recursive:true});
 const catalogFile=path.join(stateDirectory,'PUBLISHED-MAIN.json');
 // The mismatched catalog: correct worker values, a stale Django digest.
 await fs.writeFile(catalogFile,JSON.stringify({status:'deployed_and_ready',mainCommit:workerCommit,
  workerRelease:releaseId,workerManifestSha256,djangoManifestSha256:'2'.repeat(64),
  source:workerSource,sourceTree:workerTree,receiptPath:path.join(root,'old-SUCCESS.json'),receiptSha256:'3'.repeat(64)},null,2)+'\n');

 const config={repository,stateDirectory,releaseDirectory:path.join(root,'packets'),nativeToolsSource:path.join(root,'native')};
 const api={workerRuntimeRoot,hashRelativeFiles:async()=>workerTree,listGitSourceFiles:async()=>['app/view.tsx']};
 const rotation={resolveEffectiveReleaseChain:async()=>({head:{releaseId,manifestSha256:workerManifestSha256,bindingSha256:'b'.repeat(64)},chainStateSha256:'c'.repeat(64)})};
 const logs=[];
 const options={
  loadApi:async()=>api,loadRotation:async()=>rotation,readDjango:()=>fs.readFile(deploymentFile),
 };
 const deps={
  observe:(cfg,{git:g}={})=>observeLiveIdentity(cfg,{...options,git:g}),
  probe:async()=>({checks:{'Assert-RuntimeAclHardened':{ok:true},'Assert-DeployedApplication':{ok:true},'Assert-NoForeignServiceChildren':{ok:true}},actors:[]}),
  probeRotation:async()=>true,
  fetchReady:async()=>Response.json({ok:true,status:'ready'}),
  runtimeRoot,
  log:line=>logs.push(line),
  reason:'10-30 修备份阻塞时直接调了底层动作，绕过发布记账；按实测值承认',
  confirm:djangoManifestSha256.slice(0,12),
  binding:{executionId:'exec-1'},
 };
 return {root,repository,config,workerSource,djangoSource,workerCommit,djangoCommit,releaseId,
  workerManifestSha256,djangoManifestSha256,workerTree,manifestFile,deploymentFile,runtimeRoot,
  catalogFile,stateDirectory,api,rotation,options,deps,logs,workerRuntimeRoot};
}

const readJson=async file=>JSON.parse(await fs.readFile(file,'utf8'));

test('adopts the measured live state: catalog, receipt and the backup of what it supersedes',async t=>{
 const f=await fixture(t);
 const before=await fs.readFile(f.catalogFile);
 const result=await adoptLivePublication(f.config,f.deps);

 assert.equal(result.status,'adopted-live');
 assert.equal(result.publicationPerformed,false);
 assert.equal(result.productionMutationsPerformed,false);
 // mainCommit keeps its existing meaning (worker source HEAD), so the next
 // release's base stays behind the Django side and cannot skip the gap.
 assert.equal(result.mainCommit,f.workerCommit);
 assert.equal(result.djangoSourceCommit,f.djangoCommit);
 assert.equal(result.split,true);

 const receipt=await readJson(result.receiptPath);
 assert.equal(receipt.status,'deployed_and_ready');
 assert.equal(receipt.adoption.version,liveAdoptionReceiptVersion);
 assert.equal(receipt.adoption.kind,liveAdoptionKind);
 assert.equal(receipt.adoption.publicationPerformed,false);
 assert.equal(receipt.adoption.reason,f.deps.reason);
 // Measured, not copied from the stale catalog.
 assert.equal(receipt.djangoManifestSha256,f.djangoManifestSha256);
 assert.equal(receipt.workerManifestSha256,f.workerManifestSha256);
 // Null by structure: the second way to tell an adoption from a publication.
 for(const field of ['djangoPreparedId','maintenanceId','migration'])assert.equal(receipt[field],null,field+' 必须显式为 null，不得编造');
 // The split is recorded rather than hidden.
 assert.equal(receipt.adoption.djangoSourceCommit,f.djangoCommit);
 assert.equal(receipt.adoption.djangoAhead.commitCount,1);
 assert.equal(receipt.adoption.djangoAhead.frontendPayload,false,'app/ lib/ components/ 无改动时必须记为 false');
 assert.equal(receipt.adoption.acknowledgedDeployment.djangoSourceRoot,f.djangoSource);
 assert.equal(receipt.adoption.acknowledgedDeployment.entryBypassed,'django-local-service.ps1 PrepareApp/DeployApp');

 // The superseded accounting is preserved byte-for-byte, with the stale digest.
 const catalog=await readJson(f.catalogFile);
 assert.equal(catalog.adoption.supersededCatalog.djangoManifestSha256,'2'.repeat(64));
 assert.deepEqual(await fs.readFile(catalog.adoption.supersededCatalog.path),before);
 assert.equal(catalog.receiptSha256,sha(await fs.readFile(result.receiptPath)));
 assert.equal(catalog.adoption.kind,liveAdoptionKind,'catalog 里也要带承认标记');
 assert.match(f.logs.join('\n'),/承认而非发布/);
 assert.match(f.logs.join('\n'),/前后台不是同一提交/);
});

test('records which catalog value actually drifted, and the prior real receipt',async t=>{
 // The production 10-30 shape: the catalog's worker release/manifest already
 // agreed with the live state and its receiptPath pointed at a genuine
 // SUCCESS.json from a real release; only djangoManifestSha256 had drifted.
 // The receipt must say so, so the adoption's scope stays auditable instead of
 // implying all three values were wrong.
 const f=await fixture(t);
 const priorPath=path.join(f.root,'prior-SUCCESS.json');
 const prior={status:'deployed_and_ready',mainCommit:f.workerCommit,workerRelease:f.releaseId,
  workerManifestSha256:f.workerManifestSha256,djangoManifestSha256:'2'.repeat(64),
  startupVerified:true,readyVerified:true};
 await fs.writeFile(priorPath,JSON.stringify(prior,null,2)+'\n');
 const priorSha=sha(await fs.readFile(priorPath));
 await fs.writeFile(f.catalogFile,JSON.stringify({...prior,source:f.workerSource,sourceTree:f.workerTree,
  receiptPath:priorPath,receiptSha256:priorSha},null,2)+'\n');

 const result=await adoptLivePublication(f.config,f.deps);
 const receipt=await readJson(result.receiptPath);
 const drift=receipt.adoption.catalogMismatch;
 assert.equal(drift.workerRelease.equal,true,'Worker 版本本来就一致，不应被说成失配');
 assert.equal(drift.workerManifestSha256.equal,true,'Worker 清单摘要本来就一致');
 assert.equal(drift.djangoManifestSha256.equal,false,'唯一失配项必须是 Django 摘要');
 assert.equal(drift.djangoManifestSha256.catalog,'2'.repeat(64));
 assert.equal(drift.djangoManifestSha256.live,f.djangoManifestSha256);

 // The prior receipt is recorded as present and intact, with what it declared.
 assert.equal(receipt.adoption.priorReceipt.present,true);
 assert.equal(receipt.adoption.priorReceipt.intact,true);
 assert.equal(receipt.adoption.priorReceipt.declares.status,'deployed_and_ready');
 assert.equal(receipt.adoption.priorReceipt.declares.workerRelease,f.releaseId);
 assert.equal(receipt.adoption.priorReceipt.declares.djangoManifestSha256,'2'.repeat(64),
  '旧回执声明的是旧 Django 摘要，这正是失配的来源');
 // Recording it must not alter it.
 assert.equal(sha(await fs.readFile(priorPath)),priorSha,'旧回执字节不得被改动');
});

test('a missing or altered prior receipt is recorded as such, not papered over',async t=>{
 const f=await fixture(t);
 // The catalog in the base fixture points at a receipt that does not exist.
 const absent=await adoptLivePublication(f.config,f.deps);
 const one=await readJson(absent.receiptPath);
 assert.equal(one.adoption.priorReceipt.present,false);
 assert.equal(one.adoption.priorReceipt.intact,null);
 assert.equal(one.adoption.priorReceipt.declares,null);

 // Now one that exists but whose bytes no longer match the declared digest.
 const f2=await fixture(t);
 const priorPath=path.join(f2.root,'tampered-SUCCESS.json');
 await fs.writeFile(priorPath,JSON.stringify({status:'deployed_and_ready'},null,2)+'\n');
 await fs.writeFile(f2.catalogFile,JSON.stringify({status:'deployed_and_ready',mainCommit:f2.workerCommit,
  workerRelease:f2.releaseId,workerManifestSha256:f2.workerManifestSha256,djangoManifestSha256:'2'.repeat(64),
  receiptPath:priorPath,receiptSha256:'0'.repeat(64)},null,2)+'\n');
 const altered=await adoptLivePublication(f2.config,f2.deps);
 const two=await readJson(altered.receiptPath);
 assert.equal(two.adoption.priorReceipt.present,true);
 assert.equal(two.adoption.priorReceipt.intact,false,'摘要不符必须记为 false，不能略过');
});

test('the written catalog is accepted by the real readLivePublication',async t=>{
 // This is the core claim of design option A: the entry does not relax any
 // existing assertion, it makes the catalog branch's conditions actually true.
 const f=await fixture(t);
 await adoptLivePublication(f.config,f.deps);

 const live=await readLivePublication({...f.config,nativeToolsSource:'unused'},{
  loadApi:async()=>f.api,loadRotation:async()=>f.rotation,
  readDjango:()=>fs.readFile(f.deploymentFile),runtimeRoot:f.runtimeRoot,
  fetchReady:async()=>Response.json({ok:true,status:'ready'}),
 });
 assert.equal(live.mainCommit,f.workerCommit);
 assert.equal(live.djangoManifestSha256,f.djangoManifestSha256);
 assert.equal(live.source,f.workerSource);
});

test('the receipt lands outside the ordinary attempt directory (structural)',async t=>{
 // Pins the §9.1 decision. Moving the receipt into publish-<12hex>/ would both
 // disguise a real half-switch as completed and break the packet-closure
 // assertions in preparation-resolution.mjs:266 — so it must break a test first.
 const f=await fixture(t);
 const result=await adoptLivePublication(f.config,f.deps);
 const ordinary=path.resolve(f.workerSource,'..','publish-'+f.workerCommit.slice(0,12));
 assert.notEqual(path.resolve(path.dirname(result.receiptPath)),ordinary,
  '回执必须落在常规 attempt 目录之外；挪进去会把真实半切换伪装成已完成');
 const receipt=await readJson(result.receiptPath);
 assert.ok(receipt.adoption.suppressedGuard,'被短路的门禁必须留证');
 assert.deepEqual(receipt.adoption.suppressedGuard.stillEnforcedBy,
  ['prepareLatestMainOnce:122-123','inspectMainPreparation:255-256']);
 const snapshots=receipt.adoption.suppressedGuard.verifiedAtAdoption;
 assert.deepEqual(Object.keys(snapshots).sort(),[f.workerCommit,f.djangoCommit].sort());
 for(const entry of Object.values(snapshots))assert.equal(entry.membersSha256,sha(Buffer.from(JSON.stringify(entry.members))));
});

test('only three files are written and no preparation pointer is produced',async t=>{
 const f=await fixture(t);
 const result=await adoptLivePublication(f.config,f.deps);
 assert.deepEqual((await fs.readdir(f.stateDirectory)).sort(),['PUBLISHED-MAIN.json','adoptions'].sort());
 assert.deepEqual((await fs.readdir(path.join(f.stateDirectory,'adoptions',result.adoptionId))).sort(),
  ['ADOPTED.json','superseded-PUBLISHED-MAIN.json']);
 // An adoption produces no artifact pointer, so nothing downstream can mistake
 // it for "prepared and ready to deploy".
 await assert.rejects(fs.access(path.join(f.stateDirectory,'LATEST-PREPARED.json')),{code:'ENOENT'});
 await assert.rejects(fs.access(path.join(f.config.releaseDirectory)),{code:'ENOENT'});
});

// ---------------------------------------------------------------------------
// Negative fixtures: each clause is broken on purpose and must refuse on its own
// terms. A happy-path-only suite would not notice any of these.
// ---------------------------------------------------------------------------

const refuses=async(f,deps,pattern)=>{
 const before=await fs.readFile(f.catalogFile);
 await assert.rejects(adoptLivePublication(f.config,{...f.deps,...deps}),pattern);
 // Every refusal must leave the accounting exactly as it was.
 assert.deepEqual(await fs.readFile(f.catalogFile),before,'拒绝时不得改动发布记账');
 await assert.rejects(fs.access(path.join(f.stateDirectory,'adoptions')),{code:'ENOENT'});
};

test('P1 refuses when the catalog already matches the live state',async t=>{
 const f=await fixture(t);
 await fs.writeFile(f.catalogFile,JSON.stringify({status:'deployed_and_ready',mainCommit:f.workerCommit,
  workerRelease:f.releaseId,workerManifestSha256:f.workerManifestSha256,
  djangoManifestSha256:f.djangoManifestSha256},null,2)+'\n');
 await refuses(f,{},/已一致，无需承认/);
});

test('P2 refuses when the live state cannot be read; nothing is inferred',async t=>{
 const f=await fixture(t);
 await refuses(f,{observe:async()=>{throw Error('worker chain unreadable');}},/worker chain unreadable/);
});

test('P2 refuses a manifest whose bytes do not match the chain digest',async t=>{
 const f=await fixture(t);
 await fs.appendFile(f.manifestFile,'\n');
 await refuses(f,{},/清单字节与版本链记录的摘要不一致/);
});

test('P3 refuses a dirty worker source',async t=>{
 const f=await fixture(t);
 await fs.writeFile(path.join(f.workerSource,'app/view.tsx'),'uncommitted edit\n');
 await refuses(f,{},/现役前端来源不可追溯或有未提交修改/);
});

test('P4 refuses when the worker source tree differs from its running package',async t=>{
 const f=await fixture(t);
 await refuses(f,{observe:(cfg,{git:g}={})=>observeLiveIdentity(cfg,{...f.options,git:g,
  loadApi:async()=>({...f.api,hashRelativeFiles:async()=>({...f.workerTree,sha256:'9'.repeat(64)})})})},
  /现役前端来源与运行包不一致/);
});

test('P5 refuses a dirty Django source',async t=>{
 const f=await fixture(t);
 await fs.writeFile(path.join(f.djangoSource,'tools/watchdog.ps1'),'hand-edited on the live tree\n');
 await refuses(f,{},/现役后台来源不可追溯或有未提交修改/);
});

test('P6 refuses a commit that is not on origin/main',async t=>{
 const f=await fixture(t);
 // A local commit that was never pushed: exactly the "private branch" case.
 await fs.writeFile(path.join(f.repository,'tools/watchdog.ps1'),'unpushed\n');
 git(f.repository,['add','-A']);git(f.repository,['commit','--quiet','-m','unpushed']);
 const unpushed=git(f.repository,['rev-parse','HEAD']);
 git(f.repository,['worktree','add','--quiet','--detach',path.join(f.root,'unpushed-tree'),unpushed]);
 t.after(()=>{try{git(f.repository,['worktree','remove','--force',path.join(f.root,'unpushed-tree')]);}catch{}});
 await fs.writeFile(f.deploymentFile,JSON.stringify({version:2,deployedAt:'2026-10-30T14:46:15.969+08:00',
  sourceRoot:path.join(f.root,'unpushed-tree'),fingerprintAlgorithm:'relative-path-file-sha256-ordinal-v2',
  fileCount:3148,appFingerprint:'8'.repeat(64)},null,2)+'\n');
 const digest=sha(await fs.readFile(f.deploymentFile));
 await refuses(f,{confirm:digest.slice(0,12)},/不在 origin\/main 上/);
});

test('P7 refuses when the frontend is ahead of the backend',async t=>{
 const f=await fixture(t);
 // Swap the roles: worker at the descendant, Django at the ancestor. Taking the
 // worker HEAD would push the next release base past the backend and skip it.
 const manifest={source:{tree:f.workerTree,sourceBinding:{raw:JSON.stringify({sourceRoot:f.djangoSource})}}};
 await fs.writeFile(f.manifestFile,JSON.stringify(manifest,null,2)+'\n');
 const manifestSha256=sha(await fs.readFile(f.manifestFile));
 await fs.writeFile(f.deploymentFile,JSON.stringify({version:2,deployedAt:'2026-10-30T14:46:15.969+08:00',
  sourceRoot:f.workerSource,fingerprintAlgorithm:'relative-path-file-sha256-ordinal-v2',
  fileCount:3148,appFingerprint:'8'.repeat(64)},null,2)+'\n');
 const digest=sha(await fs.readFile(f.deploymentFile));
 await refuses(f,{confirm:digest.slice(0,12),
  observe:(cfg,{git:g}={})=>observeLiveIdentity(cfg,{...f.options,git:g,
   loadRotation:async()=>({resolveEffectiveReleaseChain:async()=>({head:{releaseId:f.releaseId,manifestSha256,bindingSha256:'b'.repeat(64)},chainStateSha256:'c'.repeat(64)})})})},
  /前后台提交关系无法解释/);
});

test('P7 refuses two sibling commits with no ancestry between them',async t=>{
 const f=await fixture(t);
 // A genuine divergence that still satisfies P6: both commits must be ancestors
 // of origin/main, so main has to be a MERGE of the two. Branching and
 // force-pushing one side instead would leave the pair linear and prove nothing.
 git(f.repository,['checkout','--quiet','-b','sidebranch',f.workerCommit]);
 await fs.writeFile(path.join(f.repository,'tools/sidecar.ps1'),'divergent\n');
 git(f.repository,['add','-A']);git(f.repository,['commit','--quiet','-m','divergent sibling']);
 const sibling=git(f.repository,['rev-parse','HEAD']);
 git(f.repository,['checkout','--quiet','main']);
 git(f.repository,['merge','--quiet','--no-ff','-m','merge sibling','sidebranch']);
 git(f.repository,['push','--quiet','origin','main']);
 // Neither is an ancestor of the other, but both are ancestors of origin/main.
 assert.equal(await gitSucceedsAt(f.repository,['merge-base','--is-ancestor',sibling,'refs/remotes/origin/main']),true);
 assert.equal(await gitSucceedsAt(f.repository,['merge-base','--is-ancestor',f.djangoCommit,'refs/remotes/origin/main']),true);
 assert.equal(await gitSucceedsAt(f.repository,['merge-base','--is-ancestor',sibling,f.djangoCommit]),false);
 assert.equal(await gitSucceedsAt(f.repository,['merge-base','--is-ancestor',f.djangoCommit,sibling]),false);

 const tree=path.join(f.root,'sibling-tree');
 git(f.repository,['worktree','add','--quiet','--detach',tree,sibling]);
 t.after(()=>{try{git(f.repository,['worktree','remove','--force',tree]);}catch{}});
 // Put the sibling on the worker side; Django stays at its own commit.
 const manifest={source:{tree:f.workerTree,sourceBinding:{raw:JSON.stringify({sourceRoot:tree})}}};
 await fs.writeFile(f.manifestFile,JSON.stringify(manifest,null,2)+'\n');
 const manifestSha256=sha(await fs.readFile(f.manifestFile));
 await refuses(f,{observe:(cfg,{git:g}={})=>observeLiveIdentity(cfg,{...f.options,git:g,
  loadRotation:async()=>({resolveEffectiveReleaseChain:async()=>({head:{releaseId:f.releaseId,manifestSha256,bindingSha256:'b'.repeat(64)},chainStateSha256:'c'.repeat(64)})})})},
  /前后台提交关系无法解释/);
});

for(const marker of ['system-maintenance.json','automation-drain.json'])
 test('P9 refuses while a maintenance or drain marker exists: '+marker,async t=>{
  const f=await fixture(t);
  await fs.writeFile(path.join(f.runtimeRoot,'run',marker),'{}');
  await refuses(f,{},/维护或排空状态/);
 });

for(const [name,ready] of [
 ['non-200',async()=>({status:503,json:async()=>({ok:false})})],
 ['not ok',async()=>({status:200,json:async()=>({ok:false,status:'ready'})})],
 ['not ready',async()=>({status:200,json:async()=>({ok:true,status:'starting'})})],
 ['unreachable',async()=>{throw Error('ECONNREFUSED');}],
]) test('P10 refuses when the service is not ready: '+name,async t=>{
 const f=await fixture(t);
 await refuses(f,{fetchReady:ready},/尚未就绪/);
});

test('P11 refuses while the rotation lock is held',async t=>{
 const f=await fixture(t);
 await refuses(f,{probeRotation:async()=>false},/轮换锁/);
});

test('P12 refuses when the live controller precondition probe fails',async t=>{
 const f=await fixture(t);
 await refuses(f,{probe:async()=>({checks:{'Assert-RuntimeAclHardened':{ok:false,message:'ACL 未加固'}},actors:[]})},
  /权限或部署清单检查未通过/);
});

for(const side of ['worker','django'])
 test('P15 refuses a half-switch on the '+side+' side',async t=>{
  const f=await fixture(t);
  const commit=side==='worker'?f.workerCommit:f.djangoCommit;
  const source=side==='worker'?f.workerSource:f.djangoSource;
  const attempt=path.resolve(source,'..','publish-'+commit.slice(0,12));
  await fs.mkdir(attempt,{recursive:true});
  await fs.writeFile(path.join(attempt,'STARTED.json'),'original unknown');
  await refuses(f,{},/有开始无成功，不能把半切换当作已发布/);
  assert.equal(await fs.readFile(path.join(attempt,'STARTED.json'),'utf8'),'original unknown','原记录必须保留');
 });

test('P16 refuses when a real receipt already declares the live triple',async t=>{
 const f=await fixture(t);
 const attempt=path.resolve(f.workerSource,'..','publish-'+f.workerCommit.slice(0,12));
 await fs.mkdir(attempt,{recursive:true});
 await fs.writeFile(path.join(attempt,'SUCCESS.json'),JSON.stringify({status:'deployed_and_ready',
  mainCommit:f.workerCommit,workerRelease:f.releaseId,workerManifestSha256:f.workerManifestSha256,
  djangoManifestSha256:f.djangoManifestSha256}));
 await refuses(f,{},/应协调发布索引而不是承认/);
});

test('P17 refuses rather than overwrite when the backup cannot be created exclusively',async t=>{
 const f=await fixture(t);
 const before=await fs.readFile(f.catalogFile);
 const adoptionId='fixed-adoption-id';
 const directory=path.join(f.stateDirectory,'adoptions',adoptionId);
 await fs.mkdir(directory,{recursive:true});
 await fs.writeFile(path.join(directory,'superseded-PUBLISHED-MAIN.json'),'pre-existing backup');
 await assert.rejects(adoptLivePublication(f.config,{...f.deps,adoptionId}),{code:'EEXIST'});
 assert.deepEqual(await fs.readFile(f.catalogFile),before,'备份无法独占创建时不得替换记账');
 assert.equal(await fs.readFile(path.join(directory,'superseded-PUBLISHED-MAIN.json'),'utf8'),'pre-existing backup');
});

test('a missing or blank reason is refused before anything is read',async t=>{
 const f=await fixture(t);
 for(const reason of [undefined,'','   ']){
  let observed=false;
  await assert.rejects(adoptLivePublication(f.config,{...f.deps,reason,
   observe:async()=>{observed=true;throw Error('must not observe');}}),/必须说明依据/);
  assert.equal(observed,false,'依据缺失必须在任何读取之前拒绝');
 }
});

test('--adopt-confirm must equal the measured Django digest prefix',async t=>{
 const f=await fixture(t);
 await refuses(f,{confirm:'0'.repeat(12)},/必须是现役后台实测摘要的前 12 位/);
 // The right value is the measured one, not the stale catalog's.
 await refuses(f,{confirm:'2'.repeat(12)},/必须是现役后台实测摘要的前 12 位/);
});

test('the no-split case records split=false and no djangoAhead',async t=>{
 const f=await fixture(t,{split:false});
 const result=await adoptLivePublication(f.config,f.deps);
 assert.equal(result.split,false);
 const receipt=await readJson(result.receiptPath);
 assert.equal(receipt.adoption.split,false);
 assert.equal(receipt.adoption.djangoAhead,null);
 assert.equal(receipt.mainCommit,f.workerCommit);
 assert.doesNotMatch(f.logs.join('\n'),/前后台不是同一提交/);
});

// ---------------------------------------------------------------------------
// CLI admission: the flag cannot share a run with any other mode.
// ---------------------------------------------------------------------------

const cli=args=>runLatestMainCli(args);

for(const other of ['--check','--prepare-only','--consume-preparation','--retire-lost-artifacts'])
 test('CLI refuses --adopt-live together with '+other,async()=>{
  await assert.rejects(cli(['--config','C:/unused.json','--adopt-live','--adopt-reason','r','--adopt-confirm','abcdef123456',other]),
   /cannot prepare, reconcile, check, publish|cannot prepare, reconcile, check, publish or adopt|Consumer cannot submit/);
 });

test('CLI refuses --adopt-live together with --abandon-dispatch',async()=>{
 await assert.rejects(cli(['--config','C:/unused.json','--adopt-live','--adopt-reason','r','--adopt-confirm','abcdef123456',
  '--abandon-dispatch','d','--dispatch-sha256','x','--result-sha256','y','--target','t','--packet','p']),
  /cannot prepare, check, publish or adopt|Live adoption cannot/);
});

test('CLI requires both --adopt-reason and a well-formed --adopt-confirm',async()=>{
 await assert.rejects(cli(['--config','C:/unused.json','--adopt-live']),/requires --adopt-reason/);
 await assert.rejects(cli(['--config','C:/unused.json','--adopt-live','--adopt-reason','   ']),/requires --adopt-reason/);
 await assert.rejects(cli(['--config','C:/unused.json','--adopt-live','--adopt-reason','r']),/requires --adopt-confirm/);
 await assert.rejects(cli(['--config','C:/unused.json','--adopt-live','--adopt-reason','r','--adopt-confirm','ZZZ']),/requires --adopt-confirm/);
});

for(const field of ['--adopt-reason','--adopt-confirm'])
 test('CLI refuses '+field+' without --adopt-live',async()=>{
  await assert.rejects(cli(['--config','C:/unused.json',field,'abcdef123456']),/only applies to --adopt-live/);
 });

test('gitSucceedsAt maps git false to false and keeps real failures as errors',async t=>{
 const f=await fixture(t);
 assert.equal(await gitSucceedsAt(f.repository,['merge-base','--is-ancestor',f.workerCommit,f.djangoCommit]),true);
 assert.equal(await gitSucceedsAt(f.repository,['merge-base','--is-ancestor',f.djangoCommit,f.workerCommit]),false);
 await assert.rejects(gitSucceedsAt(f.repository,['merge-base','--is-ancestor','not-a-commit',f.workerCommit]),/未推定祖先关系/);
});
