import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  JdMarketAdminRefusal,
  abandonRunningJdMarketPlan,
  inspectJdMarketPlans,
  probeDebugPortClosed,
  probeHelperNoMarketExecution,
} from "../tools/jd-market-ranking-admin-core";
import { claimRecoverableJdMarketPlan, type JdMarketPlanIdentity, type JdMarketRecoveryPlanShape } from "../lib/jd/market-ranking-import-contract";

const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const identity = { category: "商用磨粉机粉碎机", scope: "pop", rankingDimension: "SKU" as const, priceBandFilter: "全部" };

function planIdentity(): JdMarketPlanIdentity {
  return {
    version: 4, baseUrl: "http://localhost:3000", silentNoWindow: true, storeKey: "store-key", shopId: "711743", shopName: "测试店铺",
    browserProfileName: "Profile 3", browserDebugPort: 9227, startDate: "2026-01-01", endDate: "2026-08-13",
    targets: [{ key: "grinder", categoryPath: ["商用食品机械设备", "商用磨粉机/粉碎机"], identity: { ...identity, secondIndId: "44744", thirdIndId: "44811" } }],
  };
}
function plan(runId: string, stage: JdMarketRecoveryPlanShape["stage"]) {
  return { runId, ...planIdentity(), ownerExecutionId: "old-execution", stage, updatedAt: "2026-08-13T01:00:00.000Z",
    targets: [{ ...planIdentity().targets[0]!, chunks: [{}] }] } as JdMarketRecoveryPlanShape & { updatedAt: string };
}
function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), "jd-market-admin-"));
  const write = (runId: string, stage: JdMarketRecoveryPlanShape["stage"]) => {
    const text = `${JSON.stringify(plan(runId, stage), null, 2)}\n`;
    writeFileSync(path.join(dir, `plan-${runId}.json`), text);
    return sha(text);
  };
  return { dir, write, top: () => readdirSync(dir).filter((name) => /^plan-.*\.json$/.test(name)), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
const idle = async () => "helper_not_running";
const closed = async () => "port_closed";
async function free<T>(_purpose: string, operation: () => Promise<T>) { return operation(); }
const confirm = (dir: string, runId: string, expect: string, extra: object = {}) => ({
  planDirectory: dir, runId, expectSha256: expect, operatorConfirmed: true, reason: "崩溃遗留 running 计划，原进程已确认不在",
  helperProbe: idle, portProbe: closed, withLock: free, now: new Date("2026-11-17T00:00:00Z"), ...extra,
});
async function refusal(promise: Promise<unknown>, reason: string) {
  await assert.rejects(promise, (error: unknown) => error instanceof JdMarketAdminRefusal && error.reason === reason, reason);
}

test("inspect lists only non-completed top-level plans and flags the one blocking its identity", async () => {
  const x = setup();
  try {
    const running = x.write("run-a", "running");
    x.write("run-done", "completed");
    x.write("run-failed", "failed");
    mkdirSync(path.join(x.dir, "operator-abandons", "nested"), { recursive: true });
    writeFileSync(path.join(x.dir, "operator-abandons", "nested", "plan-hidden.json"), JSON.stringify(plan("hidden", "running")));
    const result = await inspectJdMarketPlans({ planDirectory: x.dir });
    assert.deepEqual(result.plans.map((item) => item.runId).sort(), ["run-a", "run-failed"]);
    const a = result.plans.find((item) => item.runId === "run-a")!;
    assert.equal(a.sha256, running);
    assert.equal(a.blocksSameIdentity, true);
    assert.equal(a.abandonable, true);
    assert.equal(a.ownerExecutionId, "old-execution");
    const failed = result.plans.find((item) => item.runId === "run-failed")!;
    assert.equal(failed.abandonable, false);
    assert.deepEqual(failed.blocking, ["blocked_by_running_sibling"]);
  } finally { x.cleanup(); }
});

test("abandon-running accepts only running plans", async () => {
  const x = setup();
  try {
    for (const stage of ["planned", "executed", "completed", "failed"] as const) {
      const digest = x.write(`run-${stage}`, stage);
      await refusal(abandonRunningJdMarketPlan(confirm(x.dir, `run-${stage}`, digest)), "stage_not_running");
    }
    assert.equal(x.top().length, 4);
  } finally { x.cleanup(); }
});

test("abandon-running refuses when helper is active, the lock is unavailable or the port is listening", async () => {
  const x = setup();
  try {
    const digest = x.write("run-a", "running");
    const active = async () => { throw new JdMarketAdminRefusal("helper_market_active", "active"); };
    await refusal(abandonRunningJdMarketPlan(confirm(x.dir, "run-a", digest, { helperProbe: active })), "helper_market_active");
    const listening = async () => { throw new JdMarketAdminRefusal("browser_port_listening", "listening"); };
    await refusal(abandonRunningJdMarketPlan(confirm(x.dir, "run-a", digest, { portProbe: listening })), "browser_port_listening");
    const busy = async () => { throw new Error("lock held"); };
    await refusal(abandonRunningJdMarketPlan(confirm(x.dir, "run-a", digest, { withLock: busy })), "chromium_lock_unavailable");
    assert.deepEqual(x.top(), ["plan-run-a.json"]);
    assert.equal(existsSync(path.join(x.dir, "operator-abandons")), false);
  } finally { x.cleanup(); }
});

test("helper probe: only a clear no-market answer or ECONNREFUSED passes", async () => {
  const json = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  assert.equal(await probeHelperNoMarketExecution(json(200, { storeExecutions: [{ workflow: "tmall" }] })), "helper_no_market_execution");
  await refusal(probeHelperNoMarketExecution(json(200, { storeExecutions: [{ workflow: "jd-market" }] })), "helper_market_active");
  await refusal(probeHelperNoMarketExecution(json(500, {})), "helper_probe_failed");
  await refusal(probeHelperNoMarketExecution(json(200, {})), "helper_probe_failed");
  const refused = (async () => { throw Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } }); }) as unknown as typeof fetch;
  assert.equal(await probeHelperNoMarketExecution(refused), "helper_not_running");
  const timeout = (async () => { throw Object.assign(new Error("timed out"), { name: "TimeoutError" }); }) as unknown as typeof fetch;
  await refusal(probeHelperNoMarketExecution(timeout), "helper_probe_failed");
});

test("port probe refuses a listening port and passes a closed one", async () => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  try { await refusal(probeDebugPortClosed(port), "browser_port_listening"); }
  finally { await new Promise((resolve) => server.close(resolve)); }
  assert.equal(await probeDebugPortClosed(port), "port_closed");
  await refusal(probeDebugPortClosed(0), "browser_port_invalid");
});

test("dry-run writes nothing; mismatching expect-sha256 and missing reason are refused", async () => {
  const x = setup();
  try {
    const digest = x.write("run-a", "running");
    const before = readdirSync(x.dir);
    const dry = await abandonRunningJdMarketPlan({ planDirectory: x.dir, runId: "run-a", dryRun: true, helperProbe: idle, portProbe: closed, withLock: free });
    assert.equal(dry.stage, "dry_run");
    assert.equal((dry as { wouldAbandon: boolean }).wouldAbandon, true);
    assert.deepEqual(readdirSync(x.dir), before);
    await refusal(abandonRunningJdMarketPlan(confirm(x.dir, "run-a", "0".repeat(64))), "sha256_mismatch");
    await refusal(abandonRunningJdMarketPlan(confirm(x.dir, "run-a", digest, { reason: "短" })), "reason_length");
    await refusal(abandonRunningJdMarketPlan(confirm(x.dir, "run-a", "abc")), "expect_sha256_missing");
    await refusal(abandonRunningJdMarketPlan({ planDirectory: x.dir, runId: "run-a" }), "not_confirmed");
    assert.deepEqual(readdirSync(x.dir), before);
  } finally { x.cleanup(); }
});

test("confirm keeps original bytes as evidence, removes the top-level plan and unblocks the identity", async () => {
  const x = setup();
  try {
    const digest = x.write("run-a", "running");
    const original = readFileSync(path.join(x.dir, "plan-run-a.json"));
    assert.throws(() => claimRecoverableJdMarketPlan([plan("run-a", "running")], planIdentity(), "new-exec"), /running 计划/);
    const result = await abandonRunningJdMarketPlan(confirm(x.dir, "run-a", digest));
    assert.equal(result.stage, "abandoned");
    const evidence = path.join(x.dir, "operator-abandons", `run-a-${digest.slice(0, 16)}`);
    assert.deepEqual(readFileSync(path.join(evidence, "original.json")), original);
    assert.deepEqual(readFileSync(path.join(evidence, "plan-run-a.json")), original);
    const record = JSON.parse(readFileSync(path.join(evidence, "record.json"), "utf8"));
    assert.equal(record.originalSha256, digest);
    assert.equal(record.action, "abandon-running");
    assert.equal(record.runId, "run-a");
    assert.match(record.reason, /崩溃遗留/);
    assert.equal(x.top().length, 0);
    // Re-run: the same confirm is idempotent.
    assert.equal((await abandonRunningJdMarketPlan(confirm(x.dir, "run-a", digest))).stage, "already_abandoned");
    // The runner's top-level scan no longer sees the plan, so the same identity is not refused.
    const remaining = x.top().map((name) => JSON.parse(readFileSync(path.join(x.dir, name), "utf8")));
    assert.equal(claimRecoverableJdMarketPlan(remaining, planIdentity(), "new-exec"), null);
  } finally { x.cleanup(); }
});

test("evidence conflicts are refused, identical evidence resumes, an existing target is never overwritten", async () => {
  const x = setup();
  try {
    const digest = x.write("run-a", "running");
    const evidence = path.join(x.dir, "operator-abandons", `run-a-${digest.slice(0, 16)}`);
    mkdirSync(evidence, { recursive: true });
    writeFileSync(path.join(evidence, "original.json"), "tampered");
    await refusal(abandonRunningJdMarketPlan(confirm(x.dir, "run-a", digest)), "evidence_conflict");
    assert.equal(x.top().length, 1);
    writeFileSync(path.join(evidence, "original.json"), readFileSync(path.join(x.dir, "plan-run-a.json")));
    // Resume: crash after evidence, before the move.
    await assert.rejects(abandonRunningJdMarketPlan(confirm(x.dir, "run-a", digest, { hooks: { afterEvidence: async () => { throw new Error("crash"); } } })), /crash/);
    assert.equal(x.top().length, 1);
    // Different reason against the same record: conflict.
    await refusal(abandonRunningJdMarketPlan(confirm(x.dir, "run-a", digest, { reason: "另一个不同的原因" })), "evidence_conflict");
    const resumed = await abandonRunningJdMarketPlan(confirm(x.dir, "run-a", digest));
    assert.equal(resumed.stage, "abandoned");
    assert.equal((resumed as { resumed: boolean }).resumed, true);

    const second = x.write("run-b", "running");
    const target = path.join(x.dir, "operator-abandons", `run-b-${second.slice(0, 16)}`, "plan-run-b.json");
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, "pre-existing");
    await refusal(abandonRunningJdMarketPlan(confirm(x.dir, "run-b", second)), "archive_target_exists");
    assert.equal(readFileSync(target, "utf8"), "pre-existing");
    assert.deepEqual(x.top(), ["plan-run-b.json"]);
  } finally { x.cleanup(); }
});

test("the plan changing between inspection and mutation fails closed (CAS)", async () => {
  const x = setup();
  try {
    const digest = x.write("run-a", "running");
    await refusal(abandonRunningJdMarketPlan(confirm(x.dir, "run-a", digest, { hooks: { afterEvidence: async () => {
      writeFileSync(path.join(x.dir, "plan-run-a.json"), JSON.stringify({ ...plan("run-a", "running"), updatedAt: "later" }));
    } } })), "active_changed");
    assert.equal(x.top().length, 1);
  } finally { x.cleanup(); }
});
