import { createHash } from "node:crypto";
import { link, lstat, mkdir, open, readFile, rm, unlink } from "node:fs/promises";
import path from "node:path";

import type { APIRequestContext, APIResponse } from "playwright-core";

import { writeJsonAtomic } from "../lib/jackyun/json-file";
import { getTmallStore, type TmallStore } from "../lib/netshop/tmall-store-registry";
import {
  TMALL_ALIMAMA_FIND_REPORT_URL,
  TMALL_DIRECT_PROMOTION_PROTOCOL,
  activeAuditPath,
  defaultAuditDirectory,
  openPromotionPage,
  safeSegment,
  shanghaiDate,
  shiftDate,
  taskFailed,
  taskStatus,
  taskSucceeded,
  type DirectPromotionAudit,
} from "./tmall-direct-promotion-export";
import { TMALL_PROMOTION_DOWNLOAD_LIST_URL, waitForAlimamaIdentity } from "./tmall-promotion-export";
import { assertTmallDirectPmStore } from "./tmall-yijiu-direct-pm-contract";

/**
 * Operator-only controlled entries for a stuck direct promotion (P) active audit.
 * Nothing here is imported by the runner or the helper bundle; the runner behaviour is unchanged.
 * Rules mirrored from tools/tmall-direct-promotion-export.ts (readAudit, apiFindTask, local zip name) are pinned by tests.
 */
export const TMALL_DIRECT_PROMOTION_ADMIN_ACTIONS = ["inspect", "probe", "resolve-submitting", "abandon-expired"] as const;
export type PromotionAdminAction = typeof TMALL_DIRECT_PROMOTION_ADMIN_ACTIONS[number];

export const PROMOTION_PAGE_SIZE = 20;
export const PROMOTION_MAX_PAGES = 25;
export const PROMOTION_WINDOW_DAYS = 30;

const sha256 = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
type Json = Record<string, any>;

export class PromotionAdminRefusal extends Error {
  constructor(readonly reason: string, message: string) { super(message); }
}
function refuse(reason: string, message: string): never { throw new PromotionAdminRefusal(reason, message); }

/** Best-effort guard against a running helper slot for this store: GET /health only (read-only). Mirrors the master-abandon tool. */
export async function probeHelperIdleForStore(storeKey: string, fetcher: typeof fetch = fetch, port = 5791) {
  let response: Response;
  try {
    response = await fetcher(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(3000) });
  } catch (error) {
    const code = (error as { cause?: { code?: string } }).cause?.code ?? (error as NodeJS.ErrnoException).code;
    if (code === "ECONNREFUSED") return "helper_not_running" as const;
    refuse("helper_probe_failed", `无法确认 helper 是否空闲（${code ?? (error as Error).message}），拒绝处理`);
  }
  if (!response.ok) refuse("helper_probe_failed", `helper /health 返回 HTTP ${response.status}，拒绝处理`);
  const health = await response.json() as { storeExecutions?: Array<{ storeKey?: string | null; workflow?: string }> };
  const executions = Array.isArray(health.storeExecutions) ? health.storeExecutions : null;
  if (!executions) refuse("helper_probe_failed", "helper /health 未返回 storeExecutions，无法确认空闲");
  if (executions.some(slot => slot.workflow === "tmall" && slot.storeKey === storeKey)) {
    refuse("helper_store_active", `helper 正在运行 ${storeKey} 的天猫执行，拒绝处理`);
  }
  return "helper_store_idle" as const;
}

// ---------------------------------------------------------------------------------------------------------
// Platform probe: pure classification + injectable remote scan
// ---------------------------------------------------------------------------------------------------------
export type PromotionTaskRow = { id: string; status: string; succeeded: boolean; failed: boolean };
export type PromotionProbeVerdict = "absent" | "unique" | "ambiguous" | "incomplete";
export type ProbeResult = {
  verdict: PromotionProbeVerdict;
  windowTruncated: boolean;
  pagesScanned: number;
  rowsScanned: number;
  complete: boolean;
  window: { startTime: string; endTime: string } | null;
  byName: PromotionTaskRow[];
  byTask: PromotionTaskRow[];
  /** The single matched row when verdict is "unique". */
  unique: PromotionTaskRow | null;
};
export type PromotionPlatformProbe = (audit: DirectPromotionAudit, store: TmallStore) => Promise<ProbeResult>;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function rowFileName(row: Record<string, unknown>) {
  let ext: unknown = row.ext;
  if (typeof ext === "string") { try { ext = JSON.parse(ext); } catch { ext = null; } }
  return String(asRecord(ext).fileName ?? "");
}
function toTaskRow(row: Record<string, unknown>): PromotionTaskRow {
  const status = taskStatus(row);
  return { id: String(row.id ?? ""), status, succeeded: taskSucceeded(status), failed: taskFailed(status) };
}

/** Pure verdict over already-fetched pages (each page is the `data.list` of one findPage.json response). */
export function classifyPromotionProbe(
  pages: unknown[][],
  audit: Pick<DirectPromotionAudit, "reportName" | "taskId">,
  options: { complete: boolean; windowTruncated?: boolean; window?: { startTime: string; endTime: string } | null },
): ProbeResult {
  const rows = pages.flat().map(asRecord);
  const byName = audit.reportName ? rows.filter(row => rowFileName(row) === audit.reportName).map(toTaskRow) : [];
  const byTask = audit.taskId ? rows.filter(row => String(row.id ?? "") === audit.taskId).map(toTaskRow) : [];
  // Defensive: a final full page means the listing may continue even if the caller claimed completeness.
  const lastPage = pages[pages.length - 1];
  const complete = options.complete && pages.length > 0 && pages.length <= PROMOTION_MAX_PAGES
    && (lastPage?.length ?? PROMOTION_PAGE_SIZE) < PROMOTION_PAGE_SIZE;
  let verdict: PromotionProbeVerdict;
  let unique: PromotionTaskRow | null = null;
  if (!complete) verdict = "incomplete";
  else if (byName.length === 0 && byTask.length === 0) verdict = "absent";
  else if (byName.length === 1 && (!audit.taskId || byTask.length === 1 && byTask[0]!.id === byName[0]!.id)) {
    verdict = "unique"; unique = byName[0]!;
  } else if (byName.length === 0 && audit.taskId && byTask.length === 1) {
    verdict = "unique"; unique = byTask[0]!;
  } else verdict = "ambiguous";
  return {
    verdict, windowTruncated: options.windowTruncated === true, pagesScanned: pages.length, rowsScanned: rows.length,
    complete, window: options.window ?? null, byName, byTask, unique,
  };
}

/** Same time window as the runner's apiFindTask, one day earlier at the start; clamped to the platform's 30-day horizon. */
export function promotionProbeWindow(audit: Pick<DirectPromotionAudit, "startedAt">, now = new Date()) {
  const today = shanghaiDate(now);
  const started = new Date(audit.startedAt);
  if (Number.isNaN(started.getTime())) refuse("audit_identity", "活动清单开始时间无效，无法确定探测窗口");
  const startedDate = shanghaiDate(started);
  const floor = shiftDate(today, -PROMOTION_WINDOW_DAYS);
  const windowTruncated = startedDate < floor;
  const previous = shiftDate(startedDate, -1);
  return { startTime: windowTruncated || previous < floor ? floor : previous, endTime: today, windowTruncated };
}

async function readFindPage(api: APIRequestContext, startTime: string, endTime: string, offset: number) {
  const url = new URL(TMALL_ALIMAMA_FIND_REPORT_URL);
  url.searchParams.set("relationType", "1");
  url.searchParams.set("bizCode", "universalBP");
  url.searchParams.set("startTime", startTime);
  url.searchParams.set("endTime", endTime);
  url.searchParams.set("pageSize", String(PROMOTION_PAGE_SIZE));
  url.searchParams.set("offset", String(offset));
  const response: APIResponse = await api.get(url.toString(), {
    headers: { accept: "application/json, text/plain, */*", referer: "https://one.alimama.com/index.html" },
    timeout: 60_000,
  });
  const bytes = await response.body();
  if (!response.ok() || bytes.byteLength === 0) throw new Error(`查询阿里妈妈下载任务失败（HTTP ${response.status()}）`);
  let payload: unknown;
  try { payload = JSON.parse(bytes.toString("utf8")); } catch { throw new Error("查询阿里妈妈下载任务未返回 JSON"); }
  const list = asRecord(asRecord(payload).data).list;
  if (!Array.isArray(list)) throw new Error("阿里妈妈下载任务列表结构无效");
  return list as unknown[];
}

/** Real read-only probe: independent store Chromium, identity-checked, GET-only. Never exercised by tests. */
export const probePromotionPlatform: PromotionPlatformProbe = async (audit, store) => {
  const window = promotionProbeWindow(audit);
  const connected = await openPromotionPage(store);
  try {
    await connected.page.goto(TMALL_PROMOTION_DOWNLOAD_LIST_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await waitForAlimamaIdentity(connected.page, store);
    const pages: unknown[][] = [];
    let complete = false;
    for (let offset = 0; pages.length < PROMOTION_MAX_PAGES; offset += PROMOTION_PAGE_SIZE) {
      const rows = await readFindPage(connected.context.request, window.startTime, window.endTime, offset);
      pages.push(rows);
      if (rows.length < PROMOTION_PAGE_SIZE) { complete = true; break; }
    }
    return classifyPromotionProbe(pages, audit, {
      complete, windowTruncated: window.windowTruncated, window: { startTime: window.startTime, endTime: window.endTime },
    });
  } finally {
    await connected.browser.close().catch(() => undefined);
  }
};

// ---------------------------------------------------------------------------------------------------------
// Audit / file helpers
// ---------------------------------------------------------------------------------------------------------
async function readRegular(file: string): Promise<Buffer | null> {
  const info = await lstat(file).catch(error => { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; });
  if (!info) return null;
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) refuse("control_file_identity", `${path.basename(file)} 不是普通单链接文件`);
  return readFile(file);
}
async function exists(file: string) {
  return lstat(file).then(() => true, error => { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; });
}

const knownStages = new Set(["planned", "session_ready", "report_submitting", "report_submitted", "downloading", "downloaded", "importing", "completed", "failed"]);
/** Same structural conditions as the runner's readAudit, plus path-safety of runId. */
function validateAudit(audit: Json, store: TmallStore): DirectPromotionAudit {
  if (!audit || typeof audit !== "object" || Array.isArray(audit)
    || audit.version !== 1 || audit.protocol !== TMALL_DIRECT_PROMOTION_PROTOCOL
    || audit.storeKey !== store.storeKey || audit.shopName !== store.shopName || !audit.runId || !audit.stage
    || !audit.reportName || audit.reportName.length > 120
    || audit.taskId !== undefined && !/^[A-Za-z0-9_-]{1,128}$/.test(audit.taskId)) {
    refuse("audit_identity", "推广直连活动清单结构、协议或店铺身份无效");
  }
  if (typeof audit.runId !== "string" || !/^[A-Za-z0-9._-]{1,96}$/.test(audit.runId)) refuse("audit_identity", "活动清单 runId 无效");
  if (!knownStages.has(audit.stage)) refuse("audit_identity", "活动清单阶段未知");
  return audit as DirectPromotionAudit;
}

type ActiveState = { activePath: string; bytes: Buffer; sha256: string; audit: DirectPromotionAudit };
async function loadActive(store: TmallStore, auditDirectory: string): Promise<ActiveState | null> {
  const activePath = activeAuditPath(store.storeKey, auditDirectory);
  const bytes = await readRegular(activePath);
  if (!bytes) return null;
  let parsed: Json;
  try { parsed = JSON.parse(bytes.toString("utf8")); } catch { refuse("audit_unparseable", "活动清单不是合法 JSON"); }
  return { activePath, bytes, sha256: sha256(bytes), audit: validateAudit(parsed, store) };
}

export function localZipPath(store: Pick<TmallStore, "shopName" | "browser">, audit: Pick<DirectPromotionAudit, "startDate" | "runId">) {
  return path.resolve(store.browser.downloadDir, `${safeSegment(store.shopName)}-商品报表-${audit.startDate}-${safeSegment(audit.runId)}.zip`);
}
async function localZipEvidence(store: TmallStore, audit: DirectPromotionAudit) {
  const zipPath = localZipPath(store, audit);
  const bytes = await readRegular(zipPath);
  return bytes
    ? { path: zipPath, exists: true as const, sha256: sha256(bytes), sizeBytes: bytes.byteLength }
    : { path: zipPath, exists: false as const };
}

function resolveGate(audit: DirectPromotionAudit) {
  if (audit.stage !== "failed" || audit.resumeStage !== "report_submitting" || audit.taskId || audit.file) {
    refuse("stage", `活动清单 ${audit.stage}/${audit.resumeStage ?? "-"}（taskId=${audit.taskId ? "有" : "无"}，file=${audit.file ? "有" : "无"}）不是 failed/report_submitting 且无 taskId/file，拒绝处理建任务未决`);
  }
}
function abandonGate(audit: DirectPromotionAudit) {
  if (audit.stage !== "failed" || !["report_submitted", "downloading"].includes(audit.resumeStage ?? "") || !audit.taskId || audit.file) {
    refuse("stage", `活动清单 ${audit.stage}/${audit.resumeStage ?? "-"}（taskId=${audit.taskId ? "有" : "无"}，file=${audit.file ? "有" : "无"}）不是带 taskId、无 file 的 failed/report_submitted|downloading，拒绝作废（downloaded/importing 有本地文件、runner 可续；report_submitting 请用 resolve-submitting）`);
  }
}

// ---------------------------------------------------------------------------------------------------------
// Options and shared plumbing
// ---------------------------------------------------------------------------------------------------------
export type PromotionAdminOptions = {
  storeKey: string;
  reason?: string;
  operatorConfirmed?: boolean;
  dryRun?: boolean;
  expectSha256?: string;
  auditDirectory?: string;
  now?: Date;
  /** Test seams. Not exposed by the CLI. */
  store?: TmallStore;
  probe?: PromotionPlatformProbe;
  helperProbe?: (storeKey: string) => Promise<unknown>;
  hooks?: { afterEvidence?: () => Promise<void> };
};

async function context(options: PromotionAdminOptions) {
  const store = options.store ?? await getTmallStore(options.storeKey);
  if (store.storeKey !== options.storeKey) refuse("store_identity", "店铺身份不一致");
  assertTmallDirectPmStore(store.storeKey);
  const auditDirectory = path.resolve(options.auditDirectory ?? defaultAuditDirectory);
  return {
    store, auditDirectory,
    helperProbe: options.helperProbe ?? probeHelperIdleForStore,
    probe: options.probe ?? probePromotionPlatform,
  };
}

async function runProbe(probe: PromotionPlatformProbe, audit: DirectPromotionAudit, store: TmallStore) {
  try { return await probe(audit, store); }
  catch (error) { refuse("probe_failed", `平台任务探测失败：${(error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/g, " ").slice(0, 300)}`); }
}

function normalizeReason(reason: string | undefined, required: boolean) {
  const text = String(reason ?? "").replace(/\s+/g, " ").trim();
  if (required || text) {
    if (text.length < 4 || text.length > 300) refuse("reason_length", "原因必须为 4 至 300 个字符");
  }
  return text;
}

/** Create-only write of a file in a controlled evidence directory (temp file + exclusive link). */
async function createOnly(target: string, content: Uint8Array | string): Promise<"created" | "existing"> {
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  const handle = await open(temp, "wx");
  try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
  try {
    await link(temp, target);
    return "created";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return "existing";
    throw error;
  } finally {
    await rm(temp, { force: true });
  }
}

type Disposition = {
  /** Directory under the audit directory that holds the evidence. */
  evidenceRoot: string;
  action: "resolve-submitting" | "abandon-expired";
  gate: (audit: DirectPromotionAudit) => void;
  /** Returns the audit that replaces the active one, or null when the active file is to be archived instead. */
  decide: (audit: DirectPromotionAudit, probe: ProbeResult) => { newAudit: DirectPromotionAudit | null; outcome: string };
  /** Extra read-only facts recorded in the evidence (e.g. local zip). */
  facts?: (store: TmallStore, audit: DirectPromotionAudit) => Promise<Json>;
};

function resolveDecision(audit: DirectPromotionAudit, probe: ProbeResult) {
  const next: Json = { ...audit };
  delete next.error;
  if (probe.verdict === "absent") {
    if (probe.windowTruncated) refuse("window_truncated", "活动清单早于 30 天，平台列表可能已滚掉任务，无法证明建任务未成功，拒绝重置为 planned");
    next.resumeStage = "planned";
    return { newAudit: next as DirectPromotionAudit, outcome: "reset_to_planned" };
  }
  if (probe.verdict === "unique" && probe.unique) {
    if (probe.unique.failed) {
      next.resumeStage = "planned";
      return { newAudit: next as DirectPromotionAudit, outcome: "reset_to_planned_task_failed" };
    }
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(probe.unique.id)) refuse("task_id_invalid", "平台任务 id 不符合 runner 的 taskId 格式，拒绝绑定");
    next.taskId = probe.unique.id;
    next.resumeStage = "report_submitted";
    return { newAudit: next as DirectPromotionAudit, outcome: "bound_task" };
  }
  return refuse(`probe_${probe.verdict}`, `平台任务探测结果为 ${probe.verdict}，无法确定性处理，原清单不动`);
}

function abandonDecision(_audit: DirectPromotionAudit, probe: ProbeResult) {
  if (probe.verdict === "absent") return { newAudit: null, outcome: probe.windowTruncated ? "task_absent_window_truncated" : "task_absent" };
  if (probe.verdict === "unique" && probe.unique) {
    if (probe.unique.failed) return { newAudit: null, outcome: "task_failed" };
    refuse("task_still_valid", `平台任务 ${probe.unique.id} 状态为 ${probe.unique.status || "未知"}（${probe.unique.succeeded ? "已成功" : "进行中"}），runner 可继续，拒绝作废`);
  }
  return refuse(`probe_${probe.verdict}`, `平台任务探测结果为 ${probe.verdict}，无法确定任务已失效，拒绝作废`);
}

const resolveDisposition: Disposition = {
  evidenceRoot: "operator-resolutions", action: "resolve-submitting", gate: resolveGate, decide: resolveDecision,
};
const abandonDisposition: Disposition = {
  evidenceRoot: "operator-abandons", action: "abandon-expired", gate: abandonGate, decide: abandonDecision,
  facts: async (store, audit) => ({ localZip: await localZipEvidence(store, audit) }),
};

const serialize = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

async function execute(disposition: Disposition, options: PromotionAdminOptions) {
  const dryRun = options.dryRun === true;
  if (dryRun && options.operatorConfirmed) refuse("mode_conflict", "--dry-run 与 --confirm 不能同时使用");
  if (!dryRun && options.operatorConfirmed !== true) refuse("not_confirmed", "必须取得操作者明确确认（--confirm），或仅检查时使用 --dry-run");
  const reason = normalizeReason(options.reason, !dryRun);
  const expect = String(options.expectSha256 ?? "");
  if (!dryRun && !/^[a-f0-9]{64}$/.test(expect)) refuse("expect_sha256_missing", "--confirm 必须提供 --expect-sha256（来自 --dry-run 输出的 64 位十六进制）");

  const { store, auditDirectory, helperProbe, probe } = await context(options);
  const first = await loadActive(store, auditDirectory);
  if (!first) refuse("no_active_audit", "当前店铺不存在推广直连活动清单");
  disposition.gate(first.audit);
  if (!dryRun && first.sha256 !== expect) refuse("sha256_mismatch", "活动清单字节与 --expect-sha256 不一致（已变化），拒绝处理，请重新 --dry-run");

  await helperProbe(store.storeKey);
  const probeResult = await runProbe(probe, first.audit, store);
  const { newAudit, outcome } = disposition.decide(first.audit, probeResult);
  const newText = newAudit ? serialize(newAudit) : null;
  const newSha = newText ? sha256(newText) : null;
  const evidenceDir = path.join(auditDirectory, disposition.evidenceRoot, `${first.audit.runId}-${first.sha256.slice(0, 16)}`);
  const archiveName = `abandoned-${safeSegment(first.audit.runId)}-original.json`;
  const archivePath = path.join(evidenceDir, archiveName);

  if (dryRun) {
    return {
      ok: true as const, action: disposition.action, stage: "dry_run" as const, storeKey: store.storeKey, sha256: first.sha256,
      outcome, probe: probeResult, proposedAudit: newAudit, proposedAuditSha256: newSha,
      ...(disposition.facts ? await disposition.facts(store, first.audit) : {}),
      wouldWrite: newAudit ? [evidenceDir, first.activePath] : [evidenceDir, archivePath], wouldRemove: newAudit ? [] : [first.activePath],
    };
  }

  // Evidence (create-only). Existing evidence with different decision-bearing content refuses; identical means resume.
  await mkdir(evidenceDir, { recursive: true });
  const originalPath = path.join(evidenceDir, "original.json");
  const recordPath = path.join(evidenceDir, "record.json");
  if (await createOnly(originalPath, first.bytes) === "existing") {
    const prior = await readRegular(originalPath);
    if (!prior || sha256(prior) !== first.sha256) refuse("evidence_conflict", "证据目录已存在 original.json 且与当前活动清单不同，拒绝覆盖");
  }
  const record = {
    version: 1, action: disposition.action, storeKey: store.storeKey, reason, originalSha256: first.sha256, outcome,
    probe: probeResult, newAudit, newAuditSha256: newSha,
    ...(disposition.facts ? await disposition.facts(store, first.audit) : {}),
    operatorConfirmedAt: (options.now ?? new Date()).toISOString(),
  };
  let resumed = false;
  if (await createOnly(recordPath, serialize(record)) === "existing") {
    const priorBytes = await readRegular(recordPath);
    let prior: Json;
    try { prior = JSON.parse(priorBytes!.toString("utf8")); } catch { refuse("evidence_conflict", "已存在的 record.json 无法解析，失败关闭"); }
    const stable = (value: Json) => JSON.stringify([value.version, value.action, value.storeKey, value.reason, value.originalSha256, value.outcome, value.newAudit ?? null, value.newAuditSha256 ?? null]);
    if (stable(prior) !== stable(record)) refuse("evidence_conflict", "证据目录已存在 record.json 且处理决定与本次不同，拒绝覆盖");
    resumed = true;
  }
  await options.hooks?.afterEvidence?.();

  // Re-check helper idleness and CAS the active bytes right before mutating the control file.
  await helperProbe(store.storeKey);
  const again = await readRegular(first.activePath);
  if (!again || sha256(again) !== first.sha256) refuse("active_changed", "写入前活动清单字节已变化（可能有 helper 正在写入），失败关闭");

  if (newAudit && newText && newSha) {
    await writeJsonAtomic(first.activePath, newAudit);
    const written = await readRegular(first.activePath);
    if (!written || sha256(written) !== newSha) refuse("write_verify_failed", "写入后活动清单字节与证据记录的新清单不一致");
    return {
      ok: true as const, action: disposition.action, stage: "resolved" as const, resumed, storeKey: store.storeKey, outcome,
      originalSha256: first.sha256, newAuditSha256: newSha, evidenceDir,
    };
  }

  if (await exists(archivePath)) refuse("archive_target_exists", "归档目标已存在，拒绝覆盖");
  try { await link(first.activePath, archivePath); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") refuse("archive_target_exists", "归档目标已存在，拒绝覆盖");
    throw error;
  }
  await unlink(first.activePath);
  const archived = await readRegular(archivePath);
  if (!archived || sha256(archived) !== first.sha256) refuse("archive_verify_failed", "归档后字节与原活动清单不一致");
  if (await exists(first.activePath)) refuse("active_reappeared", "归档后活动清单被重新写出，请立即核对 helper 是否仍在运行");
  return {
    ok: true as const, action: disposition.action, stage: "abandoned" as const, resumed, storeKey: store.storeKey, outcome,
    originalSha256: first.sha256, evidenceDir, archivedFile: archivePath,
  };
}

export const resolveSubmittingPromotion = (options: PromotionAdminOptions) => execute(resolveDisposition, options);
export const abandonExpiredPromotion = (options: PromotionAdminOptions) => execute(abandonDisposition, options);

// ---------------------------------------------------------------------------------------------------------
// inspect / probe
// ---------------------------------------------------------------------------------------------------------
export async function inspectPromotionAudit(options: PromotionAdminOptions) {
  const { store, auditDirectory } = await context(options);
  const active = await loadActive(store, auditDirectory);
  if (!active) return { ok: true as const, action: "inspect" as const, storeKey: store.storeKey, active: null };
  const { audit } = active;
  const zip = await localZipEvidence(store, audit);
  const available: Array<{ action: PromotionAdminAction; note?: string }> = [{ action: "probe", note: "只读远端核对任务" }];
  const notes: string[] = [];
  const check = (gate: (audit: DirectPromotionAudit) => void) => { try { gate(audit); return true; } catch { return false; } };
  if (check(resolveGate)) available.push({ action: "resolve-submitting" });
  else if (check(abandonGate)) available.push({ action: "abandon-expired" });
  else if (audit.stage === "failed" && ["downloaded", "importing"].includes(audit.resumeStage ?? "")) notes.push("已有本地文件证据，runner 可续跑，禁止作废");
  else if (audit.stage !== "failed") notes.push("清单不是 failed，无受控处理动作");
  return {
    ok: true as const, action: "inspect" as const, storeKey: store.storeKey,
    active: {
      path: active.activePath, sha256: active.sha256, runId: audit.runId, stage: audit.stage, resumeStage: audit.resumeStage ?? null,
      taskId: audit.taskId ?? null, startDate: audit.startDate, endDate: audit.endDate, reportName: audit.reportName,
      startedAt: audit.startedAt, updatedAt: audit.updatedAt, error: audit.error ?? null,
      file: audit.file ? { present: true, ...(audit.file as Json) } : { present: false },
      localZip: zip,
    },
    availableActions: available, notes,
  };
}

export async function probePromotionAudit(options: PromotionAdminOptions) {
  const { store, auditDirectory, helperProbe, probe } = await context(options);
  const active = await loadActive(store, auditDirectory);
  if (!active) refuse("no_active_audit", "当前店铺不存在推广直连活动清单");
  await helperProbe(store.storeKey);
  const result = await runProbe(probe, active.audit, store);
  return {
    ok: true as const, action: "probe" as const, storeKey: store.storeKey, sha256: active.sha256,
    runId: active.audit.runId, taskId: active.audit.taskId ?? null, reportName: active.audit.reportName, probe: result,
  };
}
