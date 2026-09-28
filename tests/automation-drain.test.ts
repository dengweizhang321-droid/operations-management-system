import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readAutomationDrain, automationDrainProtocol } from "../tools/automation-drain";
import { IsolatedHelperSlots, isolatedRequestIdentity, type SlotIdentity } from "../tools/tmall-isolated-helper";
import { withMaintenanceCoordination, anchorNodeName } from "../tools/n8n-maintenance-coordination.mjs";
import { classifyHourlyRetryFailure } from "../tools/n8n-hourly-retry-policy.mjs";
import { hourlyRetryTargets } from "../tools/n8n-hourly-retry-policy.mjs";

test("drain preserves admitted execution, rejects a changed anchor, and never spawns waiting work", async () => {
  let draining = false, starts = 0;
  let finish!: (clean: boolean) => void;
  const pool = new IsolatedHelperSlots(new Set(["tmall-lili"]), async (_, done) => {
    starts++; finish = done; return { port: 1, token: "test", stop: async () => {} };
  }, () => draining);
  const id: SlotIdentity = { key: "tmall-lili", storeKey: "tmall-lili", workflow: "tmall", executionId: "1", scheduledAt: "2026-09-29T15:59:00.000Z" };
  const first = pool.claim(id); await first.slot!.ready;
  draining = true;
  assert.equal(pool.claim(id).slot, first.slot);
  assert.equal(pool.claim({ ...id, scheduledAt: "2026-09-30T00:01:00.000Z" }).status, "rejected");
  finish(true);
  assert.equal(pool.claim(id).reason, "execution_already_finished");
  const next = { ...id, executionId: "2" };
  assert.equal(pool.claim(next).reason, "maintenance_wait");
  assert.equal(starts, 1);
  draining = false;
  await pool.claim(next).slot!.ready;
  assert.equal(pool.lookup(next)?.scheduledAt, id.scheduledAt);
  assert.equal(starts, 2);
  finish(false);
  assert.match(pool.claim({ ...next, executionId: "3" }).reason!, /manual_action/);
});

test("drain file absence, binding, corruption and exact protocol", () => {
  const runtime = mkdtempSync(path.join(tmpdir(), "optimization4-gate-"));
  try {
    mkdirSync(path.join(runtime, "run"));
    assert.equal(readAutomationDrain(runtime), null);
    const file = path.join(runtime, "run/automation-drain.json");
    writeFileSync(file, JSON.stringify({ version: automationDrainProtocol, id: "a".repeat(32), phase: "helpers", runtimeRoot: runtime }));
    assert.equal(readAutomationDrain(runtime)?.phase, "helpers");
    writeFileSync(file, "{}"); assert.throws(() => readAutomationDrain(runtime));
    writeFileSync(file, "broken"); assert.throws(() => readAutomationDrain(runtime));
  } finally { rmSync(runtime, { recursive: true }); }
});

test("invalid plan timestamps are rejected before claim", () => {
  const headers = { "x-teruisi-n8n-execution-id": "1", "x-teruisi-workflow-key": "jd", "x-teruisi-scheduled-at": "2026-02-30T00:00:00.000Z" };
  assert.equal(isolatedRequestIdentity("/coordination/claim", headers), null);
});

test("candidate anchors trigger paths once, retains same-execution wait and schedule", () => {
  const source = JSON.parse(readFileSync(new URL("../automation/n8n/tmall-lili-sycm-cookie-daily.workflow.json", import.meta.url), "utf8"));
  const original = JSON.stringify(source);
  const candidate = withMaintenanceCoordination(source);
  assert.equal(JSON.stringify(source), original);
  assert.deepEqual(candidate.nodes.filter(n => n.type === "n8n-nodes-base.scheduleTrigger"), source.nodes.filter(n => n.type === "n8n-nodes-base.scheduleTrigger"));
  assert.equal(candidate.connections["等待前序流程释放 helper"].main[0][0].node, "领取共享 helper");
  assert.equal(candidate.connections[anchorNodeName].main[0][0].node, "领取共享 helper");
  assert.throws(() => withMaintenanceCoordination(candidate));
});

test("maintenance uncertainty and expired waiting never create a new hourly execution", () => {
  for (const message of ["maintenance_wait", "coordination_wait_expired", "execution_plan_anchor_changed_manual_action"]) {
    assert.equal(classifyHourlyRetryFailure({ workflow: { id: "J8kY2mQ5vR7sT4pN" }, execution: { mode: "trigger", error: { message } } }).retry, false);
  }
});

test("all candidate definitions preserve identities, triggers and business nodes", () => {
  for (const target of hourlyRetryTargets) {
    const source = JSON.parse(readFileSync(new URL(`../automation/n8n/${target.fileName}`, import.meta.url), "utf8"));
    const candidate = withMaintenanceCoordination(source);
    assert.equal(candidate.id, source.id);
    assert.equal(candidate.active, source.active);
    for (const node of source.nodes.filter(n => n.parameters?.url !== "http://127.0.0.1:5791/coordination/claim")) {
      assert.deepEqual(candidate.nodes.find(n => n.id === node.id), node);
    }
  }
});

test("actual candidate code retains a pre-midnight anchor over offline waiting and duplicate claims", async () => {
  const source = JSON.parse(readFileSync(new URL("../automation/n8n/tmall-lili-sycm-cookie-daily.workflow.json", import.meta.url), "utf8"));
  const candidate = withMaintenanceCoordination(source);
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const initialize = new AsyncFunction("$input", "$execution", candidate.nodes.find(n => n.name === anchorNodeName).parameters.jsCode);
  const [anchor] = await initialize({ first: () => ({ json: { timestamp: "2026-09-29T23:59:00+08:00" } }) }, { id: "42" });
  const claim = new AsyncFunction("$", "$execution", "$runIndex", candidate.nodes.find(n => n.name === "领取共享 helper").parameters.jsCode);
  const seen: Array<Record<string,string>> = [];
  const context = { helpers: { httpRequest: async (request: {headers: Record<string,string>}) => {
    seen.push(request.headers);
    if (seen.length === 1) throw new Error("ECONNREFUSED");
    return { ok: true, coordinationStatus: "granted" };
  } } };
  const lookup = () => ({ first: () => anchor });
  assert.equal((await claim.call(context, lookup, { id: "42" }, 0))[0].json.coordinationStatus, "waiting");
  for (const attempt of [1,2]) assert.equal((await claim.call(context, lookup, { id: "42" }, attempt))[0].json.coordinationStatus, "granted");
  assert.ok(seen.every(h => h["X-TERUISI-SCHEDULED-AT"] === "2026-09-29T15:59:00.000Z" && h["X-TERUISI-N8N-EXECUTION-ID"] === "42"));
  await assert.rejects(claim.call(context, lookup, { id: "42" }, 72), /manual_action/);
  assert.equal(seen.length, 3);
  await assert.rejects(initialize({ first: () => ({ json: { body: {} } }) }, { id: "43" }), /plan_anchor_missing/);
  context.helpers.httpRequest = async () => { throw Object.assign(new Error("conflict"), { statusCode: 409 }); };
  await assert.rejects(claim.call(context, lookup, { id: "42" }, 3), /rejected_manual_action/);
});
