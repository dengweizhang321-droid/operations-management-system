// S16: log-only preparation timing split in worker-local-release-rotation.mjs.
// Pure helpers plus a static read of planWorkerReleaseRotation; no child
// processes, so it runs in restricted sandboxes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {preparationTimingLine,logPreparationTiming,timePreparationStage} from '../tools/worker-local-release-rotation.mjs';

const rotationText=fs.readFileSync(fileURLToPath(new URL('../tools/worker-local-release-rotation.mjs',import.meta.url)),'utf8');
const planBody=(()=>{const start=rotationText.indexOf('export async function planWorkerReleaseRotation(');const end=rotationText.indexOf('\nfunction receiptPathForPlan(',start);assert.ok(start>0&&end>start,'planWorkerReleaseRotation body required');return rotationText.slice(start,end);})();
const clock=values=>{const queue=[...values];return ()=>{assert.ok(queue.length>0,'clock exhausted');return queue.shift();};};

test('timing line keeps ASCII stage and number ahead of the Chinese label', () => {
  assert.equal(preparationTimingLine('tail.predecessor-self-verify',183456,'ok','尾段前驱完整自校验',new Date(Date.UTC(2026,9,22,6,45,13,291))),
    '[2026-10-22T06:45:13.291Z] [构建明细] stage=tail.predecessor-self-verify elapsedMs=183456 outcome=ok 尾段前驱完整自校验');
});

test('timed stage returns the operation value and logs one ok line', async () => {
  const lines=[],value={plan:'x'};
  const result=await timePreparationStage('candidate-build','候选构建',async()=>value,{log:line=>lines.push(line),now:clock([1000,4500])});
  assert.equal(result,value);
  assert.deepEqual(lines,[`[${new Date(4500).toISOString()}] [构建明细] stage=candidate-build elapsedMs=3500 outcome=ok 候选构建`]);
});

test('timed stage rethrows the same error and logs a failed line', async () => {
  const lines=[],error=new Error('Online preparation predecessor changed; candidate cannot be planned');
  await assert.rejects(timePreparationStage('tail.chain-resolve','尾段生效链解析',async()=>{throw error;},{log:line=>lines.push(line),now:clock([10,25])}),caught=>caught===error);
  assert.deepEqual(lines,[`[${new Date(25).toISOString()}] [构建明细] stage=tail.chain-resolve elapsedMs=15 outcome=failed 尾段生效链解析`]);
});

test('a failing logger never changes the result or the error', async () => {
  const broken=()=>{throw new Error('EPIPE');};
  assert.equal(await timePreparationStage('rotation-lock','轮换锁获取',()=>42,{log:broken,now:clock([0,1])}),42);
  const error=new Error('original');
  await assert.rejects(timePreparationStage('rotation-lock','轮换锁获取',()=>{throw error;},{log:broken,now:clock([0,1])}),caught=>caught===error);
  assert.doesNotThrow(()=>logPreparationTiming('plan-publication','轮换计划与准备身份落盘',0,'ok',{log:broken,now:()=>1}));
});

test('planWorkerReleaseRotation carries every head/tail stage marker in order', () => {
  const stages=[...planBody.matchAll(/(?:timePreparationStage|logPreparationTiming)\(\s*(["`])([^"`]+)\1/g)].map(m=>m[2]);
  assert.deepEqual(stages,[
    'rotation-lock','batch-ownership','head.service-lock','head.chain-resolve','head.predecessor-self-verify',
    '${stage}.service-lock','${stage}.chain-resolve','${stage}.self-verify',
    'source-identity#${++sourceSampleCount}','reuse.candidate-verify','candidate-build',
    'tail.service-lock','tail.chain-resolve','tail.predecessor-self-verify','plan-publication',
  ]);
  assert.match(planBody,/const stage = `predecessor-boundary#\$\{\+\+predecessorCheckCount\}`/);
});

test('original effect order of planWorkerReleaseRotation is unchanged', () => {
  // Calls that read, lock, verify or write, in their pre-S16 order. A marker
  // that moved, dropped or duplicated one of them fails this sequence.
  const effects=/\b(lockForOperation|assertActiveBatchOwnership|acquireWorkerServiceMutex|resolveEffectiveReleaseChain|verifyReleaseWithOwnVerifier|readCutoverEvidence|verifyPreparationHeadUnchanged|verifyPreparedWorkerCandidate|buildWorkerReleaseCandidate|sampleSource|publishRotationPlan|publishCanonicalWithSidecar|logPreparationTiming)\(/g;
  const sequence=[...planBody.matchAll(effects)].map(m=>m[1]);
  assert.deepEqual(sequence,[
    'lockForOperation','assertActiveBatchOwnership','acquireWorkerServiceMutex','resolveEffectiveReleaseChain','verifyReleaseWithOwnVerifier','readCutoverEvidence',
    'acquireWorkerServiceMutex','resolveEffectiveReleaseChain','verifyPreparationHeadUnchanged','verifyReleaseWithOwnVerifier',
    'sampleSource',
    'verifyPreparedWorkerCandidate','sampleSource',
    'buildWorkerReleaseCandidate','sampleSource',
    'acquireWorkerServiceMutex','resolveEffectiveReleaseChain','verifyPreparationHeadUnchanged','verifyReleaseWithOwnVerifier',
    'resolveEffectiveReleaseChain','publishRotationPlan','publishCanonicalWithSidecar','logPreparationTiming',
  ]);
});
