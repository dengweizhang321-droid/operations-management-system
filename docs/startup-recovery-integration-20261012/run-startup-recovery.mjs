// Invoked only by a reviewed same-SID Administrator bootstrap holding all plan
// code/executable pins FileShare.Read. Built-ins run before any candidate import.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {spawn} from 'node:child_process';import {fileURLToPath,pathToFileURL} from 'node:url';
const own=path.dirname(fileURLToPath(import.meta.url));const sha=b=>createHash('sha256').update(b).digest('hex');
function bytes(p,expected){const a=fs.lstatSync(p,{bigint:true});assert(a.isFile()&&!a.isSymbolicLink());const system=path.resolve(p).toLowerCase()===path.resolve('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe').toLowerCase();assert.equal(a.nlink,system?2n:1n);if(system)assert.equal(expected,'7600ffe12da441fe89d035b13801e8e91d064bc544a27b19a5cf49f6ab8b18f5');const chain=[];for(let q=path.resolve(p);;q=path.dirname(q)){const s=fs.lstatSync(q,{bigint:true});assert(!s.isSymbolicLink());assert.equal(fs.realpathSync(q).toLowerCase(),q.toLowerCase());chain.push([q,s.dev,s.ino]);if(q===path.dirname(q))break;}const b=fs.readFileSync(p),z=fs.lstatSync(p,{bigint:true});for(const k of ['dev','ino','size','nlink','mtimeNs','ctimeNs'])assert.equal(a[k],z[k]);for(const [q,dev,ino]of chain){const s=fs.lstatSync(q,{bigint:true});assert(!s.isSymbolicLink());assert.equal(s.dev,dev);assert.equal(s.ino,ino);assert.equal(fs.realpathSync(q).toLowerCase(),q.toLowerCase());}assert.equal(sha(b),expected);return b;}
assert.equal(process.argv.length,4);const [planFile,planSha]=process.argv.slice(2);assert.match(planSha,/^[a-f0-9]{64}$/);assert(!Object.keys(process.env).some(k=>/^NODE_/i.test(k)));
assert(!Object.keys(process.env).some(k=>/^TERUISI_.*(?:LIBRARY_ONLY|FUNCTIONS_ONLY)$/i.test(k)),'Inherited library-only flags rejected');
const p=JSON.parse(bytes(planFile,planSha));assert(Array.isArray(p.pins));for(const f of p.pins)bytes(f.path,f.sha256);
function mustPin(needed,expected){const found=p.pins.filter(f=>path.resolve(f.path).toLowerCase()===path.resolve(needed).toLowerCase());assert.equal(found.length,1,'Missing or repeated source pin: '+needed);if(expected)assert.equal(found[0].sha256,expected);}
for(const name of ['recovery-context.mjs','startup-recovery-operations.psm1','Invoke-ApprovedStartupRecovery.ps1','run-startup-recovery.mjs','Restore-RecoverySupervisorV2.ps1','recovery-transport.mjs','prepare-approved-recovery-transport.mjs'])mustPin(path.join(own,name));
for(const name of ['startup-recovery-sequence.ps1','startup-exact-instance-stop.ps1','watchdog-native-metadata.ps1','process-deadline.ps1'])mustPin(path.resolve(own,'../../tools',name));
mustPin(path.resolve(own,'../../tools/startup-exact-instance-policy.mjs'),'0ab41f6eca96c4d60b5231508bf2abe455451cd5cb91f199b340add07ad9886c');
mustPin('D:/teruisi-runtime/django-sales/app/tools/django-local-service.ps1','95331de5035e8c7a284eb3a8508b547ff6511e3d712078822f2d74bd63087b1c');
mustPin('D:/teruisi-runtime/django-sales/app/tools/django-runtime-supervisor.ps1','85d2bdd121a415ff3a2e3e0c1edf208fc0ba2304444d7d3cc69cb71bcb533a11');
const context=await import(pathToFileURL(path.join(own,'recovery-context.mjs')));context.assertRecoveryPlan(p);context.validatedStopTargets(p);context.observeRecoveryContext(p,planSha,'preflight');
const boot=path.resolve(own,'../startup-status-receipt-safety-20261012/fence-original-bootstrap.mjs');const bootRaw=bytes(boot,'13e6700181cad60e7576cd60a8f523c36c935f734f63cae5f348f025a5c5de25');
const {bootstrapReconciliation}=await import('data:text/javascript;base64,'+bootRaw.toString('base64'));
const spec='E:/codex-artifacts/release-site-blockers-20261011/ADOPTION_BATCH_LIVE_V1.json';bytes(spec,'960c5c3e99da1f5cd7bacf57ae3aa0889fcecb9cd522d9165870560668c7678b');
const {api,verifyPins,spec:approvedSpec}=await bootstrapReconciliation(spec,context.fixed.batchSha256);
for(const f of approvedSpec.batch.operations.find(o=>o.id==='op-startworker-switch').command.files)mustPin(f.path,f.sha256);
const host='C:/Users/86137/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe';bytes(host,'362a356ce7f0940ec74f73a8fc2c990a2cc24a38a11c90bbd8eca947110ad139');
await api.withRotationLock(async()=>{
 await verifyPins();context.observeRecoveryContext(p,planSha,'preflight');
 const root=p.evidenceRoot;const stdout=fs.openSync(path.join(root,'RECOVERY_STDOUT.json'),'wx'),stderr=fs.openSync(path.join(root,'RECOVERY_STDERR.log'),'wx');
 try{
  const argv=['-NoProfile','-NonInteractive','-File',path.join(own,'Invoke-ApprovedStartupRecovery.ps1'),'-PlanPath',planFile,'-PlanSha256',planSha];
  const env={...process.env,TERUISI_PROCESS_DEADLINE_UNIX_MS:String(Date.now()+p.deadlineMs)};
  const child=spawn(host,argv,{cwd:root,env,windowsHide:true,stdio:['ignore',stdout,stderr]});
  const completion=new Promise(resolve=>{child.once('error',e=>resolve({exitCode:null,errorCode:e.code??'SPAWN_ERROR'}));child.once('close',(code,signal)=>resolve({exitCode:code,signal}));});
  fs.writeFileSync(path.join(root,'RECOVERY_STARTED.json'),JSON.stringify({at:new Date().toISOString(),processId:child.pid??null,planSha256:planSha,argv,originalBatchUnchanged:true})+'\n',{flag:'wx'});
  const result=await completion;
  fs.writeFileSync(path.join(root,'RECOVERY_FINISHED.json'),JSON.stringify({at:new Date().toISOString(),planSha256:planSha,...result,stdoutSha256:sha(fs.readFileSync(path.join(root,'RECOVERY_STDOUT.json'))),stderrSha256:sha(fs.readFileSync(path.join(root,'RECOVERY_STDERR.log')))})+'\n',{flag:'wx'});
  if(result.exitCode!==0)process.exitCode=1;
 }finally{fs.closeSync(stdout);fs.closeSync(stderr);}
});
