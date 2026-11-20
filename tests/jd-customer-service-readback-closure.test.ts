import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm, lstat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { syncBuiltinESMExports } from "node:module";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { customerServiceStore } from "../lib/jd/customer-service-stores";
import { customerServicePeriod } from "../lib/jd/customer-service-workflow";
import { closeCustomerServiceConfirmedPartialImport, type ConfirmedPartialImportOptions } from "../tools/jd-customer-service-failure-closure";
import { sealCustomerServiceExecutionEvidence } from "../lib/jackyun/n8n-preflight-evidence";
import type { CustomerServiceBatchProof } from "../tools/jd-customer-service-import";
import { customerServicePlanFiles, planCustomerServiceRun, type CustomerServiceN8nPlan } from "../tools/jd-customer-service-n8n-pipeline";

const store = customerServiceStore("jd-chudian-weizhang");
const old = "11050", next = "11060";
const nodeA = "A·固定客服店铺与30天范围", nodeB = "B·双视图导出按日导入";
const sha = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const days = ["2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13"];
const batchOf = (date: string) => ({ id: `cs_${sha(Buffer.from(date))}`, fileHash: sha(Buffer.from(`f${date}`)), shopName: store.shopName,
  status: "completed", completedAt: "2026-11-10T01:00:00Z", conversationCount: 2, matchedCount: 2, sessionOnlyCount: 0, chatOnlyCount: 0, ambiguousCount: 0, warningTotalCount: 0 });
const proofOf = (date: string): CustomerServiceBatchProof => { const b = batchOf(date);
  return { ...b, batchId: b.id, date, storeKey: store.storeKey, status: "imported" }; };
function failureData(code: string) {
  return JSON.stringify([
    { resultData: "1" }, { runData: "2", error: "3", lastNodeExecuted: "4" }, { [nodeA]: "5", [nodeB]: "6" },
    { description: "7" }, nodeB, ["8"], ["9"], code, { executionStatus: "10" }, { executionStatus: "11" }, "success", "error",
  ]);
}
async function freePort() {
  return new Promise<number>((resolve, fail) => { const server = createServer(); server.once("error", fail);
    server.listen(0, "127.0.0.1", () => { const { port } = server.address() as { port: number }; server.close(() => resolve(port)); }); });
}
/** History stub: serves the listed batches in memory; never touches the network. */
function history(items: Record<string, unknown>[]) {
  return (async () => Response.json({ items, pagination: { page: 1, pageSize: 100, total: items.length, returned: items.length, truncated: false } })) as typeof fetch;
}
async function fixture(t: TestContext, options: { mutate?: (plan: CustomerServiceN8nPlan) => void } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "jd-cs-partial-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, "user"); await mkdir(path.join(home, ".n8n"), { recursive: true });
  const db = new DatabaseSync(path.join(home, ".n8n/database.sqlite"));
  db.exec("CREATE TABLE execution_entity(id INTEGER PRIMARY KEY,workflowId TEXT,status TEXT,mode TEXT,startedAt TEXT,stoppedAt TEXT,retrySuccessId TEXT,deletedAt TEXT); CREATE TABLE execution_data(executionId INTEGER,data TEXT)");
  const insert = db.prepare("INSERT INTO execution_entity VALUES(?,?,?,?,?,?,?,?)");
  insert.run(Number(old), store.workflowId, "error", "trigger", "2026-11-10 01:00:00.000", "2026-11-10 01:00:10.000", null, null);
  insert.run(Number(next), store.workflowId, "running", "trigger", "2026-11-11 01:00:00.000", null, null, null);
  db.prepare("INSERT INTO execution_data VALUES(?,?)").run(Number(old), failureData("BATCH_READBACK_FAILED_MANUAL_ACTION"));
  db.close();
  // Isolated process-local adapter; the real user home and n8n database are never opened.
  t.mock.method(os, "homedir", () => home); syncBuiltinESMExports();
  t.after(() => syncBuiltinESMExports());
  const config = JSON.parse(await readFile(new URL("../config/jd-store-accounts.json", import.meta.url), "utf8"));
  for (const entry of config.stores) entry.browser.downloadDir = path.join(root, "downloads", entry.storeKey);
  const port = await freePort();
  config.stores.find((s: { storeKey: string }) => s.storeKey === store.storeKey).browser.debugPort = port;
  await mkdir(path.join(root, "config")); await writeFile(path.join(root, "config/jd-store-accounts.json"), JSON.stringify(config));
  const files = customerServicePlanFiles(root, old, store.storeKey); await mkdir(files.directory, { recursive: true });
  const plan: CustomerServiceN8nPlan = { version: 1, storeKey: store.storeKey, shopId: store.shopId, shopName: store.shopName, executionId: old,
    period: customerServicePeriod(new Date("2026-11-10T02:00:00Z")), createdAt: "2026-11-10T01:00:00.000Z", updatedAt: "2026-11-10T01:00:10.000Z", stage: "failed",
    source: { list: { view: "list", phase: "downloaded", sourceCount: 4, savedPath: "x.xlsx", sha256: "a".repeat(64), sizeBytes: 1 },
      messages: { view: "messages", phase: "downloaded", sourceCount: 4, savedPath: "x.log", sha256: "b".repeat(64), sizeBytes: 1 } },
    dailyFiles: days.map(date => ({ date, sessionSha256: "c".repeat(64), chatSha256: "d".repeat(64), contentSha256: "e".repeat(64), conversationCount: 2 })),
    proofs: days.slice(0, 2).map(proofOf), importingDate: days[1], failureCode: "BATCH_READBACK_FAILED",
    failureBoundary: { version: 1, browserClosed: true, step: "import_days" } };
  options.mutate?.(plan);
  const bytes = Buffer.from(JSON.stringify(plan));
  await writeFile(files.plan, bytes); await writeFile(files.active, JSON.stringify({ executionId: old }));
  const receipts = path.join(files.directory, "failure-closures");
  const served = history(plan.proofs.map(p => batchOf(p.date)));
  return { root, files, plan, bytes, port, receipts, served,
    close: (request?: typeof fetch, extra: ConfirmedPartialImportOptions = {}) => closeCustomerServiceConfirmedPartialImport(root, plan, bytes, next, files.directory, { request, ...extra }),
    change: (sql: string, ...args: (string | number | null)[]) => { const d = new DatabaseSync(path.join(home, ".n8n/database.sqlite")); try { d.prepare(sql).run(...args); } finally { d.close(); } },
    prune: () => { const d = new DatabaseSync(path.join(home, ".n8n/database.sqlite")); try { d.prepare("DELETE FROM execution_entity WHERE id=?").run(old); } finally { d.close(); } },
    seal: () => sealCustomerServiceExecutionEvidence(files.directory, store.storeKey, old),
    sealPrune() { this.seal(); this.prune(); } };
}
const unresolved = /PREVIOUS_RUN_UNRESOLVED_MANUAL_ACTION/;
const noReceipt = async (dir: string) => assert.equal(await lstat(dir).then(() => true, () => false), false);

test("confirmed partial import closes with a create-only receipt and the original plan is untouched", async t => {
  const f = await fixture(t);
  const receipt = await f.close(f.served);
  assert.equal(receipt.kind, "confirmed_partial_import"); assert.equal(receipt.executionId, old);
  assert.equal(receipt.planSha256, sha(f.bytes)); assert.equal(receipt.replacementExecutionId, next);
  assert.deepEqual(receipt.proofs.map(p => p.date), days.slice(0, 2)); assert.equal(receipt.failureCode, "BATCH_READBACK_FAILED");
  const saved = JSON.parse(await readFile(path.join(f.receipts, `${old}-${sha(f.bytes)}.json`), "utf8"));
  assert.equal(saved.kind, "confirmed_partial_import"); assert.equal(typeof saved.completedAt, "string");
  assert.deepEqual(await readFile(f.files.plan), f.bytes);
  assert.deepEqual((await f.close(f.served)).proofs, receipt.proofs, "an interrupted retry reuses the receipt");
});

test("new A closes the confirmed partial import, creates the plan and advances active", async t => {
  const f = await fixture(t);
  t.mock.method(globalThis, "fetch", f.served);
  const plan = await planCustomerServiceRun(f.root, next, new Date("2026-11-11T01:00:00Z"), store.storeKey);
  assert.equal(plan.stage, "planned"); assert.equal(plan.executionId, next);
  assert.deepEqual(JSON.parse(await readFile(f.files.active, "utf8")), { executionId: next });
  assert.deepEqual(await readFile(f.files.plan), f.bytes);
  assert.equal((await readdir(f.receipts)).length, 1);
});

test("legacy 11802 shape (step export_messages with dailyFiles) is eligible", async t => {
  const f = await fixture(t, { mutate: plan => { plan.failureBoundary = { version: 1, browserClosed: true, step: "export_messages" }; } });
  assert.equal((await f.close(f.served)).kind, "confirmed_partial_import");
});

test("every unproven shape stays unresolved and writes no receipt", async t => {
  const cases: Array<[string, (plan: CustomerServiceN8nPlan) => void]> = [
    ["importingDate without proof (POST outcome unknown)", plan => { plan.importingDate = days[2]; }],
    ["importingDate missing", plan => { delete plan.importingDate; }],
    ["importingDate is not the last proof", plan => { plan.importingDate = days[0]; }],
    ["other failure code", plan => { plan.failureCode = "EXACT_BATCH_NOT_FOUND_MANUAL_ACTION"; }],
    ["mismatch failure code", plan => { plan.failureCode = "BATCH_READBACK_MISMATCH"; }],
    ["browser not closed", plan => { plan.failureBoundary = { version: 1, browserClosed: false, step: "import_days" }; }],
    ["other step", plan => { plan.failureBoundary = { version: 1, browserClosed: true, step: "export_list" }; }],
    ["no boundary", plan => { delete plan.failureBoundary; }],
    ["no proofs", plan => { plan.proofs = []; delete plan.importingDate; }],
    ["more proofs than days", plan => { plan.dailyFiles = plan.dailyFiles!.slice(0, 1); }],
    ["misaligned dates", plan => { plan.proofs[1] = proofOf(days[3]); plan.importingDate = days[3]; }],
    ["conversation count differs", plan => { plan.proofs[0].conversationCount = 9; }],
    ["proof for another store", plan => { plan.proofs[0].storeKey = "other"; }],
    ["no daily files", plan => { delete plan.dailyFiles; }],
    ["source not downloaded", plan => { plan.source.messages!.phase = "submitted"; }],
    ["source recovery claimed", plan => { plan.sourceRecovery = { approvalSha256: "f".repeat(64), originalExecutionId: "1", kind: "downloaded_pair" }; }],
    ["operator verification present", plan => { plan.operatorVerification = { authorizationId: "x", originalPlanSha256: "f".repeat(64), completedAt: "2026-11-10T00:00:00Z" }; }],
    ["store identity mismatch", plan => { plan.shopName = "wrong"; }],
  ];
  for (const [name, mutate] of cases) {
    const f = await fixture(t, { mutate });
    await assert.rejects(f.close(f.served), unresolved, name); await noReceipt(f.receipts);
  }
});

test("a failed live proof readback, a still-open browser or changed bytes never close", async t => {
  const f = await fixture(t);
  const badHash = history(f.plan.proofs.map(p => ({ ...batchOf(p.date), fileHash: "9".repeat(64) })));
  await assert.rejects(f.close(badHash), /BATCH_READBACK_MISMATCH/); await noReceipt(f.receipts);
  await assert.rejects(f.close((async () => new Response("boom", { status: 500 })) as typeof fetch), /BATCH_READBACK_FAILED/); await noReceipt(f.receipts);
  await assert.rejects(f.close(history([batchOf(days[0])])), /EXACT_BATCH_NOT_FOUND/); await noReceipt(f.receipts);
  // The plan changes while proofs are being re-verified.
  await assert.rejects(f.close((async () => { await writeFile(f.files.plan, `${f.bytes.toString()} `); return f.served(""); }) as typeof fetch), unresolved);
  await noReceipt(f.receipts);
  await writeFile(f.files.plan, f.bytes);
  const open = createServer(); await new Promise<void>(resolve => open.listen(f.port, "127.0.0.1", resolve));
  try { await assert.rejects(f.close(f.served), /CUSTOMER_SERVICE_BROWSER_STILL_OPEN/); } finally { await new Promise(resolve => open.close(resolve)); }
  await noReceipt(f.receipts);
  await writeFile(f.files.active, JSON.stringify({ executionId: "other" }));
  await assert.rejects(f.close(f.served), unresolved); await noReceipt(f.receipts);
});

test("A still refuses an ineligible failed plan and leaves active and plan alone", async t => {
  const f = await fixture(t, { mutate: plan => { plan.importingDate = days[2]; } });
  t.mock.method(globalThis, "fetch", f.served);
  await assert.rejects(planCustomerServiceRun(f.root, next, new Date("2026-11-11T01:00:00Z"), store.storeKey), unresolved);
  assert.deepEqual(JSON.parse(await readFile(f.files.active, "utf8")), { executionId: old }); assert.deepEqual(await readFile(f.files.plan), f.bytes);
});

test("failure boundary becomes import_days only after dailyFiles is saved, never earlier", async () => {
  const source = await readFile(new URL("../tools/jd-customer-service-n8n-pipeline.ts", import.meta.url), "utf8");
  const saved = source.indexOf("plan.dailyFiles = daily.files.map"), step = source.indexOf('step = "import_days"'), loop = source.indexOf("for (const day of daily.files)");
  assert.ok(saved > 0 && saved < step && step < loop);
  assert.equal(source.match(/step = "import_days"/g)?.length, 1);
  assert.equal(source.slice(0, saved).includes("import_days"), false);
  assert.ok(source.includes("step = `export_${view}`"));
});

const page503 = () => new Response("{}", { status: 503 });
test("an existing receipt is reused as stored with another replacement id; a tampered one is rejected", async t => {
  const f = await fixture(t);
  const first = await f.close(f.served);
  const file = path.join(f.receipts, `${old}-${sha(f.bytes)}.json`);
  f.change("UPDATE execution_entity SET status='error' WHERE id=?", next);
  f.change("INSERT INTO execution_entity VALUES(11061,?,'running','trigger','2026-11-12 01:00:00.000',NULL,NULL,NULL)", store.workflowId);
  const again = await closeCustomerServiceConfirmedPartialImport(f.root, f.plan, f.bytes, "11061", f.files.directory, { request: f.served });
  assert.deepEqual(again, JSON.parse(await readFile(file, "utf8")));
  assert.deepEqual(again, first); assert.equal(again.replacementExecutionId, next);
  const tampered = { ...first, proofs: first.proofs.slice(0, 1) };
  await writeFile(file, JSON.stringify(tampered));
  await assert.rejects(closeCustomerServiceConfirmedPartialImport(f.root, f.plan, f.bytes, "11061", f.files.directory, { request: f.served }), unresolved);
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), tampered, "a tampered receipt is never overwritten");
});

test("closure works when the n8n row was pruned and only the sealed evidence copy exists", async t => {
  const f = await fixture(t);
  f.sealPrune();
  assert.equal((await f.close(f.served)).kind, "confirmed_partial_import");
  // Same plan and active in the real directory; the only difference is no sealed copy.
  const g = await fixture(t); g.prune();
  await assert.rejects(g.close(g.served), /CUSTOMER_SERVICE_CLOSURE_EVIDENCE_INVALID/); await noReceipt(g.receipts);
});

test("503 then success during readback still closes inside the closure", async t => {
  const f = await fixture(t); let calls = 0; const waits: number[] = [];
  const request = (async () => (++calls === 1 ? page503() : f.served(""))) as typeof fetch;
  assert.equal((await f.close(request, { sleep: async ms => { waits.push(ms); } })).kind, "confirmed_partial_import");
  assert.deepEqual(waits, [1000]);
});

test("the deadline passing during readback, or after the last readback and before the write, rejects and writes nothing", async t => {
  const f = await fixture(t); let clock = 0; const waits: number[] = [];
  const opts = { now: () => clock, sleep: async (ms: number) => { waits.push(ms); clock += ms; }, deadline: 3500 };
  await assert.rejects(f.close((async () => page503()) as typeof fetch, opts), /BATCH_READBACK_FAILED/);
  assert.deepEqual(waits, [1000], "no sleep may cross the deadline"); await noReceipt(f.receipts);
  // Clock moves only during the LAST proof's fetch, so the per-proof check passes and only the pre-write check can stop it.
  clock = 0; let fetches = 0;
  await assert.rejects(f.close((async () => { if (++fetches === f.plan.proofs.length) clock = 99; return f.served(""); }) as typeof fetch, { now: () => clock, deadline: 50 }), unresolved);
  assert.equal(fetches, f.plan.proofs.length); await noReceipt(f.receipts);
});

test("A: a deadline lapsing after the closure leaves receipt only; the next A reuses it and advances active", async t => {
  const f = await fixture(t);
  t.mock.method(globalThis, "fetch", f.served);
  const receiptFile = path.join(f.receipts, `${old}-${sha(f.bytes)}.json`);
  const lapsed = () => (existsSync(receiptFile) ? 1e12 : 0);
  await assert.rejects(planCustomerServiceRun(f.root, next, new Date("2026-11-11T01:00:00Z"), store.storeKey, undefined, lapsed), unresolved);
  const stored = await readFile(receiptFile);
  assert.deepEqual(JSON.parse(await readFile(f.files.active, "utf8")), { executionId: old });
  assert.equal(await lstat(customerServicePlanFiles(f.root, next, store.storeKey).plan).then(() => true, () => false), false);
  f.change("UPDATE execution_entity SET status='error' WHERE id=?", next);
  f.change("INSERT INTO execution_entity VALUES(11061,?,'running','trigger','2026-11-12 01:00:00.000',NULL,NULL,NULL)", store.workflowId);
  const plan = await planCustomerServiceRun(f.root, "11061", new Date("2026-11-12T01:00:00Z"), store.storeKey);
  assert.equal(plan.executionId, "11061"); assert.deepEqual(await readFile(receiptFile), stored, "the receipt is reused, not rewritten");
  assert.equal(JSON.parse(stored.toString()).replacementExecutionId, next);
  assert.deepEqual(JSON.parse(await readFile(f.files.active, "utf8")), { executionId: "11061" });
  assert.deepEqual(await readFile(f.files.plan), f.bytes);
});
