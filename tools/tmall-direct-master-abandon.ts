import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, open, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { inspectTmallImportBytes } from "../lib/netshop/normalized-import";
import { getTmallStore, type TmallStore } from "../lib/netshop/tmall-store-registry";
import {
  TMALL_DIRECT_PRODUCT_MASTER_PROTOCOL,
  assertNoLegacyMasterAction,
} from "./tmall-direct-product-master-export";
import { inspectTmallMasterFile, tmallAutomationProjectRoot } from "./tmall-product-master-export";
import { assertTmallDirectMasterStore } from "./tmall-yijiu-direct-pm-contract";

/**
 * Operator-only, narrow exception for the direct (MTOP) product-master audit:
 * a submitted batch was downloaded, but the re-parsed file's product-ID set differs
 * from the submitted batch (the platform returned another batch's/store's file).
 * Nothing here is imported by the helper bundle closure and nothing uses module-URL metadata
 * directly; rules duplicated from tmall-direct-product-master-export.ts are pinned by tests.
 */
export const TMALL_DIRECT_MASTER_CONTENT_MISMATCH_ERROR = "天猫分批商品 XLSX 的商品 ID 集合与提交批次不一致";
export const TMALL_DIRECT_MASTER_ABANDON_ACTION = "abandon-batch-content-mismatch";

const exec = promisify(execFile);
const sha256 = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const byEn = (left: string, right: string) => left.localeCompare(right, "en");

// --- Rules mirrored from tools/tmall-direct-product-master-export.ts (pinned by tests) ---
export function safeSegment(value: string) {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/\s+/g, "-").slice(0, 80);
}
export function activeAuditPath(storeKey: string, directory: string) {
  return path.join(directory, `active-${safeSegment(storeKey)}.json`);
}
export function defaultDirectAuditDirectory() {
  return path.join(tmallAutomationProjectRoot, "outputs", "tmall-direct-product-master-export");
}
export function directBatchFilePath(store: Pick<TmallStore, "shopName" | "browser">, snapshotDate: string, runId: string, index: number) {
  return path.resolve(store.browser.downloadDir,
    `${safeSegment(store.shopName)}-出售中-MTOP-${snapshotDate}-${safeSegment(runId)}-batch-${index}.xlsx`);
}
/** Legacy M audit directories are siblings of the direct audit directory. */
export function legacyAuditDirectories(auditDirectory: string) {
  const outputs = path.dirname(auditDirectory);
  return [path.join(outputs, "tmall-pagewise-product-master-export"), path.join(outputs, "tmall-product-master-export")];
}

type Json = Record<string, any>;
export class DirectMasterAbandonRefusal extends Error {
  constructor(readonly reason: string, message: string) { super(message); }
}
function refuse(reason: string, message: string): never { throw new DirectMasterAbandonRefusal(reason, message); }

export type BatchContentEvidence = {
  filePath: string; fileSha256: string; fileSizeBytes: number; fileRowCount: number;
  expectedItemIds: string[]; actualItemCount: number; actualItemIdsSha256: string; actualItemIdSamples: string[];
};

/** Same parsing and ID-set comparison as inspectBatchFile, but returns the verdict instead of throwing on mismatch. */
export async function inspectBatchContent(input: {
  filePath: string; store: Pick<TmallStore, "shopName" | "browser">; snapshotDate: string; expectedItemIds: readonly string[]; batchIndex: number;
}): Promise<BatchContentEvidence> {
  let evidence: Awaited<ReturnType<typeof inspectTmallMasterFile>>;
  let productIds: string[];
  try {
    evidence = await inspectTmallMasterFile(input.filePath, input.store, input.snapshotDate);
    const bytes = new Uint8Array(await readFile(evidence.filePath));
    const inspection = await inspectTmallImportBytes({
      source: "tmall_product_master", bytes, fileName: evidence.fileName, fileSizeBytes: bytes.byteLength,
      platform: "天猫", shopName: input.store.shopName, snapshotDate: input.snapshotDate,
    });
    if (inspection.errors.length > 0) throw new Error("二次解析失败");
    productIds = inspection.rows.map(row => String((row.raw as Json)["商品ID"] ?? "").trim());
  } catch (error) {
    refuse("batch_file_unparseable", `第 ${input.batchIndex} 批文件无法正常解析，不属于批次内容串单例外：${(error as Error).message.slice(0, 200)}`);
  }
  if (productIds.length === 0 || productIds.some(id => !id)) refuse("batch_file_unparseable", `第 ${input.batchIndex} 批文件存在空商品 ID，不属于批次内容串单例外`);
  const expected = [...input.expectedItemIds].sort(byEn);
  const actual = [...new Set(productIds)].sort(byEn);
  const equal = evidence.uniqueProductCount === expected.length && JSON.stringify(actual) === JSON.stringify(expected);
  if (equal) refuse("batch_content_matches", `第 ${input.batchIndex} 批文件的商品 ID 集合与提交批次一致，不是串单，拒绝作废`);
  // Only a completely foreign file (zero overlap) is cross-batch/cross-store content. A subset (incomplete file),
  // superset or partial overlap is a row-count/completeness problem, which this exception must not cover.
  const expectedSet = new Set(expected);
  if (actual.some(id => expectedSet.has(id))) {
    refuse("batch_content_overlaps", `第 ${input.batchIndex} 批文件的商品 ID 与提交批次部分重叠（子集、超集或部分重叠），属于行数/完整性问题而非串单，拒绝作废`);
  }
  return {
    filePath: evidence.filePath, fileSha256: evidence.sha256, fileSizeBytes: evidence.fileSizeBytes, fileRowCount: evidence.rowCount,
    expectedItemIds: expected, actualItemCount: actual.length, actualItemIdsSha256: sha256(JSON.stringify(actual)),
    actualItemIdSamples: actual.slice(0, 5),
  };
}

function validateAudit(audit: Json, store: TmallStore) {
  if (!audit || audit.version !== 1 || audit.protocol !== TMALL_DIRECT_PRODUCT_MASTER_PROTOCOL
    || audit.storeKey !== store.storeKey || audit.shopName !== store.shopName || !audit.runId
    || !Array.isArray(audit.batches) || !audit.stage) refuse("audit_identity", "天猫 MTOP 货品活动清单结构、协议或店铺身份无效，拒绝作废");
  if (typeof audit.runId !== "string" || !/^[A-Za-z0-9._-]{1,96}$/.test(audit.runId)) refuse("audit_identity", "活动清单 runId 无效");
  if (typeof audit.snapshotDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(audit.snapshotDate)) refuse("audit_identity", "活动清单快照日期无效");
}

function validateGate(audit: Json) {
  if (audit.stage !== "failed" || audit.resumeStage !== "downloading") refuse("stage", `活动清单阶段 ${audit.stage}/${audit.resumeStage} 不是 failed/downloading，拒绝作废`);
  if (audit.error !== TMALL_DIRECT_MASTER_CONTENT_MISMATCH_ERROR) refuse("error_text", "活动清单错误文案不是批次内容串单，拒绝作废");
  if (audit.mergedFile !== undefined || audit.importResult !== undefined) refuse("merged_or_imported", "活动清单已有合并或导入证据，拒绝作废");
  const batches = audit.batches as Json[];
  if (batches.length < 1) refuse("batches", "活动清单没有批次");
  const forbidden = ["baselineRecordIds", "submittedAt", "traceId", "recordId", "file"];
  let k = -1;
  for (const [position, batch] of batches.entries()) {
    if (!batch || batch.index !== position + 1 || !Array.isArray(batch.itemIds) || batch.itemIds.length < 1
      || batch.expectedRows !== batch.itemIds.length) refuse("batch_shape", `第 ${position + 1} 批结构无效`);
    if (k < 0) {
      if (batch.stage === "downloaded") {
        if (!batch.file || typeof batch.file.filePath !== "string" || !/^[a-f0-9]{64}$/.test(String(batch.file.sha256))) {
          refuse("downloaded_without_file", `第 ${batch.index} 批为 downloaded 但缺少文件证据`);
        }
        continue;
      }
      if (batch.stage !== "downloading" || typeof batch.recordId !== "string" || !batch.recordId) {
        refuse("batch_stage", `第 ${batch.index} 批阶段 ${batch.stage} 不是带 recordId 的 downloading，拒绝作废`);
      }
      k = position;
      continue;
    }
    if (batch.stage !== "planned" || forbidden.some(key => batch[key] !== undefined)) {
      refuse("later_batch_evidence", `第 ${batch.index} 批在串单批次之后却不是干净的 planned（submitting/submitted 或带提交证据），拒绝作废`);
    }
  }
  if (k < 0) refuse("no_downloading_batch", "活动清单没有处于 downloading 的批次");
  return k;
}

/** Same absolute PowerShell path as lib/jackyun/json-file.ts; File.Move never replaces its destination. */
async function moveNoReplace(from: string, to: string) {
  if (process.platform !== "win32") {
    const { link, rm } = await import("node:fs/promises");
    await link(from, to); await rm(from); return;
  }
  const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const shell = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  await exec(shell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
    `$ErrorActionPreference='Stop';[System.IO.File]::Move(${quote(from)},${quote(to)})`], { timeout: 15000, windowsHide: true });
}
async function readRegular(file: string): Promise<Buffer | null> {
  const info = await lstat(file).catch(error => { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; });
  if (!info) return null;
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) refuse("control_file_identity", `${path.basename(file)} 不是普通单链接文件`);
  return readFile(file);
}
async function exists(file: string) {
  return lstat(file).then(() => true, error => { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; });
}

/** Best-effort guard against a running helper slot for this store: GET /health only (read-only). */
export async function probeHelperIdleForStore(storeKey: string, fetcher: typeof fetch = fetch, port = 5791) {
  let response: Response;
  try {
    response = await fetcher(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(3000) });
  } catch (error) {
    const code = (error as { cause?: { code?: string } }).cause?.code ?? (error as NodeJS.ErrnoException).code;
    if (code === "ECONNREFUSED") return "helper_not_running" as const;
    refuse("helper_probe_failed", `无法确认 helper 是否空闲（${code ?? (error as Error).message}），拒绝作废`);
  }
  if (!response.ok) refuse("helper_probe_failed", `helper /health 返回 HTTP ${response.status}，拒绝作废`);
  const health = await response.json() as { storeExecutions?: Array<{ storeKey?: string | null; workflow?: string }>; busy?: boolean };
  const executions = Array.isArray(health.storeExecutions) ? health.storeExecutions : null;
  if (!executions) refuse("helper_probe_failed", "helper /health 未返回 storeExecutions，无法确认空闲");
  if (executions.some(slot => slot.workflow === "tmall" && slot.storeKey === storeKey)) {
    refuse("helper_store_active", `helper 正在运行 ${storeKey} 的天猫执行，拒绝作废`);
  }
  return "helper_store_idle" as const;
}

export type AbandonOptions = {
  storeKey: string; reason: string; operatorConfirmed: boolean;
  auditDirectory?: string; now?: Date; dryRun?: boolean;
  /** Test seams. Not exposed by the CLI. */
  store?: TmallStore;
  helperProbe?: (storeKey: string) => Promise<unknown>;
  hooks?: { afterRecord?: () => Promise<void>; beforeMove?: () => Promise<void> };
};

export async function abandonTmallDirectMasterBatchContentMismatch(options: AbandonOptions) {
  const dryRun = options.dryRun === true;
  if (!dryRun && options.operatorConfirmed !== true) refuse("not_confirmed", "作废直连货品批次必须取得操作者明确确认（--confirm）");
  const reason = String(options.reason ?? "").replace(/\s+/g, " ").trim();
  if (reason.length < 4 || reason.length > 300) refuse("reason_length", "作废原因必须为 4 至 300 个字符");
  const store = options.store ?? await getTmallStore(options.storeKey);
  if (store.storeKey !== options.storeKey) refuse("store_identity", "店铺身份不一致");
  assertTmallDirectMasterStore(store.storeKey);
  const auditDirectory = path.resolve(options.auditDirectory ?? defaultDirectAuditDirectory());
  await assertNoLegacyMasterAction(store, legacyAuditDirectories(auditDirectory));

  const activePath = activeAuditPath(store.storeKey, auditDirectory);
  const activeBytes = await readRegular(activePath);
  let audit: Json | null = null;
  if (activeBytes) {
    try { audit = JSON.parse(activeBytes.toString("utf8")); } catch { refuse("audit_unparseable", "活动清单不是合法 JSON"); }
  }
  // The record name needs runId/snapshotDate, which only a valid audit (or an existing record) provides.
  if (!audit) refuse("no_active_audit", "当前店铺不存在可作废的直连货品活动清单（若记录文件已存在且活动清单已移走，说明已完成或需人工核对）");
  validateAudit(audit, store);
  const base = `abandoned-batch-content-mismatch-${safeSegment(store.storeKey)}-${audit.snapshotDate}-${safeSegment(audit.runId)}`;
  const recordPath = path.join(auditDirectory, `${base}.json`);
  const originalPath = path.join(auditDirectory, `${base}-original.json`);
  const activeSha = sha256(activeBytes!);

  // Resume path: the record exists, the active audit is still the one it describes.
  const existingRecord = await readRegular(recordPath);
  if (existingRecord) {
    let record: Json;
    try { record = JSON.parse(existingRecord.toString("utf8")); } catch { refuse("record_unparseable", "已存在的作废记录无法解析，失败关闭"); }
    const { abandonment, ...rest } = record;
    if (!abandonment || abandonment.activeSha256 !== activeSha || abandonment.operatorConfirmed !== true
      || JSON.stringify(rest) !== JSON.stringify(audit)) refuse("record_mismatch", "已存在的作废记录与当前活动清单不一致，失败关闭");
    if (await exists(originalPath)) refuse("archive_target_exists", "归档目标已存在，拒绝覆盖");
    if (dryRun) return { ok: true as const, stage: "dry_run_resume" as const, storeKey: store.storeKey, recordFile: path.basename(recordPath), abandonment };
    await (options.helperProbe ?? probeHelperIdleForStore)(store.storeKey);
    return finishMove({ options, activePath, originalPath, activeSha, recordPath, abandonment, resumed: true, storeKey: store.storeKey, base });
  }

  const k = validateGate(audit);
  const batch = audit.batches[k] as Json;
  const filePath = directBatchFilePath(store, audit.snapshotDate, audit.runId, batch.index);
  if (!await stat(filePath).then(info => info.isFile(), () => false)) refuse("batch_file_missing", `第 ${batch.index} 批本地文件不存在，不属于批次内容串单例外`);
  const content = await inspectBatchContent({ filePath, store, snapshotDate: audit.snapshotDate, expectedItemIds: batch.itemIds, batchIndex: batch.index });

  const verdict = {
    storeKey: store.storeKey, shopName: store.shopName, snapshotDate: audit.snapshotDate, runId: audit.runId,
    batchIndex: batch.index, recordId: batch.recordId, batchCount: audit.batches.length,
    activeSha256: activeSha, ...content,
  };
  if (await exists(originalPath)) refuse("archive_target_exists", "归档目标已存在，拒绝覆盖");
  if (dryRun) return { ok: true as const, stage: "dry_run_abandonable" as const, wouldWrite: [path.basename(recordPath), path.basename(originalPath)], ...verdict };

  await (options.helperProbe ?? probeHelperIdleForStore)(store.storeKey);
  const abandonment = {
    abandonedAt: (options.now ?? new Date()).toISOString(), previousStage: audit.stage, resumeStage: audit.resumeStage, reason,
    batchIndex: batch.index, recordId: batch.recordId, batchFile: { path: content.filePath, sha256: content.fileSha256, sizeBytes: content.fileSizeBytes, rowCount: content.fileRowCount },
    expectedItemIds: content.expectedItemIds, actualItemCount: content.actualItemCount, actualItemIdsSha256: content.actualItemIdsSha256,
    actualItemIdSamples: content.actualItemIdSamples, activeSha256: activeSha, operatorConfirmed: true as const,
  };
  const handle = await open(recordPath, "wx").catch(error => {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") refuse("record_exists", "作废记录已存在，请重新运行以续做");
    throw error;
  });
  try { await handle.writeFile(`${JSON.stringify({ ...audit, abandonment }, null, 2)}\n`); await handle.sync(); } finally { await handle.close(); }
  await options.hooks?.afterRecord?.();
  return finishMove({ options, activePath, originalPath, activeSha, recordPath, abandonment, resumed: false, storeKey: store.storeKey, base });
}

async function finishMove(input: {
  options: AbandonOptions; activePath: string; originalPath: string; activeSha: string; recordPath: string;
  abandonment: Json; resumed: boolean; storeKey: string; base: string;
}) {
  await input.options.hooks?.beforeMove?.();
  // Residual race (no cross-process lock exists for the direct M audit): re-read the bytes right before the move.
  const again = await readRegular(input.activePath);
  if (!again || sha256(again) !== input.activeSha) refuse("active_changed", "移走前活动清单字节已变化（可能有 helper 正在写入），失败关闭");
  if (await exists(input.originalPath)) refuse("archive_target_exists", "归档目标已存在，拒绝覆盖");
  await moveNoReplace(input.activePath, input.originalPath);
  const archived = await readRegular(input.originalPath);
  if (!archived || sha256(archived) !== input.activeSha) refuse("archive_verify_failed", "归档后字节与原活动清单不一致");
  if (await exists(input.activePath)) refuse("active_reappeared", "归档后活动清单被重新写出，请立即核对 helper 是否仍在运行");
  return {
    ok: true as const, stage: "abandoned" as const, resumed: input.resumed, storeKey: input.storeKey,
    recordFile: path.basename(input.recordPath), originalFile: path.basename(input.originalPath),
    batchIndex: input.abandonment.batchIndex, actualItemCount: input.abandonment.actualItemCount,
  };
}
