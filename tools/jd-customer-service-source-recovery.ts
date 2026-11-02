import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, realpath, lstat, writeFile } from "node:fs/promises";
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
import type { CustomerServiceCloseTarget } from "../lib/jd/customer-service-close-contract";
import { CUSTOMER_SERVICE_IMPORT_MESSAGE_LIMIT } from "../lib/customer-service/import-service";

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

// Only the plan file path, mirroring the private filePaths() in
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
  storeKey: string; kind: CustomerServiceRecoveryApproval["kind"];
  originalExecutionId: string; originalPlanSha256: string;
  failureCode: string; period: CustomerServicePeriod;
};

const zeroEffectCodes = ["PAGE_STORE_IDENTITY_MISMATCH_MANUAL_ACTION", "CHAT_PAGE_NOT_READY_MANUAL_ACTION", "CUSTOMER_SERVICE_FAILED_MANUAL_ACTION"];

/** Read-only counterpart to generateCustomerServiceRecoveryApproval(): finds
 * the store's current active plan, and if it is a stuck pre-submit failure,
 * reports the exact fields an operator needs to submit a close request --
 * without writing anything or re-simulating the automatic closer.
 *
 * closeAllowed=true is only reported once every remaining structural check
 * generateCustomerServiceRecoveryApproval() would itself perform (registry
 * enabled/identity match, no leftover download directory for
 * pre_export_zero_effect, both checkpoints present and content-consistent
 * for downloaded_pair) has already passed here too, so a "can close" button
 * can never be followed by a rejected submission for a reason this function
 * did not already surface.
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
    previous = JSON.parse(previousBytes.toString("utf8")) as CustomerServiceN8nPlan;
  } catch { return { ok: true, closeAllowed: false, reason: "该店活动任务对应的计划文件无法核实。" }; }
  if (previous.executionId !== active.executionId || previous.version !== 1 || previous.storeKey !== store.storeKey
    || previous.shopName !== store.shopName || previous.shopId !== store.shopId) {
    return { ok: true, closeAllowed: false, reason: "活动任务与计划文件不一致，暂不能判断是否可闭合。" };
  }
  if (previous.stage === "executed") return { ok: true, closeAllowed: false,
    reason: "该店当前任务已完成执行段，但 C 独立复验与收尾尚未完成，仍阻塞下一轮。须按原店铺、原 execution 的受控 verify 入口恢复收尾，不能按导出前零效果闭合或重跑 A/B。" };
  if (previous.stage !== "failed") return { ok: true, closeAllowed: false, reason: `该店当前任务处于 ${previous.stage}，不属于失败闭合范围。` };
  if (previous.proofs.length || previous.importingDate || previous.dailyFiles) {
    return { ok: true, closeAllowed: false, reason: "该次失败已有部分导入进度，不属于可人工闭合的范围，需要另行核查。" };
  }
  const originalPlanSha256 = createHash("sha256").update(previousBytes).digest("hex");
  const failureCode = previous.failureCode ?? "";
  const common = { storeKey: store.storeKey, shopName: store.shopName, shopId: store.shopId,
    originalExecutionId: previous.executionId, originalPlanSha256, failureCode, period: previous.period };
  // isCustomerServicePreSubmitFailure() only gates whether the automatic
  // closer may ATTEMPT closure; it structurally passes an empty-source plan
  // even when that plan is, in practice, exactly the stuck kind this human
  // entry exists for (the automatic closer still depends on live n8n
  // execution_entity history for the old executionId, which is routinely
  // pruned weeks later -- see the real exec 7250/8653/9243/7266/7482/9861
  // plans in docs/autoimport-workflow-unification-20261029/客服四店全败诊断.md,
  // all of which pass this predicate yet are the real-world stuck examples).
  // So it is deliberately NOT used as a "defer to automatic path" gate here;
  // only the kind-specific structural checks below (mirroring exactly what
  // generateCustomerServiceRecoveryApproval() requires) decide closeAllowed.
  const hasSource = Object.keys(previous.source).length > 0;
  let registered: JdStore | undefined;
  try {
    const registry = validateJdStoreRegistry(JSON.parse(await readFile(path.join(root, "config", "jd-store-accounts.json"), "utf8")), root);
    registered = registry.find(item => item.storeKey === store.storeKey);
  } catch { return { ok: true, closeAllowed: false, reason: "店铺注册表无法核实，暂不能判断是否可闭合。" }; }
  if (!registered?.enabled || registered.shopName !== store.shopName || registered.shopId !== store.shopId) {
    return { ok: true, closeAllowed: false, reason: "该店注册信息未启用或身份不符，暂不能闭合。" };
  }
  const parentDirectory = path.join(registered.browser.downloadDir, "customer-service", previous.executionId);
  if (!hasSource) {
    if (!previous.failureBoundary) {
      return { ok: true, closeAllowed: false, target: { ...common, kind: "pre_export_zero_effect" },
        reason: "这是该字段引入前的旧格式计划（无 failureBoundary），自动判据无法确认浏览器是否已关闭，需要人工核实后再闭合。" };
    }
    if (!zeroEffectCodes.includes(failureCode)) {
      return { ok: true, closeAllowed: false, target: { ...common, kind: "pre_export_zero_effect" },
        reason: `该失败码 ${failureCode || "（缺失）"} 不在可审批范围内，不能作为 pre_export_zero_effect 闭合。` };
    }
    const leftover = await lstat(parentDirectory).then(() => true, (error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return false; throw error; });
    if (leftover) return { ok: true, closeAllowed: false, target: { ...common, kind: "pre_export_zero_effect" },
      reason: "该次执行的下载目录仍有残留文件，与来源为空的前提矛盾，需要人工核实后再闭合。" };
    return { ok: true, closeAllowed: true, target: { ...common, kind: "pre_export_zero_effect" },
      reason: "来源为空、无下载残留，可按 pre_export_zero_effect 闭合。" };
  }
  if (previous.source.list?.phase === "downloaded" && previous.source.messages?.phase !== "downloaded") {
    return { ok: true, closeAllowed: false,
      reason: "会话列表已有导出下载效果，但消息文件未完整取得；不能认定为零效果，也不满足 downloaded_pair 来源复用审批条件，须保留原任务另行核查。" };
  }
  // Source reuse approval retains the original period; it is not a discard-and-recollect closure.
  if (failureCode !== "PAIR_PARSE_REJECTED") {
    return { ok: true, closeAllowed: false, target: { ...common, kind: "downloaded_pair" },
      reason: `失败发生在已取到部分来源之后（source 非空），但失败码 ${failureCode || "（缺失）"} 不是 PAIR_PARSE_REJECTED，不能按 downloaded_pair 闭合，需要人工核实。` };
  }
  try {
    const bytes: Uint8Array[] = [];
    for (const [index, view] of (["list", "messages"] as const).entries()) {
      const checkpoint = previous.source[view];
      if (!checkpoint?.savedPath || checkpoint.phase !== "downloaded" || checkpoint.view !== view
        || path.dirname(path.resolve(checkpoint.savedPath)).toLowerCase() !== path.resolve(parentDirectory).toLowerCase()
        || path.extname(checkpoint.savedPath).toLowerCase() !== (index === 0 ? ".xlsx" : ".log")
        || !Number.isSafeInteger(checkpoint.sourceCount) || Number(checkpoint.sourceCount) <= 0) throw new Error("checkpoint_shape_invalid");
      const file = await regularBytes(checkpoint.savedPath, 25 * 1024 * 1024);
      if (file.length !== checkpoint.sizeBytes || digest(file) !== checkpoint.sha256) throw new Error("checkpoint_content_mismatch");
      bytes.push(file);
    }
    if (previous.source.list?.sourceCount !== previous.source.messages?.sourceCount) throw new Error("source_count_mismatch");
    const parsed = buildCustomerServiceDailyFiles(bytes[0], bytes[1], previous.period, store.storeKey, { negativeDurationToMissing: true });
    if (parsed.summary.sessionCount !== previous.source.list?.sourceCount || !parsed.durationAnomalies.length) throw new Error("no_duration_anomaly");
  } catch (error) {
    // Match only labels emitted above; arbitrary parser/file exception text is
    // never diagnostic output because it can contain original customer data.
    const evidenceReasons = new Map([
      ["checkpoint_shape_invalid", "来源下载检查点不完整或路径、文件类型不符（CHECKPOINT_SHAPE_INVALID），当前不能批准来源复用。"],
      ["checkpoint_content_mismatch", "来源文件的大小或哈希与下载检查点不符（CHECKPOINT_CONTENT_MISMATCH），当前不能批准来源复用。"],
      ["source_count_mismatch", "两个来源文件的记录数量不一致（SOURCE_COUNT_MISMATCH），当前不能批准来源复用。"],
      ["no_duration_anomaly", "来源解析数量或预期时长异常证据不匹配（DURATION_EVIDENCE_MISMATCH），当前不能批准来源复用。"],
    ]);
    const detailCode = customerServicePairParseDetailCode(error);
    const reason = error instanceof Error ? evidenceReasons.get(error.message) : undefined;
    return { ok: true, closeAllowed: false, target: { ...common, kind: "downloaded_pair" },
      reason: reason ?? (detailCode === "MESSAGE_LIMIT_EXCEEDED"
        ? `单会话超过 ${CUSTOMER_SERVICE_IMPORT_MESSAGE_LIMIT} 条上限，当前不能批准来源复用（MESSAGE_LIMIT_EXCEEDED）。`
        : `已下载的两个来源文件无法核实或重新解析被拒（${detailCode}），不满足原日期范围来源复用审批条件，需要人工核实。`) };
  }
  return { ok: true, closeAllowed: true, target: { ...common, kind: "downloaded_pair" },
    reason: "两个来源文件均已下载并可重新解析核实，可审批 downloaded_pair 以复用原日期范围来源；这不会废弃旧来源或重新采集，跨日新计划仍须满足原 period 一致条件。" };
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

type CloseAuthority = { ok: true; version: "jd-customer-service-operator-close-authority-v1"; action: "close";
  target: CustomerServiceCloseAuthorityTarget; authorizationId: string; closeRequestId?: string; createdAt: string; expiresAt: string };
const authorityUuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);

/** Re-fetches and independently re-validates the Django-issued permission
 * receipt before generating anything; the helper process never trusts a bare
 * authorizationId. Mirrors lib/jackyun/operator-close.ts's authority(). */
export async function dispatchCustomerServiceCloseAuthority(root: string, authorizationId: string, request: typeof fetch = fetch) {
  if (!authorityUuid(authorizationId)) reject();
  const response = await request(`http://localhost:3000/api/imports/recovery/customer-service-close?authorizationId=${authorizationId}`, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000) });
  const raw = await response.text();
  if (!response.ok || Buffer.byteLength(raw) > 8192) reject();
  const value = JSON.parse(raw) as CloseAuthority;
  if (value.ok !== true || value.version !== "jd-customer-service-operator-close-authority-v1" || value.authorizationId !== authorizationId || value.action !== "close"
    || value.closeRequestId !== undefined && !authorityUuid(value.closeRequestId)
    || !Number.isFinite(Date.parse(value.createdAt)) || Date.parse(value.createdAt) > Date.now()
    || !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= Date.now()) reject();
  const { approval, approvalSha256 } = await generateCustomerServiceRecoveryApproval(root, value.target, new Date(value.createdAt), Date.parse(value.expiresAt) - Date.parse(value.createdAt));
  return { ok: true as const, storeKey: approval.storeKey, originalExecutionId: approval.originalExecutionId, approvalSha256 };
}
