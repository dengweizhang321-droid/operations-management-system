import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { readN8nPreflightEvidence } from "./jackyun-preflight-recovery.ts";
import { verifyJackyunPreparedImports } from "./jackyun-export-first-pipeline.ts";
import { runJackyunDownload } from "./jackyun-download-runner.ts";
import { verifyPublishedJackyunBatches } from "./jackyun-n8n-pipeline.ts";
import { assertSalesPostImportVerification, salesSourceRowCountSemantic } from "./sales-import-runner.ts";
import { createJackyunInputContractHash, jackyunCaptureDate, jackyunExportFirstPolicyVersion } from "../lib/jackyun/run-contract.ts";
import { jackyunModuleOrder } from "../lib/jackyun/post-download.ts";
import { verifyJackyunModuleArtifact } from "../lib/jackyun/run-artifact-verification.ts";
import { writeJsonAtomic } from "../lib/jackyun/json-file.ts";
import { withJackyunRunLock } from "../lib/jackyun/run-lock.ts";

// This is an explicitly authorized, single-incident maintenance operator. It
// never changes n8n history, downloads reports, starts a workflow, or submits
// sales bytes. The one sales complete request can only consume a normalized
// session independently proved already completed by the owning database role.
export const incident = Object.freeze({
  executionId: "7792", runId: "n8n-export-first-7792", workflowId: "J8kY2mQ5vR7sT4pN",
  dataSha256: "e22cddb0dbc8a4b5817e1ad7bd6f4de46fd4ecd2887f56b755373a36abaf9b32",
  startedAt: "2026-10-10T01:49:59.392Z", stoppedAt: "2026-10-10T01:55:29.884Z",
  failedAt: "2026-10-10T01:55:29.634Z", error: "Django 销售服务暂时不可用，请稍后重试。",
  date: "2026-10-10", start: "2026-08-26", end: "2026-10-09", baseUrl: "http://localhost:3000",
  uploadId: "c47722e2b62a42b282c974488286f6ce", outputBytes: 9121487,
  normalizedSessionId: "f21d4ff7-899f-48ee-a5ae-c492f0b2a285",
  salesBatch: "2144b5de068d68c25845745e59f9512ff843951709bd7032e4909fa5d1b0c782",
  outputSha: "6b0b87c26042e17548c8f74a72e04fb5aadd6fbe7f99d1f47319fb84851f302b",
  salesRows: 38574, salesChild: "2026-08-26_2026-10-09_20261010015305",
  inventoryBatch: "4c0ed353fc634788cd3bf9984bddaedabf76c45b25196a23db59a5ad1c61b74f",
});
const reason = "audited_7792_committed_sales_receipt_and_combos";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const requireProof = (condition, message) => { if (!condition) throw new Error(message); };
const parse = bytes => JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
const handoffName = module => `${String(jackyunModuleOrder.indexOf(module) + 1).padStart(2, "0")}-${module}.json`;
const stableUploadProof = proof => { const stable = { ...proof }; delete stable.observedAt; return stable; };

export function assertUploadProof(proof, now = new Date().toISOString()) {
  const age = Date.parse(now) - Date.parse(proof?.observedAt);
  requireProof(proof?.version === 1 && proof.readOnly === true && proof.actorVerified === true
    && proof.uploadId === incident.uploadId && proof.batchId === incident.salesBatch
    && proof.normalizedStatus === "completed" && proof.normalizedSessionId === incident.normalizedSessionId
    && proof.rawFileHash === incident.outputSha && proof.fileSizeBytes === incident.outputBytes
    && proof.startDate === incident.start && proof.endDate === incident.end && proof.channels === null
    && Number.isSafeInteger(proof.ownerGeneration) && proof.ownerGeneration > 0
    && proof.claimEligible === true && Number.isFinite(age) && age >= 0 && age <= 120000
    && Date.parse(proof.expiresAt) > Date.parse(now)
    && (proof.status === "completed" ? proof.resultBatchId === incident.salesBatch
      : proof.status === "processing" && !proof.resultBatchId && proof.payloadSha256 === incident.outputSha
        && Date.parse(proof.updatedAt) <= Date.parse(now) - 30 * 60000),
  "7792 原上传会话、已提交结果或只读证明不满足收尾条件。");
}

export function assertEvidence(evidence) {
  requireProof(evidence?.executionId === incident.executionId && evidence.workflowId === incident.workflowId
    && evidence.status === "error" && evidence.activeExecutions === 0 && evidence.retrySuccessId === null
    && evidence.startedAt === incident.startedAt && evidence.stoppedAt === incident.stoppedAt
    && evidence.executionDataSha256 === incident.dataSha256 && evidence.error === incident.error
    && evidence.httpCode === "500" && evidence.lastNode === "D·统一导入运营管理系统"
    && evidence.requestUrl === "http://127.0.0.1:5791/jackyun/export-first/import"
    && isDeepStrictEqual(evidence.runNodes, ["手动运行", "固定原执行计划时间", "领取共享 helper", "helper 领取成功？",
      "A·固定采集日和销售日期", "B·接口校验与五表下载", "C·五表完整校验和导入演练", "D·统一导入运营管理系统"]),
  "不是 7792 的精确部分导入失败。");
}

function names(root) {
  const pipeline = path.join(root, "outputs/jackyun-export-first");
  const formal = path.join(root, "outputs/jackyun-import-runs", incident.runId);
  return { root, pipeline, formal,
    plan: path.join(pipeline, incident.runId + ".json"), active: path.join(pipeline, "active.json"),
    policy: path.join(root, "config/jackyun-export-first-policy.json"),
    manifest: path.join(formal, "run-manifest.json"), parentAudit: path.join(formal, "audit/sales.json"),
    childAudit: path.join(formal, "sales", incident.salesChild, "audit.json"),
    registry: path.join(formal, "sales/processed-downloads.json"),
    events: path.join(root, "outputs/jackyun-browser-events", incident.runId),
    validation: path.join(root, "outputs/jackyun-export-first-validation", incident.runId),
    recovery: path.join(pipeline, "receipt-recoveries", incident.executionId),
  };
}

async function assertPlainPath(target, missing = false) {
  const absolute = path.resolve(target), parent = path.dirname(absolute);
  if (parent !== absolute) await assertPlainPath(parent, missing);
  let info;
  try { info = await lstat(absolute); } catch (error) {
    if (missing && error.code === "ENOENT") return null;
    throw error;
  }
  requireProof(!info.isSymbolicLink() && (info.isDirectory() || info.isFile() && info.nlink === 1)
    && path.resolve(await realpath(absolute)).toLowerCase() === absolute.toLowerCase(), "恢复路径有链接或身份异常。");
  return info;
}

async function bytes(file) {
  const info = await assertPlainPath(file);
  requireProof(info.isFile() && info.size <= 512 * 1024 * 1024, "恢复文件大小或类型异常。");
  return readFile(file);
}

async function absence(file) {
  requireProof(await assertPlainPath(file, true) === null, "恢复目标已有文件，拒绝覆盖或重放。");
}

async function jsonGet(url, request = fetch) {
  const response = await request(url, { cache: "no-store", signal: AbortSignal.timeout(30000) });
  requireProof(response.ok, "权威只读接口不可用。");
  return response.json();
}

async function assertIdle(request = fetch) {
  const h = await jsonGet("http://127.0.0.1:5791/health", request);
  requireProof(h.ok === true && h.busy === false && !h.activeWorkflow && !h.drain, "helper 正忙或维护门禁未解除。");
}

async function sourceState(request) {
  const health = await jsonGet(incident.baseUrl + "/api/sales/data-health", request);
  const combos = await jsonGet(incident.baseUrl + "/api/imports/erp?source=combos&limit=1", request);
  const latestCombo = combos.items?.[0];
  requireProof(latestCombo?.status === "completed" && typeof latestCombo.id === "string", "组合装历史缺少已完成批次。");
  // List projections omit ownedRowCount. Only the exact-batch endpoint proves
  // that the currently selected batch still owns the complete relation set.
  const exact = await jsonGet(incident.baseUrl + "/api/imports/erp?" + new URLSearchParams({ source: "combos", batchId: latestCombo.id }), request);
  const combo = exact.items?.find(item => item.id === latestCombo.id);
  requireProof(health.latestBatch?.id === incident.salesBatch && health.coverage?.cutoffDate === incident.end
    && typeof health.revision === "string" && combo?.status === "completed" && combo.ownedRowCount > 0,
  "销售或组合装来源已变化，停止使用旧文件续导。");
  return { salesRevision: health.revision, salesBatch: health.latestBatch.id,
    combo: { id: combo.id, rowCount: combo.rowCount, ownedRowCount: combo.ownedRowCount,
      contentHash: combo.totals?.contentHash, rawFileHash: combo.totals?.rawFileHash } };
}

export function buildSalesReceipt({ plan, manifest, failedAudit, child, handoff, verification, reconciledAt }) {
  const prior = manifest.modules.sales;
  requireProof(plan.runId === incident.runId && prior?.status === "failed" && !prior.batchId && !prior.outputPath
    && failedAudit.error?.message === incident.error && failedAudit.timings?.failedAt === incident.failedAt
    && failedAudit.error?.stage === "sales_filter_cost_match_import_verify"
    && child.ok === false && child.import === null && child.postImportVerification === null
    && child.failure?.code === "IMPORT_FAILED" && child.failure.stage === "chunk_upload_and_import"
    && child.output?.sha256 === incident.outputSha && child.output.bytes === incident.outputBytes
    && child.filtering?.retainedRows === incident.salesRows
    && child.sources?.rawDownload?.sha256 === prior.sourceSha256
    && child.sources?.costSource?.sha256 === manifest.modules.inventory.salesCostSourceSha256
    && child.sourceCountContract?.verified === true
    && child.sourceCountContract.semantic === salesSourceRowCountSemantic
    && child.sourceCountContract.expected === handoff.expectedSourceRows
    && child.sourceCountContract.actual === handoff.expectedSourceRows
    && child.period?.startDate === incident.start && child.period.endDate === incident.end,
  "原销售解析、失败审计或文件绑定不完整。");
  assertSalesPostImportVerification({ responseOk: true, expectedPolicyVersion: child.policyVersion,
    period: child.period, expectedBatch: verification.batch, expectedRowCount: incident.salesRows, verification });
  requireProof(verification.batch.id === incident.salesBatch
    && verification.batch.totals.rawFileHash === incident.outputSha
    && verification.batch.totals.systemCost?.sourceBatchId === incident.inventoryBatch,
  "销售回查未绑定本轮文件、库存与批次。");
  const handoffEvidence = { navigationIntentAt: handoff.navigationIntentAt, queryIntentAt: handoff.queryIntentAt,
    tableStableAt: handoff.tableStableAt, exportIntentAt: handoff.exportIntentAt, downloadEventAt: handoff.downloadEventAt };
  const contract = { runId: plan.runId, policyVersion: plan.protocol, module: "sales", rawSha256: prior.sourceSha256,
    asOfDate: plan.asOfDate, salesStartDate: plan.salesStartDate, expectedSourceRows: handoff.expectedSourceRows,
    costOutputSha256: manifest.modules.inventory.salesCostSourceSha256,
    costSourcePath: manifest.modules.inventory.salesCostSourcePath, exportStart: handoff.exportIntentAt,
    downloadEventAt: handoff.downloadProvenance.completedAt, downloadProvenance: handoff.downloadProvenance,
    handoffEvidence, baseUrl: plan.baseUrl };
  requireProof(createJackyunInputContractHash(contract) === prior.inputContractHash, "原销售输入契约无法重建。");
  const recovery = { reason, reconciledAt, failedExecutionId: incident.executionId, originalFailedAt: incident.failedAt,
    source: "committed_batch_readback", originalFailurePreserved: true };
  const childWithoutFailure = { ...child }; delete childWithoutFailure.failure;
  const childAudit = { ...childWithoutFailure, ok: true, recovery,
    import: { ok: true, status: "reconciled_completed", batch: verification.batch, recoveredReceipt: true },
    postImportVerification: { ...verification, verified: true, verifiedAt: reconciledAt } };
  const parentAudit = { version: 1, runId: plan.runId, module: "sales", status: "completed", recovery,
    timings: { ...failedAudit.timings, completedAt: reconciledAt, originalRequestFailed: true },
    source: { ...failedAudit.source, copiedPath: child.sources.rawDownload.path,
      fileName: path.basename(handoff.filePath), bytes: handoff.downloadProvenance.bytes,
      expectedSourceRows: handoff.expectedSourceRows, inputContractHash: prior.inputContractHash,
      inputContract: contract, handoffEvidence, downloadEventAt: handoff.downloadEventAt },
    validation: child.validation, sourceCountContract: child.sourceCountContract, preprocessing: child.filtering,
    safetyChecks: { comboRelationBaseline: null }, output: child.output,
    import: { result: { status: "verified_completed", salesRunId: child.runId, salesPolicyVersion: child.policyVersion,
      postImportVerified: true, salesPeriod: { startDate: incident.start, endDate: incident.end } },
    batch: verification.batch } };
  const priorWithoutError = { ...prior }; delete priorWithoutError.error;
  const recoveredModule = { ...priorWithoutError, status: "completed", batchId: incident.salesBatch,
    outputPath: child.output.path, outputSha256: child.output.sha256, completedAt: reconciledAt, recovery };
  return { parentAudit, childAudit, module: recoveredModule };
}

export async function inspectRecovery(root, proof, deps = {}) {
  root = path.resolve(root);
  const p = names(root), request = deps.request ?? fetch, observedAt = deps.now?.() ?? new Date().toISOString();
  const createdAt = deps.createdAt ?? observedAt;
  assertUploadProof(proof, observedAt);
  requireProof(jackyunCaptureDate(createdAt) === incident.date && jackyunCaptureDate(observedAt) === incident.date, "7792 恢复禁止跨日。");
  await assertIdle(request);
  const evidence = (deps.evidence ?? (() => readN8nPreflightEvidence(path.join(homedir(), ".n8n/database.sqlite"), incident.executionId)))();
  assertEvidence(evidence);
  const files = {};
  const remember = async file => { const raw = await bytes(file); files[file] = sha(raw); return raw; };
  const plan = parse(await remember(p.plan)), active = parse(await remember(p.active));
  const policy = parse(await remember(p.policy)), manifest = parse(await remember(p.manifest));
  requireProof(plan.version === 2 && plan.protocol === jackyunExportFirstPolicyVersion && policy.version === plan.protocol
    && plan.exportTransport === "session_api_v1" && plan.executionId === incident.executionId
    && plan.runId === incident.runId && plan.phase === "importing" && !Object.hasOwn(plan, "exportIntent")
    && plan.runDate === incident.date && plan.asOfDate === incident.end && plan.salesStartDate === incident.start
    && plan.baseUrl === incident.baseUrl && active.runId === plan.runId && active.executionId === plan.executionId
    && isDeepStrictEqual(Object.keys(plan.exports).sort(), [...jackyunModuleOrder].sort())
    && !manifest.modules.combos && manifest.modules.inventory?.batchId === incident.inventoryBatch,
  "原7792计划、模式、日期或已导入前缀发生变化。");
  const absent = [p.registry, path.join(p.formal, "audit/combos.json"), p.recovery];
  for (const file of absent) await absence(file);
  await (deps.verifyPrepared ?? verifyJackyunPreparedImports)(root, plan, policy);
  const tree = async directory => {
    await assertPlainPath(directory);
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, item.name);
      requireProof(!item.isSymbolicLink(), "恢复归档包含链接。");
      if (item.isDirectory()) await tree(file); else await remember(file);
      requireProof(Object.keys(files).length <= 120, "恢复文件集合异常。");
    }
  };
  await tree(p.formal); await tree(p.validation); await tree(p.events);
  const prefix = [];
  for (const moduleKey of jackyunModuleOrder) {
    const eventPath = path.join(p.events, handoffName(moduleKey)), handoff = parse(await remember(eventPath));
    const raw = await remember(handoff.filePath), receipt = plan.exports[moduleKey];
    requireProof(sha(await bytes(eventPath)) === receipt.handoffSha256 && sha(raw) === receipt.fileSha256
      && raw.length === receipt.bytes, "五表原始下载或交接摘要变化。");
    if (!["products", "inventory", "inventory_age"].includes(moduleKey)) continue;
    const verified = await (deps.verifyArtifact ?? verifyJackyunModuleArtifact)({ runDirectory: p.formal, runId: plan.runId, module: moduleKey,
      snapshotDate: plan.runDate, policyVersion: plan.protocol, allowedDownloadHosts: policy.browser.allowedDownloadHosts,
      manifestModule: manifest.modules[moduleKey], handoffPath: eventPath, requireAtomicHandoff: true });
    const audit = parse(await bytes(path.join(p.formal, "audit", moduleKey + ".json")));
    const q = new URLSearchParams({ batchId: verified.batchId });
    if (moduleKey !== "inventory") q.set("source", moduleKey);
    const data = await jsonGet(`${incident.baseUrl}/api/imports/${moduleKey === "inventory" ? "inventory" : "erp"}?${q}`, request);
    const batch = data.items?.find(item => item.id === verified.batchId), r = audit.import.result.djangoReceipt;
    requireProof(batch?.status === "completed" && batch.rowCount === verified.rowCount
      && batch.ownedRowCount === batch.rowCount - (batch.excludedCount ?? 0)
      && batch.totals?.contentHash === r.contentHash && batch.totals?.rawFileHash === r.rawFileHash
      && (moduleKey !== "inventory" || batch.isCurrent === true), "已成功前缀批次未通过独立回查。");
    prefix.push({ module: moduleKey, batchId: verified.batchId, rowCount: verified.rowCount, contentHash: r.contentHash, rawFileHash: r.rawFileHash });
  }
  const child = parse(await bytes(p.childAudit));
  requireProof(path.dirname(child.output.path) === path.dirname(p.childAudit)
    && sha(await bytes(child.output.path)) === incident.outputSha
    && sha(await bytes(child.sources.rawDownload.path)) === manifest.modules.sales.sourceSha256,
  "本轮销售处理文件或归档源不匹配。");
  const verification = await jsonGet(incident.baseUrl + "/api/imports/sales/verify?" + new URLSearchParams({
    startDate: incident.start, endDate: incident.end, batchId: incident.salesBatch }), request);
  buildSalesReceipt({ plan, manifest, child, failedAudit: parse(await bytes(p.parentAudit)),
    handoff: parse(await bytes(path.join(p.events, handoffName("sales")))), verification, reconciledAt: createdAt });
  await remember(path.join(root, "config/sales-import-policy.json"));
  return { version: 1, reason, root, createdAt,
    implementationSha256: sha(await readFile(fileURLToPath(import.meta.url))), evidence, files, absent, prefix,
    uploadProof: stableUploadProof(proof), sourceState: await sourceState(request) };
}

async function verifyAll(p, plan, policy, request, deps) {
  const manifest = parse(await bytes(p.manifest)), modules = [];
  for (const moduleKey of jackyunModuleOrder) {
    const verified = await (deps.verifyArtifact ?? verifyJackyunModuleArtifact)({ runDirectory: p.formal, runId: plan.runId, module: moduleKey,
      snapshotDate: moduleKey === "sales" ? plan.asOfDate : plan.runDate,
      salesStartDate: moduleKey === "sales" ? plan.salesStartDate : undefined,
      policyVersion: plan.protocol, allowedDownloadHosts: policy.browser.allowedDownloadHosts,
      manifestModule: manifest.modules[moduleKey], handoffPath: path.join(p.events, handoffName(moduleKey)), requireAtomicHandoff: true });
    const audit = parse(await bytes(path.join(p.formal, "audit", moduleKey + ".json")));
    modules.push({ module: moduleKey, status: "completed", batchId: verified.batchId, rowCount: verified.rowCount,
      warningCount: verified.warningCount, outputSha256: manifest.modules[moduleKey].outputSha256,
      djangoReceipt: audit.import.result.djangoReceipt });
  }
  return (deps.verifyPublished ?? verifyPublishedJackyunBatches)({ baseUrl: plan.baseUrl, snapshotDate: plan.runDate,
    asOfDate: plan.asOfDate, salesStartDate: plan.salesStartDate, modules, request });
}

async function verifyFrozenFiles(approved, excluded = new Set()) {
  for (const [file, expected] of Object.entries(approved.files ?? {})) {
    if (!excluded.has(file)) requireProof(sha(await bytes(file)) === expected, "恢复写入前原始文件发生变化。");
  }
}

export async function applyRecovery(approved, approvedSha, proof, deps = {}) {
  const request = deps.request ?? fetch;
  const clock = () => deps.now?.() ?? new Date().toISOString();
  const now = clock();
  requireProof(approved?.version === 1 && approved.reason === reason && approvedSha === sha(JSON.stringify(approved))
    && Date.parse(now) >= Date.parse(approved.createdAt) && Date.parse(now) - Date.parse(approved.createdAt) <= 30 * 60000,
  "7792恢复方案摘要或时效无效。");
  const current = await (deps.inspect ?? inspectRecovery)(approved.root, proof, { ...deps, createdAt: approved.createdAt });
  requireProof(isDeepStrictEqual(current, approved), "7792原始证据或来源版本发生变化。");
  const p = names(approved.root);
  await assertPlainPath(path.dirname(p.recovery), true);
  await mkdir(p.recovery, { recursive: true });
  await writeFile(path.join(p.recovery, "attempt.json"), JSON.stringify({ reason, approvedSha, startedAt: now }) + "\n", { flag: "wx" });
  for (const [name, file] of [["plan.json", p.plan], ["manifest.json", p.manifest], ["sales.failed.json", p.parentAudit], ["sales-child.failed.json", p.childAudit]]) {
    await writeFile(path.join(p.recovery, name), await bytes(file), { flag: "wx" });
  }
  await writeFile(path.join(p.recovery, "proposal.json"), JSON.stringify(approved, null, 2) + "\n", { flag: "wx" });
  await verifyFrozenFiles(approved);
  // No automatic repeat: a timeout keeps attempt.json and requires a fresh
  // readback. The original known upload cannot create a new staged session:
  // its completed normalized fingerprint has been independently proved.
  if (proof.status !== "completed") {
    const response = await request(incident.baseUrl + "/api/imports/sales/chunks", {
      method: "POST", headers: { "content-type": "application/json", origin: incident.baseUrl },
      body: JSON.stringify({ action: "complete", uploadId: incident.uploadId,
        expectedStartDate: incident.start, expectedEndDate: incident.end }), signal: AbortSignal.timeout(180000),
    });
    const data = await response.json();
    requireProof(response.ok && data.ok === true && data.batch?.id === incident.salesBatch
      && data.batch.status === "completed" && data.batch.totals?.rawFileHash === incident.outputSha,
    "销售完成回执未返回精确原批次；已保留恢复尝试，禁止自动重放。");
  }
  const plan = parse(await bytes(p.plan)), manifest = parse(await bytes(p.manifest)), policy = parse(await bytes(p.policy));
  const child = parse(await bytes(p.childAudit));
  const verification = await jsonGet(incident.baseUrl + "/api/imports/sales/verify?" + new URLSearchParams({
    startDate: incident.start, endDate: incident.end, batchId: incident.salesBatch }), request);
  requireProof(isDeepStrictEqual(await sourceState(request), approved.sourceState), "销售或组合装版本在收尾期间变化。");
  const recovered = buildSalesReceipt({ plan, manifest, child, failedAudit: parse(await bytes(p.parentAudit)),
    handoff: parse(await bytes(path.join(p.events, handoffName("sales")))), verification, reconciledAt: clock() });
  await writeJsonAtomic(p.childAudit, recovered.childAudit);
  await writeJsonAtomic(p.parentAudit, recovered.parentAudit);
  manifest.modules.sales = recovered.module; manifest.updatedAt = clock();
  await writeJsonAtomic(p.manifest, manifest);
  await writeFile(p.registry, JSON.stringify({ runs: [{ rawSha256: child.sources.rawDownload.sha256,
    status: "verified_completed", runId: child.runId, periodStart: incident.start, periodEnd: incident.end,
    auditPath: p.childAudit, processedSha256: incident.outputSha, recovery: reason }] }, null, 2) + "\n", { flag: "wx" });
  await (deps.verifyArtifact ?? verifyJackyunModuleArtifact)({ runDirectory: p.formal, runId: plan.runId, module: "sales",
    snapshotDate: plan.asOfDate, salesStartDate: plan.salesStartDate, policyVersion: plan.protocol,
    manifestModule: recovered.module, handoffPath: path.join(p.events, handoffName("sales")), requireAtomicHandoff: true,
    allowedDownloadHosts: policy.browser.allowedDownloadHosts });
  await assertIdle(request);
  await verifyFrozenFiles(approved, new Set([p.manifest, p.parentAudit, p.childAudit]));
  requireProof(jackyunCaptureDate(clock()) === incident.date && Date.parse(clock()) - Date.parse(approved.createdAt) <= 30 * 60000,
    "组合装提交前恢复期限已到，保留销售回执并停止。");
  const handoff = parse(await bytes(path.join(p.events, handoffName("combos"))));
  await writeFile(path.join(p.recovery, "combos-started.json"), JSON.stringify({ startedAt: clock(), sourceSha256: plan.exports.combos.fileSha256 }) + "\n", { flag: "wx" });
  await (deps.runCombo ?? runJackyunDownload)({ module: "combos", filePath: handoff.filePath,
    runId: plan.runId, policyVersion: plan.protocol, exportStart: handoff.exportIntentAt,
    expectedSourceRows: handoff.expectedSourceRows, baseUrl: plan.baseUrl,
    outputRoot: path.join(p.root, "outputs/jackyun-import-runs"), downloadDirectory: policy.browser.downloadDirectory,
    downloadProvenance: handoff.downloadProvenance, allowedDownloadHosts: policy.browser.allowedDownloadHosts,
    handoffEvidence: { navigationIntentAt: handoff.navigationIntentAt, queryIntentAt: handoff.queryIntentAt,
      tableStableAt: handoff.tableStableAt, exportIntentAt: handoff.exportIntentAt, downloadEventAt: handoff.downloadEventAt }, dryRun: false });
  const verified = await verifyAll(p, plan, policy, request, deps);
  const evidence = (deps.evidence ?? (() => readN8nPreflightEvidence(path.join(homedir(), ".n8n/database.sqlite"), incident.executionId)))();
  assertEvidence(evidence);
  const result = { status: "business_recovered", reason, originalExecutionId: incident.executionId,
    originalN8nStatus: "error", completedAt: clock(), results: verified.modules };
  await writeFile(path.join(p.recovery, "completed.json"), JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
  await writeJsonAtomic(p.plan, { ...plan, phase: "completed", completedAt: result.completedAt });
  return result;
}

async function main() {
  const [action, root, proofFile, proposalFile, expectedSha] = process.argv.slice(2);
  requireProof(["plan", "apply"].includes(action) && root && path.resolve(root).toLowerCase() === "d:\\运营管理系统".toLowerCase()
    && proofFile && proposalFile && (action === "plan" ? !expectedSha : /^[a-f0-9]{64}$/.test(expectedSha)), "仅支持已授权7792的plan/apply。");
  const proof = parse(await bytes(proofFile));
  await withJackyunRunLock({ runId: incident.runId, purpose: "audited_7792_receipt_recovery",
    lockDirectory: path.join(root, ".runtime/jackyun-automation.lock") }, async () => {
    if (action === "plan") {
      const proposal = await inspectRecovery(root, proof), approvedSha256 = sha(JSON.stringify(proposal));
      await writeFile(proposalFile, JSON.stringify({ proposal, approvedSha256 }, null, 2) + "\n", { flag: "wx" });
      console.log(JSON.stringify({ status: "ready_for_recovery", proposalFile, approvedSha256 }));
    } else {
      const { proposal } = parse(await bytes(proposalFile));
      console.log(JSON.stringify(await applyRecovery(proposal, expectedSha, proof)));
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error instanceof Error ? error.message : "7792恢复失败"); process.exitCode = 1; });
}
