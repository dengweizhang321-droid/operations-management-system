// Private source rows are read by this program only. Assertion values/messages
// are captured and hashed before Node's test reporter can print them.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {validateTransitions} from './transition-rules.mjs';
import {timestamp} from './copy-witness.mjs';
const privatePath='E:/codex-artifacts/release-integration-review-20261010/AB-source-witness-20261010-1139-final/private/transition-input-private.json';
const raw=await readFile(privatePath);
const input=JSON.parse(raw);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
console.log(JSON.stringify({privateInputSha256:sha(raw),rawRowsLogged:false,privateKeyRead:false}));
function outcome(value){
  try{return{accepted:true,result:validateTransitions(value)};}
  catch(error){return{accepted:false,errorType:error.name,messageSha256:sha(Buffer.from(error.message))};}
}
function changed(value){const old=new Map(value.beforeTasks.map(r=>[r.id,r]));return value.rows.workflow_tasks.filter(r=>r.status!==old.get(r.id)?.status);}
test('actual pinned private source evidence accepts with explicit historical limits',()=>{
  const r=outcome(input);assert.equal(r.accepted,true,r.messageSha256??'source evidence rejected');
  assert.equal(r.result.byteTransitionsConsistent,true);assert.equal(r.result.workflowWrites,4);
  assert.equal(r.result.changedTasks,3);assert.equal(r.result.unchangedTasks,87);
  assert.equal(r.result.marketIdleClaims,193);assert.equal(r.result.originalStrictEquality,false);
  assert.equal(r.result.authorizationIndependentlyProved,false);assert.equal(r.result.historicalSignedEnvelopesRecovered,false);
});
test('equivalent UTC timestamp representation is not a business field change',()=>{
  const v=structuredClone(input);for(const r of v.beforeTasks)for(const n of ['created_at','updated_at','deleted_at'])r[n]=r[n]===null?null:timestamp(r[n]).replace('T',' ');
  const r=outcome(v);assert.equal(r.accepted,true,r.messageSha256??'timezone representation rejected');
});
const negatives=[
  ['a fourth unrelated business title change',v=>{const old=new Map(v.beforeTasks.map(r=>[r.id,r]));const r=v.rows.workflow_tasks.find(r=>r.status===old.get(r.id).status&&r.version===old.get(r.id).version);r.title='synthetic unauthorized field';}],
  ['extra field on an intended status update',v=>changed(v)[0].category='synthetic extra category'],
  ['changed original creation timestamp',v=>changed(v)[0].created_at='2026-10-10 00:00:00+00'],
  ['task deletion hidden in the same row count',v=>changed(v)[0].deleted_at='2026-10-10 08:53:00+00'],
  ['task version jump beyond one',v=>changed(v)[0].version='4'],
  ['new mutation token equals the before token',v=>{const r=changed(v)[0];r.mutation_token=v.beforeTasks.find(b=>b.id===r.id).mutation_token;}],
  ['duplicated task identity',v=>v.rows.workflow_tasks[1].id=v.rows.workflow_tasks[0].id],
  ['workflow actor differs on one request',v=>v.rows.workflow_write_request_receipts[0].actor_email='synthetic wrong actor'],
  ['workflow request ID duplication',v=>v.rows.workflow_write_request_receipts[1].request_id=v.rows.workflow_write_request_receipts[0].request_id],
  ['PATCH body SHA differs',v=>v.rows.workflow_write_request_receipts.find(r=>r.method==='PATCH').body_sha256='0'.repeat(64)],
  ['PATCH query points outside the exact task',v=>v.rows.workflow_write_request_receipts.find(r=>r.method==='PATCH').query_sha256='0'.repeat(64)],
  ['completed receipt contains a mismatching full DTO',v=>{const r=v.rows.workflow_write_request_receipts.find(r=>r.method==='PATCH'),p=JSON.parse(r.response_payload);p.item.priority='synthetic priority';r.response_payload=JSON.stringify(p);}],
  ['comment content differs from its body and response binding',v=>v.rows.workflow_task_comments[0].content='synthetic altered comment'],
  ['activity refers to another task',v=>v.rows.workflow_task_activity_logs.find(r=>r.action==='task.status_changed').task_id='00000000-0000-4000-8000-000000000000'],
  ['activity metadata declares an unapproved field',v=>{const r=v.rows.workflow_task_activity_logs.find(r=>r.action==='task.status_changed'),p=JSON.parse(r.metadata);p.changedFields=['status','title'];r.metadata=JSON.stringify(p);}],
  ['revision final digest is invented',v=>v.rows.workflow_data_revisions[0].source_digest='0'.repeat(64)],
  ['market actor differs from the immutable internal runner',v=>v.rows.market_write_request_receipts[0].actor_email='synthetic wrong internal actor'],
  ['market body uses a different claim scope',v=>v.rows.market_write_request_receipts[0].body_sha256='0'.repeat(64)],
  ['market result actually has a job',v=>v.rows.market_write_request_receipts[0].response_payload='{"ok":true,"result":{"job":{"id":"synthetic"},"claims":[]}}'],
  ['market result has work claims',v=>v.rows.market_write_request_receipts[0].response_payload='{"ok":true,"result":{"job":null,"claims":[{"id":"synthetic"}]}}'],
  ['market duplicate request identity',v=>v.rows.market_write_request_receipts[1].request_id=v.rows.market_write_request_receipts[0].request_id],
];
for(const[name,mutate]of negatives)test(name,()=>{const v=structuredClone(input);mutate(v);const r=outcome(v);assert.equal(r.accepted,false,'Changed evidence must reject; no raw error is printed');});
