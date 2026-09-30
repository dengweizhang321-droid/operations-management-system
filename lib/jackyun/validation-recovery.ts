import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { readN8nReplacementEvidence } from "./n8n-preflight-evidence";
import { type PreflightEvidence } from "./preflight-recovery";

const failedId = "5399";
const runId = `n8n-export-first-${failedId}`;
const moduleOrder = ["products", "inventory", "inventory_age", "sales", "combos"] as const;
const expectedNodes = ["手动运行", "固定原执行计划时间", "领取共享 helper", "helper 领取成功？",
  "A·固定采集日和销售日期", "B·接口校验与五表下载", "C·五表完整校验和导入演练"];
const expectedAudit = "D:\\运营管理系统\\outputs\\jackyun-export-first-validation\\n8n-export-first-5399\\sales\\2026-08-16_2026-09-29_20260929213803\\audit.json";
const expectedError = `导入前自动校验未通过：${expectedAudit}`;
const sha = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");

export type ValidationRecoveryProposal = {
  version: 1; reason: "audited_5399_sales_cost_validation_before_import";
  root: string; createdAt: string; evidence: PreflightEvidence;
  planSha256: string; activeSha256: string; policySha256: string;
  fileHashes: Record<string, string>; fileCount: number; totalBytes: number;
};

function paths(root: string) {
  const base = path.join(root, "outputs", "jackyun-export-first");
  return { base, plan: path.join(base, `${runId}.json`), active: path.join(base, "active.json"),
    policy: path.join(root, "config", "jackyun-export-first-policy.json"),
    events: path.join(root, "outputs", "jackyun-browser-events", runId),
    validation: path.join(root, "outputs", "jackyun-export-first-validation", runId),
    formal: path.join(root, "outputs", "jackyun-import-runs", runId),
    permit: path.join(base, "validation-recovery-permits", `${runId}.json`),
    claim: path.join(base, "validation-recovery-claims", `${runId}.json`) };
}

async function regular(file: string, max = 512 * 1024 * 1024): Promise<Buffer> {
  let cursor = path.resolve(file);
  while (true) {
    const info = await lstat(cursor);
    if (info.isSymbolicLink() || (!info.isDirectory() && (!info.isFile() || info.nlink !== 1))) throw new Error("恢复证据路径身份异常。");
    const parent = path.dirname(cursor); if (parent === cursor) break; cursor = parent;
  }
  const info = await lstat(file);
  if (!info.isFile() || info.nlink !== 1 || info.size > max) throw new Error("恢复证据文件无效或超限。");
  return readFile(file);
}

function assertEvidence(e: PreflightEvidence, createdAt: string) {
  if (e.executionId !== failedId || e.workflowId !== "J8kY2mQ5vR7sT4pN" || e.status !== "error"
    || e.startedAt !== "2026-09-29T21:36:10.162Z" || e.stoppedAt !== "2026-09-29T21:38:09.003Z"
    || e.retrySuccessId !== null || e.lastNode !== expectedNodes.at(-1)
    || !isDeepStrictEqual(e.runNodes, expectedNodes) || e.error !== expectedError
    || e.httpCode !== "500" || e.requestUrl !== "http://127.0.0.1:5791/jackyun/export-first/validate"
    || e.executionDataSha256 !== "fbb3d3faf3004178a6481e471d2a01c2919d67958c142dde1a9aad84ea2569f4"
    || e.activeExecutions !== 0 || !Number.isFinite(Date.parse(createdAt))
    || Date.parse(createdAt) < Date.parse(e.stoppedAt)) throw new Error("不是 5399 的精确五表校验失败。");
}

export async function inspectValidationRecovery(root: string, evidence: PreflightEvidence, createdAt: string): Promise<ValidationRecoveryProposal> {
  assertEvidence(evidence, createdAt);
  root = path.resolve(root);
  const p = paths(root), fileHashes: Record<string, string> = {};
  let totalBytes = 0;
  const read = async (file: string) => {
    const bytes = await regular(file); totalBytes += bytes.length;
    if (totalBytes > 256 * 1024 * 1024 || Object.keys(fileHashes).length >= 64) throw new Error("恢复证据总量超限。");
    fileHashes[file] = sha(bytes); return bytes;
  };
  const parse = async <T>(file: string) => JSON.parse((await read(file)).toString("utf8")) as T;
  const plan = await parse<{ version: number; executionId: string; runId: string; phase: string; exportTransport: string;
    protocol: string; runDate: string; asOfDate: string; salesStartDate: string; baseUrl: string;
    exportIntent?: string; completedAt?: string; exports: Record<string, { fileSha256: string; bytes: number }> }>(p.plan);
  const active = await parse<{ runId: string; executionId: string }>(p.active);
  const policy = await parse<{ version: string; browser: { downloadDirectory: string } }>(p.policy);
  if (plan.version !== 2 || plan.executionId !== failedId || plan.runId !== runId || plan.phase !== "validating"
    || plan.exportTransport !== "session_api_v1" || plan.protocol !== "2026-09-06.export-first.1"
    || plan.runDate !== "2026-09-30" || plan.asOfDate !== "2026-09-29" || plan.salesStartDate !== "2026-08-16"
    || plan.baseUrl !== "http://localhost:3000" || plan.exportIntent || plan.completedAt
    || !isDeepStrictEqual(Object.keys(plan.exports ?? {}).sort(), [...moduleOrder].sort())
    || !isDeepStrictEqual(active, { runId, executionId: failedId }) || policy.version !== plan.protocol
    || !path.isAbsolute(policy.browser?.downloadDirectory)) throw new Error("5399 原计划、活动身份或策略已变化。");
  const downloads = path.resolve(policy.browser.downloadDirectory, "jackyun", runId);
  if (!isDeepStrictEqual((await readdir(p.events)).sort(), moduleOrder.map((module, index) => `${String(index + 1).padStart(2, "0")}-${module}.json`).sort())
    || !isDeepStrictEqual((await readdir(downloads)).sort(), [...moduleOrder].sort())
    || !isDeepStrictEqual(await readdir(p.formal), ["api-controller-state.json"])) throw new Error("5399 导出或正式导入目录结构已变化。");
  await read(path.join(p.formal, "api-controller-state.json"));
  for (const [index, module] of moduleOrder.entries()) {
    const event = await parse<{ schemaVersion: number; runId: string; module: string; policyVersion: string;
      expectedSourceRows: number; filePath: string }>(path.join(p.events, `${String(index + 1).padStart(2, "0")}-${module}.json`));
    const receipt = plan.exports[module];
    if (event.schemaVersion !== 2 || event.runId !== runId || event.module !== module
      || event.policyVersion !== plan.protocol || !Number.isSafeInteger(event.expectedSourceRows)
      || event.expectedSourceRows <= 0 || typeof event.filePath !== "string"
      || path.dirname(path.resolve(event.filePath)) !== path.join(downloads, module)
      || !/^[a-f0-9]{64}$/.test(receipt?.fileSha256 ?? "")
      || !Number.isSafeInteger(receipt?.bytes) || receipt.bytes <= 0) throw new Error("5399 五表交接身份不匹配。");
    const names = await readdir(path.join(downloads, module));
    if (!isDeepStrictEqual(names, [path.basename(event.filePath)])) throw new Error("5399 下载目录出现额外文件。");
    const bytes = await read(event.filePath);
    if (bytes.length !== receipt.bytes || sha(bytes) !== receipt.fileSha256) throw new Error("5399 下载文件摘要变化。");
  }
  const manifest = await parse<{ version: number; runId: string; strictOrder: string[];
    modules: Record<string, { status: string; batchId?: string; outputPath?: string; outputSha256?: string }> }>(path.join(p.validation, "run-manifest.json"));
  if (manifest.version !== 1 || manifest.runId !== runId || !isDeepStrictEqual(manifest.strictOrder, moduleOrder)
    || !isDeepStrictEqual(Object.keys(manifest.modules ?? {}), moduleOrder.slice(0, 4))
    || moduleOrder.slice(0, 3).some(module => manifest.modules[module]?.status !== "prepared")
    || manifest.modules.sales?.status !== "failed" || manifest.modules.sales.batchId
    || !isDeepStrictEqual((await readdir(p.validation)).sort(), ["audit", "processed", "raw", "run-manifest.json", "sales"].sort())) {
    throw new Error("5399 演练状态不是销售校验失败前缀。");
  }
  const failed = await parse<{ ok: boolean; period: { startDate: string; endDate: string }; validation: {
    unmatchedCosts: { count: number; samples: Array<{ code: string; rows: number[] }> };
    costConflicts: { count: number }; numericProblems: { count: number }; dateProblems: { count: number };
    excludedOutOfPeriodRows: { count: number }; excludedTodayRows: { count: number };
  } }>(path.join(p.validation, "sales", "2026-08-16_2026-09-29_20260929213803", "audit.json"));
  if (failed.ok !== false || failed.period?.startDate !== "2026-08-16" || failed.period?.endDate !== "2026-09-29"
    || failed.validation?.unmatchedCosts?.count !== 1
    || failed.validation.unmatchedCosts.samples?.[0]?.code !== "ZG-WB-YSFLQ-006"
    || !isDeepStrictEqual(failed.validation.unmatchedCosts.samples[0].rows, [3547])
    || failed.validation.costConflicts?.count !== 0 || failed.validation.numericProblems?.count !== 0
    || failed.validation.dateProblems?.count !== 0 || failed.validation.excludedOutOfPeriodRows?.count !== 0
    || failed.validation.excludedTodayRows?.count !== 0) throw new Error("5399 销售校验失败原因已变化。");
  const audit = await parse<{ status: string; module: string; runId: string;
    error: { stage: string; message: string }; import?: unknown }>(path.join(p.validation, "audit", "sales.json"));
  if (audit.status !== "failed" || audit.module !== "sales" || audit.runId !== runId
    || audit.error?.stage !== "sales_filter_cost_match_import_verify" || audit.error?.message !== expectedError
    || audit.import || manifest.modules.sales.outputPath || manifest.modules.sales.outputSha256) throw new Error("5399 校验审计出现正式导入或其他失败。");
  const walk = async (dir: string): Promise<void> => {
    for (const name of (await readdir(dir)).sort()) {
      const file = path.join(dir, name), info = await lstat(file);
      if (info.isSymbolicLink()) throw new Error("恢复证据目录含链接。");
      if (info.isDirectory()) await walk(file);
      else if (!(file in fileHashes)) await read(file);
    }
  };
  await walk(p.validation);
  return { version: 1, reason: "audited_5399_sales_cost_validation_before_import", root, createdAt, evidence,
    planSha256: fileHashes[p.plan], activeSha256: fileHashes[p.active], policySha256: fileHashes[p.policy],
    fileHashes, fileCount: Object.keys(fileHashes).length, totalBytes };
}

export async function publishValidationRecovery(proposal: ValidationRecoveryProposal, evidence: PreflightEvidence, approvedSha256: string) {
  if (sha(JSON.stringify(proposal)) !== approvedSha256
    || !isDeepStrictEqual(await inspectValidationRecovery(proposal.root, evidence, proposal.createdAt), proposal)) {
    throw new Error("5399 恢复计划或证据已变化。");
  }
  const p = paths(proposal.root);
  await mkdir(path.dirname(p.permit), { recursive: true });
  await writeFile(p.permit, JSON.stringify(proposal) + "\n", { flag: "wx" });
  return { status: "permitted", permitSha256: sha(await regular(p.permit)) };
}

export async function claimValidationRecovery(root: string, previousId: string, replacementId: string, action: string, now: string) {
  if (previousId !== failedId || action !== "plan-api" || !/^[1-9]\d{0,19}$/.test(replacementId)
    || BigInt(replacementId) <= BigInt(failedId)) throw new Error("5399 恢复必须来自新的完整 API 计划入口。");
  root = path.resolve(root);
  const p = paths(root), raw = await regular(p.permit, 1024 * 1024);
  const proposal = JSON.parse(raw.toString("utf8")) as ValidationRecoveryProposal;
  if (proposal.version !== 1 || proposal.root !== root || proposal.reason !== "audited_5399_sales_cost_validation_before_import"
    || !Number.isFinite(Date.parse(now)) || Date.parse(now) < Date.parse(proposal.createdAt)
    || Date.parse(now) - Date.parse(proposal.createdAt) > 12 * 60 * 60_000
    || !isDeepStrictEqual(await inspectValidationRecovery(root, proposal.evidence, proposal.createdAt), proposal)) {
    throw new Error("5399 恢复许可已失效或原始证据变化。");
  }
  const context = readN8nReplacementEvidence(previousId, replacementId);
  if (!isDeepStrictEqual(context.evidence, proposal.evidence) || context.replacement.mode !== "manual"
    || Date.parse(context.replacement.startedAt) < Date.parse(proposal.createdAt)) throw new Error("5399 只允许新的完整手动执行领取许可。");
  const binding = { version: 1, reason: proposal.reason, originalExecutionId: previousId,
    executionId: replacementId, permitSha256: sha(raw) };
  let existing: Buffer | null = null;
  try { existing = await regular(p.claim, 1024 * 1024); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (existing) {
    if (!isDeepStrictEqual(JSON.parse(existing.toString("utf8")), binding)) throw new Error("5399 恢复许可已被其他执行领取。");
  } else {
    await mkdir(path.dirname(p.claim), { recursive: true });
    await writeFile(p.claim, JSON.stringify(binding) + "\n", { flag: "wx" });
  }
  return binding;
}
