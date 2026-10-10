// Preparation only. Fixed reviewed sealer; never invokes a production caller.
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFile,lstat,open,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
const source='D:/.codex/worktrees/release-ab-ui-acceptance/运营管理系统/docs/release-integration-review/final-readiness-supplement';
const executable='C:/Program Files/nodejs/node.exe';
const cwd='D:/运营管理系统-sales-django-release';
const artifact='E:/codex-artifacts/release-integration-review-20261010/AB-final-readiness-20261011-verified-final';
const audit='E:/codex-artifacts/release-integration-review-20261010/AB-final-readiness-prepare-20261011-audit';
const sha=v=>createHash('sha256').update(v).digest('hex');
async function absent(p){try{await lstat(p);throw new Error('Output already exists');}catch(e){assert.equal(e.code,'ENOENT');}}
async function write(p,v){const h=await open(p,'wx');try{await h.writeFile(JSON.stringify(v,null,2)+'\n');await h.sync();}finally{await h.close();}}
await absent(artifact);await absent(audit);
const review=JSON.parse(await readFile(path.join(source,'INDEPENDENT_REVIEW.json')));
assert.equal(review.independent,true);assert.equal(review.acceptedReadinessCandidate,true);
assert.equal(review.productionExecutionApproved,false);assert.deepEqual(review.blockingFindings,[]);
for(const [name,key]of [['protocol.mjs','apiSha256'],['execute.mjs','callerSha256'],['runtime.mjs','runtimeSha256'],['status-evidence.mjs','statusEvidenceSha256'],['prepare.mjs','sealerSha256']]){
  assert.match(review[key]??'',/^[a-f0-9]{64}$/);
  assert.equal(sha(await readFile(path.join(source,name))),review[key]);
}
const sealer=path.join(source,'prepare.mjs'),raw=await readFile(sealer);
assert.equal(sha(raw),'7254587f79705f994cb82ffb059f0f5cbdcffd99a9d1eda3b13ae87852296a16');
assert.equal(review.sealerSha256,sha(raw));
await mkdir(audit);
const out=await open(path.join(audit,'stdout.log'),'wx'),err=await open(path.join(audit,'stderr.log'),'wx');
const startedAt=new Date().toISOString(),begin=performance.now();
const args=[sealer,artifact,path.join(source,'INDEPENDENT_REVIEW.json')];
const child=spawn(executable,args,{cwd,windowsHide:true,stdio:['ignore',out.fd,err.fd]});
await write(path.join(audit,'started.json'),{startedAt,processId:child.pid,executable,args,cwd,sealerSha256:sha(raw),productionExecuted:false});
const result=await new Promise(resolve=>{child.once('error',e=>resolve({exitCode:null,signal:null,spawnErrorSha256:sha(String(e.message))}));child.once('close',(exitCode,signal)=>resolve({exitCode,signal}));});
await out.sync();await err.sync();await out.close();await err.close();
const stdout=await readFile(path.join(audit,'stdout.log')),stderr=await readFile(path.join(audit,'stderr.log'));
const finished={startedAt,finishedAt:new Date().toISOString(),processId:child.pid,elapsedMs:performance.now()-begin,...result,stdoutBytes:stdout.length,stdoutSha256:sha(stdout),stderrBytes:stderr.length,stderrSha256:sha(stderr),productionExecuted:false};
await write(path.join(audit,'finished.json'),finished);
console.log(JSON.stringify(finished));if(result.exitCode!==0)process.exitCode=1;
