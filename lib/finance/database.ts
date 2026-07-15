import { env } from "cloudflare:workers";
import type {
  FinanceImportBatch,
  FinanceImportIssue,
  FinanceLineInput,
  FinanceTarget,
  FinanceTargetInput,
  ParsedFinanceWorkbook,
} from "./types";

export const FINANCE_IMPORT_SOURCE = "月度财报 · 志高事业部";
export type FinanceDatabase = NonNullable<typeof env.DB>;

type FinanceImportBatchRow = {
  id: string;
  source: string;
  file_name: string;
  file_size_bytes: number;
  file_hash: string;
  status: string;
  row_count: number;
  inserted_count: number;
  duplicate_count: number;
  warning_count: number;
  parsed_month_count: number;
  imported_month_count: number;
  skipped_month_count: number;
  subject_count: number;
  months_json: string;
  warnings_json: string;
  created_at: string;
  completed_at: string | null;
};

type FinanceTargetRow = {
  id: string;
  period_type: FinanceTarget["periodType"];
  period_key: string;
  shop_name: string;
  category: string;
  manager: string;
  sales_target_cents: number;
  profit_target_cents: number;
  small_margin_bps: number;
  inventory_cleanup_target_cents: number;
  promotion_fee_ratio_bps: number;
  stagnant_inventory_target_cents: number;
  created_at: string;
  updated_at: string;
};

const financeSchemaStatements = [
  `CREATE TABLE IF NOT EXISTS finance_import_batches (
    id TEXT PRIMARY KEY NOT NULL,
    source TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_size_bytes INTEGER NOT NULL,
    file_hash TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL,
    row_count INTEGER NOT NULL DEFAULT 0,
    inserted_count INTEGER NOT NULL DEFAULT 0,
    duplicate_count INTEGER NOT NULL DEFAULT 0,
    warning_count INTEGER NOT NULL DEFAULT 0,
    parsed_month_count INTEGER NOT NULL DEFAULT 0,
    imported_month_count INTEGER NOT NULL DEFAULT 0,
    skipped_month_count INTEGER NOT NULL DEFAULT 0,
    subject_count INTEGER NOT NULL DEFAULT 0,
    months_json TEXT NOT NULL DEFAULT '[]',
    warnings_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS finance_import_batches_created_idx
    ON finance_import_batches (created_at)`,
  `CREATE TABLE IF NOT EXISTS finance_months (
    month TEXT PRIMARY KEY NOT NULL,
    batch_id TEXT NOT NULL,
    sheet_name TEXT NOT NULL,
    business_name TEXT NOT NULL,
    source_file_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'processing',
    shop_count INTEGER NOT NULL DEFAULT 0,
    subject_count INTEGER NOT NULL DEFAULT 0,
    imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS finance_months_status_month_idx
    ON finance_months (status, month)`,
  `CREATE TABLE IF NOT EXISTS finance_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    month TEXT NOT NULL,
    section TEXT NOT NULL,
    metric_key TEXT NOT NULL,
    subject_name TEXT NOT NULL,
    scope_key TEXT NOT NULL,
    scope_type TEXT NOT NULL,
    scope_name TEXT NOT NULL,
    group_name TEXT NOT NULL DEFAULT '',
    value_type TEXT NOT NULL,
    amount_cents INTEGER,
    rate_bps INTEGER,
    raw_value TEXT NOT NULL DEFAULT '',
    source_row_count INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_total INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (month, section, scope_key, subject_name)
  )`,
  `CREATE INDEX IF NOT EXISTS finance_lines_month_section_scope_idx
    ON finance_lines (month, section, scope_type, scope_name)`,
  `CREATE INDEX IF NOT EXISTS finance_lines_metric_month_idx
    ON finance_lines (metric_key, month)`,
  `CREATE INDEX IF NOT EXISTS finance_lines_subject_month_idx
    ON finance_lines (subject_name, month)`,
  `CREATE TABLE IF NOT EXISTS finance_targets (
    id TEXT PRIMARY KEY NOT NULL,
    period_type TEXT NOT NULL,
    period_key TEXT NOT NULL,
    shop_name TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '',
    manager TEXT NOT NULL DEFAULT '',
    sales_target_cents INTEGER NOT NULL DEFAULT 0,
    profit_target_cents INTEGER NOT NULL DEFAULT 0,
    small_margin_bps INTEGER NOT NULL DEFAULT 0,
    inventory_cleanup_target_cents INTEGER NOT NULL DEFAULT 0,
    promotion_fee_ratio_bps INTEGER NOT NULL DEFAULT 0,
    stagnant_inventory_target_cents INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (period_type, period_key, shop_name, category)
  )`,
  `CREATE INDEX IF NOT EXISTS finance_targets_period_idx
    ON finance_targets (period_type, period_key)`,
  `UPDATE finance_lines
   SET amount_cents = COALESCE((
     SELECT SUM(child.amount_cents)
     FROM finance_lines AS child
     WHERE child.month = finance_lines.month
       AND child.section = 'kingdee'
       AND child.scope_key = finance_lines.scope_key
       AND child.subject_name GLOB '销售费用_*'
       AND child.is_total = 0
   ), amount_cents)
   WHERE section = 'kingdee' AND subject_name = '销售费用'`,
] as const;

const batchColumns = `
  id, source, file_name, file_size_bytes, file_hash, status, row_count,
  inserted_count, duplicate_count, warning_count, parsed_month_count,
  imported_month_count, skipped_month_count, subject_count, months_json,
  warnings_json, created_at, completed_at
`;

const targetColumns = `
  id, period_type, period_key, shop_name, category, manager,
  sales_target_cents, profit_target_cents, small_margin_bps,
  inventory_cleanup_target_cents, promotion_fee_ratio_bps,
  stagnant_inventory_target_cents, created_at, updated_at
`;

const schemaReadyByDatabase = new WeakMap<object, Promise<void>>();

export function getFinanceDatabase(): FinanceDatabase {
  if (!env.DB) throw new Error("Cloudflare D1 binding `DB` is unavailable.");
  return env.DB;
}

export async function ensureFinanceSchema(db = getFinanceDatabase()): Promise<void> {
  const key = db as unknown as object;
  const existing = schemaReadyByDatabase.get(key);
  if (existing) return existing;
  const setup = db.batch(financeSchemaStatements.map((statement) => db.prepare(statement)))
    .then(() => undefined)
    .catch((error: unknown) => {
      schemaReadyByDatabase.delete(key);
      throw error;
    });
  schemaReadyByDatabase.set(key, setup);
  return setup;
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function mapBatch(row: FinanceImportBatchRow): FinanceImportBatch {
  return {
    id: row.id,
    source: row.source,
    fileName: row.file_name,
    fileSizeBytes: Number(row.file_size_bytes),
    fileHash: row.file_hash,
    status: row.status,
    rowCount: Number(row.row_count),
    insertedCount: Number(row.inserted_count),
    duplicateCount: Number(row.duplicate_count),
    warningCount: Number(row.warning_count),
    parsedMonthCount: Number(row.parsed_month_count),
    importedMonthCount: Number(row.imported_month_count),
    skippedMonthCount: Number(row.skipped_month_count),
    subjectCount: Number(row.subject_count),
    months: parseJson<string[]>(row.months_json, []),
    warnings: parseJson<FinanceImportIssue[]>(row.warnings_json, []),
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

function mapTarget(row: FinanceTargetRow): FinanceTarget {
  return {
    id: row.id,
    periodType: row.period_type,
    periodKey: row.period_key,
    shopName: row.shop_name,
    category: row.category,
    manager: row.manager,
    salesTargetCents: Number(row.sales_target_cents),
    profitTargetCents: Number(row.profit_target_cents),
    smallMarginBps: Number(row.small_margin_bps),
    inventoryCleanupTargetCents: Number(row.inventory_cleanup_target_cents),
    promotionFeeRatioBps: Number(row.promotion_fee_ratio_bps),
    stagnantInventoryTargetCents: Number(row.stagnant_inventory_target_cents),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function findFinanceImportBatchByHash(db: FinanceDatabase, fileHash: string) {
  const row = await db.prepare(`SELECT ${batchColumns} FROM finance_import_batches WHERE file_hash = ? LIMIT 1`)
    .bind(fileHash)
    .first<FinanceImportBatchRow>();
  return row ? mapBatch(row) : null;
}

export async function listFinanceImportBatches(db: FinanceDatabase, limit = 20) {
  const result = await db.prepare(
    `SELECT ${batchColumns} FROM finance_import_batches
     ORDER BY created_at DESC, id DESC LIMIT ?`,
  ).bind(Math.max(1, Math.min(100, Math.trunc(limit)))).all<FinanceImportBatchRow>();
  return result.results.map(mapBatch);
}

const insertFinanceLinesSql = `
  INSERT INTO finance_lines (
    month, section, metric_key, subject_name, scope_key, scope_type,
    scope_name, group_name, value_type, amount_cents, rate_bps, raw_value,
    source_row_count, sort_order, is_total
  )
  SELECT
    json_extract(item.value, '$.month'),
    json_extract(item.value, '$.section'),
    json_extract(item.value, '$.metricKey'),
    json_extract(item.value, '$.subjectName'),
    json_extract(item.value, '$.scopeKey'),
    json_extract(item.value, '$.scopeType'),
    json_extract(item.value, '$.scopeName'),
    json_extract(item.value, '$.groupName'),
    json_extract(item.value, '$.valueType'),
    CAST(json_extract(item.value, '$.amountCents') AS INTEGER),
    CAST(json_extract(item.value, '$.rateBps') AS INTEGER),
    json_extract(item.value, '$.rawValue'),
    CAST(json_extract(item.value, '$.sourceRowCount') AS INTEGER),
    CAST(json_extract(item.value, '$.sortOrder') AS INTEGER),
    CASE WHEN json_extract(item.value, '$.isTotal') THEN 1 ELSE 0 END
  FROM json_each(?) AS item
  WHERE 1
  ON CONFLICT(month, section, scope_key, subject_name) DO UPDATE SET
    metric_key = excluded.metric_key,
    scope_type = excluded.scope_type,
    scope_name = excluded.scope_name,
    group_name = excluded.group_name,
    value_type = excluded.value_type,
    amount_cents = excluded.amount_cents,
    rate_bps = excluded.rate_bps,
    raw_value = excluded.raw_value,
    source_row_count = excluded.source_row_count,
    sort_order = excluded.sort_order,
    is_total = excluded.is_total
`;

function lineChunks(lines: FinanceLineInput[], size = 300) {
  const chunks: FinanceLineInput[][] = [];
  for (let index = 0; index < lines.length; index += size) chunks.push(lines.slice(index, index + size));
  return chunks;
}

export async function saveFinanceImport(db: FinanceDatabase, input: {
  fileHash: string;
  fileName: string;
  fileSizeBytes: number;
  parsed: ParsedFinanceWorkbook;
}): Promise<{ batch: FinanceImportBatch; created: boolean; importedMonths: string[]; skippedMonths: string[] }> {
  const existingBatch = await findFinanceImportBatchByHash(db, input.fileHash);
  if (existingBatch) {
    return { batch: existingBatch, created: false, importedMonths: [], skippedMonths: existingBatch.months };
  }

  const allMonths = input.parsed.months.map((item) => item.month);
  const warnings = input.parsed.warnings.slice(0, 300);
  const rowCount = input.parsed.months.reduce((sum, item) => sum + item.lines.length, 0);
  const subjectCount = new Set(input.parsed.months.flatMap((item) =>
    item.lines.filter((line) => line.section === "kingdee").map((line) => line.subjectName),
  )).size;
  const inserted = await db.prepare(
    `INSERT INTO finance_import_batches (
      id, source, file_name, file_size_bytes, file_hash, status, row_count,
      warning_count, parsed_month_count, subject_count, months_json, warnings_json
    ) VALUES (?, ?, ?, ?, ?, 'processing', ?, ?, ?, ?, ?, ?)
    ON CONFLICT(file_hash) DO NOTHING`,
  ).bind(
    input.fileHash,
    FINANCE_IMPORT_SOURCE,
    input.fileName,
    input.fileSizeBytes,
    input.fileHash,
    rowCount,
    warnings.length,
    input.parsed.months.length,
    subjectCount,
    JSON.stringify(allMonths),
    JSON.stringify(warnings),
  ).run();
  if (Number(inserted.meta?.changes ?? 0) === 0) {
    const raced = await findFinanceImportBatchByHash(db, input.fileHash);
    if (!raced) throw new Error("财报导入任务创建失败");
    return { batch: raced, created: false, importedMonths: [], skippedMonths: raced.months };
  }

  const importedMonths: string[] = [];
  const skippedMonths: string[] = [];
  let insertedCount = 0;
  try {
    for (const month of input.parsed.months) {
      const existingMonth = await db.prepare(
        `SELECT month, status FROM finance_months WHERE month = ? LIMIT 1`,
      ).bind(month.month).first<{ month: string; status: string }>();
      if (existingMonth?.status === "completed") {
        skippedMonths.push(month.month);
        continue;
      }

      if (existingMonth) {
        await db.batch([
          db.prepare(`DELETE FROM finance_lines WHERE month = ?`).bind(month.month),
          db.prepare(
            `UPDATE finance_months SET batch_id = ?, sheet_name = ?, business_name = ?,
             source_file_name = ?, status = 'processing', shop_count = ?, subject_count = ?,
             imported_at = CURRENT_TIMESTAMP WHERE month = ?`,
          ).bind(input.fileHash, month.sheetName, month.businessName, input.fileName, month.shopCount, month.subjectCount, month.month),
        ]);
      } else {
        const monthInsert = await db.prepare(
          `INSERT INTO finance_months (
            month, batch_id, sheet_name, business_name, source_file_name,
            status, shop_count, subject_count
          ) VALUES (?, ?, ?, ?, ?, 'processing', ?, ?)
          ON CONFLICT(month) DO NOTHING`,
        ).bind(month.month, input.fileHash, month.sheetName, month.businessName, input.fileName, month.shopCount, month.subjectCount).run();
        if (Number(monthInsert.meta?.changes ?? 0) === 0) {
          skippedMonths.push(month.month);
          continue;
        }
      }

      const statements = lineChunks(month.lines).map((chunk) =>
        db.prepare(insertFinanceLinesSql).bind(JSON.stringify(chunk)),
      );
      statements.push(
        db.prepare(`UPDATE finance_months SET status = 'completed', imported_at = CURRENT_TIMESTAMP WHERE month = ?`)
          .bind(month.month),
      );
      await db.batch(statements);
      importedMonths.push(month.month);
      insertedCount += month.lines.length;
    }

    const status = importedMonths.length === 0 ? "duplicate" : skippedMonths.length > 0 ? "partial" : "completed";
    await db.prepare(
      `UPDATE finance_import_batches SET status = ?, inserted_count = ?, duplicate_count = ?,
       imported_month_count = ?, skipped_month_count = ?, completed_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).bind(status, insertedCount, skippedMonths.length, importedMonths.length, skippedMonths.length, input.fileHash).run();
  } catch (error) {
    await db.prepare(
      `UPDATE finance_import_batches SET status = 'failed', inserted_count = ?,
       imported_month_count = ?, skipped_month_count = ?, completed_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).bind(insertedCount, importedMonths.length, skippedMonths.length, input.fileHash).run().catch(() => undefined);
    throw error;
  }

  const batch = await findFinanceImportBatchByHash(db, input.fileHash);
  if (!batch) throw new Error("财报导入完成后无法读取批次");
  return { batch, created: true, importedMonths, skippedMonths };
}

export async function listFinanceTargets(db: FinanceDatabase): Promise<FinanceTarget[]> {
  const result = await db.prepare(
    `SELECT ${targetColumns} FROM finance_targets
     ORDER BY CASE period_type WHEN 'month' THEN 1 WHEN 'year' THEN 2 ELSE 3 END,
              period_key DESC, shop_name, category`,
  ).all<FinanceTargetRow>();
  return result.results.map(mapTarget);
}

export async function upsertFinanceTarget(db: FinanceDatabase, input: FinanceTargetInput & { id: string }) {
  const shopName = input.shopName?.trim() ?? "";
  const category = input.category?.trim() ?? "";
  await db.prepare(
    `INSERT INTO finance_targets (
      id, period_type, period_key, shop_name, category, manager,
      sales_target_cents, profit_target_cents, small_margin_bps,
      inventory_cleanup_target_cents, promotion_fee_ratio_bps,
      stagnant_inventory_target_cents
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(period_type, period_key, shop_name, category) DO UPDATE SET
      manager = excluded.manager,
      sales_target_cents = excluded.sales_target_cents,
      profit_target_cents = excluded.profit_target_cents,
      small_margin_bps = excluded.small_margin_bps,
      inventory_cleanup_target_cents = excluded.inventory_cleanup_target_cents,
      promotion_fee_ratio_bps = excluded.promotion_fee_ratio_bps,
      stagnant_inventory_target_cents = excluded.stagnant_inventory_target_cents,
      updated_at = CURRENT_TIMESTAMP`,
  ).bind(
    input.id,
    input.periodType,
    input.periodKey,
    shopName,
    category,
    input.manager?.trim() ?? "",
    Math.trunc(input.salesTargetCents ?? 0),
    Math.trunc(input.profitTargetCents ?? 0),
    Math.trunc(input.smallMarginBps ?? 0),
    Math.trunc(input.inventoryCleanupTargetCents ?? 0),
    Math.trunc(input.promotionFeeRatioBps ?? 0),
    Math.trunc(input.stagnantInventoryTargetCents ?? 0),
  ).run();
  const row = await db.prepare(
    `SELECT ${targetColumns} FROM finance_targets
     WHERE period_type = ? AND period_key = ? AND shop_name = ? AND category = ? LIMIT 1`,
  ).bind(input.periodType, input.periodKey, shopName, category).first<FinanceTargetRow>();
  if (!row) throw new Error("目标保存后无法读取");
  return mapTarget(row);
}

export async function deleteFinanceTarget(db: FinanceDatabase, id: string) {
  const result = await db.prepare(`DELETE FROM finance_targets WHERE id = ?`).bind(id).run();
  return Number(result.meta?.changes ?? 0) > 0;
}

export async function getFinanceTargetOptions(db: FinanceDatabase) {
  const shopResult = await db.prepare(
    `SELECT DISTINCT scope_name AS value FROM finance_lines
     WHERE scope_type = 'shop' AND TRIM(scope_name) <> '' ORDER BY scope_name`,
  ).all<{ value: string }>();
  let categories: string[] = [];
  try {
    const categoryResult = await db.prepare(
      `SELECT DISTINCT category AS value FROM sales_order_lines
       WHERE TRIM(category) <> '' ORDER BY category LIMIT 300`,
    ).all<{ value: string }>();
    categories = categoryResult.results.map((item) => item.value);
  } catch {
    categories = [];
  }
  return {
    shops: shopResult.results.map((item) => item.value),
    categories,
    projects: ["8系列"],
  };
}
