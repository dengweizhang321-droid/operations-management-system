import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { withJackyunRunLock } from "../lib/jackyun/run-lock";
import { logisticsContentHash, logisticsPlanHash, type JdLogisticsManifest } from "../lib/jd/logistics-manifest";
import { jdLogisticsProtocol, logisticsHash, parseJdLogisticsSettings, planJdLogisticsNotifications, selectJdLogisticsOperations } from "../lib/jd/logistics-policy";
import { validateJdStoreRegistry } from "../lib/jd/store-registry";
import { JD_FLOW_CSV_HEADERS, JD_SHOP_PRODUCTS_CSV_HEADERS, parseJdLogisticsWorkbook } from "../lib/inventory/jd-logistics-workbook";
import { logisticsExportIdentity } from "../tools/jd-logistics-export";
import { preexportSha256 as sha, jdPreexportEvidence as io } from "../tools/close-jd-logistics-preexport";
import { closeJdLogisticsKnownTwoDownloads as close, jdKnownTwoDownloadsTarget, type KnownTwoDownloadsTarget, type KnownTwoDownloadsOptions } from "../tools/close-jd-logistics-known-two-downloads";
const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";
const kinds = ["flow", "shop_products", "realtime_inventory", "inventory_snapshot"] as const;
async function fixture(t: test.TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), "jd-known-two-downloads-private-"));
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  const runtime = path.join(root, "runtime"), directory = path.join(root, "outputs/jd-logistics-pipeline"), target: KnownTwoDownloadsTarget = { ...structuredClone(jdKnownTwoDownloadsTarget), helperPid: 222, supervisorPid: 111 };
  const release = path.join(runtime, "releases", target.releaseId), databasePath = path.join(root, "n8n.sqlite");
  await Promise.all([mkdir(path.join(root, "config"), { recursive: true }), mkdir(directory, { recursive: true }), mkdir(path.join(release, "helper"), { recursive: true }),
    mkdir(path.join(release, "audit"), { recursive: true }), mkdir(path.join(release, "source-snapshot/tools"), { recursive: true }), mkdir(path.join(runtime, "state"), { recursive: true })]);
  const registry = { version: 1, stores: [{ storeKey: target.storeKey, platform: "京东", enabled: true, accountLabel: "fixture", shopName: "fixture", shopId: "1",
    browser: { executablePath: "fixture/chrome.exe", userDataDir: "fixture/profiles", profileName: "Default", profileDir: "fixture/profiles/Default", debugPort: 9224, downloadDir: "fixture/downloads" } }] };
  const config = { version: 1 as const, bindings: kinds.map(sourceKind => ({ sourceKind, departmentId: target.departmentId, businessUnitCode: target.businessUnitCode,
    enabled: true, sourceVerified: true, contractVersion: "jd-logistics-v1", collectorStoreKey: target.storeKey, authorizedStoreKeys: [target.storeKey], warehouseCode: "",
    ...(sourceKind === "flow" ? { initialStartDate: "2026-10-15", maxSpanDays: 366 } : {}) })) };
  const settings = parseJdLogisticsSettings({ contractVersion: "jd-logistics-v1", departments: [{ id: target.departmentId, businessUnitCode: target.businessUnitCode,
    storeKeys: [target.storeKey], logisticsEnabled: true, monitorEnabled: false, pushEnabled: false, revision: 1, capabilities: Object.fromEntries(kinds.map(k => [k, true])) }],
    scopeRevisions: [], notification: { implemented: true, enabled: false, configured: false, configDigest: "", groupName: "测试群聊", robotName: "志高助手" } });
  const stores = validateJdStoreRegistry(registry, root), anchor = "2026-10-16T05:04:57.193Z", selections = selectJdLogisticsOperations(config, settings, stores, new Date(anchor));
  const plan: JdLogisticsManifest = { protocolVersion: jdLogisticsProtocol, workflowKey: "jd-logistics", runId: target.runId, executionId: target.executionId, createdAt: anchor,
    updatedAt: "2026-10-16T05:05:37.575Z", anchorAt: anchor, baseUrl: "http://localhost:3000", planHash: "", stage: "failed", outcome: "pending",
    notificationPlan: planJdLogisticsNotifications(settings, selections), notification: { stage: "pending" }, failure: { code: target.failureCode, stage: "run", at: "2026-10-16T05:05:37.574Z" },
    operations: selections.map((op, i) => ({ ...op, stage: i < 2 ? "validated" : i === 2 ? "exporting" : "planned" })) };
  const runDirectory = path.join(directory, "downloads", target.runId), flowDirectory = path.join(runDirectory, selections[0].operationId), productDirectory = path.join(runDirectory, selections[1].operationId);
  await mkdir(flowDirectory, { recursive: true }); await mkdir(productDirectory);
  const csvPath = path.join(flowDirectory, "source.csv"), exportPath = path.join(flowDirectory, "export-manifest.json");
  const sourceRow = Object.fromEntries(JD_FLOW_CSV_HEADERS.map(h => [h, ""]));
  Object.assign(sourceRow, { "业务发生时间": "2026-10-15 12:00:00", "事业部编码": target.businessUnitCode, "仓库编码": "W1", "事业部商品编号": "G1", "事业部商品名称": "合成商品",
    "京东单据编码": "D1", "业务类型": "入库", "实际原始库存": "1", "实际库存加减数量": "1", "实际库存结存": "2", "可用原始库存": "1", "可用库存加减数量": "1", "可用库存结存": "2" });
  const csv = Buffer.from([JD_FLOW_CSV_HEADERS.join(","), ...Array.from({ length: 215 }, (_, i) => JD_FLOW_CSV_HEADERS.map(h => h === "序号" ? String(i + 1) : sourceRow[h]).join(","))].join("\r\n"));
  target.downloads[0].bytes = csv.length; target.downloads[0].rawSha256 = sha(csv); target.downloads[0].contentHash = logisticsContentHash(parseJdLogisticsWorkbook(csv, "flow", target.businessUnitCode, { collectedAt: target.downloads[0].collectedAt }));
  target.downloads[0].exportIdentity = logisticsExportIdentity({ ...selections[0], sourceStatus: undefined, root, runId: target.runId, executionId: target.executionId, store: stores[0], downloadDirectory: flowDirectory, assertOwner: async () => {} });
  const taskIdentity = `direct:${logisticsHash({ requestId: target.downloads[0].directRequestId, requestHash: target.downloads[0].requestHash, attachmentHash: target.downloads[0].attachmentHash })}`;
  const scope = Object.fromEntries(["sourceKind", "departmentId", "businessUnitCode", "rangeStart", "rangeEnd", "warehouseCode"].map(k => [k, (selections[0] as any)[k]]));
  const result = { filePath: csvPath, taskIdentity, complete: true as const, browserClosed: true as const, collectedAt: target.downloads[0].collectedAt,
    identityEvidence: { observedBusinessUnitCode: target.businessUnitCode, observedAt: target.downloads[0].collectedAt, sourceUrl: "https://wl.jdl.com/bsc-inventory/flow", storeKey: target.storeKey }, scope, contractVersion: "jd-logistics-v1" };
  const exported = { version: 2, identity: target.downloads[0].exportIdentity, stage: "downloaded", runId: target.runId, executionId: target.executionId, operationId: selections[0].operationId,
    baseline: [], observedBusinessUnitCode: target.businessUnitCode, expectedRowCount: 215, fullScopeHash: target.downloads[0].fullScopeHash, directRequestId: target.downloads[0].directRequestId,
    queryEvidence: { requestHash: target.downloads[0].requestHash, total: 215, observedAt: "2026-10-16T05:05:07.089Z" }, submittedAt: "2026-10-16T05:05:08.292Z",
    requestEvidence: { observedBusinessUnitCode: target.businessUnitCode, requestedAt: target.downloads[0].collectedAt, requestHash: target.downloads[0].requestHash, attachmentHash: target.downloads[0].attachmentHash },
    taskIdentity, filePath: csvPath, rawFileHash: target.downloads[0].rawSha256, byteSize: target.downloads[0].bytes, result };
  const { filePath: _filePath, ...evidence } = result;
  Object.assign(plan.operations[0], { export: { ...evidence, relativePath: path.relative(root, csvPath).split(path.sep).join("/"), rawFileHash: target.downloads[0].rawSha256, bytes: target.downloads[0].bytes },
    rowCount: 215, contentHash: target.downloads[0].contentHash, parserVersion: "jd-logistics-workbook-v1" });
  const productPin = target.downloads[1], productOp = plan.operations[1], realtimeDirectory = path.join(runDirectory, selections[2].operationId);
  await mkdir(realtimeDirectory);
  const productCsvPath = path.join(productDirectory, "source.csv"), productExportPath = path.join(productDirectory, "export-manifest.json");
  const productRow: Record<string, string> = { "店铺": "合成店铺", "店铺商品编码": "P1", "事业部商品编码": "G1", "商品名称": "合成商品", "商品状态": "启用" };
  const productCsv = Buffer.from([JD_SHOP_PRODUCTS_CSV_HEADERS.join(","), ...Array.from({ length: 906 }, (_, i) => JD_SHOP_PRODUCTS_CSV_HEADERS.map(h => h === "店铺商品编码" ? `P${i+1}` : productRow[h] ?? "").join(","))].join("\r\n"));
  productPin.bytes = productCsv.length; productPin.rawSha256 = sha(productCsv);
  productPin.contentHash = logisticsContentHash(parseJdLogisticsWorkbook(productCsv, "shop_products", target.businessUnitCode, { collectedAt: productPin.collectedAt, allowDeclaredBusinessUnit: true }));
  productPin.operationId = productOp.operationId;
  productPin.exportIdentity = logisticsExportIdentity({ ...productOp, sourceStatus: "enabled", root, runId: target.runId, executionId: target.executionId, store: stores[0], downloadDirectory: productDirectory, assertOwner: async () => {} });
  const productScope = Object.fromEntries(["sourceKind", "departmentId", "businessUnitCode", "rangeStart", "rangeEnd", "warehouseCode"].map(k => [k, (productOp as any)[k]]));
  const productResult = { filePath: productCsvPath, taskIdentity: productPin.taskIdentity, complete: true as const, browserClosed: true as const, collectedAt: productPin.collectedAt,
    sourceStatus: "enabled", sourceAsOf: productOp.rangeStart,
    identityEvidence: { observedBusinessUnitCode: target.businessUnitCode, observedAt: productPin.collectedAt, sourceUrl: "https://wl.jdl.com/supplychain-bbi/esg", storeKey: target.storeKey }, scope: productScope, contractVersion: "jd-logistics-v1" };
  const productExported = { version: 2, identity: productPin.exportIdentity, stage: "downloaded", runId: target.runId, executionId: target.executionId, operationId: productOp.operationId,
    baseline: [], observedBusinessUnitCode: target.businessUnitCode, expectedRowCount: 906, fullScopeHash: productPin.fullScopeHash, sourceStatus: "enabled", productTaskEvidence: productPin.productTaskEvidence,
    queryEvidence: { requestHash: productPin.queryRequestHash, total: 906, observedAt: "2026-10-16T05:05:17.654Z" }, submittedAt: "2026-10-16T05:05:18.292Z",
    requestEvidence: { observedBusinessUnitCode: target.businessUnitCode, requestedAt: productPin.collectedAt, requestHash: productPin.requestHash, attachmentHash: productPin.attachmentHash },
    taskIdentity: productPin.taskIdentity, filePath: productCsvPath, rawFileHash: productPin.rawSha256, byteSize: productPin.bytes, result: productResult };
  const { filePath: _productFilePath, ...productEvidence } = productResult;
  Object.assign(productOp, { export: { ...productEvidence, relativePath: path.relative(root, productCsvPath).split(path.sep).join("/"), rawFileHash: productPin.rawSha256, bytes: productPin.bytes }, rowCount: 906, contentHash: productPin.contentHash, parserVersion: "jd-logistics-workbook-v1" });
  const productExportRaw = json(productExported); productPin.exportManifestSha256 = sha(productExportRaw);
  await writeFile(productCsvPath, productCsv); await writeFile(productExportPath, productExportRaw);
  plan.planHash = logisticsPlanHash(plan); target.planHash = plan.planHash;
  const manifestRaw = json(plan), activeRaw = json({ runId: target.runId, executionId: target.executionId, planHash: target.planHash }), exportRaw = json(exported);
  target.activeSha256 = sha(activeRaw); target.manifestSha256 = sha(manifestRaw); target.downloads[0].exportManifestSha256 = sha(exportRaw); target.registrySha256 = sha(json(registry)); target.sourceConfigSha256 = sha(json(config));
  await Promise.all([writeFile(csvPath, csv), writeFile(exportPath, exportRaw), writeFile(path.join(directory, "active.json"), activeRaw), writeFile(path.join(directory, `${target.runId}.json`), manifestRaw),
    writeFile(path.join(root, "config/jd-logistics-sources.json"), json(config)), writeFile(path.join(root, "config/jd-store-accounts.json"), json(registry))]);
  const task = (index: number, payload?: unknown, branch = 0) => ({ executionStatus: payload ? "success" : "error", executionIndex: index,
    ...(payload ? { data: { main: branch === 0 ? [[{ json: payload }]] : [[], [{ json: payload }]] } } : {}) });
  const aName = "A·冻结事业部来源与日期计划", bName = "B·串行下载全文件校验并导入", releaseName = "失败后释放原执行 helper";
  const granted = { ok: true, workflow: "jd-logistics", coordinationStatus: "granted" };
  const runData = { "手动完整运行": [task(0, {})], "领取共享 helper": [task(1, granted)], "已领取执行所有权？": [task(2, granted)],
    [aName]: [task(3, { runId: target.runId, stage: "planned", operationCount: 4 })], [bName]: [task(4, { runId: target.runId, error: { status: 500, message: target.failureCode } }, 1)],
    [releaseName]: [task(5, { ok: true, stage: "released", workflow: "jd-logistics" })], "保留证据并明确失败": [task(6)] };
  const executionData = JSON.stringify([{ resultData: { lastNodeExecuted: "保留证据并明确失败", runData } }]); target.executionDataSha256 = sha(executionData);
  const db = new DatabaseSync(databasePath);
  db.exec("CREATE TABLE workflow_entity(id TEXT,active INTEGER);CREATE TABLE execution_entity(id INTEGER,workflowId TEXT,status TEXT,mode TEXT,startedAt TEXT,stoppedAt TEXT,retrySuccessId TEXT,deletedAt TEXT);CREATE TABLE execution_data(executionId TEXT,data TEXT)");
  db.prepare("INSERT INTO workflow_entity VALUES(?,0)").run(target.workflowId);
  db.prepare("INSERT INTO execution_entity VALUES(?,?,'error','manual','2026-10-16 05:04:55','2026-10-16 05:05:38',NULL,NULL)").run(9607, target.workflowId);
  db.prepare("INSERT INTO execution_data VALUES(?,?)").run(target.executionId, executionData); db.close();
  // Synthetic source witnesses: production uses exact frozen installed SHA pins.
  const source = `async function setScope(surface) { fail("${target.failureCode}"); } export type LogisticsScopeReadback = {};
export async function prepareJdLogisticsSourceScope() { await setScope(surface, options); await selectAllWarehouseStatus(surface, options); } async function sourceRowCount() {}
async function exportJhSource() { await prepareJdLogisticsSourceScope(surface, options); stage: "baseline"; await writeJsonDurable(manifestPath, manifest); manifest.stage = "submitting"; await writeJsonDurable(manifestPath, manifest); await observedJhExport(page, surface, options); } function productTaskQueue() {}
async function exportFlowSource() { stage: "baseline"; await writeJsonDurable(manifestPath, manifest); manifest.stage = "submitting"; await writeJsonDurable(manifestPath, manifest); uniqueButton(surface, "导出"); } export async function exportJdLogistics() {}`;
  const pipeline = `export async function runJdLogisticsN8nPlan() { for (const operation of plan.operations) { const result = await exporter(); operation.stage = "validated"; } for (const operation of plan.operations) { operation.stage = "importing"; operation: "import"; } }`;
  target.exporterSha256 = sha(source); target.pipelineSha256 = sha(pipeline);
  await writeFile(path.join(release, "source-snapshot/tools/jd-logistics-export.ts"), source); await writeFile(path.join(release, "source-snapshot/tools/jd-logistics-n8n-pipeline.ts"), pipeline);
  const hash = createHash("sha256");
  for (const name of ["jackyun-json-publish.ps1", "jd-credential-vault.ps1", "tmall-credential-vault.ps1", "tmall-workflow-helper.mjs"]) {
    const content = Buffer.from(`fixture:${name}`), n = Buffer.from(name), nl = Buffer.alloc(4), cl = Buffer.alloc(8); nl.writeUInt32BE(n.length); cl.writeBigUInt64BE(BigInt(content.length)); hash.update(nl).update(n).update(cl).update(content);
    await writeFile(path.join(release, "helper", name), content);
  }
  target.helperTreeSha256 = hash.digest("hex");
  const receipt = json({ status: "passed", helperTree: { fileCount: 4, sha256: target.helperTreeSha256 }, evidence: { inputFiles: [
    { relativePath: "tools/jd-logistics-export.ts", sha256: target.exporterSha256 }, { relativePath: "tools/jd-logistics-n8n-pipeline.ts", sha256: target.pipelineSha256 }] } });
  target.helperReceiptSha256 = sha(receipt); await writeFile(path.join(release, "audit/helper-build-receipt.json"), receipt);
  const deployment = json({ fixture: true }); target.releaseManifestSha256 = sha(deployment); await writeFile(path.join(release, "deployment-manifest.json"), deployment);
  await writeFile(path.join(runtime, "state/worker-process.json"), json({ releaseId: target.releaseId, manifestSha256: target.releaseManifestSha256, supervisorPid: 111, supervisorCreationDate: target.supervisorCreationDate }));
  const state = { batchTotal: 0, helperBusy: false, portClosed: true, processPid: 222, birth: target.helperCreationDate, requests: [] as string[] };
  const request: typeof fetch = async (input, init) => {
    assert.equal(init?.method, "GET"); assert.equal(init?.body, undefined); assert.equal(init?.redirect, "manual"); const url = new URL(String(input)); state.requests.push(url.toString());
    if (url.origin === "http://127.0.0.1:5791" && url.pathname === "/health") return Response.json({ ok: true, stage: "ready", busy: state.helperBusy, activeWorkflow: null, storeExecutions: [], drain: null });
    assert.equal(url.origin, "http://localhost:3000"); assert.equal(url.pathname, "/api/inventory/jd-logistics");
    if (url.searchParams.get("operation") === "settings") return Response.json({ success: true, data: settings });
    assert.equal(url.searchParams.get("operation"), "batches"); return Response.json({ success: true, data: { total: state.batchTotal, items: [], page: 1, pageSize: 1 } });
  };
  const options: KnownTwoDownloadsOptions = { root, runtime, databasePath, target, request, portProbe: async p => { assert.equal(p, 9224); return state.portClosed; }, processProbe: async () => ({ pid: state.processPid, parentPid: 111,
    creationDate: state.birth, supervisorCreationDate: target.supervisorCreationDate, commandLine: `"C:\\Program Files\\nodejs\\node.exe" ${path.join(release, "helper/tmall-workflow-helper.mjs")} serve --port 5791` }) };
  const recovery = path.join(directory, `known-two-downloads-${target.executionId}-${target.activeSha256.slice(0, 16)}`);
  const savePlan = async () => { const raw = json(plan); target.manifestSha256 = sha(raw); await writeFile(path.join(directory, `${target.runId}.json`), raw); };
  const saveExport = async () => { const raw = json(exported); target.downloads[0].exportManifestSha256 = sha(raw); await writeFile(exportPath, raw); };
  const saveN8n = async () => { const raw = JSON.stringify([{ resultData: { lastNodeExecuted: "保留证据并明确失败", runData } }]); target.executionDataSha256 = sha(raw); const db = new DatabaseSync(databasePath); db.prepare("UPDATE execution_data SET data=?").run(raw); db.close(); };
  const saveProductExport = async () => { const raw = json(productExported); productPin.exportManifestSha256 = sha(raw); await writeFile(productExportPath, raw); };
  return { productPin, productCsv, productCsvPath, productExportPath, productExported, productExportRaw, realtimeDirectory, saveProductExport, root, directory, release, databasePath, target, options, plan, settings, state, recovery, activeRaw, manifestRaw, exportRaw, csv, csvPath, exportPath, exported, productDirectory, runDirectory, runData, savePlan, saveExport, saveN8n };
}
test("9607 archives only active, preserves completed flow bytes and failed n8n, and prevents replay", async t => {
  const f = await fixture(t), inspected = await close(f.options);
  assert.equal(inspected.status, "eligible_intent"); assert.deepEqual(inspected.effects, { completedDownloads: ["flow", "shop_products"], businessImports: 0, remainingSourcesExportSubmitted: false });
  const committed = await close(f.options, "apply"); assert.equal(committed.status, "committed"); assert.match(committed.nextAction, /never retry 9607/);
  assert.match(committed.oldDownloadsDisposition, /no_handoff_no_import/); assert.equal("noEffects" in committed, false);
  await assert.rejects(readFile(path.join(f.directory, "active.json")), { code: "ENOENT" });
  assert.deepEqual(await readFile(f.csvPath), f.csv); assert.equal(await readFile(f.exportPath, "utf8"), f.exportRaw);
  assert.deepEqual(await readFile(f.productCsvPath), f.productCsv); assert.equal(await readFile(f.productExportPath, "utf8"), f.productExportRaw);
  assert.equal(await readFile(path.join(f.directory, `${f.target.runId}.json`), "utf8"), f.manifestRaw);
  assert.equal(await readFile(path.join(f.recovery, "active.archived.json"), "utf8"), f.activeRaw);
  const db = new DatabaseSync(f.databasePath, { readOnly: true }); assert.equal(db.prepare("SELECT status FROM execution_entity WHERE id=9607").get()?.status, "error"); db.close();
  await assert.rejects(close(f.options, "apply"), /PATH_ALREADY_EXISTS/);
});
test("actual flattened n8n encoding is resolved without accepting a business replay", async t => {
  const f = await fixture(t), db = new DatabaseSync(f.databasePath), original = JSON.parse(db.prepare("SELECT data FROM execution_data").get()!.data as string)[0];
  const values: any[] = [], strings = new Map<string, string>(), objects = new WeakMap<object, string>();
  const ref = (v: any): any => {
    if (v === null || typeof v === "number" || typeof v === "boolean") return v;
    const existing = typeof v === "string" ? strings.get(v) : objects.get(v); if (existing !== undefined) return existing;
    const index = String(values.length); if (typeof v === "string") strings.set(v, index); else objects.set(v, index); values.push(null);
    values[Number(index)] = typeof v === "string" ? v : Array.isArray(v) ? v.map(ref) : Object.fromEntries(Object.entries(v).map(([k, value]) => [k, ref(value)])); return index;
  };
  ref(original); const raw = JSON.stringify(values); f.target.executionDataSha256 = sha(raw); db.prepare("UPDATE execution_data SET data=?").run(raw); db.close();
  assert.equal((await close(f.options)).n8n.preAWaits, 0);
});
test("flow layout, hash, byte count, parser row/content, downloaded stage and bindings are mandatory", async t => {
  for (const mode of ["extra", "csv-sha", "bytes", "row", "content", "stage", "identity", "request", "attachment", "run", "result", "fullScope", "time"] as const) await t.test(mode, async t => {
    const f = await fixture(t);
    if (mode === "extra") await writeFile(path.join(path.dirname(f.csvPath), "download.tmp"), "extra");
    if (mode === "csv-sha") await writeFile(f.csvPath, Buffer.concat([f.csv, Buffer.from(" ")]));
    if (mode === "bytes") f.target.downloads[0].bytes++;
    if (mode === "row") { f.target.downloads[0].rows--; f.plan.operations[0].rowCount--; f.exported.expectedRowCount--; f.exported.queryEvidence.total--; await f.savePlan(); await f.saveExport(); }
    if (mode === "content") { f.target.downloads[0].contentHash = "a".repeat(64); f.plan.operations[0].contentHash = f.target.downloads[0].contentHash; await f.savePlan(); }
    if (mode === "stage") f.exported.stage = "submitted";
    if (mode === "identity") f.exported.identity = "a".repeat(64);
    if (mode === "request") f.exported.requestEvidence.requestHash = "a".repeat(64);
    if (mode === "attachment") f.exported.requestEvidence.attachmentHash = "a".repeat(64);
    if (mode === "run") f.exported.runId = "wrong";
    if (mode === "result") f.exported.result.complete = false as any;
    if (mode === "fullScope") f.exported.fullScopeHash = "a".repeat(64);
    if (mode === "time") f.exported.submittedAt = "2026-10-16T06:00:00.000Z";
    if (!["extra", "csv-sha", "bytes", "row", "content"].includes(mode)) await f.saveExport();
    await assert.rejects(close(f.options, "apply")); assert.equal(await readFile(path.join(f.directory, "active.json"), "utf8"), f.activeRaw);
    await assert.rejects(readdir(f.recovery), { code: "ENOENT" });
  });
});
test("any later file/directory, importing/receipt, batch, scope or identity change refuses", async t => {
  for (const mode of ["realtime-file", "later-dir", "receipt", "importing", "batch", "revision", "department", "stores", "config"] as const) await t.test(mode, async t => {
    const f = await fixture(t);
    if (mode === "realtime-file") await writeFile(path.join(f.realtimeDirectory, "export-manifest.json"), "effect");
    if (mode === "later-dir") await mkdir(path.join(f.runDirectory, f.plan.operations[3].operationId));
    if (mode === "receipt") { f.plan.operations[0].receipt = {} as any; await f.savePlan(); }
    if (mode === "importing") { f.plan.operations[1].stage = "importing"; await f.savePlan(); }
    if (mode === "batch") f.state.batchTotal = 1;
    if (mode === "revision") f.settings.scopeRevisions.push({ departmentId: f.target.departmentId, sourceKind: "flow", revision: 1 });
    if (mode === "department") f.settings.departments[0].businessUnitCode = "EBU111";
    if (mode === "stores") f.settings.departments[0].storeKeys.push("other");
    if (mode === "config") await writeFile(path.join(f.root, "config/jd-logistics-sources.json"), "{}");
    await assert.rejects(close(f.options, "apply")); assert.equal(await readFile(path.join(f.directory, "active.json"), "utf8"), f.activeRaw);
  });
});
test("n8n must be inactive terminal original error with one ordered A/B/error/release", async t => {
  for (const mode of ["terminal", "active", "running", "branch", "release", "replay", "order", "wait-count", "grant"] as const) await t.test(mode, async t => {
    const f = await fixture(t), db = new DatabaseSync(f.databasePath);
    if (mode === "terminal") db.exec("UPDATE execution_entity SET status='success'");
    if (mode === "active") db.exec("UPDATE workflow_entity SET active=1");
    if (mode === "running") db.exec("INSERT INTO execution_entity VALUES(9582,'JdLogisticsDaily2026','waiting','manual',NULL,NULL,NULL,NULL)"); db.close();
    const run = f.runData as any;
    if (mode === "branch") run["B·串行下载全文件校验并导入"][0].data.main.reverse();
    if (mode === "release") run["失败后释放原执行 helper"][0].data.main[0][0].json.ok = false;
    if (mode === "replay") run["A·冻结事业部来源与日期计划"].push(run["A·冻结事业部来源与日期计划"][0]);
    if (mode === "order") run["失败后释放原执行 helper"][0].executionIndex = 3;
    if (mode === "wait-count") run["等待5分钟后重新领取"] = [{}];
    if (mode === "grant") run["领取共享 helper"][0].data.main[0][0].json.coordinationStatus = "waiting";
    if (["branch", "release", "replay", "order", "wait-count", "grant"].includes(mode)) await f.saveN8n();
    await assert.rejects(close(f.options, "apply"));
  });
});
test("installed code, lifecycle, busy helper and open browser refuse", async t => {
  for (const mode of ["exporter", "pipeline", "bundle", "receipt", "birth", "pid", "busy", "browser"] as const) await t.test(mode, async t => {
    const f = await fixture(t);
    if (mode === "exporter" || mode === "pipeline") await writeFile(path.join(f.release, `source-snapshot/tools/${mode === "exporter" ? "jd-logistics-export.ts" : "jd-logistics-n8n-pipeline.ts"}`), "changed");
    if (mode === "bundle") await writeFile(path.join(f.release, "helper/tmall-workflow-helper.mjs"), "changed");
    if (mode === "receipt") await writeFile(path.join(f.release, "audit/helper-build-receipt.json"), "{}");
    if (mode === "birth") f.state.birth = "wrong";
    if (mode === "pid") f.state.processPid++;
    if (mode === "busy") f.state.helperBusy = true;
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
test("no-replace conflict retains original active and destination", async t => {
  const f = await fixture(t); f.options.checkpoint = async stage => { if (stage === "before_move") await writeFile(path.join(f.recovery, "active.archived.json"), "DO NOT OVERWRITE", { flag: "wx" }); };
  await assert.rejects(close(f.options, "apply")); assert.equal(await readFile(path.join(f.directory, "active.json"), "utf8"), f.activeRaw);
  assert.equal(await readFile(path.join(f.recovery, "active.archived.json"), "utf8"), "DO NOT OVERWRITE"); await assert.rejects(readFile(path.join(f.recovery, "committed.json")), { code: "ENOENT" });
});
test("Windows no-replace primitive refuses an existing target", async t => {
  const f = await fixture(t), target = path.join(f.root, "existing.json"), source = path.join(f.root, "source.json");
  await writeFile(target, "destination"); await writeFile(source, "original");
  await assert.rejects(io.moveNoReplace(source, target));
  assert.equal(await readFile(target, "utf8"), "destination"); assert.equal(await readFile(source, "utf8"), "original");
});
test("recovery evidence mutation or late source effect cannot commit", async t => {
  for (const mode of ["intent", "source", "post-rename-source", "copies"] as const) await t.test(mode, async t => {
    const f = await fixture(t); f.options.checkpoint = async stage => {
      if (mode === "intent" && stage === "before_move") await writeFile(path.join(f.recovery, "intent.json"), "{}");
      if (mode === "source" && stage === "before_move" || mode === "post-rename-source" && stage === "before_committed") await writeFile(path.join(f.realtimeDirectory, "late.tmp"), "effect");
      if (mode === "copies" && stage === "before_committed") await writeFile(path.join(f.recovery, "active.original.json"), "changed");
    };
    await assert.rejects(close(f.options, "apply")); await assert.rejects(readFile(path.join(f.recovery, "committed.json")), { code: "ENOENT" });
    await assert.rejects(close(f.options, "apply"), /PATH_ALREADY_EXISTS/);
  });
});
test("intent/rename/commit crashes retain the sole intent and cannot auto-resume", async t => {
  for (const point of ["intent_written", "before_move", "after_move", "before_committed"] as const) await t.test(point, async t => {
    const f = await fixture(t); f.options.checkpoint = async stage => { if (stage === point) throw new Error("synthetic crash"); };
    await assert.rejects(close(f.options, "apply"), /synthetic crash/); await assert.rejects(close(f.options, "apply"), /PATH_ALREADY_EXISTS/);
    assert.equal(JSON.parse(await readFile(path.join(f.recovery, "intent.json"), "utf8")).status, "eligible_intent");
    await assert.rejects(readFile(path.join(f.recovery, "committed.json")), { code: "ENOENT" }); assert.deepEqual(await readFile(f.csvPath), f.csv); assert.equal(await readFile(f.exportPath, "utf8"), f.exportRaw);
  assert.deepEqual(await readFile(f.productCsvPath), f.productCsv); assert.equal(await readFile(f.productExportPath, "utf8"), f.productExportRaw);
    if (point === "after_move" || point === "before_committed") await assert.rejects(readFile(path.join(f.directory, "active.json")), { code: "ENOENT" });
    else assert.equal(await readFile(path.join(f.directory, "active.json"), "utf8"), f.activeRaw);
  });
});

test("products must retain complete enabled CSV and exact original task/request/attachment identity", async t => {
  for (const mode of ["extra", "raw", "bytes", "rows", "content", "stage", "task", "sourceStatus", "request", "query", "attachment", "run", "identity", "taskStatus", "shopSet", "disabledRow"] as const) await t.test(mode, async t => {
    const f = await fixture(t), e = f.productExported, pin = f.productPin, op = f.plan.operations[1];
    if (mode === "extra") await writeFile(path.join(f.productDirectory, "extra.tmp"), "extra");
    if (mode === "raw") await writeFile(f.productCsvPath, "changed");
    if (mode === "bytes") pin.bytes++;
    if (mode === "rows") { pin.rows--; op.rowCount--; e.expectedRowCount--; e.queryEvidence.total--; pin.productTaskEvidence!.recordCount--; await f.savePlan(); }
    if (mode === "content") { pin.contentHash = "a".repeat(64); op.contentHash = pin.contentHash; await f.savePlan(); }
    if (mode === "stage") e.stage = "submitted";
    if (mode === "task") e.taskIdentity = "products:999";
    if (mode === "sourceStatus") e.sourceStatus = "unverified";
    if (mode === "request") e.requestEvidence.requestHash = "a".repeat(64);
    if (mode === "query") e.queryEvidence.requestHash = "a".repeat(64);
    if (mode === "attachment") e.requestEvidence.attachmentHash = "a".repeat(64);
    if (mode === "run") e.runId = "wrong";
    if (mode === "identity") e.identity = "a".repeat(64);
    if (mode === "taskStatus") e.productTaskEvidence = { ...e.productTaskEvidence!, taskStatus: "2" };
    if (mode === "shopSet") e.productTaskEvidence = { ...e.productTaskEvidence!, shopSetHash: "a".repeat(64) };
    if (mode === "disabledRow") {
      const changed = Buffer.from(f.productCsv.toString("utf8").replace("启用", "停用"));
      pin.rawSha256 = sha(changed); pin.bytes = changed.length; e.rawFileHash = pin.rawSha256; e.byteSize = pin.bytes;
      op.export!.rawFileHash = pin.rawSha256; op.export!.bytes = pin.bytes;
      await writeFile(f.productCsvPath, changed); await f.savePlan();
    }
    await f.saveProductExport(); await assert.rejects(close(f.options, "apply"));
    assert.equal(await readFile(path.join(f.directory, "active.json"), "utf8"), f.activeRaw);
  });
});
test("changed originals, wrong failure phase/code or older execution cannot qualify", async t => {
  for (const mode of ["active", "manifest", "phase", "code", "older-execution"] as const) await t.test(mode, async t => {
    const f = await fixture(t);
    if (mode === "active") await writeFile(path.join(f.directory, "active.json"), f.activeRaw + " ");
    if (mode === "manifest") await writeFile(path.join(f.directory, `${f.target.runId}.json`), f.manifestRaw + " ");
    if (mode === "phase") { f.plan.failure!.stage = "verify"; await f.savePlan(); }
    if (mode === "code") { f.plan.failure!.code = "JD_LOGISTICS_PRODUCT_STATUS_CONTROL_AMBIGUOUS"; await f.savePlan(); }
    if (mode === "older-execution") f.target.executionId = "9581";
    await assert.rejects(close(f.options, "apply")); await assert.rejects(readdir(f.recovery), { code: "ENOENT" });
  });
});
