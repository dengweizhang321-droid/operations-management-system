import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {decodeCopy,timestamp,instantNs,pgRowJson,tableRoot,redactedRow,CopyWitness,schemas} from './copy-witness.mjs';
const sha=b=>createHash('sha256').update(b).digest();const key=Buffer.alloc(32,7);
test('COPY null and literal backslash N differ; tabs/control/UTF8 octal and hex survive',()=>{
  assert.equal(decodeCopy('\\N'),null);assert.equal(decodeCopy('\\\\N'),'\\N');assert.equal(decodeCopy('甲\\t乙\\n\\\\尾'),'甲\t乙\n\\尾');
  assert.equal(decodeCopy('\\303\\251'),'é');assert.equal(decodeCopy('\\xc3\\xa9'),'é');assert.equal(decodeCopy(''),'');
});
for(const value of ['bad\\','\\x','\\q','\\777','\\x00','\\xff'])test('invalid COPY escape/UTF8/NUL refuses '+JSON.stringify(value),()=>assert.throws(()=>decodeCopy(value)));
test('PG timestamp canonical rendering retains full microseconds and offset',()=>{
  assert.equal(timestamp('2026-10-10 05:44:20.123456+00'),'2026-10-10T05:44:20.123456+00:00');assert.equal(timestamp('2026-10-10 13:44:20+08:30'),'2026-10-10T05:14:20+00:00');assert.equal(timestamp('2026-10-10 13:44:20.123456+08'),'2026-10-10T05:44:20.123456+00:00');assert.throws(()=>timestamp('2026-10-10'));assert.throws(()=>timestamp('2026-10-10 00:00:00'));
});
test('PG physical order, raw JSONB formatting, null and exact integers have fixed JSON bytes',()=>{
  const actual=pgRowJson(['response_payload','revision','actor_email','created_at','deleted_at'],['{"a": 1, "b": null}','9007199254740993','甲@example.invalid','2026-10-10 05:44:20+00',null]);
  assert.equal(actual,'{"response_payload":{"a": 1, "b": null},"revision":9007199254740993,"actor_email":"甲@example.invalid","created_at":"2026-10-10T05:44:20+00:00","deleted_at":null}');assert.throws(()=>pgRowJson(['revision'],['+1']));assert.throws(()=>pgRowJson(['unknown'],['x']));
});
test('table root sorts binary digests and includes duplicates',()=>{
  const a=Buffer.alloc(32,1),b=Buffer.alloc(32,2);assert.equal(tableRoot([b,a,a]),createHash('sha256').update(Buffer.concat([a,a,b])).digest('hex'));assert.notEqual(tableRoot([a]),tableRoot([a,a]));assert.throws(()=>tableRoot([Buffer.alloc(31)]));
});
test('redaction never persists actor, title/comment/body, private key names or path IDs',()=>{
  const result=redactedRow({id:'private-id',actor_email:'private@example.invalid',title:'private-title',content:'private-comment',method:'POST',status:'completed',path:'/api/workflow/tasks/private-id/comments',response_payload:'{"private@example.invalid":null,"task":null,"tasks":[]}',metadata:'{"private@example.invalid":"private-comment","version":2,"changedFields":["status"]}'},key);
  const raw=JSON.stringify(result);for(const value of ['private-id','private@example.invalid','private-title','private-comment'])assert.ok(!raw.includes(value));assert.ok(result.nullResponseKeys.includes('task'));assert.ok(result.emptyArrayResponseKeys.includes('tasks'));assert.deepEqual(result.changedFields,['status']);
});
function fixture(){
  const lines=[],after={},before={};for(const [name,fields]of Object.entries(schemas)){
    const columns=fields.split(' '),values=columns.map(c=>['version','revision','response_status'].includes(c)?'1':['metadata','response_payload'].includes(c)?'{}':['created_at','updated_at','completed_at','expires_at'].includes(c)?'2026-10-10 06:00:00+00':c==='deleted_at'?'\\N':c==='status'?(name==='workflow_tasks'?'工作中':'completed'):['body_sha256','query_sha256','source_digest'].includes(c)?'a'.repeat(64):c==='method'?'POST':c==='path'?'/api/workflow/tasks/fake-id':c==='action'?'task.updated':c==='domain'?'workflow':'fake-id');
    const token=pgRowJson(columns,values.map(decodeCopy));after[name]={rows:1,sha256:tableRoot([sha(token)])};before[name]={rows:0,sha256:tableRoot([])};
    lines.push('COPY public.'+name+' ('+columns.join(', ')+') FROM stdin;',values.join('\t'),'\\.');
  }
  return {lines,after,before};
}
test('complete six-table fixture authenticates post profile and remains unclosed',()=>{const f=fixture(),w=new CopyWitness({...f,cutoff:'2026-10-10T05:00:00Z',key});for(const l of f.lines)w.line(l);const r=w.finish();assert.equal(r.fullComparisonClosed,false);assert.equal(r.beforePayloadRecovered,false);assert.equal(Object.keys(r.tables).length,6);assert.equal(r.tables.workflow_tasks.modifiedRows.length,1);});
for(const [name,mutate]of [
  ['tampered full post fingerprint',f=>f.after.workflow_tasks.sha256='0'.repeat(64)],
  ['missing table',f=>f.lines.splice(-3)],
  ['truncated COPY',f=>f.lines.pop()],
  ['duplicate table section',f=>f.lines.push(...f.lines.slice(0,3))],
  ['unknown table',f=>f.lines[0]=f.lines[0].replace('market_write_request_receipts','market_secret')],
  ['wrong physical column set',f=>f.lines[0]=f.lines[0].replace('request_id','unknown_id')],
  ['wrong arity',f=>f.lines[1]+='\textra'],
  ['duplicate row identity',f=>f.lines.splice(2,0,f.lines[1])],
])test(name,()=>{const f=fixture();mutate(f);const w=new CopyWitness({...f,cutoff:'2026-10-10T05:00:00Z',key});assert.throws(()=>{for(const l of f.lines)w.line(l);w.finish();});});
test('row and line limits are enforced',()=>{const f=fixture();const w=new CopyWitness({...f,cutoff:'2026-10-10T05:00:00Z',key,maxRows:1});assert.throws(()=>f.lines.forEach(l=>w.line(l)));const tiny=new CopyWitness({...f,cutoff:'2026-10-10T05:00:00Z',key,maxLineBytes:5});assert.throws(()=>tiny.line(f.lines[0]));});
test('submillisecond and .NET tick ordering do not collapse into milliseconds',()=>{assert.ok(instantNs('2026-10-10T05:00:00.123900Z')>instantNs('2026-10-10T05:00:00.123400Z'));assert.ok(instantNs('2026-10-10T05:00:00.123401Z')>instantNs('2026-10-10T05:00:00.1234008Z'));});
test('numeric IDs remain HMAC and permissive date prose is rejected',()=>{const r=redactedRow({response_payload:'{"id":123,"taskId":456,"commentId":789}'},key);assert.equal(typeof r.response_id,'string');assert.match(r.response_id,/^[a-f0-9]{64}$/);assert.throws(()=>redactedRow({response_payload:'{"data":{"createdAt":"10 Oct 2026 (synthetic-private@example.invalid)"}}'},key));});
