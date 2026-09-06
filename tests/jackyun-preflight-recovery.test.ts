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
