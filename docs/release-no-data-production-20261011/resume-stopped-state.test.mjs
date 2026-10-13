// Synthetic post-reconciliation event/administrator DTO; no live collector or production calls.
import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {digest,fixed} from './reconcile-backup-once.mjs';import {stopFixed} from './stop-reconciliation-state.mjs';import {assertStoppedResumeState} from './resume-stopped-state.mjs';
const prefix=JSON.parse(await readFile('E:/codex-artifacts/release-site-blockers-20261011/production-f15d06a/STOP_TEST_WAL_19.json'));
const baseline=JSON.parse(await readFile('E:/codex-artifacts/release-site-blockers-20261011/production-f15d06a/STOP_BASELINE.stdout.json'));
function fixture(){
 const observations={intentSha256:'3f645b69942d5b77fff3d3ed368ee51a5b671b4a2f9e0a324ddd150896d029c6',unknownEventSha256:stopFixed.head,fixtureOnly:true};
 const proof={independent:true,noReplay:true,batchSha256:fixed.batch,operationId:stopFixed.operation,intentSha256:observations.intentSha256,observationsSha256:digest(observations)};
 const core={at:'2026-10-12T00:00:00Z',batchSha256:fixed.batch,previous:stopFixed.head,operationId:stopFixed.operation,phase:'switch',status:'passed',reason:'independently-reconciled',receiptSha256:digest(proof)};
 const last={...core,eventSha256:digest(core)},events=[...structuredClone(prefix),last],native=structuredClone(baseline.native);native.receipt.administrator=true;
 return {observations,proof,events,native,names:events.map((_,i)=>String(i).padStart(6,'0')+'.json'),expectedHead:last.eventSha256,active:{batchSha256:fixed.batch,id:stopFixed.id},maintenance:structuredClone(baseline.maintenance.value),drain:structuredClone(baseline.drain.value)};
}
test('synthetic exact twenty-event state with four passed operations',()=>assert.deepEqual(assertStoppedResumeState(fixture()).passedOperations,['op-prepare','backup-pre','op-entermaintenance-drain','op-stopworker-switch']));
for(const[name,change]of [
 ['missing one required PID',v=>v.native.receipt.missing.pop()],
 ['kernel absence denied',v=>v.native.receipt.missing[0].error=5],
 ['old Backup PID substituted',v=>v.native.receipt.missing[0].pid=14972],
 ['ordinary role',v=>v.native.receipt.administrator=false],
 ['wrong PostgreSQL listener',v=>v.native.receipt.ports[0].pid=99],
 ['observation content changed',v=>v.observations.fixtureOnly=false],
 ['unknown expected WAL head',v=>v.expectedHead='0'.repeat(64)],
 ])test('reject '+name,()=>{const v=fixture();change(v);assert.throws(()=>assertStoppedResumeState(v));});
test('both gates require exact versions and runtime roots',()=>{for(const key of ['maintenance','drain'])for(const field of ['version','runtimeRoot']){const v=fixture();v[key][field]='other';assert.throws(()=>assertStoppedResumeState(v));}});
test('recomputed observation/proof/event cannot change fixed unknown predecessor or intent',()=>{for(const field of ['unknownEventSha256','intentSha256']){const v=fixture();v.observations[field]='0'.repeat(64);v.proof.observationsSha256=digest(v.observations);v.events[19].receiptSha256=digest(v.proof);const{eventSha256,...core}=v.events[19];v.events[19].eventSha256=digest(core);v.expectedHead=v.events[19].eventSha256;assert.throws(()=>assertStoppedResumeState(v));}});
