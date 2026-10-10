// Only the candidate's isolated ownership callback is evaluated. Production
// main/API/collector/lock are never invoked; unlink is an in-memory spy.
import test from 'node:test';import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';import vm from 'node:vm';
const source=await readFile(new URL('execute-exact-closeout.mjs',import.meta.url),'utf8');
const from=source.indexOf('async function releaseOwnership('),to=source.indexOf('\nconst result=',from);assert.ok(from>=0&&to>from);
const fn=source.slice(from,to);
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const sha=b=>createHash('sha256').update(b).digest('hex');
async function run(mutate=()=>{}){
  const active={batchSha256:'a'.repeat(64),id:'synthetic-original'},activeRaw=Buffer.from(canonical(active)+'\n'),head='b'.repeat(64),comparison={eventSha256:'c'.repeat(64),status:'unknown'},record={status:'completed-with-approved-exact-transitions'};
  const f={active,activeRaw,readRaw:activeRaw,state:{previous:head,events:[record],latest:new Map([['full-postgresql-deep-comparison',comparison]])},stats:[{dev:1n,ino:2n,size:BigInt(activeRaw.length),mtimeNs:3n,ctimeNs:4n,nlink:1n},{dev:1n,ino:2n,size:BigInt(activeRaw.length),mtimeNs:3n,ctimeNs:4n,nlink:1n}],unlinks:[],deleted:false,unlinkNoop:false,expectedActive:active,expectedHead:head};mutate(f);
  let statIndex=0;
  const context=vm.createContext({assert,sha,canonical,safe:async p=>p,lstat:async()=>{if(f.deleted)throw Object.assign(new Error('fixture absent'),{code:'ENOENT'});return f.stats[Math.min(statIndex++,1)];},readFile:async()=>f.readRaw,unlink:async p=>{f.unlinks.push(p);if(!f.unlinkNoop)f.deleted=true;},impact:{canonical,safeRead:async()=>f.activeRaw},engine:{journalState:async()=>f.state},spec:{journalRoot:'fixture-journal',batch:{id:'synthetic-original'}},api:{comparisonId:'full-postgresql-deep-comparison',originalHead:'c'.repeat(64)}});
  const callback=new vm.Script('('+fn+')').runInContext(context);let accepted=true,ack;try{ack=await callback({activePath:'fixture-active.json',expectedActive:f.expectedActive,expectedJournalHead:f.expectedHead});}catch{accepted=false;}return{accepted,unlinks:f.unlinks,ack};
}
test('exact owner, final head and original unknown delete only the requested active path',async()=>{const r=await run();assert.equal(r.accepted,true);assert.deepEqual(r.unlinks,['fixture-active.json']);assert.equal(r.ack.released,true);});
for(const[name,mutate]of [
  ['another active owner',f=>f.expectedActive={...f.active,id:'different-owner'}],
  ['journal head changed',f=>f.state.previous='d'.repeat(64)],
  ['uncompleted acceptance',f=>f.state.events[0].status='exact-transition-acceptance-passed'],
  ['original comparison rewritten passed',f=>f.state.latest.get('full-postgresql-deep-comparison').status='passed'],
  ['original comparison event replaced',f=>f.state.latest.get('full-postgresql-deep-comparison').eventSha256='e'.repeat(64)],
  ['active identity changed during CAS',f=>f.stats[1]={...f.stats[1],ino:8n}],
  ['active bytes changed after status',f=>f.readRaw=Buffer.from('synthetic-changed-active')],
])test(name,async()=>{const r=await run(mutate);assert.equal(r.accepted,false);assert.deepEqual(r.unlinks,[]);});
test('an unlink that leaves active present cannot return a released acknowledgment',async()=>{const r=await run(f=>f.unlinkNoop=true);assert.equal(r.accepted,false);assert.equal(r.ack,undefined);assert.deepEqual(r.unlinks,['fixture-active.json']);});
