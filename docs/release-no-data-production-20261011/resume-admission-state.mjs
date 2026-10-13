import assert from'node:assert/strict';import{createHash}from'node:crypto';
const canonical=v=>Array.isArray(v)?`[${v.map(canonical).join(',')}]`:v&&typeof v==='object'?`{${Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')}}`:JSON.stringify(v);
const sha=v=>createHash('sha256').update(canonical(v)).digest('hex');
export const BATCH='f15d06a159073927ba3565712027aa645869333a3210c54e1858738756ca110f';
export function assertKnownInitialAdmissionState({names,events,active,maintenance,drain,finished,direct,oldProcessPresent}){
 assert.deepEqual(names,['000000.json','000001.json']);assert.equal(events.length,2);
 let previous=null;for(const [i,e]of events.entries()){const {eventSha256,...core}=e;assert.equal(sha(core),eventSha256);assert.equal(e.previous,previous);assert.equal(e.batchSha256,BATCH);assert.equal(e.operationId,undefined);assert.equal(e.status,i===0?'approved':'admission-failed');previous=eventSha256;}
 assert.equal(previous,'d6335eaa2fc58aed0fa4dfb29203e2f0e442f0e13497d9f61a100e0f5585f887');
 assert.deepEqual(active,{batchSha256:BATCH,id:'first-adoption-live-guard-20261011'});assert.equal(maintenance,null);assert.equal(drain,null);
 assert.equal(finished.batchSha256,BATCH);assert.equal(finished.exitCode,1);assert.equal(finished.status,'entry-failed-preserve-owner-gates-wal');assert.equal(direct.batchSha256,BATCH);assert.equal(direct.processId,52540);assert.equal(oldProcessPresent,false);
 return {batchSha256:BATCH,journalHead:previous,events:2,operationsStarted:0,ownerUnchanged:true,gatesAbsent:true,oldProcessAbsent:true};
}
