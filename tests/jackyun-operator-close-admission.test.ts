import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os, { tmpdir } from "node:os";
import { syncBuiltinESMExports } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { assertJackyunCloseAdmission } from "../lib/jackyun/operator-close-admission";
import { jackyunWorkflowId } from "../lib/jackyun/preflight-recovery";
import { controlDigest, recoveryProtocol } from "../lib/jackyun/recovery-control";
import { retryContextProtocol } from "../lib/jackyun/n8n-retry-context";

const authorizationId = "11111111-2222-3333-4444-555555555555";
const closedPattern = /JACKYUN_OPERATOR_CLOSED/;
const revokedPattern = /原人工派发已撤销/;

/** Same flatted-style pooling n8n uses: every string becomes a pool reference. */
function pack(value: unknown) {
  const pool: unknown[] = [null];
  const encode = (x: unknown): unknown => typeof x === "string" ? String(pool.push(x) - 1)
    : Array.isArray(x) ? x.map(encode) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, encode(v)])) : x;
  pool[0] = encode(value);
  return JSON.stringify(pool);
}

type Entry = { id: number; mode: "manual" | "trigger" | "webhook"; request: unknown; anchorExecutionId?: string; humanAuthorizationId?: string;
  retryDispatchExecutionId?: string; withData?: boolean;
  /** Live shape carries the fixed-plan fields (version/originalExecutionId/scheduledAt); false is the bare smoke-style anchor without version. */ plan?: boolean };

async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), "jackyun-close-admission-"));
  t.after(async () => { assert(path.basename(root).startsWith("jackyun-close-admission-")); await rm(root, { recursive: true, force: true }); });
  const user = path.join(root, "user"), mutable = path.join(root, "mutable");
  await mkdir(path.join(user, ".n8n"), { recursive: true }); await mkdir(mutable);
  const db = new DatabaseSync(path.join(user, ".n8n/database.sqlite"));
  db.exec("CREATE TABLE execution_entity(id INTEGER PRIMARY KEY,workflowId TEXT,status TEXT,mode TEXT,startedAt TEXT,stoppedAt TEXT,retrySuccessId TEXT,deletedAt TEXT);"
    + "CREATE TABLE execution_data(executionId INTEGER,data TEXT,workflowData TEXT)");
  // The live n8n 2.x execution record never persists workflow meta, so none is stored here.
  const definition = JSON.stringify({ id: jackyunWorkflowId });
  const add = (entry: Entry) => {
    db.prepare("INSERT INTO execution_entity VALUES(?,?,?,?,?,?,?,?)").run(entry.id, jackyunWorkflowId, "error", entry.mode, "2026-11-18 01:00:00.000", "2026-11-18 01:05:00.000", null, null);
    if (entry.withData === false) return;
    const json = { executionId: String(entry.id), workflowId: jackyunWorkflowId, jackyunRecovery: entry.request,
      ...(entry.humanAuthorizationId ? { humanAuthorizationId: entry.humanAuthorizationId } : {}),
      ...(entry.retryDispatchExecutionId ? { retryDispatchExecutionId: entry.retryDispatchExecutionId } : {}),
      ...(entry.plan === false ? {} : { version: retryContextProtocol, originalExecutionId: entry.anchorExecutionId ?? String(entry.id), scheduledAt: "2026-11-17T00:10:00.000Z" }) };
    const anchor = { executionStatus: "success", data: { main: [[{ json }]] } };
    db.prepare("INSERT INTO execution_data VALUES(?,?,?)").run(entry.id, pack({ resultData: { runData: { "固定原执行计划时间": [anchor] } } }), definition);
  };
  const check = (executionId: string) => {
    // Mocks only this isolated test process; production has no path override.
    const mocked = t.mock.method(os, "homedir", () => user); syncBuiltinESMExports();
    try { assertJackyunCloseAdmission(mutable, executionId); }
    finally { mocked.mock.restore(); syncBuiltinESMExports(); }
  };
  const authorization = async (status: string) => {
    const dir = path.join(mutable, "outputs/jackyun-export-first/human-authorizations");
    await mkdir(dir, { recursive: true }); await writeFile(path.join(dir, `${authorizationId}.json`), JSON.stringify({ status }));
  };
  const close = async (logical: string, source: string, failed: string) => {
    const dir = path.join(mutable, "outputs/jackyun-export-first/operator-closures", logical);
    await mkdir(dir, { recursive: true });
    const activeBytes = JSON.stringify({ runId: `n8n-export-first-${logical}`, executionId: logical });
    const intent = { version: "jackyun-operator-close-intent-v1", authorizationId, at: "2026-11-18T02:00:00.000Z",
      target: { logicalExecutionId: logical, failedExecutionId: failed, sourceExecutionId: source, planDigest: "a".repeat(64), controlDigest: "b".repeat(64),
        activeDigest: controlDigest(JSON.parse(activeBytes)), evidenceDigest: "c".repeat(64) },
      authority: {}, activeBytes, files: {}, modules: [] };
    await writeFile(path.join(dir, "intent.json"), JSON.stringify(intent));
    await writeFile(path.join(dir, "closed.json"), JSON.stringify({ version: "jackyun-operator-closed-v1", intentDigest: controlDigest(intent), authorizationId }));
  };
  return { add, check, authorization, close, finish: () => db.close() };
}

const fresh = { version: recoveryProtocol, kind: "new" };
const retry = (logical: string, failed: string) => ({ version: recoveryProtocol, kind: "retry", logicalExecutionId: logical, failedExecutionId: failed });

test("a manual or trigger fresh run anchored on itself is admitted", async t => {
  const f = await fixture(t);
  f.add({ id: 9000, mode: "manual", request: fresh }); f.add({ id: 9001, mode: "trigger", request: fresh });
  f.check("9000"); f.check("9001"); f.finish();
});

test("a human retry webhook descendant is admitted even though the persisted workflowData has no meta", async t => {
  const f = await fixture(t);
  f.add({ id: 9000, mode: "manual", request: fresh });
  // Anchor points at the original run, not itself: the shape the old else-branch refused.
  f.add({ id: 9002, mode: "webhook", request: retry("9000", "9001"), humanAuthorizationId: authorizationId, anchorExecutionId: "9000" });
  await f.authorization("active");
  f.check("9002"); f.finish();
});

test("an automatic retry webhook with an exact dispatcher binding is admitted", async t => {
  const f = await fixture(t);
  f.add({ id: 9003, mode: "webhook", request: retry("9000", "9001"), retryDispatchExecutionId: "9002", anchorExecutionId: "9000" });
  f.check("9003"); f.finish();
});

test("a descendant whose logical or failed run was operator-closed is refused", async t => {
  for (const [logical, source, failed] of [["9000", "9000", "9000"], ["9001", "9002", "9002"]]) {
    const f = await fixture(t);
    // Retry binds logical 9000 / failed 9002; the closure matches one of the two.
    f.add({ id: 9003, mode: "webhook", request: retry("9000", "9002"), humanAuthorizationId: authorizationId, anchorExecutionId: "9000" });
    await f.authorization("active"); await f.close(logical, source, failed);
    assert.throws(() => f.check("9003"), closedPattern); f.finish();
  }
});

test("a revoked human authorization refuses both retry and new webhook executions", async t => {
  for (const request of [retry("9000", "9001"), fresh]) {
    const f = await fixture(t);
    f.add({ id: 9002, mode: "webhook", request, humanAuthorizationId: authorizationId, anchorExecutionId: request.kind === "retry" ? "9000" : undefined });
    await f.authorization("revoked");
    assert.throws(() => f.check("9002"), revokedPattern); f.finish();
  }
});

test("an unreadable entry fails closed", async t => {
  const f = await fixture(t);
  f.add({ id: 9000, mode: "manual", request: fresh, withData: false, plan: false });
  assert.throws(() => f.check("9000"), /入口证据缺失/);
  assert.throws(() => f.check("9999"), /执行身份不可核实/);
  assert.throws(() => f.check("not-an-id"), /execution 无效/);
  f.finish();
});

test("an anchor without a version field is judged by the entry rules, not rejected for lacking it", async t => {
  const f = await fixture(t);
  f.add({ id: 9002, mode: "webhook", request: fresh, humanAuthorizationId: authorizationId, plan: false });
  f.add({ id: 9004, mode: "webhook", request: retry("9000", "9001"), humanAuthorizationId: authorizationId, anchorExecutionId: "9000", plan: false });
  await f.authorization("active");
  f.check("9002"); f.check("9004");
  await f.authorization("revoked");
  assert.throws(() => f.check("9002"), revokedPattern); f.finish();
});
