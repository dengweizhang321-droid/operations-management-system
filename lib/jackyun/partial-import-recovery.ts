import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { recoverySha, jackyunWorkflowId, type PreflightEvidence } from "./preflight-recovery";
import { jackyunModuleOrder, type JackyunModule } from "./post-download";
import { jackyunCaptureDate, jackyunExportFirstPolicyVersion } from "./run-contract";
import { verifyJackyunModuleArtifact, type JackyunArtifactManifestModule } from "./run-artifact-verification";
import type { readN8nReplacementEvidence } from "./n8n-preflight-evidence";
import type { ImportRecoveryBinding } from "./import-recovery";

// This exception is import-only. It never authorizes recapturing an old day,
// retrying an uncertain POST, or taking over a different partial execution.
export const auditedPartialImport5478 = {
  executionId: "5478", runId: "n8n-export-first-5478",
  startedAt: "2026-10-02T16:10:00.054Z", stoppedAt: "2026-10-02T16:12:41.707Z",
  executionDataSha256: "a2ce33708cf35b0f7f99bde0be8ccecd00920be7b7d2c4105ff5f2e4e26edc99",
  error: "Django 销售服务暂时不可用，请稍后重试。",
  failedAt: "2026-10-02T16:12:41.543Z", salesStartedAt: "2026-10-02T16:12:33.396Z",
  runDate: "2026-10-03", startDate: "2026-08-19", endDate: "2026-10-02",
} as const;
const a = auditedPartialImport5478;
const reason = "audited_5478_sales_read_before_import" as const;
const prefix = jackyunModuleOrder.slice(0, 3);
const nodes = ["每天本机时间 00:10", "固定原执行计划时间", "领取共享 helper", "helper 领取成功？",
  "A·固定采集日和销售日期", "B·接口校验与五表下载", "C·五表完整校验和导入演练", "D·统一导入运营管理系统"];
type Module = JackyunArtifactManifestModule & { startedAt?: string; completedAt?: string; error?: string };
type Manifest = { version: number; runId: string; strictOrder: string[]; modules: Record<JackyunModule, Module> };
type SourceState = { salesRevision: string; latestSalesBatchId: string | null; comboBatchId: string };
const originalSourceState: SourceState = {
  salesRevision: "43:42",
  latestSalesBatchId: "64e88e720339d623a22a3c5dc69c1fb5519431afec54ffb047e2cb1de3a70657",
  comboBatchId: "combos:544a352d7fb3c44496a195ea198bc38541fb0602b93cdcdd8f8853227ade4d54",
};
type PrefixBatch = { module: JackyunModule; batchId: string; rowCount: number; warningCount: number };
export type PartialImportRecoveryProposal = {
  version: 1; reason: typeof reason; root: string; createdAt: string; evidence: PreflightEvidence;
  files: Record<string, string>; prefixBatches: PrefixBatch[]; sourceState: SourceState;
  failedModuleSha256: string; failedAuditSha256: string;
};
export type PartialImportRecoveryBinding = ImportRecoveryBinding & { reason: typeof reason };
export type PartialImportRecoveryDependencies = {
  request?: typeof fetch;
  verifyArtifact?: typeof verifyJackyunModuleArtifact;
  replacementEvidence?: typeof readN8nReplacementEvidence;
};
type Dependencies = PartialImportRecoveryDependencies;
export const isPartialImportRecovery = (b: ImportRecoveryBinding): b is PartialImportRecoveryBinding =>
  "reason" in b && b.reason === reason;

function names(root: string) {
  const base = path.join(root, "outputs/jackyun-export-first");
  return { plan: path.join(base, a.runId + ".json"), active: path.join(base, "active.json"),
    policy: path.join(root, "config/jackyun-export-first-policy.json"),
    formal: path.join(root, "outputs/jackyun-import-runs", a.runId),
    validation: path.join(root, "outputs/jackyun-export-first-validation", a.runId),
    events: path.join(root, "outputs/jackyun-browser-events", a.runId),
    permit: path.join(base, "partial-import-permits", a.executionId + ".json"),
    claim: path.join(base, "partial-import-claims", a.executionId + ".json"),
    archive: path.join(base, "partial-import-originals", a.executionId) };
}
async function bytes(file: string, max = 512 * 1024 * 1024): Promise<Buffer> {
  let current = path.resolve(file);
  while (true) {
    const info = await lstat(current);
    if (info.isSymbolicLink() || (!info.isDirectory() && (!info.isFile() || info.nlink !== 1))) throw Error("5478 恢复路径身份异常。");
    const parent = path.dirname(current); if (parent === current) break; current = parent;
  }
  const info = await lstat(file);
  if (!info.isFile() || info.size > max) throw Error("5478 恢复证据超限。");
  return readFile(file);
}
const read = async <T>(file: string): Promise<T> => JSON.parse((await bytes(file, 2 * 1024 * 1024)).toString("utf8")) as T;
async function create(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value) + "\n", { flag: "wx" });
}
export function assertPartialImportEvidence(e: PreflightEvidence, now: string) {
  if (e.executionId !== a.executionId || e.workflowId !== jackyunWorkflowId || e.status !== "error"
    || e.startedAt !== a.startedAt || e.stoppedAt !== a.stoppedAt || e.executionDataSha256 !== a.executionDataSha256
    || e.error !== a.error || e.httpCode !== "500" || e.lastNode !== nodes.at(-1) || !isDeepStrictEqual(e.runNodes, nodes)
    || e.requestUrl !== "http://127.0.0.1:5791/jackyun/export-first/import" || e.retrySuccessId !== null || e.activeExecutions !== 0
    || !Number.isFinite(Date.parse(now)) || Date.parse(now) < Date.parse(e.stoppedAt)) throw Error("不是 5478 的精确导入前销售读取失败。");
}
async function jsonGet(url: string, deps: Dependencies) {
  const response = await (deps.request ?? fetch)(url, { cache: "no-store", signal: AbortSignal.timeout(30000) });
  const body = await response.json() as Record<string, unknown>;
  if (!response.ok || !body || typeof body !== "object") throw Error("5478 权威只读回查不可用。");
  return body;
}
async function sourceState(deps: Dependencies): Promise<SourceState> {
  const health = await jsonGet("http://localhost:3000/api/sales/data-health", deps);
  const combos = await jsonGet("http://localhost:3000/api/imports/erp?source=combos&limit=1", deps);
  const latestSales = health.latestBatch as { id?: string } | null;
  const items = combos.items as Array<{ id: string; status: string }>;
  if (typeof health.revision !== "string" || !health.revision || !Array.isArray(items) || items.length !== 1
    || typeof items[0].id !== "string" || items[0].status !== "completed"
    || (latestSales !== null && typeof latestSales?.id !== "string")) throw Error("5478 当前销售或组合装版本不明确。");
  return { salesRevision: health.revision, latestSalesBatchId: latestSales?.id ?? null, comboBatchId: items[0].id };
}

// Shared by planning and the final import gate: successful prefixes are checked
// against their own archived receipts and actual currently owned facts.
export async function verifyPartialImportPrefix(root: string, deps: Dependencies = {}): Promise<PrefixBatch[]> {
  const p = names(root), manifest = await read<Manifest>(path.join(p.formal, "run-manifest.json"));
  const policy = await read<{ browser: { allowedDownloadHosts: string[] } }>(p.policy);
  const result: PrefixBatch[] = [];
  for (const moduleKey of prefix) {
    const verified = await (deps.verifyArtifact ?? verifyJackyunModuleArtifact)({
      runDirectory: p.formal, runId: a.runId, module: moduleKey, snapshotDate: a.runDate, policyVersion: jackyunExportFirstPolicyVersion,
      manifestModule: manifest.modules[moduleKey], allowedDownloadHosts: policy.browser.allowedDownloadHosts,
      handoffPath: path.join(p.events, `${String(jackyunModuleOrder.indexOf(moduleKey) + 1).padStart(2, "0")}-${moduleKey}.json`),
      requireAtomicHandoff: true,
    });
    const audit = await read<{ import: { result: { djangoReceipt: { contentHash: string; rawFileHash: string } } } }>(verified.auditPath);
    const url = moduleKey === "inventory" ? "http://localhost:3000/api/imports/inventory" : "http://localhost:3000/api/imports/erp";
    const query = new URLSearchParams({ batchId: verified.batchId!, limit: "1", ...(moduleKey === "inventory" ? {} : { source: moduleKey }) });
    const body = await jsonGet(url + "?" + query, deps), items = body.items as Array<Record<string, unknown>>;
    const batch = Array.isArray(items) && items.length === 1 ? items[0] : null;
    const receipt = audit.import?.result?.djangoReceipt;
    const totals = batch?.totals as Record<string, unknown> | undefined;
    const excluded = moduleKey === "inventory" ? 0 : Number(batch?.excludedCount);
    if (!batch || batch.id !== verified.batchId || batch.status !== "completed" || batch.rowCount !== verified.rowCount
      || !Number.isSafeInteger(excluded) || excluded < 0 || Number(batch.ownedRowCount) !== Number(verified.rowCount) - excluded
      || Number(batch.ownedRowCount) <= 0 || (moduleKey !== "products" && batch.isCurrent !== true)
      || (moduleKey !== "products" && batch.snapshotDate !== a.runDate) || (moduleKey === "products" && batch.snapshotDate !== null)
      || !receipt || totals?.contentHash !== receipt.contentHash || totals?.rawFileHash !== receipt.rawFileHash) {
      throw Error(`5478 ${moduleKey} 已完成批次、当前归属或摘要变化。`);
    }
    result.push({ module: moduleKey, batchId: verified.batchId!, rowCount: verified.rowCount!, warningCount: verified.warningCount ?? 0 });
  }
  return result;
}

export async function inspectPartialImportRecovery(root: string, evidence: PreflightEvidence, createdAt: string,
  deps: Dependencies = {}): Promise<PartialImportRecoveryProposal> {
  assertPartialImportEvidence(evidence, createdAt); root = path.resolve(root);
  const p = names(root), files: Record<string, string> = {};
  let count = 0, total = 0;
  const capture = async (file: string) => {
    const raw = await bytes(file); total += raw.length;
    if (++count > 200 || total > 1024 * 1024 * 1024) throw Error("5478 恢复证据总量超限。");
    files[file] = recoverySha(raw); return raw;
  };
  const plan = await read<{ version: number; executionId: string; runId: string; phase: string; exportTransport: string;
    protocol: string; runDate: string; asOfDate: string; salesStartDate: string; baseUrl: string; createdAt: string;
    exportIntent?: unknown; completedAt?: unknown; exports: Record<JackyunModule, { handoffSha256: string; fileSha256: string; bytes: number }> }>(p.plan);
  const policy = await read<{ version: string; browser: { downloadDirectory: string } }>(p.policy);
  const formal = await read<Manifest>(path.join(p.formal, "run-manifest.json")), failed = formal.modules.sales;
  const validation = await read<Manifest>(path.join(p.validation, "run-manifest.json"));
  const auditPath = path.join(p.formal, "audit/sales.json");
  const audit = await read<{ version: number; runId: string; module: string; status: string; import?: unknown;
    source: { sha256: string }; error: { stage: string; message: string }; timings: { startedAt: string; failedAt: string } }>(auditPath);
  const active = await read<unknown>(p.active), keys = [...jackyunModuleOrder].sort();
  if (plan.version !== 2 || plan.executionId !== a.executionId || plan.runId !== a.runId || plan.phase !== "importing"
    || plan.exportTransport !== "session_api_v1" || plan.protocol !== jackyunExportFirstPolicyVersion || policy.version !== plan.protocol
    || plan.runDate !== a.runDate || plan.asOfDate !== a.endDate || plan.salesStartDate !== a.startDate
    || plan.createdAt !== "2026-10-02T16:10:02.394Z" || plan.baseUrl !== "http://localhost:3000" || plan.exportIntent || plan.completedAt
    || !isDeepStrictEqual(active, { runId: a.runId, executionId: a.executionId }) || !isDeepStrictEqual(Object.keys(plan.exports).sort(), keys)
    || formal.version !== 1 || formal.runId !== a.runId || !isDeepStrictEqual(formal.strictOrder, jackyunModuleOrder)
    || !isDeepStrictEqual(Object.keys(formal.modules), jackyunModuleOrder.slice(0, 4))
    || prefix.some(m => formal.modules[m].status !== "completed" || !formal.modules[m].batchId)
    || validation.version !== 1 || validation.runId !== a.runId || !isDeepStrictEqual(validation.strictOrder, jackyunModuleOrder)
    || !isDeepStrictEqual(Object.keys(validation.modules).sort(), keys) || jackyunModuleOrder.some(m => validation.modules[m].status !== "prepared" || validation.modules[m].batchId)
    || failed.module !== "sales" || failed.status !== "failed" || failed.batchId || failed.outputPath || failed.outputSha256
    || failed.error !== a.error || failed.startedAt !== a.salesStartedAt || failed.completedAt !== a.failedAt
    || audit.version !== 1 || audit.runId !== a.runId || audit.module !== "sales" || audit.status !== "failed" || audit.import
    || audit.source.sha256 !== failed.sourceSha256 || failed.sourceSha256 !== plan.exports.sales.fileSha256
    || audit.error.stage !== "sales_filter_cost_match_import_verify" || audit.error.message !== a.error
    || audit.timings.startedAt !== a.salesStartedAt || audit.timings.failedAt !== a.failedAt) throw Error("5478 部分导入或失败证据变化。");
  // The original GET failed before processing or uploading any sales workbook.
  // Any nested audit, processed file, registry, chunk, combo or new attempt makes
  // the result uncertain and ineligible for this exception.
  if (!isDeepStrictEqual((await readdir(p.formal)).sort(), ["api-controller-state.json", "audit", "processed", "raw", "run-manifest.json", "sales"].sort())
    || !isDeepStrictEqual((await readdir(path.join(p.formal, "audit"))).sort(), ["inventory.json", "inventory_age.json", "products.json", "sales.json"])
    || !isDeepStrictEqual(await readdir(path.join(p.formal, "sales")), ["2026-08-19_2026-10-02_20261002161234"])
    || (await readdir(path.join(p.formal, "sales/2026-08-19_2026-10-02_20261002161234"))).length) throw Error("5478 出现额外导入效果或尝试。");
  const downloads = path.resolve(policy.browser.downloadDirectory, "jackyun", a.runId);
  if (!path.isAbsolute(policy.browser.downloadDirectory) || !isDeepStrictEqual((await readdir(downloads)).sort(), keys)
    || !isDeepStrictEqual((await readdir(p.events)).sort(), jackyunModuleOrder.map((m, i) => `${String(i + 1).padStart(2, "0")}-${m}.json`).sort())) throw Error("5478 下载或交接集合变化。");
  const controller = await read<{ version: number; runId: string; transport: string; runDate: string; asOfDate: string;
    salesStartDate: string; modules: Record<JackyunModule, { status: string; filePath: string; handoffSha256: string }> }>(path.join(p.formal, "api-controller-state.json"));
  if (controller.version !== 1 || controller.runId !== a.runId || controller.transport !== "session_api_v1"
    || controller.runDate !== a.runDate || controller.asOfDate !== a.endDate || controller.salesStartDate !== a.startDate
    || !isDeepStrictEqual(Object.keys(controller.modules).sort(), keys)) throw Error("5478 原 API 任务身份变化。");
  for (const [index, module] of jackyunModuleOrder.entries()) {
    const eventFile = path.join(p.events, `${String(index + 1).padStart(2, "0")}-${module}.json`);
    const rawEvent = await capture(eventFile), event = JSON.parse(rawEvent.toString("utf8")) as { schemaVersion: number;
      runId: string; module: string; policyVersion: string; filePath: string };
    const receipt = plan.exports[module], state = controller.modules[module];
    if (event.schemaVersion !== 2 || event.runId !== a.runId || event.module !== module || event.policyVersion !== plan.protocol
      || path.dirname(path.resolve(event.filePath)) !== path.join(downloads, module)
      || !isDeepStrictEqual(await readdir(path.join(downloads, module)), [path.basename(event.filePath)])
      || recoverySha(rawEvent) !== receipt.handoffSha256 || state.status !== "handed_off" || state.filePath !== event.filePath
      || state.handoffSha256 !== receipt.handoffSha256) throw Error("5478 五表交接、任务或文件身份变化。");
    const raw = await capture(event.filePath);
    if (raw.length !== receipt.bytes || recoverySha(raw) !== receipt.fileSha256) throw Error("5478 原文件摘要变化。");
  }
  const walk = async (dir: string): Promise<void> => {
    const info = await lstat(dir); if (info.isSymbolicLink() || !info.isDirectory()) throw Error("5478 归档目录身份异常。");
    for (const name of (await readdir(dir)).sort()) {
      const file = path.join(dir, name), info = await lstat(file);
      if (info.isDirectory()) await walk(file); else await capture(file);
    }
  };
  await capture(p.plan); await capture(p.active); await capture(p.policy); await walk(p.formal); await walk(p.validation);
  const prefixBatches = await verifyPartialImportPrefix(root, deps), currentSourceState = await sourceState(deps);
  if (!isDeepStrictEqual(currentSourceState, originalSourceState)) throw Error("5478 原销售或组合装版本已被后续写入替换，拒绝旧文件续导。");
  return { version: 1, reason, root, createdAt, evidence, files, prefixBatches, sourceState: currentSourceState,
    failedModuleSha256: recoverySha(JSON.stringify(failed)), failedAuditSha256: files[auditPath] };
}

export async function publishPartialImportRecovery(proposal: PartialImportRecoveryProposal, evidence: PreflightEvidence,
  approvedSha: string, deps: Dependencies = {}) {
  if (approvedSha !== recoverySha(JSON.stringify(proposal))
    || !isDeepStrictEqual(await inspectPartialImportRecovery(proposal.root, evidence, proposal.createdAt, deps), proposal)) throw Error("5478 恢复批准摘要或证据变化。");
  await create(names(proposal.root).permit, proposal);
}

export async function claimPartialImportRecovery(root: string, originalId: string, replacementId: string, action: string,
  now: string, deps: Dependencies = {}): Promise<PartialImportRecoveryBinding> {
  if (originalId !== a.executionId || !/^[1-9]\d{0,19}$/.test(replacementId) || BigInt(replacementId) <= BigInt(a.executionId)
    || !["plan-api", "export-all", "validate", "import", "verify"].includes(action)) throw Error("5478 恢复执行身份或入口无效。");
  root = path.resolve(root); const p = names(root), raw = await bytes(p.permit, 2 * 1024 * 1024);
  const proposal = JSON.parse(raw.toString("utf8")) as PartialImportRecoveryProposal;
  if (proposal.version !== 1 || proposal.reason !== reason || proposal.root !== root || !Number.isFinite(Date.parse(now))) throw Error("5478 恢复许可身份无效。");
  if (!deps.replacementEvidence) throw Error("5478 缺少原工作流替代执行的只读身份核验。");
  const context = deps.replacementEvidence(originalId, replacementId);
  if (!isDeepStrictEqual(context.evidence, proposal.evidence) || context.replacement.mode !== "manual"
    || context.replacement.executionId !== replacementId
    || Date.parse(context.replacement.startedAt) < Date.parse(proposal.createdAt)) throw Error("5478 恢复只能由新的完整手动执行领取。");
  const binding: PartialImportRecoveryBinding = { version: 1, reason, originalExecutionId: originalId, failedExecutionId: originalId,
    executionId: replacementId, permitSha256: recoverySha(raw), failedModuleSha256: proposal.failedModuleSha256, failedAuditSha256: proposal.failedAuditSha256 };
  const previous = await bytes(p.claim).catch(error => { if (error.code === "ENOENT") return null; throw error; });
  if (previous) {
    if (!isDeepStrictEqual(JSON.parse(previous.toString("utf8")), binding)) throw Error("5478 许可已被其他 execution 领取。");
    for (const [name, file] of [["plan.json", p.plan], ["manifest.json", path.join(p.formal, "run-manifest.json")], ["sales.failed.json", path.join(p.formal, "audit/sales.json")]]) {
      if (recoverySha(await bytes(path.join(p.archive, name))) !== proposal.files[file]) throw Error("5478 原失败归档变化。");
    }
    const mutable = new Set([p.plan, path.join(p.formal, "run-manifest.json"), path.join(p.formal, "audit/sales.json")]);
    for (const [file, expected] of Object.entries(proposal.files)) if (!mutable.has(file) && recoverySha(await bytes(file)) !== expected) throw Error("5478 领取后原始证据变化。");
    return binding;
  }
  if (action !== "plan-api" || Date.parse(now) < Date.parse(proposal.createdAt) || Date.parse(now) - Date.parse(proposal.createdAt) > 30 * 60000
    || jackyunCaptureDate(now) !== jackyunCaptureDate(proposal.createdAt)
    || !isDeepStrictEqual(await inspectPartialImportRecovery(root, proposal.evidence, proposal.createdAt, deps), proposal)) throw Error("5478 许可过期、跨日或原证据变化。");
  await mkdir(p.archive, { recursive: true });
  for (const [name, file] of [["plan.json", p.plan], ["manifest.json", path.join(p.formal, "run-manifest.json")], ["sales.failed.json", path.join(p.formal, "audit/sales.json")]]) {
    await writeFile(path.join(p.archive, name), await bytes(file), { flag: "wx" });
  }
  await create(p.claim, binding); return binding;
}

export async function verifyPartialImportGate(root: string, binding: PartialImportRecoveryBinding, deps: Dependencies = {}) {
  const p = names(root), proposal = await read<PartialImportRecoveryProposal>(p.permit);
  if (!isDeepStrictEqual(await read<unknown>(p.claim), binding) || recoverySha(await bytes(p.permit)) !== binding.permitSha256
    || !isDeepStrictEqual(await verifyPartialImportPrefix(root, deps), proposal.prefixBatches)
    || !isDeepStrictEqual(await sourceState(deps), proposal.sourceState)) throw Error("5478 导入前批次、销售或组合装版本变化。");
}

export function assertPartialFailedImportRetry(input: { runId: string; module: string; sourceSha256: string;
  inputContractHash: string; prior: unknown; auditRaw: Buffer; binding: PartialImportRecoveryBinding }) {
  const b = input.binding, prior = input.prior as Module;
  const audit = JSON.parse(input.auditRaw.toString("utf8")) as { import?: unknown; error: { stage: string; message: string }; timings: { failedAt: string } };
  if (input.runId !== a.runId || input.module !== "sales" || b.reason !== reason || b.version !== 1
    || b.originalExecutionId !== a.executionId || b.failedExecutionId !== a.executionId
    || !/^[1-9]\d{0,19}$/.test(b.executionId) || BigInt(b.executionId) <= BigInt(a.executionId) || !/^[a-f0-9]{64}$/.test(b.permitSha256)
    || recoverySha(JSON.stringify(prior)) !== b.failedModuleSha256 || recoverySha(input.auditRaw) !== b.failedAuditSha256
    || prior.status !== "failed" || prior.batchId || prior.outputPath || prior.outputSha256
    || prior.sourceSha256 !== input.sourceSha256 || prior.inputContractHash !== input.inputContractHash
    || audit.import || audit.error.stage !== "sales_filter_cost_match_import_verify" || audit.error.message !== a.error
    || audit.timings.failedAt !== a.failedAt) throw Error("5478 续导与原销售失败文件或契约不一致。");
}
