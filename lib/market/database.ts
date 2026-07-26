import { env } from "cloudflare:workers";
import { marketBatchColumns, mapMarketBatch, saveMarketImportCore } from "@/lib/market/import-core";
import { buildMarketOverviewAnalyticsSql, buildMarketOverviewEnrichedSql, marketEffectiveFactsCtes, marketOverviewFilterOptionsSql } from "@/lib/market/overview-sql";
import { ensureMarketSchemaCached } from "@/lib/market/schema-core";
import { annotateRankBounds } from "@/lib/market/gmv-estimation";
import { refreshMarketSkuGmvTotals } from "@/lib/market/gmv-total";

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
  priceBandFilter: string;
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
  priceRaw: string;
  gmvCents: number;
  gmvLowCents: number | null;
  gmvHighCents: number | null;
  gmvRaw: string;
  quantity: number;
  quantityLow: number | null;
  quantityHigh: number | null;
  quantityRaw: string;
  pageViews: number;
  pageViewsRaw: string;
  visitors: number;
  visitorsLow: number | null;
  visitorsHigh: number | null;
  visitorsRaw: string;
  conversionBps: number | null;
  conversionLowBps: number | null;
  conversionHighBps: number | null;
  conversionRaw: string;
  cartCustomers: number;
  cartCustomersRaw: string;
  searchClicks: number;
  searchClicksRaw: string;
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
  const batch = await saveMarketImportCore(input) as MarketImportBatch;
  await refreshMarketSkuGmvTotals(input.db);
  return batch;
}


type SummaryRow = {
  product_count: number; category_count: number; brand_count: number; gmv_cents: number;
  quantity: number; page_views: number; visitors: number; own_product_count: number;
  self_operated_gmv_cents: number; pending_ai_count: number;
  median_market_price_cents: number | null; weighted_market_price_cents: number | null;
};

type AnalyticsRow = {
  summary_json: string; trend_json: string; price_bands_json: string; price_band_summary_json: string;
  price_band_trend_json: string; brand_rows_json: string; subcategory_rows_json: string;
  date_min: string | null; date_max: string | null;
};

type FilterOptionsRow = {
  categories_json: string; scopes_json: string; brands_json: string;
  dimensions_json: string; modes_json: string; subcategories_json: string;
};

type EntryRow = {
  id: number; period_start: string; period_end: string; category: string; scope: string; ranking_dimension: "SKU" | "SPU";
  price_band_filter: string;
  operation_mode: "POP" | "自营" | "未知"; subcategory: string; rank: number | null; previous_rank: number | null;
  sku_code: string; product_name: string; brand: string; price_cents: number | null;
  official_market_price_cents: number | null; candidate_price_cents: number | null; market_price_source: string; candidate_price_source: string; average_transaction_price_cents: number | null;
  discount_bps: number | null; discount_reference: number;
  gmv_cents: number; quantity: number; page_views: number; visitors: number; conversion_bps: number | null;
  gmv_low_cents: number | null; gmv_high_cents: number | null; quantity_low: number | null; quantity_high: number | null;
  visitors_low: number | null; visitors_high: number | null; conversion_low_bps: number | null; conversion_high_bps: number | null;
  real_gmv_cents: number;
  cart_customers: number; search_clicks: number; image_url: string; source_image_url: string; image_cache_status: string; product_url: string;
  period_count: number; is_own: number; own_sales_cents: number;
};

const unknownPriceBand = "\u672a\u786e\u8ba4\u4ef7\u683c";

function parseSqlJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || value === "") return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function batchRows<T>(result: { results?: unknown[] } | undefined): T[] {
  return (result?.results ?? []) as T[];
}

function filterSql(filters: MarketOverviewFilters) {
  const factClauses: string[] = [];
  const factValues: unknown[] = [];
  const clauses: string[] = [];
  const values: unknown[] = [];
  const list = (targetClauses: string[], targetValues: unknown[], column: string, items?: string[]) => {
    const normalized = [...new Set((items ?? []).map((item) => item.trim()).filter(Boolean))].slice(0, 30);
    if (!normalized.length) return;
    targetClauses.push(`${column} IN (${normalized.map(() => "?").join(",")})`);
    targetValues.push(...normalized);
  };
  if (filters.query?.trim()) {
    const query = `%${filters.query.trim().slice(0, 100)}%`;
    clauses.push("(m.sku_code LIKE ? OR m.product_name LIKE ? OR m.brand LIKE ?)");
    values.push(query, query, query);
  }
  list(factClauses, factValues, "m.category", filters.categories);
  list(factClauses, factValues, "m.scope", filters.scopes);
  list(clauses, values, "m.brand", filters.brands);
  list(factClauses, factValues, "m.ranking_dimension", filters.rankingDimensions);
  list(clauses, values, "m.operation_mode", filters.operationModes?.filter((item) => item !== "全部"));
  list(clauses, values, "m.subcategory", filters.subcategories);
  if (filters.startDate) { factClauses.push("m.period_end >= ?"); factValues.push(filters.startDate); }
  if (filters.endDate) { factClauses.push("m.period_start <= ?"); factValues.push(filters.endDate); }
  const priceBands = [...new Set((filters.priceBands ?? []).map((item) => item.trim()).filter(Boolean))].slice(0, 20);
  const priceBandWhere = priceBands.length ? `WHERE price_band IN (${priceBands.map(() => "?").join(",")})` : "";
  return {
    factWhere: factClauses.length ? `WHERE ${factClauses.join(" AND ")}` : "",
    where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    values: [...factValues, ...values],
    priceBandWhere,
    priceBandValues: priceBands,
  };
}

export async function getMarketOverview(db: MarketDatabase, filters: MarketOverviewFilters = {}) {
  const { factWhere, where, values, priceBandWhere, priceBandValues } = filterSql(filters);
  const enriched = buildMarketOverviewEnrichedSql({ factWhere, where, priceBandWhere });
  const analyticsSql = buildMarketOverviewAnalyticsSql({ factWhere, where, priceBandWhere });
  const dateValues = [filters.startDate ?? "", filters.startDate ?? "", filters.endDate ?? "", filters.endDate ?? ""];
  const bindings = [...values, ...priceBandValues];
  const [analyticsResult, rankingResult, filterOptionsResult, batchesResult, imageCacheResult] = await db.batch([
    db.prepare(analyticsSql).bind(...bindings),
    db.prepare(`${enriched}, top_ranked AS MATERIALIZED (
      SELECT * FROM filtered
      ORDER BY CASE WHEN rank IS NULL THEN 1 ELSE 0 END, rank, gmv_cents DESC
      LIMIT 200
    ) SELECT id, period_start, period_end, category, scope, price_band_filter, ranking_dimension, operation_mode, subcategory, rank,
      (SELECT p.rank FROM market_ranking_entries p INDEXED BY market_entries_sku_idx
        WHERE p.category=filtered.category AND p.sku_code=filtered.sku_code AND p.ranking_dimension=filtered.ranking_dimension
          AND p.scope=filtered.scope AND p.operation_mode=filtered.operation_mode
          AND p.period_end < filtered.period_end
        ORDER BY p.period_end DESC, p.id DESC LIMIT 1) previous_rank,
      sku_code, product_name, brand, price_cents, official_market_price_cents, candidate_price_cents, market_price_source, candidate_price_source,
      effective_average_transaction_price_cents average_transaction_price_cents,
      CASE WHEN official_market_price_cents IS NOT NULL AND official_market_price_cents > 0 AND average_transaction_price_cents IS NOT NULL
        THEN CAST(ROUND((1 - average_transaction_price_cents * 1.0 / official_market_price_cents) * 10000) AS INTEGER) ELSE NULL END discount_bps,
      CASE WHEN price_estimated = 1 THEN 1 ELSE 0 END discount_reference,
      effective_gmv_cents gmv_cents, gmv_low_cents, gmv_high_cents, effective_quantity quantity, quantity_low, quantity_high, page_views, visitors, visitors_low, visitors_high,
      conversion_low_bps, conversion_high_bps,
      real_gmv_cents,
      effective_conversion_bps conversion_bps, cart_customers, search_clicks,
      CASE WHEN image_url <> '' AND image_cache_status_raw = 'ready' THEN '/api/market/images/' || image_content_sha256 ELSE image_url END image_url,
      image_url source_image_url, COALESCE(image_cache_status_raw, CASE WHEN image_url = '' THEN 'missing' ELSE 'pending' END) image_cache_status,
      product_url,
      COALESCE((SELECT COUNT(DISTINCT p.period_start || '|' || p.period_end)
        FROM market_ranking_entries p INDEXED BY market_entries_sku_idx
        WHERE p.category=filtered.category AND p.scope=filtered.scope AND p.sku_code=filtered.sku_code
          AND p.ranking_dimension=filtered.ranking_dimension AND p.operation_mode=filtered.operation_mode
          AND (? = '' OR p.period_end >= ?) AND (? = '' OR p.period_start <= ?)
      ), 1) period_count, is_own,
      COALESCE((SELECT SUM(s.allocated_amount_cents)
        FROM sales_order_lines s
        WHERE s.product_code = filtered.sku_code
          AND (? = '' OR substr(COALESCE(NULLIF(s.sales_time, ''), s.ship_time), 1, 10) >= ?)
          AND (? = '' OR substr(COALESCE(NULLIF(s.sales_time, ''), s.ship_time), 1, 10) <= ?)
      ), 0) AS own_sales_cents
      FROM top_ranked filtered
      ORDER BY CASE WHEN rank IS NULL THEN 1 ELSE 0 END, rank, gmv_cents DESC`)
      .bind(...bindings, ...dateValues, ...dateValues),
    db.prepare(marketOverviewFilterOptionsSql),
    db.prepare(`SELECT ${marketBatchColumns} FROM market_import_batches ORDER BY created_at DESC LIMIT 8`),
    db.prepare(`SELECT COUNT(DISTINCT m.image_url) total,
      COUNT(DISTINCT CASE WHEN mic.status='ready' THEN m.image_url END) cached,
      COUNT(DISTINCT CASE WHEN mic.status='failed' AND mic.attempt_count>=3 THEN m.image_url END) failed
      FROM market_ranking_entries m LEFT JOIN market_image_cache mic ON mic.source_url=m.image_url
      WHERE m.image_url<>''`),
  ]);
  const analytics = batchRows<AnalyticsRow>(analyticsResult)[0];
  const ranking = batchRows<EntryRow>(rankingResult);
  const rankedEstimates = annotateRankBounds(ranking.map((row) => ({
    id: row.id,
    category: row.category,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    scope: row.scope,
    priceBandFilter: row.price_band_filter,
    rankingDimension: row.ranking_dimension,
    rank: row.rank,
    gmvMidCents: Number(row.gmv_cents ?? 0),
    gmvLowCents: Number(row.gmv_cents ?? 0),
    gmvHighCents: Number(row.gmv_cents ?? 0),
    realGmvCents: null,
    priceMidCents: row.price_cents,
    priceLowCents: null,
    priceHighCents: null,
    manualPriceCents: row.official_market_price_cents,
    quantityMid: row.quantity,
    quantityLow: row.quantity_low,
    quantityHigh: row.quantity_high,
    visitorsMid: row.visitors,
    conversionLowBps: row.conversion_low_bps,
    conversionHighBps: row.conversion_high_bps,
  })));
  const estimateById = new Map(rankedEstimates.map((row) => [Number(row.id), row]));
  const filterOptions = batchRows<FilterOptionsRow>(filterOptionsResult)[0];
  const batches = batchRows<Parameters<typeof mapMarketBatch>[0]>(batchesResult)
    .map((row) => mapMarketBatch(row) as MarketImportBatch);
  const imageCache = batchRows<{ total: number; cached: number; failed: number }>(imageCacheResult)[0];
  const summaryValue = parseSqlJson<SummaryRow | null>(analytics?.summary_json, null) ?? {
    product_count: 0, category_count: 0, brand_count: 0, gmv_cents: 0, quantity: 0, page_views: 0,
    visitors: 0, own_product_count: 0, self_operated_gmv_cents: 0, pending_ai_count: 0,
    median_market_price_cents: null, weighted_market_price_cents: null,
  };
  const trendRows = parseSqlJson<Array<Record<string, string | number | null>>>(analytics?.trend_json, []);
  const priceBandOptions = parseSqlJson<Array<{ value: string; count: number }>>(analytics?.price_bands_json, []);
  const priceBandRows = parseSqlJson<Array<Record<string, string | number>>>(analytics?.price_band_summary_json, []);
  const priceBandTrendRows = parseSqlJson<Array<Record<string, string | number>>>(analytics?.price_band_trend_json, []);
  const brandRows = parseSqlJson<Array<Record<string, string | number>>>(analytics?.brand_rows_json, []);
  const subcategoryRows = parseSqlJson<Array<Record<string, string | number | null>>>(analytics?.subcategory_rows_json, []);
  const categoryOptions = parseSqlJson<Array<{ value: string; count: number }>>(filterOptions?.categories_json, []);
  const scopeOptions = parseSqlJson<Array<{ value: string; count: number }>>(filterOptions?.scopes_json, []);
  const brandOptions = parseSqlJson<Array<{ value: string; count: number }>>(filterOptions?.brands_json, []);
  const dimensionOptions = parseSqlJson<Array<{ value: string; count: number }>>(filterOptions?.dimensions_json, []);
  const modeOptions = parseSqlJson<Array<{ value: string; count: number }>>(filterOptions?.modes_json, []);
  const subcategoryOptions = parseSqlJson<Array<{ value: string; count: number }>>(filterOptions?.subcategories_json, []);
  const medianPrice = summaryValue.median_market_price_cents;
  const weightedMarketPrice = summaryValue.weighted_market_price_cents;
  const averageTransactionPrice = Number(summaryValue.quantity ?? 0) > 0 ? Math.round(Number(summaryValue.gmv_cents ?? 0) / Number(summaryValue.quantity ?? 0)) : null;
  const brandTotal = Number(summaryValue.gmv_cents ?? 0);
  const brandSharesAll = brandRows.map((row) => ({
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
    items: ranking.map((row) => ({
      id: row.id, periodStart: row.period_start, periodEnd: row.period_end, category: row.category,
      scope: row.scope, rankingDimension: row.ranking_dimension, operationMode: row.operation_mode, subcategory: row.subcategory,
      rank: row.rank, previousRank: row.previous_rank, rankChange: row.previous_rank !== null && row.rank !== null ? row.previous_rank - row.rank : null,
      skuCode: row.sku_code, productName: row.product_name,
      brand: row.brand, priceCents: row.price_cents, marketPriceCents: row.official_market_price_cents,
      candidatePriceCents: row.candidate_price_cents, marketPriceSource: row.market_price_source,
      candidatePriceSource: row.candidate_price_source,
      averageTransactionPriceCents: estimateById.get(row.id)?.averageTransactionPriceCents ?? row.average_transaction_price_cents,
      discountBps: row.discount_bps, discountReference: Boolean(row.discount_reference),
      gmvCents: estimateById.get(row.id)?.effectiveGmvCents ?? row.gmv_cents,
      quantity: estimateById.get(row.id)?.estimatedQuantity ?? row.quantity,
      pageViews: row.page_views, visitors: row.visitors, conversionBps: estimateById.get(row.id)?.conversionBps ?? row.conversion_bps,
      cartCustomers: row.cart_customers, searchClicks: row.search_clicks, imageUrl: row.image_url,
      sourceImageUrl: row.source_image_url, imageCacheStatus: row.image_cache_status,
      productUrl: row.product_url, periodCount: Number(row.period_count ?? 1),
      isOwn: Boolean(row.is_own), ownSalesCents: row.own_sales_cents,
      gmvOutOfBand: estimateById.get(row.id)?.gmvOutOfBand ?? false,
    })),
    trend: trendRows,
    priceBands: priceBandOptions.map((row) => ({ value: row.value, count: Number(row.count ?? 0) })),
    priceBandSummary: priceBandRows.map((row) => ({
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
    priceBandTrend: priceBandTrendRows.map((row) => ({
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
    subcategorySummary: subcategoryRows.map((row) => ({
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
      categories: categoryOptions, scopes: scopeOptions, brands: brandOptions,
      rankingDimensions: dimensionOptions, operationModes: modeOptions, subcategories: subcategoryOptions,
      priceBands: priceBandOptions,
    },
    dataRange: { startDate: analytics?.date_min ?? null, endDate: analytics?.date_max ?? null },
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
  const rows = await db.prepare(`WITH ${marketEffectiveFactsCtes()}
    SELECT m.period_start, m.period_end, substr(m.period_end, 1, 7) month, m.category, m.scope,
      m.ranking_dimension, m.operation_mode, m.subcategory, m.rank, m.sku_code, m.product_name, m.brand,
      m.effective_gmv_cents gmv_cents, m.effective_quantity quantity, m.visitors, m.effective_conversion_bps conversion_bps,
      ps.confirmed_market_price_cents market_price_cents,
      COALESCE(ps.source_price_cents, ps.average_transaction_price_cents, ps.ai_image_price_cents) candidate_price_cents,
      ps.source_price_cents, ps.ai_image_price_cents, ps.ai_price_type, ps.ai_confidence_bps,
      ps.confirmed_market_price_cents, m.effective_average_transaction_price_cents average_transaction_price_cents,
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
    FROM market_effective_rows m
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
