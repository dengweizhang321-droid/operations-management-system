import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, realpath, lstat, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { customerServiceStore } from "../lib/jd/customer-service-stores";
import { JdCustomerServiceWorkflowError, type CustomerServicePeriod } from "../lib/jd/customer-service-workflow";
import { validateJdStoreRegistry, type JdStore } from "../lib/jd/store-registry";
import { buildCustomerServiceDailyFiles, customerServicePairParseDetailCode } from "./jd-customer-service-daily-files";
import type { CustomerServiceN8nPlan } from "./jd-customer-service-n8n-pipeline";
import type { CustomerServiceDurationAnomaly } from "./jd-customer-service-duration-normalization";
import { customerServiceControlBytes } from "./jd-customer-service-failure-closure";
import { publishDurableFile, readJsonDurableOr } from "../lib/jackyun/json-file";
import type { CustomerServiceCloseTarget, CustomerServiceCloseKind, CustomerServiceCloseDiagnostic } from "../lib/jd/customer-service-close-contract";

export const customerServiceRecoveryHeader = "x-teruisi-jd-customer-service-recovery-sha256";
type IdentityWitness = { shopName: string; shopTitle: string; listTabs: 1; messageTabs: 1; challengePresent: false; credentialsSubmitted: false; exportSubmitted: false; importSubmitted: false };
export type CustomerServiceRecoveryApproval = {
  version: 1; kind: "downloaded_pair" | "pre_export_zero_effect";
  storeKey: string; shopId: string; shopName: string;
  originalExecutionId: string; originalPlanSha256: string;
  period: CustomerServicePeriod; failureCode: string;
  approvedAt: string; expiresAt: string;
  expectedDurationAnomalies?: CustomerServiceDurationAnomaly[];
  identityWitness?: IdentityWitness;
};
export type CustomerServiceSourceRecovery = { approvalSha256: string; originalExecutionId: string; kind: CustomerServiceRecoveryApproval["kind"] };
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function reject(): never { throw new JdCustomerServiceWorkflowError("SOURCE_RECOVERY_REJECTED_MANUAL_ACTION"); }
export function parseCustomerServiceRecoveryHeader(value: unknown) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) reject();
  return value;
}
export function customerServiceRecoveryDirectory(root: string, storeKey: string) {
  const store = customerServiceStore(storeKey);
  return path.join(root, "outputs", "jd-customer-service-pipeline", ...(store.storeKey === "jd-yiyong-director" ? [] : [store.storeKey]), "recoveries");
}
async function regularBytes(file: string, maximum: number) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size <= 0 || info.size > maximum
    || path.resolve(await realpath(file)).toLowerCase() !== path.resolve(file).toLowerCase()) reject();
  return readFile(file);
}
export async function inspectCustomerServiceRecovery(input: {
  root: string; storeKey: string; executionId: string; approvalSha256: string;
  previous: CustomerServiceN8nPlan; previousBytes: Uint8Array; period: CustomerServicePeriod;
}) {
  const { root, storeKey, previous, approvalSha256, executionId, period } = input;
  parseCustomerServiceRecoveryHeader(approvalSha256);
  const raw = await regularBytes(path.join(customerServiceRecoveryDirectory(root, storeKey), `${approvalSha256}.json`), 64 * 1024);
  if (digest(raw) !== approvalSha256) reject();
  const approval = JSON.parse(raw.toString("utf8")) as CustomerServiceRecoveryApproval;
  const store = customerServiceStore(storeKey);
  const approved = Date.parse(approval.approvedAt), expires = Date.parse(approval.expiresAt), now = Date.now();
  if (approval.version !== 1 || approval.storeKey !== store.storeKey || approval.shopId !== store.shopId || approval.shopName !== store.shopName
    || approval.originalExecutionId !== previous.executionId || previous.executionId === executionId
    || !/^[A-Za-z0-9_-]{1,96}$/.test(previous.executionId) || !/^[A-Za-z0-9_-]{1,96}$/.test(executionId)
    || approval.originalPlanSha256 !== digest(input.previousBytes) || !isDeepStrictEqual(approval.period, previous.period)
    || !isDeepStrictEqual(period, previous.period) || previous.storeKey !== storeKey || previous.shopName !== store.shopName || previous.shopId !== store.shopId
    || previous.stage !== "failed" || previous.failureCode !== approval.failureCode || previous.proofs.length || previous.importingDate || previous.dailyFiles
    || !Number.isFinite(approved) || !Number.isFinite(expires) || approved > now || expires <= now || expires - approved > 2 * 60 * 60 * 1000) reject();
  const registry = validateJdStoreRegistry(JSON.parse(await readFile(path.join(root, "config", "jd-store-accounts.json"), "utf8")), root);
  const registered = registry.find(item => item.storeKey === storeKey);
  if (!registered?.enabled || registered.shopName !== store.shopName || registered.shopId !== store.shopId) reject();
  const parentDirectory = path.join(registered.browser.downloadDir, "customer-service", previous.executionId);
  if (approval.kind === "pre_export_zero_effect") {
    if (!["PAGE_STORE_IDENTITY_MISMATCH_MANUAL_ACTION", "CHAT_PAGE_NOT_READY_MANUAL_ACTION", "CUSTOMER_SERVICE_FAILED_MANUAL_ACTION"].includes(approval.failureCode)
      || Object.keys(previous.source).length || approval.expectedDurationAnomalies !== undefined
      || !isDeepStrictEqual(approval.identityWitness, { shopName: store.shopName, shopTitle: store.shopName,
        listTabs: 1, messageTabs: 1, challengePresent: false, credentialsSubmitted: false, exportSubmitted: false, importSubmitted: false })) reject();
    try { await lstat(parentDirectory); reject(); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    return { approval, source: {} };
  }
  if (approval.kind !== "downloaded_pair" || approval.failureCode !== "PAIR_PARSE_REJECTED" || approval.identityWitness !== undefined
    || !Array.isArray(approval.expectedDurationAnomalies) || !approval.expectedDurationAnomalies.length) reject();
  const bytes: Uint8Array[] = [];
  for (const [index, view] of (["list", "messages"] as const).entries()) {
    const checkpoint = previous.source[view];
    if (!checkpoint?.savedPath || checkpoint.phase !== "downloaded" || checkpoint.view !== view
      || path.dirname(path.resolve(checkpoint.savedPath)).toLowerCase() !== path.resolve(parentDirectory).toLowerCase()
      || path.extname(checkpoint.savedPath).toLowerCase() !== (index === 0 ? ".xlsx" : ".log")
      || !Number.isSafeInteger(checkpoint.sourceCount) || Number(checkpoint.sourceCount) <= 0) reject();
    const file = await regularBytes(checkpoint.savedPath, 25 * 1024 * 1024);
    if (file.length !== checkpoint.sizeBytes || digest(file) !== checkpoint.sha256) reject();
    bytes.push(file);
  }
  if (previous.source.list?.sourceCount !== previous.source.messages?.sourceCount) reject();
  const parsed = buildCustomerServiceDailyFiles(bytes[0], bytes[1], period, storeKey, { negativeDurationToMissing: true });
  if (parsed.summary.sessionCount !== previous.source.list?.sourceCount
    || !isDeepStrictEqual(parsed.durationAnomalies, approval.expectedDurationAnomalies)) reject();
  return { approval, source: structuredClone(previous.source) };
}
export async function claimCustomerServiceRecovery(root: string, recovery: CustomerServiceSourceRecovery, storeKey: string, executionId: string) {
  // Called under the original per-store planning lock; create-only and terminal.
  await writeFile(path.join(customerServiceRecoveryDirectory(root, storeKey), `${recovery.approvalSha256}.claimed.json`),
    JSON.stringify({ executionId, storeKey, ...recovery }), { flag: "wx" });
}
export async function verifyCustomerServiceRecoveryClaim(root: string, recovery: CustomerServiceSourceRecovery, storeKey: string, executionId: string) {
  const raw = await regularBytes(path.join(customerServiceRecoveryDirectory(root, storeKey), `${recovery.approvalSha256}.claimed.json`), 64 * 1024);
  if (!isDeepStrictEqual(JSON.parse(raw.toString("utf8")), { executionId, storeKey, ...recovery })) reject();
}

// Only the plan file path, mirroring customerServicePlanFiles() in
// jd-customer-service-n8n-pipeline.ts. Not re-exporting pipeline internals;
// this is the one path fragment the approval generator also needs.
function customerServicePlanFile(root: string, executionId: string, storeKey: string) {
  const store = customerServiceStore(storeKey);
  if (!/^[A-Za-z0-9_-]{1,96}$/.test(executionId)) reject();
  const base = path.join(root, "outputs", "jd-customer-service-pipeline");
  const directory = store.storeKey === "jd-yiyong-director" ? base : path.join(base, store.storeKey);
  return path.join(directory, `${executionId}.json`);
}

export type CustomerServiceCloseAuthorityTarget = {
  storeKey: string; kind: CustomerServiceCloseKind;
  originalExecutionId: string; originalPlanSha256: string;
  failureCode: string; period: CustomerServicePeriod;
};

const zeroEffectCodes = ["PAGE_STORE_IDENTITY_MISMATCH_MANUAL_ACTION", "CHAT_PAGE_NOT_READY_MANUAL_ACTION", "CUSTOMER_SERVICE_FAILED_MANUAL_ACTION"];

// Keep the original thrown error/code and all control semantics. Diagnostic
// metadata is separate and constructed only at the precise rejection point.
const closeDiagnostics = new WeakMap<object, CustomerServiceCloseDiagnostic>();
function closeReject(diagnostic: CustomerServiceCloseDiagnostic): never {
  const error = new JdCustomerServiceWorkflowError("SOURCE_RECOVERY_REJECTED_MANUAL_ACTION");
  closeDiagnostics.set(error, diagnostic);
  throw error;
}
function diagnosticReason(diagnostic: CustomerServiceCloseDiagnostic) {
  const labels: Record<CustomerServiceCloseDiagnostic["category"], string> = {
    file_missing: "来源文件缺失", file_invalid: "文件或目录安全检查不通过", digest_mismatch: "文件摘要不符", size_mismatch: "文件大小不符",
    count_mismatch: "来源计数不等", parse_rejected: "来源解析被拒绝", plan_invalid: "计划结构不符", registry_mismatch: "店铺注册信息不符",
    boundary_invalid: "失败边界证据不符", checkpoint_invalid: "下载检查点不符", directory_mismatch: "目录条目不符", duration_anomaly_missing: "未发现所需时长异常证据",
  };
  return `${labels[diagnostic.category]}（${diagnostic.category}${diagnostic.file ? `，${diagnostic.file}` : ""}${diagnostic.expected !== undefined ? `，expected=${diagnostic.expected}` : ""}${diagnostic.actual !== undefined ? `，actual=${diagnostic.actual}` : ""}）`;
}

export function customerServiceCloseEvidenceCode(error: unknown) {
  const allowed = ["PAIR_PARSE_REJECTED", "UNRECOGNIZED_LOG_BLOCK", "INVALID_LOG_BLOCK", "FILE_DATE_OUT_OF_SCOPE", "INVALID_FILE_SIZE", "DAILY_PAYLOAD_TOO_LARGE", "DAILY_PARTITION_CHANGED_BUSINESS_VALUES", "SOURCE_RECOVERY_REJECTED_MANUAL_ACTION"];
  if (error instanceof JdCustomerServiceWorkflowError && error.code === "PAIR_PARSE_REJECTED") return customerServicePairParseDetailCode(error);
  const code = error instanceof JdCustomerServiceWorkflowError ? error.code : "";
  return allowed.includes(code) ? code : "CLOSE_SOURCE_EVIDENCE_INVALID";
}

/** Shared by target inspection, operator commit, and the next A consumer.
 * No import writes occur here. A missing messages checkpoint proves no submit
 * only with the precise failure location before the first messages checkpoint.
 */
export async function inspectCustomerServiceCloseEvidence(root: string, previous: CustomerServiceN8nPlan) {
  const store = customerServiceStore(previous.storeKey);
  if (previous.version !== 1 || previous.stage !== "failed" || previous.shopName !== store.shopName || previous.shopId !== store.shopId
    || !Array.isArray(previous.proofs) || previous.proofs.length
    || Object.keys(previous).some(key => !["version", "storeKey", "shopId", "shopName", "executionId", "period", "createdAt", "updatedAt", "stage", "source", "proofs", "failureCode", "failureBoundary"].includes(key))
    || ["sourceRecovery", "importingDate", "dailyFiles", "derivedDirectory", "sourceSessionSha256", "sourceChatSha256", "sourceCounts", "durationAnomalies", "normalizedSessionSha256", "operatorVerification"].some(key => key in previous)) closeReject({ category: "plan_invalid" });
  const registered = validateJdStoreRegistry(JSON.parse(await readFile(path.join(root, "config/jd-store-accounts.json"), "utf8")), root).find(item => item.storeKey === store.storeKey);
  if (!registered?.enabled || registered.shopId !== store.shopId || registered.shopName !== store.shopName) closeReject({ category: "registry_mismatch" });
  const parentDirectory = path.join(registered.browser.downloadDir, "customer-service", previous.executionId);
  const views = Object.keys(previous.source).sort().join();
  let names: string[] = [];
  try {
    const info = await lstat(parentDirectory);
    if (!info.isDirectory() || info.isSymbolicLink() || path.resolve(await realpath(parentDirectory)).toLowerCase() !== path.resolve(parentDirectory).toLowerCase()) closeReject({ category: "file_invalid" });
    names = await readdir(parentDirectory);
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (!views) {
    if (!zeroEffectCodes.includes(previous.failureCode ?? "") || !previous.failureBoundary?.browserClosed || previous.failureBoundary.version !== 1
      || !["browser_start", "open_customer_service_page", "export_list", "export_messages"].includes(previous.failureBoundary.step) || names.length) closeReject({ category: "boundary_invalid" });
    return { kind: "pre_export_zero_effect" as const, registered, sourceEvidence: { files: [], sourceCount: 0 } };
  }
  const listOnly = views === "list";
  if (listOnly) {
    // Both codes are thrown before messages.querying. NOT_READY is emitted
    // from assertStore's page gate; later failures would retain a checkpoint.
    if (!["CHAT_PAGE_MISMATCH", "CHAT_PAGE_NOT_READY_MANUAL_ACTION"].includes(previous.failureCode ?? "")
      || previous.failureBoundary?.version !== 1 || previous.failureBoundary.browserClosed !== true || previous.failureBoundary.step !== "export_messages"
      || previous.failureCode === "CHAT_PAGE_NOT_READY_MANUAL_ACTION" && previous.failureBoundary.preSubmitView !== "messages") closeReject({ category: "boundary_invalid" });
  } else if (views !== "list,messages" || previous.failureCode !== "PAIR_PARSE_REJECTED"
    || previous.failureBoundary?.version !== 1 || previous.failureBoundary.browserClosed !== true || previous.failureBoundary.step !== "export_messages") closeReject({ category: "boundary_invalid" });
  const files: { view: string; savedPath: string; sha256: string; sizeBytes: number; sourceCount: number }[] = [];
  const bytes: Uint8Array[] = [];
  for (const view of listOnly ? ["list"] as const : ["list", "messages"] as const) {
    const checkpoint = previous.source[view];
    if (!checkpoint || checkpoint.view !== view || checkpoint.phase !== "downloaded" || !checkpoint.savedPath
      || Object.keys(checkpoint).some(key => !["view", "phase", "sourceCount", "savedPath", "sha256", "sizeBytes", "observedAt"].includes(key))
      || path.dirname(path.resolve(checkpoint.savedPath)).toLowerCase() !== path.resolve(parentDirectory).toLowerCase()
      || path.basename(checkpoint.savedPath) !== (view === "list" ? "list.xlsx" : "messages.log")
      || !Number.isSafeInteger(checkpoint.sourceCount) || Number(checkpoint.sourceCount) <= 0) closeReject({ category: "checkpoint_invalid" });
    // Validate every directory component, including junctions, before bytes.
    for (let cursor = path.resolve(checkpoint.savedPath); ; cursor = path.dirname(cursor)) {
      const info = await lstat(cursor).catch(error => {
        if (error && typeof error === "object" && (error as NodeJS.ErrnoException).code === "ENOENT") closeDiagnostics.set(error, { category: "file_missing", file: view === "list" ? "list.xlsx" : "messages.log" });
        throw error;
      });
      if (info.isSymbolicLink() || (cursor === path.resolve(checkpoint.savedPath) ? !info.isFile() || info.nlink !== 1 : !info.isDirectory())
        || path.resolve(await realpath(cursor)).toLowerCase() !== cursor.toLowerCase()) closeReject({ category: "file_invalid" });
      if (path.dirname(cursor) === cursor) break;
    }
    const basename = view === "list" ? "list.xlsx" as const : "messages.log" as const;
    let file: Uint8Array;
    try { file = await regularBytes(checkpoint.savedPath, 25 * 1024 * 1024); }
    catch (error) {
      if (error && typeof error === "object" && (error as NodeJS.ErrnoException).code === "ENOENT") closeDiagnostics.set(error, { category: "file_missing", file: basename });
      if (error instanceof JdCustomerServiceWorkflowError) closeDiagnostics.set(error, { category: "file_invalid", file: basename });
      throw error;
    }
    if (file.length !== checkpoint.sizeBytes) closeReject({ category: "size_mismatch", file: basename });
    if (digest(file) !== checkpoint.sha256) closeReject({ category: "digest_mismatch", file: basename });
    files.push({ view, savedPath: checkpoint.savedPath, sha256: checkpoint.sha256!, sizeBytes: file.length, sourceCount: checkpoint.sourceCount! }); bytes.push(file);
  }
  if (names.sort().join() !== files.map(file => path.basename(file.savedPath)).sort().join()) closeReject({ category: "directory_mismatch" });
  if (listOnly) return { kind: "downloaded_list_only" as const, registered, sourceEvidence: { files, sourceCount: files[0].sourceCount, boundary: previous.failureBoundary } };
  if (files[0].sourceCount !== files[1].sourceCount) closeReject({ category: "count_mismatch", file: "messages.log", expected: files[0].sourceCount, actual: files[1].sourceCount });
  let parsed: ReturnType<typeof buildCustomerServiceDailyFiles>;
  try { parsed = buildCustomerServiceDailyFiles(bytes[0], bytes[1], previous.period, store.storeKey, { negativeDurationToMissing: true, closureEvidenceOnly: true }); }
  catch (error) {
    if (error && typeof error === "object") closeDiagnostics.set(error, { category: "parse_rejected" });
    throw error;
  }
  if (parsed.summary.sessionCount !== files[0].sourceCount) closeReject({ category: "count_mismatch", file: "list.xlsx", expected: files[0].sourceCount, actual: parsed.summary.sessionCount });
  if (parsed.summary.chatSessionCount !== files[1].sourceCount) closeReject({ category: "count_mismatch", file: "messages.log", expected: files[1].sourceCount, actual: parsed.summary.chatSessionCount });
  if (!parsed.durationAnomalies.length) closeReject({ category: "duration_anomaly_missing" });
  return { kind: "downloaded_pair" as const, registered, sourceEvidence: { files, sourceCount: files[0].sourceCount,
    summary: parsed.summary, durationAnomalies: parsed.durationAnomalies, normalizedSessionSha256: parsed.normalizedSessionSha256,
    sourceSessionSha256: parsed.sourceSessionSha256, sourceChatSha256: parsed.sourceChatSha256,
    dailyFiles: parsed.files.map(({ date, sessionSha256, chatSha256, contentSha256, conversationCount }) => ({ date, sessionSha256, chatSha256, contentSha256, conversationCount })) } };
}

/** Read-only inspection for independent failed closure or executed verification.
 * This does not issue authority or create a terminal receipt. Runtime ownership,
 * n8n terminal state, locks and CAS are rechecked by the operator commit path.
 */
export async function readCustomerServiceCloseTarget(root: string, storeKey: unknown): Promise<CustomerServiceCloseTarget> {
  let store;
  try { store = customerServiceStore(storeKey); }
  catch { return { ok: true, closeAllowed: false, reason: "店铺范围无效，仅支持京东客服四店。" }; }
  const base = path.join(root, "outputs", "jd-customer-service-pipeline");
  const directory = store.storeKey === "jd-yiyong-director" ? base : path.join(base, store.storeKey);
  const active = await readJsonDurableOr<{ executionId?: string } | null>(path.join(directory, "active.json"), null);
  if (!active || typeof active.executionId !== "string") return { ok: true, closeAllowed: false, reason: "该店当前没有记录在案的活动任务。" };
  let previousBytes: Uint8Array;
  let previous: CustomerServiceN8nPlan;
  try {
    previousBytes = await customerServiceControlBytes(customerServicePlanFile(root, active.executionId, store.storeKey));
    previous = JSON.parse(Buffer.from(previousBytes).toString("utf8")) as CustomerServiceN8nPlan;
  } catch { return { ok: true, closeAllowed: false, reason: "该店活动任务对应的计划文件无法核实。" }; }
  if (previous.executionId !== active.executionId || previous.version !== 1 || previous.storeKey !== store.storeKey
    || previous.shopName !== store.shopName || previous.shopId !== store.shopId) {
    return { ok: true, closeAllowed: false, reason: "活动任务与计划文件不一致，暂不能判断是否可闭合。" };
  }
  const common = { storeKey: store.storeKey, shopName: store.shopName, shopId: store.shopId,
    originalExecutionId: previous.executionId, originalPlanSha256: digest(previousBytes), failureCode: previous.failureCode ?? "", period: previous.period };
  if (previous.stage === "executed") return { ok: true, closeAllowed: true, target: { ...common, kind: "executed_verify" }, reason: "该任务已执行，可受控从磁盘续接原 C 验证；不重跑导出或导入。" };
  if (previous.stage !== "failed") return { ok: true, closeAllowed: false, reason: "该任务无需失败闭合或验证续接。" };
  try {
    const evidence = await inspectCustomerServiceCloseEvidence(root, previous);
    return { ok: true, closeAllowed: true, target: { ...common, kind: evidence.kind }, reason: "来源和未发布证据可核实；可保留原失败及来源并闭合，后续正常 A 按新窗口重新采集。" };
  } catch (error) {
    const diagnostic = error && typeof error === "object" ? closeDiagnostics.get(error) : undefined;
    return { ok: true, closeAllowed: false, reason: `闭合证据无法核实（${customerServiceCloseEvidenceCode(error)}），${diagnostic ? `${diagnosticReason(diagnostic)}；` : ""}需要人工核查。`,
      ...(diagnostic ? { diagnostic } : {}) };
  }
}

/** Writes the one file tools/jd-customer-service-n8n-pipeline.ts and
 * inspectCustomerServiceRecovery() were already able to consume, but that
 * nothing in this repository previously produced. Called only after a human
 * operator's close authority has been minted and re-validated by Django
 * (see backend/workflow/jd_customer_service_close_authority.py); never
 * reachable from the automatic pipeline path or from the failure-closure
 * whitelist in jd-customer-service-failure-closure.ts.
 *
 * Every field is re-derived from the real stuck plan currently on disk, not
 * trusted from the caller, so an approval can never be minted for a plan
 * whose live state has since changed (sha256, stage, failureCode, period).
 */
export async function generateCustomerServiceRecoveryApproval(root: string, target: CustomerServiceCloseAuthorityTarget, approvedAt: Date, ttlMs = 2 * 60 * 60 * 1000) {
  const store = customerServiceStore(target.storeKey);
  if (!/^[a-f0-9]{64}$/.test(target.originalPlanSha256) || !/^[A-Za-z0-9_-]{1,96}$/.test(target.originalExecutionId)) reject();
  const planFile = customerServicePlanFile(root, target.originalExecutionId, store.storeKey);
  const previousBytes = await customerServiceControlBytes(planFile);
  if (digest(previousBytes) !== target.originalPlanSha256) reject();
  const previous = JSON.parse(previousBytes.toString("utf8")) as CustomerServiceN8nPlan;
  if (previous.executionId !== target.originalExecutionId || previous.version !== 1 || previous.stage !== "failed"
    || previous.storeKey !== store.storeKey || previous.shopName !== store.shopName || previous.shopId !== store.shopId
    || previous.failureCode !== target.failureCode || !isDeepStrictEqual(previous.period, target.period)
    || previous.proofs.length || previous.importingDate || previous.dailyFiles) reject();
  // This is reachable only after the next A round already tried the
  // automatic closer in jd-customer-service-failure-closure.ts and it threw
  // PREVIOUS_RUN_UNRESOLVED_MANUAL_ACTION (see jd-customer-service-n8n-pipeline.ts).
  // Whether that closer *would* succeed depends on live n8n execution_entity
  // state, port occupancy and the per-store planning lock -- none of which
  // this generator can safely re-simulate without side effects. The human
  // operator's own judgement that automatic closure is not going to resolve
  // the stuck plan is the actual gate here, carried by the Django authority;
  // this function only re-derives the approval's business facts from disk.
  const registry = validateJdStoreRegistry(JSON.parse(await readFile(path.join(root, "config", "jd-store-accounts.json"), "utf8")), root);
  const registered = registry.find(item => item.storeKey === store.storeKey);
  if (!registered?.enabled || registered.shopName !== store.shopName || registered.shopId !== store.shopId) reject();
  const approvedAtIso = approvedAt.toISOString(), expiresAtIso = new Date(approvedAt.getTime() + ttlMs).toISOString();
  let approval: CustomerServiceRecoveryApproval;
  if (target.kind === "pre_export_zero_effect") {
    if (!["PAGE_STORE_IDENTITY_MISMATCH_MANUAL_ACTION", "CHAT_PAGE_NOT_READY_MANUAL_ACTION", "CUSTOMER_SERVICE_FAILED_MANUAL_ACTION"].includes(target.failureCode)
      || Object.keys(previous.source).length) reject();
    const parentDirectory = path.join(registered.browser.downloadDir, "customer-service", previous.executionId);
    try { await lstat(parentDirectory); reject(); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    approval = { version: 1, kind: "pre_export_zero_effect", storeKey: store.storeKey, shopId: store.shopId, shopName: store.shopName,
      originalExecutionId: previous.executionId, originalPlanSha256: target.originalPlanSha256, period: previous.period, failureCode: target.failureCode,
      approvedAt: approvedAtIso, expiresAt: expiresAtIso,
      identityWitness: { shopName: store.shopName, shopTitle: store.shopName, listTabs: 1, messageTabs: 1,
        challengePresent: false, credentialsSubmitted: false, exportSubmitted: false, importSubmitted: false } };
  } else if (target.kind === "downloaded_pair") {
    if (target.failureCode !== "PAIR_PARSE_REJECTED") reject();
    const parentDirectory = path.join(registered.browser.downloadDir, "customer-service", previous.executionId);
    const bytes: Uint8Array[] = [];
    for (const [index, view] of (["list", "messages"] as const).entries()) {
      const checkpoint = previous.source[view];
      if (!checkpoint?.savedPath || checkpoint.phase !== "downloaded" || checkpoint.view !== view
        || path.dirname(path.resolve(checkpoint.savedPath)).toLowerCase() !== path.resolve(parentDirectory).toLowerCase()
        || path.extname(checkpoint.savedPath).toLowerCase() !== (index === 0 ? ".xlsx" : ".log")
        || !Number.isSafeInteger(checkpoint.sourceCount) || Number(checkpoint.sourceCount) <= 0) reject();
      const file = await regularBytes(checkpoint.savedPath, 25 * 1024 * 1024);
      if (file.length !== checkpoint.sizeBytes || digest(file) !== checkpoint.sha256) reject();
      bytes.push(file);
    }
    if (previous.source.list?.sourceCount !== previous.source.messages?.sourceCount) reject();
    const parsed = buildCustomerServiceDailyFiles(bytes[0], bytes[1], previous.period, store.storeKey, { negativeDurationToMissing: true });
    if (parsed.summary.sessionCount !== previous.source.list?.sourceCount || !parsed.durationAnomalies.length) reject();
    approval = { version: 1, kind: "downloaded_pair", storeKey: store.storeKey, shopId: store.shopId, shopName: store.shopName,
      originalExecutionId: previous.executionId, originalPlanSha256: target.originalPlanSha256, period: previous.period, failureCode: target.failureCode,
      approvedAt: approvedAtIso, expiresAt: expiresAtIso, expectedDurationAnomalies: parsed.durationAnomalies };
  } else reject();
  const content = JSON.stringify(approval, null, 2);
  const approvalSha256 = digest(new TextEncoder().encode(content));
  const directory = customerServiceRecoveryDirectory(root, store.storeKey);
  await mkdir(directory, { recursive: true });
  const filePath = path.join(directory, `${approvalSha256}.json`);
  const existing = await lstat(filePath).catch(error => { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; });
  if (existing) {
    if (!existing.isFile() || existing.isSymbolicLink() || existing.nlink !== 1) reject();
    if (digest(await regularBytes(filePath, 64 * 1024)) !== approvalSha256) reject();
    return { approval, approvalSha256 };
  }
  const tempPath = `${filePath}.${randomUUID()}.tmp`;
  const handle = await open(tempPath, "wx", 0o600);
  try { await handle.writeFile(content, "utf8"); await handle.sync(); }
  finally { await handle.close(); }
  await publishDurableFile(tempPath, filePath, true);
  return { approval, approvalSha256 };
}

/** Dedicated operator semantics; the old recovery approval consumer above
 * retains its original same-period, TTL and source-reuse restrictions. */
export async function dispatchCustomerServiceCloseAuthority(root: string, authorizationId: string, coordinator: import("../lib/jackyun/operator-close").CloseSlotCoordinator, request: typeof fetch = fetch) {
  return (await import("./jd-customer-service-operator-reconcile")).reconcileCustomerServiceOperator(root, authorizationId, coordinator, request);
}
