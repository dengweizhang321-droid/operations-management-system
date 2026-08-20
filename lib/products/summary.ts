import {
  findLatestInventoryImportBatch,
  type InventoryDatabase,
} from "@/lib/inventory/database";
import {
  addProductSummaryDays,
  normalizeProductSummaryPagination,
  ProductSummaryContractError,
  resolveProductSummaryPeriod,
  type ProductMarginBand,
  type ProductSummaryDirection,
  type ProductSummaryQueryOptions,
  type ProductSummaryRange,
  type ProductSummarySort,
} from "@/lib/products/query-contract";
import { findLatestSalesImportBatch } from "@/lib/sales/database";
import {
  canonicalizeShopIdentity,
  expandShopAliases,
  parseShopFilterKey,
  shopFilterKey,
  type CanonicalShopIdentity,
} from "@/lib/sales/shop-identity";

export type { ProductSummaryRange } from "@/lib/products/query-contract";
export { ProductSummaryContractError as ProductSummaryRequestError } from "@/lib/products/query-contract";

export type ProductSummaryItem = {
  productCode: string;
  productName: string;
  brand: string;
  supplierName: string;
  specification: string;
  category: string;
  outlets: Array<{ platform: string; shop: string }>;
  netQuantity: number;
  grossSalesCents: number;
  refundAmountCents: number;
  netSalesCents: number;
  costCents: number;
  feeCents: number;
  grossProfitCents: number;
  grossMarginRate: number | null;
  refundRate: number;
  averageSalePriceCents: number | null;
  averageCostCents: number | null;
  observedFeeRate: number | null;
  availableQuantity: number | null;
  stockValueCents: number | null;
  knownStockValueCents: number | null;
  costCoverageRate: number | null;
};

export type ProductSummaryOptions = ProductSummaryQueryOptions & {
  platforms?: string[];
  shopKeys?: string[];
};

type ProductSummaryFilters = {
  platforms: string[];
  shops: CanonicalShopIdentity[];
};

type ProductRow = {
  product_code: string;
  product_name: string | null;
  brand: string | null;
  supplier_name: string | null;
  specification: string | null;
  category: string | null;
  net_quantity: number | null;
  gross_sales_cents: number | null;
  refund_amount_cents: number | null;
  net_sales_cents: number | null;
  cost_cents: number | null;
  fee_cents: number | null;
  gross_profit_cents: number | null;
  absolute_quantity: number | null;
  absolute_cost_cents: number | null;
  available_quantity: number | null;
  stock_value_cents: number | null;
  known_stock_value_cents: number | null;
  priced_available_quantity: number | null;
  gross_margin_rate: number | null;
  refund_rate: number | null;
};

type MetricsRow = {
  sku_count: number | null;
  gross_sales_cents: number | null;
  net_sales_cents: number | null;
  gross_profit_cents: number | null;
  loss_sku_count: number | null;
  stocked_sku_count: number | null;
  below_35_count: number | null;
  between_35_and_40_count: number | null;
  between_40_and_45_count: number | null;
  at_least_45_count: number | null;
};

type OutletRow = {
  product_code: string;
  platform: string;
  shop_name: string;
  channel: string;
};

function rate(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : null;
}

function uniqueStrings(values: readonly string[], max = 20) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, max);
}

function normalizeFilters(options: ProductSummaryOptions): ProductSummaryFilters {
  const platforms = uniqueStrings(options.platforms ?? [], 8);
  const shopsByKey = new Map<string, CanonicalShopIdentity>();
  for (const rawKey of uniqueStrings(options.shopKeys ?? [], 4)) {
    const identity = parseShopFilterKey(rawKey);
    if (identity) shopsByKey.set(shopFilterKey(identity), identity);
  }
  return { platforms, shops: [...shopsByKey.values()] };
}

function salesFilterClause(filters: ProductSummaryFilters) {
  const clauses: string[] = [];
  const values: string[] = [];
  if (filters.platforms.length > 0) {
    clauses.push(`platform IN (${filters.platforms.map(() => "?").join(", ")})`);
    values.push(...filters.platforms);
  }
  if (filters.shops.length > 0) {
    const shopClauses = filters.shops.map((identity) => {
      const aliases = expandShopAliases(identity).slice(0, 5);
      values.push(identity.platform, ...aliases);
      return `(platform = ? AND shop_name IN (${aliases.map(() => "?").join(", ")}))`;
    });
    clauses.push(`(${shopClauses.join(" OR ")})`);
  }
  return {
    sql: clauses.length > 0 ? ` AND ${clauses.join(" AND ")}` : "",
    values,
  };
}

function normalizeQuery(options: ProductSummaryOptions) {
  const query = options.query?.trim().slice(0, 100) ?? "";
  const categories = uniqueStrings(options.categories ?? [], 10);
  const allowedBands = new Set<ProductMarginBand>(["below35", "35to40", "40to45", "atLeast45", "unavailable"]);
  const marginBands = uniqueStrings(options.marginBands ?? [], 5)
    .filter((value): value is ProductMarginBand => allowedBands.has(value as ProductMarginBand));
  const allowedSorts = new Set<ProductSummarySort>(["netSalesCents", "grossProfitCents", "grossMarginRate", "refundRate", "stockValueCents", "netQuantity"]);
  const sortBy = allowedSorts.has(options.sortBy as ProductSummarySort) ? options.sortBy as ProductSummarySort : "netSalesCents";
  const direction: ProductSummaryDirection = options.direction === "asc" ? "asc" : "desc";
  return { query, categories, marginBands, sortBy, direction };
}

function itemFilterClause(query: ReturnType<typeof normalizeQuery>) {
  const clauses: string[] = [];
  const values: Array<string | number> = [];
  if (query.query) {
    const keywords = uniqueStrings(query.query.split(/[\s,，;；]+/), 8).map((value) => `%${value.toLowerCase()}%`);
    clauses.push(`(${keywords.map(() => `(
      LOWER(product_code) LIKE ? OR LOWER(product_name) LIKE ? OR LOWER(brand) LIKE ?
      OR LOWER(supplier_name) LIKE ? OR LOWER(specification) LIKE ? OR LOWER(category) LIKE ?
    )`).join(" OR ")})`);
    for (const keyword of keywords) values.push(keyword, keyword, keyword, keyword, keyword, keyword);
  }
  if (query.categories.length > 0) {
    clauses.push(`category IN (${query.categories.map(() => "?").join(", ")})`);
    values.push(...query.categories);
  }
  if (query.marginBands.length > 0) {
    const bands: string[] = [];
    for (const band of query.marginBands) {
      if (band === "below35") bands.push("gross_margin_rate < 0.35");
      else if (band === "35to40") bands.push("gross_margin_rate >= 0.35 AND gross_margin_rate < 0.4");
      else if (band === "40to45") bands.push("gross_margin_rate >= 0.4 AND gross_margin_rate < 0.45");
      else if (band === "atLeast45") bands.push("gross_margin_rate >= 0.45");
      else bands.push("gross_margin_rate IS NULL");
    }
    clauses.push(`(${bands.map((band) => `(${band})`).join(" OR ")})`);
  }
  return { sql: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "", values };
}

function productCte(input: {
  rangeStart: string;
  rangeEndExclusive: string;
  inventoryBatchId: string | null;
  salesFilter: ReturnType<typeof salesFilterClause>;
  itemFilter: ReturnType<typeof itemFilterClause>;
}) {
  const sql = `WITH sales_agg AS (
    SELECT
      product_code,
      MAX(NULLIF(product_name, '')) AS product_name,
      MAX(NULLIF(specification, '')) AS specification,
      MAX(NULLIF(category, '')) AS category,
      MAX(NULLIF(supplier, '')) AS supplier,
      COALESCE(SUM(quantity), 0) AS net_quantity,
      COALESCE(SUM(CASE WHEN allocated_amount_cents > 0 THEN allocated_amount_cents ELSE 0 END), 0) AS gross_sales_cents,
      COALESCE(SUM(CASE WHEN allocated_amount_cents < 0 THEN -allocated_amount_cents ELSE 0 END), 0) AS refund_amount_cents,
      COALESCE(SUM(allocated_amount_cents), 0) AS net_sales_cents,
      COALESCE(SUM(cost_amount_cents), 0) AS cost_cents,
      COALESCE(SUM(fee_allocation_cents), 0) AS fee_cents,
      COALESCE(SUM(gross_profit_cents), 0) AS gross_profit_cents,
      COALESCE(SUM(ABS(quantity)), 0) AS absolute_quantity,
      COALESCE(SUM(ABS(cost_amount_cents)), 0) AS absolute_cost_cents
    FROM sales_order_lines
    WHERE ship_time >= ? AND ship_time < ?
      AND TRIM(warehouse) <> '刷刷仓'
      AND product_code <> 'ERP_PRICE_ADJUSTMENT'
      AND TRIM(product_name) <> '补差价专用'${input.salesFilter.sql}
    GROUP BY product_code
  ), stock_agg AS (
    SELECT
      product_code,
      MAX(NULLIF(brand, '')) AS brand,
      COALESCE(SUM(MAX(available_quantity, 0)), 0) AS available_quantity,
      COALESCE(SUM(CASE WHEN unit_cost_cents > 0 THEN MAX(available_quantity, 0) * unit_cost_cents ELSE 0 END), 0) AS known_stock_value_cents,
      COALESCE(SUM(CASE WHEN unit_cost_cents > 0 THEN MAX(available_quantity, 0) ELSE 0 END), 0) AS priced_available_quantity
    FROM inventory_stock_lines
    WHERE batch_id = ? AND TRIM(warehouse) <> '刷刷仓'
    GROUP BY product_code
  ), base AS (
    SELECT
      s.product_code,
      COALESCE(NULLIF(m.product_name, ''), s.product_name, s.product_code) AS product_name,
      COALESCE(NULLIF(m.brand, ''), st.brand, '') AS brand,
      COALESCE(NULLIF(m.supplier, ''), s.supplier, '') AS supplier_name,
      COALESCE(NULLIF(m.specification, ''), s.specification, '') AS specification,
      COALESCE(NULLIF(m.category, ''), s.category, '未分类') AS category,
      s.net_quantity, s.gross_sales_cents, s.refund_amount_cents, s.net_sales_cents,
      s.cost_cents, s.fee_cents, s.gross_profit_cents, s.absolute_quantity, s.absolute_cost_cents,
      st.available_quantity,
      CASE WHEN st.available_quantity <= st.priced_available_quantity THEN st.known_stock_value_cents ELSE NULL END AS stock_value_cents,
      st.known_stock_value_cents, st.priced_available_quantity,
      CASE WHEN s.net_sales_cents > 0 THEN s.gross_profit_cents * 1.0 / s.net_sales_cents ELSE NULL END AS gross_margin_rate,
      CASE WHEN s.gross_sales_cents > 0 THEN s.refund_amount_cents * 1.0 / s.gross_sales_cents ELSE 0 END AS refund_rate
    FROM sales_agg s
    LEFT JOIN erp_product_master m ON m.product_code = s.product_code
    LEFT JOIN stock_agg st ON st.product_code = s.product_code
  ), filtered AS (
    SELECT * FROM base ${input.itemFilter.sql}
  )`;
  return {
    sql,
    values: [
      input.rangeStart,
      input.rangeEndExclusive,
      ...input.salesFilter.values,
      input.inventoryBatchId ?? "",
      ...input.itemFilter.values,
    ],
  };
}

function emptyMetrics() {
  return {
    skuCount: 0,
    grossSalesCents: 0,
    netSalesCents: 0,
    grossProfitCents: 0,
    grossMarginRate: null as number | null,
    lossSkuCount: 0,
    stockedSkuCount: 0,
    marginBuckets: { below35Count: 0, between35And40Count: 0, between40And45Count: 0, atLeast45Count: 0 },
  };
}

function mapMetrics(row: MetricsRow | null) {
  const netSalesCents = Number(row?.net_sales_cents ?? 0);
  const grossProfitCents = Number(row?.gross_profit_cents ?? 0);
  return {
    skuCount: Number(row?.sku_count ?? 0),
    grossSalesCents: Number(row?.gross_sales_cents ?? 0),
    netSalesCents,
    grossProfitCents,
    grossMarginRate: rate(grossProfitCents, netSalesCents),
    lossSkuCount: Number(row?.loss_sku_count ?? 0),
    stockedSkuCount: Number(row?.stocked_sku_count ?? 0),
    marginBuckets: {
      below35Count: Number(row?.below_35_count ?? 0),
      between35And40Count: Number(row?.between_35_and_40_count ?? 0),
      between40And45Count: Number(row?.between_40_and_45_count ?? 0),
      atLeast45Count: Number(row?.at_least_45_count ?? 0),
    },
  };
}

function mapItem(row: ProductRow, outlets: Array<{ platform: string; shop: string }>): ProductSummaryItem {
  const netQuantity = Number(row.net_quantity ?? 0);
  const netSalesCents = Number(row.net_sales_cents ?? 0);
  const grossSalesCents = Number(row.gross_sales_cents ?? 0);
  const refundAmountCents = Number(row.refund_amount_cents ?? 0);
  const absoluteQuantity = Number(row.absolute_quantity ?? 0);
  const absoluteCostCents = Number(row.absolute_cost_cents ?? 0);
  return {
    productCode: row.product_code,
    productName: row.product_name || row.product_code,
    brand: row.brand || "",
    supplierName: row.supplier_name || "",
    specification: row.specification || "",
    category: row.category || "未分类",
    outlets,
    netQuantity,
    grossSalesCents,
    refundAmountCents,
    netSalesCents,
    costCents: Number(row.cost_cents ?? 0),
    feeCents: Number(row.fee_cents ?? 0),
    grossProfitCents: Number(row.gross_profit_cents ?? 0),
    grossMarginRate: row.gross_margin_rate === null ? null : Number(row.gross_margin_rate),
    refundRate: row.refund_rate === null ? 0 : Number(row.refund_rate),
    averageSalePriceCents: rate(netSalesCents, netQuantity),
    averageCostCents: rate(absoluteCostCents, absoluteQuantity),
    observedFeeRate: rate(Math.abs(Number(row.fee_cents ?? 0)), grossSalesCents),
    availableQuantity: row.available_quantity === null ? null : Number(row.available_quantity),
    stockValueCents: row.stock_value_cents === null ? null : Number(row.stock_value_cents),
    knownStockValueCents: row.known_stock_value_cents === null ? null : Number(row.known_stock_value_cents),
    costCoverageRate: row.available_quantity === null
      ? null
      : Number(row.available_quantity) > 0
        ? Math.min(1, Math.max(0, Number(row.priced_available_quantity ?? 0)) / Number(row.available_quantity))
        : 1,
  };
}

export async function getProductSummary(db: InventoryDatabase, optionsOrDays: ProductSummaryOptions | number = {}) {
  const options = typeof optionsOrDays === "number" ? { days: optionsOrDays } : optionsOrDays;
  const appliedFilters = normalizeFilters(options);
  const query = normalizeQuery(options);
  const pagination = normalizeProductSummaryPagination(options);
  const salesFilter = salesFilterClause(appliedFilters);
  const [salesBounds, latestSalesBatch, latestInventoryBatch] = await Promise.all([
    db.prepare(
      `SELECT MIN(substr(ship_time, 1, 10)) AS start_date, MAX(substr(ship_time, 1, 10)) AS end_date
       FROM sales_order_lines
       WHERE TRIM(warehouse) <> '刷刷仓'
         AND product_code <> 'ERP_PRICE_ADJUSTMENT'
         AND TRIM(product_name) <> '补差价专用'${salesFilter.sql}`,
    ).bind(...salesFilter.values).first<{ start_date: string | null; end_date: string | null }>(),
    findLatestSalesImportBatch(db),
    findLatestInventoryImportBatch(db),
  ]);
  const dataStartDate = salesBounds?.start_date ?? null;
  const dataCutoffDate = salesBounds?.end_date ?? null;
  const appliedShops = appliedFilters.shops.map((outlet) => ({
    key: shopFilterKey(outlet), platform: outlet.platform, shop: outlet.shopName,
  }));

  const empty = (range: ProductSummaryRange, requestedStartDate: string | null, requestedEndDate: string | null) => ({
    hasSales: Boolean(dataCutoffDate),
    range,
    sync: {
      salesThrough: null,
      salesWindowStart: null,
      requestedStartDate,
      requestedEndDate,
      dataStartDate,
      dataCutoffDate,
      inventoryAsOf: latestInventoryBatch?.snapshotDate ?? null,
      latestSalesFile: latestSalesBatch?.fileName ?? null,
    },
    filters: { platforms: [] as string[], shops: [] as Array<{ key: string; platform: string; shop: string }>, categories: [] as string[] },
    filtersApplied: { platforms: appliedFilters.platforms, shops: appliedShops, query: query.query, categories: query.categories, marginBands: query.marginBands },
    sort: { by: query.sortBy, direction: query.direction },
    metrics: emptyMetrics(),
    pagination: { page: pagination.page, pageSize: pagination.pageSize, total: 0, returned: 0, totalPages: 0, truncated: false },
    items: [] as ProductSummaryItem[],
  });

  if (!dataStartDate || !dataCutoffDate) return empty(options.range ?? "last30", null, null);

  let period;
  try {
    period = resolveProductSummaryPeriod({ startDate: dataStartDate, endDate: dataCutoffDate }, options);
  } catch (error) {
    if (error instanceof ProductSummaryContractError) throw error;
    throw new ProductSummaryContractError(error instanceof Error ? error.message : "商品统计周期无效");
  }
  if (!period.startDate || !period.endDate) {
    return empty(period.range, period.requestedStartDate, period.requestedEndDate);
  }

  const rangeStart = `${period.startDate} 00:00:00`;
  const rangeEndExclusive = `${addProductSummaryDays(period.endDate, 1)} 00:00:00`;
  const itemFilter = itemFilterClause(query);
  const cte = productCte({ rangeStart, rangeEndExclusive, inventoryBatchId: latestInventoryBatch?.id ?? null, salesFilter, itemFilter });
  const categoryFacetCte = productCte({
    rangeStart,
    rangeEndExclusive,
    inventoryBatchId: latestInventoryBatch?.id ?? null,
    salesFilter,
    itemFilter: itemFilterClause({ ...query, categories: [], marginBands: [] }),
  });
  const sortColumn: Record<ProductSummarySort, string> = {
    netSalesCents: "net_sales_cents",
    grossProfitCents: "gross_profit_cents",
    grossMarginRate: "gross_margin_rate",
    refundRate: "refund_rate",
    stockValueCents: "stock_value_cents",
    netQuantity: "net_quantity",
  };
  const orderDirection = query.direction === "asc" ? "ASC" : "DESC";
  const [metricsRow, pageResult, outletOptionsResult, categoryResult] = await Promise.all([
    db.prepare(`${cte.sql}
      SELECT
        COUNT(*) AS sku_count,
        COALESCE(SUM(gross_sales_cents), 0) AS gross_sales_cents,
        COALESCE(SUM(net_sales_cents), 0) AS net_sales_cents,
        COALESCE(SUM(gross_profit_cents), 0) AS gross_profit_cents,
        COALESCE(SUM(CASE WHEN net_sales_cents > 0 AND gross_profit_cents < 0 THEN 1 ELSE 0 END), 0) AS loss_sku_count,
        COALESCE(SUM(CASE WHEN available_quantity > 0 THEN 1 ELSE 0 END), 0) AS stocked_sku_count,
        COALESCE(SUM(CASE WHEN gross_margin_rate < 0.35 THEN 1 ELSE 0 END), 0) AS below_35_count,
        COALESCE(SUM(CASE WHEN gross_margin_rate >= 0.35 AND gross_margin_rate < 0.4 THEN 1 ELSE 0 END), 0) AS between_35_and_40_count,
        COALESCE(SUM(CASE WHEN gross_margin_rate >= 0.4 AND gross_margin_rate < 0.45 THEN 1 ELSE 0 END), 0) AS between_40_and_45_count,
        COALESCE(SUM(CASE WHEN gross_margin_rate >= 0.45 THEN 1 ELSE 0 END), 0) AS at_least_45_count
      FROM filtered`).bind(...cte.values).first<MetricsRow>(),
    db.prepare(`${cte.sql}
      SELECT * FROM filtered
      ORDER BY ${sortColumn[query.sortBy]} ${orderDirection}, product_code ASC
      LIMIT ? OFFSET ?`).bind(...cte.values, pagination.pageSize, pagination.offset).all<ProductRow>(),
    db.prepare(
      `SELECT
        COALESCE(NULLIF(platform, ''), NULLIF(channel, ''), '未分类') AS platform,
        COALESCE(NULLIF(shop_name, ''), NULLIF(channel, ''), NULLIF(platform, ''), '未分类') AS shop_name,
        COALESCE(NULLIF(channel, ''), '') AS channel
       FROM sales_order_lines
       WHERE ship_time >= ? AND ship_time < ?
         AND TRIM(warehouse) <> '刷刷仓'
         AND product_code <> 'ERP_PRICE_ADJUSTMENT'
         AND TRIM(product_name) <> '补差价专用'
       GROUP BY platform, shop_name, channel
       ORDER BY platform, shop_name, channel
       LIMIT 500`,
    ).bind(rangeStart, rangeEndExclusive).all<OutletRow>(),
    db.prepare(`${categoryFacetCte.sql} SELECT DISTINCT category FROM filtered ORDER BY category LIMIT 500`)
      .bind(...categoryFacetCte.values).all<{ category: string }>(),
  ]);

  const productCodes = pageResult.results.map((row) => row.product_code);
  const outletsByProduct = new Map<string, Array<{ platform: string; shop: string }>>();
  if (productCodes.length > 0) {
    for (let offset = 0; offset < productCodes.length; offset += 40) {
      const productCodeChunk = productCodes.slice(offset, offset + 40);
      const outletRows = await db.prepare(
        `SELECT
          product_code,
          COALESCE(NULLIF(platform, ''), NULLIF(channel, ''), '未分类') AS platform,
          COALESCE(NULLIF(shop_name, ''), NULLIF(channel, ''), NULLIF(platform, ''), '未分类') AS shop_name,
          COALESCE(NULLIF(channel, ''), '') AS channel
         FROM sales_order_lines
         WHERE ship_time >= ? AND ship_time < ?
           AND TRIM(warehouse) <> '刷刷仓'
           AND product_code <> 'ERP_PRICE_ADJUSTMENT'
           AND TRIM(product_name) <> '补差价专用'${salesFilter.sql}
           AND product_code IN (${productCodeChunk.map(() => "?").join(", ")})
         GROUP BY product_code, platform, shop_name, channel
         ORDER BY product_code, platform, shop_name, channel`,
      ).bind(rangeStart, rangeEndExclusive, ...salesFilter.values, ...productCodeChunk).all<OutletRow>();
      for (const row of outletRows.results) {
        const outlet = canonicalizeShopIdentity(row.platform, row.shop_name, row.channel);
        const list = outletsByProduct.get(row.product_code) ?? [];
        if (!list.some((item) => shopFilterKey({ platform: item.platform, shopName: item.shop }) === shopFilterKey(outlet))) {
          list.push({ platform: outlet.platform, shop: outlet.shopName });
        }
        outletsByProduct.set(row.product_code, list);
      }
    }
  }

  const outletOptionsByKey = new Map<string, CanonicalShopIdentity>();
  for (const row of outletOptionsResult.results) {
    const outlet = canonicalizeShopIdentity(row.platform, row.shop_name, row.channel);
    outletOptionsByKey.set(shopFilterKey(outlet), outlet);
  }
  const outletOptions = [...outletOptionsByKey.values()]
    .sort((left, right) => left.platform.localeCompare(right.platform, "zh-CN") || left.shopName.localeCompare(right.shopName, "zh-CN"));
  const total = Number(metricsRow?.sku_count ?? 0);
  return {
    hasSales: true,
    range: period.range,
    sync: {
      salesThrough: period.endDate,
      salesWindowStart: period.startDate,
      requestedStartDate: period.requestedStartDate,
      requestedEndDate: period.requestedEndDate,
      dataStartDate,
      dataCutoffDate,
      inventoryAsOf: latestInventoryBatch?.snapshotDate ?? null,
      latestSalesFile: latestSalesBatch?.fileName ?? null,
    },
    filters: {
      platforms: [...new Set(outletOptions.map((outlet) => outlet.platform))],
      shops: outletOptions.map((outlet) => ({ key: shopFilterKey(outlet), platform: outlet.platform, shop: outlet.shopName })),
      categories: categoryResult.results.map((row) => row.category).filter(Boolean),
    },
    filtersApplied: {
      platforms: appliedFilters.platforms,
      shops: appliedShops,
      query: query.query,
      categories: query.categories,
      marginBands: query.marginBands,
    },
    sort: { by: query.sortBy, direction: query.direction },
    metrics: mapMetrics(metricsRow),
    pagination: {
      page: pagination.page,
      pageSize: pagination.pageSize,
      total,
      returned: pageResult.results.length,
      totalPages: total === 0 ? 0 : Math.ceil(total / pagination.pageSize),
      truncated: pagination.offset + pageResult.results.length < total,
    },
    items: pageResult.results.map((row) => mapItem(row, outletsByProduct.get(row.product_code) ?? [])),
  };
}
