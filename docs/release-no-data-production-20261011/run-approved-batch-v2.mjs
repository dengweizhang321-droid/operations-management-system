// Transport only: invoke the exact approved unchanged entry/argv, preserve its own gates/WAL.
import {readFile,writeFile,open,lstat,realpath} from 'node:fs/promises';
import {spawn} from 'node:child_process';import{createHash}from'node:crypto';import path from'node:path';import assert from'node:assert/strict';
const root='E:/codex-artifacts/release-site-blockers-20261011/production-f15d06a/',sha=b=>createHash('sha256').update(b).digest('hex');
async function pinned(file,expected){const absolute=path.resolve(file);for(let at=absolute;;){const s=await lstat(at);assert.equal(s.isSymbolicLink(),false);assert.equal((await realpath(at)).toLowerCase(),at.toLowerCase());const parent=path.dirname(at);if(parent===at)break;at=parent;}const a=await lstat(absolute,{bigint:true});assert.ok(a.isFile()&&a.nlink===1n);const raw=await readFile(absolute),b=await lstat(absolute,{bigint:true});for(const k of ['dev','ino','nlink','size','mtimeNs','ctimeNs'])assert.equal(a[k],b[k]);assert.equal(sha(raw),expected);return raw;}
const approval=JSON.parse(await pinned(root+'APPROVAL.json',process.argv[2]));
assert.equal(approval.humanApproved,true);assert.equal(approval.batchSha256,'f15d06a159073927ba3565712027aa645869333a3210c54e1858738756ca110f');
assert.equal(approval.scope,'Exact sealed 19 operations: one pre Backup, one same-point isolated Restore, original switch/acceptance/closeout; no post Backup/Restore or schedule change');
const raw=await pinned(approval.specPath,'960c5c3e99da1f5cd7bacf57ae3aa0889fcecb9cd522d9165870560668c7678b'),spec=JSON.parse(raw);
assert.equal(spec.batch.batchSha256,approval.batchSha256);assert.equal(spec.execution.entrySha256,'69898b1be33a9e3ba0d30a2eab480a12ca05fe339bf373bc333eec7d10245b99');
await pinned(spec.execution.entryPath,spec.execution.entrySha256);
await pinned(process.execPath,'9a4eb5f1c29c6a2e93852ead46b999e284a6a5ca8bab4d4e241d587d025a52de');
const argv=spec.execution.executeArgs.map(a=>a==='<explicit-approval-UTC-timestamp>'?approval.approvalRecordedAt:a);
assert.deepEqual(argv,[spec.execution.entryPath,'execute',approval.specPath,approval.batchSha256,approval.approvalRecordedAt]);
const out=await open(root+'STDOUT.log','wx'),err=await open(root+'STDERR.log','wx'),startedAt=new Date().toISOString();
await writeFile(root+'STARTED.json',JSON.stringify({startedAt,batchSha256:approval.batchSha256,argv,workingDirectory:process.cwd(),approvalSha256:process.argv[2]},null,2)+'\n',{flag:'wx'});
const child=spawn(process.execPath,argv,{windowsHide:true,stdio:['ignore',out.fd,err.fd]});
const outcome=new Promise(resolve=>{child.once('error',error=>resolve({exitCode:null,errorCode:error.code??'spawn-error'}));child.once('close',exitCode=>resolve({exitCode,errorCode:null}));});
await writeFile(root+'DIRECT_PROCESS.json',JSON.stringify({processId:child.pid,spawnObservedAt:new Date().toISOString(),batchSha256:approval.batchSha256},null,2)+'\n',{flag:'wx'});
const {exitCode,errorCode}=await outcome;await out.close();await err.close();
const finishedAt=new Date().toISOString();await writeFile(root+'FINISHED.json',JSON.stringify({startedAt,finishedAt,exitCode,errorCode,status:exitCode===0?'entry-returned-success-requires-independent-acceptance-check':'entry-failed-preserve-owner-gates-wal',batchSha256:approval.batchSha256,stdoutSha256:sha(await readFile(root+'STDOUT.log')),stderrSha256:sha(await readFile(root+'STDERR.log'))},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({exitCode,finishedAt}));process.exitCode=exitCode??1;
