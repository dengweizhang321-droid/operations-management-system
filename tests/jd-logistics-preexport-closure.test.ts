import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { withJackyunRunLock } from "../lib/jackyun/run-lock";
import { logisticsPlanHash, type JdLogisticsManifest } from "../lib/jd/logistics-manifest";
import { jdLogisticsProtocol, parseJdLogisticsSettings, planJdLogisticsNotifications, selectJdLogisticsOperations } from "../lib/jd/logistics-policy";
import { validateJdStoreRegistry } from "../lib/jd/store-registry";
import { closeJdLogisticsPreexport, jdPreexportTarget, jdDatePreexportTarget, preexportSha256, type PreexportOptions, type PreexportTarget } from "../tools/close-jd-logistics-preexport";

const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";
const kinds = ["flow", "shop_products", "realtime_inventory", "inventory_snapshot"] as const;
async function fixture(t: test.TestContext, preset: PreexportTarget = jdPreexportTarget) {
  const root = await mkdtemp(path.join(tmpdir(), "jd-preexport-private-"));
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  const runtime = path.join(root, "runtime"), directory = path.join(root, "outputs/jd-logistics-pipeline");
  const target: PreexportTarget = { ...preset };
  target.supervisorPid = 111; target.helperPid = 222;
  const release = path.join(runtime, "releases", target.releaseId), databasePath = path.join(root, "n8n.sqlite");
  await Promise.all([mkdir(path.join(root, "config"), { recursive: true }), mkdir(directory, { recursive: true }),
    mkdir(path.join(release, "helper"), { recursive: true }), mkdir(path.join(release, "audit"), { recursive: true }),
    mkdir(path.join(release, "source-snapshot/tools"), { recursive: true }), mkdir(path.join(runtime, "state"), { recursive: true })]);
  const registry = { version: 1, stores: [{ storeKey: target.storeKey, platform: "京东", enabled: true, accountLabel: "fixture", shopName: "fixture", shopId: "1",
    browser: { executablePath: "fixture/chrome.exe", userDataDir: "fixture/profiles", profileName: "Default", profileDir: "fixture/profiles/Default", debugPort: 9224, downloadDir: "fixture/downloads" } }] };
  const config = { version: 1 as const, bindings: kinds.map(sourceKind => ({ sourceKind, departmentId: target.departmentId, businessUnitCode: target.businessUnitCode,
    enabled: true, sourceVerified: true, contractVersion: "jd-logistics-v1", collectorStoreKey: target.storeKey, authorizedStoreKeys: [target.storeKey], warehouseCode: "",
    ...(sourceKind === "flow" ? { initialStartDate: "2026-10-15", maxSpanDays: 366 } : {}) })) };
  const settings = parseJdLogisticsSettings({ contractVersion: "jd-logistics-v1", departments: [{ id: target.departmentId, businessUnitCode: target.businessUnitCode,
    storeKeys: [target.storeKey], logisticsEnabled: true, monitorEnabled: false, pushEnabled: false, revision: 1,
    capabilities: Object.fromEntries(kinds.map(k => [k, true])) }], scopeRevisions: [],
    notification: { implemented: true, enabled: false, configured: false, configDigest: "", groupName: "测试群聊", robotName: "志高助手" } });
  const selections = selectJdLogisticsOperations(config, settings, validateJdStoreRegistry(registry, root), new Date("2026-10-16T01:04:16.066Z"));
  const plan: JdLogisticsManifest = { protocolVersion: jdLogisticsProtocol, workflowKey: "jd-logistics", runId: target.runId, executionId: target.executionId,
    createdAt: "2026-10-16T01:04:16.066Z", updatedAt: "2026-10-16T01:04:22.836Z", anchorAt: "2026-10-16T01:04:16.066Z", baseUrl: "http://localhost:3000",
    planHash: "", stage: "failed", outcome: "pending", notificationPlan: planJdLogisticsNotifications(settings, selections), notification: { stage: "pending" },
    failure: { code: target.failureCode, stage: "run", at: "2026-10-16T01:04:22.836Z" },
    operations: selections.map((op, i) => ({ ...op, stage: i === 0 ? "exporting" : "planned" })) };
  plan.planHash = logisticsPlanHash(plan); target.planHash = plan.planHash;
  const manifestRaw = json(plan), activeRaw = json({ runId: target.runId, executionId: target.executionId, planHash: target.planHash });
  target.manifestSha256 = preexportSha256(manifestRaw); target.activeSha256 = preexportSha256(activeRaw);
  await mkdir(path.join(directory, "downloads", target.runId, selections[0].operationId), { recursive: true });
  await writeFile(path.join(directory, "active.json"), activeRaw); await writeFile(path.join(directory, `${target.runId}.json`), manifestRaw);
  await writeFile(path.join(root, "config/jd-logistics-sources.json"), json(config)); await writeFile(path.join(root, "config/jd-store-accounts.json"), json(registry));
  const aName = "A·冻结事业部来源与日期计划", bName = "B·串行下载全文件校验并导入", releaseName = "失败后释放原执行 helper";
  const task = (index: number, payload?: unknown, branch = 0) => ({ executionStatus: payload ? "success" : "error", executionIndex: index,
    ...(payload ? { data: { main: branch === 0 ? [[{ json: payload }]] : [[], [{ json: payload }]] } } : {}) });
  const executionData = JSON.stringify([{ resultData: { lastNodeExecuted: "保留证据并明确失败", runData: {
    "手动完整运行": [task(0, {})], "领取共享 helper": [task(1, {})], "已领取执行所有权？": [task(2, {})],
    [aName]: [task(3, { runId: target.runId, stage: "planned", operationCount: 4 })],
    [bName]: [task(4, { runId: target.runId, error: { status: 500, message: `PIPELINE_FAILED ${target.failureCode}` } }, 1)],
    [releaseName]: [task(5, { ok: true, stage: "released", workflow: "jd-logistics" })], "保留证据并明确失败": [task(6)],
  } } }]);
  target.executionDataSha256 = preexportSha256(executionData);
  const db = new DatabaseSync(databasePath);
  db.exec("CREATE TABLE workflow_entity(id TEXT,active INTEGER);CREATE TABLE execution_entity(id INTEGER,workflowId TEXT,status TEXT,mode TEXT,startedAt TEXT,stoppedAt TEXT,retrySuccessId TEXT,deletedAt TEXT);CREATE TABLE execution_data(executionId TEXT,data TEXT)");
  db.prepare("INSERT INTO workflow_entity VALUES(?,0)").run(target.workflowId);
  db.prepare("INSERT INTO execution_entity VALUES(?,?,'error','manual','2026-10-16 01:04:14.167','2026-10-16 01:04:24.188',NULL,NULL)").run(Number(target.executionId), target.workflowId);
  db.prepare("INSERT INTO execution_data VALUES(?,?)").run(target.executionId, executionData); db.close();
  const source = 'async function exportFlowSource() { stage: "baseline"; await writeJsonDurable(manifestPath, manifest); manifest.stage = "submitting"; await writeJsonDurable(manifestPath, manifest); uniqueButton(surface, "导出"); } export async function exportJdLogistics() {}';
  target.exporterSha256 = preexportSha256(source); await writeFile(path.join(release, "source-snapshot/tools/jd-logistics-export.ts"), source);
  const hash = createHash("sha256");
  for (const name of ["jackyun-json-publish.ps1", "jd-credential-vault.ps1", "tmall-credential-vault.ps1", "tmall-workflow-helper.mjs"]) {
    const content = Buffer.from(`fixture:${name}`), n = Buffer.from(name), nl = Buffer.alloc(4), cl = Buffer.alloc(8);
    nl.writeUInt32BE(n.length); cl.writeBigUInt64BE(BigInt(content.length)); hash.update(nl).update(n).update(cl).update(content);
    await writeFile(path.join(release, "helper", name), content);
  }
  target.helperTreeSha256 = hash.digest("hex");
  const receipt = json({ status: "passed", helperTree: { fileCount: 4, sha256: target.helperTreeSha256 }, evidence: { inputFiles: [{ relativePath: "tools/jd-logistics-export.ts", sha256: target.exporterSha256 }] } });
  target.helperReceiptSha256 = preexportSha256(receipt); await writeFile(path.join(release, "audit/helper-build-receipt.json"), receipt);
  const deployment = json({ fixture: true }); target.releaseManifestSha256 = preexportSha256(deployment); await writeFile(path.join(release, "deployment-manifest.json"), deployment);
  await writeFile(path.join(runtime, "state/worker-process.json"), json({ releaseId: target.releaseId, manifestSha256: target.releaseManifestSha256, supervisorPid: 111, supervisorCreationDate: target.supervisorCreationDate }));
  const state = { batchTotal: 0, helperBusy: false, requests: [] as string[], portClosed: true, processPid: 222 };
  const request: typeof fetch = async (input, init) => {
    assert.equal(init?.method, "GET"); assert.equal(init?.body, undefined); assert.equal(init?.redirect, "manual");
    const url = new URL(String(input)); state.requests.push(url.toString());
    if (url.origin === "http://127.0.0.1:5791" && url.pathname === "/health") return Response.json({ ok: true, stage: "ready", busy: state.helperBusy, activeWorkflow: null, storeExecutions: [], drain: null });
    assert.equal(url.origin, "http://localhost:3000"); assert.equal(url.pathname, "/api/inventory/jd-logistics");
    if (url.searchParams.get("operation") === "settings") return Response.json({ success: true, data: settings });
    assert.equal(url.searchParams.get("operation"), "batches"); assert.equal(url.searchParams.get("departmentId"), target.departmentId);
    assert.equal(url.searchParams.get("businessUnitCode"), target.businessUnitCode); assert.ok(kinds.includes(url.searchParams.get("sourceKind") as any));
    return Response.json({ success: true, data: { items: [], total: state.batchTotal, page: 1, pageSize: 1 } });
  };
  const options: PreexportOptions = { root, runtime, databasePath, target, request, portProbe: async p => { assert.equal(p, 9224); return state.portClosed; },
    processProbe: async () => ({ pid: state.processPid, parentPid: 111, creationDate: target.helperCreationDate, supervisorCreationDate: target.supervisorCreationDate,
      commandLine: `"C:\\Program Files\\nodejs\\node.exe" ${path.join(release, "helper/tmall-workflow-helper.mjs")} serve --port 5791` }) };
  const recovery = path.join(directory, `preexport-${target.executionId}-${target.activeSha256.slice(0, 16)}`);
  return { root, runtime, release, directory, databasePath, plan, settings, state, options, target, recovery, activeRaw, manifestRaw };
}

test("9542 closure preserves byte-exact failed evidence and commits only an archived active", async t => {
  const f = await fixture(t); const eligible = await closeJdLogisticsPreexport(f.options);
  assert.equal(eligible.status, "eligible_intent"); assert.equal(await readFile(path.join(f.directory, "active.json"), "utf8"), f.activeRaw);
  const committed = await closeJdLogisticsPreexport(f.options, "apply"); assert.equal(committed.status, "committed");
  await assert.rejects(readFile(path.join(f.directory, "active.json")), { code: "ENOENT" });
  assert.equal(await readFile(path.join(f.directory, `${f.target.runId}.json`), "utf8"), f.manifestRaw);
  for (const name of ["active.original.json", "active.archived.json"]) assert.equal(await readFile(path.join(f.recovery, name), "utf8"), f.activeRaw);
  assert.equal(await readFile(path.join(f.recovery, "manifest.original.json"), "utf8"), f.manifestRaw);
  const db = new DatabaseSync(f.databasePath, { readOnly: true }); assert.equal(db.prepare("SELECT status FROM execution_entity WHERE id=9542").get()?.status, "error"); db.close();
  assert.ok(f.state.requests.length); await assert.rejects(closeJdLogisticsPreexport(f.options, "apply"), /PATH_ALREADY_EXISTS/);
});

test("9556 closure accepts only its exact date failure and retains terminal error", async t => {
  const f = await fixture(t, jdDatePreexportTarget);
  const committed = await closeJdLogisticsPreexport(f.options, "apply");
  assert.equal(committed.status, "committed");
  assert.ok("nextAction" in committed);
  assert.match(committed.nextAction as string, /never retry 9556/);
  assert.equal(await readFile(path.join(f.directory, `${f.target.runId}.json`), "utf8"), f.manifestRaw);
  const db = new DatabaseSync(f.databasePath, { readOnly: true });
  assert.equal(db.prepare("SELECT status FROM execution_entity WHERE id=9556").get()?.status, "error"); db.close();
});

test("9556 refuses a different failure code even with the updated manifest hash", async t => {
  const f = await fixture(t, jdDatePreexportTarget);
  f.plan.failure!.code = "JD_LOGISTICS_BUSINESS_UNIT_MISMATCH";
  const raw = json(f.plan); f.target.manifestSha256 = preexportSha256(raw);
  await writeFile(path.join(f.directory, `${f.target.runId}.json`), raw);
  await assert.rejects(closeJdLogisticsPreexport(f.options, "apply"), /FAILED_STAGE_REJECTED/);
  assert.equal(await readFile(path.join(f.directory, "active.json"), "utf8"), f.activeRaw);
});
test("wrong original SHA, failure phase or terminal n8n status refuses closure", async t => {
  for (const mode of ["sha", "stage", "n8n", "waiting"] as const) await t.test(mode, async t => {
    const f = await fixture(t);
    if (mode === "sha") await writeFile(path.join(f.directory, "active.json"), f.activeRaw + " ");
    if (mode === "stage") { f.plan.failure!.stage = "verify"; const raw = json(f.plan); f.target.manifestSha256 = preexportSha256(raw); await writeFile(path.join(f.directory, `${f.target.runId}.json`), raw); }
    if (mode === "n8n" || mode === "waiting") { const db = new DatabaseSync(f.databasePath); if (mode === "n8n") db.exec("UPDATE execution_entity SET status='success'"); else db.exec("INSERT INTO execution_entity VALUES(9543,'JdLogisticsDaily2026','waiting','manual',NULL,NULL,NULL,NULL)"); db.close(); }
    await assert.rejects(closeJdLogisticsPreexport(f.options, "apply")); assert.equal(await readFile(path.join(f.directory, "active.json"), "utf8"), mode === "sha" ? f.activeRaw + " " : f.activeRaw);
    await assert.rejects(readdir(f.recovery), { code: "ENOENT" });
  });
});
test("any side-effect file, extra directory, scope revision or batch refuses closure", async t => {
  for (const mode of ["file", "export-manifest", "extra-dir", "batch", "revision"] as const) await t.test(mode, async t => {
    const f = await fixture(t), run = path.join(f.directory, "downloads", f.target.runId);
    if (mode === "file" || mode === "export-manifest") await writeFile(path.join(run, f.plan.operations[0].operationId, mode === "file" ? "source.csv" : "export-manifest.json"), "effect");
    if (mode === "extra-dir") await mkdir(path.join(run, "unknown"));
    if (mode === "batch") f.state.batchTotal = 1;
    if (mode === "revision") f.settings.scopeRevisions.push({ departmentId: f.target.departmentId, sourceKind: "flow", revision: 1 });
    await assert.rejects(closeJdLogisticsPreexport(f.options, "apply")); assert.equal(await readFile(path.join(f.directory, "active.json"), "utf8"), f.activeRaw);
  });
});
test("both original locks refuse occupied ownership", async t => {
  for (const lock of ["pipeline", "chromium"] as const) await t.test(lock, async t => {
    const f = await fixture(t), lockDirectory = lock === "pipeline" ? path.join(f.directory, "pipeline.lock") : path.join(f.root, ".runtime/jd-chromium-global.lock");
    await withJackyunRunLock({ runId: "fixture-live-owner", purpose: "test", lockDirectory }, async () => { await assert.rejects(closeJdLogisticsPreexport(f.options, "apply"), /已有任务正在执行/); });
    assert.equal(await readFile(path.join(f.directory, "active.json"), "utf8"), f.activeRaw);
  });
});
test("archive conflict fails without replacing target or original", async t => {
  const f = await fixture(t);
  f.options.checkpoint = async stage => { if (stage === "before_move") await writeFile(path.join(f.recovery, "active.archived.json"), "DO NOT OVERWRITE", { flag: "wx" }); };
  await assert.rejects(closeJdLogisticsPreexport(f.options, "apply"), /PATH_ALREADY_EXISTS/);
  assert.equal(await readFile(path.join(f.recovery, "active.archived.json"), "utf8"), "DO NOT OVERWRITE");
  assert.equal(await readFile(path.join(f.directory, "active.json"), "utf8"), f.activeRaw);
  await assert.rejects(readFile(path.join(f.recovery, "committed.json")), { code: "ENOENT" });
});
test("crash checkpoints retain one intent and prohibit automatic continuation or new intent", async t => {
  for (const point of ["intent_written", "before_move", "after_move", "before_committed"] as const) await t.test(point, async t => {
    const f = await fixture(t); f.options.checkpoint = async stage => { if (stage === point) throw new Error("synthetic crash"); };
    await assert.rejects(closeJdLogisticsPreexport(f.options, "apply"), /synthetic crash/);
    assert.equal(JSON.parse(await readFile(path.join(f.recovery, "intent.json"), "utf8")).status, "eligible_intent");
    await assert.rejects(readFile(path.join(f.recovery, "committed.json")), { code: "ENOENT" });
    if (point === "after_move" || point === "before_committed") { await assert.rejects(readFile(path.join(f.directory, "active.json")), { code: "ENOENT" }); assert.equal(await readFile(path.join(f.recovery, "active.archived.json"), "utf8"), f.activeRaw); }
    else assert.equal(await readFile(path.join(f.directory, "active.json"), "utf8"), f.activeRaw);
    await assert.rejects(closeJdLogisticsPreexport(f.options, "apply"), /PATH_ALREADY_EXISTS/);
    assert.equal(await readFile(path.join(f.directory, `${f.target.runId}.json`), "utf8"), f.manifestRaw);
  });
});
test("helper quarantine/busy, process replacement, browser activity and installed code changes fail closed", async t => {
  for (const mode of ["busy", "process", "browser", "bundle"] as const) await t.test(mode, async t => {
    const f = await fixture(t);
    if (mode === "busy") f.state.helperBusy = true;
    if (mode === "process") f.state.processPid = 223;
    if (mode === "browser") f.state.portClosed = false;
    if (mode === "bundle") await writeFile(path.join(f.release, "helper/tmall-workflow-helper.mjs"), "changed");
    await assert.rejects(closeJdLogisticsPreexport(f.options, "apply")); assert.equal(await readFile(path.join(f.directory, "active.json"), "utf8"), f.activeRaw);
  });
});
