import { env } from "cloudflare:workers";
import { netshopBatchId, sameNetshopBatchIdentity } from "@/lib/netshop/batch-identity";
import { ensureDailyRowNaturalKeys } from "@/lib/netshop/daily-row-migration";

export type NetshopDatabase = NonNullable<typeof env.DB>;

export type NetshopImportIssue = {
  row?: number;
  field?: string;
  code?: string;
  message: string;
};

export type NetshopSource =
  | "jd_shop_overview"
  | "jd_sku_daily"
  | "jd_promotion"
  | "jd_b2b"
  | "jd_product_master"
  | "jd_cs"
  | "jd_yimei_sku"
  | "inv_selfop";

export type NetshopRowInput = {
  sourceRowNumber: number;
  sourceRowKey: string;
  sourceRowHash: string;
  source: NetshopSource;
  dataset: string;
  platform: string;
  shopName: string;
  businessDate: string;
  snapshotDate: string;
  productCode: string;
  productName: string;
  skuId: string;
  spuId: string;
  warehouseType: string;
  metrics: Record<string, number | string | null>;
  raw: Record<string, string | number | boolean | null>;
};

type NetshopBatchRow = {
  id: string;
  source: NetshopSource;
  dataset: string;
  platform: string;
  shop_name: string;
  file_name: string;
  file_size_bytes: number;
  file_hash: string;
  sheet_name: string;
  status: string;
  row_count: number;
  inserted_count: number;
  duplicate_count: number;
  warning_count: number;
  date_min: string | null;
  date_max: string | null;
  snapshot_date: string | null;
  warnings_json: string;
  totals_json: string;
  note: string;
  created_at: string;
  completed_at: string | null;
};

export type NetshopImportBatch = {
  id: string;
  source: NetshopSource;
  dataset: string;
  platform: string;
  shopName: string;
  fileName: string;
  fileSizeBytes: number;
  fileHash: string;
  sheetName: string;
  status: string;
  rowCount: number;
  insertedCount: number;
  duplicateCount: number;
  warningCount: number;
  dateMin: string | null;
  dateMax: string | null;
  snapshotDate: string | null;
  warnings: NetshopImportIssue[];
  totals: unknown;
  note: string;
  createdAt: string;
  completedAt: string | null;
};

export type NetshopOverviewDataset = {
  source: string;
  dataset: string;
  dateMin: string | null;
  dateMax: string | null;
  snapshotDate: string | null;
  rowCount: number;
  latestBatchId: string | null;
  latestFileName: string | null;
  completedAt: string | null;
};

export type NetshopProductCatalogItem = {
  shopName: string;
  skuId: string;
  productCode: string;
  productName: string;
  imageUrl: string;
  saleAttribute: string;
  category: string;
  brand: string;
  price: number | null;
  totalInventory: number | null;
  availableInventory: number | null;
  status: string;
  productUrl: string;
  createdAt: string;
  costPriceCents: number | null;
  netSalesCents: number | null;
  grossMarginRate: number | null;
  refundRate: number | null;
  salesMatched: boolean;
};

export type NetshopProductCatalog = {
  batch: NetshopImportBatch | null;
  summary: {
    totalSkus: number;
    onSaleSkus: number;
    totalInventory: number;
    availableInventory: number;
  };
  shops: Array<{
    shopName: string;
    platform: string;
    snapshotDate: string | null;
    completedAt: string | null;
  }>;
  sales: {
    periodStart: string | null;
    periodEnd: string | null;
    dataCutoffDate: string | null;
    platform: string;
  };
  items: NetshopProductCatalogItem[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
  };
};

export type NetshopProductPerformanceDimension = "sku" | "spu";

export type NetshopProductPerformanceItem = {
  id: string;
  skuId: string;
  spuId: string;
  productCode: string;
  productName: string;
  category: string;
  shopNames: string[];
  dateMin: string | null;
  dateMax: string | null;
  dataDays: number;
  pageViews: number;
  visitors: number;
  searchImpressions: number;
  searchClicks: number;
  searchClickRate: number | null;
  addCartCustomers: number;
  addCartQuantity: number;
  orderCustomers: number;
  orderQuantity: number;
  orderAmount: number;
  transactionOrders: number;
  transactionAmount: number;
  transactionQuantity: number;
  transactionCustomers: number;
  uvValue: number | null;
  conversionRate: number | null;
};

export type NetshopProductPerformance = {
  dimension: NetshopProductPerformanceDimension;
  dataset: "sku_daily" | "spu_daily";
  requestedPeriod: { startDate: string | null; endDate: string | null };
  dateMin: string | null;
  dataCutoffDate: string | null;
  platforms: string[];
  shops: Array<{ shopName: string; platform: string; productCount: number }>;
  summary: {
    productCount: number;
    pageViews: number;
    visitors: number;
    searchImpressions: number;
    searchClicks: number;
    searchClickRate: number | null;
    addCartCustomers: number;
    addCartQuantity: number;
    orderCustomers: number;
    orderQuantity: number;
    orderAmount: number;
    transactionOrders: number;
    transactionAmount: number;
    transactionQuantity: number;
    transactionCustomers: number;
    uvValue: number | null;
    conversionRate: number | null;
  };
  items: NetshopProductPerformanceItem[];
  pagination: { page: number; pageSize: number; total: number };
};

const batchColumns = `
  id, source, dataset, platform, shop_name, file_name, file_size_bytes, file_hash,
  sheet_name, status, row_count, inserted_count, duplicate_count, warning_count,
  date_min, date_max, snapshot_date, warnings_json, totals_json, note,
  created_at, completed_at
`;

const batchTableSql = `CREATE TABLE IF NOT EXISTS netshop_import_batches (
    id TEXT PRIMARY KEY NOT NULL,
    source TEXT NOT NULL,
    dataset TEXT NOT NULL DEFAULT '',
    platform TEXT NOT NULL DEFAULT '',
    shop_name TEXT NOT NULL DEFAULT '',
    file_name TEXT NOT NULL,
    file_size_bytes INTEGER NOT NULL,
    file_hash TEXT NOT NULL,
    sheet_name TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    row_count INTEGER NOT NULL DEFAULT 0,
    inserted_count INTEGER NOT NULL DEFAULT 0,
    duplicate_count INTEGER NOT NULL DEFAULT 0,
    warning_count INTEGER NOT NULL DEFAULT 0,
    date_min TEXT,
    date_max TEXT,
    snapshot_date TEXT,
    warnings_json TEXT NOT NULL DEFAULT '[]',
    totals_json TEXT NOT NULL DEFAULT '{}',
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT,
    UNIQUE(source, platform, shop_name, file_hash)
  )`;

const schemaStatements = [
  batchTableSql,
  `CREATE TABLE IF NOT EXISTS netshop_schema_migrations (
    migration_key TEXT PRIMARY KEY,
    completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS netshop_import_batches_source_created_idx
    ON netshop_import_batches (source, created_at)`,
  `CREATE INDEX IF NOT EXISTS netshop_import_batches_shop_dataset_idx
    ON netshop_import_batches (shop_name, dataset, completed_at)`,
  `CREATE TABLE IF NOT EXISTS netshop_rows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_row_key TEXT NOT NULL UNIQUE,
    source_row_hash TEXT NOT NULL,
    first_import_batch_id TEXT NOT NULL,
    last_import_batch_id TEXT NOT NULL,
    source_row_number INTEGER NOT NULL,
    source TEXT NOT NULL,
    dataset TEXT NOT NULL,
    platform TEXT NOT NULL DEFAULT '',
    shop_name TEXT NOT NULL DEFAULT '',
    business_date TEXT,
    snapshot_date TEXT,
    product_code TEXT NOT NULL DEFAULT '',
    product_name TEXT NOT NULL DEFAULT '',
    sku_id TEXT NOT NULL DEFAULT '',
    spu_id TEXT NOT NULL DEFAULT '',
    warehouse_type TEXT NOT NULL DEFAULT '',
    metrics_json TEXT NOT NULL DEFAULT '{}',
    raw_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS netshop_rows_shop_dataset_date_idx
    ON netshop_rows (shop_name, dataset, business_date)`,
  `CREATE INDEX IF NOT EXISTS netshop_rows_source_date_idx
    ON netshop_rows (source, business_date)`,
  `CREATE INDEX IF NOT EXISTS netshop_rows_snapshot_idx
    ON netshop_rows (source, snapshot_date, warehouse_type)`,
  `CREATE INDEX IF NOT EXISTS netshop_rows_source_sku_idx
    ON netshop_rows (source, sku_id, product_code)`,
  `CREATE INDEX IF NOT EXISTS netshop_rows_sku_id_idx
    ON netshop_rows (sku_id)`,
  `CREATE INDEX IF NOT EXISTS netshop_rows_spu_id_idx
    ON netshop_rows (spu_id)`,
  `CREATE INDEX IF NOT EXISTS netshop_rows_product_code_idx
    ON netshop_rows (product_code)`,
  `UPDATE netshop_rows
    SET platform = '京东', shop_name = '志高商用设备旗舰店', updated_at = CURRENT_TIMESTAMP
    WHERE source = 'jd_product_master'
      AND last_import_batch_id IN (
        SELECT id FROM netshop_import_batches
        WHERE source = 'jd_product_master'
          AND file_name LIKE '%POP%'
          AND shop_name = '特睿思（TERUISI）京东自营旗舰店'
      )`,
  `UPDATE netshop_import_batches
    SET platform = '京东', shop_name = '志高商用设备旗舰店'
    WHERE source = 'jd_product_master'
      AND file_name LIKE '%POP%'
      AND shop_name = '特睿思（TERUISI）京东自营旗舰店'`,
] as const;

const schemaReadyByDatabase = new WeakMap<object, Promise<void>>();

/** Upgrade the historical source+file-hash constraint without altering file_hash itself. */
async function migrateBatchIdentityConstraint(db: NetshopDatabase) {
  type IndexRow = { name: string; unique: number };
  type IndexColumn = { name: string };
  const indexes = await db.prepare("PRAGMA index_list('netshop_import_batches')").all<IndexRow>().catch(() => ({ results: [] as IndexRow[] }));
  let legacyConstraint = false;
  for (const index of indexes.results.filter((item) => Number(item.unique) === 1)) {
    const columns = await db.prepare(`PRAGMA index_info('${index.name.replace(/'/g, "''")}')`).all<IndexColumn>().catch(() => ({ results: [] as IndexColumn[] }));
    if (columns.results.map((column) => column.name).join(",") === "source,file_hash") legacyConstraint = true;
  }
  if (!legacyConstraint) return;
  const legacy = "netshop_import_batches_legacy_scope";
  const replacement = batchTableSql.replace("netshop_import_batches", "netshop_import_batches_scoped_tmp");
  await db.batch([
    db.prepare(`ALTER TABLE netshop_import_batches RENAME TO ${legacy}`),
    db.prepare(replacement),
    db.prepare(`INSERT INTO netshop_import_batches_scoped_tmp (${batchColumns}) SELECT ${batchColumns} FROM ${legacy}`),
    db.prepare(`DROP TABLE ${legacy}`),
    db.prepare("ALTER TABLE netshop_import_batches_scoped_tmp RENAME TO netshop_import_batches"),
  ]);
}

export function getNetshopDatabase(): NetshopDatabase {
  if (!env.DB) {
    throw new Error("Cloudflare D1 binding `DB` is unavailable.");
  }
  return env.DB;
}

export async function ensureNetshopSchema(db = getNetshopDatabase()) {
  const key = db as unknown as object;
  const existing = schemaReadyByDatabase.get(key);
  if (existing) return existing;
  const setup = migrateBatchIdentityConstraint(db)
    .then(() => db.batch(schemaStatements.map((statement) => db.prepare(statement))))
    .then(() => ensureDailyRowNaturalKeys(db))
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

function mapBatch(row: NetshopBatchRow): NetshopImportBatch {
  return {
    id: row.id,
    source: row.source,
    dataset: row.dataset,
    platform: row.platform,
    shopName: row.shop_name,
    fileName: row.file_name,
    fileSizeBytes: Number(row.file_size_bytes),
    fileHash: row.file_hash,
    sheetName: row.sheet_name,
    status: row.status,
    rowCount: Number(row.row_count),
    insertedCount: Number(row.inserted_count),
    duplicateCount: Number(row.duplicate_count),
    warningCount: Number(row.warning_count),
    dateMin: row.date_min,
    dateMax: row.date_max,
    snapshotDate: row.snapshot_date,
    warnings: parseJson<NetshopImportIssue[]>(row.warnings_json, []),
    totals: parseJson<unknown>(row.totals_json, {}),
    note: row.note,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

export function sanitizeNetshopIssues(issues: readonly unknown[]): NetshopImportIssue[] {
  return issues.slice(0, 200).map((issue) => {
    if (typeof issue === "string") return { message: issue.slice(0, 500) };
    if (!issue || typeof issue !== "object") return { message: String(issue).slice(0, 500) };
    const record = issue as Record<string, unknown>;
    const row = Number(record.row ?? record.rowNumber ?? record.sourceRowNumber);
    const safe: NetshopImportIssue = {
      message: String(record.message ?? record.reason ?? record.code ?? "Import warning").slice(0, 500),
    };
    if (Number.isInteger(row) && row > 0) safe.row = row;
    if (typeof record.field === "string") safe.field = record.field.slice(0, 100);
    if (typeof record.code === "string") safe.code = record.code.slice(0, 100);
    return safe;
  });
}

export async function findNetshopImportBatchByHash(
  db: NetshopDatabase,
  source: NetshopSource,
  fileHash: string,
  identity?: { platform: string; shopName: string },
) {
  if (identity) {
    const scoped = await db
      .prepare(`SELECT ${batchColumns} FROM netshop_import_batches WHERE source = ? AND platform = ? AND shop_name = ? AND file_hash = ? LIMIT 1`)
      .bind(source, identity.platform, identity.shopName, fileHash)
      .first<NetshopBatchRow>();
    if (scoped) return mapBatch(scoped);
  }
  const row = await db
    .prepare(`SELECT ${batchColumns} FROM netshop_import_batches WHERE source = ? AND file_hash = ? LIMIT 1`)
    .bind(source, fileHash)
    .first<NetshopBatchRow>();
  const batch = row ? mapBatch(row) : null;
  // Legacy batches were keyed only by source/hash. They remain idempotent only
  // for their recorded owner and must never suppress another shop's import.
  return batch && (!identity || sameNetshopBatchIdentity(batch, { source, ...identity })) ? batch : null;
}

export async function listNetshopImportBatches(db: NetshopDatabase, limit = 20) {
  const result = await db
    .prepare(
      `SELECT ${batchColumns}
       FROM netshop_import_batches
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
    )
    .bind(Math.max(1, Math.min(100, Math.trunc(limit))))
    .all<NetshopBatchRow>();
  return result.results.map(mapBatch);
}

const upsertRowsSql = `
  INSERT INTO netshop_rows (
    source_row_key, source_row_hash, first_import_batch_id, last_import_batch_id,
    source_row_number, source, dataset, platform, shop_name, business_date,
    snapshot_date, product_code, product_name, sku_id, spu_id, warehouse_type,
    metrics_json, raw_json
  )
  SELECT
    json_extract(item.value, '$.sourceRowKey'),
    json_extract(item.value, '$.sourceRowHash'),
    ?, ?,
    CAST(json_extract(item.value, '$.sourceRowNumber') AS INTEGER),
    json_extract(item.value, '$.source'),
    json_extract(item.value, '$.dataset'),
    json_extract(item.value, '$.platform'),
    json_extract(item.value, '$.shopName'),
    NULLIF(json_extract(item.value, '$.businessDate'), ''),
    NULLIF(json_extract(item.value, '$.snapshotDate'), ''),
    json_extract(item.value, '$.productCode'),
    json_extract(item.value, '$.productName'),
    json_extract(item.value, '$.skuId'),
    json_extract(item.value, '$.spuId'),
    json_extract(item.value, '$.warehouseType'),
    json(json_extract(item.value, '$.metrics')),
    json(json_extract(item.value, '$.raw'))
  FROM json_each(?) AS item
  WHERE 1
  ON CONFLICT(source_row_key) DO UPDATE SET
    source_row_hash = excluded.source_row_hash,
    last_import_batch_id = excluded.last_import_batch_id,
    source_row_number = excluded.source_row_number,
    source = excluded.source,
    dataset = excluded.dataset,
    platform = excluded.platform,
    shop_name = excluded.shop_name,
    business_date = excluded.business_date,
    snapshot_date = excluded.snapshot_date,
    product_code = excluded.product_code,
    product_name = excluded.product_name,
    sku_id = excluded.sku_id,
    spu_id = excluded.spu_id,
    warehouse_type = excluded.warehouse_type,
    metrics_json = excluded.metrics_json,
    raw_json = excluded.raw_json,
    updated_at = CURRENT_TIMESTAMP
`;

export async function saveNetshopImport(
  db: NetshopDatabase,
  input: {
    source: NetshopSource;
    dataset: string;
    platform: string;
    shopName: string;
    fileHash: string;
    fileName: string;
    fileSizeBytes: number;
    sheetName: string;
    rows: NetshopRowInput[];
    warnings: NetshopImportIssue[];
    totals: unknown;
    note: string;
  },
): Promise<{ batch: NetshopImportBatch; created: boolean }> {
  const batchId = netshopBatchId(input);
  const dates = input.rows.map((row) => row.businessDate).filter(Boolean).sort();
  const snapshots = input.rows.map((row) => row.snapshotDate).filter(Boolean).sort();
  const dateMin = dates[0] ?? null;
  const dateMax = dates[dates.length - 1] ?? null;
  const snapshotDate = snapshots[snapshots.length - 1] ?? null;
  const statements = [
    db
      .prepare(
        `INSERT INTO netshop_import_batches (
          id, source, dataset, platform, shop_name, file_name, file_size_bytes,
          file_hash, sheet_name, status, row_count, warning_count,
          date_min, date_max, snapshot_date, warnings_json, totals_json, note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'processing', ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source, platform, shop_name, file_hash) DO NOTHING`,
      )
      .bind(
        batchId,
        input.source,
        input.dataset,
        input.platform,
        input.shopName,
        input.fileName,
        input.fileSizeBytes,
        input.fileHash,
        input.sheetName,
        input.rows.length,
        input.warnings.length,
        dateMin,
        dateMax,
        snapshotDate,
        JSON.stringify(input.warnings),
        JSON.stringify(input.totals ?? {}),
        input.note,
      ),
  ];

  for (let offset = 0; offset < input.rows.length; offset += 300) {
    const chunk = input.rows.slice(offset, offset + 300);
    statements.push(db.prepare(upsertRowsSql).bind(batchId, batchId, JSON.stringify(chunk)));
  }

  statements.push(
    db
      .prepare(
        `UPDATE netshop_import_batches
         SET status = 'completed',
             inserted_count = (
               SELECT COUNT(*) FROM netshop_rows WHERE first_import_batch_id = ?
             ),
             duplicate_count = row_count - (
               SELECT COUNT(*) FROM netshop_rows WHERE first_import_batch_id = ?
             ),
             completed_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(batchId, batchId, batchId),
  );

  const result = await db.batch(statements);
  const created = Number(result[0]?.meta?.changes ?? 0) > 0;
  const batch = await findNetshopImportBatchByHash(db, input.source, input.fileHash, input);
  if (!batch) throw new Error("Netshop import batch was not readable after save.");
  return { batch, created };
}

export async function normalizeJdProductMasterRows(
  db: NetshopDatabase,
  batchId: string,
) {
  await db
    .prepare(
      `UPDATE netshop_rows
       SET product_code = COALESCE(NULLIF(CAST(json_extract(raw_json, '$."商品编码"') AS TEXT), ''), product_code),
           spu_id = COALESCE(NULLIF(CAST(json_extract(raw_json, '$."商品编码"') AS TEXT), ''), spu_id),
           updated_at = CURRENT_TIMESTAMP
       WHERE source = 'jd_product_master' AND last_import_batch_id = ?`,
    )
    .bind(batchId)
    .run();
}

export async function getNetshopOverview(db: NetshopDatabase, shop: string | null) {
  const rows = await db
    .prepare(
      `SELECT
         dataset,
         source,
         MIN(business_date) AS date_min,
         MAX(business_date) AS date_max,
         MAX(snapshot_date) AS snapshot_date,
         COUNT(*) AS row_count,
         (
           SELECT b.id
           FROM netshop_import_batches b
           WHERE b.dataset = r.dataset
             AND (? = '' OR b.shop_name = ? OR b.source = 'inv_selfop')
             AND b.status = 'completed'
           ORDER BY b.completed_at DESC, b.created_at DESC
           LIMIT 1
         ) AS latest_batch_id,
         (
           SELECT b.file_name
           FROM netshop_import_batches b
           WHERE b.dataset = r.dataset
             AND (? = '' OR b.shop_name = ? OR b.source = 'inv_selfop')
             AND b.status = 'completed'
           ORDER BY b.completed_at DESC, b.created_at DESC
           LIMIT 1
         ) AS latest_file_name,
         (
           SELECT b.completed_at
           FROM netshop_import_batches b
           WHERE b.dataset = r.dataset
             AND (? = '' OR b.shop_name = ? OR b.source = 'inv_selfop')
             AND b.status = 'completed'
           ORDER BY b.completed_at DESC, b.created_at DESC
           LIMIT 1
         ) AS completed_at
       FROM netshop_rows r
       WHERE (? = '' OR r.shop_name = ? OR r.source = 'inv_selfop')
       GROUP BY dataset, source
       ORDER BY dataset`,
    )
    .bind(shop ?? "", shop ?? "", shop ?? "", shop ?? "", shop ?? "", shop ?? "", shop ?? "", shop ?? "")
    .all<{
      dataset: string;
      source: string;
      date_min: string | null;
      date_max: string | null;
      snapshot_date: string | null;
      row_count: number;
      latest_batch_id: string | null;
      latest_file_name: string | null;
      completed_at: string | null;
    }>();

  const datasets: Record<string, NetshopOverviewDataset> = {};
  for (const row of rows.results) {
    datasets[row.dataset] = {
      source: row.source,
      dataset: row.dataset,
      dateMin: row.date_min,
      dateMax: row.date_max,
      snapshotDate: row.snapshot_date,
      rowCount: Number(row.row_count),
      latestBatchId: row.latest_batch_id,
      latestFileName: row.latest_file_name,
      completedAt: row.completed_at,
    };
  }
  return {
    shop,
    filters: { shop },
    datasets,
    date_max: Object.fromEntries(Object.entries(datasets).map(([key, value]) => [key, value.dateMax])),
  };
}

type NetshopProductRow = {
  shop_name: string;
  sku_id: string;
  product_code: string;
  product_name: string;
  raw_json: string;
  image_raw_json: string | null;
};

type NetshopProductSummaryRow = {
  total_skus: number;
  on_sale_skus: number | null;
  total_inventory: number | null;
  available_inventory: number | null;
};

type NetshopProductSalesMetricRow = {
  sales_product_code: string;
  gross_sales_cents: number | null;
  refund_amount_cents: number | null;
  net_sales_cents: number | null;
  gross_profit_cents: number | null;
  absolute_quantity: number | null;
  absolute_cost_cents: number | null;
};

type NetshopProductSalesMetrics = Pick<
  NetshopProductCatalogItem,
  "costPriceCents" | "netSalesCents" | "grossMarginRate" | "refundRate" | "salesMatched"
>;

type NetshopProductCatalogInternalItem = NetshopProductCatalogItem & {
  salesProductCode: string;
};

function rawText(raw: Record<string, unknown>, key: string) {
  const value = raw[key];
  return value === null || value === undefined ? "" : String(value).trim();
}

function rawNumber(raw: Record<string, unknown>, key: string) {
  const value = raw[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(String(value ?? "").replace(/[￥¥,]/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeImageUrl(value: string) {
  const match = value.trim().match(/(?:https?:)?\/\/[^\s"'<>]+/i);
  if (!match) return "";
  return match[0].startsWith("//") ? `https:${match[0]}` : match[0];
}

function productImageUrl(...rawSources: Array<Record<string, unknown>>) {
  const preferredKeys = [
    "主图链接", "商品主图链接", "SKU主图链接", "图片链接", "商品图片链接",
    "主图", "商品主图", "SKU主图", "图片", "商品图片", "imageUrl", "image_url", "image", "img", "pic",
  ];
  for (const raw of rawSources) {
    for (const key of preferredKeys) {
      const imageUrl = normalizeImageUrl(rawText(raw, key));
      if (imageUrl) return imageUrl;
    }
    for (const [key, value] of Object.entries(raw)) {
      if (!/(主图|图片|image|img|pic)/i.test(key)) continue;
      const imageUrl = normalizeImageUrl(String(value ?? ""));
      if (imageUrl) return imageUrl;
    }
  }
  return "";
}

function isIsoDate(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return date.toISOString().slice(0, 10) === value;
}

function addIsoDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function latestJdProductBatches(db: NetshopDatabase) {
  const rows = await db
    .prepare(
      `SELECT ${batchColumns}
       FROM netshop_import_batches
       WHERE source = 'jd_product_master' AND status = 'completed'
       ORDER BY completed_at DESC, created_at DESC, id DESC`,
    )
    .all<NetshopBatchRow>();
  const latestByShop = new Map<string, NetshopImportBatch>();
  for (const row of rows.results) {
    const batch = mapBatch(row);
    const key = `${batch.platform}\u001f${batch.shopName}`;
    if (!latestByShop.has(key)) latestByShop.set(key, batch);
  }
  return [...latestByShop.values()];
}

function emptyNetshopProductSalesMetrics(): NetshopProductSalesMetrics {
  return {
    costPriceCents: null,
    netSalesCents: null,
    grossMarginRate: null,
    refundRate: null,
    salesMatched: false,
  };
}

async function readJdProductSalesMetrics(
  db: NetshopDatabase,
  salesProductCodes: readonly string[],
  salesStartDate?: string,
  salesEndDate?: string,
) {
  const skuSet = [...new Set(salesProductCodes.map((value) => value.trim()).filter((value) => value && value !== "--"))];
  const salesScope = "京东";
  const dataCutoff = await db
    .prepare(
      `SELECT MAX(substr(ship_time, 1, 10)) AS data_cutoff_date
       FROM sales_order_lines
       WHERE TRIM(warehouse) <> '刷刷仓'
         AND COALESCE(NULLIF(platform, ''), NULLIF(channel, ''), '') LIKE ?`,
    )
    .bind(`${salesScope}%`)
    .first<{ data_cutoff_date: string | null }>();

  if (!isIsoDate(salesStartDate) || !isIsoDate(salesEndDate) || salesStartDate > salesEndDate || skuSet.length === 0) {
    return { metrics: new Map<string, NetshopProductSalesMetrics>(), dataCutoffDate: dataCutoff?.data_cutoff_date ?? null, platform: salesScope };
  }

  const rows = await db
    .prepare(
      `SELECT
         COALESCE(NULLIF(online_spec_code, ''), product_code) AS sales_product_code,
         COALESCE(SUM(CASE WHEN allocated_amount_cents > 0 THEN allocated_amount_cents ELSE 0 END), 0) AS gross_sales_cents,
         COALESCE(SUM(CASE WHEN allocated_amount_cents < 0 THEN -allocated_amount_cents ELSE 0 END), 0) AS refund_amount_cents,
         COALESCE(SUM(allocated_amount_cents), 0) AS net_sales_cents,
         COALESCE(SUM(gross_profit_cents), 0) AS gross_profit_cents,
         COALESCE(SUM(ABS(quantity)), 0) AS absolute_quantity,
         COALESCE(SUM(ABS(cost_amount_cents)), 0) AS absolute_cost_cents
       FROM sales_order_lines
       WHERE ship_time >= ? AND ship_time < ?
         AND TRIM(warehouse) <> '刷刷仓'
         AND product_code <> 'ERP_PRICE_ADJUSTMENT'
         AND TRIM(product_name) <> '补差价专用'
         AND COALESCE(NULLIF(platform, ''), NULLIF(channel, ''), '') LIKE ?
         AND COALESCE(NULLIF(online_spec_code, ''), product_code) IN (${skuSet.map(() => "?").join(", ")})
       GROUP BY COALESCE(NULLIF(online_spec_code, ''), product_code)`,
    )
    .bind(
      `${salesStartDate} 00:00:00`,
      `${addIsoDays(salesEndDate, 1)} 00:00:00`,
      `${salesScope}%`,
      ...skuSet,
    )
    .all<NetshopProductSalesMetricRow>();

  const metrics = new Map<string, NetshopProductSalesMetrics>();
  for (const row of rows.results) {
    const grossSalesCents = Number(row.gross_sales_cents ?? 0);
    const netSalesCents = Number(row.net_sales_cents ?? 0);
    const grossProfitCents = Number(row.gross_profit_cents ?? 0);
    const absoluteQuantity = Number(row.absolute_quantity ?? 0);
    const absoluteCostCents = Number(row.absolute_cost_cents ?? 0);
    metrics.set(row.sales_product_code, {
      costPriceCents: absoluteQuantity > 0 ? absoluteCostCents / absoluteQuantity : null,
      netSalesCents,
      grossMarginRate: netSalesCents !== 0 ? grossProfitCents / netSalesCents : null,
      refundRate: grossSalesCents > 0 ? Number(row.refund_amount_cents ?? 0) / grossSalesCents : null,
      salesMatched: true,
    });
  }
  return { metrics, dataCutoffDate: dataCutoff?.data_cutoff_date ?? null, platform: salesScope };
}

function mapNetshopProductRow(row: NetshopProductRow): NetshopProductCatalogInternalItem {
  const raw = parseJson<Record<string, unknown>>(row.raw_json, {});
  const imageRaw = parseJson<Record<string, unknown>>(row.image_raw_json ?? "{}", {});
  const category = ["一级类目", "二级类目", "三级类目", "末级类目"]
    .map((key) => rawText(raw, key))
    .filter((value) => value && value !== "--")
    .join(" / ");
  return {
    shopName: row.shop_name,
    skuId: row.sku_id || rawText(raw, "SKUID"),
    productCode: rawText(raw, "商品编码") || row.product_code,
    productName: row.product_name || rawText(raw, "商品名称"),
    imageUrl: productImageUrl(raw, imageRaw),
    salesProductCode: rawText(raw, "商家SKU"),
    saleAttribute: rawText(raw, "销售属性"),
    category,
    brand: rawText(raw, "品牌"),
    price: rawNumber(raw, "京东价"),
    totalInventory: rawNumber(raw, "商品总库存"),
    availableInventory: rawNumber(raw, "商品可用库存"),
    status: rawText(raw, "商品状态"),
    productUrl: rawText(raw, "商品链接"),
    createdAt: rawText(raw, "创建时间"),
    ...emptyNetshopProductSalesMetrics(),
  };
}

export async function getNetshopProductCatalog(
  db: NetshopDatabase,
  input: { query?: string; page?: number; pageSize?: number; shopName?: string; shopNames?: string[]; salesStartDate?: string; salesEndDate?: string } = {},
): Promise<NetshopProductCatalog> {
  const page = Math.max(1, Math.trunc(input.page ?? 1));
  const pageSize = Math.max(1, Math.min(100, Math.trunc(input.pageSize ?? 50)));
  const latestBatches = await latestJdProductBatches(db);
  const requestedShopNames = [...new Set([input.shopName ?? "", ...(input.shopNames ?? [])].map((value) => value.trim()).filter(Boolean))];
  const batches = requestedShopNames.length > 0
    ? latestBatches.filter((batch) => requestedShopNames.includes(batch.shopName))
    : latestBatches;
  const batch = batches[0] ?? null;
  const shops = latestBatches
    .map((item) => ({ shopName: item.shopName, platform: item.platform, snapshotDate: item.snapshotDate, completedAt: item.completedAt }))
    .sort((left, right) => left.platform.localeCompare(right.platform, "zh-CN") || left.shopName.localeCompare(right.shopName, "zh-CN"));
  const emptySales = {
    periodStart: isIsoDate(input.salesStartDate) ? input.salesStartDate : null,
    periodEnd: isIsoDate(input.salesEndDate) ? input.salesEndDate : null,
    dataCutoffDate: null,
    platform: "京东",
  };
  if (!batch) {
    return {
      batch: null,
      summary: { totalSkus: 0, onSaleSkus: 0, totalInventory: 0, availableInventory: 0 },
      shops,
      sales: emptySales,
      items: [],
      pagination: { page, pageSize, total: 0 },
    };
  }

  const batchIds = batches.map((item) => item.id);
  const batchClause = `last_import_batch_id IN (${batchIds.map(() => "?").join(", ")})`;

  const summary = await db
    .prepare(
      `SELECT
         COUNT(*) AS total_skus,
         SUM(CASE WHEN json_extract(raw_json, '$."商品状态"') = '上架' THEN 1 ELSE 0 END) AS on_sale_skus,
         SUM(COALESCE(CAST(json_extract(raw_json, '$."商品总库存"') AS REAL), 0)) AS total_inventory,
         SUM(COALESCE(CAST(json_extract(raw_json, '$."商品可用库存"') AS REAL), 0)) AS available_inventory
       FROM netshop_rows
       WHERE ${batchClause}`,
    )
    .bind(...batchIds)
    .first<NetshopProductSummaryRow>();

  const query = (input.query ?? "").trim().slice(0, 120);
  const searchClause = query
    ? " AND (shop_name LIKE ? OR sku_id LIKE ? OR product_code LIKE ? OR product_name LIKE ?)"
    : "";
  const searchTerm = `%${query}%`;
  const bindings = query
    ? [...batchIds, searchTerm, searchTerm, searchTerm, searchTerm]
    : batchIds;
  const totalRow = await db
    .prepare(`SELECT COUNT(*) AS total FROM netshop_rows WHERE ${batchClause}${searchClause}`)
    .bind(...bindings)
    .first<{ total: number }>();
  const offset = (page - 1) * pageSize;
  const rows = await db
    .prepare(
      `SELECT
         product.shop_name,
         product.sku_id,
         product.product_code,
         product.product_name,
         product.raw_json,
         (
           SELECT image_row.raw_json
           FROM netshop_rows image_row
           JOIN netshop_import_batches image_batch
             ON image_batch.id = image_row.last_import_batch_id
           WHERE image_row.source = 'jd_yimei_sku'
             AND image_batch.status = 'completed'
             AND (image_row.shop_name = product.shop_name OR image_row.shop_name = '')
             AND (
               (image_row.sku_id <> '' AND image_row.sku_id = product.sku_id)
               OR (image_row.product_code <> '' AND image_row.product_code = product.product_code)
             )
           ORDER BY image_batch.completed_at DESC, image_batch.created_at DESC, image_row.id DESC
           LIMIT 1
         ) AS image_raw_json
       FROM netshop_rows product
       WHERE ${batchClause}${searchClause}
       ORDER BY product.shop_name ASC, product.product_name ASC, product.sku_id ASC
       LIMIT ? OFFSET ?`,
    )
    .bind(...bindings, pageSize, offset)
    .all<NetshopProductRow>();

  const rawItems = rows.results.map(mapNetshopProductRow);
  const sales = await readJdProductSalesMetrics(
    db,
    rawItems.map((item) => item.salesProductCode),
    input.salesStartDate,
    input.salesEndDate,
  );
  return {
    batch,
    summary: {
      totalSkus: Number(summary?.total_skus ?? 0),
      onSaleSkus: Number(summary?.on_sale_skus ?? 0),
      totalInventory: Number(summary?.total_inventory ?? 0),
      availableInventory: Number(summary?.available_inventory ?? 0),
    },
    shops,
    sales: {
      periodStart: isIsoDate(input.salesStartDate) ? input.salesStartDate : null,
      periodEnd: isIsoDate(input.salesEndDate) ? input.salesEndDate : null,
      dataCutoffDate: sales.dataCutoffDate,
      platform: sales.platform,
    },
    items: rawItems.map(({ salesProductCode, ...item }) => ({
      ...item,
      ...(sales.metrics.get(salesProductCode) ?? emptyNetshopProductSalesMetrics()),
    })),
    pagination: { page, pageSize, total: Number(totalRow?.total ?? 0) },
  };
}

type NetshopProductPerformanceSummaryRow = {
  product_count: number | null;
  date_min: string | null;
  data_cutoff_date: string | null;
  page_views: number | null;
  visitors: number | null;
  search_impressions: number | null;
  search_clicks: number | null;
  add_cart_customers: number | null;
  add_cart_quantity: number | null;
  order_customers: number | null;
  order_quantity: number | null;
  order_amount: number | null;
  transaction_orders: number | null;
  transaction_amount: number | null;
  transaction_quantity: number | null;
  transaction_customers: number | null;
};

type NetshopProductPerformanceRow = {
  id: string;
  sku_id: string;
  spu_id: string;
  product_code: string;
  product_name: string;
  category: string | null;
  shop_names: string | null;
  date_min: string | null;
  date_max: string | null;
  data_days: number | null;
  page_views: number | null;
  visitors: number | null;
  search_impressions: number | null;
  search_clicks: number | null;
  add_cart_customers: number | null;
  add_cart_quantity: number | null;
  order_customers: number | null;
  order_quantity: number | null;
  order_amount: number | null;
  transaction_orders: number | null;
  transaction_amount: number | null;
  transaction_quantity: number | null;
  transaction_customers: number | null;
};

type NetshopProductPerformanceShopRow = {
  shop_name: string;
  platform: string;
  product_count: number | null;
};

const dailyPerformanceMetrics = {
  pageViews: `COALESCE(CAST(json_extract(r.metrics_json, '$."商品浏览量"') AS REAL), 0)`,
  visitors: `COALESCE(CAST(json_extract(r.metrics_json, '$."商品访客数"') AS REAL), 0)`,
  searchImpressions: `COALESCE(CAST(json_extract(r.metrics_json, '$."搜索曝光次数"') AS REAL), 0)`,
  searchClicks: `COALESCE(CAST(json_extract(r.metrics_json, '$."搜索点击次数"') AS REAL), 0)`,
  addCartCustomers: `COALESCE(CAST(json_extract(r.metrics_json, '$."加购客户数"') AS REAL), 0)`,
  addCartQuantity: `COALESCE(CAST(json_extract(r.metrics_json, '$."加购商品件数"') AS REAL), 0)`,
  orderCustomers: `COALESCE(CAST(json_extract(r.metrics_json, '$."下单客户数"') AS REAL), 0)`,
  orderQuantity: `COALESCE(CAST(json_extract(r.metrics_json, '$."下单商品件数"') AS REAL), 0)`,
  orderAmount: `COALESCE(CAST(json_extract(r.metrics_json, '$."下单金额"') AS REAL), 0)`,
  transactionOrders: `COALESCE(CAST(json_extract(r.metrics_json, '$."成交单量"') AS REAL), 0)`,
  transactionAmount: `COALESCE(CAST(json_extract(r.metrics_json, '$."成交金额"') AS REAL), 0)`,
  transactionQuantity: `COALESCE(CAST(json_extract(r.metrics_json, '$."成交商品件数"') AS REAL), 0)`,
  transactionCustomers: `COALESCE(CAST(json_extract(r.metrics_json, '$."成交客户数"') AS REAL), 0)`,
} as const;

function numberFromDailyMetric(value: number | null | undefined) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function dailyPerformanceCategorySql() {
  return `COALESCE(
    NULLIF(json_extract(r.raw_json, '$."三级类目"'), ''),
    NULLIF(json_extract(r.raw_json, '$."二级类目"'), ''),
    NULLIF(json_extract(r.raw_json, '$."一级类目"'), ''),
    ''
  )`;
}

/**
 * Aggregates the imported JD Business Intelligence product-detail workbooks.
 * The data is deliberately read-only: each SKU/SPU day remains the source of
 * truth and is only summed for the selected analysis range.
 */
export async function getNetshopProductPerformance(
  db: NetshopDatabase,
  input: {
    dimension: NetshopProductPerformanceDimension;
    query?: string;
    page?: number;
    pageSize?: number;
    platformNames?: string[];
    shopNames?: string[];
    startDate?: string;
    endDate?: string;
  },
): Promise<NetshopProductPerformance> {
  const page = Math.max(1, Math.trunc(input.page ?? 1));
  const pageSize = Math.max(1, Math.min(100, Math.trunc(input.pageSize ?? 50)));
  const dataset = input.dimension === "sku" ? "sku_daily" : "spu_daily";
  const dimensionSql = input.dimension === "sku" ? "r.sku_id" : "r.spu_id";
  const startDate = isIsoDate(input.startDate) ? input.startDate! : null;
  const endDate = isIsoDate(input.endDate) ? input.endDate! : null;
  const selectedPlatforms = [...new Set((input.platformNames ?? []).map((value) => value.trim()).filter(Boolean))].slice(0, 20);
  const selectedShops = [...new Set((input.shopNames ?? []).map((value) => value.trim()).filter(Boolean))].slice(0, 50);
  const query = (input.query ?? "").trim().slice(0, 120);
  const whereParts = ["r.source = 'jd_sku_daily'", "r.dataset = ?", `${dimensionSql} <> ''`];
  const bindings: string[] = [dataset];

  if (startDate && endDate && startDate <= endDate) {
    whereParts.push("r.business_date >= ?", "r.business_date <= ?");
    bindings.push(startDate, endDate);
  }
  if (selectedPlatforms.length > 0) {
    whereParts.push(`r.platform IN (${selectedPlatforms.map(() => "?").join(", ")})`);
    bindings.push(...selectedPlatforms);
  }
  if (selectedShops.length > 0) {
    whereParts.push(`r.shop_name IN (${selectedShops.map(() => "?").join(", ")})`);
    bindings.push(...selectedShops);
  }
  if (query) {
    whereParts.push(`(${dimensionSql} LIKE ? OR r.sku_id LIKE ? OR r.spu_id LIKE ? OR r.product_code LIKE ? OR r.product_name LIKE ?)`);
    const searchTerm = `%${query}%`;
    bindings.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
  }
  const whereSql = whereParts.join(" AND ");
  const categorySql = dailyPerformanceCategorySql();
  const metric = dailyPerformanceMetrics;
  const summary = await db
    .prepare(
      `SELECT
         COUNT(DISTINCT ${dimensionSql}) AS product_count,
         MIN(r.business_date) AS date_min,
         MAX(r.business_date) AS data_cutoff_date,
         SUM(${metric.pageViews}) AS page_views,
         SUM(${metric.visitors}) AS visitors,
         SUM(${metric.searchImpressions}) AS search_impressions,
         SUM(${metric.searchClicks}) AS search_clicks,
         SUM(${metric.addCartCustomers}) AS add_cart_customers,
         SUM(${metric.addCartQuantity}) AS add_cart_quantity,
         SUM(${metric.orderCustomers}) AS order_customers,
         SUM(${metric.orderQuantity}) AS order_quantity,
         SUM(${metric.orderAmount}) AS order_amount,
         SUM(${metric.transactionOrders}) AS transaction_orders,
         SUM(${metric.transactionAmount}) AS transaction_amount,
         SUM(${metric.transactionQuantity}) AS transaction_quantity,
         SUM(${metric.transactionCustomers}) AS transaction_customers
       FROM netshop_rows r
       WHERE ${whereSql}`,
    )
    .bind(...bindings)
    .first<NetshopProductPerformanceSummaryRow>();

  const totalRow = await db
    .prepare(`SELECT COUNT(DISTINCT ${dimensionSql}) AS total FROM netshop_rows r WHERE ${whereSql}`)
    .bind(...bindings)
    .first<{ total: number | null }>();
  const offset = (page - 1) * pageSize;
  const rows = await db
    .prepare(
      `SELECT
         ${dimensionSql} AS id,
         MAX(r.sku_id) AS sku_id,
         MAX(r.spu_id) AS spu_id,
         MAX(NULLIF(r.product_code, '')) AS product_code,
         MAX(NULLIF(r.product_name, '')) AS product_name,
         MAX(${categorySql}) AS category,
         GROUP_CONCAT(DISTINCT NULLIF(r.shop_name, '')) AS shop_names,
         MIN(r.business_date) AS date_min,
         MAX(r.business_date) AS date_max,
         COUNT(DISTINCT r.business_date) AS data_days,
         SUM(${metric.pageViews}) AS page_views,
         SUM(${metric.visitors}) AS visitors,
         SUM(${metric.searchImpressions}) AS search_impressions,
         SUM(${metric.searchClicks}) AS search_clicks,
         SUM(${metric.addCartCustomers}) AS add_cart_customers,
         SUM(${metric.addCartQuantity}) AS add_cart_quantity,
         SUM(${metric.orderCustomers}) AS order_customers,
         SUM(${metric.orderQuantity}) AS order_quantity,
         SUM(${metric.orderAmount}) AS order_amount,
         SUM(${metric.transactionOrders}) AS transaction_orders,
         SUM(${metric.transactionAmount}) AS transaction_amount,
         SUM(${metric.transactionQuantity}) AS transaction_quantity,
         SUM(${metric.transactionCustomers}) AS transaction_customers
       FROM netshop_rows r
       WHERE ${whereSql}
       GROUP BY ${dimensionSql}
       ORDER BY transaction_amount DESC, visitors DESC, product_name COLLATE NOCASE ASC, id ASC
       LIMIT ? OFFSET ?`,
    )
    .bind(...bindings, pageSize, offset)
    .all<NetshopProductPerformanceRow>();

  const shops = await db
    .prepare(
      `SELECT
         r.shop_name,
         MAX(r.platform) AS platform,
         COUNT(DISTINCT ${dimensionSql}) AS product_count
       FROM netshop_rows r
       WHERE r.source = 'jd_sku_daily'
         AND r.dataset = ?
         AND ${dimensionSql} <> ''
         AND r.shop_name <> ''
       GROUP BY r.shop_name
       ORDER BY r.shop_name COLLATE NOCASE ASC`,
    )
    .bind(dataset)
    .all<NetshopProductPerformanceShopRow>();

  const visitors = numberFromDailyMetric(summary?.visitors);
  const transactionCustomers = numberFromDailyMetric(summary?.transaction_customers);
  const searchImpressions = numberFromDailyMetric(summary?.search_impressions);
  const searchClicks = numberFromDailyMetric(summary?.search_clicks);
  const transactionAmount = numberFromDailyMetric(summary?.transaction_amount);
  const platforms = [...new Set(shops.results.map((shop) => shop.platform.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, "zh-CN"));
  return {
    dimension: input.dimension,
    dataset,
    requestedPeriod: { startDate, endDate },
    dateMin: summary?.date_min ?? null,
    dataCutoffDate: summary?.data_cutoff_date ?? null,
    platforms,
    shops: shops.results.map((shop) => ({
      shopName: shop.shop_name,
      platform: shop.platform || "京东",
      productCount: numberFromDailyMetric(shop.product_count),
    })),
    summary: {
      productCount: numberFromDailyMetric(summary?.product_count),
      pageViews: numberFromDailyMetric(summary?.page_views),
      visitors,
      searchImpressions,
      searchClicks,
      searchClickRate: searchImpressions > 0 ? searchClicks / searchImpressions : null,
      addCartCustomers: numberFromDailyMetric(summary?.add_cart_customers),
      addCartQuantity: numberFromDailyMetric(summary?.add_cart_quantity),
      orderCustomers: numberFromDailyMetric(summary?.order_customers),
      orderQuantity: numberFromDailyMetric(summary?.order_quantity),
      orderAmount: numberFromDailyMetric(summary?.order_amount),
      transactionOrders: numberFromDailyMetric(summary?.transaction_orders),
      transactionAmount,
      transactionQuantity: numberFromDailyMetric(summary?.transaction_quantity),
      transactionCustomers,
      uvValue: visitors > 0 ? transactionAmount / visitors : null,
      conversionRate: visitors > 0 ? transactionCustomers / visitors : null,
    },
    items: rows.results.map((row) => {
      const itemVisitors = numberFromDailyMetric(row.visitors);
      const itemTransactionCustomers = numberFromDailyMetric(row.transaction_customers);
      const itemSearchImpressions = numberFromDailyMetric(row.search_impressions);
      const itemSearchClicks = numberFromDailyMetric(row.search_clicks);
      const itemTransactionAmount = numberFromDailyMetric(row.transaction_amount);
      return {
        id: row.id,
        skuId: row.sku_id,
        spuId: row.spu_id,
        productCode: row.product_code,
        productName: row.product_name,
        category: row.category || "",
        shopNames: (row.shop_names ?? "").split(",").map((value) => value.trim()).filter(Boolean),
        dateMin: row.date_min,
        dateMax: row.date_max,
        dataDays: numberFromDailyMetric(row.data_days),
        pageViews: numberFromDailyMetric(row.page_views),
        visitors: itemVisitors,
        searchImpressions: itemSearchImpressions,
        searchClicks: itemSearchClicks,
        searchClickRate: itemSearchImpressions > 0 ? itemSearchClicks / itemSearchImpressions : null,
        addCartCustomers: numberFromDailyMetric(row.add_cart_customers),
        addCartQuantity: numberFromDailyMetric(row.add_cart_quantity),
        orderCustomers: numberFromDailyMetric(row.order_customers),
        orderQuantity: numberFromDailyMetric(row.order_quantity),
        orderAmount: numberFromDailyMetric(row.order_amount),
        transactionOrders: numberFromDailyMetric(row.transaction_orders),
        transactionAmount: itemTransactionAmount,
        transactionQuantity: numberFromDailyMetric(row.transaction_quantity),
        transactionCustomers: itemTransactionCustomers,
        uvValue: itemVisitors > 0 ? itemTransactionAmount / itemVisitors : null,
        conversionRate: itemVisitors > 0 ? itemTransactionCustomers / itemVisitors : null,
      };
    }),
    pagination: { page, pageSize, total: numberFromDailyMetric(totalRow?.total) },
  };
}
