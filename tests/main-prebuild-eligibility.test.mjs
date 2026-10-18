import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {assertOrdinaryPreparationContext,drainLatestMainQueue} from '../tools/publish-latest-main.mjs';
import {submitPreparation,ticketResult,canonical} from '../tools/main-prebuild-queue.mjs';
const hash=c=>c.repeat(64),target='a'.repeat(40);
test('the fixed read-only token probe accepts only unambiguous ordinary-user success',async()=>{
 await assertOrdinaryPreparationContext({}, {probe:async()=>({stdout:'False\r\n',stderr:''})});
 for(const sample of [{stdout:'True',stderr:''},{stdout:'false',stderr:''},{stdout:'',stderr:''},{stdout:'False',stderr:'probe failure'}])await assert.rejects(assertOrdinaryPreparationContext({}, {probe:async()=>sample}));
 await assert.rejects(assertOrdinaryPreparationContext({}, {probe:async()=>{throw Error('timeout');}}),/timeout/);
});
for(const failure of ['administrator','probe-error'])test(failure+' blocks before fetch/DISPATCH; a later ordinary ticket can continue',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'prebuild-admission-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const config={stateDirectory:root},binding={config,state:{configSha256:hash('b'),bundleSha256:hash('c')}},directory=path.join(root,'prebuild-queue-v2');let ordinary=false,observations=0,native=0;
 const options={binding,assertGeneration:async()=>{},assertConsumerIdentity:async()=>{},admit:()=>assertOrdinaryPreparationContext(config,{probe:async()=>{if(!ordinary&&failure==='probe-error')throw Error('private token query failed');return {stdout:ordinary?'False':'True',stderr:''};}}),observe:async()=>{observations++;return {targetCommit:target,packet:path.join(root,'packet'),live:{mainCommit:target,head:{bindingSha256:hash('d')},djangoManifestSha256:hash('e'),chainStateSha256:hash('f')}};},run:async()=>{native++;throw Error('Must never enter native preparation');}};
 const rejected=await submitPreparation(directory,{...binding.state,origin:'manual'});await drainLatestMainQueue('private-only',options);
 const result=await ticketResult(directory,rejected.requestId,rejected.ticketSha256);assert.equal(result.status,'blocked');assert.equal(result.admission,'ordinary-user-before-dispatch-v1');assert.equal(result.dispatchId,undefined);assert.equal(observations,0);assert.equal(native,0);assert.deepEqual(await fs.readdir(path.join(directory,'dispatches')),[]);
 const original=await fs.readFile(path.join(directory,'results',rejected.requestId+'.json'));ordinary=true;
 const later=await submitPreparation(directory,{...binding.state,origin:'manual'});await drainLatestMainQueue('private-only',options);
 assert.equal((await ticketResult(directory,later.requestId,later.ticketSha256)).status,'current');assert.equal(observations,1);assert.equal(native,0);assert.deepEqual(await fs.readFile(path.join(directory,'results',rejected.requestId+'.json')),original);
 const dispatchFiles=await fs.readdir(path.join(directory,'dispatches'));assert.equal(dispatchFiles.length,1);const dispatch=JSON.parse(await fs.readFile(path.join(directory,'dispatches',dispatchFiles[0])));assert.deepEqual(dispatch.tickets.map(value=>value.requestId),[later.requestId]);
});
test('a ticket with an actual dispatch cannot be downgraded into admission-blocked',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'prebuild-admission-proof-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const binding={configSha256:hash('b'),bundleSha256:hash('c')},item=await submitPreparation(root,{...binding,origin:'manual'}),dispatchId=randomUUID();
 const dispatch={version:'teruisi-main-prebuild-queue-v2',dispatchId,requestId:item.requestId,mode:'prepare-only',...binding,selectedTarget:target,dispatchedAt:new Date().toISOString(),deadlineUnixMs:Date.now()+30000,selection:{targetCommit:target,packet:path.join(root,'packet'),live:{mainCommit:target,head:{bindingSha256:hash('d')},djangoManifestSha256:hash('e'),chainStateSha256:hash('f')}},tickets:[{requestId:item.requestId,ticketSha256:item.ticketSha256,observedTarget:null}]};
 await fs.writeFile(path.join(root,'dispatches',dispatchId+'.json'),canonical(dispatch));
 await fs.writeFile(path.join(root,'results',item.requestId+'.json'),canonical({version:'teruisi-main-prebuild-queue-v2',requestId:item.requestId,ticketSha256:item.ticketSha256,status:'blocked',admission:'ordinary-user-before-dispatch-v1',error:'forged pre-dispatch rejection',at:new Date().toISOString(),...binding}));
 await assert.rejects(ticketResult(root,item.requestId,item.ticketSha256),/dispatched ticket/);
});
