import { createHash, randomUUID } from "node:crypto";

import { saveMarketImportCore, type MarketEntryForImport } from "@/lib/market/import-core";
import { parseMarketRows } from "@/lib/market/parser";
import { ensureMarketSchemaCore, type MarketSchemaDatabase } from "@/lib/market/schema-core";

type DownloadTask = {
  id: string; category: string; month: string; ranking_dimension: string; status: string;
  attempt_count: number; file_hash: string; import_batch_id: string; staging_batch_id: string;
};

export type MarketDownloadExecutorActor = { email: string; role: string };
export type MarketDownloadExecutorDeps = {
  download?: (task: DownloadTask) => Promise<{ bytes: Uint8Array; fileName: string; jdTaskId?: string }>;
  cacheImages?: (input: { db: MarketSchemaDatabase; task: DownloadTask; batchId: string; rows: MarketEntryForImport[] }) => Promise<{ queued?: number; cached?: number }>;
  createPriceTasks?: (input: { db: MarketSchemaDatabase; task: DownloadTask; batchId: string; rows: MarketEntryForImport[] }) => Promise<{ created?: number }>;
};

function monthEnd(month: string) {
  const [year, value] = month.split("-").map(Number);
  return new Date(Date.UTC(year, value, 0)).toISOString().slice(0, 10);
}

async function audit(db: MarketSchemaDatabase, actor: MarketDownloadExecutorActor, action: string, taskId: string, before: unknown, after: unknown) {
  await db.prepare(`INSERT INTO market_master_audit_logs
    (id, actor_email, actor_role, action, entity_type, entity_id, before_json, after_json)
    VALUES (?, ?, ?, ?, 'market_download_task', ?, ?, ?)`)
    .bind(`market-audit-${randomUUID()}`, actor.email, actor.role, action, taskId, JSON.stringify(before ?? null), JSON.stringify(after ?? null)).run();
}

async function failTask(db: MarketSchemaDatabase, task: DownloadTask, actor: MarketDownloadExecutorActor, code: string, message: string, status: "failed" | "waiting_login") {
  const attempt = Number(task.attempt_count ?? 0) + 1;
  const terminal = status === "failed" && attempt >= 3;
  await db.prepare(`UPDATE market_download_tasks SET status=?, attempt_count=?, error_code=?, error_message=?,
    next_retry_at=?, last_attempt_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .bind(terminal ? "failed" : status, attempt, code, message.slice(0, 800), status === "failed" && !terminal ? new Date(Date.now() + 15 * 60_000).toISOString() : null, task.id).run();
  const after = await db.prepare("SELECT * FROM market_download_tasks WHERE id=?").bind(task.id).first<Record<string, unknown>>();
  await audit(db, actor, "execute_download_task", task.id, task, after);
  return after;
}

export async function executeMarketDownloadTask(db: MarketSchemaDatabase, input: { taskId: string }, actor: MarketDownloadExecutorActor, deps: MarketDownloadExecutorDeps = {}) {
  await ensureMarketSchemaCore(db);
  const task = await db.prepare("SELECT * FROM market_download_tasks WHERE id=? LIMIT 1").bind(input.taskId).first<DownloadTask>();
  if (!task) throw new Error("market download task not found");
  if (task.status === "imported" || task.status === "published") return { status: task.status, duplicate: true, taskId: task.id };
  if (Number(task.attempt_count ?? 0) >= 3) return { status: "failed", terminal: true, taskId: task.id };
  if (!deps.download) return { status: String((await failTask(db, task, actor, "waiting_login", "JD login session is not available", "waiting_login"))?.status ?? "waiting_login"), taskId: task.id, externalValidation: "waiting_login" };

  let downloaded: { bytes: Uint8Array; fileName: string; jdTaskId?: string };
  try {
    downloaded = await deps.download(task);
  } catch (error) {
    const message = error instanceof Error ? error.message : "download failed";
    return { status: String((await failTask(db, task, actor, "download_failed", message, "failed"))?.status ?? "failed"), taskId: task.id };
  }

  const fileHash = createHash("sha256").update(downloaded.bytes).digest("hex");
  try {
    const parsed = parseMarketRows({
      bytes: downloaded.bytes,
      fileName: downloaded.fileName,
      defaultStartDate: `${task.month}-01`,
      defaultEndDate: monthEnd(task.month),
      defaultCategory: task.category,
    });
    const rows = parsed.rows as MarketEntryForImport[];
    const validation = {
      headerValid: 1,
      periodValid: rows.every((row) => row.periodEnd.slice(0, 7) === task.month),
      categoryValid: rows.every((row) => row.category === task.category),
      dimensionValid: rows.every((row) => row.rankingDimension === task.ranking_dimension),
      warningCount: parsed.warnings.length,
    };
    if (!validation.periodValid || !validation.categoryValid || !validation.dimensionValid) throw new Error("download file validation failed");
    const stagingBatchId = `market-staging-${task.id}-${fileHash.slice(0, 16)}`;
    await db.batch(rows.map((row, index) => db.prepare(`INSERT OR IGNORE INTO market_download_staging_rows
      (id, task_id, file_hash, row_number, row_json) VALUES (?, ?, ?, ?, ?)`)
      .bind(`${stagingBatchId}-${index + 1}`, task.id, fileHash, row.sourceRowNumber, JSON.stringify(row))));
    const existingBatch = await db.prepare("SELECT id FROM market_import_batches WHERE file_hash=? LIMIT 1").bind(fileHash).first<{ id: string }>();
    const batchId = existingBatch?.id ?? `market-import-${task.id}-${fileHash.slice(0, 16)}`;
    if (!existingBatch) await saveMarketImportCore({
      db,
      batchId,
      sourceType: "jd_market_download",
      fileName: downloaded.fileName,
      fileSizeBytes: downloaded.bytes.byteLength,
      fileHash,
      sheetName: parsed.sheetName,
      rows,
      warnings: parsed.warnings,
    });
    if (deps.cacheImages) await deps.cacheImages({ db, task, batchId, rows });
    if (deps.createPriceTasks) await deps.createPriceTasks({ db, task, batchId, rows });
    await db.prepare(`UPDATE market_download_tasks SET status='imported', jd_task_id=COALESCE(NULLIF(?,''), jd_task_id),
      source_file_name=?, file_hash=?, row_count=?, header_valid=1, period_valid=1, category_valid=1, dimension_valid=1,
      staging_batch_id=?, import_batch_id=?, validation_json=?, error_code='', error_message='', next_retry_at=NULL,
      last_attempt_at=CURRENT_TIMESTAMP, completed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(downloaded.jdTaskId ?? "", downloaded.fileName, fileHash, rows.length, stagingBatchId, batchId, JSON.stringify(validation), task.id).run();
    const after = await db.prepare("SELECT * FROM market_download_tasks WHERE id=?").bind(task.id).first<Record<string, unknown>>();
    await audit(db, actor, "execute_download_task", task.id, task, after);
    return { status: "imported", duplicate: Boolean(existingBatch), taskId: task.id, batchId, stagingBatchId, rowCount: rows.length, validation };
  } catch (error) {
    const message = error instanceof Error ? error.message : "import execution failed";
    return { status: String((await failTask(db, task, actor, "validation_or_import_failed", message, "failed"))?.status ?? "failed"), taskId: task.id };
  }
}
