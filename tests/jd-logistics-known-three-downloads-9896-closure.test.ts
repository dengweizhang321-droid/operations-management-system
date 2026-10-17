/* eslint-disable @typescript-eslint/no-explicit-any -- Mutable synthetic n8n graph and corruption fixtures intentionally model malformed evidence. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import * as XLSX from "xlsx";
import { withJackyunRunLock } from "../lib/jackyun/run-lock";
import { defaultJdChromiumRunLockDirectory } from "../lib/jd/chromium-run-lock";
import { logisticsContentHash, logisticsPlanHash, type JdLogisticsManifest } from "../lib/jd/logistics-manifest";
import { jdLogisticsSourceUrls, logisticsHash, parseJdLogisticsSettings, planJdLogisticsNotifications, selectJdLogisticsOperations } from "../lib/jd/logistics-policy";
import { jhLogisticsExportRequest, jhLogisticsQueryRequest } from "../lib/jd/logistics-source-tasks";
import { validateJdStoreRegistry } from "../lib/jd/store-registry";
import { JD_FLOW_CSV_HEADERS, JD_SHOP_PRODUCTS_CSV_HEADERS, parseJdLogisticsWorkbook } from "../lib/inventory/jd-logistics-workbook";
import { logisticsExportIdentity } from "../tools/jd-logistics-export";
import { preexportSha256 as sha, jdPreexportEvidence as io } from "../tools/close-jd-logistics-preexport";
import { closureSettingsHash } from "../tools/close-jd-logistics-login-9851";
import { jdKnownThreeDownloads9896Target } from "../tools/jd-logistics-known-three-downloads-9896-target";
import { closeJdLogisticsKnownThreeDownloads9896 as close, type KnownThreeDownloads9896Target, type KnownThreeDownloads9896Options } from "../tools/close-jd-logistics-known-three-downloads-9896";
const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";
const kinds = ["flow", "shop_products", "realtime_inventory", "inventory_snapshot"] as const;
const aName = "A·冻结事业部来源与日期计划", bName = "B·串行下载全文件校验并导入", releaseName = "失败后释放原执行 helper", waitName = "等待5分钟后重新领取";

async function fixture(t: test.TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), "jd-three-9896-private-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = { ...structuredClone(jdKnownThreeDownloads9896Target), supervisorPid: 111, helperPid: 222 } as KnownThreeDownloads9896Target;
  const runtime = path.join(root, "runtime"), directory = path.join(root, "outputs/jd-logistics-pipeline"), databasePath = path.join(root, "n8n.sqlite");
  const release = path.join(runtime, "releases", target.releaseId), original = path.join(runtime, "releases", target.originalReleaseId), successorRoot = path.join(runtime, "state/worker-release-successors");
  for (const dir of [path.join(root, "config"), directory, successorRoot, ...[release, original].flatMap(base => [path.join(base, "helper"), path.join(base, "audit"), path.join(base, "source-snapshot/tools"), path.join(base, "source-snapshot/lib/jd")])]) await mkdir(dir, { recursive: true });
  const registry = { version: 1, stores: [{ storeKey: target.storeKey, platform: "京东", enabled: true, accountLabel: "fixture", shopName: "fixture", shopId: "1", browser: { executablePath: "fixture/chrome.exe", userDataDir: "fixture/profiles", profileName: "Default", profileDir: "fixture/profiles/Default", debugPort: 9224, downloadDir: "fixture/downloads" } }] };
  const config = { version: 1 as const, bindings: kinds.map(sourceKind => ({ sourceKind, departmentId: target.departmentId, businessUnitCode: target.businessUnitCode, enabled: true, sourceVerified: true, contractVersion: "jd-logistics-v1", collectorStoreKey: target.storeKey, authorizedStoreKeys: [target.storeKey], warehouseCode: "", ...(sourceKind === "flow" ? { initialStartDate: "2026-10-15", maxSpanDays: 366 } : {}) })) };
  const settings = { ...parseJdLogisticsSettings({ contractVersion: "jd-logistics-v1", departments: [{ id: target.departmentId, businessUnitCode: target.businessUnitCode, storeKeys: [target.storeKey], logisticsEnabled: true, monitorEnabled: false, pushEnabled: false, revision: 4, capabilities: Object.fromEntries(kinds.map(k => [k, true])) }], scopeRevisions: kinds.map((sourceKind, i) => ({ sourceKind, departmentId: target.departmentId, revision: target.initialScopeRevisions[i] })), notification: { implemented: true, enabled: false, configured: false, configDigest: "", groupName: "测试群聊", robotName: "志高助手" } }), revision: "inventory-v1" };
  Object.assign(settings.departments[0], { unmonitoredProductCodes: [] }); target.settingsHash = closureSettingsHash(settings);
  const stores = validateJdStoreRegistry(registry, root), anchor = "2026-10-17T03:17:54.000Z", selections = selectJdLogisticsOperations(config, settings, stores, new Date(anchor));
  const plan: JdLogisticsManifest = { protocolVersion: "jd-logistics-pipeline-v1", workflowKey: "jd-logistics", runId: target.runId, executionId: target.executionId, createdAt: anchor, updatedAt: "2026-10-17T03:18:46.000Z", anchorAt: anchor, baseUrl: "http://localhost:3000", planHash: "", stage: "failed", outcome: "pending", notificationPlan: planJdLogisticsNotifications(settings, selections), notification: { stage: "pending" }, failure: { code: target.failureCode, stage: "run", at: "2026-10-17T03:18:46.000Z" }, operations: selections.map((op, i) => ({ ...op, stage: i < 3 ? "validated" : "exporting" })) };
  const runDirectory = path.join(directory, "downloads", target.runId), originals: Array<{ filePath: string; exportPath: string; file: Buffer; exportRaw: string; exported: any }> = [];
  for (let i = 0; i < 3; i++) {
    const op = plan.operations[i], pin = target.downloads[i], downloadDirectory = path.join(runDirectory, op.operationId); await mkdir(downloadDirectory, { recursive: true });
    pin.rows = i + 2; pin.operationId = op.operationId;
    let file: Buffer;
    if (i === 0) {
      const row: Record<string, string> = { "业务发生时间": "2026-10-16 12:00:00", "事业部编码": target.businessUnitCode, "仓库编码": "W1", "事业部商品编号": "G1", "事业部商品名称": "合成商品", "京东单据编码": "D1", "业务类型": "入库", "实际原始库存": "1", "实际库存加减数量": "1", "实际库存结存": "2", "可用原始库存": "1", "可用库存加减数量": "1", "可用库存结存": "2" };
      file = Buffer.from([JD_FLOW_CSV_HEADERS.join(","), ...Array.from({ length: pin.rows }, (_, n) => JD_FLOW_CSV_HEADERS.map(h => h === "序号" ? String(n + 1) : row[h] ?? "").join(","))].join("\r\n"));
    } else if (i === 1) {
      const row: Record<string, string> = { "店铺": "合成店铺", "事业部商品编码": "G1", "商品名称": "合成商品", "商品状态": "启用" };
      file = Buffer.from([JD_SHOP_PRODUCTS_CSV_HEADERS.join(","), ...Array.from({ length: pin.rows }, (_, n) => JD_SHOP_PRODUCTS_CSV_HEADERS.map(h => h === "店铺商品编码" ? `P${n + 1}` : row[h] ?? "").join(","))].join("\r\n"));
      pin.productTaskEvidence!.recordCount = pin.rows;
    } else {
      const grid = [["事业部编码", "京东SKU", "商品名称", "仓库编码", "仓库名称", "日期", "可用库存", "在库件数", "近7天销量", "近30天销量"], ...Array.from({ length: pin.rows }, (_, n) => [target.businessUnitCode, `SKU${n + 1}`, "合成商品", "W1", "合成仓", op.rangeStart, 3, 5, 7, 30])];
      const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(grid), "source"); file = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
      pin.queryRequestHash = logisticsHash(jhLogisticsQueryRequest(op)); pin.requestHash = logisticsHash(jhLogisticsExportRequest(op));
    }
    pin.rawSha256 = sha(file); pin.bytes = file.length; pin.contentHash = logisticsContentHash(parseJdLogisticsWorkbook(file, op.sourceKind, target.businessUnitCode, { collectedAt: pin.collectedAt, allowDeclaredBusinessUnit: i !== 0 }));
    const filePath = path.join(downloadDirectory, i === 2 ? "source.xlsx" : "source.csv"), exportPath = path.join(downloadDirectory, "export-manifest.json");
    pin.exportIdentity = logisticsExportIdentity({ ...op, sourceStatus: i === 1 ? "enabled" : undefined, root, runId: plan.runId, executionId: plan.executionId, store: stores[0], downloadDirectory, assertOwner: async () => {} });
    pin.queryEvidence = { ...pin.queryEvidence as object, requestHash: pin.queryRequestHash, total: pin.rows }; pin.requestEvidence = { ...pin.requestEvidence as object, requestHash: pin.requestHash };
    const result = { filePath, taskIdentity: pin.taskIdentity, complete: true, browserClosed: true, collectedAt: pin.collectedAt, ...(i > 0 ? { sourceAsOf: op.rangeStart } : {}), ...(i === 1 ? { sourceStatus: "enabled" } : {}), identityEvidence: { observedBusinessUnitCode: target.businessUnitCode, observedAt: pin.collectedAt, sourceUrl: jdLogisticsSourceUrls[op.sourceKind], storeKey: target.storeKey }, scope: Object.fromEntries(["sourceKind", "departmentId", "businessUnitCode", "rangeStart", "rangeEnd", "warehouseCode"].map(k => [k, (op as any)[k]])), contractVersion: "jd-logistics-v1" };
    const exported = { version: 2, identity: pin.exportIdentity, stage: "downloaded", runId: plan.runId, executionId: plan.executionId, operationId: op.operationId, baseline: [...pin.baseline], observedBusinessUnitCode: target.businessUnitCode, fullScopeHash: pin.fullScopeHash, expectedRowCount: pin.rows, requestEvidence: pin.requestEvidence, queryEvidence: pin.queryEvidence, submittedAt: pin.submittedAt, taskIdentity: pin.taskIdentity, ...(i === 0 ? { directRequestId: pin.directRequestId } : i === 1 ? { sourceStatus: "enabled", productTaskEvidence: structuredClone(pin.productTaskEvidence) } : { taskEvidence: structuredClone(pin.taskEvidence) }), filePath, rawFileHash: pin.rawSha256, byteSize: pin.bytes, result };
    const evidence = Object.fromEntries(Object.entries(result).filter(([key]) => key !== "filePath")); Object.assign(op, { export: { ...evidence, relativePath: path.relative(root, filePath).split(path.sep).join("/"), rawFileHash: pin.rawSha256, bytes: pin.bytes }, rowCount: pin.rows, contentHash: pin.contentHash, parserVersion: "jd-logistics-workbook-v1" });
    const exportRaw = json(exported); pin.exportManifestSha256 = sha(exportRaw); await writeFile(filePath, file); await writeFile(exportPath, exportRaw); originals.push({ filePath, exportPath, file, exportRaw, exported });
  }
  const snapshotDirectory = path.join(runDirectory, plan.operations[3].operationId); await mkdir(snapshotDirectory);
  plan.planHash = logisticsPlanHash(plan); target.planHash = plan.planHash;
  const activeRaw = json({ runId: target.runId, executionId: target.executionId, planHash: target.planHash }), manifestRaw = json(plan); target.activeSha256 = sha(activeRaw); target.manifestSha256 = sha(manifestRaw);
  await writeFile(path.join(directory, "active.json"), activeRaw); await writeFile(path.join(directory, `${target.runId}.json`), manifestRaw);
  await writeFile(path.join(root, "config/jd-logistics-sources.json"), json(config)); target.sourceConfigSha256 = sha(json(config)); await writeFile(path.join(root, "config/jd-store-accounts.json"), json(registry)); target.registrySha256 = sha(json(registry));
  const task = (index: number, payload?: unknown, branch = 0) => ({ executionStatus: payload ? "success" : "error", executionIndex: index, ...(payload ? { data: { main: branch === 0 ? [[{ json: payload }]] : [[], [{ json: payload }]] } } : {}) });
  const waiting = { ok: true, workflow: "jd-logistics", coordinationStatus: "waiting" }, granted = { ...waiting, coordinationStatus: "granted" };
  const runData: Record<string, any[]> = { "手动完整运行": [task(0, {})], "领取共享 helper": [task(1, waiting), task(1, granted)], "已领取执行所有权？": [task(2, waiting, 1), task(2, granted)], [waitName]: [task(0, waiting)], [aName]: [task(3, { runId: target.runId, stage: "planned", operationCount: 4 })], [bName]: [task(4, { runId: target.runId, error: { status: 500, message: target.failureCode } }, 1)], [releaseName]: [task(5, { ok: true, stage: "released", workflow: "jd-logistics" })], "保留证据并明确失败": [task(6)] };
  const shape = { nodes: [{ type: "n8n-nodes-base.manualTrigger" }, { type: "n8n-nodes-base.scheduleTrigger" }], connections: {}, settings: { timezone: "Asia/Shanghai" } }; target.workflowShapeHash = logisticsHash(shape);
  const db = new DatabaseSync(databasePath); db.exec("CREATE TABLE workflow_entity(id TEXT,active INTEGER,versionId TEXT,activeVersionId TEXT,nodes TEXT,connections TEXT,settings TEXT);CREATE TABLE workflow_history(workflowId TEXT,versionId TEXT,nodes TEXT,connections TEXT);CREATE TABLE execution_entity(id INTEGER,workflowId TEXT,status TEXT,mode TEXT,startedAt TEXT,stoppedAt TEXT,retrySuccessId TEXT,deletedAt TEXT);CREATE TABLE execution_data(executionId TEXT,data TEXT)");
  db.prepare("INSERT INTO workflow_entity VALUES(?,0,?,NULL,?,?,?)").run(target.workflowId, target.workflowVersionId, JSON.stringify(shape.nodes), "{}", JSON.stringify(shape.settings)); db.prepare("INSERT INTO workflow_history VALUES(?,?,?,?)").run(target.workflowId, target.workflowVersionId, JSON.stringify(shape.nodes), "{}"); db.prepare("INSERT INTO execution_entity VALUES(?,?,'error','manual','2026-10-17 03:12:52.715','2026-10-17 03:18:46.970',NULL,NULL)").run(Number(target.executionId), target.workflowId); db.prepare("INSERT INTO execution_data VALUES(?,?)").run(target.executionId, ""); db.close();
  const saveN8n = async (flatten = false) => {
    const object = { resultData: { lastNodeExecuted: "保留证据并明确失败", runData } }, values: any[] = [], strings = new Map<string, string>(), objects = new WeakMap<object, string>();
    const ref = (value: any): any => { if (value === null || typeof value === "number" || typeof value === "boolean") return value; const existing = typeof value === "string" ? strings.get(value) : objects.get(value); if (existing !== undefined) return existing; const index = String(values.length); if (typeof value === "string") strings.set(value, index); else objects.set(value, index); values.push(null); values[Number(index)] = typeof value === "string" ? value : Array.isArray(value) ? value.map(ref) : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, ref(item)])); return index; };
    if (flatten) ref(object); const raw = JSON.stringify(flatten ? values : [object]); target.executionDataSha256 = sha(raw); const db = new DatabaseSync(databasePath); db.prepare("UPDATE execution_data SET data=?").run(raw); db.close();
  }; await saveN8n(true);
  const pipeline = 'export async function runJdLogisticsN8nPlan() { for (const operation of plan.operations) { const result = await exporter(); operation.stage = "validated"; } for (const operation of plan.operations) { operation.stage = "importing"; operation: "import"; } }';
  const flow = 'async function exportFlowSource() { stage: "baseline"; await writeJsonDurable(manifestPath, manifest); manifest.stage = "submitting"; await writeJsonDurable(manifestPath, manifest); uniqueButton(surface, "导出"); } export async function exportJdLogistics() {}';
  const oldSource = `async function stableSourceRows() { fail("${target.failureCode}"); } export function assertJhExportRequest() {} async function exportJhSource() { await prepareJdLogisticsSourceScope(surface, options); await stableSourceRows(page, surface, options, count, fullScopeHash); stage: "baseline"; await writeJsonDurable(manifestPath, manifest); manifest.stage = "submitting"; await writeJsonDurable(manifestPath, manifest); await observedJhExport(page, surface, options); } function productTaskQueue() {} ${flow}`;
  const currentSource = `export async function confirmLogisticsSourceReadiness() { if (options.sourceKind === "inventory_snapshot") { if (await fullScopeReadback(surface, options) !== scopeHash) fail("SCOPE"); return; } } export function assertJhExportRequest() {} ${flow}`;
  const policy = "fixture-policy"; target.pipelineSha256 = target.originalPipelineSha256 = sha(pipeline); target.policySha256 = target.originalPolicySha256 = sha(policy);
  for (const [base, source] of [[release, currentSource], [original, oldSource]]) {
    const tree = createHash("sha256");
    for (const name of ["jackyun-json-publish.ps1", "jd-credential-vault.ps1", "tmall-credential-vault.ps1", "tmall-workflow-helper.mjs"]) { const content = Buffer.from(base + name), n = Buffer.from(name), nl = Buffer.alloc(4), cl = Buffer.alloc(8); nl.writeUInt32BE(n.length); cl.writeBigUInt64BE(BigInt(content.length)); tree.update(nl).update(n).update(cl).update(content); await writeFile(path.join(base, "helper", name), content); }
    const treeSha = tree.digest("hex"), sourceSha = sha(source), receipt = json({ status: "passed", helperTree: { fileCount: 4, sha256: treeSha }, evidence: { inputFiles: [{ relativePath: "tools/jd-logistics-export.ts", sha256: sourceSha }, { relativePath: "tools/jd-logistics-n8n-pipeline.ts", sha256: sha(pipeline) }, { relativePath: "lib/jd/logistics-policy.ts", sha256: sha(policy) }] } }), deployment = json({ fixture: base });
    if (base === release) { target.helperTreeSha256 = treeSha; target.exporterSha256 = sourceSha; target.helperReceiptSha256 = sha(receipt); target.releaseManifestSha256 = sha(deployment); } else { target.originalHelperTreeSha256 = treeSha; target.originalExporterSha256 = sourceSha; target.originalHelperReceiptSha256 = sha(receipt); target.originalReleaseManifestSha256 = sha(deployment); }
    await writeFile(path.join(base, "audit/helper-build-receipt.json"), receipt); await writeFile(path.join(base, "deployment-manifest.json"), deployment); await writeFile(path.join(base, "source-snapshot/tools/jd-logistics-export.ts"), source); await writeFile(path.join(base, "source-snapshot/tools/jd-logistics-n8n-pipeline.ts"), pipeline); await writeFile(path.join(base, "source-snapshot/lib/jd/logistics-policy.ts"), policy);
  }
  await writeFile(path.join(runtime, "state/worker-process.json"), json({ releaseId: target.releaseId, manifestSha256: target.releaseManifestSha256, supervisorPid: 111, supervisorCreationDate: target.supervisorCreationDate }));
  const oldBinding = { releaseId: target.originalReleaseId, manifestSha256: target.originalReleaseManifestSha256 }, middle = { releaseId: "middle", manifestSha256: "middle" }, currentBinding = { releaseId: target.releaseId, manifestSha256: target.releaseManifestSha256 };
  const activation = async (name: string, payload: object) => { const raw = json({ version: "teruisi-local-worker-release-successor-v1", ...payload, payloadSha256: logisticsHash({ version: "teruisi-local-worker-release-successor-v1", ...payload }) }); await writeFile(path.join(successorRoot, name), raw); await writeFile(path.join(successorRoot, name + ".sha256"), sha(raw)); return sha(raw); };
  target.activationInSha256 = await activation(target.activationInFile, { sequence: 242, activatedAt: "2026-10-17T01:01:47Z", predecessor: {}, successor: oldBinding }); target.activationOutSha256 = await activation(target.activationOutFile, { sequence: 243, activatedAt: "2026-10-17T06:31:28Z", predecessor: oldBinding, successor: middle }); target.currentActivationSha256 = await activation(target.currentActivationFile, { sequence: 244, activatedAt: "2026-10-17T08:29:53Z", predecessor: middle, successor: currentBinding });
  const historical = kinds.map(sourceKind => { const items = [1, 2].map(i => ({ batchId: `${sourceKind}-${i}`, sourceKind, departmentId: target.departmentId, businessUnitCode: target.businessUnitCode, collectorEvidence: { runId: "old-run", executionId: "old-execution" } })); return { sourceKind, total: 2, items, details: items.map(item => ({ ...item, currentSelection: { current: true, contentHash: "old", scopeRevision: 2 } })) }; }); target.batchesHash = logisticsHash(historical);
  const state = { busy: false, portClosed: true, pid: 222, birth: target.helperCreationDate, exactMissing: false, truncated: false, pageTotal: 2 };
  const request: typeof fetch = async (input, init) => {
    assert.equal(init?.method, "GET"); assert.equal(init?.body, undefined); assert.equal(init?.redirect, "manual"); const url = new URL(String(input));
    if (url.origin === "http://127.0.0.1:5791") { assert.equal(url.pathname, "/health"); return Response.json({ ok: true, stage: "ready", busy: state.busy, activeWorkflow: null, storeExecutions: [], drain: null }); }
    assert.equal(url.origin, "http://localhost:3000"); assert.equal(url.pathname, "/api/inventory/jd-logistics");
    if (url.searchParams.get("operation") === "settings") return Response.json({ success: true, data: settings }); assert.equal(url.searchParams.get("operation"), "batches");
    const id = url.searchParams.get("batchId"); if (id) { const found = historical.flatMap(x => x.details).find(x => x.batchId === id)!; return Response.json({ success: true, data: { total: 1, items: [{ ...found, ...(state.exactMissing ? { currentSelection: null } : {}) }] } }); }
    const found = historical.find(x => x.sourceKind === url.searchParams.get("sourceKind"))!; return Response.json({ success: true, data: { items: found.items, total: state.pageTotal, page: 1, pageSize: 100, truncated: state.truncated } });
  };
  const options: KnownThreeDownloads9896Options = { root, runtime, databasePath, target, request, portProbe: async () => state.portClosed, processProbe: async () => ({ pid: state.pid, parentPid: 111, creationDate: state.birth, supervisorCreationDate: target.supervisorCreationDate, commandLine: `"${path.win32.join("C:/Program Files/nodejs/node.exe")}" ${path.join(release, "helper/tmall-workflow-helper.mjs")} serve --port 5791` }) };
  const changeDb = (sql: string) => { const db = new DatabaseSync(databasePath); try { db.exec(sql); } finally { db.close(); } };
  const savePlan = async () => { const raw = json(plan); target.manifestSha256 = sha(raw); await writeFile(path.join(directory, `${target.runId}.json`), raw); };
  const saveExport = async (i: number) => { const raw = json(originals[i].exported); target.downloads[i].exportManifestSha256 = sha(raw); await writeFile(originals[i].exportPath, raw); };
  return { root, runtime, release, original, target, options, directory, databasePath, plan, settings, state, historical, originals, snapshotDirectory, runDirectory, activeRaw, manifestRaw, runData, saveN8n, changeDb, savePlan, saveExport, activation, successorRoot, currentBinding, oldBinding, middle, recovery: path.join(directory, `known-three-downloads-9896-${target.executionId}-${target.activeSha256.slice(0, 16)}`) };
}

test("9896 exact flattened Wait graph, current settings and separate code trees close only active", async t => {
  const f = await fixture(t), inspected = await close(f.options); assert.equal(inspected.status, "eligible_intent"); assert.equal(inspected.n8n.preAWaits, 1); assert.equal(inspected.nonzeroEffects, true); assert.equal(inspected.historicalBatches.length, 4);
  assert.notEqual(f.target.helperTreeSha256, f.target.originalHelperTreeSha256); assert.equal(f.settings.departments[0].revision, 4);
  const result = await close(f.options, "apply"); assert.equal(result.status, "committed"); assert.equal(result.originalFailureRetained, true); assert.equal(result.oldExecutionReplayAllowed, false); assert.match(result.oldDownloadsDisposition, /no_handoff_no_import/); assert.equal("zeroEffects" in result, false);
  assert.deepEqual(result.effects.completedDownloads, kinds.slice(0, 3)); assert.equal(result.effects.businessImports, 0);
  await assert.rejects(readFile(path.join(f.directory, "active.json")), { code: "ENOENT" }); assert.equal(await readFile(result.archivePath, "utf8"), f.activeRaw); assert.equal(await readFile(path.join(f.directory, `${f.target.runId}.json`), "utf8"), f.manifestRaw);
  for (const original of f.originals) { assert.equal((await readFile(original.filePath)).equals(original.file), true); assert.equal(await readFile(original.exportPath, "utf8"), original.exportRaw); }
  const db = new DatabaseSync(f.databasePath, { readOnly: true }); assert.equal(db.prepare("SELECT status FROM execution_entity WHERE id=9896").get()?.status, "error"); db.close(); await assert.rejects(close(f.options, "apply"), /PATH_ALREADY_EXISTS/);
});

test("all three file bytes, parser evidence and download identities are mandatory", async t => {
  for (let i = 0; i < 3; i++) for (const mode of ["bytes", "row", "content", "stage", "path", "request", "query", "scope", "status", "time"] as const) await t.test(`${i}-${mode}`, async t => {
    const f = await fixture(t), e = f.originals[i].exported;
    if (mode === "bytes") await writeFile(f.originals[i].filePath, Buffer.concat([f.originals[i].file, Buffer.from("bad")]));
    if (mode === "row") { f.plan.operations[i].rowCount!--; await f.savePlan(); }
    if (mode === "content") { f.target.downloads[i].contentHash = "a".repeat(64); f.plan.operations[i].contentHash = f.target.downloads[i].contentHash; await f.savePlan(); }
    if (mode === "stage") e.stage = "submitted"; if (mode === "path") e.result.filePath = path.join(f.root, "wrong.csv"); if (mode === "request") e.requestEvidence.requestHash = "bad"; if (mode === "query") e.queryEvidence.total++; if (mode === "scope") e.fullScopeHash = "bad"; if (mode === "status") e.result.complete = false; if (mode === "time") e.submittedAt = "2099-01-01T00:00:00Z";
    if (!["bytes", "row", "content"].includes(mode)) await f.saveExport(i);
    await assert.rejects(close(f.options, "apply")); assert.equal(await readFile(path.join(f.directory, "active.json"), "utf8"), f.activeRaw); await assert.rejects(readdir(f.recovery), { code: "ENOENT" });
  });
});

test("JH unique task/baseline/immutable evidence and enabled-products state cannot drift", async t => {
  for (const mode of ["task", "baseline", "immutable", "unit", "product"] as const) await t.test(mode, async t => {
    const f = await fixture(t), e = f.originals[2].exported;
    if (mode === "task") e.taskIdentity = "jh:other"; if (mode === "baseline") e.baseline.push(String(e.taskEvidence.id)); if (mode === "immutable") e.taskEvidence.immutableHash = "bad"; if (mode === "unit") e.taskEvidence.taskBusinessUnitCode = "other";
    if (mode === "product") { f.originals[1].exported.result.sourceStatus = "disabled"; await f.saveExport(1); } else await f.saveExport(2);
    await assert.rejects(close(f.options, "apply"));
  });
});

test("snapshot files, receipt/importing, setting/scope and exact historical batch drift reject", async t => {
  for (const mode of ["snapshot", "receipt", "importing", "settings", "scope", "exact", "truncated", "batch", "own-batch"] as const) await t.test(mode, async t => {
    const f = await fixture(t);
    if (mode === "snapshot") await writeFile(path.join(f.snapshotDirectory, "export-manifest.json"), "{}"); if (mode === "receipt") { f.plan.operations[0].receipt = {} as any; await f.savePlan(); } if (mode === "importing") { f.plan.operations[3].stage = "importing"; await f.savePlan(); }
    if (mode === "settings") Object.assign(f.settings.departments[0], { unmonitoredProductCodes: ["changed"] }); if (mode === "scope") { f.settings.scopeRevisions[0].revision++; f.target.settingsHash = closureSettingsHash(f.settings); }
    if (mode === "exact") f.state.exactMissing = true; if (mode === "truncated") f.state.truncated = true; if (mode === "batch") f.state.pageTotal = 3; if (mode === "own-batch") f.historical[0].items[0].collectorEvidence.executionId = f.target.executionId;
    await assert.rejects(close(f.options, "apply")); assert.equal(await readFile(path.join(f.directory, "active.json"), "utf8"), f.activeRaw);
  });
});

test("only whole inventory revision is ignored; selection must reconstruct current rev4", async t => {
  const f = await fixture(t); f.settings.revision = "inventory-v2"; assert.equal((await close(f.options)).status, "eligible_intent");
  f.settings.departments[0].revision = 2; f.target.settingsHash = closureSettingsHash(f.settings); await assert.rejects(close(f.options), /BUSINESS_SCOPE/);
});

test("frozen original version, exact single Wait/grant and no repeated business node are required", async t => {
  for (const mode of ["active", "published", "version", "running", "history", "mode", "wait", "wait-index", "grant", "B-replay", "branch", "release"] as const) await t.test(mode, async t => {
    const f = await fixture(t);
    if (mode === "active") f.changeDb("UPDATE workflow_entity SET active=1"); if (mode === "published") f.changeDb("UPDATE workflow_entity SET activeVersionId=versionId"); if (mode === "version") f.changeDb("UPDATE workflow_entity SET versionId='changed'"); if (mode === "history") f.changeDb("DELETE FROM workflow_history"); if (mode === "running") f.changeDb("INSERT INTO execution_entity VALUES(9999,'JdLogisticsDaily2026','waiting','manual',NULL,NULL,NULL,NULL)"); if (mode === "mode") f.changeDb("UPDATE execution_entity SET mode='trigger'");
    if (mode === "wait") f.runData[waitName].push(f.runData[waitName][0]); if (mode === "wait-index") f.runData[waitName][0].executionIndex = 3; if (mode === "grant") f.runData["领取共享 helper"][1].data.main[0][0].json.coordinationStatus = "waiting"; if (mode === "B-replay") f.runData[bName].push(f.runData[bName][0]); if (mode === "branch") f.runData[bName][0].data.main.reverse(); if (mode === "release") f.runData[releaseName][0].data.main[0][0].json.ok = false;
    if (["wait", "wait-index", "grant", "B-replay", "branch", "release"].includes(mode)) await f.saveN8n(true); await assert.rejects(close(f.options, "apply"));
  });
});

test("historical code time interval, both installed trees and current effective head are pinned", async t => {
  for (const mode of ["old-exporter", "old-tree", "old-receipt", "current-tree", "policy", "pipeline", "interval", "new-head"] as const) await t.test(mode, async t => {
    const f = await fixture(t);
    if (mode === "old-exporter") await writeFile(path.join(f.original, "source-snapshot/tools/jd-logistics-export.ts"), "changed"); if (mode === "old-tree") await writeFile(path.join(f.original, "helper/tmall-workflow-helper.mjs"), "changed"); if (mode === "old-receipt") await writeFile(path.join(f.original, "audit/helper-build-receipt.json"), "{}"); if (mode === "current-tree") await writeFile(path.join(f.release, "helper/tmall-workflow-helper.mjs"), "changed"); if (mode === "policy") await writeFile(path.join(f.release, "source-snapshot/lib/jd/logistics-policy.ts"), "changed"); if (mode === "pipeline") await writeFile(path.join(f.release, "source-snapshot/tools/jd-logistics-n8n-pipeline.ts"), "changed");
    if (mode === "interval") f.target.activationOutSha256 = await f.activation(f.target.activationOutFile, { sequence: 243, activatedAt: "2026-10-17T03:00:00Z", predecessor: f.oldBinding, successor: f.middle });
    if (mode === "new-head") await f.activation("a".repeat(64) + ".json", { sequence: 245, activatedAt: "2026-10-17T10:00:00Z", predecessor: f.currentBinding, successor: { releaseId: "new", manifestSha256: "new" } });
    await assert.rejects(close(f.options, "apply"));
  });
});

test("helper/process/port and both occupied locks fail closed", async t => {
  for (const mode of ["busy", "pid", "birth", "port", "pipeline-lock", "global-lock"] as const) await t.test(mode, async t => {
    const f = await fixture(t);
    if (mode === "busy") f.state.busy = true; if (mode === "pid") f.state.pid++; if (mode === "birth") f.state.birth = "changed"; if (mode === "port") f.state.portClosed = false;
    if (mode.endsWith("lock")) await withJackyunRunLock({ runId: "holder", purpose: "fixture", lockDirectory: mode === "global-lock" ? defaultJdChromiumRunLockDirectory(f.root) : path.join(f.directory, "pipeline.lock") }, async () => { await assert.rejects(close(f.options, "apply")); }); else await assert.rejects(close(f.options, "apply"));
    assert.equal(await readFile(path.join(f.directory, "active.json"), "utf8"), f.activeRaw);
  });
});

test("late evidence changes and interrupted archive never produce a committed receipt or auto-resume", async t => {
  for (const stage of ["intent_written", "before_move", "after_move", "before_committed"] as const) await t.test(stage, async t => {
    const f = await fixture(t); f.options.checkpoint = async point => { if (point === stage) throw new Error("interrupted"); }; await assert.rejects(close(f.options, "apply"), /interrupted/);
    await assert.rejects(readFile(path.join(f.recovery, "committed.json")), { code: "ENOENT" }); await assert.rejects(close(f.options, "apply"), /PATH_ALREADY_EXISTS/);
    const active = stage === "after_move" || stage === "before_committed" ? path.join(f.recovery, "active.archived.json") : path.join(f.directory, "active.json"); assert.equal(await readFile(active, "utf8"), f.activeRaw);
  });
  for (const mode of ["late-execution", "late-file", "intent", "copy"] as const) await t.test(mode, async t => {
    const f = await fixture(t); f.options.checkpoint = async point => { if (point !== "before_move") return; if (mode === "late-execution") f.changeDb("INSERT INTO execution_entity VALUES(9999,'JdLogisticsDaily2026','running','manual',NULL,NULL,NULL,NULL)"); if (mode === "late-file") await writeFile(f.originals[2].filePath, "changed"); if (mode === "intent") await writeFile(path.join(f.recovery, "intent.json"), "{}"); if (mode === "copy") await writeFile(path.join(f.recovery, "manifest.original.json"), "{}"); };
    await assert.rejects(close(f.options, "apply")); assert.equal(await readFile(path.join(f.directory, "active.json"), "utf8"), f.activeRaw); await assert.rejects(readFile(path.join(f.recovery, "committed.json")), { code: "ENOENT" });
  });
});

test("Windows no-replace move preserves both source and occupied destination", async t => {
  const f = await fixture(t), source = path.join(f.root, "move-source.json"), destination = path.join(f.root, "move-dest.json"); await writeFile(source, "source"); await writeFile(destination, "destination"); await assert.rejects(io.moveNoReplace(source, destination)); assert.equal(await readFile(source, "utf8"), "source"); assert.equal(await readFile(destination, "utf8"), "destination");
});
