import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {decodeCopy,pgRowJson,tableRoot,redactedRow,CopyWitness,schemas} from './copy-witness.mjs';
const key=Buffer.alloc(32,19);
const hash=value=>createHash('sha256').update(value).digest();
function fixture({at='2026-10-10 05:44:20.123900+00'}={}){
  const lines=[],after={},before={};
  for(const[name,fields]of Object.entries(schemas)){
    const columns=fields.split(' '),values=columns.map(c=>
      ['version','revision','response_status'].includes(c)?'1':
      ['response_payload','metadata'].includes(c)?'{}':
      ['created_at','updated_at','completed_at','expires_at'].includes(c)?at:
      c==='deleted_at'?'\\N':
      ['body_sha256','query_sha256','source_digest'].includes(c)?'b'.repeat(64):
      c==='method'?'POST':c==='path'?'/api/workflow/tasks/synthetic-id':
      c==='status'?(name==='workflow_tasks'?'工作中':'completed'):
      c==='action'?'task.updated':c==='domain'?'workflow':'synthetic-id');
    after[name]={rows:1,sha256:tableRoot([hash(pgRowJson(columns,values.map(decodeCopy)))])};
    before[name]={rows:0,sha256:tableRoot([])};
    lines.push(`COPY public.${name} (${columns.join(', ')}) FROM stdin;`,values.join('\t'),'\\.');
  }
  return{lines,after,before};
}
function parse(f,cutoff='2026-10-10T05:44:20.123400Z'){
  const w=new CopyWitness({...f,cutoff,key});for(const l of f.lines)w.line(l);return w.finish();
}
test('manual PG row bytes retain physical key order, UTF8 strings, JSONB spaces and bigint tokens',()=>{
  const actual=pgRowJson(['actor_email','metadata','revision','created_at'],['合成\\行\t','{"短": 1, "nested": {"a": null}}','9007199254740993','2026-10-10 05:44:20.123456+00']);
  assert.equal(actual,'{"actor_email":"合成\\\\行\\t","metadata":{"短": 1, "nested": {"a": null}},"revision":9007199254740993,"created_at":"2026-10-10T05:44:20.123456+00:00"}');
});
test('32-byte binary sort is independent of text hex and preserves repeated row hashes',()=>{
  const a=Buffer.alloc(32),b=Buffer.alloc(32);a[0]=255;b[31]=255;
  assert.equal(tableRoot([a,b,b]),createHash('sha256').update(Buffer.concat([b,b,a])).digest('hex'));
});
test('COPY literal null, UTF8 byte octal and actual separator versus escape are distinct',()=>{
  assert.equal(decodeCopy('\\N'),null);assert.equal(decodeCopy('\\\\N'),'\\N');
  assert.equal(decodeCopy('甲\\t乙'),'甲\t乙');assert.equal(decodeCopy('\\344\\270\\255'),'中');
  assert.throws(()=>decodeCopy('\\xc0\\xaf'));assert.throws(()=>decodeCopy('x\\'));
});
test('physical column reordering cannot authenticate against unchanged original post root',()=>{
  const f=fixture();f.lines[0]=f.lines[0].replace('request_id, body_sha256','body_sha256, request_id');
  assert.throws(()=>parse(f),'Changed physical row bytes must fail full post authentication');
});
test('one post hash mismatch prevents a successful six-table result',()=>{
  const f=fixture();f.after.workflow_data_revisions.sha256='0'.repeat(64);assert.throws(()=>parse(f));
});
test('prefix agreement never declares mutable before or full comparison recovered',()=>{
  const f=fixture({at:'2026-10-10 04:00:00+00'});for(const n of Object.keys(f.before))f.before[n]={...f.after[n]};
  const r=parse(f);assert.ok(r.tables.market_write_request_receipts.prefixMatchesBefore);
  assert.equal(r.beforePayloadRecovered,false);assert.equal(r.fullComparisonClosed,false);
});
test('creation and mutation after cutoff within same millisecond must remain new/modified',()=>{
  const r=parse(fixture());assert.equal(r.tables.market_write_request_receipts.prefixRows,0);
  assert.equal(r.tables.market_write_request_receipts.newRows.length,1);
  assert.equal(r.tables.workflow_tasks.modifiedRows.length,1);
  assert.equal(r.cutoff,'2026-10-10T05:44:20.123400Z');
});
test('a numeric response identity must be rejected or HMACed, never persisted literally',()=>{
  let value;try{value=redactedRow({response_payload:'{"id":735791357,"taskId":246802468,"commentId":369121518}'},key);}catch{return;}
  const text=JSON.stringify(value);for(const secret of ['735791357','246802468','369121518'])assert.ok(!text.includes(secret),'Numeric identity escaped HMAC privacy boundary');
});
test('a permissively parseable free-form date with private annotation must be rejected',()=>{
  const synthetic='Sat, 10 Oct 2026 12:00:00 GMT (synthetic-private@example.invalid)';
  assert.ok(Number.isFinite(Date.parse(synthetic)));
  assert.throws(()=>redactedRow({response_payload:JSON.stringify({data:{createdAt:synthetic}})},key));
});
test('duplicate request identity refuses even when caller constructs matching duplicate root',()=>{
  const f=fixture();f.lines.splice(2,0,f.lines[1]);assert.throws(()=>parse(f));
});
