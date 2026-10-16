import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {confirmCompletedTask,jdMonitorFiles} from '../tools/publish-main-completed.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
function fixture(){
 const store=new Map(),put=(p,b)=>store.set(path.resolve(p),Buffer.isBuffer(b)?b:Buffer.from(b));
 const release='20261017T000000Z-0123456789abcdef',root='D:/teruisi-runtime/teruisi-worker-sales/releases/'+release;
 const worker=Buffer.from(JSON.stringify({source:{snapshotRoot:'source-snapshot'}})),django=Buffer.from('django fixture');
 put(root+'/deployment-manifest.json',worker);put('D:/teruisi-runtime/django-sales/app/deployment.json',django);
 const files=jdMonitorFiles.map(relative=>{const installed=relative.startsWith('backend/')?path.join('D:/teruisi-runtime/django-sales/app',relative):path.join(root,'source-snapshot',relative);const bytes=Buffer.from('fixture:'+relative);put(installed,bytes);return {relative,installed,sha256:sha(bytes)};});
 const receipt={status:'deployed_and_ready',mainCommit:'1'.repeat(40),workerRelease:release,workerManifestSha256:sha(worker),djangoManifestSha256:sha(django),migration:'inventory.0015_jd_monitor_preferences',migrationCount:147,at:'2026-10-16T18:04:23Z'};
 const receiptPath='D:/completed-fixture/SUCCESS.json',raw=Buffer.from(JSON.stringify(receipt));put(receiptPath,raw);
 const proof={version:'teruisi-completed-jd-monitor-task-v1',targetCommit:'2'.repeat(40),publishedCommit:receipt.mainCommit,receiptPath,receiptSha256:sha(raw),workerRelease:release,workerManifestPath:root+'/deployment-manifest.json',workerManifestSha256:sha(worker),djangoManifestPath:'D:/teruisi-runtime/django-sales/app/deployment.json',djangoManifestSha256:sha(django),files};
 const request={mainCommit:proof.targetCommit,completedTask:{path:'D:/completed-fixture/proof.json',sha256:''}};
 const repin=()=>{const bytes=Buffer.from(JSON.stringify(proof));put(request.completedTask.path,bytes);request.completedTask.sha256=sha(bytes);};repin();
 const deps={readFile:async p=>{const b=store.get(path.resolve(p));assert.ok(b,'Unexpected read '+p);return b;},getHead:async()=>({releaseId:release,manifestSha256:sha(worker)}),fetchReady:async()=>({status:200,json:async()=>({ok:true,status:'ready'})})};
 return {request,proof,receipt,put,repin,deps};
}
test('no completion record leaves the normal publish flow available',async()=>assert.equal(await confirmCompletedTask({},{}),null));
test('a matching deployed package confirms this inventory task without mutations',async()=>{
 const f=fixture();const value=await confirmCompletedTask(f.request,f.deps);assert.equal(value.alreadyPublished,true);assert.equal(value.productionMutationsPerformed,false);assert.equal(value.featureFilesMatched,10);assert.equal(value.migrationCount,147);
});
test('changed receipt, current head, task files or incomplete proof cannot report success',async()=>{
 const changedReceipt=fixture();changedReceipt.put(changedReceipt.proof.receiptPath,'changed');await assert.rejects(confirmCompletedTask(changedReceipt.request,changedReceipt.deps),/成功回执/);
 const changedHead=fixture();changedHead.deps.getHead=async()=>({releaseId:'different'});await assert.rejects(confirmCompletedTask(changedHead.request,changedHead.deps));
 const changedFile=fixture();changedFile.put(changedFile.proof.files[0].installed,'changed');await assert.rejects(confirmCompletedTask(changedFile.request,changedFile.deps),/功能代码/);
 const partial=fixture();partial.proof.files.pop();partial.repin();await assert.rejects(confirmCompletedTask(partial.request,partial.deps));
 const wrongTask=fixture();wrongTask.request.mainCommit='3'.repeat(40);await assert.rejects(confirmCompletedTask(wrongTask.request,wrongTask.deps),/当前任务版本/);
});
test('unavailable service cannot be shown as successful even with a prior success receipt',async()=>{
 const f=fixture();f.deps.fetchReady=async()=>({status:503});await assert.rejects(confirmCompletedTask(f.request,f.deps),/未就绪/);
});
