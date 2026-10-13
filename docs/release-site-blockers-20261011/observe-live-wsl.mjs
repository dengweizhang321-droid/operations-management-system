import {readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {validateLiveGuestShape} from './live-wsl-policy.mjs';
const source=await readFile(new URL('./collect-live-wsl.py',import.meta.url));
const hash=v=>createHash('sha256').update(v).digest('hex');
function run(args,input){const r=spawnSync('C:/Windows/System32/wsl.exe',args,{input,windowsHide:true,timeout:30000,maxBuffer:8*1024*1024});assert.equal(r.error,undefined);assert.equal(r.status,0);return r.stdout;}
function list(){const b=run(['--list','--running','--quiet']);return b.toString(b.includes(0)?'utf16le':'utf8').replace(/^\uFEFF/,'').trim().split(/[\r\n]+/).filter(Boolean).sort();}
const before=list();assert.deepEqual(before,['TERUISI-Pandas']);
const capture=JSON.parse(run(['--distribution','TERUISI-Pandas','--user','root','--exec','/usr/bin/python3','-I','-S','-'],source));
const after=list();let failure=null,checked=null;
try{assert.deepEqual(after,before);checked=validateLiveGuestShape(capture);}catch(error){failure={message:error.message};}
// Preserve only kernel mount metadata and redacted summaries. Never persist
// cmdline/cwd/fd strings; the real guard consumes those only in memory.
const record={version:'astra-live-guest-first-observation-v1',at:new Date().toISOString(),sourceSha256:hash(source),before,after,epochBefore:capture.before,epochAfter:capture.after,namespaces:capture.namespaces,processCount:capture.processes.length,pidMembershipEqual:JSON.stringify(capture.pidInventoryBefore)===JSON.stringify(capture.pidInventoryAfter),errors:capture.errors,status:failure?'blocked':'guest-shape-only-verified',failure,kind:checked?.kind,rawProcessMetadataPersisted:false,nativeHostCalls:0,productionActions:0};
await writeFile('E:/codex-artifacts/release-site-blockers-20261011/ASTRA_LIVE_GUEST_FIRST_OBSERVATION.json',JSON.stringify(record,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({...record,namespaces:record.namespaces.map(n=>({identity:n.identity,sha256:hash(n.mountinfo)}))},null,2));
