import test from 'node:test';
import assert from 'node:assert/strict';
import {knownResume,validateResumeReview} from '../tools/publish-main-known-resume.mjs';
const now=Date.parse('2026-10-16T17:30:00Z');
const valid=()=>({version:'manual-premaintenance-zero-effect-v1',maintenanceId:knownResume.maintenanceId,operationId:knownResume.operationId,mainCommit:knownResume.commit,failedSha256:knownResume.records['FAILED.json'],independentReview:true,maintenanceEffectsExcluded:true,observedAt:new Date(now-1000).toISOString()});
test('only the reviewed pre-maintenance failure can pass reconciliation admission',()=>{
 assert.doesNotThrow(()=>validateResumeReview(valid(),knownResume,now));
 for(const changed of [{maintenanceId:'0'.repeat(32)},{operationId:'0'.repeat(32)},{mainCommit:'0'.repeat(40)},{failedSha256:'0'.repeat(64)},{independentReview:false},{maintenanceEffectsExcluded:false}])assert.throws(()=>validateResumeReview({...valid(),...changed},knownResume,now));
});
test('old, invalid and future independent observations cannot authorize replay',()=>{
 for(const observedAt of ['invalid',new Date(now+1).toISOString(),new Date(now-30*60*1000).toISOString()])assert.throws(()=>validateResumeReview({...valid(),observedAt},knownResume,now));
});
