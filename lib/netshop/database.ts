import { env } from "cloudflare:workers";
import { buildNetshopImportBatchListQuery, type NetshopImportBatchListFilters } from "./import-batch-list-query";
import { netshopBatchId, sameNetshopBatchIdentity } from "@/lib/netshop/batch-identity";
import {
  DAILY_ROW_NATURAL_IDENTITY_INDEX_SQL,
  ensureDailyRowNaturalKeys,
} from "@/lib/netshop/daily-row-migration";
import {
  netshopPromotionMetrics,
  netshopPromotionPaymentSourceSql,
  netshopPromotionProductIdSql,
  netshopPromotionSourceSql,
} from "@/lib/netshop/promotion-query";
import {
  importReservationCommitFence,
  rethrowImportPublishError,
  type ImportReservationFence,
} from "@/lib/imports/content-fingerprint";
import {
  boundedNetshopInteger,
  isNetshopIsoDate,
  NETSHOP_QUERY_MAX_DAYS,
  NETSHOP_QUERY_MAX_PAGE,
  NETSHOP_QUERY_MAX_PAGE_SIZE,
  resolveNetshopQueryPeriod,
  type NetshopQueryPeriod,
} from "@/lib/netshop/query-contract";

export type NetshopDatabase = NonNullable<typeof env.DB>;
export const NETSHOP_DAILY_SERIES_LIMIT = NETSHOP_QUERY_MAX_DAYS;

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
  | "tmall_product_master"
  | "tmall_product_daily"
  | "tmall_promotion"
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
  platform: string;
  shopName: string;
  spuId: string;
  skuId: string;
  productCode: string;
  productName: string;
  imageUrl: string;
  saleAttribute: string;
  category: string;
  brand: string;
  price: number | null;
  priceCents: number | null;
  totalInventory: number | null;
  availableInventory: number | null;
  status: string;
  productUrl: string;
  createdAt: string;
  snapshotDate: string | null;
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
    returned: number;
    truncated: boolean;
  };
};

export type NetshopProductPerformanceDimension = "sku" | "spu";

export type NetshopProductPerformanceItem = {
  id: string;
  platform: string;
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
  orderAmountCents: number;
  transactionOrders: number;
  transactionAmount: number;
  transactionAmountCents: number;
  transactionQuantity: number;
  transactionCustomers: number;
  favorites: number;
  refundAmountCents: number;
  searchVisitors: number;
  searchTransactionCustomers: number;
  uvValue: number | null;
  conversionRate: number | null;
};

export type NetshopProductPerformance = {
  dimension: NetshopProductPerformanceDimension;
  dataset: "sku_daily" | "spu_daily";
  requestedPeriod: { startDate: string | null; endDate: string | null };
  dateMin: string | null;
  dataCutoffDate: string | null;
  monetaryUnit: "cents";
  visitorAggregation: "product_day_sum";
  coverage: {
    actualDates: string[];
    missingDates: string[];
    availableDateMin: string | null;
    availableDateMax: string | null;
    total: number;
    returned: number;
    truncated: boolean;
  };
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
    orderAmountCents: number;
    transactionOrders: number;
    transactionAmount: number;
    transactionAmountCents: number;
    transactionQuantity: number;
    transactionCustomers: number;
    favorites: number;
    refundAmountCents: number;
    searchVisitors: number;
    searchTransactionCustomers: number;
    uvValue: number | null;
    conversionRate: number | null;
  };
  daily: Array<{
    date: string;
    pageViews: number;
    visitors: number;
    transactionCustomers: number;
    transactionQuantity: number;
    transactionAmountCents: number;
    refundAmountCents: number;
    favorites: number;
    addCartCustomers: number;
    addCartQuantity: number;
  }>;
  dailyPagination: { total: number; returned: number; truncated: boolean };
  items: NetshopProductPerformanceItem[];
  pagination: { page: number; pageSize: number; total: number; returned: number; truncated: boolean };
};

export type NetshopPromotionPerformance = {
  monetaryUnit: "cents";
  requestedPeriod: { startDate: string | null; endDate: string | null };
  dateMin: string | null;
  dataCutoffDate: string | null;
  coverage: {
    promotionDates: string[];
    productDailyDates: string[];
    intersectionDates: string[];
    missingProductDailyDates: string[];
    missingPromotionDates: string[];
    promotionDatesPagination: { total: number; returned: number; truncated: boolean };
    productDailyDatesPagination: { total: number; returned: number; truncated: boolean };
    intersectionTruncated: boolean;
  };
  summary: {
    productCount: number;
    spendCents: number;
    netTransactionAmountCents: number;
    grossTransactionAmountCents: number;
    platformPaymentAmountCents: number;
    impressions: number;
    clicks: number;
    netOrders: number;
    favorites: number;
    cartQuantity: number;
    clickThroughRate: number | null;
    averageClickCostCents: number | null;
    roas: number | null;
    spendRate: number | null;
    promotionTransactionShare: number | null;
  };
  daily: Array<{
    date: string;
    spendCents: number;
    netTransactionAmountCents: number;
    platformPaymentAmountCents: number | null;
    impressions: number;
    clicks: number;
    netOrders: number;
    roas: number | null;
    spendRate: number | null;
    promotionTransactionShare: number | null;
  }>;
  items: Array<{
    id: string;
    platform: string;
    productName: string;
    shopName: string;
    dateMin: string | null;
    dateMax: string | null;
    dates: string[];
    datesTruncated: boolean;
    dataDays: number;
    spendCents: number;
    netTransactionAmountCents: number;
    grossTransactionAmountCents: number;
    impressions: number;
    clicks: number;
    netOrders: number;
    favorites: number;
    cartQuantity: number;
    clickThroughRate: number | null;
    averageClickCostCents: number | null;
    roas: number | null;
  }>;
  dailyPagination: { total: number; returned: number; truncated: boolean };
  pagination: { page: number; pageSize: number; total: number; returned: number; truncated: boolean };
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
  `CREATE INDEX IF NOT EXISTS netshop_import_batches_latest_product_idx
    ON netshop_import_batches (source, status, platform, shop_name, completed_at, created_at, id)`,
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
  `CREATE INDEX IF NOT EXISTS netshop_rows_source_dataset_scope_date_idx
    ON netshop_rows (source, dataset, platform, shop_name, business_date)`,
  DAILY_ROW_NATURAL_IDENTITY_INDEX_SQL,
  `CREATE INDEX IF NOT EXISTS netshop_rows_snapshot_idx
    ON netshop_rows (source, snapshot_date, warehouse_type)`,
  `CREATE INDEX IF NOT EXISTS netshop_rows_source_sku_idx
    ON netshop_rows (source, sku_id, product_code)`,
  `CREATE INDEX IF NOT EXISTS netshop_rows_scope_date_product_idx
    ON netshop_rows (dataset, platform, shop_name, business_date, spu_id)`,
  `CREATE INDEX IF NOT EXISTS netshop_rows_master_snapshot_idx
    ON netshop_rows (source, platform, shop_name, snapshot_date)`,
  `CREATE INDEX IF NOT EXISTS netshop_rows_sku_id_idx
    ON netshop_rows (sku_id)`,
  `CREATE INDEX IF NOT EXISTS netshop_rows_spu_id_idx
    ON netshop_rows (spu_id)`,
  `CREATE INDEX IF NOT EXISTS netshop_rows_product_code_idx
    ON netshop_rows (product_code)`,
  `CREATE INDEX IF NOT EXISTS netshop_rows_lock_ownership_idx
    ON netshop_rows (source, dataset, platform, shop_name, last_import_batch_id)`,
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
  const indexes = await db.prepare("PRAGMA index_list('netshop_import_batches')").all<IndexRow>();
  let legacyConstraint = false;
  for (const index of (indexes.results ?? []).filter((item) => Number(item.unique) === 1)) {
    const columns = await db.prepare(`PRAGMA index_info('${index.name.replace(/'/g, "''")}')`).all<IndexColumn>();
    if ((columns.results ?? []).map((column) => column.name).join(",") === "source,file_hash") legacyConstraint = true;
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

export async function findNetshopImportBatchById(
  db: NetshopDatabase,
  id: string,
) {
  const row = await db
    .prepare(`SELECT ${batchColumns} FROM netshop_import_batches WHERE id = ? LIMIT 1`)
    .bind(id)
    .first<NetshopBatchRow>();
  return row ? mapBatch(row) : null;
}

export async function readNetshopScopeOwnership(
  db: NetshopDatabase,
  input: {
    source: NetshopSource;
    dataset: string;
    platform: string;
    shopName: string;
    startDate?: string | null;
    endDate?: string | null;
    snapshotDate?: string | null;
    fullScope?: boolean;
  },
) {
  if (input.startDate && input.endDate) {
    const result = await db.prepare(
      `SELECT last_import_batch_id AS batch_id, COUNT(*) AS row_count
       FROM netshop_rows
       WHERE source = ? AND dataset = ? AND platform = ? AND shop_name = ?
         AND business_date >= ? AND business_date <= ?
       GROUP BY last_import_batch_id
       ORDER BY last_import_batch_id`,
    ).bind(
      input.source,
      input.dataset,
      input.platform,
      input.shopName,
      input.startDate,
      input.endDate,
    ).all<{ batch_id: string; row_count: number }>();
    return result.results.map((row) => ({ batchId: row.batch_id, rowCount: Number(row.row_count) }));
  }
  const snapshotClause = input.snapshotDate ? " AND snapshot_date = ?" : "";
  const bindings: string[] = [input.source, input.dataset, input.platform, input.shopName];
  if (input.snapshotDate) bindings.push(input.snapshotDate);
  const result = await db.prepare(
    `SELECT last_import_batch_id AS batch_id, COUNT(*) AS row_count
     FROM netshop_rows
     WHERE source = ? AND dataset = ? AND platform = ? AND shop_name = ?${snapshotClause}
     GROUP BY last_import_batch_id
     ORDER BY last_import_batch_id`,
  ).bind(...bindings).all<{ batch_id: string; row_count: number }>();
  return result.results.map((row) => ({ batchId: row.batch_id, rowCount: Number(row.row_count) }));
}

type NetshopStoredContentRow = {
  source_row_number: number;
  source_row_key: string;
  source_row_hash: string;
  source: NetshopSource;
  dataset: string;
  platform: string;
  shop_name: string;
  business_date: string | null;
  snapshot_date: string | null;
  product_code: string;
  product_name: string;
  sku_id: string;
  spu_id: string;
  warehouse_type: string;
  metrics_json: string;
  raw_json: string;
};

/**
 * Reads the currently published business facts for an exact import scope.
 * This is used only for a duplicate candidate so the caller can recompute the
 * normalized content fingerprint instead of trusting batch ownership/counts.
 */
export async function readNetshopScopeRows(
  db: NetshopDatabase,
  input: {
    source: NetshopSource;
    dataset: string;
    platform: string;
    shopName: string;
    startDate?: string | null;
    endDate?: string | null;
    snapshotDate?: string | null;
    fullScope?: boolean;
  },
): Promise<NetshopRowInput[]> {
  const where = ["source = ?", "dataset = ?", "platform = ?", "shop_name = ?"];
  const bindings: string[] = [input.source, input.dataset, input.platform, input.shopName];
  if (input.startDate && input.endDate) {
    where.push("business_date >= ?", "business_date <= ?");
    bindings.push(input.startDate, input.endDate);
  } else if (input.snapshotDate) {
    where.push("snapshot_date = ?");
    bindings.push(input.snapshotDate);
  }
  const result = await db.prepare(
    `SELECT source_row_number, source_row_key, source_row_hash, source, dataset,
            platform, shop_name, business_date, snapshot_date, product_code,
            product_name, sku_id, spu_id, warehouse_type, metrics_json, raw_json
     FROM netshop_rows
     WHERE ${where.join(" AND ")}
     ORDER BY id`,
  ).bind(...bindings).all<NetshopStoredContentRow>();
  return result.results.map((row) => ({
    sourceRowNumber: Number(row.source_row_number),
    sourceRowKey: row.source_row_key,
    sourceRowHash: row.source_row_hash,
    source: row.source,
    dataset: row.dataset,
    platform: row.platform,
    shopName: row.shop_name,
    businessDate: row.business_date ?? "",
    snapshotDate: row.snapshot_date ?? "",
    productCode: row.product_code,
    productName: row.product_name,
    skuId: row.sku_id,
    spuId: row.spu_id,
    warehouseType: row.warehouse_type,
    metrics: parseJson<Record<string, number | string | null>>(
      row.metrics_json,
      { __invalidStoredJson: row.metrics_json },
    ),
    raw: parseJson<Record<string, string | number | boolean | null>>(
      row.raw_json,
      { __invalidStoredJson: row.raw_json },
    ),
  }));
}

export async function listNetshopImportBatches(
  db: NetshopDatabase,
  input: NetshopImportBatchListFilters = {},
) {
  const { page, pageSize, offset, whereSql, bindings } = buildNetshopImportBatchListQuery(input);
  const where = whereSql ? `WHERE ${whereSql}` : "";
  const [result, count] = await Promise.all([
    db.prepare(
      `SELECT ${batchColumns}
       FROM netshop_import_batches
       ${where}
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`,
    )
      .bind(...bindings, pageSize, offset)
      .all<NetshopBatchRow>(),
    db.prepare(`SELECT COUNT(*) AS total FROM netshop_import_batches ${where}`)
      .bind(...bindings)
      .first<{ total: number }>(),
  ]);
  const items = result.results.map(mapBatch);
  const total = Number(count?.total ?? 0);
  return {
    items,
    pagination: {
      page,
      pageSize,
      total,
      returned: items.length,
      truncated: offset + items.length < total,
    },
  };
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
  WHERE EXISTS (
    SELECT 1 FROM netshop_import_batches
    WHERE id = ? AND status = 'processing'
  )
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
    replaceScope?: { startDate: string; endDate: string } | { snapshotDate: string } | { fullScope: true };
    reservationFence?: ImportReservationFence;
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

  if (input.replaceScope && "startDate" in input.replaceScope) {
    statements.push(
      db.prepare(
        `DELETE FROM netshop_rows
         WHERE source = ? AND dataset = ? AND platform = ? AND shop_name = ?
           AND business_date >= ? AND business_date <= ?
           AND EXISTS (
             SELECT 1 FROM netshop_import_batches
             WHERE id = ? AND status = 'processing'
           )`,
      ).bind(
        input.source,
        input.dataset,
        input.platform,
        input.shopName,
        input.replaceScope.startDate,
        input.replaceScope.endDate,
        batchId,
      ),
    );
  } else if (input.replaceScope && "snapshotDate" in input.replaceScope) {
    statements.push(
      db.prepare(
        `DELETE FROM netshop_rows
         WHERE source = ? AND dataset = ? AND platform = ? AND shop_name = ?
           AND snapshot_date = ?
           AND EXISTS (
             SELECT 1 FROM netshop_import_batches
             WHERE id = ? AND status = 'processing'
           )`,
      ).bind(
        input.source,
        input.dataset,
        input.platform,
        input.shopName,
        input.replaceScope.snapshotDate,
        batchId,
      ),
    );
  } else if (input.replaceScope?.fullScope) {
    statements.push(
      db.prepare(
        `DELETE FROM netshop_rows
         WHERE source = ? AND dataset = ? AND platform = ? AND shop_name = ?
           AND EXISTS (
             SELECT 1 FROM netshop_import_batches
             WHERE id = ? AND status = 'processing'
           )`,
      ).bind(input.source, input.dataset, input.platform, input.shopName, batchId),
    );
  }

  for (let offset = 0; offset < input.rows.length; offset += 300) {
    const chunk = input.rows.slice(offset, offset + 300);
    statements.push(db.prepare(upsertRowsSql).bind(batchId, batchId, JSON.stringify(chunk), batchId));
  }

  if (input.source === "jd_product_master") {
    statements.push(db.prepare(
      `UPDATE netshop_rows
       SET product_code = COALESCE(NULLIF(CAST(json_extract(raw_json, '$."商品编码"') AS TEXT), ''), product_code),
           spu_id = COALESCE(NULLIF(CAST(json_extract(raw_json, '$."商品编码"') AS TEXT), ''), spu_id),
           updated_at = CURRENT_TIMESTAMP
       WHERE source = 'jd_product_master' AND last_import_batch_id = ?
         AND EXISTS (
           SELECT 1 FROM netshop_import_batches
           WHERE id = ? AND status = 'processing'
         )`,
    ).bind(batchId, batchId));
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
         WHERE id = ? AND status = 'processing'`,
      )
      .bind(batchId, batchId, batchId),
  );
  if (input.reservationFence) statements.push(importReservationCommitFence(db, input.reservationFence));

  let result;
  try {
    result = await db.batch(statements);
  } catch (error) {
    if (input.reservationFence) {
      await rethrowImportPublishError(db, input.reservationFence, error);
    }
    throw error;
  }
  const created = Number(result[0]?.meta?.changes ?? 0) > 0;
  const batch = await findNetshopImportBatchByHash(db, input.source, input.fileHash, input);
  if (!batch) throw new Error("Netshop import batch was not readable after save.");
  return { batch, created };
}

export async function verifyNetshopImportBatch(
  db: NetshopDatabase,
  batch: NetshopImportBatch,
  expected: { rowCount: number; dataset: string; platform: string; shopName: string; dateMin: string | null; dateMax: string | null },
) {
  const row = await db.prepare(
    `SELECT COUNT(*) AS row_count, MIN(business_date) AS date_min, MAX(business_date) AS date_max
     FROM netshop_rows WHERE last_import_batch_id = ?`,
  ).bind(batch.id).first<{ row_count: number | null; date_min: string | null; date_max: string | null }>();
  const readbackRowCount = Number(row?.row_count ?? 0);
  const scoped = expected.dateMin && expected.dateMax
    ? await db.prepare(
      `SELECT COUNT(*) AS row_count
       FROM netshop_rows
       WHERE source = ? AND dataset = ? AND platform = ? AND shop_name = ?
         AND business_date >= ? AND business_date <= ?`,
    ).bind(
      batch.source,
      expected.dataset,
      expected.platform,
      expected.shopName,
      expected.dateMin,
      expected.dateMax,
    ).first<{ row_count: number | null }>()
    : null;
  const currentScopeRowCount = scoped ? Number(scoped.row_count ?? 0) : readbackRowCount;
  const verified = batch.status === "completed"
    && batch.dataset === expected.dataset
    && batch.platform === expected.platform
    && batch.shopName === expected.shopName
    && batch.rowCount === expected.rowCount
    && readbackRowCount === expected.rowCount
    && currentScopeRowCount === expected.rowCount
    && (row?.date_min ?? null) === expected.dateMin
    && (row?.date_max ?? null) === expected.dateMax;
  return {
    verified,
    parsedRowCount: expected.rowCount,
    readbackRowCount,
    currentScopeRowCount,
    dateMin: row?.date_min ?? null,
    dateMax: row?.date_max ?? null,
    dataset: batch.dataset,
    platform: batch.platform,
    shopName: batch.shopName,
  };
}

export async function reconcileNetshopMasterProducts(
  db: NetshopDatabase,
  input: { platform: string; shopName: string; productIds: string[] },
) {
  const productIds = [...new Set(input.productIds.map((value) => value.trim()).filter(Boolean))].slice(0, 20_000);
  const latest = await db.prepare(
    `SELECT id FROM netshop_import_batches
     WHERE source = 'tmall_product_master' AND platform = ? AND shop_name = ? AND status = 'completed'
     ORDER BY completed_at DESC, created_at DESC, id DESC LIMIT 1`,
  ).bind(input.platform, input.shopName).first<{ id: string }>();
  if (!latest?.id) return { masterAvailable: false, unmatchedCount: productIds.length, unmatchedSample: productIds.slice(0, 20) };
  const result = await db.prepare(
    `WITH requested(id) AS (SELECT CAST(value AS TEXT) FROM json_each(?))
     SELECT requested.id
     FROM requested
     LEFT JOIN netshop_rows master
       ON master.last_import_batch_id = ? AND master.spu_id = requested.id
     WHERE master.id IS NULL
     LIMIT 21`,
  ).bind(JSON.stringify(productIds), latest.id).all<{ id: string }>();
  const countRow = await db.prepare(
    `WITH requested(id) AS (SELECT CAST(value AS TEXT) FROM json_each(?))
     SELECT COUNT(*) AS count
     FROM requested
     WHERE NOT EXISTS (
       SELECT 1 FROM netshop_rows master
       WHERE master.last_import_batch_id = ? AND master.spu_id = requested.id
     )`,
  ).bind(JSON.stringify(productIds), latest.id).first<{ count: number }>();
  return {
    masterAvailable: true,
    unmatchedCount: Number(countRow?.count ?? 0),
    unmatchedSample: result.results.slice(0, 20).map((row) => row.id),
  };
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

export async function getNetshopOverview(db: NetshopDatabase, shop: string | null, platformNames: string[] = []) {
  const platforms = [...new Set(platformNames.map((value) => value.trim()).filter(Boolean))].slice(0, 20);
  const platformClause = platforms.length ? ` AND r.platform IN (${platforms.map(() => "?").join(", ")})` : "";
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
            WHERE b.dataset = r.dataset AND b.source = r.source AND b.platform = r.platform
             AND (? = '' OR b.shop_name = ? OR b.source = 'inv_selfop')
             AND b.status = 'completed'
           ORDER BY b.completed_at DESC, b.created_at DESC
           LIMIT 1
         ) AS latest_batch_id,
         (
           SELECT b.file_name
           FROM netshop_import_batches b
            WHERE b.dataset = r.dataset AND b.source = r.source AND b.platform = r.platform
             AND (? = '' OR b.shop_name = ? OR b.source = 'inv_selfop')
             AND b.status = 'completed'
           ORDER BY b.completed_at DESC, b.created_at DESC
           LIMIT 1
         ) AS latest_file_name,
         (
           SELECT b.completed_at
           FROM netshop_import_batches b
            WHERE b.dataset = r.dataset AND b.source = r.source AND b.platform = r.platform
             AND (? = '' OR b.shop_name = ? OR b.source = 'inv_selfop')
             AND b.status = 'completed'
           ORDER BY b.completed_at DESC, b.created_at DESC
           LIMIT 1
         ) AS completed_at
       FROM netshop_rows r
        WHERE (? = '' OR r.shop_name = ? OR r.source = 'inv_selfop')${platformClause}
        GROUP BY dataset, source, platform
       ORDER BY dataset`,
    )
    .bind(shop ?? "", shop ?? "", shop ?? "", shop ?? "", shop ?? "", shop ?? "", shop ?? "", shop ?? "", ...platforms)
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
  source: NetshopSource;
  platform: string;
  shop_name: string;
  snapshot_date: string | null;
  spu_id: string;
  sku_id: string;
  product_code: string;
  product_name: string;
  metrics_json: string;
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

const isIsoDate = isNetshopIsoDate;

function addIsoDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dailyDateCoverageForQuery(startDate: string, endDate: string, actualValues: readonly string[]) {
  const actualDates = [...new Set(actualValues.filter(Boolean))].sort();
  const actual = new Set(actualDates);
  const missingDates: string[] = [];
  for (let date = startDate; date <= endDate; date = addIsoDays(date, 1)) {
    if (!actual.has(date)) missingDates.push(date);
  }
  return { actualDates, missingDates };
}

async function latestProductBatches(db: NetshopDatabase) {
  const rows = await db
    .prepare(
      `WITH ranked AS (
         SELECT ${batchColumns},
           ROW_NUMBER() OVER (
             PARTITION BY platform,shop_name
             ORDER BY completed_at DESC,created_at DESC,id DESC
           ) AS scope_rank
         FROM netshop_import_batches
         WHERE source IN ('jd_product_master','tmall_product_master') AND status='completed'
       )
       SELECT ${batchColumns} FROM ranked WHERE scope_rank=1
       ORDER BY completed_at DESC,created_at DESC,id DESC`,
    )
    .all<NetshopBatchRow>();
  return rows.results.map(mapBatch);
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
  salesPeriod: NetshopQueryPeriod | null,
) {
  const skuSet = [...new Set(salesProductCodes.map((value) => value.trim()).filter((value) => value && value !== "--"))];
  const salesScope = "京东";
  const dataCutoff = await db
    .prepare(
      `SELECT substr(ship_time, 1, 10) AS data_cutoff_date
       FROM sales_order_lines
       WHERE ship_time<>'' AND TRIM(warehouse) <> '刷刷仓'
         AND COALESCE(NULLIF(platform, ''), NULLIF(channel, ''), '') LIKE ?
       ORDER BY ship_time DESC
       LIMIT 1`,
    )
    .bind(`${salesScope}%`)
    .first<{ data_cutoff_date: string | null }>();

  if (!salesPeriod || skuSet.length === 0) {
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
         AND COALESCE(NULLIF(online_spec_code, ''), product_code)
           IN (SELECT CAST(value AS TEXT) FROM json_each(?))
       GROUP BY COALESCE(NULLIF(online_spec_code, ''), product_code)`,
    )
    .bind(
      `${salesPeriod.startDate} 00:00:00`,
      `${salesPeriod.endExclusive} 00:00:00`,
      `${salesScope}%`,
      JSON.stringify(skuSet),
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
  const category = [rawText(raw, "类目名称"), ...["一级类目", "二级类目", "三级类目", "末级类目"].map((key) => rawText(raw, key))]
    .filter((value) => value && value !== "--")
    .join(" / ");
  const metrics = parseJson<Record<string, unknown>>(row.metrics_json, {});
  const priceCents = typeof metrics.skuPriceCents === "number" ? metrics.skuPriceCents : rawNumber(raw, "SKU价格") !== null ? Math.round(Number(rawNumber(raw, "SKU价格")) * 100) : null;
  const spuId = row.spu_id || rawText(raw, "商品ID") || rawText(raw, "商品编码");
  const productUrl = rawText(raw, "商品链接") || (row.platform === "天猫" && spuId ? `https://detail.tmall.com/item.htm?id=${encodeURIComponent(spuId)}` : "");
  return {
    platform: row.platform,
    shopName: row.shop_name,
    spuId,
    skuId: row.sku_id || rawText(raw, "SKUID"),
    productCode: rawText(raw, "SKU商家编码") || rawText(raw, "商品编码") || row.product_code,
    productName: row.product_name || rawText(raw, "商品名称"),
    imageUrl: productImageUrl(raw, imageRaw),
    salesProductCode: rawText(raw, "商家SKU") || rawText(raw, "SKU商家编码"),
    saleAttribute: rawText(raw, "销售属性"),
    category,
    brand: rawText(raw, "品牌"),
    price: row.platform === "天猫" && priceCents !== null ? priceCents / 100 : rawNumber(raw, "京东价"),
    priceCents: row.platform === "天猫" ? priceCents : rawNumber(raw, "京东价") !== null ? Math.round(Number(rawNumber(raw, "京东价")) * 100) : null,
    totalInventory: rawNumber(raw, "商品总库存") ?? rawNumber(raw, "SKU库存"),
    availableInventory: rawNumber(raw, "商品可用库存") ?? rawNumber(raw, "SKU库存"),
    status: rawText(raw, "商品状态"),
    productUrl,
    createdAt: rawText(raw, "创建时间"),
    snapshotDate: row.snapshot_date,
    ...emptyNetshopProductSalesMetrics(),
  };
}

export async function getNetshopProductCatalog(
  db: NetshopDatabase,
  input: { query?: string; page?: number; pageSize?: number; shopName?: string; shopNames?: string[]; platformNames?: string[]; salesStartDate?: string; salesEndDate?: string } = {},
): Promise<NetshopProductCatalog> {
  const page = boundedNetshopInteger(input.page, "page", 1, 1, NETSHOP_QUERY_MAX_PAGE);
  const pageSize = boundedNetshopInteger(input.pageSize, "pageSize", 50, 1, NETSHOP_QUERY_MAX_PAGE_SIZE);
  const salesPeriod = resolveNetshopQueryPeriod(input.salesStartDate, input.salesEndDate);
  const latestBatches = await latestProductBatches(db);
  const requestedShopNames = [...new Set([input.shopName ?? "", ...(input.shopNames ?? [])].map((value) => value.trim()).filter(Boolean))];
  const requestedPlatforms = [...new Set((input.platformNames ?? []).map((value) => value.trim()).filter(Boolean))];
  const visibleBatches = latestBatches.filter((batch) => requestedPlatforms.length === 0 || requestedPlatforms.includes(batch.platform));
  const batches = visibleBatches.filter((batch) => requestedShopNames.length === 0 || requestedShopNames.includes(batch.shopName));
  const batch = batches[0] ?? null;
  const shops = visibleBatches
    .map((item) => ({ shopName: item.shopName, platform: item.platform, snapshotDate: item.snapshotDate, completedAt: item.completedAt }))
    .sort((left, right) => left.platform.localeCompare(right.platform, "zh-CN") || left.shopName.localeCompare(right.shopName, "zh-CN"));
  const emptySales = {
    periodStart: salesPeriod?.startDate ?? null,
    periodEnd: salesPeriod?.endDate ?? null,
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
      pagination: { page, pageSize, total: 0, returned: 0, truncated: false },
    };
  }

  const batchIds = batches.map((item) => item.id);
  const batchClause = "last_import_batch_id IN (SELECT CAST(value AS TEXT) FROM json_each(?))";
  const batchBinding = JSON.stringify(batchIds);

  const summary = await db
    .prepare(
      `SELECT
         COUNT(*) AS total_skus,
         SUM(CASE WHEN json_extract(raw_json, '$."商品状态"') = '上架' THEN 1 ELSE 0 END) AS on_sale_skus,
         SUM(COALESCE(CAST(json_extract(metrics_json, '$.inventoryQuantity') AS REAL), CAST(json_extract(raw_json, '$."商品总库存"') AS REAL), 0)) AS total_inventory,
         SUM(COALESCE(CAST(json_extract(metrics_json, '$.inventoryQuantity') AS REAL), CAST(json_extract(raw_json, '$."商品可用库存"') AS REAL), 0)) AS available_inventory
       FROM netshop_rows
       WHERE ${batchClause}`,
    )
    .bind(batchBinding)
    .first<NetshopProductSummaryRow>();

  const query = (input.query ?? "").trim().slice(0, 120);
  const searchClause = query
    ? " AND (shop_name LIKE ? OR spu_id LIKE ? OR sku_id LIKE ? OR product_code LIKE ? OR product_name LIKE ?)"
    : "";
  const searchTerm = `%${query}%`;
  const bindings = query
    ? [batchBinding, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm]
    : [batchBinding];
  const totalRow = await db
    .prepare(`SELECT COUNT(*) AS total FROM netshop_rows WHERE ${batchClause}${searchClause}`)
    .bind(...bindings)
    .first<{ total: number }>();
  const offset = (page - 1) * pageSize;
  const rows = await db
    .prepare(
       `SELECT
         product.source,
         product.platform,
         product.shop_name,
         product.snapshot_date,
         product.spu_id,
         product.sku_id,
         product.product_code,
         product.product_name,
         product.metrics_json,
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
  const jdItems = rawItems.filter((item) => item.platform === "京东");
  const sales = await readJdProductSalesMetrics(
    db,
    jdItems.map((item) => item.salesProductCode),
    salesPeriod,
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
      periodStart: salesPeriod?.startDate ?? null,
      periodEnd: salesPeriod?.endDate ?? null,
      dataCutoffDate: sales.dataCutoffDate,
      platform: sales.platform,
    },
    items: rawItems.map(({ salesProductCode, ...item }) => ({
      ...item,
      ...(item.platform === "京东" ? sales.metrics.get(salesProductCode) ?? emptyNetshopProductSalesMetrics() : emptyNetshopProductSalesMetrics()),
    })),
    pagination: {
      page,
      pageSize,
      total: Number(totalRow?.total ?? 0),
      returned: rawItems.length,
      truncated: offset + rawItems.length < Number(totalRow?.total ?? 0),
    },
  };
}

type NetshopProductPerformanceSummaryRow = {
  product_count: number | null;
  date_count: number | null;
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
  favorites: number | null;
  refund_amount_cents: number | null;
  search_visitors: number | null;
  search_transaction_customers: number | null;
};

type NetshopProductPerformanceRow = {
  id: string;
  platform: string;
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
  favorites: number | null;
  refund_amount_cents: number | null;
  search_visitors: number | null;
  search_transaction_customers: number | null;
};

type NetshopProductPerformanceDailyRow = {
  business_date: string;
  page_views: number | null;
  visitors: number | null;
  transaction_customers: number | null;
  transaction_quantity: number | null;
  transaction_amount_cents: number | null;
  refund_amount_cents: number | null;
  favorites: number | null;
  add_cart_customers: number | null;
  add_cart_quantity: number | null;
};

type NetshopProductPerformanceShopRow = {
  shop_name: string;
  platform: string;
  product_count: number | null;
};

type NetshopProductPerformanceAvailableCoverageRow = {
  date_min: string | null;
  date_max: string | null;
};

const dailyPerformanceMetrics = {
  pageViews: `COALESCE(CAST(json_extract(r.metrics_json, '$.pageViews') AS REAL), CAST(json_extract(r.metrics_json, '$."商品浏览量"') AS REAL), 0)`,
  visitors: `COALESCE(CAST(json_extract(r.metrics_json, '$.visitors') AS REAL), CAST(json_extract(r.metrics_json, '$."商品访客数"') AS REAL), 0)`,
  searchImpressions: `COALESCE(CAST(json_extract(r.metrics_json, '$."搜索曝光次数"') AS REAL), 0)`,
  searchClicks: `COALESCE(CAST(json_extract(r.metrics_json, '$."搜索点击次数"') AS REAL), 0)`,
  addCartCustomers: `COALESCE(CAST(json_extract(r.metrics_json, '$.addCartCustomers') AS REAL), CAST(json_extract(r.metrics_json, '$."加购客户数"') AS REAL), 0)`,
  addCartQuantity: `COALESCE(CAST(json_extract(r.metrics_json, '$.addCartQuantity') AS REAL), CAST(json_extract(r.metrics_json, '$."加购商品件数"') AS REAL), 0)`,
  orderCustomers: `COALESCE(CAST(json_extract(r.metrics_json, '$.orderCustomers') AS REAL), CAST(json_extract(r.metrics_json, '$."下单客户数"') AS REAL), 0)`,
  orderQuantity: `COALESCE(CAST(json_extract(r.metrics_json, '$.orderQuantity') AS REAL), CAST(json_extract(r.metrics_json, '$."下单商品件数"') AS REAL), 0)`,
  orderAmountCents: `COALESCE(CAST(json_extract(r.metrics_json, '$.orderAmountCents') AS REAL), CAST(json_extract(r.metrics_json, '$."下单金额"') AS REAL) * 100, 0)`,
  transactionOrders: `COALESCE(CAST(json_extract(r.metrics_json, '$."成交单量"') AS REAL), 0)`,
  transactionAmountCents: `COALESCE(CAST(json_extract(r.metrics_json, '$.transactionAmountCents') AS REAL), CAST(json_extract(r.metrics_json, '$."成交金额"') AS REAL) * 100, 0)`,
  transactionQuantity: `COALESCE(CAST(json_extract(r.metrics_json, '$.transactionQuantity') AS REAL), CAST(json_extract(r.metrics_json, '$."成交商品件数"') AS REAL), 0)`,
  transactionCustomers: `COALESCE(CAST(json_extract(r.metrics_json, '$.transactionCustomers') AS REAL), CAST(json_extract(r.metrics_json, '$."成交客户数"') AS REAL), 0)`,
  favorites: `COALESCE(CAST(json_extract(r.metrics_json, '$.favorites') AS REAL), 0)`,
  refundAmountCents: `COALESCE(CAST(json_extract(r.metrics_json, '$.refundAmountCents') AS REAL), 0)`,
  searchVisitors: `COALESCE(CAST(json_extract(r.metrics_json, '$.searchVisitors') AS REAL), 0)`,
  searchTransactionCustomers: `COALESCE(CAST(json_extract(r.metrics_json, '$.searchTransactionCustomers') AS REAL), 0)`,
} as const;

function numberFromDailyMetric(value: number | null | undefined) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function dailyPerformanceCategorySql() {
  return `COALESCE(
    NULLIF(json_extract(r.raw_json, '$."商品标签"'), ''),
    NULLIF(json_extract(r.raw_json, '$."类目名称"'), ''),
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
  const page = boundedNetshopInteger(input.page, "page", 1, 1, NETSHOP_QUERY_MAX_PAGE);
  const pageSize = boundedNetshopInteger(input.pageSize, "pageSize", 50, 1, NETSHOP_QUERY_MAX_PAGE_SIZE);
  const dataset = input.dimension === "sku" ? "sku_daily" : "spu_daily";
  const dimensionSql = input.dimension === "sku" ? "r.sku_id" : "r.spu_id";
  const period = resolveNetshopQueryPeriod(input.startDate, input.endDate);
  const startDate = period?.startDate ?? null;
  const endDate = period?.endDate ?? null;
  const selectedPlatforms = [...new Set((input.platformNames ?? []).map((value) => value.trim()).filter(Boolean))].slice(0, 20);
  const selectedShops = [...new Set((input.shopNames ?? []).map((value) => value.trim()).filter(Boolean))].slice(0, 50);
  const query = (input.query ?? "").trim().slice(0, 120);
  const sourceSql = input.dimension === "sku"
    ? "r.source = 'jd_sku_daily'"
    : "r.source IN ('jd_sku_daily', 'tmall_product_daily')";
  const identitySql = `r.platform || char(31) || r.shop_name || char(31) || ${dimensionSql}`;
  const whereParts = [sourceSql, "r.dataset = ?", `${dimensionSql} <> ''`];
  const bindings: string[] = [dataset];

  if (period) {
    whereParts.push("r.business_date >= ?", "r.business_date < ?");
    bindings.push(period.startDate, period.endExclusive);
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
  const summaryPromise = db
    .prepare(
      `SELECT
         COUNT(DISTINCT ${identitySql}) AS product_count,
         COUNT(DISTINCT r.business_date) AS date_count,
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
          SUM(${metric.orderAmountCents}) AS order_amount,
         SUM(${metric.transactionOrders}) AS transaction_orders,
          SUM(${metric.transactionAmountCents}) AS transaction_amount,
         SUM(${metric.transactionQuantity}) AS transaction_quantity,
          SUM(${metric.transactionCustomers}) AS transaction_customers
         ,SUM(${metric.favorites}) AS favorites
         ,SUM(${metric.refundAmountCents}) AS refund_amount_cents
         ,SUM(${metric.searchVisitors}) AS search_visitors
         ,SUM(${metric.searchTransactionCustomers}) AS search_transaction_customers
       FROM netshop_rows r
       WHERE ${whereSql}`,
    )
    .bind(...bindings)
    .first<NetshopProductPerformanceSummaryRow>();

  const offset = (page - 1) * pageSize;
  const rowsPromise = db
    .prepare(
      `SELECT
         ${dimensionSql} AS id,
         MAX(r.platform) AS platform,
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
          SUM(${metric.orderAmountCents}) AS order_amount,
         SUM(${metric.transactionOrders}) AS transaction_orders,
          SUM(${metric.transactionAmountCents}) AS transaction_amount,
         SUM(${metric.transactionQuantity}) AS transaction_quantity,
          SUM(${metric.transactionCustomers}) AS transaction_customers
         ,SUM(${metric.favorites}) AS favorites
         ,SUM(${metric.refundAmountCents}) AS refund_amount_cents
         ,SUM(${metric.searchVisitors}) AS search_visitors
         ,SUM(${metric.searchTransactionCustomers}) AS search_transaction_customers
       FROM netshop_rows r
       WHERE ${whereSql}
       GROUP BY r.platform, r.shop_name, ${dimensionSql}
       ORDER BY transaction_amount DESC, visitors DESC, product_name COLLATE NOCASE ASC, id ASC
       LIMIT ? OFFSET ?`,
    )
    .bind(...bindings, pageSize, offset)
    .all<NetshopProductPerformanceRow>();

  const shopWhereParts = [sourceSql, "r.dataset = ?", `${dimensionSql} <> ''`];
  const shopBindings: string[] = [dataset];
  if (selectedPlatforms.length > 0) {
    shopWhereParts.push(`r.platform IN (${selectedPlatforms.map(() => "?").join(", ")})`);
    shopBindings.push(...selectedPlatforms);
  }
  const shopsPromise = db
    .prepare(
      `SELECT
         r.shop_name,
         MAX(r.platform) AS platform,
         COUNT(DISTINCT ${identitySql}) AS product_count
       FROM netshop_rows r
       WHERE ${shopWhereParts.join(" AND ")}
         AND r.shop_name <> ''
       GROUP BY r.platform, r.shop_name
       ORDER BY r.shop_name COLLATE NOCASE ASC`,
    )
    .bind(...shopBindings)
    .all<NetshopProductPerformanceShopRow>();

  const availableCoverageWhereParts = [...shopWhereParts];
  const availableCoverageBindings = [...shopBindings];
  if (selectedShops.length > 0) {
    availableCoverageWhereParts.push(`r.shop_name IN (${selectedShops.map(() => "?").join(", ")})`);
    availableCoverageBindings.push(...selectedShops);
  }
  const availableCoveragePromise = db
    .prepare(
      `SELECT MIN(r.business_date) AS date_min, MAX(r.business_date) AS date_max
       FROM netshop_rows r
       WHERE ${availableCoverageWhereParts.join(" AND ")}`,
    )
    .bind(...availableCoverageBindings)
    .first<NetshopProductPerformanceAvailableCoverageRow>();

  const dailyRowsPromise = db.prepare(
    `WITH daily_series AS (
     SELECT
       r.business_date,
       SUM(${metric.pageViews}) AS page_views,
       SUM(${metric.visitors}) AS visitors,
       SUM(${metric.transactionCustomers}) AS transaction_customers,
       SUM(${metric.transactionQuantity}) AS transaction_quantity,
       SUM(${metric.transactionAmountCents}) AS transaction_amount_cents,
       SUM(${metric.refundAmountCents}) AS refund_amount_cents,
       SUM(${metric.favorites}) AS favorites,
       SUM(${metric.addCartCustomers}) AS add_cart_customers,
       SUM(${metric.addCartQuantity}) AS add_cart_quantity
     FROM netshop_rows r
     WHERE ${whereSql}
     GROUP BY r.business_date
    )
    SELECT * FROM daily_series
    ORDER BY business_date DESC
    LIMIT ?`,
  ).bind(...bindings, NETSHOP_DAILY_SERIES_LIMIT).all<NetshopProductPerformanceDailyRow>();

  const [summary, rows, shops, availableCoverage, dailyRows] = await Promise.all([
    summaryPromise,
    rowsPromise,
    shopsPromise,
    availableCoveragePromise,
    dailyRowsPromise,
  ]);

  const visitors = numberFromDailyMetric(summary?.visitors);
  const transactionCustomers = numberFromDailyMetric(summary?.transaction_customers);
  const searchImpressions = numberFromDailyMetric(summary?.search_impressions);
  const searchClicks = numberFromDailyMetric(summary?.search_clicks);
  const transactionAmountCents = numberFromDailyMetric(summary?.transaction_amount);
  const dailySeriesRows = [...dailyRows.results].sort((left, right) => left.business_date.localeCompare(right.business_date));
  const actualDates = dailySeriesRows.map((row) => row.business_date).filter(Boolean);
  const dailyTotal = numberFromDailyMetric(summary?.date_count);
  const requestedCoverage = period
    ? dailyDateCoverageForQuery(period.startDate, period.endDate, actualDates)
    : { actualDates, missingDates: [] as string[] };
  const coverage = {
    ...requestedCoverage,
    availableDateMin: availableCoverage?.date_min ?? null,
    availableDateMax: availableCoverage?.date_max ?? null,
    total: dailyTotal,
    returned: actualDates.length,
    truncated: actualDates.length < dailyTotal,
  };
  const platforms = [...new Set(shops.results.map((shop) => shop.platform.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, "zh-CN"));
  return {
    dimension: input.dimension,
    dataset,
    requestedPeriod: { startDate, endDate },
    dateMin: summary?.date_min ?? null,
    dataCutoffDate: summary?.data_cutoff_date ?? null,
    monetaryUnit: "cents",
    visitorAggregation: "product_day_sum",
    coverage,
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
      orderAmount: numberFromDailyMetric(summary?.order_amount) / 100,
      orderAmountCents: numberFromDailyMetric(summary?.order_amount),
      transactionOrders: numberFromDailyMetric(summary?.transaction_orders),
      transactionAmount: transactionAmountCents / 100,
      transactionAmountCents,
      transactionQuantity: numberFromDailyMetric(summary?.transaction_quantity),
      transactionCustomers,
      favorites: numberFromDailyMetric(summary?.favorites),
      refundAmountCents: numberFromDailyMetric(summary?.refund_amount_cents),
      searchVisitors: numberFromDailyMetric(summary?.search_visitors),
      searchTransactionCustomers: numberFromDailyMetric(summary?.search_transaction_customers),
      uvValue: visitors > 0 ? transactionAmountCents / 100 / visitors : null,
      conversionRate: visitors > 0 ? transactionCustomers / visitors : null,
    },
    daily: dailySeriesRows.map((row) => ({
      date: row.business_date,
      pageViews: numberFromDailyMetric(row.page_views),
      visitors: numberFromDailyMetric(row.visitors),
      transactionCustomers: numberFromDailyMetric(row.transaction_customers),
      transactionQuantity: numberFromDailyMetric(row.transaction_quantity),
      transactionAmountCents: numberFromDailyMetric(row.transaction_amount_cents),
      refundAmountCents: numberFromDailyMetric(row.refund_amount_cents),
      favorites: numberFromDailyMetric(row.favorites),
      addCartCustomers: numberFromDailyMetric(row.add_cart_customers),
      addCartQuantity: numberFromDailyMetric(row.add_cart_quantity),
    })),
    dailyPagination: {
      total: dailyTotal,
      returned: dailySeriesRows.length,
      truncated: dailySeriesRows.length < dailyTotal,
    },
    items: rows.results.map((row) => {
      const itemVisitors = numberFromDailyMetric(row.visitors);
      const itemTransactionCustomers = numberFromDailyMetric(row.transaction_customers);
      const itemSearchImpressions = numberFromDailyMetric(row.search_impressions);
      const itemSearchClicks = numberFromDailyMetric(row.search_clicks);
      const itemTransactionAmountCents = numberFromDailyMetric(row.transaction_amount);
      return {
        id: row.id,
        platform: row.platform,
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
        orderAmount: numberFromDailyMetric(row.order_amount) / 100,
        orderAmountCents: numberFromDailyMetric(row.order_amount),
        transactionOrders: numberFromDailyMetric(row.transaction_orders),
        transactionAmount: itemTransactionAmountCents / 100,
        transactionAmountCents: itemTransactionAmountCents,
        transactionQuantity: numberFromDailyMetric(row.transaction_quantity),
        transactionCustomers: itemTransactionCustomers,
        favorites: numberFromDailyMetric(row.favorites),
        refundAmountCents: numberFromDailyMetric(row.refund_amount_cents),
        searchVisitors: numberFromDailyMetric(row.search_visitors),
        searchTransactionCustomers: numberFromDailyMetric(row.search_transaction_customers),
        uvValue: itemVisitors > 0 ? itemTransactionAmountCents / 100 / itemVisitors : null,
        conversionRate: itemVisitors > 0 ? itemTransactionCustomers / itemVisitors : null,
      };
    }),
    pagination: {
      page,
      pageSize,
      total: numberFromDailyMetric(summary?.product_count),
      returned: rows.results.length,
      truncated: offset + rows.results.length < numberFromDailyMetric(summary?.product_count),
    },
  };
}

type PromotionAggregateRow = {
  product_count: number | null;
  date_count: number | null;
  date_min: string | null;
  date_max: string | null;
  spend_cents: number | null;
  net_transaction_amount_cents: number | null;
  gross_transaction_amount_cents: number | null;
  impressions: number | null;
  clicks: number | null;
  net_orders: number | null;
  favorites: number | null;
  cart_quantity: number | null;
};

type PromotionDailyRow = Omit<PromotionAggregateRow, "product_count" | "date_count" | "date_min" | "date_max"> & { business_date: string };
type PromotionPaymentDailyRow = { business_date: string; payment_cents: number | null; total_dates: number | null };

type PromotionItemRow = PromotionAggregateRow & {
  id: string;
  platform: string;
  product_name: string | null;
  shop_name: string;
  data_days: number | null;
  coverage_dates: string | null;
};

export async function getNetshopPromotionPerformance(
  db: NetshopDatabase,
  input: {
    query?: string;
    page?: number;
    pageSize?: number;
    platformNames?: string[];
    shopNames?: string[];
    startDate?: string;
    endDate?: string;
  } = {},
): Promise<NetshopPromotionPerformance> {
  const page = boundedNetshopInteger(input.page, "page", 1, 1, NETSHOP_QUERY_MAX_PAGE);
  const pageSize = boundedNetshopInteger(input.pageSize, "pageSize", 50, 1, NETSHOP_QUERY_MAX_PAGE_SIZE);
  const period = resolveNetshopQueryPeriod(input.startDate, input.endDate);
  const startDate = period?.startDate ?? null;
  const endDate = period?.endDate ?? null;
  const platforms = [...new Set((input.platformNames ?? []).map((value) => value.trim()).filter(Boolean))].slice(0, 20);
  const shops = [...new Set((input.shopNames ?? []).map((value) => value.trim()).filter(Boolean))].slice(0, 50);
  const promotionProductIdSql = netshopPromotionProductIdSql;
  const where = [netshopPromotionSourceSql];
  const bindings: string[] = [];
  if (period) { where.push("r.business_date >= ?", "r.business_date < ?"); bindings.push(period.startDate, period.endExclusive); }
  if (platforms.length) { where.push(`r.platform IN (${platforms.map(() => "?").join(", ")})`); bindings.push(...platforms); }
  if (shops.length) { where.push(`r.shop_name IN (${shops.map(() => "?").join(", ")})`); bindings.push(...shops); }
  const whereSql = where.join(" AND ");
  const promotionIdentitySql = `r.platform || char(31) || r.shop_name || char(31) || ${promotionProductIdSql}`;
  const metric = netshopPromotionMetrics;
  const aggregateSelect = `
    COUNT(DISTINCT ${promotionIdentitySql}) AS product_count,
    COUNT(DISTINCT r.business_date) AS date_count,
    MIN(r.business_date) AS date_min,
    MAX(r.business_date) AS date_max,
    SUM(${metric.spendCents}) AS spend_cents,
    SUM(${metric.netTransactionAmountCents}) AS net_transaction_amount_cents,
    SUM(${metric.grossTransactionAmountCents}) AS gross_transaction_amount_cents,
    SUM(${metric.impressions}) AS impressions,
    SUM(${metric.clicks}) AS clicks,
    SUM(${metric.netOrders}) AS net_orders,
    SUM(${metric.favorites}) AS favorites,
    SUM(${metric.cartQuantity}) AS cart_quantity`;
  const summaryPromise = db.prepare(`SELECT ${aggregateSelect} FROM netshop_rows r WHERE ${whereSql}`)
    .bind(...bindings).first<PromotionAggregateRow>();
  const dailyPromise = db.prepare(
    `WITH daily_series AS (
     SELECT r.business_date,
       SUM(${metric.spendCents}) AS spend_cents,
       SUM(${metric.netTransactionAmountCents}) AS net_transaction_amount_cents,
       SUM(${metric.grossTransactionAmountCents}) AS gross_transaction_amount_cents,
       SUM(${metric.impressions}) AS impressions,
       SUM(${metric.clicks}) AS clicks,
       SUM(${metric.netOrders}) AS net_orders,
       SUM(${metric.favorites}) AS favorites,
       SUM(${metric.cartQuantity}) AS cart_quantity
     FROM netshop_rows r WHERE ${whereSql}
     GROUP BY r.business_date
    )
    SELECT * FROM daily_series
    ORDER BY business_date DESC
    LIMIT ?`,
  ).bind(...bindings, NETSHOP_DAILY_SERIES_LIMIT).all<PromotionDailyRow>();

  const paymentWhere = [netshopPromotionPaymentSourceSql];
  const paymentBindings: string[] = [];
  if (period) { paymentWhere.push("r.business_date >= ?", "r.business_date < ?"); paymentBindings.push(period.startDate, period.endExclusive); }
  if (platforms.length) { paymentWhere.push(`r.platform IN (${platforms.map(() => "?").join(", ")})`); paymentBindings.push(...platforms); }
  if (shops.length) { paymentWhere.push(`r.shop_name IN (${shops.map(() => "?").join(", ")})`); paymentBindings.push(...shops); }
  const paymentRowsPromise = db.prepare(
    `WITH daily_series AS (
       SELECT r.business_date, SUM(${dailyPerformanceMetrics.transactionAmountCents}) AS payment_cents
       FROM netshop_rows r WHERE ${paymentWhere.join(" AND ")}
       GROUP BY r.business_date
     )
     SELECT *, COUNT(*) OVER () AS total_dates
     FROM daily_series
     ORDER BY business_date DESC
     LIMIT ?`,
  ).bind(...paymentBindings, NETSHOP_DAILY_SERIES_LIMIT).all<PromotionPaymentDailyRow>();
  const query = (input.query ?? "").trim().slice(0, 120);
  const itemWhere = [...where];
  const itemBindings = [...bindings];
  if (query) {
    itemWhere.push(`(${promotionProductIdSql} LIKE ? OR r.product_name LIKE ? OR json_extract(r.raw_json, '$."产品线"') LIKE ?)`);
    const term = `%${query}%`;
    itemBindings.push(term, term, term);
  }
  const itemWhereSql = itemWhere.join(" AND ");
  const totalPromise = query
    ? db.prepare(`SELECT COUNT(DISTINCT ${promotionIdentitySql}) AS total FROM netshop_rows r WHERE ${itemWhereSql}`)
      .bind(...itemBindings).first<{ total: number | null }>()
    : Promise.resolve(null);
  const offset = (page - 1) * pageSize;
  const itemRowsPromise = db.prepare(
    `SELECT
       ${promotionProductIdSql} AS id,
       MAX(r.platform) AS platform,
       MAX(COALESCE(NULLIF(r.product_name, ''), NULLIF(CAST(json_extract(r.raw_json, '$."产品线"') AS TEXT), ''))) AS product_name,
       MAX(r.shop_name) AS shop_name,
       COUNT(DISTINCT r.business_date) AS data_days,
       ${period ? "GROUP_CONCAT(DISTINCT r.business_date)" : "NULL"} AS coverage_dates,
       ${aggregateSelect}
     FROM netshop_rows r WHERE ${itemWhereSql}
     GROUP BY r.platform, r.shop_name, ${promotionProductIdSql}
     ORDER BY net_transaction_amount_cents DESC, spend_cents DESC, id ASC
     LIMIT ? OFFSET ?`,
  ).bind(...itemBindings, pageSize, offset).all<PromotionItemRow>();

  const [summary, daily, paymentRows, totalRow, itemRows] = await Promise.all([
    summaryPromise,
    dailyPromise,
    paymentRowsPromise,
    totalPromise,
    itemRowsPromise,
  ]);
  const orderedDailyRows = [...daily.results].sort((left, right) => left.business_date.localeCompare(right.business_date));
  const orderedPaymentRows = [...paymentRows.results].sort((left, right) => left.business_date.localeCompare(right.business_date));
  const paymentByDate = new Map(orderedPaymentRows.map((row) => [row.business_date, numberFromDailyMetric(row.payment_cents)]));
  const dailyByDate = new Map(orderedDailyRows.map((row) => [row.business_date, row]));
  const promotionDates = [...dailyByDate.keys()].sort();
  const productDailyDates = [...paymentByDate.keys()].sort();
  const intersectionDates = promotionDates.filter((date) => paymentByDate.has(date));
  const requestedDates = period
    ? dailyDateCoverageForQuery(period.startDate, period.endDate, []).missingDates
    : [...new Set([...promotionDates, ...productDailyDates])].sort();
  const ratioSpendCents = intersectionDates.reduce((sum, date) => sum + numberFromDailyMetric(dailyByDate.get(date)?.spend_cents), 0);
  const ratioTransactionCents = intersectionDates.reduce((sum, date) => sum + numberFromDailyMetric(dailyByDate.get(date)?.net_transaction_amount_cents), 0);
  const platformPaymentAmountCents = intersectionDates.reduce((sum, date) => sum + numberFromDailyMetric(paymentByDate.get(date)), 0);

  const summarySpend = numberFromDailyMetric(summary?.spend_cents);
  const summaryNetTransaction = numberFromDailyMetric(summary?.net_transaction_amount_cents);
  const summaryImpressions = numberFromDailyMetric(summary?.impressions);
  const summaryClicks = numberFromDailyMetric(summary?.clicks);
  const promotionDateTotal = numberFromDailyMetric(summary?.date_count);
  const productDailyDateTotal = numberFromDailyMetric(paymentRows.results[0]?.total_dates);
  const total = query
    ? numberFromDailyMetric(totalRow?.total)
    : numberFromDailyMetric(summary?.product_count);
  return {
    monetaryUnit: "cents",
    requestedPeriod: { startDate, endDate },
    dateMin: summary?.date_min ?? null,
    dataCutoffDate: summary?.date_max ?? null,
    coverage: {
      promotionDates,
      productDailyDates,
      intersectionDates,
      missingProductDailyDates: requestedDates.filter((date) => !paymentByDate.has(date)),
      missingPromotionDates: requestedDates.filter((date) => !dailyByDate.has(date)),
      promotionDatesPagination: {
        total: promotionDateTotal,
        returned: promotionDates.length,
        truncated: promotionDates.length < promotionDateTotal,
      },
      productDailyDatesPagination: {
        total: productDailyDateTotal,
        returned: productDailyDates.length,
        truncated: productDailyDates.length < productDailyDateTotal,
      },
      intersectionTruncated: promotionDates.length < promotionDateTotal || productDailyDates.length < productDailyDateTotal,
    },
    summary: {
      productCount: numberFromDailyMetric(summary?.product_count),
      spendCents: summarySpend,
      netTransactionAmountCents: summaryNetTransaction,
      grossTransactionAmountCents: numberFromDailyMetric(summary?.gross_transaction_amount_cents),
      platformPaymentAmountCents,
      impressions: summaryImpressions,
      clicks: summaryClicks,
      netOrders: numberFromDailyMetric(summary?.net_orders),
      favorites: numberFromDailyMetric(summary?.favorites),
      cartQuantity: numberFromDailyMetric(summary?.cart_quantity),
      clickThroughRate: summaryImpressions > 0 ? summaryClicks / summaryImpressions : null,
      averageClickCostCents: summaryClicks > 0 ? summarySpend / summaryClicks : null,
      roas: summarySpend > 0 ? summaryNetTransaction / summarySpend : null,
      spendRate: platformPaymentAmountCents > 0 ? ratioSpendCents / platformPaymentAmountCents : null,
      promotionTransactionShare: platformPaymentAmountCents > 0 ? ratioTransactionCents / platformPaymentAmountCents : null,
    },
    daily: orderedDailyRows.map((row) => {
      const spendCents = numberFromDailyMetric(row.spend_cents);
      const netTransactionAmountCents = numberFromDailyMetric(row.net_transaction_amount_cents);
      const payment = paymentByDate.has(row.business_date) ? numberFromDailyMetric(paymentByDate.get(row.business_date)) : null;
      return {
        date: row.business_date,
        spendCents,
        netTransactionAmountCents,
        platformPaymentAmountCents: payment,
        impressions: numberFromDailyMetric(row.impressions),
        clicks: numberFromDailyMetric(row.clicks),
        netOrders: numberFromDailyMetric(row.net_orders),
        roas: spendCents > 0 ? netTransactionAmountCents / spendCents : null,
        spendRate: payment && payment > 0 ? spendCents / payment : null,
        promotionTransactionShare: payment && payment > 0 ? netTransactionAmountCents / payment : null,
      };
    }),
    dailyPagination: {
      total: promotionDateTotal,
      returned: orderedDailyRows.length,
      truncated: orderedDailyRows.length < promotionDateTotal,
    },
    items: itemRows.results.map((row) => {
      const spendCents = numberFromDailyMetric(row.spend_cents);
      const netTransactionAmountCents = numberFromDailyMetric(row.net_transaction_amount_cents);
      const impressions = numberFromDailyMetric(row.impressions);
      const clicks = numberFromDailyMetric(row.clicks);
      return {
        id: row.id,
        platform: row.platform,
        productName: row.product_name ?? "",
        shopName: row.shop_name,
        dateMin: row.date_min,
        dateMax: row.date_max,
        dates: [...new Set((row.coverage_dates ?? "").split(",").filter(isIsoDate))].sort(),
        datesTruncated: !period && numberFromDailyMetric(row.data_days) > 0,
        dataDays: numberFromDailyMetric(row.data_days),
        spendCents,
        netTransactionAmountCents,
        grossTransactionAmountCents: numberFromDailyMetric(row.gross_transaction_amount_cents),
        impressions,
        clicks,
        netOrders: numberFromDailyMetric(row.net_orders),
        favorites: numberFromDailyMetric(row.favorites),
        cartQuantity: numberFromDailyMetric(row.cart_quantity),
        clickThroughRate: impressions > 0 ? clicks / impressions : null,
        averageClickCostCents: clicks > 0 ? spendCents / clicks : null,
        roas: spendCents > 0 ? netTransactionAmountCents / spendCents : null,
      };
    }),
    pagination: { page, pageSize, total, returned: itemRows.results.length, truncated: offset + itemRows.results.length < total },
  };
}
