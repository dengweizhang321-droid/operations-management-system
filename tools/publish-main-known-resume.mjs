import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

// One reviewed pre-maintenance failure, not a general retry or force switch.
export const knownResume=Object.freeze({
 source:'D:/codex-isolated/main-manual-release-20261016/source',
 commit:'7dcd013f7985e35b8f80cda6698311e2be9c3472',
 maintenanceId:'8240a8e49492480db463a072094f1952',operationId:'d6fa5afb54c4407789f88ad07392379a',
 actorPid:2900,workerReceiptSha256:'58a8d78dc3a2ea4e0bf7d74d503d8f2d922d2e2aebce81e9b3fb02401e6adfd4',
 nativeSha256:'ca155b4cae5f1952a1da6addb6ad5e2d3ba8290b31ab9bee24b70aef1cb6040e',
 records:{
  'STARTED.json':'a79aec1615bcb9c69741d41cf7085c418f9b111bb2d6a815bc1d1d995eeb4f0c',
  'FAILED.json':'2aae55a8ed2ed1b63b88637e05c0be4f1263525ba0cc5c3af99109479f0b3204',
  'worker-plan.json':'4f54057028a0acbedc89eb531bd7f42fbb1d6d2ae3cb944dc3719ee64c50a927',
  'source-binding.json':'fc9c1792a0e16282195e83c26df67583765021157b461faa865662423fc8b5af',
  '准备后台-result.json':'341509832d6993575b88733a9f3d916a468ee42e8c54a1c939be39a1cc020947',
  '进入维护-started.json':'42e08ee3cf6ad5fc32718e40ee6ce2a9d5945d9c7508061ed69f1f4549648bcf'
 }
});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function validateResumeReview(review,scope=knownResume,now=Date.now()){
 assert.equal(review.version,'manual-premaintenance-zero-effect-v1');
 assert.equal(review.maintenanceId,scope.maintenanceId);assert.equal(review.operationId,scope.operationId);
 assert.equal(review.mainCommit,scope.commit);assert.equal(review.failedSha256,scope.records['FAILED.json']);
 assert.equal(review.independentReview,true);assert.equal(review.maintenanceEffectsExcluded,true);
 const observed=Date.parse(review.observedAt);assert.ok(Number.isFinite(observed)&&observed<=now&&now-observed<30*60*1000,'续接观察证据已过期');
}
export async function loadKnownResume(originalOut,request,head){
 assert.equal(head,knownResume.commit);assert.equal(request.mainCommit,knownResume.commit);
 const records={};
 for(const [name,expected] of Object.entries(knownResume.records)){
  const bytes=await fs.readFile(path.join(originalOut,name));assert.equal(hash(bytes),expected,'原发布记录已变化：'+name);records[name]=JSON.parse(bytes);
 }
 const started=records['STARTED.json'];assert.equal(started.maintenanceId,knownResume.maintenanceId);assert.equal(started.operationId,knownResume.operationId);
 assert.equal(records['FAILED.json'].phase,'进入维护');assert.equal(records['FAILED.json'].processEvidence.processId,knownResume.actorPid);
 const names=await fs.readdir(originalOut);
 assert.ok(!names.some(name=>/^(停止旧前端|登记结构迁移|部署后台|应用后台权限|迁移配置字段|完成结构迁移|WorkerApply|退出维护|启动服务|确认启动版本|SUCCESS)/.test(name)),'原批次已有后续动作，禁止此续接');
 const reviewFile=path.resolve(originalOut,'..','resume-review.json');
 const raw=await fs.readFile(reviewFile);assert.match(request.resumeReviewSha256??'',/^[a-f0-9]{64}$/);assert.equal(hash(raw),request.resumeReviewSha256,'续接独立观察摘要变化');
 const review=JSON.parse(raw);validateResumeReview(review);
 return {started,plan:records['worker-plan.json'],pkg:records['准备后台-result.json'].value,reviewFile,reviewSha256:request.resumeReviewSha256};
}
