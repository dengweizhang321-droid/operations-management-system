import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { reserveJackyunFailureRetry, claimJackyunAutomaticDispatch } from "../lib/jackyun/retry-budget";
import { withJackyunRecoveryContract } from "../tools/n8n-jackyun-recovery-contract.mjs";
import { attachHourlyRetryTarget, buildHourlyRetryErrorWorkflow } from "../tools/n8n-hourly-retry-policy.mjs";
import { readFile } from "node:fs/promises";

test("failure budgets persist across executions; 60/120/240-minute waits do not spend an attempt", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "jackyun-budget-")); t.after(() => rm(root, { recursive: true, force: true }));
  const context = { workflowId: "J8kY2mQ5vR7sT4pN", originalExecutionId: "8548", failedExecutionId: "8548", originalScheduledAt: "2026-10-13T00:00:00.000Z" };
  const stopped = "2026-10-13T00:00:10.000Z";
  const options = { failedStoppedAt: stopped, now: "2026-10-13T00:30:00.000Z", lockDirectory: path.join(root, "lock") };
  const waiting = await reserveJackyunFailureRetry(root, context, "8550", options);
  assert.equal(waiting.reservationStatus, "waiting");
  const directory = path.join(root, "outputs/jackyun-export-first/retry-budget/8548");
  await assert.rejects(readdir(directory), /ENOENT/);
  assert.equal((await reserveJackyunFailureRetry(root, context, "8550", { ...options, now: "2026-10-13T01:00:10.000Z" })).reservationStatus, "reserved");
  await assert.rejects(reserveJackyunFailureRetry(root, context, "8551", { ...options, now: "2026-10-13T02:00:10.000Z" }), /禁止再次 POST/);
  const second = { ...context, failedExecutionId: "8552" };
  assert.equal((await reserveJackyunFailureRetry(root, second, "8553", { ...options, now: "2026-10-13T01:59:10.000Z" })).reservationStatus, "waiting");
  assert.equal((await reserveJackyunFailureRetry(root, second, "8553", { ...options, now: "2026-10-13T02:00:10.000Z" })).reservationStatus, "reserved");
  const third = { ...context, failedExecutionId: "8554" };
  assert.equal((await reserveJackyunFailureRetry(root, third, "8555", { ...options, now: "2026-10-13T03:59:10.000Z" })).reservationStatus, "waiting");
  assert.equal((await reserveJackyunFailureRetry(root, third, "8555", { ...options, now: "2026-10-13T04:00:10.000Z" })).reservationStatus, "reserved");
  await assert.rejects(reserveJackyunFailureRetry(root, { ...context, failedExecutionId: "8556" }, "8557", { ...options, now: "2026-10-13T08:00:10.000Z" }), /三次上限/);
  const reconciled = await reserveJackyunFailureRetry(root, context, "8558", { ...options, now: "2026-10-13T08:00:10.000Z", acceptance: async () => "8552" });
  assert.equal(reconciled.reservationStatus, "accepted"); assert.equal((await readdir(directory)).length, 3);
});

test("new five-table wiring keeps entry/claim/A-E and yields through the original claim", async () => {
  const workflow = JSON.parse(await readFile(new URL("../automation/n8n/jackyun-five-dataset-api.workflow.json", import.meta.url), "utf8"));
  assert.equal(workflow.meta.jackyunRecovery, "jackyun-recovery-control-v1");
  assert.equal(workflow.settings.saveExecutionProgress, true);
  assert.equal(workflow.connections["固定原执行计划时间"].main[0][0].node, "领取共享 helper");
  for (const name of ["A·固定采集日和销售日期", "B·接口校验与五表下载", "C·五表完整校验和导入演练", "D·统一导入运营管理系统", "E·独立核验五类精确批次"]) {
    const node = workflow.nodes.find((n: { name: string }) => n.name === name);
    assert.equal(node.retryOnFail, false);
    assert(node.parameters.headerParameters.parameters.some((h: { name: string }) => h.name === "X-TERUISI-JACKYUN-RECOVERY"));
    if (name.startsWith("E·")) assert.equal(workflow.connections[name + "·等待原任务"], undefined);
    else assert.equal(workflow.connections[name + "·等待原任务"].main[0][0].node, "领取共享 helper");
  }
  const again = withJackyunRecoveryContract(workflow); attachHourlyRetryTarget(again);
  assert.deepEqual(again, workflow);
  const shared = buildHourlyRetryErrorWorkflow();
  const wait = shared.nodes.find((n: { name: string }) => n.name === "等待一小时");
  assert(wait);
  assert.deepEqual(wait.parameters, { resume: "timeInterval", amount: 1, unit: "hours" });
  assert.equal(shared.connections["吉客云需要继续退避？"].main[1][0].node, "等待一小时");
});

test("automatic admission requires the exact durable producer and one consumer across duplicate Webhooks", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "jackyun-dispatch-consumer-")); t.after(() => rm(root, { recursive: true, force: true }));
  const context = { workflowId: "J8kY2mQ5vR7sT4pN", originalExecutionId: "8548", failedExecutionId: "8548", originalScheduledAt: "2026-10-13T00:00:00.000Z" };
  const lockDirectory = path.join(root, "lock");
  await assert.rejects(claimJackyunAutomaticDispatch(root, context, "8550", "8551", { lockDirectory }), /MANUAL_ACTION/);
  await reserveJackyunFailureRetry(root, context, "8550", { failedStoppedAt: "2026-10-13T00:00:10.000Z", now: "2026-10-13T01:00:10.000Z", lockDirectory });
  await assert.rejects(claimJackyunAutomaticDispatch(root, context, "8551", "8552", { lockDirectory }), /持久发送意图/);
  await assert.rejects(claimJackyunAutomaticDispatch(root, { ...context, originalScheduledAt: "2026-10-12T00:00:00.000Z" }, "8550", "8551", { lockDirectory }), /逻辑身份/);
  await claimJackyunAutomaticDispatch(root, context, "8550", "8551", { lockDirectory });
  const file = path.join(root, "outputs/jackyun-export-first/retry-dispatch-claims/8548/8548.json"), original = await readFile(file);
  await claimJackyunAutomaticDispatch(root, context, "8550", "8551", { lockDirectory });
  await assert.rejects(claimJackyunAutomaticDispatch(root, context, "8550", "8552", { lockDirectory }), /另一完整 execution/);
  assert.deepEqual(await readFile(file), original);
  assert.equal((await readdir(path.join(root, "outputs/jackyun-export-first/retry-budget/8548"))).length, 1);
});

test("manual recovery attempts retain the first logical anchor across repeated failures and midnight", async () => {
  const workflow = JSON.parse(await readFile(new URL("../automation/n8n/jackyun-five-dataset-api.workflow.json", import.meta.url), "utf8"));
  const code = workflow.nodes.find((n: { name: string }) => n.name === "固定原执行计划时间").parameters.jsCode;
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const anchor = new AsyncFunction("$input", "$execution", code);
  const original = "2026-10-12T16:10:00.052Z";
  const client = { helpers: { httpRequest: async (request: { method: string; url: string }) => {
    assert.equal(request.method, "GET"); assert.equal(new URL(request.url).searchParams.get("logicalExecutionId"), "8548");
    return { ok: true, logicalExecutionId: "8548", originalScheduledAt: original };
  } } };
  for (const [failed, current] of [["8548", "8556"], ["8556", "8600"]]) {
    const input = { first: () => ({ json: { jackyunRecovery: { version: "jackyun-recovery-control-v1", kind: "retry", logicalExecutionId: "8548", failedExecutionId: failed } } }) };
    const result = (await anchor.call(client, input, { id: current }))[0].json;
    assert.equal(result.executionId, current); assert.equal(result.originalExecutionId, "8548"); assert.equal(result.scheduledAt, original);
  }
  await assert.rejects(anchor.call(client, { first: () => ({ json: { originalScheduledAt: "2026-10-13T16:10:00.052Z",
    jackyunRecovery: { version: "jackyun-recovery-control-v1", kind: "retry", logicalExecutionId: "8548", failedExecutionId: "8556" } } }) }, { id: "8600" }), /original_anchor_changed_manual_action/);
});
