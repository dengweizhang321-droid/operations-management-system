import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root='D:/teruisi-runtime/operations-watchdog/versions/ceee38dabd66ea9cc77622679d35bf601367f0582ac00fcfe5074dc10940c940';
const out='D:/codex-artifacts/jackyun-live-test-20261014/watchdog-bounded-candidate';
const repo=path.resolve(import.meta.dirname,'../..'),sha=b=>createHash('sha256').update(b).digest('hex');
const oldTemplate=fs.readFileSync('D:/codex-isolated/jackyun-unbound-closure-source-20261014/tools/operations-system-watchdog.ps1','utf8');
const newTemplate=fs.readFileSync(repo+'/tools/operations-system-watchdog.ps1','utf8');
const segment=(s,start)=>{const a=s.indexOf(start),b=s.indexOf('function Invoke-WatchDws',a);assert(a>=0&&b>a);return s.slice(a,b);};
const previous=fs.readFileSync(root+'/operations-system-watchdog.ps1','utf8');
assert.equal(sha(previous),'1e651d0dc6d2a9cadd89f99989a047b5247c808908434ef1fb876b7ab26fdc05');
const oldPart=segment(previous,'function Get-WatchEvidence');
assert.equal(oldPart,segment(oldTemplate,'function Get-WatchEvidence'));
const newPart=segment(newTemplate,'function Get-WatchPostgresRecoveryTail');
const revised=previous.replace(oldPart,newPart);assert.equal(revised.replace(newPart,oldPart),previous);
fs.mkdirSync(out);fs.mkdirSync(out+'/watchdog-launcher');
const bundle=JSON.parse(fs.readFileSync(root+'/bundle.json','utf8')),files={};
for(const [name,digest] of Object.entries(bundle.files)){
 const original=fs.readFileSync(root+'/'+name);assert.equal(sha(original),digest);
 const bytes=name==='operations-system-watchdog.ps1'?Buffer.from(revised):original;
 fs.writeFileSync(out+'/'+name,bytes,{flag:'wx'});files[name]=sha(bytes);
}
fs.writeFileSync(out+'/PREPARATION.json',JSON.stringify({oldBundle:bundle.bundleId,files,onlyExecutableChange:'bounded ancillary PostgreSQL recovery evidence',oldPartSha256:sha(oldPart),newPartSha256:sha(newPart),sourceCommit:'553dc0a5',productionInstalled:false},null,2),{flag:'wx'});
console.log(JSON.stringify({out,changedFile:'operations-system-watchdog.ps1',sha256:files['operations-system-watchdog.ps1']}));
