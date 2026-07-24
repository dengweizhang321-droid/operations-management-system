import { env } from "cloudflare:workers";

export type MarketDatabase = NonNullable<typeof env.DB>;

export type MarketImportIssue = {
  row?: number;
  field?: string;
  message: string;
};

export type MarketEntryInput = {
  naturalKey: string;
  sourceRowNumber: number;
  periodStart: string;
  periodEnd: string;
  category: string;
  scope: string;
  rankingDimension: "SKU" | "SPU";
  operationMode: "POP" | "自营" | "未知";
  subcategory: string;
  rank: number | null;
  skuCode: string;
  productName: string;
  brand: string;
  priceCents: number | null;
  priceLowCents: number | null;
  priceHighCents: number | null;
  priceEstimated: boolean;
  gmvCents: number;
  quantity: number;
  pageViews: number;
  visitors: number;
  conversionBps: number | null;
  cartCustomers: number;
  searchClicks: number;
  imageUrl: string;
  productUrl: string;
  raw: Record<string, string | number | boolean | null>;
};

export type MarketImportBatch = {
  id: string;
  sourceType: string;
  fileName: string;
  fileSizeBytes: number;
  fileHash: string;
  sheetName: string;
  status: string;
  rowCount: number;
  insertedCount: number;
  updatedCount: number;
  warningCount: number;
  periodStart: string | null;
  periodEnd: string | null;
  warnings: MarketImportIssue[];
  createdAt: string;
  completedAt: string | null;
};

export type MarketOverviewFilters = {
  query?: string;
  categories?: string[];
  scopes?: string[];
  brands?: string[];
  rankingDimensions?: string[];
  operationModes?: string[];
  subcategories?: string[];
  priceBands?: string[];
  startDate?: string;
  endDate?: string;
};

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS market_import_batches (
    id TEXT PRIMARY KEY NOT NULL,
    source_type TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_size_bytes INTEGER NOT NULL,
    file_hash TEXT NOT NULL UNIQUE,
    sheet_name TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    row_count INTEGER NOT NULL DEFAULT 0,
    inserted_count INTEGER NOT NULL DEFAULT 0,
    updated_count INTEGER NOT NULL DEFAULT 0,
    warning_count INTEGER NOT NULL DEFAULT 0,
    period_start TEXT,
    period_end TEXT,
    warnings_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS market_import_batches_created_idx ON market_import_batches (created_at)`,
  `CREATE TABLE IF NOT EXISTS market_ranking_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    natural_key TEXT NOT NULL UNIQUE,
    source_row_number INTEGER NOT NULL,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT '',
    scope TEXT NOT NULL DEFAULT '全部',
    ranking_dimension TEXT NOT NULL DEFAULT 'SKU',
    operation_mode TEXT NOT NULL DEFAULT '未知',
    subcategory TEXT NOT NULL DEFAULT '',
    rank INTEGER,
    sku_code TEXT NOT NULL,
    product_name TEXT NOT NULL DEFAULT '',
    brand TEXT NOT NULL DEFAULT '',
    price_cents INTEGER,
    price_low_cents INTEGER,
    price_high_cents INTEGER,
    price_estimated INTEGER NOT NULL DEFAULT 0,
    gmv_cents INTEGER NOT NULL DEFAULT 0,
    quantity INTEGER NOT NULL DEFAULT 0,
    page_views INTEGER NOT NULL DEFAULT 0,
    visitors INTEGER NOT NULL DEFAULT 0,
    conversion_bps INTEGER,
    cart_customers INTEGER NOT NULL DEFAULT 0,
    search_clicks INTEGER NOT NULL DEFAULT 0,
    image_url TEXT NOT NULL DEFAULT '',
    product_url TEXT NOT NULL DEFAULT '',
    raw_json TEXT NOT NULL DEFAULT '{}',
    last_import_batch_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS market_entries_period_idx ON market_ranking_entries (period_end, period_start)`,
  `CREATE INDEX IF NOT EXISTS market_entries_category_idx ON market_ranking_entries (category, period_end)`,
  `CREATE INDEX IF NOT EXISTS market_entries_sku_idx ON market_ranking_entries (sku_code, period_end)`,
  `CREATE INDEX IF NOT EXISTS market_entries_brand_idx ON market_ranking_entries (brand, period_end)`,
  `CREATE INDEX IF NOT EXISTS market_entries_dimension_idx ON market_ranking_entries (ranking_dimension, operation_mode, period_end)`,
  `CREATE INDEX IF NOT EXISTS market_entries_subcategory_idx ON market_ranking_entries (subcategory, period_end)`,
  `CREATE TABLE IF NOT EXISTS market_price_snapshots (
    id TEXT PRIMARY KEY NOT NULL,
    category TEXT NOT NULL,
    sku_code TEXT NOT NULL,
    ranking_dimension TEXT NOT NULL DEFAULT 'SKU',
    month TEXT NOT NULL,
    source_price_cents INTEGER,
    ai_image_price_cents INTEGER,
    ai_price_type TEXT NOT NULL DEFAULT '',
    ai_confidence_bps INTEGER,
    ai_reason TEXT NOT NULL DEFAULT '',
    confirmed_market_price_cents INTEGER,
    average_transaction_price_cents INTEGER,
    price_low_cents INTEGER,
    price_high_cents INTEGER,
    image_content_sha256 TEXT NOT NULL DEFAULT '',
    image_url TEXT NOT NULL DEFAULT '',
    confirmation_status TEXT NOT NULL DEFAULT 'source_table',
    confirmed_by TEXT NOT NULL DEFAULT '',
    confirmed_at TEXT,
    source_job_item_id TEXT NOT NULL DEFAULT '',
    prompt_version_id TEXT NOT NULL DEFAULT '',
    source_import_batch_id TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS market_price_snapshots_sku_month_uq ON market_price_snapshots (category, sku_code, ranking_dimension, month)`,
  `CREATE INDEX IF NOT EXISTS market_price_snapshots_status_idx ON market_price_snapshots (confirmation_status, updated_at)`,
  `CREATE INDEX IF NOT EXISTS market_price_snapshots_hash_idx ON market_price_snapshots (sku_code, image_content_sha256, confirmed_at)`,
  `CREATE TABLE IF NOT EXISTS market_image_cache (
    source_url TEXT PRIMARY KEY NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    object_key TEXT NOT NULL DEFAULT '',
    content_sha256 TEXT NOT NULL DEFAULT '',
    mime_type TEXT NOT NULL DEFAULT '',
    size_bytes INTEGER NOT NULL DEFAULT 0,
    image_source TEXT NOT NULL DEFAULT '',
    attempt_count INTEGER NOT NULL DEFAULT 0,
    error_code TEXT NOT NULL DEFAULT '',
    error_message TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS market_image_cache_object_key_idx ON market_image_cache (object_key)`,
  `CREATE INDEX IF NOT EXISTS market_image_cache_status_idx ON market_image_cache (status, updated_at)`,
] as const;

const schemaReadyByDatabase = new WeakMap<object, Promise<void>>();
const rankingEntryColumns: Array<[string, string]> = [
  ["ranking_dimension", "TEXT NOT NULL DEFAULT 'SKU'"],
  ["operation_mode", "TEXT NOT NULL DEFAULT '未知'"],
  ["subcategory", "TEXT NOT NULL DEFAULT ''"],
  ["price_low_cents", "INTEGER"],
  ["price_high_cents", "INTEGER"],
  ["price_estimated", "INTEGER NOT NULL DEFAULT 0"],
];

export function getMarketDatabase(): MarketDatabase {
  if (!env.DB) throw new Error("市场分析数据库未配置");
  return env.DB;
}

export async function ensureMarketSchema(db: MarketDatabase = getMarketDatabase()): Promise<void> {
  const key = db as unknown as object;
  const ready = schemaReadyByDatabase.get(key);
  if (ready) return ready;
  const setup = db.batch(schemaStatements.map((statement) => db.prepare(statement)))
    .then(async () => {
      await addMissingColumns(db, "market_ranking_entries", rankingEntryColumns);
    })
    .catch((error: unknown) => {
      schemaReadyByDatabase.delete(key);
      throw error;
    });
  schemaReadyByDatabase.set(key, setup);
  return setup;
}

async function addMissingColumns(db: MarketDatabase, table: string, columns: Array<[string, string]>) {
  const info = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  const existing = new Set((info.results ?? []).map((row) => row.name));
  for (const [name, definition] of columns) {
    if (!existing.has(name)) await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`).run();
  }
}

function monthKey(date: string) {
  return /^\d{4}-\d{2}/.test(date) ? date.slice(0, 7) : "";
}

type BatchRow = {
  id: string; source_type: string; file_name: string; file_size_bytes: number; file_hash: string;
  sheet_name: string; status: string; row_count: number; inserted_count: number; updated_count: number;
  warning_count: number; period_start: string | null; period_end: string | null; warnings_json: string;
  created_at: string; completed_at: string | null;
};

function parseJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function mapBatch(row: BatchRow): MarketImportBatch {
  return {
    id: row.id,
    sourceType: row.source_type,
    fileName: row.file_name,
    fileSizeBytes: row.file_size_bytes,
    fileHash: row.file_hash,
    sheetName: row.sheet_name,
    status: row.status,
    rowCount: row.row_count,
    insertedCount: row.inserted_count,
    updatedCount: row.updated_count,
    warningCount: row.warning_count,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    warnings: parseJson(row.warnings_json, []),
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

const batchColumns = `id, source_type, file_name, file_size_bytes, file_hash, sheet_name, status,
  row_count, inserted_count, updated_count, warning_count, period_start, period_end,
  warnings_json, created_at, completed_at`;

export async function findMarketBatchByHash(db: MarketDatabase, fileHash: string): Promise<MarketImportBatch | null> {
  const row = await db.prepare(`SELECT ${batchColumns} FROM market_import_batches WHERE file_hash = ? LIMIT 1`)
    .bind(fileHash).first<BatchRow>();
  return row ? mapBatch(row) : null;
}

export async function listMarketImportBatches(db: MarketDatabase, limit = 8): Promise<MarketImportBatch[]> {
  const rows = await db.prepare(`SELECT ${batchColumns} FROM market_import_batches ORDER BY created_at DESC LIMIT ?`)
    .bind(Math.max(1, Math.min(50, Math.trunc(limit)))).all<BatchRow>();
  return (rows.results ?? []).map(mapBatch);
}

export async function saveMarketImport(input: {
  db: MarketDatabase;
  batchId: string;
  sourceType: string;
  fileName: string;
  fileSizeBytes: number;
  fileHash: string;
  sheetName: string;
  rows: MarketEntryInput[];
  warnings: MarketImportIssue[];
}): Promise<MarketImportBatch> {
  const { db } = input;
  const dates = input.rows.flatMap((row) => [row.periodStart, row.periodEnd]).filter(Boolean).sort();
  await db.prepare(
    `INSERT INTO market_import_batches (
      id, source_type, file_name, file_size_bytes, file_hash, sheet_name, status,
      row_count, warning_count, period_start, period_end, warnings_json
    ) VALUES (?, ?, ?, ?, ?, ?, 'processing', ?, ?, ?, ?, ?)`,
  ).bind(
    input.batchId, input.sourceType, input.fileName, input.fileSizeBytes, input.fileHash,
    input.sheetName, input.rows.length, input.warnings.length, dates[0] ?? null,
    dates.at(-1) ?? null, JSON.stringify(input.warnings.slice(0, 100)),
  ).run();

  try {
    let inserted = 0;
    let updated = 0;
    for (let offset = 0; offset < input.rows.length; offset += 80) {
      const chunk = input.rows.slice(offset, offset + 80);
      const existingRows = await db.prepare(
        `SELECT natural_key FROM market_ranking_entries WHERE natural_key IN (${chunk.map(() => "?").join(",")})`,
      ).bind(...chunk.map((row) => row.naturalKey)).all<{ natural_key: string }>();
      const existingKeys = new Set((existingRows.results ?? []).map((row) => row.natural_key));
      inserted += chunk.filter((row) => !existingKeys.has(row.naturalKey)).length;
      updated += chunk.filter((row) => existingKeys.has(row.naturalKey)).length;
      await db.batch(chunk.map((row) => db.prepare(
      `INSERT INTO market_ranking_entries (
        natural_key, source_row_number, period_start, period_end, category, scope, ranking_dimension,
        operation_mode, subcategory, rank, sku_code, product_name, brand, price_cents,
        price_low_cents, price_high_cents, price_estimated, gmv_cents, quantity, page_views,
        visitors, conversion_bps, cart_customers, search_clicks, image_url, product_url,
        raw_json, last_import_batch_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(natural_key) DO UPDATE SET
        source_row_number = excluded.source_row_number,
        category = excluded.category,
        scope = excluded.scope,
        ranking_dimension = excluded.ranking_dimension,
        operation_mode = excluded.operation_mode,
        subcategory = excluded.subcategory,
        rank = excluded.rank,
        product_name = excluded.product_name,
        brand = excluded.brand,
        price_cents = excluded.price_cents,
        price_low_cents = excluded.price_low_cents,
        price_high_cents = excluded.price_high_cents,
        price_estimated = excluded.price_estimated,
        gmv_cents = excluded.gmv_cents,
        quantity = excluded.quantity,
        page_views = excluded.page_views,
        visitors = excluded.visitors,
        conversion_bps = excluded.conversion_bps,
        cart_customers = excluded.cart_customers,
        search_clicks = excluded.search_clicks,
        image_url = excluded.image_url,
        product_url = excluded.product_url,
        raw_json = excluded.raw_json,
        last_import_batch_id = excluded.last_import_batch_id,
        updated_at = CURRENT_TIMESTAMP`,
    ).bind(
      row.naturalKey, row.sourceRowNumber, row.periodStart, row.periodEnd, row.category,
      row.scope, row.rankingDimension, row.operationMode, row.subcategory, row.rank,
      row.skuCode, row.productName, row.brand, row.priceCents, row.priceLowCents,
      row.priceHighCents, row.priceEstimated ? 1 : 0, row.gmvCents, row.quantity, row.pageViews, row.visitors, row.conversionBps,
      row.cartCustomers, row.searchClicks, row.imageUrl, row.productUrl,
      JSON.stringify(row.raw), input.batchId,
      )));
      await db.batch(chunk.map((row) => db.prepare(
        `INSERT INTO market_price_snapshots (
          id, category, sku_code, ranking_dimension, month, source_price_cents,
          average_transaction_price_cents, price_low_cents, price_high_cents,
          image_url, confirmation_status, source_import_batch_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(category, sku_code, ranking_dimension, month) DO UPDATE SET
          source_price_cents = excluded.source_price_cents,
          average_transaction_price_cents = excluded.average_transaction_price_cents,
          price_low_cents = excluded.price_low_cents,
          price_high_cents = excluded.price_high_cents,
          image_url = CASE WHEN excluded.image_url <> '' THEN excluded.image_url ELSE market_price_snapshots.image_url END,
          confirmation_status = CASE
            WHEN market_price_snapshots.confirmed_market_price_cents IS NOT NULL THEN market_price_snapshots.confirmation_status
            WHEN excluded.source_price_cents IS NOT NULL THEN 'source_table'
            ELSE market_price_snapshots.confirmation_status
          END,
          source_import_batch_id = excluded.source_import_batch_id,
          updated_at = CURRENT_TIMESTAMP`
      ).bind(
        `market-price-${row.category}-${row.rankingDimension}-${row.skuCode}-${monthKey(row.periodEnd)}`,
        row.category,
        row.skuCode,
        row.rankingDimension,
        monthKey(row.periodEnd),
        row.priceCents,
        row.quantity > 0 ? Math.round(row.gmvCents / row.quantity) : null,
        row.priceLowCents,
        row.priceHighCents,
        row.imageUrl,
        row.priceCents === null ? "missing" : "source_table",
        input.batchId,
      )));
    }

    await db.prepare(
      `UPDATE market_import_batches SET status = 'completed', inserted_count = ?, updated_count = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ).bind(inserted, updated, input.batchId).run();
    const row = await db.prepare(`SELECT ${batchColumns} FROM market_import_batches WHERE id = ? LIMIT 1`)
      .bind(input.batchId).first<BatchRow>();
    if (!row) throw new Error("市场分析导入批次保存失败");
    return mapBatch(row);
  } catch (error) {
    await db.prepare(
      "UPDATE market_import_batches SET status = 'failed', completed_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).bind(input.batchId).run().catch(() => undefined);
    throw error;
  }
}

type SummaryRow = {
  product_count: number; category_count: number; brand_count: number; gmv_cents: number;
  quantity: number; page_views: number; visitors: number; own_product_count: number;
  self_operated_gmv_cents: number; pending_ai_count: number;
};

type EntryRow = {
  id: number; period_start: string; period_end: string; category: string; scope: string; ranking_dimension: "SKU" | "SPU";
  operation_mode: "POP" | "自营" | "未知"; subcategory: string; rank: number | null; previous_rank: number | null;
  sku_code: string; product_name: string; brand: string; price_cents: number | null;
  final_market_price_cents: number | null; market_price_source: string; average_transaction_price_cents: number | null;
  discount_bps: number | null; discount_reference: number;
  gmv_cents: number; quantity: number; page_views: number; visitors: number; conversion_bps: number | null;
  cart_customers: number; search_clicks: number; image_url: string; source_image_url: string; image_cache_status: string; product_url: string;
  is_own: number; own_sales_cents: number;
};

const priceBandSql = `CASE
  WHEN final_market_price_cents IS NULL THEN '未确认价格'
  WHEN final_market_price_cents < 50000 THEN '0-499'
  WHEN final_market_price_cents < 100000 THEN '500-999'
  WHEN final_market_price_cents < 200000 THEN '1000-1999'
  WHEN final_market_price_cents < 300000 THEN '2000-2999'
  ELSE '3000+'
END`;

function filterSql(filters: MarketOverviewFilters) {
  const clauses: string[] = [];
  const values: unknown[] = [];
  const list = (column: string, items?: string[]) => {
    const normalized = [...new Set((items ?? []).map((item) => item.trim()).filter(Boolean))].slice(0, 30);
    if (!normalized.length) return;
    clauses.push(`${column} IN (${normalized.map(() => "?").join(",")})`);
    values.push(...normalized);
  };
  if (filters.query?.trim()) {
    const query = `%${filters.query.trim().slice(0, 100)}%`;
    clauses.push("(m.sku_code LIKE ? OR m.product_name LIKE ? OR m.brand LIKE ?)");
    values.push(query, query, query);
  }
  list("m.category", filters.categories);
  list("m.scope", filters.scopes);
  list("m.brand", filters.brands);
  list("m.ranking_dimension", filters.rankingDimensions);
  list("m.operation_mode", filters.operationModes?.filter((item) => item !== "全部"));
  list("m.subcategory", filters.subcategories);
  if (filters.startDate) { clauses.push("m.period_end >= ?"); values.push(filters.startDate); }
  if (filters.endDate) { clauses.push("m.period_start <= ?"); values.push(filters.endDate); }
  const priceBands = [...new Set((filters.priceBands ?? []).map((item) => item.trim()).filter(Boolean))].slice(0, 20);
  const priceBandWhere = priceBands.length ? `WHERE price_band IN (${priceBands.map(() => "?").join(",")})` : "";
  return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", values, priceBandWhere, priceBandValues: priceBands };
}

export async function getMarketOverview(db: MarketDatabase, filters: MarketOverviewFilters = {}) {
  const { where, values, priceBandWhere, priceBandValues } = filterSql(filters);
  const enriched = `WITH enriched AS (
    SELECT m.*,
      mic.status AS image_cache_status_raw,
      mic.content_sha256 AS image_content_sha256,
      ps.confirmed_market_price_cents,
      ps.source_price_cents,
      ps.ai_image_price_cents,
      ps.ai_price_type,
      ps.ai_confidence_bps,
      ps.confirmation_status,
      ps.average_transaction_price_cents,
      COALESCE(ps.confirmed_market_price_cents, ps.source_price_cents, ps.average_transaction_price_cents, ps.ai_image_price_cents) AS final_market_price_cents,
      CASE
        WHEN ps.confirmed_market_price_cents IS NOT NULL THEN '人工确认'
        WHEN ps.source_price_cents IS NOT NULL THEN '源表价格'
        WHEN ps.average_transaction_price_cents IS NOT NULL THEN '系统计算'
        WHEN ps.ai_image_price_cents IS NOT NULL THEN 'AI待确认'
        ELSE '暂无价格'
      END AS market_price_source,
      CASE
        WHEN COALESCE(ps.confirmed_market_price_cents, ps.source_price_cents, ps.average_transaction_price_cents, ps.ai_image_price_cents) IS NULL THEN '未确认价格'
        WHEN COALESCE(ps.confirmed_market_price_cents, ps.source_price_cents, ps.average_transaction_price_cents, ps.ai_image_price_cents) < 50000 THEN '0-499'
        WHEN COALESCE(ps.confirmed_market_price_cents, ps.source_price_cents, ps.average_transaction_price_cents, ps.ai_image_price_cents) < 100000 THEN '500-999'
        WHEN COALESCE(ps.confirmed_market_price_cents, ps.source_price_cents, ps.average_transaction_price_cents, ps.ai_image_price_cents) < 200000 THEN '1000-1999'
        WHEN COALESCE(ps.confirmed_market_price_cents, ps.source_price_cents, ps.average_transaction_price_cents, ps.ai_image_price_cents) < 300000 THEN '2000-2999'
        ELSE '3000+'
      END AS price_band,
      CASE WHEN EXISTS (
        SELECT 1 FROM netshop_rows n
        WHERE n.sku_id = m.sku_code OR n.product_code = m.sku_code OR n.spu_id = m.sku_code
      ) OR EXISTS (
        SELECT 1 FROM sales_order_lines s WHERE s.product_code = m.sku_code
      ) THEN 1 ELSE 0 END AS is_own,
      COALESCE((SELECT SUM(s.allocated_amount_cents)
        FROM sales_order_lines s
        WHERE s.product_code = m.sku_code
          AND (? = '' OR substr(COALESCE(NULLIF(s.sales_time, ''), s.ship_time), 1, 10) >= ?)
          AND (? = '' OR substr(COALESCE(NULLIF(s.sales_time, ''), s.ship_time), 1, 10) <= ?)
      ), 0) AS own_sales_cents
    FROM market_ranking_entries m
    LEFT JOIN market_image_cache mic ON mic.source_url = m.image_url
    LEFT JOIN market_price_snapshots ps ON ps.category = m.category
      AND ps.sku_code = m.sku_code
      AND ps.ranking_dimension = m.ranking_dimension
      AND ps.month = substr(m.period_end, 1, 7)
    ${where}
  ), filtered AS (SELECT * FROM enriched ${priceBandWhere})`;
  const dateValues = [filters.startDate ?? "", filters.startDate ?? "", filters.endDate ?? "", filters.endDate ?? ""];
  const bindings = [...dateValues, ...values, ...priceBandValues];
  const [summary, ranking, trend, categories, scopes, brands, dimensions, modes, subcategories, priceBands, priceBandRows, brandRows, subcategoryRows, priceRows, cutoff, batches, imageCache] = await Promise.all([
    db.prepare(`${enriched} SELECT COUNT(DISTINCT sku_code) product_count, COUNT(DISTINCT category) category_count,
      COUNT(DISTINCT brand) brand_count, COALESCE(SUM(gmv_cents), 0) gmv_cents,
      COALESCE(SUM(quantity), 0) quantity, COALESCE(SUM(page_views), 0) page_views,
      COALESCE(SUM(visitors), 0) visitors, COUNT(DISTINCT CASE WHEN is_own = 1 THEN sku_code END) own_product_count,
      COALESCE(SUM(CASE WHEN operation_mode = '自营' THEN gmv_cents ELSE 0 END), 0) self_operated_gmv_cents,
      COUNT(DISTINCT CASE WHEN COALESCE(confirmation_status, '') IN ('missing','ai_pending','review_pending') OR market_price_source = 'AI待确认' THEN sku_code END) pending_ai_count
      FROM filtered`)
      .bind(...bindings).first<SummaryRow>(),
    db.prepare(`${enriched} SELECT id, period_start, period_end, category, scope, ranking_dimension, operation_mode, subcategory, rank,
      (SELECT p.rank FROM market_ranking_entries p
        WHERE p.category=filtered.category AND p.sku_code=filtered.sku_code AND p.ranking_dimension=filtered.ranking_dimension
          AND p.period_end < filtered.period_end
        ORDER BY p.period_end DESC, p.id DESC LIMIT 1) previous_rank,
      sku_code, product_name, brand, price_cents, final_market_price_cents, market_price_source,
      average_transaction_price_cents,
      CASE WHEN final_market_price_cents IS NOT NULL AND final_market_price_cents > 0 AND average_transaction_price_cents IS NOT NULL
        THEN CAST(ROUND((1 - average_transaction_price_cents * 1.0 / final_market_price_cents) * 10000) AS INTEGER) ELSE NULL END discount_bps,
      CASE WHEN price_estimated = 1 THEN 1 ELSE 0 END discount_reference,
      gmv_cents, quantity, page_views, visitors,
      conversion_bps, cart_customers, search_clicks,
      CASE WHEN image_url <> '' AND image_cache_status_raw = 'ready' THEN '/api/market/images/' || image_content_sha256 ELSE image_url END image_url,
      image_url source_image_url, COALESCE(image_cache_status_raw, CASE WHEN image_url = '' THEN 'missing' ELSE 'pending' END) image_cache_status,
      product_url, is_own, own_sales_cents
      FROM filtered ORDER BY CASE WHEN rank IS NULL THEN 1 ELSE 0 END, rank, gmv_cents DESC LIMIT 200`)
      .bind(...bindings).all<EntryRow>(),
    db.prepare(`${enriched} SELECT substr(period_end, 1, 7) period, SUM(gmv_cents) gmv_cents, SUM(quantity) quantity,
      SUM(visitors) visitors, COUNT(DISTINCT sku_code) product_count, COUNT(DISTINCT brand) brand_count,
      SUM(CASE WHEN operation_mode='POP' THEN gmv_cents ELSE 0 END) pop_gmv_cents,
      SUM(CASE WHEN operation_mode='自营' THEN gmv_cents ELSE 0 END) self_gmv_cents,
      CASE WHEN SUM(quantity)>0 THEN CAST(ROUND(SUM(gmv_cents)*1.0/SUM(quantity)) AS INTEGER) ELSE NULL END average_transaction_price_cents,
      CASE WHEN SUM(gmv_cents)>0 THEN CAST(ROUND(SUM(COALESCE(final_market_price_cents,0)*gmv_cents)*1.0/SUM(CASE WHEN final_market_price_cents IS NULL THEN 0 ELSE gmv_cents END)) AS INTEGER) ELSE NULL END weighted_market_price_cents
      FROM filtered GROUP BY substr(period_end, 1, 7) ORDER BY period ASC LIMIT 60`).bind(...bindings).all<Record<string, string | number | null>>(),
    db.prepare("SELECT category value, COUNT(*) count FROM market_ranking_entries WHERE category <> '' GROUP BY category ORDER BY count DESC, value LIMIT 100").all<{ value: string; count: number }>(),
    db.prepare("SELECT scope value, COUNT(*) count FROM market_ranking_entries WHERE scope <> '' GROUP BY scope ORDER BY count DESC, value LIMIT 30").all<{ value: string; count: number }>(),
    db.prepare("SELECT brand value, COUNT(*) count FROM market_ranking_entries WHERE brand <> '' GROUP BY brand ORDER BY count DESC, value LIMIT 100").all<{ value: string; count: number }>(),
    db.prepare("SELECT ranking_dimension value, COUNT(*) count FROM market_ranking_entries GROUP BY ranking_dimension ORDER BY value").all<{ value: string; count: number }>(),
    db.prepare("SELECT operation_mode value, COUNT(*) count FROM market_ranking_entries GROUP BY operation_mode ORDER BY value").all<{ value: string; count: number }>(),
    db.prepare("SELECT subcategory value, COUNT(*) count FROM market_ranking_entries WHERE subcategory <> '' GROUP BY subcategory ORDER BY count DESC, value LIMIT 100").all<{ value: string; count: number }>(),
    db.prepare(`${enriched} SELECT price_band value, COUNT(*) count FROM filtered GROUP BY price_band ORDER BY CASE price_band WHEN '未确认价格' THEN 9 WHEN '3000+' THEN 8 ELSE 1 END, price_band`).bind(...bindings).all<{ value: string; count: number }>(),
    db.prepare(`${enriched} SELECT price_band, SUM(gmv_cents) gmv_cents, SUM(quantity) quantity,
      COUNT(DISTINCT sku_code) sku_count,
      SUM(CASE WHEN operation_mode='POP' THEN gmv_cents ELSE 0 END) pop_gmv_cents,
      SUM(CASE WHEN operation_mode='自营' THEN gmv_cents ELSE 0 END) self_gmv_cents,
      GROUP_CONCAT(DISTINCT brand) brands
      FROM filtered GROUP BY price_band ORDER BY gmv_cents DESC`).bind(...bindings).all<Record<string, string | number>>(),
    db.prepare(`${enriched} SELECT brand, SUM(gmv_cents) gmv_cents, SUM(quantity) quantity, COUNT(DISTINCT sku_code) sku_count,
      MIN(rank) best_rank, GROUP_CONCAT(DISTINCT price_band) price_bands, GROUP_CONCAT(DISTINCT subcategory) subcategories
      FROM filtered WHERE brand <> '' GROUP BY brand ORDER BY gmv_cents DESC LIMIT 30`).bind(...bindings).all<Record<string, string | number>>(),
    db.prepare(`${enriched} SELECT subcategory, COUNT(DISTINCT sku_code) sku_count, SUM(gmv_cents) gmv_cents,
      SUM(quantity) quantity, SUM(CASE WHEN operation_mode='自营' THEN gmv_cents ELSE 0 END) self_gmv_cents,
      CASE WHEN SUM(quantity)>0 THEN CAST(ROUND(SUM(gmv_cents)*1.0/SUM(quantity)) AS INTEGER) ELSE NULL END average_transaction_price_cents,
      COUNT(DISTINCT CASE WHEN market_price_source IN ('AI待确认','暂无价格') THEN sku_code END) pending_count,
      GROUP_CONCAT(DISTINCT brand) brands, GROUP_CONCAT(DISTINCT price_band) price_bands
      FROM filtered GROUP BY subcategory ORDER BY gmv_cents DESC LIMIT 60`).bind(...bindings).all<Record<string, string | number | null>>(),
    db.prepare(`${enriched} SELECT final_market_price_cents price, gmv_cents, quantity
      FROM filtered WHERE final_market_price_cents IS NOT NULL ORDER BY final_market_price_cents ASC`).bind(...bindings).all<{ price: number; gmv_cents: number; quantity: number }>(),
    db.prepare(`${enriched} SELECT MIN(period_start) date_min, MAX(period_end) date_max FROM filtered`)
      .bind(...bindings).first<{ date_min: string | null; date_max: string | null }>(),
    listMarketImportBatches(db, 8),
    db.prepare(`SELECT COUNT(DISTINCT m.image_url) total,
      COUNT(DISTINCT CASE WHEN mic.status='ready' THEN m.image_url END) cached,
      COUNT(DISTINCT CASE WHEN mic.status='failed' AND mic.attempt_count>=3 THEN m.image_url END) failed
      FROM market_ranking_entries m LEFT JOIN market_image_cache mic ON mic.source_url=m.image_url
      WHERE m.image_url<>''`).first<{ total: number; cached: number; failed: number }>(),
  ]);
  const summaryValue = summary ?? { product_count: 0, category_count: 0, brand_count: 0, gmv_cents: 0, quantity: 0, page_views: 0, visitors: 0, own_product_count: 0, self_operated_gmv_cents: 0, pending_ai_count: 0 };
  const prices = (priceRows.results ?? []).map((row) => Number(row.price)).filter(Number.isFinite).sort((a, b) => a - b);
  const medianPrice = prices.length ? prices[Math.floor((prices.length - 1) / 2)] : null;
  const weightedRows = priceRows.results ?? [];
  const weightedDenominator = weightedRows.reduce((sum, row) => sum + Number(row.gmv_cents ?? 0), 0);
  const weightedMarketPrice = weightedDenominator > 0
    ? Math.round(weightedRows.reduce((sum, row) => sum + Number(row.price ?? 0) * Number(row.gmv_cents ?? 0), 0) / weightedDenominator)
    : null;
  const averageTransactionPrice = Number(summaryValue.quantity ?? 0) > 0 ? Math.round(Number(summaryValue.gmv_cents ?? 0) / Number(summaryValue.quantity ?? 0)) : null;
  const brandTotal = (brandRows.results ?? []).reduce((sum, row) => sum + Number(row.gmv_cents ?? 0), 0);
  const brandShares = (brandRows.results ?? []).map((row) => ({
    brand: String(row.brand ?? ""),
    gmvCents: Number(row.gmv_cents ?? 0),
    quantity: Number(row.quantity ?? 0),
    skuCount: Number(row.sku_count ?? 0),
    bestRank: Number(row.best_rank ?? 0) || null,
    gmvShareBps: brandTotal ? Math.round(Number(row.gmv_cents ?? 0) / brandTotal * 10_000) : 0,
    priceBands: String(row.price_bands ?? "").split(",").filter(Boolean).slice(0, 5),
    subcategories: String(row.subcategories ?? "").split(",").filter(Boolean).slice(0, 5),
  }));
  const cr = (count: number) => brandTotal ? Math.round(brandShares.slice(0, count).reduce((sum, row) => sum + row.gmvCents, 0) / brandTotal * 10_000) : 0;
  return {
    summary: {
      productCount: Number(summaryValue.product_count ?? 0),
      categoryCount: Number(summaryValue.category_count ?? 0),
      brandCount: Number(summaryValue.brand_count ?? 0),
      gmvCents: Number(summaryValue.gmv_cents ?? 0),
      quantity: Number(summaryValue.quantity ?? 0),
      pageViews: Number(summaryValue.page_views ?? 0),
      visitors: Number(summaryValue.visitors ?? 0),
      ownProductCount: Number(summaryValue.own_product_count ?? 0),
      activeSkuCount: Number(summaryValue.product_count ?? 0),
      pendingAiCount: Number(summaryValue.pending_ai_count ?? 0),
      selfOperatedGmvCents: Number(summaryValue.self_operated_gmv_cents ?? 0),
      selfOperatedShareBps: Number(summaryValue.gmv_cents ?? 0) ? Math.round(Number(summaryValue.self_operated_gmv_cents ?? 0) / Number(summaryValue.gmv_cents ?? 0) * 10_000) : null,
      medianMarketPriceCents: medianPrice,
      weightedMarketPriceCents: weightedMarketPrice,
      averageTransactionPriceCents: averageTransactionPrice,
    },
    items: (ranking.results ?? []).map((row) => ({
      id: row.id, periodStart: row.period_start, periodEnd: row.period_end, category: row.category,
      scope: row.scope, rankingDimension: row.ranking_dimension, operationMode: row.operation_mode, subcategory: row.subcategory,
      rank: row.rank, previousRank: row.previous_rank, rankChange: row.previous_rank !== null && row.rank !== null ? row.previous_rank - row.rank : null,
      skuCode: row.sku_code, productName: row.product_name,
      brand: row.brand, priceCents: row.price_cents, marketPriceCents: row.final_market_price_cents,
      marketPriceSource: row.market_price_source, averageTransactionPriceCents: row.average_transaction_price_cents,
      discountBps: row.discount_bps, discountReference: Boolean(row.discount_reference),
      gmvCents: row.gmv_cents, quantity: row.quantity,
      pageViews: row.page_views, visitors: row.visitors, conversionBps: row.conversion_bps,
      cartCustomers: row.cart_customers, searchClicks: row.search_clicks, imageUrl: row.image_url,
      sourceImageUrl: row.source_image_url, imageCacheStatus: row.image_cache_status,
      productUrl: row.product_url, isOwn: Boolean(row.is_own), ownSalesCents: row.own_sales_cents,
    })),
    trend: trend.results ?? [],
    priceBands: (priceBands.results ?? []).map((row) => ({ value: row.value, count: Number(row.count ?? 0) })),
    priceBandSummary: (priceBandRows.results ?? []).map((row) => ({
      priceBand: String(row.price_band ?? "未确认价格"),
      gmvCents: Number(row.gmv_cents ?? 0),
      quantity: Number(row.quantity ?? 0),
      skuCount: Number(row.sku_count ?? 0),
      popGmvCents: Number(row.pop_gmv_cents ?? 0),
      selfGmvCents: Number(row.self_gmv_cents ?? 0),
      selfOperatedShareBps: Number(row.gmv_cents ?? 0) ? Math.round(Number(row.self_gmv_cents ?? 0) / Number(row.gmv_cents ?? 0) * 10_000) : null,
      mainBrands: String(row.brands ?? "").split(",").filter(Boolean).slice(0, 5),
    })),
    brandAnalysis: {
      items: brandShares,
      cr3Bps: cr(3),
      cr5Bps: cr(5),
      concentration: cr(3) >= 6000 ? "高" : cr(3) >= 3500 ? "中" : "低",
    },
    subcategorySummary: (subcategoryRows.results ?? []).map((row) => ({
      subcategory: String(row.subcategory || "未分类"),
      skuCount: Number(row.sku_count ?? 0),
      gmvCents: Number(row.gmv_cents ?? 0),
      gmvShareBps: Number(summaryValue.gmv_cents ?? 0) ? Math.round(Number(row.gmv_cents ?? 0) / Number(summaryValue.gmv_cents ?? 0) * 10_000) : 0,
      quantity: Number(row.quantity ?? 0),
      averageTransactionPriceCents: row.average_transaction_price_cents === null ? null : Number(row.average_transaction_price_cents),
      selfOperatedShareBps: Number(row.gmv_cents ?? 0) ? Math.round(Number(row.self_gmv_cents ?? 0) / Number(row.gmv_cents ?? 0) * 10_000) : null,
      pendingSkuCount: Number(row.pending_count ?? 0),
      mainBrands: String(row.brands ?? "").split(",").filter(Boolean).slice(0, 5),
      mainPriceBands: String(row.price_bands ?? "").split(",").filter(Boolean).slice(0, 5),
    })),
    filters: {
      categories: categories.results ?? [], scopes: scopes.results ?? [], brands: brands.results ?? [],
      rankingDimensions: dimensions.results ?? [], operationModes: modes.results ?? [], subcategories: subcategories.results ?? [],
      priceBands: priceBands.results ?? [],
    },
    dataRange: { startDate: cutoff?.date_min ?? null, endDate: cutoff?.date_max ?? null },
    batches,
    imageCache: {
      total: Number(imageCache?.total ?? 0), cached: Number(imageCache?.cached ?? 0), failed: Number(imageCache?.failed ?? 0),
      pending: Math.max(0, Number(imageCache?.total ?? 0) - Number(imageCache?.cached ?? 0) - Number(imageCache?.failed ?? 0)),
    },
  };
}

export async function getMarketItemTrend(db: MarketDatabase, input: {
  skuCode: string;
  category?: string;
  rankingDimension?: "SKU" | "SPU";
}) {
  const skuCode = input.skuCode.trim().slice(0, 80);
  if (!skuCode) throw new Error("SKU 不能为空");
  const clauses = ["m.sku_code = ?"];
  const values: unknown[] = [skuCode];
  if (input.category?.trim()) { clauses.push("m.category = ?"); values.push(input.category.trim().slice(0, 120)); }
  if (input.rankingDimension === "SKU" || input.rankingDimension === "SPU") { clauses.push("m.ranking_dimension = ?"); values.push(input.rankingDimension); }
  const rows = await db.prepare(`
    SELECT m.period_start, m.period_end, substr(m.period_end, 1, 7) month, m.category, m.scope,
      m.ranking_dimension, m.operation_mode, m.subcategory, m.rank, m.sku_code, m.product_name, m.brand,
      m.gmv_cents, m.quantity, m.visitors, m.conversion_bps,
      COALESCE(ps.confirmed_market_price_cents, ps.source_price_cents, ps.average_transaction_price_cents, ps.ai_image_price_cents) market_price_cents,
      ps.source_price_cents, ps.ai_image_price_cents, ps.ai_price_type, ps.ai_confidence_bps,
      ps.confirmed_market_price_cents, ps.average_transaction_price_cents,
      CASE
        WHEN ps.confirmed_market_price_cents IS NOT NULL THEN '人工确认'
        WHEN ps.source_price_cents IS NOT NULL THEN '源表价格'
        WHEN ps.average_transaction_price_cents IS NOT NULL THEN '系统计算'
        WHEN ps.ai_image_price_cents IS NOT NULL THEN 'AI待确认'
        ELSE '暂无价格'
      END price_status,
      COALESCE(ps.confirmation_status, 'missing') confirmation_status
    FROM market_ranking_entries m
    LEFT JOIN market_price_snapshots ps ON ps.category = m.category
      AND ps.sku_code = m.sku_code
      AND ps.ranking_dimension = m.ranking_dimension
      AND ps.month = substr(m.period_end, 1, 7)
    WHERE ${clauses.join(" AND ")}
    ORDER BY m.period_end ASC, m.id ASC
    LIMIT 120
  `).bind(...values).all<Record<string, string | number | null>>();
  return {
    skuCode,
    items: (rows.results ?? []).map((row) => ({
      periodStart: String(row.period_start ?? ""),
      periodEnd: String(row.period_end ?? ""),
      month: String(row.month ?? ""),
      category: String(row.category ?? ""),
      scope: String(row.scope ?? ""),
      rankingDimension: String(row.ranking_dimension ?? "SKU"),
      operationMode: String(row.operation_mode ?? "未知"),
      subcategory: String(row.subcategory ?? ""),
      rank: row.rank === null ? null : Number(row.rank),
      skuCode: String(row.sku_code ?? ""),
      productName: String(row.product_name ?? ""),
      brand: String(row.brand ?? ""),
      gmvCents: Number(row.gmv_cents ?? 0),
      quantity: Number(row.quantity ?? 0),
      visitors: Number(row.visitors ?? 0),
      conversionBps: row.conversion_bps === null ? null : Number(row.conversion_bps),
      marketPriceCents: row.market_price_cents === null ? null : Number(row.market_price_cents),
      averageTransactionPriceCents: row.average_transaction_price_cents === null ? null : Number(row.average_transaction_price_cents),
      sourcePriceCents: row.source_price_cents === null ? null : Number(row.source_price_cents),
      aiImagePriceCents: row.ai_image_price_cents === null ? null : Number(row.ai_image_price_cents),
      aiPriceType: String(row.ai_price_type ?? ""),
      aiConfidenceBps: row.ai_confidence_bps === null ? null : Number(row.ai_confidence_bps),
      confirmedMarketPriceCents: row.confirmed_market_price_cents === null ? null : Number(row.confirmed_market_price_cents),
      priceStatus: String(row.price_status ?? "暂无价格"),
      confirmationStatus: String(row.confirmation_status ?? "missing"),
    })),
  };
}
