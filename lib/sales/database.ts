import { env } from "cloudflare:workers";

export const SALES_IMPORT_SOURCE = "吉客云 ERP · 销售单明细账";
export const SALES_IMPORT_CHUNK_SIZE = 500;

export type SalesDatabase = NonNullable<typeof env.DB>;

export type SalesImportIssue = {
  row?: number;
  column?: string;
  field?: string;
  code?: string;
  message: string;
};

export type SalesLineInput = {
  sourceRowNumber: number;
  sourceLineKey: string;
  sourceRowHash: string;
  orderNo: string;
  onlineOrderNo: string;
  channel: string;
  platform: string;
  shopName: string;
  logisticsCompany: string;
  warehouse: string;
  productCode: string;
  productName: string;
  specification: string;
  barcode: string;
  supplier: string;
  category: string;
  quantity: number;
  listUnitPriceCents: number;
  costAmountCents: number;
  allocatedUnitPriceCents: number;
  allocatedAmountCents: number;
  feeAllocationCents: number;
  grossProfitCents: number;
  grossMarginBps: number;
  untaxedGrossProfitCents: number;
  untaxedGrossMarginBps: number;
  orderTime: string;
  salesTime: string;
  shipTime: string;
  lineShipTime: string;
  businessType: "sale" | "return" | "zero";
};

type ImportBatchRow = {
  id: string;
  source: string;
  file_name: string;
  file_size_bytes: number;
  file_hash: string;
  sheet_name: string;
  status: string;
  row_count: number;
  inserted_count: number;
  duplicate_count: number;
  warning_count: number;
  warnings_json: string;
  totals_json: string;
  created_at: string;
  completed_at: string | null;
};

export type SalesImportBatch = {
  id: string;
  source: string;
  fileName: string;
  fileSizeBytes: number;
  fileHash: string;
  sheetName: string;
  status: string;
  rowCount: number;
  insertedCount: number;
  duplicateCount: number;
  warningCount: number;
  warnings: SalesImportIssue[];
  totals: unknown;
  createdAt: string;
  completedAt: string | null;
};

const batchSelectColumns = `
  id, source, file_name, file_size_bytes, file_hash, sheet_name, status,
  row_count, inserted_count, duplicate_count, warning_count,
  warnings_json, totals_json, created_at, completed_at
`;

// D1's prepare() accepts one statement at a time. Keep every item here as an
// individual statement and use batch() only to reduce network round trips.
const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS sales_import_batches (
    id TEXT PRIMARY KEY NOT NULL,
    source TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_size_bytes INTEGER NOT NULL,
    file_hash TEXT NOT NULL UNIQUE,
    sheet_name TEXT NOT NULL,
    status TEXT NOT NULL,
    row_count INTEGER NOT NULL DEFAULT 0,
    inserted_count INTEGER NOT NULL DEFAULT 0,
    duplicate_count INTEGER NOT NULL DEFAULT 0,
    warning_count INTEGER NOT NULL DEFAULT 0,
    warnings_json TEXT NOT NULL DEFAULT '[]',
    totals_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS sales_import_batches_created_at_idx
    ON sales_import_batches (created_at)`,
  `CREATE TABLE IF NOT EXISTS sales_order_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_line_key TEXT NOT NULL UNIQUE,
    source_row_hash TEXT NOT NULL,
    first_import_batch_id TEXT NOT NULL,
    last_import_batch_id TEXT NOT NULL,
    source_row_number INTEGER NOT NULL,
    order_no TEXT NOT NULL,
    online_order_no TEXT NOT NULL,
    channel TEXT NOT NULL,
    platform TEXT NOT NULL,
    shop_name TEXT NOT NULL,
    logistics_company TEXT NOT NULL,
    warehouse TEXT NOT NULL,
    product_code TEXT NOT NULL,
    product_name TEXT NOT NULL,
    specification TEXT NOT NULL,
    barcode TEXT NOT NULL,
    supplier TEXT NOT NULL,
    category TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    list_unit_price_cents INTEGER NOT NULL,
    cost_amount_cents INTEGER NOT NULL,
    allocated_unit_price_cents INTEGER NOT NULL,
    allocated_amount_cents INTEGER NOT NULL,
    fee_allocation_cents INTEGER NOT NULL,
    gross_profit_cents INTEGER NOT NULL,
    gross_margin_bps INTEGER NOT NULL,
    untaxed_gross_profit_cents INTEGER NOT NULL,
    untaxed_gross_margin_bps INTEGER NOT NULL,
    order_time TEXT NOT NULL,
    sales_time TEXT NOT NULL,
    ship_time TEXT NOT NULL,
    line_ship_time TEXT NOT NULL,
    business_type TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS sales_order_lines_sales_time_idx
    ON sales_order_lines (sales_time)`,
  `CREATE INDEX IF NOT EXISTS sales_order_lines_channel_idx
    ON sales_order_lines (channel)`,
  `CREATE INDEX IF NOT EXISTS sales_order_lines_platform_idx
    ON sales_order_lines (platform)`,
  `CREATE INDEX IF NOT EXISTS sales_order_lines_inventory_demand_idx
    ON sales_order_lines (sales_time, product_code, warehouse)`,
  `CREATE INDEX IF NOT EXISTS sales_order_lines_last_batch_idx
    ON sales_order_lines (last_import_batch_id)`,
  `CREATE TABLE IF NOT EXISTS sales_import_uploads (
    id TEXT PRIMARY KEY NOT NULL,
    fingerprint TEXT NOT NULL UNIQUE,
    file_name TEXT NOT NULL,
    file_size_bytes INTEGER NOT NULL,
    chunk_size_bytes INTEGER NOT NULL,
    chunk_count INTEGER NOT NULL,
    received_chunk_count INTEGER NOT NULL DEFAULT 0,
    received_bytes INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'uploading',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS sales_import_uploads_expires_at_idx
    ON sales_import_uploads (expires_at)`,
  `CREATE TABLE IF NOT EXISTS sales_import_upload_chunks (
    upload_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    object_key TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (upload_id, chunk_index)
  )`,
  `CREATE INDEX IF NOT EXISTS sales_import_upload_chunks_upload_id_idx
    ON sales_import_upload_chunks (upload_id)`,
] as const;

const schemaReadyByDatabase = new WeakMap<object, Promise<void>>();

export function getSalesDatabase(): SalesDatabase {
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Configure `.openai/hosting.json` with `\"d1\": \"DB\"`.",
    );
  }

  return env.DB;
}

export async function ensureSalesSchema(db = getSalesDatabase()): Promise<void> {
  const key = db as unknown as object;
  const existing = schemaReadyByDatabase.get(key);
  if (existing) {
    return existing;
  }

  const setup = db
    .batch(schemaStatements.map((statement) => db.prepare(statement)))
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

function mapBatch(row: ImportBatchRow): SalesImportBatch {
  return {
    id: row.id,
    source: row.source,
    fileName: row.file_name,
    fileSizeBytes: Number(row.file_size_bytes),
    fileHash: row.file_hash,
    sheetName: row.sheet_name,
    status: row.status,
    rowCount: Number(row.row_count),
    insertedCount: Number(row.inserted_count),
    duplicateCount: Number(row.duplicate_count),
    warningCount: Number(row.warning_count),
    warnings: parseJson<SalesImportIssue[]>(row.warnings_json, []),
    totals: parseJson<unknown>(row.totals_json, {}),
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

export function sanitizeSalesIssues(issues: readonly unknown[]): SalesImportIssue[] {
  return issues.slice(0, 200).map((issue) => {
    if (typeof issue === "string") {
      return { message: issue.slice(0, 500) };
    }

    if (!issue || typeof issue !== "object") {
      return { message: String(issue).slice(0, 500) };
    }

    const record = issue as Record<string, unknown>;
    const numericRow = Number(record.row ?? record.rowNumber ?? record.sourceRowNumber);
    const message = String(record.message ?? record.reason ?? record.code ?? "数据校验失败");
    const safe: SalesImportIssue = { message: message.slice(0, 500) };

    if (Number.isInteger(numericRow) && numericRow > 0) safe.row = numericRow;
    if (typeof record.column === "string") safe.column = record.column.slice(0, 100);
    if (typeof record.field === "string") safe.field = record.field.slice(0, 100);
    if (typeof record.code === "string") safe.code = record.code.slice(0, 100);

    return safe;
  });
}

export async function findSalesImportBatchByHash(
  db: SalesDatabase,
  fileHash: string,
): Promise<SalesImportBatch | null> {
  const row = await db
    .prepare(`SELECT ${batchSelectColumns} FROM sales_import_batches WHERE file_hash = ? LIMIT 1`)
    .bind(fileHash)
    .first<ImportBatchRow>();

  return row ? mapBatch(row) : null;
}

export async function findLatestSalesImportBatch(
  db: SalesDatabase,
): Promise<SalesImportBatch | null> {
  const row = await db
    .prepare(
      `SELECT ${batchSelectColumns}
       FROM sales_import_batches
       WHERE status = 'completed'
       ORDER BY completed_at DESC, created_at DESC, id DESC
       LIMIT 1`,
    )
    .first<ImportBatchRow>();

  return row ? mapBatch(row) : null;
}

export async function listSalesImportBatches(
  db: SalesDatabase,
  limit = 20,
): Promise<SalesImportBatch[]> {
  const result = await db
    .prepare(
      `SELECT ${batchSelectColumns}
       FROM sales_import_batches
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
    )
    .bind(Math.max(1, Math.min(100, Math.trunc(limit))))
    .all<ImportBatchRow>();

  return result.results.map(mapBatch);
}

const upsertSalesLinesSql = `
  INSERT INTO sales_order_lines (
    source_row_number, source_line_key, source_row_hash,
    first_import_batch_id, last_import_batch_id,
    order_no, online_order_no, channel, platform, shop_name,
    logistics_company, warehouse, product_code, product_name,
    specification, barcode, supplier, category, quantity,
    list_unit_price_cents, cost_amount_cents, allocated_unit_price_cents,
    allocated_amount_cents, fee_allocation_cents, gross_profit_cents,
    gross_margin_bps, untaxed_gross_profit_cents,
    untaxed_gross_margin_bps, order_time, sales_time, ship_time,
    line_ship_time, business_type
  )
  SELECT
    CAST(json_extract(item.value, '$.sourceRowNumber') AS INTEGER),
    json_extract(item.value, '$.sourceLineKey'),
    json_extract(item.value, '$.sourceRowHash'),
    ?, ?,
    json_extract(item.value, '$.orderNo'),
    json_extract(item.value, '$.onlineOrderNo'),
    json_extract(item.value, '$.channel'),
    json_extract(item.value, '$.platform'),
    json_extract(item.value, '$.shopName'),
    json_extract(item.value, '$.logisticsCompany'),
    json_extract(item.value, '$.warehouse'),
    json_extract(item.value, '$.productCode'),
    json_extract(item.value, '$.productName'),
    json_extract(item.value, '$.specification'),
    json_extract(item.value, '$.barcode'),
    json_extract(item.value, '$.supplier'),
    json_extract(item.value, '$.category'),
    CAST(json_extract(item.value, '$.quantity') AS INTEGER),
    CAST(json_extract(item.value, '$.listUnitPriceCents') AS INTEGER),
    CAST(json_extract(item.value, '$.costAmountCents') AS INTEGER),
    CAST(json_extract(item.value, '$.allocatedUnitPriceCents') AS INTEGER),
    CAST(json_extract(item.value, '$.allocatedAmountCents') AS INTEGER),
    CAST(json_extract(item.value, '$.feeAllocationCents') AS INTEGER),
    CAST(json_extract(item.value, '$.grossProfitCents') AS INTEGER),
    CAST(json_extract(item.value, '$.grossMarginBps') AS INTEGER),
    CAST(json_extract(item.value, '$.untaxedGrossProfitCents') AS INTEGER),
    CAST(json_extract(item.value, '$.untaxedGrossMarginBps') AS INTEGER),
    json_extract(item.value, '$.orderTime'),
    json_extract(item.value, '$.salesTime'),
    json_extract(item.value, '$.shipTime'),
    json_extract(item.value, '$.lineShipTime'),
    json_extract(item.value, '$.businessType')
  FROM json_each(?) AS item
  WHERE 1
  ON CONFLICT(source_line_key) DO UPDATE SET
    source_row_number = excluded.source_row_number,
    source_row_hash = excluded.source_row_hash,
    last_import_batch_id = excluded.last_import_batch_id,
    order_no = excluded.order_no,
    online_order_no = excluded.online_order_no,
    channel = excluded.channel,
    platform = excluded.platform,
    shop_name = excluded.shop_name,
    logistics_company = excluded.logistics_company,
    warehouse = excluded.warehouse,
    product_code = excluded.product_code,
    product_name = excluded.product_name,
    specification = excluded.specification,
    barcode = excluded.barcode,
    supplier = excluded.supplier,
    category = excluded.category,
    quantity = excluded.quantity,
    list_unit_price_cents = excluded.list_unit_price_cents,
    cost_amount_cents = excluded.cost_amount_cents,
    allocated_unit_price_cents = excluded.allocated_unit_price_cents,
    allocated_amount_cents = excluded.allocated_amount_cents,
    fee_allocation_cents = excluded.fee_allocation_cents,
    gross_profit_cents = excluded.gross_profit_cents,
    gross_margin_bps = excluded.gross_margin_bps,
    untaxed_gross_profit_cents = excluded.untaxed_gross_profit_cents,
    untaxed_gross_margin_bps = excluded.untaxed_gross_margin_bps,
    order_time = excluded.order_time,
    sales_time = excluded.sales_time,
    ship_time = excluded.ship_time,
    line_ship_time = excluded.line_ship_time,
    business_type = excluded.business_type,
    updated_at = CURRENT_TIMESTAMP
`;

type SaveSalesImportInput = {
  fileHash: string;
  fileName: string;
  fileSizeBytes: number;
  sheetName: string;
  rows: SalesLineInput[];
  warnings: SalesImportIssue[];
  totals: unknown;
};

export async function saveSalesImport(
  db: SalesDatabase,
  input: SaveSalesImportInput,
): Promise<{ batch: SalesImportBatch; created: boolean }> {
  const batchId = input.fileHash;
  const warningsJson = JSON.stringify(input.warnings);
  const totalsJson = JSON.stringify(input.totals ?? {});
  const statements = [
    db
      .prepare(
        `INSERT INTO sales_import_batches (
          id, source, file_name, file_size_bytes, file_hash, sheet_name,
          status, row_count, warning_count, warnings_json, totals_json
        ) VALUES (?, ?, ?, ?, ?, ?, 'processing', ?, ?, ?, ?)
        ON CONFLICT(file_hash) DO NOTHING`,
      )
      .bind(
        batchId,
        SALES_IMPORT_SOURCE,
        input.fileName,
        input.fileSizeBytes,
        input.fileHash,
        input.sheetName,
        input.rows.length,
        input.warnings.length,
        warningsJson,
        totalsJson,
      ),
  ];

  for (let offset = 0; offset < input.rows.length; offset += SALES_IMPORT_CHUNK_SIZE) {
    const chunk = input.rows.slice(offset, offset + SALES_IMPORT_CHUNK_SIZE);
    statements.push(
      db.prepare(upsertSalesLinesSql).bind(batchId, batchId, JSON.stringify(chunk)),
    );
  }

  statements.push(
    db
      .prepare(
        `UPDATE sales_import_batches
         SET status = 'completed',
             inserted_count = (
               SELECT COUNT(*) FROM sales_order_lines WHERE first_import_batch_id = ?
             ),
             duplicate_count = row_count - (
               SELECT COUNT(*) FROM sales_order_lines WHERE first_import_batch_id = ?
             ),
             completed_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(batchId, batchId, batchId),
  );

  // Cloudflare D1 batch() executes the statements transactionally. A parser or
  // write failure therefore leaves neither a partial batch nor partial facts.
  const results = await db.batch(statements);
  const created = Number(results[0]?.meta?.changes ?? 0) > 0;
  const batch = await findSalesImportBatchByHash(db, input.fileHash);

  if (!batch) {
    throw new Error("销售导入批次写入后无法读取");
  }

  return { batch, created };
}
