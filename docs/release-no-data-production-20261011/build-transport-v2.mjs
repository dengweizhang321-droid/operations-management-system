import{readFile,writeFile}from'node:fs/promises';import assert from'node:assert/strict';
const d=new URL('./',import.meta.url);let s=await readFile(new URL('run-approved-batch.mjs',d),'utf8');
const line="const child=spawn(process.execPath,argv,{windowsHide:true,stdio:['ignore',out.fd,err.fd]});";
assert.ok(s.includes(line));s=s.replace(line,line+"\nconst outcome=new Promise(resolve=>{child.once('error',error=>resolve({exitCode:null,errorCode:error.code??'spawn-error'}));child.once('close',exitCode=>resolve({exitCode,errorCode:null}));});");
const old="const exitCode=await new Promise((res,rej)=>{child.once('error',rej);child.once('close',res);});";assert.ok(s.includes(old));s=s.replace(old,'const {exitCode,errorCode}=await outcome;').replace('startedAt,finishedAt,exitCode,status:','startedAt,finishedAt,exitCode,errorCode,status:');
await writeFile(new URL('run-approved-batch-v2.mjs',d),s,{flag:'wx'});
let p=await readFile(new URL('prepare-approved-entry.mjs',d),'utf8');p=p.replace('run-approved-batch.mjs','run-approved-batch-v2.mjs').replaceAll('TRANSPORT_BINDING.json','TRANSPORT_BINDING_V2.json').replaceAll('BOOTSTRAP.ps1','BOOTSTRAP_V2.ps1').replaceAll('BOOTSTRAP_BINDING.json','BOOTSTRAP_BINDING_V2.json');
const approvalWrite="await writeFile(root+'APPROVAL.json',approvalRaw,{flag:'wx'});";assert.ok(p.includes(approvalWrite));p=p.replace(approvalWrite,"assert.ok((await readFile(root+'APPROVAL.json')).equals(approvalRaw));");
await writeFile(new URL('prepare-approved-entry-v2.mjs',d),p,{flag:'wx'});
