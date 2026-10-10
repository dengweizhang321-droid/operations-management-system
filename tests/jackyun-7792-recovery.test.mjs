import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyRecovery, assertEvidence, assertUploadProof, buildSalesReceipt, incident } from "../tools/jackyun-7792-recovery.mjs";
import { createJackyunInputContractHash, jackyunExportFirstPolicyVersion } from "../lib/jackyun/run-contract.ts";

const now = "2026-10-10T03:00:00.000Z";
const hash = value => createHash("sha256").update(value).digest("hex");
const clone = value => structuredClone(value);
const evidence = () => ({ executionId: incident.executionId, workflowId: incident.workflowId, status: "error",
  activeExecutions: 0, retrySuccessId: null, startedAt: incident.startedAt, stoppedAt: incident.stoppedAt,
  executionDataSha256: incident.dataSha256, error: incident.error, httpCode: "500",
  lastNode: "D·统一导入运营管理系统", requestUrl: "http://127.0.0.1:5791/jackyun/export-first/import",
  runNodes: ["手动运行", "固定原执行计划时间", "领取共享 helper", "helper 领取成功？", "A·固定采集日和销售日期",
    "B·接口校验与五表下载", "C·五表完整校验和导入演练", "D·统一导入运营管理系统"] });
const uploadProof = () => ({ version: 1, readOnly: true, actorVerified: true, uploadId: incident.uploadId,
  batchId: incident.salesBatch, normalizedSessionId: incident.normalizedSessionId, normalizedStatus: "completed",
  rawFileHash: incident.outputSha, fileSizeBytes: incident.outputBytes, startDate: incident.start, endDate: incident.end,
  channels: null, ownerGeneration: 1, claimEligible: true, observedAt: now, expiresAt: "2026-10-11T00:00:00Z",
  status: "processing", resultBatchId: null, payloadSha256: incident.outputSha, updatedAt: "2026-10-10T01:54:36Z" });

function fixture(root = path.join(os.tmpdir(), "synthetic-7792")) {
  const formal = path.join(root, "outputs/jackyun-import-runs", incident.runId);
  const handoff = { filePath: path.join(root, "download/sales.xlsx"), expectedSourceRows: 43131,
    navigationIntentAt: "2026-10-10T01:51:00Z", queryIntentAt: "2026-10-10T01:51:01Z",
    tableStableAt: "2026-10-10T01:51:02Z", exportIntentAt: "2026-10-10T01:51:03Z", downloadEventAt: "2026-10-10T01:51:04Z",
    downloadProvenance: { completedAt: "2026-10-10T01:51:04Z", sha256: "a".repeat(64), bytes: 123 } };
  const plan = { version: 2, protocol: jackyunExportFirstPolicyVersion, runId: incident.runId,
    executionId: incident.executionId, phase: "importing", runDate: incident.date, asOfDate: incident.end,
    salesStartDate: incident.start, baseUrl: incident.baseUrl, exports: { combos: { fileSha256: "b".repeat(64) } } };
  const inventory = { batchId: incident.inventoryBatch, salesCostSourcePath: path.join(formal, "raw/inventory.xlsx"), salesCostSourceSha256: "c".repeat(64) };
  const contract = { runId: plan.runId, policyVersion: plan.protocol, module: "sales", rawSha256: "a".repeat(64),
    asOfDate: incident.end, salesStartDate: incident.start, expectedSourceRows: handoff.expectedSourceRows,
    costOutputSha256: inventory.salesCostSourceSha256, costSourcePath: inventory.salesCostSourcePath,
    exportStart: handoff.exportIntentAt, downloadEventAt: handoff.downloadEventAt, downloadProvenance: handoff.downloadProvenance,
    handoffEvidence: { navigationIntentAt: handoff.navigationIntentAt, queryIntentAt: handoff.queryIntentAt,
      tableStableAt: handoff.tableStableAt, exportIntentAt: handoff.exportIntentAt, downloadEventAt: handoff.downloadEventAt }, baseUrl: plan.baseUrl };
  const manifest = { runId: plan.runId, modules: { inventory,
    sales: { status: "failed", module: "sales", sourceSha256: "a".repeat(64), inputContractHash: createJackyunInputContractHash(contract) } } };
  const failedAudit = { runId: plan.runId, module: "sales", status: "failed", error: { stage: "sales_filter_cost_match_import_verify", message: incident.error },
    timings: { failedAt: incident.failedAt }, source: { path: handoff.filePath, sha256: "a".repeat(64), downloadProvenance: handoff.downloadProvenance } };
  const child = { ok: false, runId: incident.salesChild, policyVersion: "fixture-policy", import: null, postImportVerification: null,
    failure: { code: "IMPORT_FAILED", stage: "chunk_upload_and_import" },
    sources: { rawDownload: { path: path.join(formal, "raw/sales.xlsx"), sha256: "a".repeat(64) }, costSource: { sha256: "c".repeat(64) } },
    output: { path: path.join(formal, "sales", incident.salesChild, "processed.xlsx"), sha256: incident.outputSha, bytes: incident.outputBytes },
    filtering: { retainedRows: incident.salesRows }, sourceCountContract: { semantic: "xlsx_nonblank_data_rows", expected: 43131, actual: 43131, verified: true },
    validation: {}, period: { startDate: incident.start, endDate: incident.end, endExclusiveDateTime: "2026-10-10 00:00:00" } };
  const verification = { policyVersion: child.policyVersion, period: { startDate: incident.start, endDate: incident.end, endExclusive: incident.date },
    batch: { id: incident.salesBatch, status: "completed", rowCount: incident.salesRows, warningCount: 118,
      totals: { rawFileHash: incident.outputSha, systemCost: { sourceBatchId: incident.inventoryBatch } } },
    stats: { rowCount: incident.salesRows, excludedWarehouseRows: 0, rowsNotOwnedByBatch: 0, minShipTime: incident.start, maxShipTime: incident.end }, nonWhitelistChannels: [] };
  return { root, formal, plan, manifest, failedAudit, child, handoff, verification, reconciledAt: now };
}

test("exact failed n8n identity is mandatory", () => {
  assert.doesNotThrow(() => assertEvidence(evidence()));
  for (const change of [{ executionId: "7781" }, { workflowId: "other" }, { status: "running" }, { activeExecutions: 1 },
    { retrySuccessId: "9000" }, { executionDataSha256: "f".repeat(64) }, { lastNode: "B" }, { runNodes: ["D·统一导入运营管理系统"] }]) {
    assert.throws(() => assertEvidence({ ...evidence(), ...change }));
  }
});

test("upload proof rejects uncommitted, fresh-owner, stale-proof and cross-scope states", () => {
  assert.doesNotThrow(() => assertUploadProof(uploadProof(), now));
  for (const change of [{ readOnly: false }, { actorVerified: false }, { normalizedStatus: "processing" }, { rawFileHash: "f".repeat(64) },
    { channels: ["other"] }, { startDate: "2026-08-25" }, { claimEligible: false }, { ownerGeneration: 0 },
    { updatedAt: "2026-10-10T02:59:00Z" }, { observedAt: "2026-10-10T02:55:00Z" }, { observedAt: "2026-10-10T03:01:00Z" },
    { expiresAt: now }, { payloadSha256: "f".repeat(64) }, { status: "completed", resultBatchId: "other" }]) {
    assert.throws(() => assertUploadProof({ ...uploadProof(), ...change }, now));
  }
  assert.doesNotThrow(() => assertUploadProof({ ...uploadProof(), status: "completed", resultBatchId: incident.salesBatch }, now));
});

test("sales receipt is derived from committed facts, preserving original failure objects", () => {
  const input = fixture(), before = clone(input);
  const result = buildSalesReceipt(input);
  assert.deepEqual(input, before);
  assert.equal(result.module.status, "completed");
  assert.equal(result.parentAudit.import.result.postImportVerified, true);
  assert.equal(result.childAudit.import.recoveredReceipt, true);
  assert.equal(result.parentAudit.recovery.originalFailedAt, incident.failedAt);
  assert.equal(result.childAudit.failure, undefined);
  assert.equal(result.childAudit.postImportVerification.batch.id, incident.salesBatch);
});

test("sales receipt rejects ownership, file, policy, cost, row and date drift", () => {
  const mutations = [
    f => { f.verification.stats.rowsNotOwnedByBatch = 1; },
    f => { f.verification.batch.id = "other"; },
    f => { f.verification.batch.totals.rawFileHash = "f".repeat(64); },
    f => { f.verification.batch.totals.systemCost.sourceBatchId = "other"; },
    f => { f.verification.policyVersion = "other"; },
    f => { f.verification.stats.rowCount--; },
    f => { f.verification.nonWhitelistChannels = ["other"]; },
    f => { f.child.sourceCountContract.semantic = "estimated"; },
    f => { f.child.period.startDate = "2026-08-25"; },
    f => { f.child.sources.costSource.sha256 = "d".repeat(64); },
    f => { f.child.output.sha256 = "f".repeat(64); },
    f => { f.manifest.modules.sales.status = "prepared"; },
    f => { f.manifest.modules.sales.inputContractHash = "f".repeat(64); },
    f => { f.failedAudit.timings.failedAt = now; },
  ];
  for (const mutate of mutations) { const f = fixture(); mutate(f); assert.throws(() => buildSalesReceipt(f)); }
});

async function applyFixture(t, overrides = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "jackyun-7792-test-"));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.match(path.basename(root), /^jackyun-7792-test-/);
    await rm(root, { recursive: true, force: true });
  });
  const f = fixture(root), pipeline = path.join(root, "outputs/jackyun-export-first"), events = path.join(root, "outputs/jackyun-browser-events", incident.runId);
  const write = async (file, data) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(data)); };
  await write(path.join(pipeline, incident.runId + ".json"), f.plan);
  await write(path.join(f.formal, "run-manifest.json"), f.manifest);
  await write(path.join(f.formal, "audit/sales.json"), f.failedAudit);
  await write(path.join(f.formal, "sales", incident.salesChild, "audit.json"), f.child);
  await write(path.join(root, "config/jackyun-export-first-policy.json"), { browser: { allowedDownloadHosts: [], downloadDirectory: path.join(root, "download") } });
  await write(path.join(events, "04-sales.json"), f.handoff);
  await write(path.join(events, "05-combos.json"), { ...f.handoff, filePath: path.join(root, "download/combos.xlsx") });
  const combo = { id: "old-combos", rowCount: 5, ownedRowCount: 5, contentHash: "c", rawFileHash: "r" };
  const approved = { version: 1, reason: "audited_7792_committed_sales_receipt_and_combos", root, createdAt: now,
    sourceState: { salesRevision: "50:46", salesBatch: incident.salesBatch, combo } };
  const calls = [];
  const deps = { now: () => now, inspect: async () => approved, evidence,
    request: async (url, options = {}) => {
      calls.push({ url, method: options.method ?? "GET", body: options.body });
      if (options.method === "POST") return Response.json({ ok: true, batch: f.verification.batch });
      if (url.endsWith("/health")) return Response.json({ ok: true, busy: false, activeWorkflow: null });
      if (url.includes("sales/verify")) return Response.json(f.verification);
      if (url.includes("data-health")) return Response.json({ latestBatch: { id: incident.salesBatch }, coverage: { cutoffDate: incident.end }, revision: "50:46" });
      if (url.includes("source=combos")) return Response.json({ items: [{ ...combo, status: "completed", totals: { contentHash: combo.contentHash, rawFileHash: combo.rawFileHash } }] });
      throw new Error("Unexpected request");
    }, verifyArtifact: async ({ module }) => ({ batchId: module === "sales" ? incident.salesBatch : module, rowCount: 10, warningCount: 0 }),
    runCombo: async () => {
      calls.push({ method: "COMBO" });
      const m = JSON.parse(await readFile(path.join(f.formal, "run-manifest.json"), "utf8"));
      assert.equal(m.modules.sales.status, "completed");
      for (const name of ["products", "inventory", "inventory_age", "combos"]) {
        m.modules[name] = { status: "completed", outputSha256: "f".repeat(64) };
        await write(path.join(f.formal, "audit", name + ".json"), { import: { result: {} } });
      }
      await write(path.join(f.formal, "run-manifest.json"), m);
    }, verifyPublished: async ({ modules }) => ({ ok: true, modules }), ...overrides };
  return { ...f, pipeline, approved, deps, calls, digest: hash(JSON.stringify(approved)) };
}

test("only original complete is posted; originals archived; combo follows sales proof; repeat rejected", async t => {
  const f = await applyFixture(t);
  const result = await applyRecovery(f.approved, f.digest, uploadProof(), f.deps);
  assert.equal(result.originalN8nStatus, "error");
  assert.equal(result.results.length, 5);
  const posts = f.calls.filter(c => c.method === "POST");
  assert.equal(posts.length, 1);
  assert.deepEqual(JSON.parse(posts[0].body), { action: "complete", uploadId: incident.uploadId, expectedStartDate: incident.start, expectedEndDate: incident.end });
  assert.equal(f.calls.filter(c => c.method === "COMBO").length, 1);
  const archive = path.join(f.pipeline, "receipt-recoveries/7792");
  assert.deepEqual(JSON.parse(await readFile(path.join(archive, "sales.failed.json"), "utf8")), f.failedAudit);
  assert.equal(JSON.parse(await readFile(path.join(f.pipeline, incident.runId + ".json"), "utf8")).phase, "completed");
  await assert.rejects(applyRecovery(f.approved, f.digest, uploadProof(), f.deps));
  assert.equal(f.calls.filter(c => c.method === "POST").length, 1);
});

test("unknown complete response retains failure and prevents combo, plan completion and repeat", async t => {
  const f = await applyFixture(t);
  f.deps.request = async (_url, options) => { if (options.method === "POST") throw new Error("timeout"); throw new Error("unexpected"); };
  await assert.rejects(applyRecovery(f.approved, f.digest, uploadProof(), f.deps), /timeout/);
  assert.equal(f.calls.filter(c => c.method === "COMBO").length, 0);
  assert.equal(JSON.parse(await readFile(path.join(f.pipeline, incident.runId + ".json"), "utf8")).phase, "importing");
  assert.deepEqual(JSON.parse(await readFile(path.join(f.formal, "audit/sales.json"), "utf8")), f.failedAudit);
  await assert.rejects(applyRecovery(f.approved, f.digest, uploadProof(), f.deps));
});

test("changed proposal or expired approval causes zero writes and zero network mutations", async t => {
  const f = await applyFixture(t);
  await assert.rejects(applyRecovery(f.approved, "f".repeat(64), uploadProof(), f.deps));
  await assert.rejects(applyRecovery(f.approved, f.digest, uploadProof(), { ...f.deps, now: () => "2026-10-10T04:00:00Z" }));
  await assert.rejects(applyRecovery(f.approved, f.digest, uploadProof(), { ...f.deps, inspect: async () => ({ ...f.approved, drift: true }) }));
  assert.equal(f.calls.length, 0);
});

test("file drift after inspection is refused before the sales POST", async t => {
  const f = await applyFixture(t), file = path.join(f.formal, "audit/sales.json");
  f.approved.files = { [file]: hash(await readFile(file)) };
  f.digest = hash(JSON.stringify(f.approved));
  f.deps.inspect = async () => { await writeFile(file, JSON.stringify({ ...f.failedAudit, changed: true })); return f.approved; };
  await assert.rejects(applyRecovery(f.approved, f.digest, uploadProof(), f.deps), /原始文件发生变化/);
  assert.equal(f.calls.length, 0);
});

test("two concurrent applies produce at most one sales complete and one combo import", async t => {
  const f = await applyFixture(t);
  const results = await Promise.allSettled([applyRecovery(f.approved, f.digest, uploadProof(), f.deps), applyRecovery(f.approved, f.digest, uploadProof(), f.deps)]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(f.calls.filter(c => c.method === "POST").length, 1);
  assert.equal(f.calls.filter(c => c.method === "COMBO").length, 1);
});

test("an already completed original upload needs no sales POST", async t => {
  const f = await applyFixture(t);
  await applyRecovery(f.approved, f.digest, { ...uploadProof(), status: "completed", resultBatchId: incident.salesBatch }, f.deps);
  assert.equal(f.calls.filter(c => c.method === "POST").length, 0);
  assert.equal(f.calls.filter(c => c.method === "COMBO").length, 1);
});
