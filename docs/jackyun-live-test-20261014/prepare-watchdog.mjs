import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const repo=path.resolve(import.meta.dirname,'../..');
const out='D:/codex-artifacts/jackyun-live-test-20261014/watchdog-candidate-v1';
const old='D:/teruisi-runtime/operations-watchdog/versions/ff4e25622f243fbf733a5cca14eaf0fd2712e03514e4d5dec5bfeffbdfa9ccf0';
const hash=b=>createHash('sha256').update(b).digest('hex');
assert(!fs.existsSync(out),'Never replace an existing candidate');
const original=JSON.parse(fs.readFileSync(old+'/bundle.json','utf8'));
const binding=JSON.parse(fs.readFileSync(old+'/driver-binding.json','utf8'));
const sources={control:'D:/运营管理系统/tools/operations-system-control.ps1',worker:'D:/运营管理系统/tools/worker-local-service.ps1',transport:'D:/运营管理系统/tools/process-deadline.ps1',backend:'D:/teruisi-runtime/django-sales/app/tools/django-local-service.ps1',supervisor:'D:/teruisi-runtime/django-sales/app/tools/django-runtime-supervisor.ps1'};
const replacements={backend:'7e9a3a88421d4ba3c1c763e62677ab05f16e58ab9c686ff46f7491fa5a1a63fa',supervisor:'2f3dbfd4360ccb77c8d9e4ec31cacda59ec621b3123d50e4d0c681d9f4b8022a'};
const reviewedDeltas={};
for(const [name,file] of Object.entries(sources)){
 const bytes=fs.readFileSync(file);assert.equal(hash(bytes),replacements[name]??binding.assetHashes[name]);
 if(replacements[name]){
  const prior=fs.readFileSync(file.replace('/app/','/app.previous/'));
  assert.equal(hash(prior),binding.assetHashes[name]);
  const fn=name==='backend'?'Resolve-OwnedProcess':'Resolve-SupervisorProcess';
  const body=t=>{const a=t.indexOf('function '+fn),b=t.indexOf('\nfunction ',a+1);assert(a>=0&&b>a);return t.slice(a,b);};
  assert.equal(body(bytes.toString('utf8')),body(prior.toString('utf8')),'Ownership predicates must remain exact');
  reviewedDeltas[name]={prior:hash(prior),current:hash(bytes),ownershipBodyUnchanged:true};
 }
}
// Complete two-file diff reviewed: 17 audit-admission/preparation lines in backend;
// supervisor now rejects previous-version state, preserving the current strict gate.
fs.mkdirSync(out+'/watchdog-launcher',{recursive:true});
for(const [name,digest] of Object.entries(original.files)){
 const b=fs.readFileSync(old+'/'+name);assert.equal(hash(b),digest);
 if(name!=='driver-binding.json')fs.writeFileSync(out+'/'+name,b,{flag:'wx'});
}
Object.assign(binding.assetHashes,replacements);
fs.writeFileSync(out+'/driver-binding.json',JSON.stringify(binding,null,2)+'\n',{flag:'wx'});
const proof={binding,reviewedDeltas,allExecutableBytesIdenticalToInstalledBundle:true};
const files=Object.fromEntries(['operations-system-watchdog.ps1','process-deadline.ps1','watchdog-install.ps1','watchdog-launcher/NoConsoleLauncher.cs','Watchdog.NoConsole.exe','watchdog-status-control.ps1','watchdog-status-backend.ps1','watchdog-core-overlay.ps1','driver-binding.json'].map(n=>[n,hash(fs.readFileSync(out+'/'+n))]));
const result={out,files,proof,productionInstalled:false};
fs.writeFileSync(out+'/PREPARATION.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({out,files,binding:proof.binding}));
