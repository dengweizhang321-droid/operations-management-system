import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {prepareLatestMain,prepareLatestMainOnce,inspectMainPreparation,deployReadyMain,drainLatestMainQueue,acquireMainPublicationQueue,parseApplyTimingLines} from '../tools/publish-latest-main.mjs';
// publish-main-tail.mjs only exports finishMainPublication and has no import
// side effects, so the real tail can be driven directly here.
import {finishMainPublication} from '../tools/publish-main-tail.mjs';
import {preparationTimingLine} from '../tools/worker-local-release-rotation.mjs';
import {submitPreparation,ticketResult,drainPreparationQueue} from '../tools/main-prebuild-queue.mjs';
import {mainRefEvents} from '../tools/main-prebuild-hook.mjs';
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
 const git=async(source,args)=>{assert.equal(source,prepared.source);if(args[0]==='status')return '';if(args.length===4){assert.deepEqual(args,['rev-parse','HEAD','HEAD^{tree}',targetCommit+'^{tree}']);return [targetCommit,tree,tree].join('\n');}if(args[1]==='HEAD')return targetCommit;assert.ok(args[1]==='HEAD^{tree}'||args[1]===targetCommit+'^{tree}');return tree;};
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

async function queuedFixture(t){
 const f=await fixture(t);f.live.chainStateSha256='5'.repeat(64);
 const binding={config:f.config,state:{configSha256:'6'.repeat(64),bundleSha256:'7'.repeat(64)}};
 const directory=path.join(f.config.stateDirectory,'prebuild-queue-v2');
 const first=await prepareLatestMain(f.config,f.options);
 const selection={targetCommit:f.latest,packet:first.packet,live:f.live};
 const submit=()=>submitPreparation(directory,{origin:'hook',observedTarget:f.latest,...binding.state});
 let runs=0;
 const options={binding,assertGeneration:async()=>{},assertConsumerIdentity:async()=>{},admit:async()=>{},observe:async()=>selection,once:prepareLatestMainOnce,
  run:async(source,args)=>{
   runs++;assert.deepEqual(args,['--prepare-only']);
   const preparation=path.join(first.packet,'publish-'+f.latest.slice(0,12),'preparation');await fs.mkdir(preparation,{recursive:true});
   const preparationFile=path.join(preparation,'PREPARED.json');
   await fs.writeFile(preparationFile,JSON.stringify({version:'teruisi-main-preparation-v1',requestSha256:createHash('sha256').update(JSON.stringify(first.request)).digest('hex'),sourceIdentity:{commit:f.latest,tree:f.git(source,['rev-parse','HEAD^{tree}'])},workerPlan:{id:'private-native-fixture'},djangoPackage:null}));
   return {status:'prepared-only',mainCommit:f.latest,publicationPerformed:false,preparationFile};
  }};
 return {...f,binding,directory,first,selection,submit,options,runs:()=>runs};
}
test('same-target physical ref tickets reuse exact native preparation without taking rotation again',async t=>{
 const f=await queuedFixture(t),first=await f.submit();await drainLatestMainQueue('unused',f.options);
 const original=await ticketResult(f.directory,first.requestId,first.ticketSha256);
 const later=await f.submit();await drainLatestMainQueue('unused',f.options);
 const reused=await ticketResult(f.directory,later.requestId,later.ticketSha256);
 assert.equal(f.runs(),1);assert.equal(reused.status,'prepared');assert.deepEqual(reused.nativeResult,original.nativeResult);
 // Missing retained dependencies are corruption, never a new build permit.
 await fs.rename(path.join(f.first.packet,'main-release-request.json'),path.join(f.first.packet,'preserved-request.json'));
 await f.submit();await assert.rejects(drainLatestMainQueue('unused',f.options),error=>error.code==='ENOENT');assert.equal(f.runs(),1);
});
test('a detached native receipt without the retained queue completion still uses native verification',async t=>{
 const f=await queuedFixture(t);await f.options.run(f.first.source,['--prepare-only']);
 await f.submit();await drainLatestMainQueue('unused',f.options);assert.equal(f.runs(),2);
});
test('modified retained PREPARED never becomes a native replay permit',async t=>{
 const f=await queuedFixture(t),ticket=await f.submit();await drainLatestMainQueue('unused',f.options);
 const prior=await ticketResult(f.directory,ticket.requestId,ticket.ticketSha256);
 await fs.appendFile(prior.nativeResult.preparationFile,' ');await f.submit();
 await assert.rejects(drainLatestMainQueue('unused',f.options),/Native preparation receipt changed/);assert.equal(f.runs(),1);
});
test('publish lease precedes fetch tickets and preparation cannot enter until it releases',async t=>{
 const f=await queuedFixture(t),release=await acquireMainPublicationQueue(f.binding,{assertGeneration:async()=>{}});
 const event=await f.submit();
 assert.equal((await drainLatestMainQueue('unused',f.options)).status,'queued');assert.equal(f.runs(),0);
 await release();await drainLatestMainQueue('unused',f.options);assert.equal(f.runs(),1);
 assert.equal((await ticketResult(f.directory,event.requestId,event.ticketSha256)).status,'prepared');
});
test('fetch ticket drains as current after publishing the held target without native preparation',async t=>{
 const f=await queuedFixture(t),release=await acquireMainPublicationQueue(f.binding,{assertGeneration:async()=>{}});
 const event=await f.submit();assert.equal((await drainLatestMainQueue('unused',f.options)).status,'queued');
 f.live.mainCommit=f.latest;await release();await drainLatestMainQueue('unused',f.options);
 assert.equal((await ticketResult(f.directory,event.requestId,event.ticketSha256)).status,'current');assert.equal(f.runs(),0);
});
test('prepare lease refuses publishing before dispatch effects; generation failure releases it',async t=>{
 const f=await queuedFixture(t);await f.submit();let checked=false;
 await drainPreparationQueue(f.directory,{...f.binding.state,observe:async()=>{
  await assert.rejects(acquireMainPublicationQueue(f.binding,{assertGeneration:async()=>{checked=true;}}),/准备队列正在处理/);
  return f.selection;
 },prepare:async()=>{throw Error('private unknown');}});
 assert.equal(checked,false);
 await assert.rejects(acquireMainPublicationQueue(f.binding,{assertGeneration:async()=>{throw Error('generation changed');}}),/generation changed/);
 const release=await acquireMainPublicationQueue(f.binding,{assertGeneration:async()=>{}});await release();
});
test('actual Git pack-refs physical 0-to-SHA events remain accepted like a genuine first fetch',async t=>{
 const f=await fixture(t),record=path.join(f.root,'ref-events.txt');
 const hook=path.join(f.repository,'.git/hooks/reference-transaction');
 const shellQuote=value=>"'"+value.replaceAll('\\','/').replaceAll("'","'\\''")+"'";
 await fs.writeFile(hook,'#!/bin/sh\nif [ "$1" = "committed" ]; then cat >> '+shellQuote(record)+'; fi\n');
 f.git(f.repository,['update-ref','refs/remotes/origin/main',f.old]);
 await fs.writeFile(record,'');
 f.git(f.repository,['update-ref','refs/remotes/origin/main',f.latest]);
 const changed=await fs.readFile(record,'utf8');assert.deepEqual(mainRefEvents('committed',changed),[f.latest]);
 await fs.writeFile(record,'');f.git(f.repository,['pack-refs','--all']);
 const packed=await fs.readFile(record,'utf8');
 assert.ok(packed.split(/\r?\n/).includes('0'.repeat(40)+' '+f.latest+' refs/remotes/origin/main'),packed);
 assert.deepEqual(mainRefEvents('committed',packed),[f.latest]);
});
// C 项第三步: the apply-window timing receipt's only logic is this parse, so its
// boundaries are pinned here — the two `[构建明细]` shapes must be told apart,
// non-apply stages must be counted rather than dropped, and a failed stage must
// survive (that is the case where "which stage did it hang on" matters most).
const timingLine=(stage,elapsedMs,outcome,label,at='2026-10-27T01:49:00.000Z')=>
 '['+at+'] [构建明细] stage='+stage+' elapsedMs='+elapsedMs+' outcome='+outcome+' '+label;
test('C 项第三步: apply timing lines parse into a receipt and nothing else is collected',()=>{
 const parsed=parseApplyTimingLines([
  timingLine('apply.validate#1',1200,'ok','应用/批准轮换校验#1'),
  timingLine('apply.install-startup',34000,'ok','应用/启动安装与启动校验'),
 ]);
 assert.deepEqual(parsed.stages.map(s=>s.stage),['apply.validate#1','apply.install-startup']);
 assert.deepEqual(parsed.stages[0],{stage:'apply.validate#1',label:'应用/批准轮换校验#1',elapsedMs:1200,outcome:'ok',at:'2026-10-27T01:49:00.000Z'});
 assert.equal(parsed.totalElapsedMs,35200);
 assert.equal(parsed.unexpectedLineCount,0);
 assert.deepEqual(parsed.unexpectedLineSamples,[]);
 // elapsedMs must be a number, not the captured string: the receipt is summed
 // and compared across releases.
 for(const entry of parsed.stages)assert.equal(typeof entry.elapsedMs,'number');
});
test('C 项第三步: a failed stage stays in the receipt with outcome failed',()=>{
 const parsed=parseApplyTimingLines([
  timingLine('apply.validate#1',1200,'ok','应用/批准轮换校验#1'),
  timingLine('apply.install-startup',7,'failed','应用/启动安装与启动校验'),
 ]);
 assert.deepEqual(parsed.stages.map(s=>[s.stage,s.outcome]),[['apply.validate#1','ok'],['apply.install-startup','failed']]);
});
test('C 项第三步: the other 构建明细 writer and ordinary progress lines are not collected',()=>{
 // worker-local-release.mjs buildTiming: same prefix, `label：N ms` shape.
 const parsed=parseApplyTimingLines([
  '[2026-10-27T01:49:00.000Z] [构建明细] 离线依赖安装：55000 ms',
  '[2026-10-27T01:49:00.000Z] [构建明细] 源码完整快照及两次复制：12000 ms；details',
  '[2026-10-27T01:49:00.000Z] [步骤 5] 切换前端 进行中，本步已用 30 秒',
  'main版本：71a384f5；步骤详细日志：D:/x',
  '',
  timingLine('apply.validate#1',1200,'ok','应用/批准轮换校验#1'),
 ]);
 assert.deepEqual(parsed.stages.map(s=>s.stage),['apply.validate#1']);
 // Those lines are not `stage=` records at all, so they are not "unexpected
 // stages" either — they must not inflate the anomaly counter.
 assert.equal(parsed.unexpectedLineCount,0);
});
test('C 项第三步: a preparation-side stage reaching the apply window is counted, not dropped',()=>{
 const intruder=timingLine('rotation-lock',99,'ok','轮换锁获取');
 const parsed=parseApplyTimingLines([
  intruder,
  timingLine('tail.service-lock',5,'ok','尾段服务锁等待'),
  timingLine('apply.validate#1',1200,'ok','应用/批准轮换校验#1'),
 ]);
 assert.deepEqual(parsed.stages.map(s=>s.stage),['apply.validate#1']);
 assert.equal(parsed.unexpectedLineCount,2);
 assert.deepEqual(parsed.unexpectedLineSamples,[intruder,timingLine('tail.service-lock',5,'ok','尾段服务锁等待')]);
 assert.equal(parsed.totalElapsedMs,1200,'非 apply 阶段不得计入总耗时');
});
test('C 项第三步: at most three samples are kept and each is truncated',()=>{
 const long=timingLine('rotation-lock',1,'ok','x'.repeat(600));
 const parsed=parseApplyTimingLines([long,long,long,long,long]);
 assert.equal(parsed.unexpectedLineCount,5);
 assert.equal(parsed.unexpectedLineSamples.length,3);
 for(const sample of parsed.unexpectedLineSamples)assert.equal(sample.length,300);
});
test('C 项第三步: the parse is pinned against a weakened filter (negative test)',()=>{
 // Mutations of the two decisions this function makes. Each must be rejected by
 // the assertions above; if a weakened implementation still passes them, the
 // tests have a blind spot. Both mutants are run against the real expectations.
 const lines=[
  '[2026-10-27T01:49:00.000Z] [构建明细] 离线依赖安装：55000 ms',
  timingLine('rotation-lock',99,'ok','轮换锁获取'),
  timingLine('apply.validate#1',1200,'ok','应用/批准轮换校验#1'),
 ];
 // Mutant 1: drop the `apply.` filter — collects the preparation-side stage.
 const noPrefixFilter=lines.filter(line=>/\[构建明细\] stage=/.test(line)).length;
 assert.equal(noPrefixFilter,2,'夹具须含一条非 apply. 的 stage 行，否则前缀筛选的用例是空跑');
 assert.notEqual(noPrefixFilter,parseApplyTimingLines(lines).stages.length,'去掉 apply. 前缀筛选会多收一条，真实实现必须与之不同');
 // Mutant 2: match the `[构建明细]` prefix only — collects buildTiming's shape.
 const prefixOnly=lines.filter(line=>line.includes('[构建明细]')).length;
 assert.equal(prefixOnly,3);
 assert.notEqual(prefixOnly,parseApplyTimingLines(lines).stages.length,'只匹配 [构建明细] 前缀会误收 buildTiming 行');
 assert.equal(parseApplyTimingLines(lines).stages.length,1);
});
// C 项第三步修复: the receipt's landing point, which the parse tests above
// cannot reach. The first attempt collected the lines in publish-main.mjs, a
// path a regular publication never executes (:102 throws first), and all six
// parse cases stayed green because a unit test proves what the code under test
// does — never that it runs. Production confirmed it: WorkerApply-result.json
// existed, apply-timing.json did not. So these cases drive the real tail and
// pin the landing point structurally.
const tailFixture=async(t,{completed={},apply,logLines=[]}={})=>{
 const out=await fs.mkdtemp(path.join(os.tmpdir(),'apply-timing-tail-'));
 t.after(()=>fs.rm(out,{recursive:true,force:true}));
 const written=[],maintenanceId='maintenance-1';
 const plan={planSha256:'p'.repeat(64),candidateReleaseId:'20261027T000000Z-aaaabbbbccccdddd',candidateManifestSha256:'m'.repeat(64)};
 const djangoExpected='d'.repeat(64);
 const save=async(name,value)=>{written.push(name);await fs.writeFile(path.join(out,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});};
 const rotation={
  applyApprovedRotationPlan:apply??(async()=>{for(const line of logLines)console.log(line);return {status:'activated',releaseId:plan.candidateReleaseId};}),
  resolveEffectiveReleaseChain:async()=>({head:{releaseId:plan.candidateReleaseId,manifestSha256:plan.candidateManifestSha256}}),
 };
 const stepResults={'退出维护':{status:'maintenance_ended',maintenanceId},
  '启动服务':{status:'started',manifestSha256:plan.candidateManifestSha256},
  '结束前端排空':{status:'worker_drain_ended',maintenanceId},
  '确认启动版本':{startupVerified:true}};
 const run=()=>finishMainPublication({request:{mainCommit:'c'.repeat(40),components:{worker:true,django:false}},
  components:{django:false},source:'D:/frozen',identity:{tree:null},installed:out,out,
  api:{workerRuntimeRoot:out},rotation,rotationLease:{id:'lease-1'},
  before:{head:{releaseId:'20261026T000000Z-0000111122223333',manifestSha256:'b'.repeat(64)}},
  plan,pkg:null,djangoExpected,maintenanceId,schema:null,schemaReceipt:null,piUpgradeReceipt:null,
  step:async label=>stepResults[label],save,sha:async()=>djangoExpected,
  ready:async()=>{},refreshLease:async()=>{},endLease:async()=>{},
  progress:{begin(){},complete(){},success(){},log(){}},phase(){},completed});
 const receipt=async name=>JSON.parse(await fs.readFile(path.join(out,name),'utf8'));
 return {out,written,run,receipt};
};
test('C 项第三步修复: the apply window is intercepted where a regular publication runs it',async t=>{
 const f=await tailFixture(t,{logLines:[
  preparationTimingLine('apply.validate#1',1200,'ok','应用/批准轮换校验#1',new Date('2026-10-27T01:49:00.000Z')),
  preparationTimingLine('apply.install-startup',34000,'ok','应用/启动安装与启动校验',new Date('2026-10-27T01:49:34.000Z')),
 ]});
 await f.run();
 // Both receipts come out of the same operation: the operational one the release
 // depends on, and the diagnostic one beside it.
 assert.ok(f.written.includes('WorkerApply-result.json'));
 assert.ok(f.written.includes('apply-timing.json'),'回执必须落在真实 apply 执行点，而不是已停用的入口');
 const timing=await f.receipt('apply-timing.json');
 assert.equal(timing.version,'teruisi-apply-timing-v1');
 assert.deepEqual(timing.stages.map(s=>s.stage),['apply.validate#1','apply.install-startup']);
 assert.equal(timing.totalElapsedMs,35200);
 assert.equal(timing.unexpectedLineCount,0,'窗口内只有 applyApprovedRotationPlan，不应混入准备侧计时');
 assert.equal(timing.planSha256,'p'.repeat(64));
 assert.equal(timing.mainCommit,'c'.repeat(40));
 assert.equal(timing.releaseId,'20261027T000000Z-aaaabbbbccccdddd');
 // The replacement must not outlive the window.
 assert.equal(console.log,globalThis.console.log);
});
test('C 项第三步修复: a non-apply line inside the window is counted, proving the parser is really wired in',async t=>{
 const intruder=preparationTimingLine('rotation-lock',99,'ok','轮换锁获取',new Date('2026-10-27T01:49:00.000Z'));
 const f=await tailFixture(t,{logLines:[intruder,
  preparationTimingLine('apply.validate#1',1200,'ok','应用/批准轮换校验#1',new Date('2026-10-27T01:49:01.000Z'))]});
 await f.run();
 const timing=await f.receipt('apply-timing.json');
 assert.deepEqual(timing.stages.map(s=>s.stage),['apply.validate#1']);
 assert.equal(timing.unexpectedLineCount,1);
 assert.deepEqual(timing.unexpectedLineSamples,[intruder]);
});
test('C 项第三步修复: a failing apply restores console.log and still fails the release',async t=>{
 const original=console.log;
 const f=await tailFixture(t,{apply:async()=>{console.log(preparationTimingLine('apply.validate#1',7,'failed','应用/批准轮换校验#1'));throw Error('apply 失败');}});
 await assert.rejects(f.run(),/apply 失败/);
 assert.equal(console.log,original,'恢复必须在 finally 里，否则失败的 apply 会留下替换过的 console.log');
 // Diagnostics must never turn a real failure into a receipt-shaped success.
 assert.ok(!f.written.includes('apply-timing.json'));
 assert.ok(!f.written.includes('WorkerApply-result.json'));
});
test('C 项第三步修复: a resume reusing WorkerApply writes no receipt at all',async t=>{
 // `once` is a continuation-reuse guard: with the label already completed the
 // operation does not run, so the interception and the write are both skipped by
 // structure rather than by an emptiness check. This is what keeps a resumed
 // publication from overwriting the original release's timing with zero stages.
 const f=await tailFixture(t,{completed:{WorkerApply:{status:'already_activated',releaseId:'20261027T000000Z-aaaabbbbccccdddd'},
  '启动服务':{status:'already_running',manifestSha256:'m'.repeat(64)},
  '结束前端排空':{status:'worker_drain_ended',maintenanceId:'maintenance-1'},
  '确认启动版本':{startupVerified:true}}});
 await f.run();
 assert.deepEqual(f.written,['SUCCESS.json']);
 await assert.rejects(fs.readFile(path.join(f.out,'apply-timing.json')),{code:'ENOENT'});
});
test('C 项第三步修复: the interception really crosses await import (console is one realm-level object)',async()=>{
 // The mechanism the landing point depends on: rotation is reached through
 // `await import`, and a replacement installed here must still catch its lines.
 const rotation=await import('../tools/worker-local-release-rotation.mjs');
 const captured=[],original=console.log;
 try{
  console.log=(...args)=>captured.push(args.join(' '));
  await rotation.timePreparationStage('apply.test','跨模块拦截验证',async()=>'value');
 }finally{console.log=original;}
 assert.equal(captured.length,1,'替换后的 console.log 必须捕获到动态 import 模块打出的计时行');
 assert.deepEqual(parseApplyTimingLines(captured).stages.map(s=>[s.stage,s.outcome]),[['apply.test','ok']]);
});
// Extract the body of the `once('WorkerApply', …)` operation by brace matching,
// so the assertion is about the real nesting rather than about two substrings
// happening to appear in the same file.
const workerApplyOperationBody=source=>{
 const start=source.indexOf("once('WorkerApply'");
 assert.notEqual(start,-1,'找不到 WorkerApply 的 once 调用');
 const open=source.indexOf('{',start);
 assert.notEqual(open,-1);
 let depth=0;
 for(let i=open;i<source.length;i+=1){
  if(source[i]==='{')depth+=1;
  else if(source[i]==='}'){depth-=1;if(depth===0)return source.slice(open,i+1);}
 }
 throw Error('WorkerApply operation 的括号不闭合');
};
test('C 项第三步修复: whatever function writes WorkerApply-result.json must write apply-timing.json too (structural)',async()=>{
 // This is the net the first attempt lacked. Every unit test there was green
 // while the collection sat on a dead path, because no test asked where it sat.
 // Pinning the two writes to the same operation means moving apply somewhere
 // else — the exact mistake being repaired — breaks a test instead of silently
 // dropping the receipt in production.
 const source=await fs.readFile(new URL('../tools/publish-main-tail.mjs',import.meta.url),'utf8');
 const body=workerApplyOperationBody(source);
 assert.ok(body.includes("save('WorkerApply-result.json'"),'操作回执必须仍在这个 operation 内');
 assert.ok(body.includes("save('apply-timing.json'"),'计时回执必须与 WorkerApply-result.json 同在一个 operation 内；它们分开就意味着落点又跑了');
 assert.ok(body.includes('console.log=')&&body.includes('finally{console.log=originalConsoleLog;}'),'拦截器及其 finally 恢复必须在同一 operation 内');
 // The parser must stay a dynamic import: a static one would widen the release
 // packet closure that main-publication-readiness.test.mjs pins.
 assert.ok(body.includes("await import('./publish-latest-main.mjs')"));
 assert.doesNotMatch(source,/^import .*publish-latest-main\.mjs/m);
 // The whole file must contain exactly one of each write, so the check above
 // cannot be satisfied by a second copy living elsewhere.
 assert.equal(source.split("save('apply-timing.json'").length-1,1);
 assert.equal(source.split("save('WorkerApply-result.json'").length-1,1);
});
test('C 项第三步修复: the structural assertion rejects a receipt moved off the landing point (negative test)',async()=>{
 // Mutations of the landing decision itself, not of the parser. Each is what the
 // defect being repaired actually looked like; the real source must differ from
 // all three.
 const source=await fs.readFile(new URL('../tools/publish-main-tail.mjs',import.meta.url),'utf8');
 // Mutant 1: the receipt write hoisted out of the operation (the first attempt's
 // shape — present in the file, absent from the live path).
 const hoisted=source.replace(/\n\s*try\{\n\s*const \{parseApplyTimingLines\}[\s\S]*?\n\s*\}catch\{\/\* diagnostic only \*\/\}/,'');
 assert.notEqual(hoisted,source,'变异 1 必须真的改到了落盘块，否则这条是空跑');
 assert.ok(!workerApplyOperationBody(hoisted).includes("save('apply-timing.json'"),'落盘移出 operation 后，结构断言必须不再成立');
 // Mutant 2: the interception's push removed — the window still exists but
 // collects nothing, so the receipt would ship with zero stages.
 const noPush=source.replace("try{applyTimingLines.push(args.join(' '));}catch{/* diagnostic only */}",'');
 assert.notEqual(noPush,source,'变异 2 必须真的改到了拦截器');
 assert.ok(!noPush.includes('applyTimingLines.push'),'去掉 push 后不应再有收集动作');
 // And the live tail must behave differently from that mutant: with a real
 // apply logging one stage, the receipt is not empty.
 assert.ok(source.includes('applyTimingLines.push'));
 // Mutant 3: restoring outside `finally` — a throwing apply would leak the
 // replacement into the rest of the process.
 const noFinally=source.replace('}finally{console.log=originalConsoleLog;}','}\n   console.log=originalConsoleLog;');
 assert.notEqual(noFinally,source);
 assert.ok(!noFinally.includes('finally{console.log=originalConsoleLog;}'));
 assert.ok(source.includes('finally{console.log=originalConsoleLog;}'));
});
