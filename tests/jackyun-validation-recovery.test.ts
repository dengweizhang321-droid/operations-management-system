import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { inspectValidationRecovery, publishValidationRecovery } from "../lib/jackyun/validation-recovery";
import type { PreflightEvidence } from "../lib/jackyun/preflight-recovery";

const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const runId = "n8n-export-first-5399";
const modules = ["products", "inventory", "inventory_age", "sales", "combos"];
const expectedError = "导入前自动校验未通过：D:\\运营管理系统\\outputs\\jackyun-export-first-validation\\n8n-export-first-5399\\sales\\2026-08-16_2026-09-29_20260929213803\\audit.json";
const evidence: PreflightEvidence = {
  executionId: "5399", workflowId: "J8kY2mQ5vR7sT4pN", status: "error",
  startedAt: "2026-09-29T21:36:10.162Z", stoppedAt: "2026-09-29T21:38:09.003Z", retrySuccessId: null,
  lastNode: "C·五表完整校验和导入演练", runNodes: ["手动运行", "固定原执行计划时间", "领取共享 helper", "helper 领取成功？",
    "A·固定采集日和销售日期", "B·接口校验与五表下载", "C·五表完整校验和导入演练"],
  error: expectedError, httpCode: "500", requestUrl: "http://127.0.0.1:5791/jackyun/export-first/validate",
  executionDataSha256: "fbb3d3faf3004178a6481e471d2a01c2919d67958c142dde1a9aad84ea2569f4", activeExecutions: 0,
};

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "jackyun-5399-recovery-"));
  const downloads = path.join(root, "downloads", "jackyun", runId);
  const base = path.join(root, "outputs", "jackyun-export-first");
  const events = path.join(root, "outputs", "jackyun-browser-events", runId);
  const validation = path.join(root, "outputs", "jackyun-export-first-validation", runId);
  const formal = path.join(root, "outputs", "jackyun-import-runs", runId);
  for (const dir of [base, events, validation, formal, path.join(root, "config"),
    path.join(validation, "audit"), path.join(validation, "processed"), path.join(validation, "raw"),
    path.join(validation, "sales", "2026-08-16_2026-09-29_20260929213803")]) await mkdir(dir, { recursive: true });
  const exports: Record<string, { handoffSha256: string; fileSha256: string; bytes: number }> = {};
  const sourceFiles: string[] = [];
  for (const [index, module] of modules.entries()) {
    const directory = path.join(downloads, module);
    await mkdir(directory, { recursive: true });
    const file = path.join(directory, `${module}.xlsx`), bytes = Buffer.from(`synthetic-${module}`);
    await writeFile(file, bytes); sourceFiles.push(file);
    const event = { schemaVersion: 2, runId, module, policyVersion: "2026-09-06.export-first.1",
      filePath: file, expectedSourceRows: 1 };
    const eventBytes = JSON.stringify(event);
    await writeFile(path.join(events, `${String(index + 1).padStart(2, "0")}-${module}.json`), eventBytes);
    exports[module] = { handoffSha256: sha(eventBytes), fileSha256: sha(bytes), bytes: bytes.length };
  }
  const plan = { version: 2, protocol: "2026-09-06.export-first.1", executionId: "5399", runId,
    runDate: "2026-09-30", asOfDate: "2026-09-29", salesStartDate: "2026-08-16", baseUrl: "http://localhost:3000",
    phase: "validating", exportTransport: "session_api_v1", exports };
  await writeFile(path.join(base, `${runId}.json`), JSON.stringify(plan));
  await writeFile(path.join(base, "active.json"), JSON.stringify({ runId, executionId: "5399" }));
  await writeFile(path.join(root, "config", "jackyun-export-first-policy.json"), JSON.stringify({ version: plan.protocol,
    browser: { downloadDirectory: path.join(root, "downloads") } }));
  await writeFile(path.join(formal, "api-controller-state.json"), "{}");
  await writeFile(path.join(validation, "run-manifest.json"), JSON.stringify({ version: 1, runId, strictOrder: modules,
    modules: { products: { status: "prepared" }, inventory: { status: "prepared" },
      inventory_age: { status: "prepared" }, sales: { status: "failed" } } }));
  const failedAudit = { ok: false, period: { startDate: "2026-08-16", endDate: "2026-09-29" }, validation: {
    unmatchedCosts: { count: 1, samples: [{ code: "ZG-WB-YSFLQ-006", rows: [3547] }] },
    costConflicts: { count: 0 }, numericProblems: { count: 0 }, dateProblems: { count: 0 },
    excludedOutOfPeriodRows: { count: 0 }, excludedTodayRows: { count: 0 } } };
  const failedAuditPath = path.join(validation, "sales", "2026-08-16_2026-09-29_20260929213803", "audit.json");
  await writeFile(failedAuditPath, JSON.stringify(failedAudit));
  await writeFile(path.join(validation, "audit", "sales.json"), JSON.stringify({ status: "failed", module: "sales", runId,
    error: { stage: "sales_filter_cost_match_import_verify", message: expectedError } }));
  return { root, formal, failedAuditPath, sourceFiles };
}

test("5399 validation failure can be permitted only with five intact exports and no import effect", async () => {
  const f = await fixture();
  const at = "2026-09-30T01:00:00.000Z";
  const proposal = await inspectValidationRecovery(f.root, evidence, at);
  assert.equal(proposal.reason, "audited_5399_sales_cost_validation_before_import");
  assert.equal(proposal.fileCount, 17);
  const result = await publishValidationRecovery(proposal, evidence, sha(JSON.stringify(proposal)));
  assert.equal(result.status, "permitted");
  await assert.rejects(publishValidationRecovery(proposal, evidence, sha(JSON.stringify(proposal))), /EEXIST/);
  await writeFile(f.sourceFiles[0], "changed");
  await assert.rejects(inspectValidationRecovery(f.root, evidence, at), /摘要变化/);
});

test("5399 validation permit rejects import effects, changed diagnosis and altered n8n route", async () => {
  const at = "2026-09-30T01:00:00.000Z";
  const changed = await fixture();
  await writeFile(path.join(changed.formal, "audit.json"), "{}");
  await assert.rejects(inspectValidationRecovery(changed.root, evidence, at), /目录结构/);
  const wrongCost = await fixture();
  const audit = JSON.parse(await readFile(wrongCost.failedAuditPath, "utf8"));
  audit.validation.unmatchedCosts.samples[0].code = "OTHER-SKU";
  await writeFile(wrongCost.failedAuditPath, JSON.stringify(audit));
  await assert.rejects(inspectValidationRecovery(wrongCost.root, evidence, at), /失败原因/);
  const otherRoute = await fixture();
  await assert.rejects(inspectValidationRecovery(otherRoute.root,
    { ...evidence, runNodes: [...evidence.runNodes, "D·统一导入运营管理系统"] }, at), /精确五表校验失败/);
});
