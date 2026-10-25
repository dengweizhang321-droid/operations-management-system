import fs from 'node:fs/promises';
import crypto from 'node:crypto';
const base='D:/codex-artifacts/s05d-field-validation-20261023';
const docs='D:/codex-worktrees/s05d-field-validation-20261023/docs/s05d-field-validation-20261023';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const prefix=base+'/snapshot-ad9b8dca-9705-491c-8a0a-af8a2e3b2d39';
const raw=await fs.readFile(prefix+'.result.json'),result=JSON.parse(raw);
await fs.writeFile(docs+'/four-object-result.json',raw,{flag:'wx'});
const entries=[];
const files=[base+'/inspect-code-5f1cef12-2d2a-41fc-bf95-7762e7eb349f/PINS.json',...['result.json','progress.jsonl','stages.jsonl'].map(n=>base+'/inspect-3aebf329-c821-457f-8de6-1979a3546e3c.'+n),...['result.json','progress.jsonl','stages.jsonl'].map(n=>prefix+'.'+n),...result.objects.map(x=>x.snapshotFile)];
for(const file of files){const st=await fs.stat(file);if(st.size>64*1024*1024)throw Error('Evidence bound');const bytes=await fs.readFile(file);entries.push({path:file,bytes:bytes.length,sha256:hash(bytes)});}
const memory=(await fs.readFile(prefix+'.progress.jsonl','utf8')).trim().split('\n').map(JSON.parse);
const evidence={at:new Date().toISOString(),readOnly:true,candidateCommit:'9925e6ac0a616f7c83c710f2a98993a7a58dad42',globalClosureSucceeded:false,fourObjectReadComplete:result.complete,totalItems:result.objects.reduce((n,r)=>n+r.files,0),logicalBytes:result.objects.reduce((n,r)=>n+r.bytes,0),elapsedMs:result.elapsedMs,uniformSnapshotCasMs:result.uniformSnapshotCasMs,sampledPeakRss:Math.max(...memory.map(x=>x.rss)),pinsUnchanged:result.pinsUnchanged,productionGateProved:false,entries};
await fs.writeFile(docs+'/evidence.json',JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({...evidence,entries:entries.length}));
