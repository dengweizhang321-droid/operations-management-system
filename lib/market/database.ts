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
  rank: number | null;
  skuCode: string;
  productName: string;
  brand: string;
  priceCents: number | null;
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
    rank INTEGER,
    sku_code TEXT NOT NULL,
    product_name TEXT NOT NULL DEFAULT '',
    brand TEXT NOT NULL DEFAULT '',
    price_cents INTEGER,
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
] as const;

const schemaReadyByDatabase = new WeakMap<object, Promise<void>>();

export function getMarketDatabase(): MarketDatabase {
  if (!env.DB) throw new Error("市场分析数据库未配置");
  return env.DB;
}

export async function ensureMarketSchema(db: MarketDatabase = getMarketDatabase()): Promise<void> {
  const key = db as unknown as object;
  const ready = schemaReadyByDatabase.get(key);
  if (ready) return ready;
  const setup = db.batch(schemaStatements.map((statement) => db.prepare(statement)))
    .then(() => undefined)
    .catch((error: unknown) => {
      schemaReadyByDatabase.delete(key);
      throw error;
    });
  schemaReadyByDatabase.set(key, setup);
  return setup;
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
        natural_key, source_row_number, period_start, period_end, category, scope, rank,
        sku_code, product_name, brand, price_cents, gmv_cents, quantity, page_views,
        visitors, conversion_bps, cart_customers, search_clicks, image_url, product_url,
        raw_json, last_import_batch_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(natural_key) DO UPDATE SET
        source_row_number = excluded.source_row_number,
        category = excluded.category,
        scope = excluded.scope,
        rank = excluded.rank,
        product_name = excluded.product_name,
        brand = excluded.brand,
        price_cents = excluded.price_cents,
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
      row.scope, row.rank, row.skuCode, row.productName, row.brand, row.priceCents,
      row.gmvCents, row.quantity, row.pageViews, row.visitors, row.conversionBps,
      row.cartCustomers, row.searchClicks, row.imageUrl, row.productUrl,
      JSON.stringify(row.raw), input.batchId,
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
};

type EntryRow = {
  id: number; period_start: string; period_end: string; category: string; scope: string;
  rank: number | null; sku_code: string; product_name: string; brand: string; price_cents: number | null;
  gmv_cents: number; quantity: number; page_views: number; visitors: number; conversion_bps: number | null;
  cart_customers: number; search_clicks: number; image_url: string; product_url: string;
  is_own: number; own_sales_cents: number;
};

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
  if (filters.startDate) { clauses.push("m.period_end >= ?"); values.push(filters.startDate); }
  if (filters.endDate) { clauses.push("m.period_start <= ?"); values.push(filters.endDate); }
  return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", values };
}

export async function getMarketOverview(db: MarketDatabase, filters: MarketOverviewFilters = {}) {
  const { where, values } = filterSql(filters);
  const enriched = `WITH enriched AS (
    SELECT m.*,
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
    FROM market_ranking_entries m ${where}
  )`;
  const dateValues = [filters.startDate ?? "", filters.startDate ?? "", filters.endDate ?? "", filters.endDate ?? ""];
  const bindings = [...dateValues, ...values];
  const [summary, ranking, trend, categories, scopes, brands, cutoff, batches] = await Promise.all([
    db.prepare(`${enriched} SELECT COUNT(DISTINCT sku_code) product_count, COUNT(DISTINCT category) category_count,
      COUNT(DISTINCT brand) brand_count, COALESCE(SUM(gmv_cents), 0) gmv_cents,
      COALESCE(SUM(quantity), 0) quantity, COALESCE(SUM(page_views), 0) page_views,
      COALESCE(SUM(visitors), 0) visitors, COUNT(DISTINCT CASE WHEN is_own = 1 THEN sku_code END) own_product_count FROM enriched`)
      .bind(...bindings).first<SummaryRow>(),
    db.prepare(`${enriched} SELECT id, period_start, period_end, category, scope, rank, sku_code,
      product_name, brand, price_cents, gmv_cents, quantity, page_views, visitors,
      conversion_bps, cart_customers, search_clicks, image_url, product_url, is_own, own_sales_cents
      FROM enriched ORDER BY CASE WHEN rank IS NULL THEN 1 ELSE 0 END, rank, gmv_cents DESC LIMIT 200`)
      .bind(...bindings).all<EntryRow>(),
    db.prepare(`${enriched} SELECT period_end period, SUM(gmv_cents) gmv_cents, SUM(quantity) quantity,
      SUM(visitors) visitors, COUNT(DISTINCT sku_code) product_count FROM enriched
      GROUP BY period_end ORDER BY period_end ASC LIMIT 36`).bind(...bindings).all<Record<string, string | number>>(),
    db.prepare("SELECT category value, COUNT(*) count FROM market_ranking_entries WHERE category <> '' GROUP BY category ORDER BY count DESC, value LIMIT 100").all<{ value: string; count: number }>(),
    db.prepare("SELECT scope value, COUNT(*) count FROM market_ranking_entries WHERE scope <> '' GROUP BY scope ORDER BY count DESC, value LIMIT 30").all<{ value: string; count: number }>(),
    db.prepare("SELECT brand value, COUNT(*) count FROM market_ranking_entries WHERE brand <> '' GROUP BY brand ORDER BY count DESC, value LIMIT 100").all<{ value: string; count: number }>(),
    db.prepare(`${enriched} SELECT MIN(period_start) date_min, MAX(period_end) date_max FROM enriched`)
      .bind(...bindings).first<{ date_min: string | null; date_max: string | null }>(),
    listMarketImportBatches(db, 8),
  ]);
  const summaryValue = summary ?? { product_count: 0, category_count: 0, brand_count: 0, gmv_cents: 0, quantity: 0, page_views: 0, visitors: 0, own_product_count: 0 };
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
    },
    items: (ranking.results ?? []).map((row) => ({
      id: row.id, periodStart: row.period_start, periodEnd: row.period_end, category: row.category,
      scope: row.scope, rank: row.rank, skuCode: row.sku_code, productName: row.product_name,
      brand: row.brand, priceCents: row.price_cents, gmvCents: row.gmv_cents, quantity: row.quantity,
      pageViews: row.page_views, visitors: row.visitors, conversionBps: row.conversion_bps,
      cartCustomers: row.cart_customers, searchClicks: row.search_clicks, imageUrl: row.image_url,
      productUrl: row.product_url, isOwn: Boolean(row.is_own), ownSalesCents: row.own_sales_cents,
    })),
    trend: trend.results ?? [],
    filters: {
      categories: categories.results ?? [], scopes: scopes.results ?? [], brands: brands.results ?? [],
    },
    dataRange: { startDate: cutoff?.date_min ?? null, endDate: cutoff?.date_max ?? null },
    batches,
  };
}
