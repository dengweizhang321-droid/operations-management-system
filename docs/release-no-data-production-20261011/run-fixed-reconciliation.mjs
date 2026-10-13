// External one-shot transport. Never overwrite logs or mutate the original package/spec.
import{readFile,writeFile,open}from'node:fs/promises';import{spawn}from'node:child_process';import{createHash}from'node:crypto';import assert from'node:assert/strict';
assert.equal(process.argv.length,4);assert.ok(!Object.keys(process.env).some(n=>/^NODE_/i.test(n)));
const raw=await readFile(process.argv[2]);assert.equal(createHash('sha256').update(raw).digest('hex'),process.argv[3]);const p=JSON.parse(raw);
assert.equal(p.version,'root-fixed-backup-reconciliation-v3');
const root='E:/codex-artifacts/release-site-blockers-20261011/production-f15d06a/reconciliation-v3/';
const out=await open(root+'STDOUT.log','wx'),err=await open(root+'STDERR.log','wx');
const startedAt=new Date().toISOString();await writeFile(root+'STARTED.json',JSON.stringify({startedAt,bindingSha256:process.argv[3]},null,2)+'\n',{flag:'wx'});
const child=spawn(process.execPath,[p.runner,p.proof.path,p.proof.sha256],{windowsHide:true,stdio:['ignore',out.fd,err.fd]});
const outcome=new Promise(resolve=>{child.once('error',e=>resolve({exitCode:null,errorCode:e.code??'spawn-error'}));child.once('close',exitCode=>resolve({exitCode,errorCode:null}));});
await writeFile(root+'DIRECT_PROCESS.json',JSON.stringify({processId:child.pid,startedAt},null,2)+'\n',{flag:'wx'});
const result=await outcome;await out.close();await err.close();await writeFile(root+'FINISHED.json',JSON.stringify({...result,startedAt,finishedAt:new Date().toISOString(),bindingSha256:process.argv[3]},null,2)+'\n',{flag:'wx'});process.exitCode=result.exitCode??1;
