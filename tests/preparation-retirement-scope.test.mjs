import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {withRetirementReadScope,assertRetirementReadScope,assertRetirementReadScopeRegistry,invalidateRetirementReadScope} from '../tools/preparation-retirement.mjs';
import {assertRetirementAdmission,retirementIntentVersion,retirementBanVersion} from '../tools/preparation-retirement-admission.mjs';
import {canonical,sha,submitPreparation,drainPreparationQueue,ticketResult} from '../tools/main-prebuild-queue.mjs';
import {observeLatestMain,prepareLatestMainOnce} from '../tools/publish-latest-main.mjs';
const target='a'.repeat(40);
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'s05d-retirement-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const config={stateDirectory:path.join(root,'state'),repository:path.join(root,'repo'),releaseDirectory:path.join(root,'packets')};await fs.mkdir(config.stateDirectory);return {root,config};}
async function addIntent(config){const dispatchId=randomUUID(),root=path.join(config.stateDirectory,'preparation-retirements',dispatchId);await fs.mkdir(root,{recursive:true});const intent={version:retirementIntentVersion,binding:{dispatchId,selectedTarget:target}},raw=canonical(intent);await fs.writeFile(path.join(root,'INTENT.json'),raw);await fs.writeFile(path.join(root,'TARGET-BAN.json'),canonical({version:retirementBanVersion,intentSha256:sha(Buffer.from(raw)),selectedTarget:target,forbidTargetReplay:true}));}

test('opaque scope binds even empty registry, survives dirty without identity migration, and rejects forged/closed/config-drift tokens',async t=>{
 const {config}=await fixture(t);let closed;
 await withRetirementReadScope(config,async scope=>{closed=scope;assert.equal(Object.getPrototypeOf(scope),null);assert.equal(Object.keys(scope).length,0);assert.equal(assertRetirementReadScope(scope,config),true);assert.equal(await assertRetirementAdmission(config,undefined,{scope}),true);});
 assert.throws(()=>assertRetirementReadScope(closed,config),/closed/);assert.throws(()=>assertRetirementReadScope({},config),/Unknown/);
 await assert.rejects(withRetirementReadScope(config,async scope=>{await addIntent(config);invalidateRetirementReadScope(scope,'private-new-registry');await assertRetirementReadScopeRegistry(scope,config);}),/registry\/evidence set changed/);
 await assert.rejects(withRetirementReadScope(config,scope=>{assertRetirementReadScope(scope,{...config,repository:config.repository+'-other'});}),/configuration changed/);
});

test('empty registry concurrency, cancellation and non-awaited reads drain without late success or scope revival',async t=>{
 const {config}=await fixture(t);
 await assert.rejects(withRetirementReadScope(config,async scope=>{const first=assertRetirementReadScopeRegistry(scope,config);first.catch(()=>{});assert.throws(()=>assertRetirementReadScopeRegistry(scope,config),/Concurrent/);await first;}),/Concurrent|failed/);
 let pending;
 await assert.rejects(withRetirementReadScope(config,scope=>{pending=assertRetirementReadScopeRegistry(scope,config);pending.catch(()=>{});}),/not awaited/);assert.equal((await Promise.allSettled([pending]))[0].status,'rejected');
 const controller=new AbortController();await assert.rejects(withRetirementReadScope(config,async scope=>{const read=assertRetirementReadScopeRegistry(scope,config);read.catch(()=>{});controller.abort();await read;},{signal:controller.signal}),/failed|cancel/);
 let late;
 await assert.rejects(withRetirementReadScope(config,async scope=>{const read=assertRetirementReadScopeRegistry(scope,config);read.catch(()=>{});invalidateRetirementReadScope(scope,'private-inflight-invalidate');late=await Promise.allSettled([read]);assert.equal(late[0].status,'rejected');}),/changed during validation/);
});

test('real publisher fetch and queue mutation/next-target/unlock routes invalidate without creating a source or changing old unknown behavior',async t=>{
 const {root,config}=await fixture(t);const live={mainCommit:target,source:path.join(root,'current'),head:{bindingSha256:'1'.repeat(64)},djangoManifestSha256:'2'.repeat(64),chainStateSha256:'3'.repeat(64)};
 await withRetirementReadScope(config,async scope=>{const selected=await observeLatestMain(config,{retirementScope:scope,git:async(cwd,args)=>args[0]==='fetch'?'':target,getLive:async()=>live});assert.equal((await prepareLatestMainOnce(config,selected,{retirementScope:scope})).status,'already-current');});await assert.rejects(fs.stat(config.releaseDirectory),{code:'ENOENT'});
 const queue=path.join(root,'queue'),binding={configSha256:'4'.repeat(64),bundleSha256:'5'.repeat(64)},ticket=await submitPreparation(queue,{...binding,origin:'manual'}),events=[];let native=0;
 const selected={targetCommit:target,packet:path.join(root,'private-packet'),live};
 await assert.rejects(drainPreparationQueue(queue,{...binding,retirementScope:{},observe:async()=>selected,prepare:()=>assert.fail('missing invalidator must reject before native')}),/explicit invalidation callback/);
 await drainPreparationQueue(queue,{...binding,invalidateRetirementScope:async reason=>{events.push(reason);},observe:async()=>selected,prepare:async()=>{native++;throw Error('private native unknown');}});
 assert.equal((await ticketResult(queue,ticket.requestId,ticket.ticketSha256)).status,'unknown');for(const name of ['queue-initialize','queue-dispatch-write','queue-native-prepare','queue-terminal-write','queue-next-target','queue-unlock'])assert.ok(events.includes(name),name);
 const next=await submitPreparation(queue,{...binding,origin:'manual'});await drainPreparationQueue(queue,{...binding,observe:()=>assert.fail('unknown must block'),prepare:()=>assert.fail('unknown must never retry')});assert.equal(native,1);assert.equal((await ticketResult(queue,next.requestId,next.ticketSha256)).status,'blocked');
});
