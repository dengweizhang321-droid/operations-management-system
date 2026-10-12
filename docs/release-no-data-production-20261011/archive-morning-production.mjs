// Preserve closed operator artifacts, code/review evidence and sanitized WAL; no runtime writes.
import {readFile,writeFile,mkdir,lstat} from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
const base='E:/codex-artifacts/release-site-blockers-20261011/production-f15d06a/',out='docs/release-no-data-production-20261011/evidence/morning-production/',sha=b=>createHash('sha256').update(b).digest('hex'),entries=[];
async function archive(source,target,expected){const s=await lstat(source);assert.ok(s.isFile()&&!s.isSymbolicLink()&&s.nlink===1);const raw=await readFile(source);if(expected)assert.equal(sha(raw),expected);const destination=path.join(out,target);await mkdir(path.dirname(destination),{recursive:true});await writeFile(destination,raw,{flag:'wx'});entries.push({source,target,bytes:raw.length,sha256:sha(raw)});}
const indexPath=base+'NO_WSL_REVIEW_ARCHIVE_MANIFEST_V1.json',index=JSON.parse(await readFile(indexPath));
for(const e of index.entries)await archive(base+e.name,'no-wsl-review/'+e.name,e.sha256);
await archive(indexPath,'no-wsl-review/INDEX.json');
for(const n of ['BOOTSTRAP_BINDING_V1.json','BOOTSTRAP_V1.ps1','CHAIN_BINDING_V1.json','CAPTURE_NORMAL.ps1','ADMIN_DISPATCHED_V2.json','UAC_CANCELLED_V1.json','ENV_RESTORED.json','STARTED.json','DIRECT_PROCESS.json','FINISHED.json','CHAIN_FINISHED.json','STDOUT.log','STDERR.log'])await archive(base+'resume4/'+n,'resume4/'+n);
for(const n of ['CONTROL_NORMAL.stdout.json','CONTROL_NORMAL.stderr.log','CONTROL_NORMAL.exit.json'])await archive(base+'startup-diagnostic1/'+n,'startup-diagnostic1/'+n);
const wal='D:/teruisi-runtime/teruisi-worker-sales/state/release-batches/first-adoption-live-guard-20261011/';
for(let i=0;i<49;i++){const n=String(i).padStart(6,'0')+'.json';await archive(wal+n,'wal-49/'+n);}
await archive('D:/teruisi-runtime/teruisi-worker-sales/state/release-batches/active.json','active.json');
await writeFile(out+'MANIFEST.json',JSON.stringify({at:new Date().toISOString(),status:'start-full-readiness-unresolved',productionComplete:false,entries},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({archived:entries.length,manifestSha256:sha(await readFile(out+'MANIFEST.json')),productionComplete:false}));
