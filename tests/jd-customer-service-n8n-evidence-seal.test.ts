import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { linkSync } from "node:fs";
import { createServer } from "node:net";
import { syncBuiltinESMExports } from "node:module";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { customerServiceStore } from "../lib/jd/customer-service-stores";
import { customerServicePeriod } from "../lib/jd/customer-service-workflow";
import { readCustomerServiceFailureEvidence, readCustomerServiceOperatorEvidence, sealCustomerServiceExecutionEvidence } from "../lib/jackyun/n8n-preflight-evidence";
import { closeCustomerServicePreSubmitFailure } from "../tools/jd-customer-service-failure-closure";
import type { CustomerServiceN8nPlan } from "../tools/jd-customer-service-n8n-pipeline";

const store = customerServiceStore("jd-chudian-weizhang");
const old = "11050", next = "11060";
const nodeA = "A·固定客服店铺与30天范围", nodeB = "B·双视图导出按日导入";

/** Same compact reference encoding n8n stores in execution_data. */
function failureData(code = "CHAT_PAGE_MISMATCH", extra: Record<string, string> = {}) {
  return JSON.stringify([
    { resultData: "1" }, { runData: "2", error: "3", lastNodeExecuted: "4" }, { [nodeA]: "5", [nodeB]: "6", ...extra },
    { description: "7" }, nodeB, ["8"], ["9"], code, { executionStatus: "10" }, { executionStatus: "11" }, "success", "error",
  ]);
}

async function fixture(t: TestContext, options: { status?: string; data?: string | null } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "jd-cs-seal-"));
  const home = path.join(root, "user"); await mkdir(path.join(home, ".n8n"), { recursive: true });
  const directory = path.join(root, "outputs/jd-customer-service-pipeline", store.storeKey); await mkdir(directory, { recursive: true });
  const database = path.join(home, ".n8n/database.sqlite");
  const change = (sql: string, ...args: (string | null)[]) => { const db = new DatabaseSync(database); try { db.prepare(sql).run(...args); } finally { db.close(); } };
  const db = new DatabaseSync(database);
  db.exec("CREATE TABLE execution_entity(id INTEGER PRIMARY KEY,workflowId TEXT,status TEXT,mode TEXT,startedAt TEXT,stoppedAt TEXT,retrySuccessId TEXT,deletedAt TEXT); CREATE TABLE execution_data(executionId INTEGER,data TEXT)");
  const insert = db.prepare("INSERT INTO execution_entity VALUES(?,?,?,?,?,?,?,?)");
  insert.run(Number(old), store.workflowId, options.status ?? "error", "trigger", "2026-11-10 01:00:00.000", "2026-11-10 01:00:10.000", null, null);
  insert.run(Number(next), store.workflowId, "running", "trigger", "2026-11-11 01:00:00.000", null, null, null);
  if (options.data !== null) db.prepare("INSERT INTO execution_data VALUES(?,?)").run(Number(old), options.data ?? failureData());
  db.close();
  // Isolated process-local adapter; the real user home and n8n database are never opened.
  t.mock.method(os, "homedir", () => home); syncBuiltinESMExports();
  t.after(() => syncBuiltinESMExports());
  const sealFile = path.join(directory, "n8n-evidence", `${old}.json`);
  const readSeal = async () => JSON.parse(await readFile(sealFile, "utf8")) as SealJson;
  const rewriteSeal = async (mutate: (value: SealJson) => void) => { const value = await readSeal(); mutate(value); await writeFile(sealFile, JSON.stringify(value)); };
  const purge = () => change("DELETE FROM execution_entity WHERE id=?", old);
  const readers = (sealed: boolean) => ({
    failure: () => readCustomerServiceFailureEvidence(store.storeKey, old, next, sealed ? directory : undefined),
    close: () => readCustomerServiceOperatorEvidence(store.storeKey, old, "close", next, sealed ? directory : undefined),
    verify: () => readCustomerServiceOperatorEvidence(store.storeKey, old, "verify", next, sealed ? directory : undefined),
  });
  return { root, directory, database, change, sealFile, readSeal, rewriteSeal, purge, readers,
    seal: () => sealCustomerServiceExecutionEvidence(directory, store.storeKey, old) };
}
const invalid = /CUSTOMER_SERVICE_CLOSURE_EVIDENCE_INVALID/;

type SealJson = { row: Record<string, unknown>; failure: Record<string, unknown>; [key: string]: unknown };
test("live row: sealing succeeds and reads are unchanged with or without the sealed directory", async t => {
  const f = await fixture(t);
  const before = { failure: f.readers(false).failure(), close: f.readers(false).close() };
  const sealed = f.seal();
  assert.ok(sealed);
  assert.equal(sealed.version, "jd-customer-service-n8n-evidence-v1");
  assert.deepEqual(sealed.row, { status: "error", startedAt: "2026-11-10 01:00:00.000", stoppedAt: "2026-11-10 01:00:10.000", retrySuccessId: null });
  assert.equal(sealed.failure?.failureCode, "CHAT_PAGE_MISMATCH");
  assert.deepEqual(await f.readSeal(), sealed);
  assert.deepStrictEqual(f.readers(true).failure(), before.failure);
  assert.deepStrictEqual(f.readers(true).close(), before.close);
  assert.deepStrictEqual(f.readers(false).failure(), before.failure);
});

test("a sealed copy that disagrees with the live row or live data is rejected", async t => {
  const f = await fixture(t); f.seal();
  await f.rewriteSeal(v => { v.row.startedAt = "2026-11-10 00:59:00.000"; });
  assert.throws(f.readers(true).failure, invalid); assert.throws(f.readers(true).close, invalid);
  assert.doesNotThrow(f.readers(false).close);
  await f.rewriteSeal(v => { v.row.startedAt = "2026-11-10 01:00:00.000"; v.failure.failureCode = "OTHER_CODE"; });
  assert.throws(f.readers(true).failure, invalid);
  assert.doesNotThrow(f.readers(true).close, "operator path compares the row only");
});

test("pruned row: sealed copy yields field-for-field identical evidence; no seal still fails", async t => {
  for (const prune of ["delete", "soft"] as const) {
    const f = await fixture(t);
    const before = { failure: f.readers(false).failure(), close: f.readers(false).close() };
    f.seal();
    if (prune === "delete") f.purge(); else f.change("UPDATE execution_entity SET deletedAt='2026-11-24 00:00:00.000' WHERE id=?", old);
    assert.deepStrictEqual(f.readers(true).failure(), before.failure);
    assert.deepStrictEqual(f.readers(true).close(), before.close);
    assert.throws(f.readers(false).failure, invalid); assert.throws(f.readers(false).close, invalid);
  }
  const bare = await fixture(t); bare.purge();
  assert.throws(bare.readers(true).failure, invalid); assert.throws(bare.readers(true).close, invalid);
});

test("sealed copy with another store, execution or null failure is not accepted", async t => {
  const f = await fixture(t); f.seal(); f.purge();
  const original = await f.readSeal();
  for (const mutate of [(v: SealJson) => { v.storeKey = "jd-yiyong-director"; }, (v: SealJson) => { v.executionId = "11051"; },
    (v: SealJson) => { v.workflowId = "JdCustomerService2026"; }, (v: SealJson) => { v.version = "v0"; }, (v: SealJson) => { v.extra = 1; },
    (v: SealJson) => { v.row.retrySuccessId = "11070"; }, (v: SealJson) => { v.failure.bStatus = "success"; }]) {
    await writeFile(f.sealFile, JSON.stringify(original)); await f.rewriteSeal(mutate);
    assert.throws(f.readers(true).close, invalid); assert.throws(f.readers(true).failure, invalid);
  }
  await writeFile(f.sealFile, JSON.stringify({ ...original, failure: null }));
  assert.throws(f.readers(true).failure, invalid);
  assert.doesNotThrow(f.readers(true).close, "operator closure does not need the failure part");
  linkSync(f.sealFile, `${f.sealFile}.alias`);
  assert.throws(f.readers(true).close, invalid, "multi-link sealed files are rejected");
});

test("execution_data purged but row alive: failure evidence comes from the sealed copy", async t => {
  const f = await fixture(t); const before = f.readers(false).failure(); f.seal();
  f.change("DELETE FROM execution_data WHERE executionId=?", old);
  assert.deepStrictEqual(f.readers(true).failure(), before);
  assert.throws(f.readers(false).failure);
  // Rows were never purged, so the operator path still reads them live.
  assert.doesNotThrow(f.readers(true).close);
});

test("failure part is null when the data is undecodable; success executions seal without failure", async t => {
  const bad = await fixture(t, { data: failureData("lower_case") });
  assert.equal(bad.seal()?.failure, null);
  bad.purge();
  assert.throws(bad.readers(true).failure, invalid);
  assert.equal(bad.readers(true).close().status, "error");
  const ok = await fixture(t, { status: "success", data: null });
  const sealed = ok.seal(); assert.equal(sealed?.row.status, "success"); assert.equal(sealed?.failure, null);
  const live = ok.readers(false).verify(); ok.purge();
  assert.deepStrictEqual(ok.readers(true).verify(), live);
  assert.throws(ok.readers(true).close, invalid, "close still demands an error terminal state");
});

test("sealing is idempotent, never overwrites, and treats missing or running rows safely", async t => {
  const f = await fixture(t);
  const first = f.seal(); const again = f.seal();
  assert.deepStrictEqual(again, first);
  const bytes = await readFile(f.sealFile, "utf8");
  f.change("UPDATE execution_entity SET stoppedAt='2026-11-10 01:05:00.000' WHERE id=?", old);
  assert.throws(f.seal, /SEAL_CONFLICT/);
  assert.equal(await readFile(f.sealFile, "utf8"), bytes);
  assert.equal(sealCustomerServiceExecutionEvidence(f.directory, store.storeKey, "99999"), null);
  f.change("UPDATE execution_entity SET deletedAt='2026-11-24 00:00:00.000' WHERE id=?", old);
  assert.equal(f.seal(), null);
  const running = await fixture(t, { status: "running" });
  assert.throws(running.seal, invalid);
  assert.throws(() => sealCustomerServiceExecutionEvidence(running.directory, store.storeKey, "../1"), invalid);
});

test("the replacement and no-other-active checks always use the live database", async t => {
  const f = await fixture(t); f.seal(); f.purge();
  assert.doesNotThrow(f.readers(true).close);
  f.change("UPDATE execution_entity SET status='success' WHERE id=?", next);
  assert.throws(f.readers(true).close, invalid); assert.throws(f.readers(true).failure, invalid);
  f.change("UPDATE execution_entity SET status='running' WHERE id=?", next);
  f.change("DELETE FROM execution_entity WHERE id=?", next);
  assert.throws(f.readers(true).close, invalid); assert.throws(f.readers(true).failure, invalid);
  f.change("INSERT INTO execution_entity VALUES(11060,?,'running','trigger','2026-11-11 01:00:00.000',NULL,NULL,NULL)", store.workflowId);
  f.change("INSERT INTO execution_entity VALUES(11061,?,'running','trigger','2026-11-11 01:01:00.000',NULL,NULL,NULL)", store.workflowId);
  assert.throws(f.readers(true).close, invalid); assert.throws(f.readers(true).failure, invalid);
});

async function freePort() {
  return new Promise<number>((resolve, fail) => { const server = createServer(); server.once("error", fail);
    server.listen(0, "127.0.0.1", () => { const { port } = server.address() as { port: number }; server.close(() => resolve(port)); }); });
}

test("end to end: pre-submit failure closure completes after n8n pruned the original execution", async t => {
  const f = await fixture(t);
  const config = JSON.parse(await readFile(new URL("../config/jd-store-accounts.json", import.meta.url), "utf8"));
  for (const entry of config.stores) entry.browser.downloadDir = path.join(f.root, "downloads", entry.storeKey);
  const entry = config.stores.find((s: { storeKey: string }) => s.storeKey === store.storeKey);
  entry.browser.debugPort = await freePort();
  await mkdir(path.join(f.root, "config")); await writeFile(path.join(f.root, "config/jd-store-accounts.json"), JSON.stringify(config));
  const plan: CustomerServiceN8nPlan = { version: 1, storeKey: store.storeKey, shopId: store.shopId, shopName: store.shopName, executionId: old,
    period: customerServicePeriod(new Date("2026-11-10T02:00:00Z")), createdAt: "2026-11-10T01:00:00.000Z", updatedAt: "2026-11-10T01:00:10.000Z",
    stage: "failed", source: {}, proofs: [], failureCode: "CHAT_PAGE_MISMATCH", failureBoundary: { version: 1, browserClosed: true, step: "export_messages" } };
  const bytes = Buffer.from(JSON.stringify(plan));
  await writeFile(path.join(f.directory, `${old}.json`), bytes); await writeFile(path.join(f.directory, "active.json"), JSON.stringify({ executionId: old }));
  const live = f.readers(false).failure();
  f.seal(); f.purge();
  await assert.rejects(closeCustomerServicePreSubmitFailure(f.root, plan, bytes, next, path.join(f.root, "elsewhere")));
  const receipt = await closeCustomerServicePreSubmitFailure(f.root, plan, bytes, next, f.directory);
  assert.equal(receipt.outcome, "failed_closed_before_submit");
  assert.deepStrictEqual(receipt.evidence, live);
});
