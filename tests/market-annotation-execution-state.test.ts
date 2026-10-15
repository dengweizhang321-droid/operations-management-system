import assert from "node:assert/strict";
import test from "node:test";
import { annotationExecutionState } from "../lib/market/annotation-execution-state";

const sample = { jobStatus: "running", executor: "cloud", run: { state: "running", lastFailureCode: "", nextRunAt: null },
  activeClaims: 0, receivedAt: 10_000, issue: null, now: 11_000 };
test("job running does not imply execution: pause, unknown and empty leases are distinct", () => {
  assert.equal(annotationExecutionState(sample).execution, "等待后台派发");
  const paused = { ...sample, run: { ...sample.run, state: "paused" } };
  assert.equal(annotationExecutionState(paused).execution, "已暂停派发");
  assert.equal(annotationExecutionState({ ...paused, run: { ...paused.run, lastFailureCode: "inference_result_unknown" } }).execution, "结果待核验（已暂停）");
  assert.equal(annotationExecutionState({ ...sample, activeClaims: 12 }).execution, "正在处理 12 张");
  assert.equal(annotationExecutionState({ ...paused, activeClaims: 2 }).execution, "正在完成在途图片，随后暂停");
});
test("failed or stale reads preserve intent but never claim live execution", () => {
  const value = annotationExecutionState({ ...sample, activeClaims: 12, issue: { kind: "maintenance" } });
  assert.equal(value.intent, "继续执行");
  assert.equal(value.execution, "维护中，暂不派发");
  assert.equal(annotationExecutionState({ ...sample, activeClaims: 12, issue: { kind: "unavailable" } }).execution, "暂无法核实");
  assert.equal(annotationExecutionState({ ...sample, activeClaims: 12, now: 41_001 }).execution, "暂无法核实");
  assert.equal(annotationExecutionState({ ...sample, receivedAt: null }).reading, "等待最新状态");
});
test("cold start, completion and recovery expose current observations", () => {
  assert.equal(annotationExecutionState({ ...sample, run: null, receivedAt: null }).intent, "尚未确认");
  assert.equal(annotationExecutionState({ ...sample, jobStatus: "review_ready" }).execution, "识别已结束");
  assert.equal(annotationExecutionState({ ...sample, executor: "local", jobStatus: "committed" }).execution, "识别已结束");
  assert.equal(annotationExecutionState({ ...sample, executor: "local", jobStatus: "cancelled" }).execution, "任务已结束");
  assert.equal(annotationExecutionState({ ...sample, run: { ...sample.run, nextRunAt: new Date(20_000).toISOString() } }).execution, "等待冷却结束");
});
