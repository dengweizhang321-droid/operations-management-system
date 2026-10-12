import assert from 'node:assert/strict';import {hash,guardBinding} from './reconcile-no-wsl-guard-once.mjs';
export function assertGuardResumeState({names,events,active,maintenance,drain,expectedHead,proof,observations}){
 assert.equal(events.length,29);assert.deepEqual(names,events.map((_,i)=>String(i).padStart(6,'0')+'.json'));assert.match(expectedHead,/^[a-f0-9]{64}$/);
 let previous=null;const latest=new Map();for(const e of events){const{eventSha256,...core}=e;assert.equal(hash(core),eventSha256);assert.equal(e.previous,previous);assert.equal(e.batchSha256,guardBinding.batch);previous=eventSha256;if(e.operationId)latest.set(e.operationId,e);}
 assert.equal(events[27].eventSha256,guardBinding.head);assert.equal(events[27].status,'unknown');assert.equal(previous,expectedHead);
 const last=events[28];assert.equal(last.operationId,guardBinding.operation);assert.equal(last.status,'passed');assert.equal(last.reason,'independently-reconciled');assert.equal(last.outputs,undefined);assert.equal(last.receiptSha256,hash(proof));
 assert.equal(proof.independent,true);assert.equal(proof.noReplay,true);assert.equal(proof.batchSha256,guardBinding.batch);assert.equal(proof.operationId,guardBinding.operation);assert.equal(proof.intentSha256,'3cfd185f92d4bb3bb220dec721409f5e48d02462363d29d0e6341f6047dc7f74');assert.equal(proof.observationsSha256,hash(observations));
 assert.equal(observations.status,'passed');assert.equal(observations.branch,'fresh-no-running-wsl');assert.equal(observations.journalHead,guardBinding.head);assert.equal(observations.currentReferences,0);assert.equal(observations.preservationVerified,true);assert.equal(observations.productionWrites,0);
 assert.equal(observations.chain.successorCount,220);assert.equal(observations.chain.head.bindingSha256,'aec72f36e2718e853c3ca8d9f9790ecb8d01a141b43e7851f8f42979605ca66c');assert.equal(observations.chain.head.manifestSha256,'6cff8886e533244997b65d2a8668776cee5178b95e4e2a99ed14bd25bf2733f4');
 assert.equal(observations.liveAudit.status,'passed');assert.equal(observations.liveAudit.noWslDecision.mode,'no-running-wsl');assert.deepEqual(observations.liveAudit.references,[]);assert.deepEqual(observations.liveAudit.unknown,[]);
 assert.deepEqual([...latest.keys()],['op-prepare','backup-pre','op-entermaintenance-drain','op-stopworker-switch','op-apply','previous-reference-guard']);for(const e of latest.values())assert.equal(e.status,'passed');
 assert.equal(latest.get('op-apply').eventSha256,'c2f75a6e8ffbfe0635a02136c9d054917a70069fca9eee9479f135fbdbd22fd9');
 assert.deepEqual(active,{batchSha256:guardBinding.batch,id:guardBinding.id});
 for(const g of [maintenance,drain]){assert.equal(g.id,'a483894ad8d945298c866c74a06df6ff');assert.equal(g.keepPostgres,true);assert.equal(g.runtimeRoot,'D:\\teruisi-runtime\\django-sales');}
 assert.equal(maintenance.version,'teruisi-system-maintenance-v1');assert.equal(maintenance.drainedStopped,true);assert.equal(drain.version,'teruisi-automation-drain-v1');assert.equal(drain.phase,'requests');
 return {batchSha256:guardBinding.batch,head:previous,eventCount:29,passedOperations:[...latest.keys()],noUnknown:true};
}
