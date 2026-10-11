// Isolated regressions and syntax checks only; no original entry or runtime mutation.
import{readFile,writeFile,readdir}from'node:fs/promises';import{spawnSync}from'node:child_process';import{fileURLToPath}from'node:url';import path from'node:path';import{createHash}from'node:crypto';import assert from'node:assert/strict';
const dir=fileURLToPath(new URL('.',import.meta.url)),out='E:/codex-artifacts/release-site-blockers-20261011/production-f15d06a/',sha=b=>createHash('sha256').update(b).digest('hex');
const files=(await readdir(dir)).filter(n=>n.endsWith('.mjs')).sort(),bindings=[];
for(const n of files){const file=path.join(dir,n);const r=spawnSync(process.execPath,['--check',file],{encoding:'utf8',windowsHide:true,timeout:30000});assert.equal(r.status,0,n+' syntax failed');bindings.push({name:n,sha256:sha(await readFile(file))});}
const startedAt=new Date().toISOString(),tests=['exact-env-transport.test.mjs','resume-admission-state.test.mjs','reconcile-backup-once.test.mjs','resume-reconciled-backup-state.test.mjs'];
const r=spawnSync(process.execPath,['--test',...tests.map(n=>path.join(dir,n))],{windowsHide:true,timeout:60000,maxBuffer:2097152});
await writeFile(out+'ROOT_FINAL_TRANSPORT_TEST.log',r.stdout??Buffer.alloc(0),{flag:'wx'});await writeFile(out+'ROOT_FINAL_TRANSPORT_TEST.stderr',r.stderr??Buffer.alloc(0),{flag:'wx'});
const result={version:'root-final-transport-regression-v1',startedAt,finishedAt:new Date().toISOString(),exitCode:r.status,errorCode:r.error?.code??null,tests,bindings,stdoutSha256:sha(r.stdout??Buffer.alloc(0)),stderrSha256:sha(r.stderr??Buffer.alloc(0)),productionExecution:false};
await writeFile(out+'ROOT_FINAL_TRANSPORT_TEST.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});assert.equal(r.status,0);console.log(JSON.stringify({exitCode:r.status,syntaxFiles:files.length,stdout:r.stdout.toString().split('\n').slice(-9)}));
