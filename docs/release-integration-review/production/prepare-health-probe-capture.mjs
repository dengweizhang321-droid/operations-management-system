// Prepare-only fixed source/Node/cwd. No production caller/Status/lock is run.
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFile,lstat,realpath,open,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const source='D:/.codex/worktrees/release-health-probe-contract/运营管理系统/docs/release-integration-review/health-probe-closeout';
const executable='C:/Program Files/nodejs/node.exe',cwd='D:/运营管理系统-sales-django-release';
const artifact='E:/codex-artifacts/release-integration-review-20261010/AB-health-probe-20261011-verified-final';
const audit='E:/codex-artifacts/release-integration-review-20261010/AB-health-probe-prepare-20261011-audit';
const sha=v=>createHash('sha256').update(v).digest('hex');
async function safe(p){p=path.resolve(p);let cursor=path.parse(p).root;for(const part of p.slice(cursor.length).split(path.sep).filter(Boolean)){cursor=path.join(cursor,part);const s=await lstat(cursor);assert.ok(!s.isSymbolicLink());if(cursor!==p)assert.ok(s.isDirectory());}assert.equal(path.resolve(await realpath(p)).toLowerCase(),p.toLowerCase());return p;}
async function read(p){await safe(p);const a=await lstat(p,{bigint:true});assert.ok(a.isFile()&&a.nlink===1n);const b=await readFile(p),c=await lstat(p,{bigint:true});for(const k of ['dev','ino','size','mtimeNs','ctimeNs','nlink'])assert.equal(a[k],c[k]);return b;}
async function absent(p){await safe(path.dirname(p));try{await lstat(p);throw new Error('Output exists');}catch(e){assert.equal(e.code,'ENOENT');}}
async function write(p,v){await safe(path.dirname(p));const h=await open(p,'wx');try{await h.writeFile(JSON.stringify(v,null,2)+'\n');await h.sync();}finally{await h.close();}}
export async function main(){
  await absent(artifact);await absent(audit);const reviewRaw=await read(path.join(source,'INDEPENDENT_REVIEW.json')),review=JSON.parse(reviewRaw);assert.equal(review.independent,true);assert.equal(review.acceptedHealthProbeCandidate,true);assert.equal(review.productionExecutionApproved,false);assert.deepEqual(review.blockingFindings,[]);
  const code=[['protocol.mjs','apiSha256'],['execute.mjs','callerSha256'],['runtime.mjs','runtimeSha256'],['prepare.mjs','sealerSha256'],['status-evidence.mjs','statusEvidenceSha256'],['health-contract.mjs','healthContractSha256'],['producer-evidence.mjs','producerEvidenceSha256'],['readonly-control.ps1','derivedControllerSha256'],['producer-functions.ps1','producerFunctionsSha256'],['derive-control.mjs','derivationSha256'],['copy-legacy.mjs','legacyGeneratorSha256']];
  const checked=[];for(const [name,key]of code){assert.match(review[key]??'',/^[a-f0-9]{64}$/);const actual=sha(await read(path.join(source,name)));assert.equal(actual,review[key]);checked.push({name,sha256:actual});}
  for(const name of ['release-readonly-retry.mjs','release-batch.mjs','release-batch-admission.mjs','collector.mjs']){const actual=sha(await read(path.join(source,'legacy',name)));assert.equal(actual,review.legacySha256[name]);checked.push({name:'legacy/'+name,sha256:actual});}assert.equal(checked.length,15);
  const executableSha256=sha(await read(executable)),sealer=path.join(source,'prepare.mjs'),args=[sealer,artifact,path.join(source,'INDEPENDENT_REVIEW.json')];await safe(cwd);await mkdir(audit);
  const out=await open(path.join(audit,'stdout.log'),'wx'),err=await open(path.join(audit,'stderr.log'),'wx'),startedAt=new Date().toISOString(),begin=performance.now();let child,result;
  try{child=spawn(executable,args,{cwd,windowsHide:true,stdio:['ignore',out.fd,err.fd]});const terminal=new Promise(resolve=>{child.once('error',e=>resolve({exitCode:null,signal:null,spawnErrorSha256:sha(String(e.message))}));child.once('close',(exitCode,signal)=>resolve({exitCode,signal}));});await write(path.join(audit,'started.json'),{startedAt,processId:child.pid,executable,executableSha256,args,cwd,reviewRawSha256:sha(reviewRaw),checked,productionExecuted:false});result=await terminal;}
  finally{await out.sync();await err.sync();await out.close();await err.close();}
  const stdout=await read(path.join(audit,'stdout.log')),stderr=await read(path.join(audit,'stderr.log')),finished={startedAt,finishedAt:new Date().toISOString(),processId:child.pid,elapsedMs:performance.now()-begin,...result,stdoutBytes:stdout.length,stdoutSha256:sha(stdout),stderrBytes:stderr.length,stderrSha256:sha(stderr),productionExecuted:false};await write(path.join(audit,'finished.json'),finished);console.log(JSON.stringify(finished));if(result.exitCode!==0)process.exitCode=1;return finished;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(JSON.stringify({errorType:e.name,messageSha256:sha(String(e.message)),productionExecuted:false}));process.exitCode=1;});
