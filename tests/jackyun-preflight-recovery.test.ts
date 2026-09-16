import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { inspectPreflightClosure, publishPreflightClosure, assertClosedPreflight, recoverySha, preflightClosurePath,
  jackyunWorkflowId, type PreflightEvidence } from "../lib/jackyun/preflight-recovery";
import { readN8nPreflightEvidence } from "../tools/jackyun-preflight-recovery";
import { runJackyunExportFirstAction } from "../tools/jackyun-export-first-pipeline";
import { withJackyunRunLock } from "../lib/jackyun/run-lock";

const nodeName = "1·分仓库存：筛选并导出所有页";
const proof: PreflightEvidence = { executionId: "841", workflowId: jackyunWorkflowId, status: "error",
  startedAt: "2026-09-06T09:00:00.000Z", stoppedAt: "2026-09-06T09:00:02.000Z", lastNode: nodeName,
  runNodes: ["手动运行", "领取共享 helper", "helper 领取成功？", "A·固定采集日和销售日期", nodeName],
  error: "inventory 导出未完成：login_unknown", httpCode: "500", requestUrl: "http://127.0.0.1:5791/jackyun/export-first/export/inventory",
  executionDataSha256: "1".repeat(64), activeExecutions: 0, retrySuccessId: null };
const closedAt = "2026-09-06T10:00:00.000Z";
const proof897: PreflightEvidence = { executionId: "897", workflowId: jackyunWorkflowId, status: "error",
  startedAt: "2026-09-08T03:51:42.636Z", stoppedAt: "2026-09-08T03:52:12.107Z", retrySuccessId: null,
  lastNode: "B·网页校验后 HTTP 导出五表",
  runNodes: ["手动运行", "领取共享 helper", "helper 领取成功？", "A·固定采集日和销售日期", "B·网页校验后 HTTP 导出五表"],
  error: "模块页面控件尚未就绪：branch_stock_main / warehouseCom", httpCode: "500",
  requestUrl: "http://127.0.0.1:5791/jackyun/export-first/export-all",
  executionDataSha256: "87b51149300402e7dfbb642244985b1bc2beb13ff3d16f8c9b7f89d53d99c586", activeExecutions: 0 };
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "jackyun-preflight-test-"));
  const pipeline = path.join(root, "outputs", "jackyun-export-first"), download = path.join(root, "downloads");
  await mkdir(pipeline, { recursive: true }); await mkdir(path.join(root, "config")); await mkdir(download);
  const planPath = path.join(pipeline, "n8n-export-first-841.json"), activePath = path.join(pipeline, "active.json");
  const plan = { version: 1, protocol: "2026-09-06.export-first.1", executionId: "841", runId: "n8n-export-first-841",
    runDate: "2026-09-06", asOfDate: "2026-09-05", baseUrl: "http://localhost:3000", createdAt: "2026-09-06T09:00:01.000Z",
    phase: "exporting", exports: {}, exportIntent: "inventory" };
  await writeFile(planPath, JSON.stringify(plan)); await writeFile(activePath, JSON.stringify({ runId: plan.runId, executionId: "841" }));
  await writeFile(path.join(root, "config", "jackyun-export-first-policy.json"), JSON.stringify({ version: plan.protocol,
    browser: { downloadDirectory: download, allowedDownloadHosts: [], controller: { profileDirectory: path.join(root, "profile") } } }));
  const deps = { root, lockDirectory: path.join(root, "lock"), profileReady: async () => true,
    now: () => new Date("2026-09-07T01:00:00Z"), request: (async () => new Response("{}")) as typeof fetch };
  return { root, pipeline, download, plan, planPath, activePath, deps };
}
async function fixture897() {
  const f = await fixture(), runId = "n8n-export-first-897";
  const planPath = path.join(f.pipeline, runId + ".json"), controllerPath = path.join(f.root, "outputs", "jackyun-import-runs", runId, "browser-controller-state.json");
  await writeFile(planPath, await readFile(new URL("./fixtures/jackyun-897-plan.json", import.meta.url)));
  await mkdir(path.dirname(controllerPath), { recursive: true });
  await writeFile(controllerPath, await readFile(new URL("./fixtures/jackyun-897-controller.json", import.meta.url)));
  await writeFile(f.activePath, JSON.stringify({ runId, executionId: "897" }));
  return { ...f, planPath, controllerPath, runId };
}

const proof2621: PreflightEvidence = {
  executionId: "2621", workflowId: jackyunWorkflowId, status: "error",
  startedAt: "2026-09-16T16:10:01.909Z", stoppedAt: "2026-09-16T16:10:12.384Z", retrySuccessId: null,
  lastNode: "B·接口校验与五表下载",
  runNodes: ["每天本机时间 00:10", "领取共享 helper", "helper 领取成功？", "A·固定采集日和销售日期", "B·接口校验与五表下载"],
  error: "waiting_login：吉客云 DPAPI 凭据配置或解密未完成（initialize）。", httpCode: "500",
  requestUrl: "http://127.0.0.1:5791/jackyun/export-first/export-all",
  executionDataSha256: "27aac9dd30454319f2158b7b9428549e026762f9701c9a0d98c9b6e71064f24f", activeExecutions: 0,
};
async function fixture2621() {
  const f = await fixture(), runId = "n8n-export-first-2621";
  const planPath = path.join(f.pipeline, `${runId}.json`);
  await writeFile(planPath, JSON.stringify({ version: 1, protocol: "2026-09-06.export-first.1", executionId: "2621", runId,
    runDate: "2026-09-17", asOfDate: "2026-09-16", baseUrl: "http://localhost:3000", createdAt: "2026-09-16T16:10:04.007Z",
    phase: "exporting", exports: {}, exportTransport: "session_api_v1" }, null, 2) + "\n");
  await writeFile(f.activePath, JSON.stringify({ runId, executionId: "2621" }));
  return { ...f, planPath, runId, deps: { ...f.deps, now: () => new Date("2026-09-16T17:00:00Z") } };
}

test("2621 closure preserves original failure and permits only a new full API plan", async () => {
  const f = await fixture2621(), before = await readFile(f.planPath), active = await readFile(f.activePath);
  await assert.rejects(runJackyunExportFirstAction("plan-api", "2623", f.deps), /尚未闭合/);
  const proposal = await inspectPreflightClosure(f.root, "2621", proof2621, "2026-09-16T16:59:00Z");
  assert.equal(proposal.reason, "audited_2621_dpapi_before_api_exports");
  await publishPreflightClosure(f.root, proposal, proof2621, recoverySha(JSON.stringify(proposal)));
  await assertClosedPreflight(f.root, "2621");
  assert.deepEqual(await readFile(f.planPath), before);
  assert.deepEqual(await readFile(f.activePath), active);
  await assert.rejects(publishPreflightClosure(f.root, proposal, proof2621, recoverySha(JSON.stringify(proposal))));
  await assert.rejects(runJackyunExportFirstAction("export-all", "2621", f.deps), /已经闭合/);
  await assert.rejects(runJackyunExportFirstAction("export-all", "2623", f.deps), /缺少/);
  const next = await runJackyunExportFirstAction("plan-api", "2623", f.deps);
  assert.equal(next.exportTransport, "session_api_v1");
  const nextPlan = JSON.parse(await readFile(path.join(f.pipeline, "n8n-export-first-2623.json"), "utf8"));
  assert.equal(nextPlan.runDate, "2026-09-17");
  assert.equal(nextPlan.asOfDate, "2026-09-16");
  assert.deepEqual(await readFile(f.planPath), before);
});

test("2621 rejects changed evidence, any business artifact and late writes after closure", async () => {
  for (const change of ["plan", "active", "live", "hash", "retry", "other-id", "later-node", "error", "time", "imports", "events", "validation", "download", "late-imports"]) {
    const f = await fixture2621(), evidence = { ...proof2621 };
    const imports = path.join(f.root, "outputs/jackyun-import-runs", f.runId);
    if (change === "late-imports") {
      const proposal = await inspectPreflightClosure(f.root, "2621", evidence, "2026-09-16T16:59:00Z");
      await publishPreflightClosure(f.root, proposal, evidence, recoverySha(JSON.stringify(proposal)));
      await mkdir(imports, { recursive: true });
      await assert.rejects(runJackyunExportFirstAction("plan-api", "2623", f.deps), /尚未闭合/);
      continue;
    }
    if (change === "plan") await writeFile(f.planPath, (await readFile(f.planPath, "utf8")) + " ");
    if (change === "active") await writeFile(f.activePath, JSON.stringify({ runId: "n8n-export-first-2623", executionId: "2623" }));
    if (change === "live") evidence.activeExecutions = 1;
    if (change === "hash") evidence.executionDataSha256 = "f".repeat(64);
    if (change === "retry") evidence.retrySuccessId = "2623";
    if (change === "other-id") evidence.executionId = "2623";
    if (change === "later-node") evidence.runNodes = [...evidence.runNodes, "D·统一导入运营管理系统"];
    if (change === "error") evidence.error = "提交结果未决";
    if (change === "time") evidence.stoppedAt = "2026-09-16T16:10:13.384Z";
    const paths = { imports, events: path.join(f.root, "outputs/jackyun-browser-events", f.runId),
      validation: path.join(f.root, "outputs/jackyun-export-first-validation", f.runId), download: path.join(f.download, "jackyun", f.runId) };
    if (change in paths) await mkdir(paths[change as keyof typeof paths], { recursive: true });
    await assert.rejects(inspectPreflightClosure(f.root, "2621", evidence, "2026-09-16T16:59:00Z"));
  }
});
test("audited 897 closes before export without altering original bytes and allows a fresh API plan", async () => {
  const f = await fixture897(), before = await readFile(f.planPath), controller = await readFile(f.controllerPath), active = await readFile(f.activePath);
  const proposal = await inspectPreflightClosure(f.root, "897", proof897, "2026-09-08T06:00:00Z");
  assert.equal(proposal.reason, "audited_897_controls_before_query_and_export");
  await publishPreflightClosure(f.root, proposal, proof897, recoverySha(JSON.stringify(proposal)));
  await assertClosedPreflight(f.root, "897");
  assert.deepEqual(await readFile(f.planPath), before); assert.deepEqual(await readFile(f.controllerPath), controller); assert.deepEqual(await readFile(f.activePath), active);
  const deps = { ...f.deps, now: () => new Date("2026-09-08T06:01:00Z") };
  await assert.rejects(runJackyunExportFirstAction("export-all", "897", deps), /已经闭合/);
  await assert.rejects(runJackyunExportFirstAction("export-all", "898", deps), /缺少/);
  assert.equal((await runJackyunExportFirstAction("plan-api", "898", deps)).exportTransport, "session_api_v1");
});
test("897 exception rejects changed identity, controller, later stages and any new side effect", async () => {
  for (const change of ["plan", "controller", "extra-file", "events", "download", "validation", "active", "live", "hash", "retry", "other-id", "later-node"]) {
    const f = await fixture897(); const evidence = { ...proof897 };
    if (change === "plan") await writeFile(f.planPath, (await readFile(f.planPath, "utf8")) + " ");
    if (change === "controller") await writeFile(f.controllerPath, (await readFile(f.controllerPath, "utf8")).replace("navigated", "export_armed"));
    if (change === "extra-file") await writeFile(path.join(path.dirname(f.controllerPath), "unexpected.json"), "{}");
    if (change === "events") await mkdir(path.join(f.root, "outputs", "jackyun-browser-events", f.runId), { recursive: true });
    if (change === "download") await mkdir(path.join(f.download, "jackyun", f.runId), { recursive: true });
    if (change === "validation") await mkdir(path.join(f.root, "outputs", "jackyun-export-first-validation", f.runId), { recursive: true });
    if (change === "active") await writeFile(f.activePath, JSON.stringify({ runId: "n8n-export-first-898", executionId: "898" }));
    if (change === "live") evidence.activeExecutions = 1;
    if (change === "hash") evidence.executionDataSha256 = "f".repeat(64);
    if (change === "retry") evidence.retrySuccessId = "898";
    if (change === "other-id") evidence.executionId = "898";
    if (change === "later-node") evidence.runNodes = [...evidence.runNodes, "D·统一导入运营管理系统"];
    await assert.rejects(inspectPreflightClosure(f.root, "897", evidence, "2026-09-08T06:00:00Z"));
  }
});
test("preflight closure preserves old bytes, rejects old execution replay and permits only a new full n8n plan", async () => {
  const f = await fixture(), before = await readFile(f.planPath), active = await readFile(f.activePath);
  await assert.rejects(runJackyunExportFirstAction("plan", "842", f.deps), /尚未闭合/);
  const proposal = await inspectPreflightClosure(f.root, "841", proof, closedAt);
  await publishPreflightClosure(f.root, proposal, proof, recoverySha(JSON.stringify(proposal)));
  assert.deepEqual(await readFile(f.planPath), before); assert.deepEqual(await readFile(f.activePath), active);
  await assertClosedPreflight(f.root, "841");
  await assert.rejects(runJackyunExportFirstAction("export/inventory", "841", f.deps), /已经闭合/);
  await assert.rejects(runJackyunExportFirstAction("export/inventory", "842", f.deps), /缺少本 execution/);
  const next = await runJackyunExportFirstAction("plan", "842", f.deps);
  assert.equal(next.runId, "n8n-export-first-842");
  const nextPlan = JSON.parse(await readFile(path.join(f.pipeline, `${next.runId}.json`), "utf8"));
  assert.equal(nextPlan.runDate, "2026-09-07"); assert.equal(nextPlan.asOfDate, "2026-09-06");
  assert.deepEqual(await readFile(f.planPath), before);
});
test("recovery rejects uncertain clicks, foreign identity, running/successful retries and later nodes", async () => {
  const f = await fixture();
  for (const bad of [{ error: "download timeout" }, { status: "running" }, { executionId: "840" }, { workflowId: "other" },
    { activeExecutions: 1 }, { retrySuccessId: "842" }, { requestUrl: "http://evil.invalid/" }, { httpCode: "502" },
    { runNodes: [...proof.runNodes, "2·组合装及子件：导出所有页"] }, { stoppedAt: "2026-09-06T08:00:00Z" }]) {
    await assert.rejects(inspectPreflightClosure(f.root, "841", { ...proof, ...bad }, closedAt));
  }
});
test("every browser/download/validation/import directory blocks no-effect recovery even when empty", async () => {
  for (const index of [0, 1, 2, 3]) {
    const f = await fixture(), proposal = await inspectPreflightClosure(f.root, "841", proof, closedAt);
    await mkdir(proposal.absentPaths[index], { recursive: true });
    await assert.rejects(publishPreflightClosure(f.root, proposal, proof, recoverySha(JSON.stringify(proposal))), /已存在/);
  }
});
test("closure fences changed plan, active owner, policy, proof and approved digest", async () => {
  for (const change of ["plan", "active", "policy", "proof", "sha"]) {
    const f = await fixture(), proposal = await inspectPreflightClosure(f.root, "841", proof, closedAt);
    if (change === "plan") await writeFile(f.planPath, JSON.stringify({ ...f.plan, phase: "importing" }));
    if (change === "active") await writeFile(f.activePath, JSON.stringify({ runId: "n8n-export-first-842", executionId: "842" }));
    if (change === "policy") await writeFile(path.join(f.root, "config", "jackyun-export-first-policy.json"), "{}");
    await assert.rejects(publishPreflightClosure(f.root, proposal, change === "proof" ? { ...proof, executionDataSha256: "2".repeat(64) } : proof,
      change === "sha" ? "f".repeat(64) : recoverySha(JSON.stringify(proposal))));
  }
});
test("closure is create-only and newly appeared effects or receipt tampering still block subsequent plan", async () => {
  const f = await fixture(), proposal = await inspectPreflightClosure(f.root, "841", proof, closedAt);
  await publishPreflightClosure(f.root, proposal, proof, recoverySha(JSON.stringify(proposal)));
  await assert.rejects(publishPreflightClosure(f.root, proposal, proof, recoverySha(JSON.stringify(proposal))), /EEXIST/);
  await writeFile(preflightClosurePath(f.root, "841"), JSON.stringify({ ...proposal, planSha256: "f".repeat(64) }));
  await assert.rejects(runJackyunExportFirstAction("plan", "842", f.deps), /尚未闭合/);
});
test("recovery rejects junctions and shares the business runner lock", async () => {
  const f = await fixture(), elsewhere = await mkdtemp(path.join(tmpdir(), "jackyun-preflight-link-"));
  await mkdir(path.join(f.root, "outputs", "jackyun-browser-events"), { recursive: true });
  await symlink(elsewhere, path.join(f.root, "outputs", "jackyun-browser-events", f.plan.runId), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(inspectPreflightClosure(f.root, "841", proof, closedAt));
  const clean = await fixture();
  await withJackyunRunLock({ runId: "operator", purpose: "test", lockDirectory: clean.deps.lockDirectory }, async () => {
    await assert.rejects(runJackyunExportFirstAction("plan", "842", clean.deps), /锁|运行|执行|占用/);
  });
});
test("n8n SQLite probe reads only exact execution, omits resume secrets and detects another live execution", async () => {
  const f = await fixture(), databasePath = path.join(f.root, "n8n.sqlite"), db = new DatabaseSync(databasePath);
  db.exec("CREATE TABLE execution_entity(id INTEGER PRIMARY KEY,workflowId TEXT,status TEXT,startedAt TEXT,stoppedAt TEXT,retrySuccessId TEXT,deletedAt TEXT); CREATE TABLE execution_data(executionId INTEGER,data TEXT)");
  db.prepare("INSERT INTO execution_entity VALUES(?,?,?,?,?,?,?)").run(841, jackyunWorkflowId, "error", "2026-09-06 09:00:00.000", "2026-09-06 09:00:02.000", null, null);
  const data = JSON.stringify([{ resultData: "1", resumeToken: "2" }, { error: "3", runData: "4", lastNodeExecuted: "5" }, "synthetic-secret-never-output",
    { description: "6", httpCode: "7", node: "8" }, Object.fromEntries(proof.runNodes.map(n => [n, []])), nodeName,
    proof.error, "500", { parameters: "9" }, { url: "10" }, proof.requestUrl]);
  db.prepare("INSERT INTO execution_data VALUES(?,?)").run(841, data); db.close();
  const before = recoverySha(await readFile(databasePath)), evidence = readN8nPreflightEvidence(databasePath, "841");
  assert.equal(evidence.error, proof.error); assert.equal(evidence.activeExecutions, 0);
  assert.ok(!JSON.stringify(evidence).includes("synthetic-secret")); assert.equal(recoverySha(await readFile(databasePath)), before);
  const writer = new DatabaseSync(databasePath); writer.prepare("INSERT INTO execution_entity VALUES(?,?,?,?,?,?,?)").run(842, jackyunWorkflowId, "running", null, null, null, null); writer.close();
  assert.equal(readN8nPreflightEvidence(databasePath, "841").activeExecutions, 1);
});

const queryProof: PreflightEvidence = { ...proof, stoppedAt: "2026-09-06T09:00:30.000Z",
  error: "TABLE_TIMEOUT [query_refresh]: inventory 未观测到本轮查询触发的包含目标日期 缺失 的模块网络请求完成；拒绝把旧表格当作新结果。" };
async function queryFixture() {
  const f = await fixture(), directory = path.join(f.root, "outputs", "jackyun-import-runs", f.plan.runId);
  await mkdir(directory, { recursive: true });
  const statePath = path.join(directory, "browser-controller-state.json");
  const state = { version: 1, runId: f.plan.runId, policyVersion: f.plan.protocol, updatedAt: "2026-09-06T09:00:29.000Z",
    modules: { inventory: { status: "queried", navigationIntentAt: "2026-09-06T09:00:02.000Z", timings: { enterModuleMs: 917 },
      fieldChecks: [{ field: "仓库", value: "已勾选:244条", verifiedAt: "2026-09-06T09:00:05.000Z" }],
      queryIntentAt: "2026-09-06T09:00:05.000Z", tableReadbackFailure: { code: "table_timeout", observedAt: "2026-09-06T09:00:29.000Z" } } } };
  await writeFile(statePath, JSON.stringify(state));
  return { ...f, directory, state, statePath };
}

test("query failure closure preserves controller and plan, binds hashes and permits a new complete execution", async () => {
  const f = await queryFixture(), before = await readFile(f.statePath), planBefore = await readFile(f.planPath);
  const proposal = await inspectPreflightClosure(f.root, "841", queryProof, closedAt);
  assert.equal(proposal.status, "closed_before_export"); assert.equal(proposal.controllerEvidence?.sha256, recoverySha(before));
  await publishPreflightClosure(f.root, proposal, queryProof, recoverySha(JSON.stringify(proposal)));
  await assertClosedPreflight(f.root, "841");
  await assert.rejects(runJackyunExportFirstAction("export/inventory", "841", f.deps), /已经闭合/);
  await runJackyunExportFirstAction("plan", "842", f.deps);
  assert.deepEqual(await readFile(f.statePath), before); assert.deepEqual(await readFile(f.planPath), planBefore);
});

test("query recovery rejects any export intent, foreign state, late timestamp, extra file or controller change", async () => {
  for (const fault of ["intent", "stable", "module", "run", "time", "file", "mutated"]) {
    const f = await queryFixture(), proposal = await inspectPreflightClosure(f.root, "841", queryProof, closedAt);
    if (fault === "intent") Object.assign(f.state.modules.inventory, { exportIntentAt: f.state.updatedAt });
    if (fault === "stable") Object.assign(f.state.modules.inventory, { tableStableAt: f.state.updatedAt });
    if (fault === "module") Object.assign(f.state.modules, { combos: {} });
    if (fault === "run") f.state.runId = "n8n-export-first-842";
    if (fault === "time") f.state.updatedAt = "2026-09-06T09:00:31.000Z";
    if (fault === "file") await writeFile(path.join(f.directory, "export.xlsx"), "unexpected");
    if (fault === "mutated") f.state.modules.inventory.timings.enterModuleMs += 1;
    await writeFile(f.statePath, JSON.stringify(f.state));
    await assert.rejects(publishPreflightClosure(f.root, proposal, queryProof, recoverySha(JSON.stringify(proposal))));
  }
  const f = await queryFixture();
  await assert.rejects(inspectPreflightClosure(f.root, "841", proof, closedAt));
  await assert.rejects(inspectPreflightClosure(f.root, "841", { ...queryProof, error: "TABLE_TIMEOUT export result unknown" }, closedAt));
});

test("query closure remains invalid if a download or later controller mutation appears", async () => {
  for (const fault of ["download", "controller"]) {
    const f = await queryFixture(), proposal = await inspectPreflightClosure(f.root, "841", queryProof, closedAt);
    await publishPreflightClosure(f.root, proposal, queryProof, recoverySha(JSON.stringify(proposal)));
    if (fault === "download") await mkdir(path.join(f.download, "jackyun", f.plan.runId), { recursive: true });
    else await writeFile(f.statePath, JSON.stringify({ ...f.state, updatedAt: "2026-09-06T09:00:28.000Z" }));
    await assert.rejects(runJackyunExportFirstAction("plan", "842", f.deps), /尚未闭合/);
  }
});

const menuProof: PreflightEvidence = { ...proof, executionId: "843",
  startedAt: "2026-09-06T11:37:04.545Z", stoppedAt: "2026-09-06T11:37:26.934Z",
  error: "未找到当前模块唯一的导出所有页菜单。",
  executionDataSha256: "c72519e3ce9fca4069e28c3c309531744ffd3c1629727ff8ef87327802badb54" };
const menuClosedAt = "2026-09-06T13:00:00.000Z";
async function menuFixture() {
  const f = await fixture();
  const plan = { ...f.plan, executionId: "843", runId: "n8n-export-first-843", createdAt: "2026-09-06T11:37:05.011Z" };
  const planPath = path.join(f.pipeline, `${plan.runId}.json`), directory = path.join(f.root, "outputs", "jackyun-import-runs", plan.runId);
  await mkdir(directory, { recursive: true });
  const statePath = path.join(directory, "browser-controller-state.json");
  // Canonical LF restores the audited bytes even when Git checks out CRLF.
  const state = JSON.parse(await readFile(new URL("./fixtures/jackyun-843-menu-controller.json", import.meta.url), "utf8"));
  await writeFile(statePath, JSON.stringify(state, null, 2) + "\n");
  await writeFile(planPath, JSON.stringify(plan, null, 2) + "\n");
  await writeFile(f.activePath, JSON.stringify({ runId: plan.runId, executionId: "843" }));
  return { ...f, plan, planPath, directory, statePath };
}

test("audited 843 closes only the exact historical menu lookup failure and preserves all original evidence", async () => {
  const f = await menuFixture(), state = await readFile(f.statePath), plan = await readFile(f.planPath), active = await readFile(f.activePath);
  const proposal = await inspectPreflightClosure(f.root, "843", menuProof, menuClosedAt);
  assert.equal(proposal.reason, "audited_843_menu_lookup_before_export_click");
  assert.equal(proposal.historicalCodeEvidence?.releaseId, "20260906T113045Z-e1a943dd272d5547");
  await publishPreflightClosure(f.root, proposal, menuProof, recoverySha(JSON.stringify(proposal)));
  await assertClosedPreflight(f.root, "843");
  assert.deepEqual(await readFile(f.activePath), active);
  await assert.rejects(runJackyunExportFirstAction("export/inventory", "843", f.deps), /已经闭合/);
  await runJackyunExportFirstAction("plan", "844", f.deps);
  assert.deepEqual(await readFile(f.statePath), state); assert.deepEqual(await readFile(f.planPath), plan);
});

test("historical menu recovery rejects altered identities, timestamps, bytes, running retries or new effects", async () => {
  for (const fault of ["id", "hash", "time", "running", "active", "retry", "plan", "controller", "file", "download", "events", "validation"]) {
    const f = await menuFixture(), evidence = { ...menuProof };
    if (fault === "id") evidence.executionId = "844";
    if (fault === "hash") evidence.executionDataSha256 = "a".repeat(64);
    if (fault === "time") evidence.stoppedAt = "2026-09-06T11:37:27.000Z";
    if (fault === "running") evidence.status = "running";
    if (fault === "active") evidence.activeExecutions = 1;
    if (fault === "retry") evidence.retrySuccessId = "844";
    if (fault === "plan") await writeFile(f.planPath, JSON.stringify(f.plan));
    if (fault === "controller") await writeFile(f.statePath, (await readFile(f.statePath, "utf8")) + " ");
    if (fault === "file") await writeFile(path.join(f.directory, "export.xlsx"), "uncertain");
    const effects = { download: path.join(f.download, "jackyun", f.plan.runId), events: path.join(f.root, "outputs", "jackyun-browser-events", f.plan.runId),
      validation: path.join(f.root, "outputs", "jackyun-export-first-validation", f.plan.runId) };
    if (fault in effects) await mkdir(effects[fault as keyof typeof effects], { recursive: true });
    await assert.rejects(inspectPreflightClosure(f.root, "843", evidence, menuClosedAt));
  }
  const arbitrary = await queryFixture();
  await assert.rejects(inspectPreflightClosure(arbitrary.root, "841", { ...queryProof, error: menuProof.error }, menuClosedAt));
});

test("audited menu closure remains fenced against late controller mutation and receipt changes", async () => {
  for (const fault of ["controller", "receipt"]) {
    const f = await menuFixture(), proposal = await inspectPreflightClosure(f.root, "843", menuProof, menuClosedAt);
    await publishPreflightClosure(f.root, proposal, menuProof, recoverySha(JSON.stringify(proposal)));
    if (fault === "controller") await writeFile(f.statePath, (await readFile(f.statePath, "utf8")) + " ");
    else await writeFile(preflightClosurePath(f.root, "843"), JSON.stringify({ ...proposal, historicalCodeEvidence: undefined }));
    await assert.rejects(runJackyunExportFirstAction("plan", "844", f.deps), /尚未闭合/);
  }
});
