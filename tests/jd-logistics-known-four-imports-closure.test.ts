import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import * as XLSX from "xlsx";
import { withJackyunRunLock } from "../lib/jackyun/run-lock";
import { logisticsContentHash, logisticsPlanHash, type JdLogisticsManifest } from "../lib/jd/logistics-manifest";
import { jdLogisticsProtocol, logisticsHash, parseJdLogisticsSettings, planJdLogisticsNotifications, selectJdLogisticsOperations } from "../lib/jd/logistics-policy";
import { jhLogisticsExportRequest, jhLogisticsQueryRequest } from "../lib/jd/logistics-source-tasks";
import { validateJdStoreRegistry } from "../lib/jd/store-registry";
import { JD_FLOW_CSV_HEADERS, JD_SHOP_PRODUCTS_CSV_HEADERS, parseJdLogisticsWorkbook } from "../lib/inventory/jd-logistics-workbook";
import { logisticsExportIdentity } from "../tools/jd-logistics-export";
import { preexportSha256 as sha, jdPreexportEvidence as io } from "../tools/close-jd-logistics-preexport";
import { closeJdLogisticsKnownFourImports as close, jdKnownFourImportsTarget, knownImportInstantMicros, type KnownFourImportsOptions, type KnownFourImportsTarget } from "../tools/close-jd-logistics-known-four-imports";
const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";
const kinds = ["flow", "shop_products", "realtime_inventory", "inventory_snapshot"] as const;
async function fixture(t: test.TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), "jd-four-imports-private-"));
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  const target: KnownFourImportsTarget = { ...structuredClone(jdKnownFourImportsTarget), supervisorPid: 111, helperPid: 222 };
  const runtime = path.join(root, "runtime"), directory = path.join(root, "outputs/jd-logistics-pipeline"), release = path.join(runtime, "releases", target.releaseId), databasePath = path.join(root, "n8n.sqlite");
  await Promise.all([mkdir(path.join(root, "config"), { recursive: true }), mkdir(directory, { recursive: true }), mkdir(path.join(release, "helper"), { recursive: true }),
    mkdir(path.join(release, "audit"), { recursive: true }), mkdir(path.join(release, "source-snapshot/tools"), { recursive: true }), mkdir(path.join(runtime, "state"), { recursive: true })]);
  const registry = { version: 1, stores: [{ storeKey: target.storeKey, platform: "京东", enabled: true, accountLabel: "fixture", shopName: "fixture", shopId: "701455",
    browser: { executablePath: "fixture/chrome.exe", userDataDir: "fixture/profiles", profileName: "Default", profileDir: "fixture/profiles/Default", debugPort: 9224, downloadDir: "fixture/downloads" } }] };
  const config = { version: 1 as const, bindings: kinds.map(sourceKind => ({ sourceKind, departmentId: target.departmentId, businessUnitCode: target.businessUnitCode,
    enabled: true, sourceVerified: true, contractVersion: "jd-logistics-v1", collectorStoreKey: target.storeKey, authorizedStoreKeys: [target.storeKey], warehouseCode: "",
    ...(sourceKind === "flow" ? { initialStartDate: "2026-10-15", maxSpanDays: 366 } : {}) })) };
  const settings = parseJdLogisticsSettings({ contractVersion: "jd-logistics-v1", departments: [{ id: target.departmentId, businessUnitCode: target.businessUnitCode, storeKeys: [target.storeKey],
    logisticsEnabled: true, monitorEnabled: false, pushEnabled: false, revision: 1, capabilities: Object.fromEntries(kinds.map(k => [k, true])) }], scopeRevisions: [],
    notification: { implemented: true, enabled: false, configured: false, configDigest: "", groupName: "测试群聊", robotName: "志高助手" } });
  const stores = validateJdStoreRegistry(registry, root), anchor = "2026-10-16T05:58:16.183Z", selections = selectJdLogisticsOperations(config, settings, stores, new Date(anchor));
  const plan: JdLogisticsManifest = { protocolVersion: jdLogisticsProtocol, workflowKey: "jd-logistics", runId: target.runId, executionId: target.executionId, createdAt: anchor, updatedAt: "2026-10-16T05:59:20.329Z",
    anchorAt: anchor, baseUrl: "http://localhost:3000", planHash: "", stage: "failed", outcome: "imported", notificationPlan: planJdLogisticsNotifications(settings, selections), notification: { stage: "pending" },
    failure: { code: target.failureCode, stage: "verify", at: "2026-10-16T05:59:20.328Z" }, operations: selections.map(op => ({ ...op, stage: "imported" })) };
  settings.scopeRevisions = kinds.map(sourceKind => ({ departmentId: target.departmentId, sourceKind, revision: 1 }));
  const originals: { filePath: string; exportPath: string; file: Buffer; exportRaw: string; exported: any }[] = [];
  for (let i = 0; i < 4; i++) {
    const op = plan.operations[i], pin = target.downloads[i], downloadDirectory = path.join(directory, "downloads", target.runId, op.operationId);
    await mkdir(downloadDirectory, { recursive: true }); let file: Buffer;
    if (i === 0) {
      const row: Record<string, string> = { "业务发生时间": "2026-10-15 12:00:00", "事业部编码": target.businessUnitCode, "仓库编码": "W1", "事业部商品编号": "G1", "事业部商品名称": "合成商品", "京东单据编码": "D1", "业务类型": "入库", "实际原始库存": "1", "实际库存加减数量": "1", "实际库存结存": "2", "可用原始库存": "1", "可用库存加减数量": "1", "可用库存结存": "2" };
      file = Buffer.from([JD_FLOW_CSV_HEADERS.join(","), ...Array.from({ length: pin.rows }, (_, n) => JD_FLOW_CSV_HEADERS.map(h => h === "序号" ? String(n+1) : row[h] ?? "").join(","))].join("\r\n"));
    } else if (i === 1) {
      const row: Record<string, string> = { "店铺": "合成店铺", "事业部商品编码": "G1", "商品名称": "合成商品", "商品状态": "启用" };
      file = Buffer.from([JD_SHOP_PRODUCTS_CSV_HEADERS.join(","), ...Array.from({ length: pin.rows }, (_, n) => JD_SHOP_PRODUCTS_CSV_HEADERS.map(h => h === "店铺商品编码" ? `P${n+1}` : row[h] ?? "").join(","))].join("\r\n"));
    } else {
      const grid = [["事业部编码", "京东SKU", "商品名称", "仓库编码", "仓库名称", "日期", "可用库存", "在库件数", "近7天销量", "近30天销量"],
        ...Array.from({ length: pin.rows }, (_, n) => [target.businessUnitCode, `SKU${n+1}`, "合成商品", "W1", "合成仓", op.rangeStart, 3, 5, 7, 30])];
      const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(grid), "source");
      file = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
    }
    pin.operationId = op.operationId; pin.rawSha256 = sha(file); pin.bytes = file.length;
    pin.contentHash = logisticsContentHash(parseJdLogisticsWorkbook(file, op.sourceKind, target.businessUnitCode, { collectedAt: pin.collectedAt, allowDeclaredBusinessUnit: i !== 0 }));
    const filePath = path.join(downloadDirectory, pin.fileName), exportPath = path.join(downloadDirectory, "export-manifest.json");
    pin.exportMetadata.identity = logisticsExportIdentity({ ...op, sourceStatus: i === 1 ? "enabled" : undefined, root, runId: plan.runId, executionId: plan.executionId, store: stores[0], downloadDirectory, assertOwner: async () => {} });
    const result = { filePath, taskIdentity: pin.exportMetadata.taskIdentity, complete: true, browserClosed: true, collectedAt: pin.collectedAt,
      ...(i > 0 ? { sourceAsOf: op.rangeStart } : {}), ...(i === 1 ? { sourceStatus: "enabled" } : {}),
      identityEvidence: { observedBusinessUnitCode: target.businessUnitCode, observedAt: pin.collectedAt, sourceUrl: ["https://wl.jdl.com/bsc-inventory/flow", "https://wl.jdl.com/supplychain-bbi/esg", "https://jh.jdl.com/#/storage/RealInventory", "https://jh.jdl.com/#/OfflineInventorySmall"][i], storeKey: target.storeKey },
      scope: Object.fromEntries(["sourceKind", "departmentId", "businessUnitCode", "rangeStart", "rangeEnd", "warehouseCode"].map(k => [k, (op as any)[k]])), contractVersion: "jd-logistics-v1" };
    if (i > 1) { pin.exportMetadata.queryEvidence.requestHash = logisticsHash(jhLogisticsQueryRequest(op)); pin.exportMetadata.requestEvidence.requestHash = logisticsHash(jhLogisticsExportRequest(op)); }
    const exported = { ...structuredClone(pin.exportMetadata), filePath, rawFileHash: pin.rawSha256, byteSize: pin.bytes, result };
    const { filePath: _filePath, ...evidence } = result;
    Object.assign(pin.receipt, { rawFileHash: pin.rawSha256, contentHash: pin.contentHash, rowCount: pin.rows });
    Object.assign(op, { export: { ...evidence, relativePath: path.relative(root, filePath).split(path.sep).join("/"), rawFileHash: pin.rawSha256, bytes: pin.bytes }, rowCount: pin.rows,
      contentHash: pin.contentHash, parserVersion: "jd-logistics-workbook-v1", receipt: structuredClone(pin.receipt) });
    pin.readback = { ...pin.readback, ...structuredClone(pin.receipt), collectedAt: pin.utcCollectedAt, currentSelection: { current: true, verifiedRowCount: pin.rows, contentHash: pin.contentHash, scopeRevision: 1 } };
    const exportRaw = json(exported); pin.exportManifestSha256 = sha(exportRaw);
    await writeFile(filePath, file); await writeFile(exportPath, exportRaw); originals.push({ filePath, exportPath, file: Buffer.from(file), exportRaw, exported });
  }
  plan.planHash = logisticsPlanHash(plan); target.planHash = plan.planHash;
  const manifestRaw = json(plan), activeRaw = json({ runId: target.runId, executionId: target.executionId, planHash: target.planHash });
  target.activeSha256 = sha(activeRaw); target.manifestSha256 = sha(manifestRaw); target.registrySha256 = sha(json(registry)); target.sourceConfigSha256 = sha(json(config));
  await Promise.all([writeFile(path.join(directory, "active.json"), activeRaw), writeFile(path.join(directory, `${target.runId}.json`), manifestRaw), writeFile(path.join(root, "config/jd-logistics-sources.json"), json(config)), writeFile(path.join(root, "config/jd-store-accounts.json"), json(registry))]);
  const task = (index: number, payload?: unknown, branch = 0) => ({ executionStatus: payload ? "success" : "error", executionIndex: index, ...(payload ? { data: { main: branch === 0 ? [[{ json: payload }]] : [[], [{ json: payload }]] } } : {}) });
  const granted = { ok: true, workflow: "jd-logistics", coordinationStatus: "granted" }, summary = { runId: target.runId, stage: "executed", status: "imported", operationCount: 4, importedCount: 4, duplicateCount: 0, verifiedCount: 0 };
  const runData: Record<string, any> = { "手动完整运行": [task(0, {})], "领取共享 helper": [task(1, granted)], "已领取执行所有权？": [task(2, granted)],
    "A·冻结事业部来源与日期计划": [task(3, { runId: target.runId, stage: "planned", operationCount: 4 })], "B·串行下载全文件校验并导入": [task(4, summary)],
    "C·独立核验文件精确批次和当前版本": [task(5, { ...summary, error: { status: 500, message: target.failureCode } }, 1)], "失败后释放原执行 helper": [task(6, { ok: true, stage: "released", workflow: "jd-logistics" })], "保留证据并明确失败": [task(7)] };
  const executionData = JSON.stringify([{ resultData: { lastNodeExecuted: "保留证据并明确失败", runData } }]); target.executionDataSha256 = sha(executionData);
  const db = new DatabaseSync(databasePath); db.exec("CREATE TABLE workflow_entity(id TEXT,active INTEGER);CREATE TABLE execution_entity(id INTEGER,workflowId TEXT,status TEXT,mode TEXT,startedAt TEXT,stoppedAt TEXT,retrySuccessId TEXT,deletedAt TEXT);CREATE TABLE execution_data(executionId TEXT,data TEXT)");
  db.prepare("INSERT INTO workflow_entity VALUES(?,0)").run(target.workflowId); db.prepare("INSERT INTO execution_entity VALUES(?,?,'error','manual','2026-10-16 05:58:15','2026-10-16 05:59:21',NULL,NULL)").run(9619, target.workflowId);
  db.prepare("INSERT INTO execution_data VALUES(?,?)").run(target.executionId, executionData); db.close();
  const source = 'async function exportFlowSource() { stage: "baseline"; await writeJsonDurable(manifestPath, manifest); manifest.stage = "submitting"; await writeJsonDurable(manifestPath, manifest); uniqueButton(surface, "导出"); } export async function exportJdLogistics() {}';
  const pipeline = 'export async function runJdLogisticsN8nPlan() { for (const operation of plan.operations) { const result = await exporter(); operation.stage = "validated"; } for (const operation of plan.operations) { operation.stage = "importing"; operation: "import"; } } export async function verifyJdLogisticsN8nPlan() { if (!["executed", "verified", "completed"].includes(plan.stage)) throw Error(); if (canonicalLogisticsJson(operation.receipt) !== canonicalLogisticsJson(receipt)) throw Error(); }';
  target.exporterSha256 = sha(source); target.pipelineSha256 = sha(pipeline); await writeFile(path.join(release, "source-snapshot/tools/jd-logistics-export.ts"), source); await writeFile(path.join(release, "source-snapshot/tools/jd-logistics-n8n-pipeline.ts"), pipeline);
  const hash = createHash("sha256");
  for (const name of ["jackyun-json-publish.ps1", "jd-credential-vault.ps1", "tmall-credential-vault.ps1", "tmall-workflow-helper.mjs"]) {
    const content = Buffer.from(`fixture:${name}`), n = Buffer.from(name), nl = Buffer.alloc(4), cl = Buffer.alloc(8); nl.writeUInt32BE(n.length); cl.writeBigUInt64BE(BigInt(content.length)); hash.update(nl).update(n).update(cl).update(content); await writeFile(path.join(release, "helper", name), content);
  }
  target.helperTreeSha256 = hash.digest("hex"); const receipt = json({ status: "passed", helperTree: { fileCount: 4, sha256: target.helperTreeSha256 }, evidence: { inputFiles: [{ relativePath: "tools/jd-logistics-export.ts", sha256: target.exporterSha256 }, { relativePath: "tools/jd-logistics-n8n-pipeline.ts", sha256: target.pipelineSha256 }] } });
  target.helperReceiptSha256 = sha(receipt); await writeFile(path.join(release, "audit/helper-build-receipt.json"), receipt); const deployment = json({ fixture: true }); target.releaseManifestSha256 = sha(deployment); await writeFile(path.join(release, "deployment-manifest.json"), deployment);
  await writeFile(path.join(runtime, "state/worker-process.json"), json({ releaseId: target.releaseId, manifestSha256: target.releaseManifestSha256, supervisorPid: 111, supervisorCreationDate: target.supervisorCreationDate }));
  const state = { batches: target.downloads.map(d => structuredClone(d.readback)), total: 1, truncated: false, busy: false, portClosed: true, pid: 222, birth: target.helperCreationDate };
  const request: typeof fetch = async (input, init) => {
    assert.equal(init?.method, "GET"); assert.equal(init?.body, undefined); assert.equal(init?.redirect, "manual"); const url = new URL(String(input));
    if (url.origin === "http://127.0.0.1:5791" && url.pathname === "/health") return Response.json({ ok: true, stage: "ready", busy: state.busy, activeWorkflow: null, storeExecutions: [], drain: null });
    assert.equal(url.origin, "http://localhost:3000"); assert.equal(url.pathname, "/api/inventory/jd-logistics"); if (url.searchParams.get("operation") === "settings") return Response.json({ success: true, data: settings });
    assert.equal(url.searchParams.get("operation"), "batches"); const index = target.downloads.findIndex(d => d.receipt.batchId === url.searchParams.get("batchId")); assert.ok(index >= 0);
    assert.equal(url.searchParams.get("sourceKind"), target.downloads[index].sourceKind); assert.equal(url.searchParams.get("departmentId"), target.departmentId); assert.equal(url.searchParams.get("businessUnitCode"), target.businessUnitCode);
    return Response.json({ success: true, data: { items: [state.batches[index]], total: state.total, page: 1, pageSize: 1, truncated: state.truncated } });
  };
  const options: KnownFourImportsOptions = { root, runtime, databasePath, target, request, portProbe: async p => { assert.equal(p, 9224); return state.portClosed; },
    processProbe: async () => ({ pid: state.pid, parentPid: 111, creationDate: state.birth, supervisorCreationDate: target.supervisorCreationDate, commandLine: `"C:\\Program Files\\nodejs\\node.exe" ${path.join(release, "helper/tmall-workflow-helper.mjs")} serve --port 5791` }) };
  const recovery = path.join(directory, `known-four-imports-${target.executionId}-${target.activeSha256.slice(0, 16)}`);
  const savePlan = async () => { const raw = json(plan); target.manifestSha256 = sha(raw); await writeFile(path.join(directory, `${target.runId}.json`), raw); };
  const saveExport = async (i: number) => { const raw = json(originals[i].exported); target.downloads[i].exportManifestSha256 = sha(raw); await writeFile(originals[i].exportPath, raw); };
  const saveN8n = async () => { const raw = JSON.stringify([{ resultData: { lastNodeExecuted: "保留证据并明确失败", runData } }]); target.executionDataSha256 = sha(raw); const db = new DatabaseSync(databasePath); db.prepare("UPDATE execution_data SET data=?").run(raw); db.close(); };
  return { root, runtime, directory, release, databasePath, target, options, plan, settings, state, originals, recovery, activeRaw, manifestRaw, runData, savePlan, saveExport, saveN8n };
}
test("9619 closure retains four known imports and all eight originals, with permanent old error", async t => {
  const f = await fixture(t), batches = structuredClone(f.state.batches), inspected = await close(f.options); assert.equal(inspected.status, "eligible_intent"); assert.equal(inspected.effects.businessImports, 4);
  assert.equal(inspected.files.length, 8); assert.equal("noEffects" in inspected, false); const committed = await close(f.options, "apply"); assert.equal(committed.status, "committed");
  assert.match(committed.nextAction, /never retry 9619/); assert.equal(committed.requiresBackendUtcRepairBeforeFreshRun, true); assert.deepEqual(f.state.batches, batches);
  await assert.rejects(readFile(path.join(f.directory, "active.json")), { code: "ENOENT" }); assert.equal(await readFile(path.join(f.recovery, "active.archived.json"), "utf8"), f.activeRaw);
  assert.equal(await readFile(path.join(f.directory, `${f.target.runId}.json`), "utf8"), f.manifestRaw);
  for (const original of f.originals) { assert.deepEqual(await readFile(original.filePath), original.file); assert.equal(await readFile(original.exportPath, "utf8"), original.exportRaw); }
  const db = new DatabaseSync(f.databasePath, { readOnly: true }); assert.equal(db.prepare("SELECT status FROM execution_entity WHERE id=9619").get()?.status, "error"); db.close(); await assert.rejects(close(f.options, "apply"), /PATH_ALREADY_EXISTS/);
});
test("the fixed time exception proves microseconds and rejects even one changed microsecond", async t => {
  assert.equal(knownImportInstantMicros("2026-10-16T13:58:27.116001+08:00") - knownImportInstantMicros("2026-10-16T05:58:27.116000+00:00"), 1n);
  for (const mode of ["microsecond", "equivalent-Z", "different-instant"] as const) await t.test(mode, async t => {
    const f = await fixture(t), pin = f.target.downloads[0];
    if (mode === "microsecond") { pin.utcCollectedAt = pin.utcCollectedAt.replace("116000", "116001"); pin.readback.collectedAt = pin.utcCollectedAt; f.state.batches[0].collectedAt = pin.utcCollectedAt; }
    if (mode === "equivalent-Z") f.state.batches[0].collectedAt = f.state.batches[0].collectedAt.replace("+00:00", "Z");
    if (mode === "different-instant") f.state.batches[0].collectedAt = "2026-10-16T05:58:28.116000+00:00";
    await assert.rejects(close(f.options, "apply"));
  });
});
test("the original flattened n8n encoding resolves the successful B and failed C paths", async t => {
  const f = await fixture(t), db = new DatabaseSync(f.databasePath), original = JSON.parse(db.prepare("SELECT data FROM execution_data").get()!.data as string)[0];
  const values: any[] = [], strings = new Map<string, string>(), objects = new WeakMap<object, string>();
  const ref = (v: any): any => {
    if (v === null || typeof v === "number" || typeof v === "boolean") return v;
    const existing = typeof v === "string" ? strings.get(v) : objects.get(v); if (existing !== undefined) return existing;
    const index = String(values.length); if (typeof v === "string") strings.set(v, index); else objects.set(v, index); values.push(null);
    values[Number(index)] = typeof v === "string" ? v : Array.isArray(v) ? v.map(ref) : Object.fromEntries(Object.entries(v).map(([k, value]) => [k, ref(value)])); return index;
  };
  ref(original); const raw = JSON.stringify(values); f.target.executionDataSha256 = sha(raw); db.prepare("UPDATE execution_data SET data=?").run(raw); db.close();
  assert.equal((await close(f.options)).n8n.status, "error");
});
test("every stable batch field and current selection remains exact", async t => {
  for (const field of ["batchId", "status", "referenceBatchId", "rawFileHash", "contentHash", "rowCount", "scopeRevision", "rangeStart", "departmentId", "businessUnitCode", "storeKey", "collectorEvidence", "warnings", "sourceStatus", "sourceBindingVerified", "current", "verifiedRowCount", "selectionHash", "selectionRevision", "total", "truncated"]) await t.test(field, async t => {
    const f = await fixture(t), b = f.state.batches[2];
    if (field === "current") b.currentSelection.current = false;
    else if (field === "verifiedRowCount") b.currentSelection.verifiedRowCount--;
    else if (field === "selectionHash") b.currentSelection.contentHash = "a".repeat(64);
    else if (field === "selectionRevision") b.currentSelection.scopeRevision = 2;
    else if (field === "sourceBindingVerified") b.sourceBindingVerified = true;
    else if (field === "total") f.state.total = 2;
    else if (field === "truncated") f.state.truncated = true;
    else b[field] = typeof b[field] === "number" ? b[field] + 1 : field === "warnings" ? [] : "changed";
    await assert.rejects(close(f.options, "apply"));
  });
});
test("all four downloaded files and manifests must remain bound and completely parsed", async t => {
  for (const mode of ["sha", "extra", "bytes", "rows", "content", "stage", "task", "query", "baseline", "identity", "run", "browserClosed"]) await t.test(mode, async t => {
    const f = await fixture(t), pin = f.target.downloads[3], original = f.originals[3], op = f.plan.operations[3];
    if (mode === "sha") await writeFile(original.filePath, "changed");
    if (mode === "extra") await writeFile(path.join(path.dirname(original.filePath), "extra.tmp"), "extra");
    if (mode === "bytes") pin.bytes++;
    if (mode === "rows") { pin.rows--; op.rowCount--; original.exported.expectedRowCount--; original.exported.queryEvidence.total--; pin.exportMetadata.expectedRowCount--; pin.exportMetadata.queryEvidence.total--; await f.savePlan(); }
    if (mode === "content") { pin.contentHash = "a".repeat(64); op.contentHash = pin.contentHash; await f.savePlan(); }
    if (mode === "stage") original.exported.stage = "submitted";
    if (mode === "task") original.exported.taskEvidence.id++;
    if (mode === "query") original.exported.queryEvidence.requestHash = "a".repeat(64);
    if (mode === "baseline") original.exported.baseline.push(String(original.exported.taskEvidence.id));
    if (mode === "identity") original.exported.identity = "a".repeat(64);
    if (mode === "run") original.exported.runId = "wrong";
    if (mode === "browserClosed") original.exported.result.browserClosed = false;
    if (!["sha", "extra", "bytes", "content"].includes(mode)) await f.saveExport(3);
    await assert.rejects(close(f.options, "apply"));
  });
});
test("each of the eight original file members is independently pinned", async t => {
  for (let index = 0; index < 4; index++) for (const member of ["filePath", "exportPath"] as const) await t.test(`${index}:${member}`, async t => {
    const f = await fixture(t); await writeFile(f.originals[index][member], "changed");
    await assert.rejects(close(f.options, "apply")); await assert.rejects(readdir(f.recovery), { code: "ENOENT" });
  });
});
test("original failure, operation receipts, source settings, scope revisions and configuration are fixed", async t => {
  for (const mode of ["active", "failure", "phase", "outcome", "opStage", "receipt", "scope0", "scope2", "scopeExtra", "monitor", "push", "notify", "config", "registry"]) await t.test(mode, async t => {
    const f = await fixture(t);
    if (mode === "active") await writeFile(path.join(f.directory, "active.json"), f.activeRaw + " ");
    if (mode === "failure") f.plan.failure!.code = "OTHER";
    if (mode === "phase") f.plan.failure!.stage = "run";
    if (mode === "outcome") f.plan.outcome = "pending";
    if (mode === "opStage") f.plan.operations[0].stage = "verified";
    if (mode === "receipt") f.plan.operations[1].receipt!.status = "duplicate";
    if (["failure", "phase", "outcome", "opStage", "receipt"].includes(mode)) await f.savePlan();
    if (mode === "scope0") f.settings.scopeRevisions[0].revision = 0;
    if (mode === "scope2") f.settings.scopeRevisions[0].revision = 2;
    if (mode === "scopeExtra") f.settings.scopeRevisions.push({ ...f.settings.scopeRevisions[0] });
    if (mode === "monitor") f.settings.departments[0].monitorEnabled = true;
    if (mode === "push") f.settings.departments[0].pushEnabled = true;
    if (mode === "notify") f.settings.notification.enabled = true;
    if (mode === "config" || mode === "registry") await writeFile(path.join(f.root, "config", mode === "config" ? "jd-logistics-sources.json" : "jd-store-accounts.json"), "{}");
    await assert.rejects(close(f.options, "apply"));
  });
});
test("n8n must retain one successful B, failed C branch, one release and no D or replay", async t => {
  for (const mode of ["terminal", "active", "inflight", "Bbranch", "Creplay", "Cbranch", "D", "release", "order", "error", "imports"]) await t.test(mode, async t => {
    const f = await fixture(t), db = new DatabaseSync(f.databasePath);
    if (mode === "terminal") db.exec("UPDATE execution_entity SET status='success'");
    if (mode === "active") db.exec("UPDATE workflow_entity SET active=1");
    if (mode === "inflight") db.exec("INSERT INTO execution_entity VALUES(9620,'JdLogisticsDaily2026','waiting','manual',NULL,NULL,NULL,NULL)"); db.close();
    const run = f.runData, c = run["C·独立核验文件精确批次和当前版本"][0];
    if (mode === "Bbranch") run["B·串行下载全文件校验并导入"][0].data.main = [[], run["B·串行下载全文件校验并导入"][0].data.main[0]];
    if (mode === "Creplay") run["C·独立核验文件精确批次和当前版本"].push(c);
    if (mode === "Cbranch") c.data.main.reverse();
    if (mode === "D") run["D·缺货提醒"] = [{}];
    if (mode === "release") run["失败后释放原执行 helper"][0].data.main[0][0].json.ok = false;
    if (mode === "order") run["失败后释放原执行 helper"][0].executionIndex = 5;
    if (mode === "error") c.data.main[1][0].json.error.message = "OTHER";
    if (mode === "imports") c.data.main[1][0].json.importedCount = 3;
    if (!["terminal", "active", "inflight"].includes(mode)) await f.saveN8n();
    await assert.rejects(close(f.options, "apply"));
  });
});
test("installed code, helper generation, health and Chromium closure must stay exact", async t => {
  for (const mode of ["exporter", "pipeline", "bundle", "receipt", "pid", "birth", "busy", "browser"]) await t.test(mode, async t => {
    const f = await fixture(t);
    if (mode === "exporter" || mode === "pipeline") await writeFile(path.join(f.release, `source-snapshot/tools/${mode === "exporter" ? "jd-logistics-export.ts" : "jd-logistics-n8n-pipeline.ts"}`), "changed");
    if (mode === "bundle") await writeFile(path.join(f.release, "helper/tmall-workflow-helper.mjs"), "changed");
    if (mode === "receipt") await writeFile(path.join(f.release, "audit/helper-build-receipt.json"), "{}");
    if (mode === "pid") f.state.pid++;
    if (mode === "birth") f.state.birth = "replaced";
    if (mode === "busy") f.state.busy = true;
    if (mode === "browser") f.state.portClosed = false;
    await assert.rejects(close(f.options, "apply"));
  });
});
test("both original locks reject occupied ownership", async t => {
  for (const lock of ["pipeline", "chromium"]) await t.test(lock, async t => {
    const f = await fixture(t), lockDirectory = lock === "pipeline" ? path.join(f.directory, "pipeline.lock") : path.join(f.root, ".runtime/jd-chromium-global.lock");
    await withJackyunRunLock({ runId: "test-owner", purpose: "test", lockDirectory }, async () => { await assert.rejects(close(f.options, "apply"), /已有任务正在执行/); });
  });
});
test("no-replace conflict cannot overwrite active or the destination", async t => {
  const f = await fixture(t); f.options.checkpoint = async stage => { if (stage === "before_move") await writeFile(path.join(f.recovery, "active.archived.json"), "KEEP", { flag: "wx" }); };
  await assert.rejects(close(f.options, "apply")); assert.equal(await readFile(path.join(f.directory, "active.json"), "utf8"), f.activeRaw); assert.equal(await readFile(path.join(f.recovery, "active.archived.json"), "utf8"), "KEEP");
  const destination = path.join(f.root, "existing.json"), source = path.join(f.root, "source.json"); await writeFile(destination, "destination"); await writeFile(source, "source"); await assert.rejects(io.moveNoReplace(source, destination)); assert.equal(await readFile(destination, "utf8"), "destination");
});
test("intent, rename and commit interruptions retain one intent and forbid automatic continuation", async t => {
  for (const point of ["intent_written", "before_move", "after_move", "before_committed"] as const) await t.test(point, async t => {
    const f = await fixture(t); f.options.checkpoint = async stage => { if (stage === point) throw Error("synthetic crash"); };
    await assert.rejects(close(f.options, "apply"), /synthetic crash/); await assert.rejects(close(f.options, "apply"), /PATH_ALREADY_EXISTS/); await assert.rejects(readFile(path.join(f.recovery, "committed.json")), { code: "ENOENT" });
    assert.equal(JSON.parse(await readFile(path.join(f.recovery, "intent.json"), "utf8")).status, "eligible_intent");
    for (const o of f.originals) { assert.deepEqual(await readFile(o.filePath), o.file); assert.equal(await readFile(o.exportPath, "utf8"), o.exportRaw); }
    assert.equal(await readFile(path.join(f.directory, `${f.target.runId}.json`), "utf8"), f.manifestRaw);
  });
});
test("late batch changes and recovery copy mutation fail before a committed receipt", async t => {
  for (const mode of ["before_move", "before_committed", "copies"] as const) await t.test(mode, async t => {
    const f = await fixture(t); f.options.checkpoint = async stage => {
      if (mode === stage) f.state.batches[3].currentSelection.current = false;
      if (mode === "copies" && stage === "before_committed") await writeFile(path.join(f.recovery, "active.original.json"), "changed");
    };
    await assert.rejects(close(f.options, "apply")); await assert.rejects(readFile(path.join(f.recovery, "committed.json")), { code: "ENOENT" }); await assert.rejects(close(f.options, "apply"), /PATH_ALREADY_EXISTS/);
  });
});
