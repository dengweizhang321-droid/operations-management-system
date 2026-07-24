import { env } from "cloudflare:workers";
import { marketBatchColumns, mapMarketBatch, saveMarketImportCore } from "@/lib/market/import-core";
import { ensureMarketSchemaCached, officialPriceBandSql } from "@/lib/market/schema-core";

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

export function getMarketDatabase(): MarketDatabase {
  if (!env.DB) throw new Error("市场分析数据库未配置");
  return env.DB;
}

export async function ensureMarketSchema(db: MarketDatabase = getMarketDatabase()): Promise<void> {
  return ensureMarketSchemaCached(db);
}

export async function findMarketBatchByHash(db: MarketDatabase, fileHash: string): Promise<MarketImportBatch | null> {
  const row = await db.prepare(`SELECT ${marketBatchColumns} FROM market_import_batches WHERE file_hash = ? LIMIT 1`)
    .bind(fileHash).first<Parameters<typeof mapMarketBatch>[0]>();
  return row ? mapMarketBatch(row) as MarketImportBatch : null;
}

export async function listMarketImportBatches(db: MarketDatabase, limit = 8): Promise<MarketImportBatch[]> {
  const rows = await db.prepare(`SELECT ${marketBatchColumns} FROM market_import_batches ORDER BY created_at DESC LIMIT ?`)
    .bind(Math.max(1, Math.min(50, Math.trunc(limit)))).all<Parameters<typeof mapMarketBatch>[0]>();
  return (rows.results ?? []).map((row) => mapMarketBatch(row) as MarketImportBatch);
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
  return saveMarketImportCore(input) as Promise<MarketImportBatch>;
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
  official_market_price_cents: number | null; candidate_price_cents: number | null; market_price_source: string; candidate_price_source: string; average_transaction_price_cents: number | null;
  discount_bps: number | null; discount_reference: number;
  gmv_cents: number; quantity: number; page_views: number; visitors: number; conversion_bps: number | null;
  cart_customers: number; search_clicks: number; image_url: string; source_image_url: string; image_cache_status: string; product_url: string;
  is_own: number; own_sales_cents: number;
};

const unknownPriceBand = "\u672a\u786e\u8ba4\u4ef7\u683c";

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
      ps.confirmed_market_price_cents AS official_market_price_cents,
      COALESCE(ps.source_price_cents, ps.average_transaction_price_cents, ps.ai_image_price_cents) AS candidate_price_cents,
      CASE
        WHEN ps.confirmed_market_price_cents IS NOT NULL THEN '人工确认'
        ELSE '未确认价格'
      END AS market_price_source,
      CASE
        WHEN ps.source_price_cents IS NOT NULL THEN '源表价格'
        WHEN ps.average_transaction_price_cents IS NOT NULL THEN '系统计算'
        WHEN ps.ai_image_price_cents IS NOT NULL THEN 'AI待确认'
        ELSE '暂无价格'
      END AS candidate_price_source,
      ${officialPriceBandSql("ps.confirmed_market_price_cents", {
        confirmationStatusSql: "ps.confirmation_status",
        aiPriceTypeSql: "ps.ai_price_type",
        categorySql: "m.category",
        periodEndSql: "m.period_end",
      })} AS price_band,
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
      AND ps.scope = m.scope
      AND ps.sku_code = m.sku_code
      AND ps.ranking_dimension = m.ranking_dimension
      AND ps.month = substr(m.period_end, 1, 7)
    ${where}
  ), filtered AS (SELECT * FROM enriched ${priceBandWhere})`;
  const dateValues = [filters.startDate ?? "", filters.startDate ?? "", filters.endDate ?? "", filters.endDate ?? ""];
  const bindings = [...dateValues, ...values, ...priceBandValues];
  const [summary, ranking, trend, categories, scopes, brands, dimensions, modes, subcategories, priceBands, priceBandRows, priceBandTrendRows, brandRows, subcategoryRows, priceRows, cutoff, batches, imageCache] = await Promise.all([
    db.prepare(`${enriched} SELECT COUNT(DISTINCT sku_code) product_count, COUNT(DISTINCT category) category_count,
      COUNT(DISTINCT COALESCE(NULLIF(brand,''), '未识别品牌')) brand_count, COALESCE(SUM(gmv_cents), 0) gmv_cents,
      COALESCE(SUM(quantity), 0) quantity, COALESCE(SUM(page_views), 0) page_views,
      COALESCE(SUM(visitors), 0) visitors, COUNT(DISTINCT CASE WHEN is_own = 1 THEN sku_code END) own_product_count,
      COALESCE(SUM(CASE WHEN operation_mode = '自营' THEN gmv_cents ELSE 0 END), 0) self_operated_gmv_cents,
      COUNT(DISTINCT CASE WHEN COALESCE(confirmation_status, '') IN ('missing','ai_pending','review_pending') OR market_price_source = 'AI待确认' THEN sku_code END) pending_ai_count
      FROM filtered`)
      .bind(...bindings).first<SummaryRow>(),
    db.prepare(`${enriched} SELECT id, period_start, period_end, category, scope, ranking_dimension, operation_mode, subcategory, rank,
      (SELECT p.rank FROM market_ranking_entries p
        WHERE p.category=filtered.category AND p.sku_code=filtered.sku_code AND p.ranking_dimension=filtered.ranking_dimension
          AND p.scope=filtered.scope AND p.operation_mode=filtered.operation_mode
          AND p.period_end < filtered.period_end
        ORDER BY p.period_end DESC, p.id DESC LIMIT 1) previous_rank,
      sku_code, product_name, brand, price_cents, official_market_price_cents, candidate_price_cents, market_price_source, candidate_price_source,
      average_transaction_price_cents,
      CASE WHEN official_market_price_cents IS NOT NULL AND official_market_price_cents > 0 AND average_transaction_price_cents IS NOT NULL
        THEN CAST(ROUND((1 - average_transaction_price_cents * 1.0 / official_market_price_cents) * 10000) AS INTEGER) ELSE NULL END discount_bps,
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
      CASE WHEN SUM(CASE WHEN official_market_price_cents IS NULL THEN 0 ELSE gmv_cents END)>0 THEN CAST(ROUND(SUM(COALESCE(official_market_price_cents,0)*gmv_cents)*1.0/SUM(CASE WHEN official_market_price_cents IS NULL THEN 0 ELSE gmv_cents END)) AS INTEGER) ELSE NULL END weighted_market_price_cents
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
    db.prepare(`${enriched} SELECT substr(period_end,1,7) period, price_band,
      SUM(gmv_cents) gmv_cents, SUM(quantity) quantity,
      SUM(SUM(gmv_cents)) OVER (PARTITION BY substr(period_end,1,7)) period_gmv_cents
      FROM filtered GROUP BY substr(period_end,1,7), price_band ORDER BY period, gmv_cents DESC`).bind(...bindings).all<Record<string, string | number>>(),
    db.prepare(`${enriched} SELECT COALESCE(NULLIF(brand,''), '未识别品牌') brand,
      SUM(gmv_cents) gmv_cents, SUM(quantity) quantity, COUNT(DISTINCT sku_code) sku_count,
      MIN(rank) best_rank, GROUP_CONCAT(DISTINCT price_band) price_bands, GROUP_CONCAT(DISTINCT subcategory) subcategories
      FROM filtered GROUP BY COALESCE(NULLIF(brand,''), '未识别品牌') ORDER BY gmv_cents DESC`).bind(...bindings).all<Record<string, string | number>>(),
    db.prepare(`${enriched} SELECT subcategory, COUNT(DISTINCT sku_code) sku_count, SUM(gmv_cents) gmv_cents,
      SUM(quantity) quantity, SUM(CASE WHEN operation_mode='自营' THEN gmv_cents ELSE 0 END) self_gmv_cents,
      CASE WHEN SUM(quantity)>0 THEN CAST(ROUND(SUM(gmv_cents)*1.0/SUM(quantity)) AS INTEGER) ELSE NULL END average_transaction_price_cents,
      COUNT(DISTINCT CASE WHEN official_market_price_cents IS NULL THEN sku_code END) pending_count,
      GROUP_CONCAT(DISTINCT brand) brands, GROUP_CONCAT(DISTINCT price_band) price_bands
      FROM filtered GROUP BY subcategory ORDER BY gmv_cents DESC LIMIT 60`).bind(...bindings).all<Record<string, string | number | null>>(),
    db.prepare(`${enriched} SELECT official_market_price_cents price, gmv_cents, quantity
      FROM filtered WHERE official_market_price_cents IS NOT NULL ORDER BY official_market_price_cents ASC`).bind(...bindings).all<{ price: number; gmv_cents: number; quantity: number }>(),
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
  const brandTotal = Number(summaryValue.gmv_cents ?? 0);
  const brandSharesAll = (brandRows.results ?? []).map((row) => ({
    brand: String(row.brand ?? ""),
    gmvCents: Number(row.gmv_cents ?? 0),
    quantity: Number(row.quantity ?? 0),
    skuCount: Number(row.sku_count ?? 0),
    bestRank: Number(row.best_rank ?? 0) || null,
    gmvShareBps: brandTotal ? Math.round(Number(row.gmv_cents ?? 0) / brandTotal * 10_000) : 0,
    priceBands: String(row.price_bands ?? "").split(",").filter(Boolean).slice(0, 5),
    subcategories: String(row.subcategories ?? "").split(",").filter(Boolean).slice(0, 5),
  }));
  const brandShares = brandSharesAll.slice(0, 30);
  const cr = (count: number) => brandTotal ? Math.round(brandSharesAll.slice(0, count).reduce((sum, row) => sum + row.gmvCents, 0) / brandTotal * 10_000) : 0;
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
      brand: row.brand, priceCents: row.price_cents, marketPriceCents: row.official_market_price_cents,
      candidatePriceCents: row.candidate_price_cents, marketPriceSource: row.market_price_source,
      candidatePriceSource: row.candidate_price_source, averageTransactionPriceCents: row.average_transaction_price_cents,
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
      gmvShareBps: Number(summaryValue.gmv_cents ?? 0) ? Math.round(Number(row.gmv_cents ?? 0) / Number(summaryValue.gmv_cents ?? 0) * 10_000) : 0,
      selfOperatedShareBps: Number(row.gmv_cents ?? 0) ? Math.round(Number(row.self_gmv_cents ?? 0) / Number(row.gmv_cents ?? 0) * 10_000) : null,
      mainBrands: String(row.brands ?? "").split(",").filter(Boolean).slice(0, 5),
    })),
    priceBandTrend: (priceBandTrendRows.results ?? []).map((row) => ({
      period: String(row.period ?? ""),
      priceBand: String(row.price_band ?? unknownPriceBand),
      gmvCents: Number(row.gmv_cents ?? 0),
      quantity: Number(row.quantity ?? 0),
      gmvShareBps: Number(row.period_gmv_cents ?? 0) ? Math.round(Number(row.gmv_cents ?? 0) / Number(row.period_gmv_cents ?? 0) * 10_000) : 0,
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
      ps.confirmed_market_price_cents market_price_cents,
      COALESCE(ps.source_price_cents, ps.average_transaction_price_cents, ps.ai_image_price_cents) candidate_price_cents,
      ps.source_price_cents, ps.ai_image_price_cents, ps.ai_price_type, ps.ai_confidence_bps,
      ps.confirmed_market_price_cents, ps.average_transaction_price_cents,
      CASE
        WHEN ps.confirmed_market_price_cents IS NOT NULL THEN '人工确认'
        ELSE '未确认价格'
      END price_status,
      CASE
        WHEN ps.source_price_cents IS NOT NULL THEN '源表价格'
        WHEN ps.average_transaction_price_cents IS NOT NULL THEN '系统计算'
        WHEN ps.ai_image_price_cents IS NOT NULL THEN 'AI待确认'
        ELSE '暂无价格'
      END candidate_price_status,
      COALESCE(ps.confirmation_status, 'missing') confirmation_status
    FROM market_ranking_entries m
    LEFT JOIN market_price_snapshots ps ON ps.category = m.category
      AND ps.scope = m.scope
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
      candidatePriceCents: row.candidate_price_cents === null ? null : Number(row.candidate_price_cents),
      averageTransactionPriceCents: row.average_transaction_price_cents === null ? null : Number(row.average_transaction_price_cents),
      sourcePriceCents: row.source_price_cents === null ? null : Number(row.source_price_cents),
      aiImagePriceCents: row.ai_image_price_cents === null ? null : Number(row.ai_image_price_cents),
      aiPriceType: String(row.ai_price_type ?? ""),
      aiConfidenceBps: row.ai_confidence_bps === null ? null : Number(row.ai_confidence_bps),
      confirmedMarketPriceCents: row.confirmed_market_price_cents === null ? null : Number(row.confirmed_market_price_cents),
      priceStatus: String(row.price_status ?? "暂无价格"),
      candidatePriceStatus: String(row.candidate_price_status ?? "暂无价格"),
      confirmationStatus: String(row.confirmation_status ?? "missing"),
    })),
  };
}
