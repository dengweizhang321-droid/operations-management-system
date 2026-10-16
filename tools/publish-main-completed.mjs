import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

export const jdMonitorFiles=Object.freeze(['app/jd-logistics-cwarehouse-view.tsx','app/jd-logistics-product-matrix.tsx','app/jd-logistics.css','app/jd-monitor-warehouse-settings.tsx','lib/inventory/jd-logistics-contract.ts','backend/inventory/jd_logistics.py','backend/inventory/jd_logistics_models.py','backend/inventory/jd_logistics_notifications.py','backend/inventory/migrations/0015_jd_monitor_preferences.py','backend/teruisi_backend/health.py']);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function confirmCompletedTask(request,{getHead,readFile=fs.readFile,fetchReady=()=>fetch('http://127.0.0.1:3000/_teruisi/local/health/ready',{headers:{'x-teruisi-local-health':'1'},signal:AbortSignal.timeout(15000)})}){
 if(!request.completedTask)return null;
 const pinned=request.completedTask;
 assert.ok(path.isAbsolute(pinned.path));assert.match(pinned.sha256,/^[a-f0-9]{64}$/);
 const raw=await readFile(pinned.path);assert.equal(sha(raw),pinned.sha256,'已完成发布的证明已变化');
 const proof=JSON.parse(raw);assert.equal(proof.version,'teruisi-completed-jd-monitor-task-v1');assert.equal(proof.targetCommit,request.mainCommit,'证明不属于当前任务版本');
 const receiptRaw=await readFile(proof.receiptPath);assert.equal(sha(receiptRaw),proof.receiptSha256,'原成功回执已变化');
 const receipt=JSON.parse(receiptRaw);assert.equal(receipt.status,'deployed_and_ready');assert.equal(receipt.mainCommit,proof.publishedCommit);
 assert.equal(receipt.migration,'inventory.0015_jd_monitor_preferences');assert.equal(receipt.migrationCount,147);assert.equal(receipt.workerRelease,proof.workerRelease);
 const workerRoot=path.join('D:/teruisi-runtime/teruisi-worker-sales/releases',receipt.workerRelease);
 assert.equal(path.resolve(proof.workerManifestPath),path.resolve(workerRoot,'deployment-manifest.json'));
 assert.equal(path.resolve(proof.djangoManifestPath),path.resolve('D:/teruisi-runtime/django-sales/app/deployment.json'));
 assert.equal(proof.workerManifestSha256,receipt.workerManifestSha256);assert.equal(proof.djangoManifestSha256,receipt.djangoManifestSha256);
 const workerRaw=await readFile(proof.workerManifestPath);assert.equal(sha(workerRaw),receipt.workerManifestSha256,'当前前端版本已变化');
 assert.equal(sha(await readFile(proof.djangoManifestPath)),receipt.djangoManifestSha256,'当前后台版本已变化');
 const head=await getHead();assert.equal(head.releaseId,receipt.workerRelease);assert.equal(head.manifestSha256,receipt.workerManifestSha256);
 const manifest=JSON.parse(workerRaw);
 assert.equal(proof.files.length,jdMonitorFiles.length);assert.equal(new Set(proof.files.map(f=>f.relative)).size,jdMonitorFiles.length);
 for(const relative of jdMonitorFiles){
  const file=proof.files.find(f=>f.relative===relative);assert.ok(file,'缺少库存功能文件证明：'+relative);
  const installed=relative.startsWith('backend/')?path.join('D:/teruisi-runtime/django-sales/app',relative):path.join(workerRoot,manifest.source.snapshotRoot,relative);
  assert.equal(path.resolve(file.installed),path.resolve(installed));assert.equal(sha(await readFile(installed)),file.sha256,'库存功能代码已变化：'+relative);
 }
 const response=await fetchReady();assert.equal(response.status,200,'已发布服务当前未就绪');const health=await response.json();assert.equal(health.ok,true);assert.equal(health.status,'ready');
 return {alreadyPublished:true,publishedCommit:receipt.mainCommit,workerRelease:receipt.workerRelease,migration:receipt.migration,migrationCount:receipt.migrationCount,publishedAt:receipt.at,receiptPath:proof.receiptPath,featureFilesMatched:jdMonitorFiles.length,productionMutationsPerformed:false};
}
