// Read-only monitor: independently recompute this exact WAL; no engine import or mutation.
import{readFile,readdir,lstat}from'node:fs/promises';import{createHash}from'node:crypto';import path from'node:path';import assert from'node:assert/strict';
const batch='f15d06a159073927ba3565712027aa645869333a3210c54e1858738756ca110f',root='D:/teruisi-runtime/teruisi-worker-sales/state/release-batches';
const canonical=v=>Array.isArray(v)?`[${v.map(canonical).join(',')}]`:v&&typeof v==='object'?`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`:JSON.stringify(v);
const hash=v=>createHash('sha256').update(v).digest('hex');
async function optional(file){try{const s=await lstat(file);assert.ok(!s.isSymbolicLink()&&s.isFile()&&s.nlink===1);return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
const stateDir=path.join(root,'first-adoption-live-guard-20261011');let names=[];try{names=(await readdir(stateDir)).filter(n=>/^\d{6}\.json$/.test(n)).sort();}catch(e){if(e.code!=='ENOENT')throw e;}
const events=[];let previous=null;for(const [i,n]of names.entries()){assert.equal(n,String(i).padStart(6,'0')+'.json');const e=await optional(path.join(stateDir,n)),{eventSha256,...core}=e;assert.equal(hash(canonical(core)),eventSha256);assert.equal(e.previous,previous);assert.equal(e.batchSha256,batch);previous=eventSha256;events.push(e);}
const latest=new Map();for(const e of events)if(e.operationId)latest.set(e.operationId,e);
const states={active:await optional(path.join(root,'active.json')),maintenance:await optional('D:/teruisi-runtime/django-sales/run/system-maintenance.json'),drain:await optional('D:/teruisi-runtime/django-sales/run/automation-drain.json')};
const finished=await optional('E:/codex-artifacts/release-site-blockers-20261011/production-f15d06a/resume2/FINISHED.json');
console.log(JSON.stringify({observedAt:new Date().toISOString(),events:events.length,journalHead:previous,latest:events.at(-1)??null,operations:[...latest.values()].map(e=>({id:e.operationId,status:e.status,at:e.at,durationMs:e.durationMs,reason:e.reason})),states,finished}));
