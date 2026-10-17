import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { logisticsPlanHash, type JdLogisticsManifest } from "../lib/jd/logistics-manifest";
import { logisticsHash, parseJdLogisticsSettings, planJdLogisticsNotifications, selectJdLogisticsOperations } from "../lib/jd/logistics-policy";
import { validateJdStoreRegistry } from "../lib/jd/store-registry";
import { closeJdLogisticsLogin9851, closureSettingsHash, read9851Execution, type Login9851Target } from "../tools/close-jd-logistics-login-9851";
import { jdLogin9851Target } from "../tools/jd-logistics-login-9851-target";
import { preexportSha256 as sha } from "../tools/close-jd-logistics-preexport";
const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";
const kinds = ["flow", "shop_products", "realtime_inventory", "inventory_snapshot"] as const;

async function fixture(t: test.TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), "jd-login-9851-fixture-")); t.after(() => rm(root, { recursive: true, force: true }));
  const target: Login9851Target = { ...jdLogin9851Target, supervisorPid: 111, helperPid: 222 };
  const runtime = path.join(root, "runtime"), directory = path.join(root, "outputs/jd-logistics-pipeline"), databasePath = path.join(root, "n8n.sqlite");
  const release = path.join(runtime, "releases", target.releaseId), original = path.join(runtime, "releases", target.originalReleaseId);
  for (const dir of [path.join(root, "config"), directory, path.join(runtime, "state/worker-release-successors"),
    ...[release, original].flatMap(base => [path.join(base, "helper"), path.join(base, "audit"), path.join(base, "source-snapshot/tools")])]) await mkdir(dir, { recursive: true });
  const registry = { version: 1, stores: [{ storeKey: target.storeKey, platform: "京东", enabled: true, accountLabel: "fixture", shopName: "fixture", shopId: "1",
    browser: { executablePath: "fixture/chrome.exe", userDataDir: "fixture/profiles", profileName: "Default", profileDir: "fixture/profiles/Default", debugPort: 9224, downloadDir: "fixture/downloads" } }] };
  const config = { version: 1 as const, bindings: kinds.map(sourceKind => ({ sourceKind, departmentId: target.departmentId, businessUnitCode: target.businessUnitCode,
    enabled: true, sourceVerified: true, contractVersion: "jd-logistics-v1", collectorStoreKey: target.storeKey, authorizedStoreKeys: [target.storeKey], warehouseCode: "",
    ...(sourceKind === "flow" ? { initialStartDate: "2026-10-15", maxSpanDays: 366 } : {}) })) };
  const settings = parseJdLogisticsSettings({ contractVersion: "jd-logistics-v1", departments: [{ id: target.departmentId, businessUnitCode: target.businessUnitCode,
    storeKeys: [target.storeKey], logisticsEnabled: true, monitorEnabled: false, pushEnabled: false, revision: target.currentDepartmentRevision, capabilities: Object.fromEntries(kinds.map(k => [k, true])) }],
    scopeRevisions: kinds.map(sourceKind => ({ sourceKind, departmentId: target.departmentId, revision: 2 })),
    notification: { implemented: true, enabled: false, configured: false, configDigest: "", groupName: "测试群聊", robotName: "志高助手" } });
  const oldSettings = structuredClone(settings); oldSettings.departments[0].revision = target.originalDepartmentRevision;
  const selections = selectJdLogisticsOperations(config, oldSettings, validateJdStoreRegistry(registry, root), new Date("2026-10-17T00:00:02.345Z"));
  const plan: JdLogisticsManifest = { protocolVersion: "jd-logistics-pipeline-v1", workflowKey: "jd-logistics", runId: target.runId, executionId: target.executionId,
    createdAt: "2026-10-17T00:00:02.345Z", updatedAt: "2026-10-17T00:00:07.956Z", anchorAt: "2026-10-17T00:00:02.345Z", baseUrl: "http://localhost:3000",
    planHash: "", stage: "failed", outcome: "pending", notificationPlan: planJdLogisticsNotifications(settings, selections), notification: { stage: "pending" },
    failure: { code: target.failureCode, stage: "run", at: "2026-10-17T00:00:07.956Z" }, operations: selections.map((op, i) => ({ ...op, stage: i === 0 ? "exporting" : "planned" })) };
  plan.planHash = logisticsPlanHash(plan); target.planHash = plan.planHash;
  target.originalPolicyHashesHash = logisticsHash(plan.operations.map(x => x.policyHash));
  const activeRaw = json({ runId: target.runId, executionId: target.executionId, planHash: target.planHash }), manifestRaw = json(plan);
  target.activeSha256 = sha(activeRaw); target.manifestSha256 = sha(manifestRaw);
  const flowDirectory = path.join(directory, "downloads", target.runId, selections[0].operationId); await mkdir(flowDirectory, { recursive: true });
  await writeFile(path.join(directory, "active.json"), activeRaw); await writeFile(path.join(directory, `${target.runId}.json`), manifestRaw);
  await writeFile(path.join(root, "config/jd-store-accounts.json"), json(registry)); target.registrySha256 = sha(json(registry));
  await writeFile(path.join(root, "config/jd-logistics-sources.json"), json(config)); target.sourceConfigSha256 = sha(json(config)); target.settingsHash = logisticsHash(settings);
  const task = (index: number, payload?: unknown, branch = 0) => ({ executionStatus: payload ? "success" : "error", executionIndex: index,
    ...(payload ? { data: { main: branch === 0 ? [[{ json: payload }]] : [[], [{ json: payload }]] } } : {}) });
  const executionData = JSON.stringify([{ resultData: { lastNodeExecuted: "保留证据并明确失败", runData: {
    "每天08:00计划入口": [task(0, {})], "领取共享 helper": [task(1, {})], "已领取执行所有权？": [task(2, {})],
    "A·冻结事业部来源与日期计划": [task(3, { runId: target.runId, stage: "planned", operationCount: 4 })],
    "B·串行下载全文件校验并导入": [task(4, { runId: target.runId, error: { status: 500, message: `PIPELINE_FAILED ${target.failureCode}` } }, 1)],
    "失败后释放原执行 helper": [task(5, { ok: true, stage: "released", workflow: "jd-logistics" })], "保留证据并明确失败": [task(6)],
  } } }]); target.executionDataSha256 = sha(executionData);
  const shape = { nodes: [{ type: "n8n-nodes-base.manualTrigger" }, { type: "n8n-nodes-base.scheduleTrigger" }], connections: {}, settings: { timezone: "Asia/Shanghai" } };
  target.workflowShapeHash = logisticsHash(shape);
  const db = new DatabaseSync(databasePath);
  db.exec("CREATE TABLE workflow_entity(id TEXT,active INTEGER,versionId TEXT,activeVersionId TEXT,nodes TEXT,connections TEXT,settings TEXT);CREATE TABLE workflow_history(workflowId TEXT,versionId TEXT,nodes TEXT,connections TEXT);CREATE TABLE execution_entity(id INTEGER,workflowId TEXT,status TEXT,mode TEXT,startedAt TEXT,stoppedAt TEXT,retrySuccessId TEXT,deletedAt TEXT);CREATE TABLE execution_data(executionId TEXT,data TEXT)");
  db.prepare("INSERT INTO workflow_entity VALUES(?,0,?,NULL,?,?,?)").run(target.workflowId, target.workflowVersionId, JSON.stringify(shape.nodes), "{}", JSON.stringify(shape.settings));
  db.prepare("INSERT INTO workflow_history VALUES(?,?,?,?)").run(target.workflowId, target.workflowVersionId, JSON.stringify(shape.nodes), "{}");
  db.prepare("INSERT INTO execution_entity VALUES(?,?,'error','trigger','2026-10-17 00:00:00.213','2026-10-17 00:00:08.643',NULL,NULL)").run(Number(target.executionId), target.workflowId);
  db.prepare("INSERT INTO execution_data VALUES(?,?)").run(target.executionId, executionData); db.close();
  const source = 'async function businessSurface() { fail("JD_LOGISTICS_LOGIN_REQUIRED"); } export async function waitForJdLogisticsIdentity() {} async function exportFlowSource() { stage: "baseline"; await writeJsonDurable(manifestPath, manifest); manifest.stage = "submitting"; await writeJsonDurable(manifestPath, manifest); uniqueButton(surface, "导出"); } export async function exportJdLogistics() { const business = await navigate(); await identity(business, observedCodes, options.businessUnitCode); const exported = await exportFlowSource(page); }';
  target.exporterSha256 = sha(source);
  const tree = createHash("sha256");
  for (const name of ["jackyun-json-publish.ps1", "jd-credential-vault.ps1", "tmall-credential-vault.ps1", "tmall-workflow-helper.mjs"]) {
    const content = Buffer.from("fixture:" + name), n = Buffer.from(name), nl = Buffer.alloc(4), cl = Buffer.alloc(8); nl.writeUInt32BE(n.length); cl.writeBigUInt64BE(BigInt(content.length)); tree.update(nl).update(n).update(cl).update(content);
    await writeFile(path.join(release, "helper", name), content); await writeFile(path.join(original, "helper", name), content);
  }
  target.helperTreeSha256 = tree.digest("hex");
  const receipt = json({ status: "passed", helperTree: { fileCount: 4, sha256: target.helperTreeSha256 }, evidence: { inputFiles: [{ relativePath: "tools/jd-logistics-export.ts", sha256: target.exporterSha256 }] } });
  for (const base of [release, original]) { await writeFile(path.join(base, "audit/helper-build-receipt.json"), receipt); await writeFile(path.join(base, "source-snapshot/tools/jd-logistics-export.ts"), source); }
  target.helperReceiptSha256 = sha(receipt); target.originalHelperReceiptSha256 = sha(receipt);
  const deployment = json({ fixture: true }), oldDeployment = json({ fixture: true, original: true });
  await writeFile(path.join(release, "deployment-manifest.json"), deployment); target.releaseManifestSha256 = sha(deployment);
  await writeFile(path.join(original, "deployment-manifest.json"), oldDeployment); target.originalManifestSha256 = sha(oldDeployment);
  await writeFile(path.join(runtime, "state/worker-process.json"), json({ releaseId: target.releaseId, manifestSha256: target.releaseManifestSha256, supervisorPid: 111, supervisorCreationDate: target.supervisorCreationDate }));
  const middle = { releaseId: target.originalReleaseId, manifestSha256: target.originalManifestSha256 };
  const activation = async (filename: string, payload: object) => {
    const raw = json({ ...payload, payloadSha256: logisticsHash(payload) });
    await writeFile(path.join(runtime, "state/worker-release-successors", filename), raw); await writeFile(path.join(runtime, "state/worker-release-successors", filename + ".sha256"), sha(raw)); return sha(raw);
  };
  target.activationInSha256 = await activation(target.activationInFile, { sequence: 1, activatedAt: "2026-10-16T17:21:50Z", successor: middle });
  target.activationOutSha256 = await activation(target.activationOutFile, { sequence: 2, activatedAt: "2026-10-17T01:01:47Z", predecessor: middle, successor: { releaseId: target.releaseId, manifestSha256: target.releaseManifestSha256 } });
  const historical = kinds.map(sourceKind => {
    const items = [1, 2].map(i => ({ batchId: `${sourceKind}-${i}`, sourceKind, departmentId: target.departmentId, businessUnitCode: target.businessUnitCode,
      rowCount: 7, collectorEvidence: { runId: "prior-run", executionId: "prior-execution" } }));
    return { sourceKind, total: items.length, items, details: items.map(item => ({ ...item, currentSelection: { current: true, contentHash: "old-content", verifiedRowCount: 7, scopeRevision: 2 } })) };
  }); target.batchesHash = logisticsHash(historical);
  const state = { busy: false, portClosed: true, processPid: 222, exactUnavailable: false, batchChanged: false };
  const request: typeof fetch = async (input, init) => {
    assert.equal(init?.method, "GET"); assert.equal(init?.body, undefined);
    const url = new URL(String(input));
    if (url.origin === "http://127.0.0.1:5791") return Response.json({ ok: true, stage: "ready", busy: state.busy, activeWorkflow: null, storeExecutions: [], drain: null });
    if (url.searchParams.get("operation") === "settings") return Response.json({ success: true, data: settings });
    const id = url.searchParams.get("batchId");
    if (id) { const found = historical.flatMap(x => x.details).find(x => x.batchId === id)!; return Response.json({ success: true, data: { total: 1, items: [{ ...found, ...(state.exactUnavailable ? { currentSelection: null } : {}) }] } }); }
    const value = historical.find(x => x.sourceKind === url.searchParams.get("sourceKind"))!;
    return Response.json({ success: true, data: { items: state.batchChanged ? value.items.slice(0, 1) : value.items, total: 2, page: 1, pageSize: 100 } });
  };
  const options = { root, runtime, databasePath, target, request, portProbe: async () => state.portClosed,
    processProbe: async () => ({ pid: state.processPid, parentPid: 111, creationDate: target.helperCreationDate, supervisorCreationDate: target.supervisorCreationDate,
      commandLine: `"${path.win32.join("C:/Program Files/nodejs/node.exe")}" ${path.join(release, "helper/tmall-workflow-helper.mjs")} serve --port 5791` }) };
  const changeDb = (sql: string) => { const db = new DatabaseSync(databasePath); try { db.exec(sql); } finally { db.close(); } };
  return { options, target, directory, flowDirectory, plan, settings, state, changeDb, historical, activation, original, activeRaw, manifestRaw,
    recovery: path.join(directory, `login-9851-${target.activeSha256.slice(0, 16)}`) };
}

test("9851 inspect accepts existing historical data and nonzero revisions without any write", async t => {
  const f = await fixture(t), result = await closeJdLogisticsLogin9851(f.options);
  assert.equal(result.status, "eligible_intent"); assert.equal(result.historicalBatches.length, 4);
  assert.ok(f.plan.operations.every(x => x.initialScopeRevision === 2));
  assert.equal(await readFile(path.join(f.directory, "active.json"), "utf8"), f.activeRaw);
  await assert.rejects(readFile(path.join(f.recovery, "intent.json")), { code: "ENOENT" });
});
test("9851 apply preserves original failure/history and commits one no-replace active archive", async t => {
  const f = await fixture(t), original = json(f.historical), result = await closeJdLogisticsLogin9851(f.options, "apply");
  assert.equal(result.status, "committed"); assert.equal(await readFile(result.archivePath, "utf8"), f.activeRaw);
  assert.equal(f.settings.departments[0].revision, 4); assert.equal(f.target.originalDepartmentRevision, 2);
  assert.equal(await readFile(path.join(f.directory, `${f.target.runId}.json`), "utf8"), f.manifestRaw); assert.equal(json(f.historical), original);
  await assert.rejects(readFile(path.join(f.directory, "active.json")), { code: "ENOENT" });
  await assert.rejects(closeJdLogisticsLogin9851(f.options, "apply"), /PATH_ALREADY_EXISTS/);
  assert.equal(read9851Execution(f.options.databasePath, f.target).executionId, "9851");
});
test("published, changed-version, manual-original, active-execution and removed-history cases refuse closure", async t => {
  for (const sql of ["UPDATE workflow_entity SET active=1", "UPDATE workflow_entity SET versionId='changed'", "UPDATE execution_entity SET mode='manual'",
    "INSERT INTO execution_entity VALUES(9999,'JdLogisticsDaily2026','running','manual','2026-10-17 00:01:00',NULL,NULL,NULL)", "DELETE FROM workflow_history"]) {
    const f = await fixture(t); f.changeDb(sql); await assert.rejects(closeJdLogisticsLogin9851(f.options), /WORKFLOW_NOT_FROZEN_OR_EXECUTION_CHANGED/);
    assert.equal(await readFile(path.join(f.directory, "active.json"), "utf8"), f.activeRaw);
  }
});
test("any local export file or altered old failed manifest refuses the operator", async t => {
  const f = await fixture(t); await writeFile(path.join(f.flowDirectory, "export-manifest.json"), "{}");
  await assert.rejects(closeJdLogisticsLogin9851(f.options), /DOWNLOAD_EFFECT_PRESENT/);
  const g = await fixture(t); await writeFile(path.join(g.directory, `${g.target.runId}.json`), "{}");
  await assert.rejects(closeJdLogisticsLogin9851(g.options), /ORIGINAL_BYTES_CHANGED/);
});
test("scope revision drift is rejected even if a caller rebinds the settings digest", async t => {
  const f = await fixture(t); f.settings.scopeRevisions[0].revision++;
  f.target.settingsHash = logisticsHash(f.settings);
  await assert.rejects(closeJdLogisticsLogin9851(f.options), /POLICY_OR_SCOPE_REVISION_CHANGED/);
});
test("only the global inventory revision may advance; department and scope revisions remain frozen", async t => {
  const f = await fixture(t), original = closureSettingsHash({ ...f.settings, revision: "545:old" });
  assert.equal(closureSettingsHash({ ...f.settings, revision: "576:new" }), original);
  f.target.settingsHash = original;
  f.settings.departments[0].revision++;
  await assert.rejects(closeJdLogisticsLogin9851(f.options), /SETTINGS_CHANGED/);
});
test("the historical policy proof permits only the two fixed department revisions", async t => {
  const f = await fixture(t); f.target.originalDepartmentRevision = 3;
  await assert.rejects(closeJdLogisticsLogin9851(f.options), /POLICY_OR_SCOPE_REVISION_CHANGED/);
  const g = await fixture(t); g.settings.departments[0].revision = 5; g.target.settingsHash = closureSettingsHash(g.settings);
  await assert.rejects(closeJdLogisticsLogin9851(g.options), /DEPARTMENT_VERSION_BINDING_CHANGED/);
});
test("truncated history and unavailable exact current-selection evidence never count as unchanged", async t => {
  const f = await fixture(t); f.state.batchChanged = true;
  await assert.rejects(closeJdLogisticsLogin9851(f.options), /BATCH_TRUNCATED|BATCH_PAGINATION_INVALID/);
  const g = await fixture(t); g.state.exactUnavailable = true;
  await assert.rejects(closeJdLogisticsLogin9851(g.options), /EXACT_BATCH_SELECTION_UNAVAILABLE/);
});
test("busy helper, open browser and replacement helper PID all refuse closure", async t => {
  for (const key of ["busy", "portClosed", "processPid"] as const) {
    const f = await fixture(t); if (key === "busy") f.state.busy = true; else if (key === "portClosed") f.state.portClosed = false; else f.state.processPid++;
    await assert.rejects(closeJdLogisticsLogin9851(f.options), /CURRENT_PROCESS_CHANGED|CURRENT_HELPER_OR_PROFILE_BUSY/);
  }
});
test("successor interval outside original execution is rejected even when hashes are re-bound", async t => {
  const f = await fixture(t), middle = { releaseId: f.target.originalReleaseId, manifestSha256: f.target.originalManifestSha256 };
  f.target.activationOutSha256 = await f.activation(f.target.activationOutFile, { sequence: 2, activatedAt: "2026-10-16T23:00:00Z", predecessor: middle,
    successor: { releaseId: f.target.releaseId, manifestSha256: f.target.releaseManifestSha256 } });
  await assert.rejects(closeJdLogisticsLogin9851(f.options), /ORIGINAL_EXECUTION_CODE_INTERVAL_CHANGED/);
});
test("historical helper extra files and dependency directories invalidate the complete tree binding", async t => {
  for (const directory of [false, true]) {
    const f = await fixture(t), extra = path.join(f.original, "helper", directory ? "node_modules" : "extra.mjs");
    if (directory) await mkdir(extra); else await writeFile(extra, "extra");
    await assert.rejects(closeJdLogisticsLogin9851(f.options), /ORIGINAL_HELPER_MEMBERS_CHANGED/);
  }
});
test("intent and post-archive failures preserve unknown state and cannot be blindly reapplied", async t => {
  for (const stage of ["intent_written", "after_move"] as const) {
    const f = await fixture(t);
    await assert.rejects(closeJdLogisticsLogin9851({ ...f.options, checkpoint: async point => { if (point === stage) throw Error("synthetic interruption"); } }, "apply"), /synthetic interruption/);
    await assert.rejects(readFile(path.join(f.recovery, "committed.json")), { code: "ENOENT" });
    assert.equal(await readFile(path.join(f.directory, `${f.target.runId}.json`), "utf8"), f.manifestRaw);
    await assert.rejects(closeJdLogisticsLogin9851(f.options, "apply"), /PATH_ALREADY_EXISTS/);
    if (stage === "intent_written") assert.equal(await readFile(path.join(f.directory, "active.json"), "utf8"), f.activeRaw);
    else assert.equal(await readFile(path.join(f.recovery, "active.archived.json"), "utf8"), f.activeRaw);
  }
});
test("a manual execution arriving at the final pre-move checkpoint prevents archival", async t => {
  const f = await fixture(t);
  await assert.rejects(closeJdLogisticsLogin9851({ ...f.options, checkpoint: async point => {
    if (point === "before_move") f.changeDb("INSERT INTO execution_entity VALUES(9999,'JdLogisticsDaily2026','running','manual','2026-10-17 00:01:00',NULL,NULL,NULL)");
  } }, "apply"), /WORKFLOW_NOT_FROZEN_OR_EXECUTION_CHANGED/);
  assert.equal(await readFile(path.join(f.directory, "active.json"), "utf8"), f.activeRaw);
  await assert.rejects(readFile(path.join(f.recovery, "committed.json")), { code: "ENOENT" });
});
test("changed failure bytes at the commit checkpoint cannot receive committed status", async t => {
  const f = await fixture(t);
  await assert.rejects(closeJdLogisticsLogin9851({ ...f.options, checkpoint: async point => {
    if (point === "before_committed") await writeFile(path.join(f.directory, `${f.target.runId}.json`), "{}");
  } }, "apply"), /ORIGINAL_BYTES_CHANGED/);
  await assert.rejects(readFile(path.join(f.recovery, "committed.json")), { code: "ENOENT" });
});
