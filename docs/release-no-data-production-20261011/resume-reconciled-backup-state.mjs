import assert from 'node:assert/strict';
import {fixed,canonical,digest,reconciliationEvent} from './reconcile-backup-once.mjs';
export function assertReconciledBackupState({names,events,active,maintenance,drain,processesAbsent,expectedHead,proof}){
 assert.match(expectedHead,/^[0-9a-f]{64}$/);assert.equal(events.length,11);assert.deepEqual(names,events.map((_,i)=>String(i).padStart(6,'0')+'.json'));
 let previous=null;const latest=new Map();for(const event of events){const{eventSha256,...core}=event;assert.equal(event.batchSha256,fixed.batch);assert.equal(event.previous,previous);assert.equal(digest(core),eventSha256);previous=eventSha256;if(event.operationId)latest.set(event.operationId,event);}
 assert.equal(events[9].eventSha256,fixed.head);assert.equal(events[9].status,'unknown');assert.equal(previous,expectedHead);
 const outputs={backupDirectory:fixed.directory,backupId:fixed.backupId,manifestSha256:fixed.manifestSha,dumpSha256:fixed.dumpSha,contentSha256:fixed.contentSha};
 assert.deepEqual(events[10],reconciliationEvent(outputs,proof,events[10].at));
 assert.deepEqual([...latest.keys()],['op-prepare','backup-pre']);assert.equal(latest.get('op-prepare').eventSha256,'249b4b9797b5ec4069e722d2f9f2ca725c7278af32ce3b8609ef46e9de198196');
 for(const event of latest.values())assert.equal(event.status,'passed');
 assert.deepEqual(active,{batchSha256:fixed.batch,id:'first-adoption-live-guard-20261011'});assert.equal(maintenance,null);assert.equal(drain,null);assert.deepEqual(processesAbsent,[14972,36576]);
 return {batchSha256:fixed.batch,head:previous,eventCount:11,passedOperations:[...latest.keys()],noUnknown:true};
}
