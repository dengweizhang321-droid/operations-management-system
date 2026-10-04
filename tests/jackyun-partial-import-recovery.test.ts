import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { auditedPartialImport5478 as a, assertPartialImportEvidence, inspectPartialImportRecovery,
  publishPartialImportRecovery, claimPartialImportRecovery, verifyPartialImportGate, assertPartialFailedImportRetry } from "../lib/jackyun/partial-import-recovery";
import { recoverySha, jackyunWorkflowId, type PreflightEvidence } from "../lib/jackyun/preflight-recovery";
import { jackyunModuleOrder } from "../lib/jackyun/post-download";
import { jackyunExportFirstPolicyVersion } from "../lib/jackyun/run-contract";
import { assertExportFirstAction, runJackyunExportFirstAction, type JackyunExportFirstPlan } from "../tools/jackyun-export-first-pipeline";
import { createXlsxWorkbookBytes } from "../lib/imports/xlsx-write";
import { runJackyunDownload, type JackyunDownloadRunOptions } from "../tools/jackyun-download-runner";

const now = "2026-10-04T03:00:00.000Z";
const evidence: PreflightEvidence = { executionId: a.executionId, startedAt: a.startedAt, stoppedAt: a.stoppedAt,
  workflowId: jackyunWorkflowId, status: "error", executionDataSha256: a.executionDataSha256, error: a.error,
  activeExecutions: 0, retrySuccessId: null, lastNode: "D·统一导入运营管理系统", httpCode: "500",
  requestUrl: "http://127.0.0.1:5791/jackyun/export-first/import", runNodes: ["每天本机时间 00:10", "固定原执行计划时间",
    "领取共享 helper", "helper 领取成功？", "A·固定采集日和销售日期", "B·接口校验与五表下载", "C·五表完整校验和导入演练", "D·统一导入运营管理系统"] };
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "jackyun-5478-")), base = path.join(root, "outputs/jackyun-export-first");
  const formal = path.join(root, "outputs/jackyun-import-runs", a.runId), validation = path.join(root, "outputs/jackyun-export-first-validation", a.runId);
  const events = path.join(root, "outputs/jackyun-browser-events", a.runId), downloads = path.join(root, "downloads");
  const save = async (file: string, value: unknown) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(value)); };
  const exports: Record<string, { handoffSha256: string; fileSha256: string; bytes: number }> = {};
  const prepared: Record<string, { module: string; status: string; batchId: null; inputContractHash: string }> = {};
  const controller: Record<string, unknown> = {}, modules: Record<string, Record<string, unknown>> = {}, files: string[] = [];
  for (const [index, module] of jackyunModuleOrder.entries()) {
    const file = path.join(downloads, "jackyun", a.runId, module, "synthetic.xlsx"), raw = Buffer.from("synthetic " + module);
    await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, raw); files.push(file);
    const event = { schemaVersion: 2, runId: a.runId, module, filePath: file, policyVersion: jackyunExportFirstPolicyVersion };
    await save(path.join(events, `${String(index + 1).padStart(2, "0")}-${module}.json`), event);
    exports[module] = { handoffSha256: recoverySha(JSON.stringify(event)), fileSha256: recoverySha(raw), bytes: raw.length };
    controller[module] = { status: "handed_off", filePath: file, handoffSha256: exports[module].handoffSha256 };
    prepared[module] = { module, status: "prepared", batchId: null, inputContractHash: "a".repeat(64) };
    if (index < 3) {
      modules[module] = { module, status: "completed", batchId: "synthetic-" + module };
      await save(path.join(formal, "audit", module + ".json"), { import: { result: { djangoReceipt: { contentHash: "c".repeat(64), rawFileHash: exports[module].fileSha256 } } } });
    }
  }
  const failed = { module: "sales", status: "failed", sourceSha256: exports.sales.fileSha256, inputContractHash: "b".repeat(64),
    startedAt: a.salesStartedAt, completedAt: a.failedAt, error: a.error };
  modules.sales = failed;
  const audit = { version: 1, runId: a.runId, module: "sales", status: "failed", source: { sha256: exports.sales.fileSha256 },
    error: { stage: "sales_filter_cost_match_import_verify", message: a.error }, timings: { startedAt: a.salesStartedAt, failedAt: a.failedAt } };
  const plan = { version: 2, protocol: jackyunExportFirstPolicyVersion, executionId: a.executionId, runId: a.runId,
    runDate: a.runDate, asOfDate: a.endDate, salesStartDate: a.startDate, phase: "importing", exportTransport: "session_api_v1",
    baseUrl: "http://localhost:3000", createdAt: "2026-10-02T16:10:02.394Z", exports };
  const planPath = path.join(base, a.runId + ".json"), manifestPath = path.join(formal, "run-manifest.json"), auditPath = path.join(formal, "audit/sales.json");
  await save(planPath, plan); await save(path.join(base, "active.json"), { runId: a.runId, executionId: a.executionId });
  await save(path.join(root, "config/jackyun-export-first-policy.json"), { version: plan.protocol, browser: { downloadDirectory: downloads, allowedDownloadHosts: [] } });
  await save(manifestPath, { version: 1, runId: a.runId, strictOrder: jackyunModuleOrder, modules });
  await save(path.join(formal, "api-controller-state.json"), { version: 1, runId: a.runId, transport: "session_api_v1", runDate: a.runDate,
    asOfDate: a.endDate, salesStartDate: a.startDate, modules: controller });
  await save(path.join(validation, "run-manifest.json"), { version: 1, runId: a.runId, strictOrder: jackyunModuleOrder, modules: prepared });
  await save(auditPath, audit);
  for (const dir of ["processed", "raw", "sales/2026-08-19_2026-10-02_20261002161234"]) await mkdir(path.join(formal, dir), { recursive: true });
  const state = { salesRevision: "43:42", latestSalesBatchId: "64e88e720339d623a22a3c5dc69c1fb5519431afec54ffb047e2cb1de3a70657",
    comboBatchId: "combos:544a352d7fb3c44496a195ea198bc38541fb0602b93cdcdd8f8853227ade4d54", ownedRows: 10, current: true,
    apiStatus: 200, mode: "manual" as "manual" | "trigger", startedAt: now };
  const calls: string[] = [];
  const deps = {
    request: (async (url, init) => {
      assert.equal(init?.method, undefined, "recovery preparation cannot perform writes");
      const u = new URL(String(url)); assert.equal(u.origin, "http://localhost:3000"); calls.push(u.pathname);
      if (u.pathname === "/api/sales/data-health") return Response.json({ revision: state.salesRevision, latestBatch: { id: state.latestSalesBatchId } }, { status: state.apiStatus });
      if (u.searchParams.get("source") === "combos") return Response.json({ items: [{ id: state.comboBatchId, status: "completed" }] });
      const moduleKey = u.pathname.endsWith("inventory") ? "inventory" : u.searchParams.get("source")!;
      return Response.json({ items: [{ id: "synthetic-" + moduleKey, status: "completed", rowCount: 10, ownedRowCount: state.ownedRows,
        excludedCount: 0, isCurrent: state.current, snapshotDate: moduleKey === "products" ? null : a.runDate,
        totals: { contentHash: "c".repeat(64), rawFileHash: exports[moduleKey].fileSha256 } }] });
    }) as typeof fetch,
    verifyArtifact: (async options => ({ auditPath: path.join(formal, "audit", options.module + ".json"), status: "completed", batchId: "synthetic-" + options.module,
      rowCount: 10, warningCount: 0, inputContractHash: "a".repeat(64) })) as typeof import("../lib/jackyun/run-artifact-verification").verifyJackyunModuleArtifact,
    replacementEvidence: (_original: string, id: string) => ({ evidence, replacement: { executionId: id, mode: state.mode, startedAt: state.startedAt } }),
  };
  return { root, base, formal, validation, files, planPath, manifestPath, auditPath, plan, modules, failed, audit, save, deps, state, calls };
}
test("only the original full execution and exact pre-import failure are eligible", () => {
  assert.doesNotThrow(() => assertPartialImportEvidence(evidence, now));
  for (const patch of [{ executionId: "5479" }, { workflowId: "other" }, { error: "timeout" }, { activeExecutions: 1 },
    { retrySuccessId: "5492" }, { httpCode: "503" }, { runNodes: evidence.runNodes.slice(1) }, { executionDataSha256: "0".repeat(64) }]) {
    assert.throws(() => assertPartialImportEvidence({ ...evidence, ...patch }, now));
  }
});
test("cross-day import-only recovery preserves originals and has a single manual consumer", async () => {
  const f = await fixture(), originals = [f.planPath, f.manifestPath, f.auditPath, ...f.files];
  const before = await Promise.all(originals.map(x => readFile(x)));
  const proposal = await inspectPartialImportRecovery(f.root, evidence, now, f.deps);
  await publishPartialImportRecovery(proposal, evidence, recoverySha(JSON.stringify(proposal)), f.deps);
  await assert.rejects(claimPartialImportRecovery(f.root, "5478", "6100", "import", now, f.deps));
  const attempts = await Promise.allSettled(["6100", "6101"].map(id => claimPartialImportRecovery(f.root, "5478", id, "plan-api", now, f.deps)));
  const winners = attempts.filter(r => r.status === "fulfilled"); assert.equal(winners.length, 1);
  assert.equal(winners[0].status, "fulfilled"); if (winners[0].status !== "fulfilled") return;
  const b = winners[0].value;
  assert.deepEqual(await Promise.all(originals.map(x => readFile(x))), before);
  assert.deepEqual(await readFile(path.join(f.base, "partial-import-originals/5478/sales.failed.json")), before[2]);
  assert.deepEqual(await claimPartialImportRecovery(f.root, "5478", b.executionId, "import", now, f.deps), b);
  await verifyPartialImportGate(f.root, b, f.deps);
  assert.doesNotThrow(() => assertPartialFailedImportRetry({ runId: a.runId, module: "sales", sourceSha256: f.failed.sourceSha256,
    inputContractHash: f.failed.inputContractHash, prior: f.failed, auditRaw: before[2], binding: b }));
  for (const change of [{ module: "products" }, { sourceSha256: "0".repeat(64) }, { inputContractHash: "0".repeat(64) },
    { prior: { ...f.failed, status: "completed", batchId: "unknown" } }, { auditRaw: Buffer.from(JSON.stringify({ ...f.audit, import: {} })) }]) {
    assert.throws(() => assertPartialFailedImportRetry({ runId: a.runId, module: "sales", sourceSha256: f.failed.sourceSha256,
      inputContractHash: f.failed.inputContractHash, prior: f.failed, auditRaw: before[2], binding: b, ...change }));
  }
  await writeFile(f.files[0], "changed");
  await assert.rejects(claimPartialImportRecovery(f.root, "5478", b.executionId, "verify", now, f.deps), /证据变化/);
});
test("uncertain effects, changed files, dates and completed prefixes reject planning", async () => {
  for (const fault of ["file", "phase", "date", "prefix", "sales-batch", "audit-import", "nested-audit", "extra-attempt", "handoff", "current", "owned", "api"]) {
    const f = await fixture();
    if (fault === "file") await writeFile(f.files[3], "changed");
    if (fault === "phase") await f.save(f.planPath, { ...f.plan, phase: "exporting" });
    if (fault === "date") await f.save(f.planPath, { ...f.plan, asOfDate: "2026-10-03" });
    if (fault === "prefix") await f.save(f.manifestPath, { version: 1, runId: a.runId, strictOrder: jackyunModuleOrder, modules: { ...f.modules, inventory: { ...f.modules.inventory, status: "failed" } } });
    if (fault === "sales-batch") await f.save(f.manifestPath, { version: 1, runId: a.runId, strictOrder: jackyunModuleOrder, modules: { ...f.modules, sales: { ...f.failed, batchId: "unknown" } } });
    if (fault === "audit-import") await f.save(f.auditPath, { ...f.audit, import: { pending: true } });
    if (fault === "nested-audit") await f.save(path.join(f.formal, "sales/2026-08-19_2026-10-02_20261002161234/audit.json"), { import: null });
    if (fault === "extra-attempt") await f.save(path.join(f.formal, "audit/sales.attempt-failed.json"), {});
    if (fault === "handoff") await f.save(path.join(f.root, "outputs/jackyun-browser-events", a.runId, "04-sales.json"), {});
    if (fault === "current") f.state.current = false;
    if (fault === "owned") f.state.ownedRows = 9;
    if (fault === "api") f.state.apiStatus = 503;
    await assert.rejects(inspectPartialImportRecovery(f.root, evidence, now, f.deps), fault);
  }
});
test("approval, expiry, mode and intervening source revisions fail closed", async () => {
  for (const fault of ["approval", "expiry", "cross-midnight", "automatic", "predates", "revision", "combos"]) {
    const f = await fixture(), p = await inspectPartialImportRecovery(f.root, evidence, now, f.deps);
    if (fault === "approval") { await assert.rejects(publishPartialImportRecovery(p, evidence, "0".repeat(64), f.deps)); continue; }
    await publishPartialImportRecovery(p, evidence, recoverySha(JSON.stringify(p)), f.deps);
    if (fault === "automatic") f.state.mode = "trigger";
    if (fault === "predates") f.state.startedAt = "2026-10-04T02:59:59Z";
    if (fault === "revision") f.state.salesRevision = "44:43";
    if (fault === "combos") f.state.comboBatchId = "new-combos";
    const at = fault === "expiry" ? "2026-10-04T03:30:01Z" : fault === "cross-midnight" ? "2026-10-04T16:00:00Z" : now;
    await assert.rejects(claimPartialImportRecovery(f.root, "5478", "6100", "plan-api", at, f.deps));
    await assert.rejects(readdir(path.join(f.base, "partial-import-claims")));
  }
});
test("the final import gate detects writes after claim and cannot bless another claimant", async () => {
  const f = await fixture(), p = await inspectPartialImportRecovery(f.root, evidence, now, f.deps);
  await publishPartialImportRecovery(p, evidence, recoverySha(JSON.stringify(p)), f.deps);
  const b = await claimPartialImportRecovery(f.root, "5478", "6100", "plan-api", now, f.deps);
  f.state.salesRevision = "44:43";
  await assert.rejects(verifyPartialImportGate(f.root, b, f.deps));
  f.state.salesRevision = "43:42"; f.state.comboBatchId = "new-combos";
  await assert.rejects(verifyPartialImportGate(f.root, b, f.deps));
  await assert.rejects(verifyPartialImportGate(f.root, { ...b, executionId: "6101" }, f.deps));
});
test("API stage reuse is restricted to 5478 and never recaptures or rewinds", async () => {
  const f = await fixture(), p = f.plan as JackyunExportFirstPlan;
  for (const action of ["export-all", "validate"]) {
    assert.throws(() => assertExportFirstAction(p, a.executionId, action));
    assert.doesNotThrow(() => assertExportFirstAction(p, a.executionId, action, true));
    assert.throws(() => assertExportFirstAction({ ...p, exports: {} }, a.executionId, action, true));
    assert.throws(() => assertExportFirstAction({ ...p, executionId: "5479", runId: "n8n-export-first-5479" }, "5479", action, true));
  }
  assert.throws(() => assertExportFirstAction(p, a.executionId, "verify", true));
  assert.equal(p.phase, "importing"); assert.equal(p.asOfDate, "2026-10-02");
});

test("an import-only continuation never starts fresh login or automatic preflight closure", async () => {
  const f = await fixture(), p = await inspectPartialImportRecovery(f.root, evidence, now, f.deps);
  await publishPartialImportRecovery(p, evidence, recoverySha(JSON.stringify(p)), f.deps);
  let replacementChecked = false;
  await assert.rejects(runJackyunExportFirstAction("plan-api", "6100", {
    root: f.root, lockDirectory: path.join(f.root, ".runtime/test.lock"), now: () => new Date(now), request: f.deps.request,
    profileReady: async () => { throw Error("IMPORT_ONLY_MUST_NOT_CHECK_LOGIN"); },
    recoverPreviousPreflight: async () => { throw Error("IMPORT_ONLY_MUST_NOT_CLOSE_PREFLIGHT"); },
    partialRecoveryEvidence: () => { replacementChecked = true; throw Error("stop before testing real metadata"); },
  }), /没有有效续跑许可/);
  assert.equal(replacementChecked, true);
});

test("actual sales runner resumes the archived failed contract once and verifies its exact batch", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "jackyun-5478-sales-runner-"));
  const downloads = path.join(root, "downloads"), outputRoot = path.join(root, "runs"), formal = path.join(outputRoot, a.runId);
  const file = path.join(downloads, "jackyun", a.runId, "sales", "synthetic.xlsx"), costFile = path.join(formal, "raw", "inventory-cost.xlsx");
  const raw = createXlsxWorkbookBytes([{ name: "合成销售", rows: [
    ["网店订单号", "销售渠道", "发货仓库", "货品编号", "货品名称", "数量", "下单时间", "发货时间", "货品成本", "分摊后单价", "分摊后金额", "费用分摊", "毛利"],
    ["SYNTHETIC-1", "京东-志高切肉机旗舰店（志高迈德豪）", "主仓", "SYNTHETIC-SKU", "合成货品", 1, "2026-09-29 09:00:00", "2026-09-29 10:00:00", 0, 100, 100, 5, 0],
  ] }]);
  const costs = createXlsxWorkbookBytes([{ name: "合成成本", rows: [["货品编号", "固定成本价", "货品名称"], ["SYNTHETIC-SKU", 20, "合成货品"]] }]);
  await mkdir(path.dirname(file), { recursive: true }); await mkdir(path.dirname(costFile), { recursive: true });
  await writeFile(file, raw); await writeFile(costFile, costs);
  const manifestPath = path.join(formal, "run-manifest.json");
  await writeFile(manifestPath, JSON.stringify({ version: 1, runId: a.runId, strictOrder: jackyunModuleOrder, modules: {
    products: { module: "products", status: "completed" }, inventory_age: { module: "inventory_age", status: "completed" },
    inventory: { module: "inventory", status: "completed", batchId: "synthetic-inventory", salesCostSourcePath: costFile, salesCostSourceSha256: recoverySha(costs) },
  } }));
  const t = (second: number) => `2026-10-02T16:11:0${second}.000Z`;
  const options: JackyunDownloadRunOptions = { module: "sales", filePath: file, runId: a.runId, outputRoot, downloadDirectory: downloads,
    policyVersion: jackyunExportFirstPolicyVersion, exportStart: t(4), expectedSourceRows: 1, baseUrl: "http://localhost:3000", dryRun: false,
    asOfDate: a.endDate, salesStartDate: a.startDate, costSourcePath: costFile,
    handoffEvidence: { navigationIntentAt: t(1), queryIntentAt: t(2), tableStableAt: t(3), exportIntentAt: t(4), downloadEventAt: t(5) },
    downloadProvenance: { runId: a.runId, module: "sales", policyVersion: jackyunExportFirstPolicyVersion,
      method: "browser_event", downloadId: "synthetic-sales", originalFileName: "synthetic.xlsx", completedAt: t(5), sha256: recoverySha(raw), bytes: raw.length } };
  const policy = JSON.parse(await readFile(path.resolve("config/sales-import-policy.json"), "utf8")) as { version: string };
  const previousFetch = globalThis.fetch; let failing = true, writes = 0, completes = 0, fingerprint = "";
  globalThis.fetch = async (url, init) => {
    const u = new URL(String(url)); assert.equal(u.origin, "http://localhost:3000");
    assert.ok(u.pathname.startsWith("/api/imports/sales/"), "no previous module can be uploaded");
    if (u.searchParams.get("policyOnly") === "1") return Response.json(failing ? { error: a.error } : { policyVersion: policy.version }, { status: failing ? 503 : 200 });
    if (u.pathname.endsWith("verify") && !u.searchParams.has("batchId")) return Response.json({ shops: [] });
    if (u.pathname.endsWith("verify")) return Response.json({ policyVersion: policy.version, period: { startDate: a.startDate, endDate: a.endDate, endExclusive: a.runDate },
      batch: { id: "synthetic-sales-batch", status: "completed", rowCount: 1, totals: { rawFileHash: fingerprint, systemCost: { sourceBatchId: "synthetic-inventory" } } },
      stats: { rowCount: 1, minShipTime: "2026-09-29 10:00:00", maxShipTime: "2026-09-29 10:00:00", excludedWarehouseRows: 0, rowsNotOwnedByBatch: 0 }, nonWhitelistChannels: [] });
    writes++;
    if (init?.method === "PUT") return Response.json({ ok: true });
    const payload = JSON.parse(String(init?.body)) as { action: string; fingerprint: string };
    if (payload.action === "init") { fingerprint = payload.fingerprint; return Response.json({ ok: true, upload: { id: "synthetic-sales-upload", receivedChunkIndexes: [] } }); }
    assert.equal(payload.action, "complete"); completes++;
    return Response.json({ ok: true, batch: { id: "synthetic-sales-batch", status: "completed", rowCount: 1, totals: { rawFileHash: fingerprint } } });
  };
  try {
    await assert.rejects(runJackyunDownload(options), /Django 销售/); assert.equal(writes, 0);
    const auditPath = path.join(formal, "audit/sales.json"), audit = JSON.parse(await readFile(auditPath, "utf8"));
    audit.timings.failedAt = a.failedAt; await writeFile(auditPath, JSON.stringify(audit));
    const failedRaw = await readFile(auditPath), manifest = JSON.parse(await readFile(manifestPath, "utf8")), prior = manifest.modules.sales;
    const binding = { version: 1 as const, reason: "audited_5478_sales_read_before_import" as const, originalExecutionId: "5478", failedExecutionId: "5478", executionId: "6100",
      permitSha256: "f".repeat(64), failedModuleSha256: recoverySha(JSON.stringify(prior)), failedAuditSha256: recoverySha(failedRaw) };
    const archive = path.join(root, "original-sales-failure.json"); await writeFile(archive, failedRaw, { flag: "wx" });
    await assert.rejects(runJackyunDownload({ ...options, importRecovery: { ...binding, failedAuditSha256: "0".repeat(64) } }));
    assert.equal(writes, 0); failing = false;
    assert.equal((await runJackyunDownload({ ...options, importRecovery: binding })).status, "completed"); assert.equal(completes, 1);
    assert.equal((await runJackyunDownload({ ...options, importRecovery: binding })).status, "duplicate_ignored"); assert.equal(completes, 1);
    assert.deepEqual(await readFile(archive), failedRaw);
  } finally { globalThis.fetch = previousFetch; }
});
