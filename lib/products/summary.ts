import {
  findLatestInventoryImportBatch,
  type InventoryDatabase,
} from "@/lib/inventory/database";
import { findLatestSalesImportBatch } from "@/lib/sales/database";
import {
  canonicalizeShopIdentity,
  expandShopAliases,
  parseShopFilterKey,
  shopFilterKey,
  type CanonicalShopIdentity,
} from "@/lib/sales/shop-identity";

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
};

type SalesRow = {
  product_code: string;
  product_name: string | null;
  specification: string | null;
  category: string | null;
  supplier: string | null;
  net_quantity: number | null;
  gross_sales_cents: number | null;
  refund_amount_cents: number | null;
  net_sales_cents: number | null;
  cost_cents: number | null;
  fee_cents: number | null;
  gross_profit_cents: number | null;
  absolute_quantity: number | null;
  absolute_cost_cents: number | null;
};

type StockRow = {
  product_code: string;
  brand: string | null;
  available_quantity: number | null;
  stock_value_cents: number | null;
};

type OutletRow = {
  product_code: string;
  platform: string;
  shop_name: string;
  channel: string;
};

type ProductMasterDbRow = {
  product_code: string;
  product_name: string;
  brand: string;
  specification: string;
  category: string;
  supplier: string;
};

export type ProductSummaryRange = "last30" | "last90" | "halfYear" | "custom";

export type ProductSummaryOptions = {
  range?: ProductSummaryRange;
  startDate?: string | null;
  endDate?: string | null;
  days?: number;
  platforms?: string[];
  shopKeys?: string[];
};

export class ProductSummaryRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductSummaryRequestError";
  }
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function rate(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : null;
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

type ProductSummaryFilters = {
  platforms: string[];
  shops: CanonicalShopIdentity[];
};

function uniqueStrings(values: readonly string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeFilters(options: ProductSummaryOptions): ProductSummaryFilters {
  const platforms = uniqueStrings(options.platforms ?? []);
  const shopsByKey = new Map<string, CanonicalShopIdentity>();
  for (const rawKey of options.shopKeys ?? []) {
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
      const aliases = expandShopAliases(identity);
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

function resolvePeriod(dataCutoffDate: string, options: ProductSummaryOptions) {
  if (options.range === "custom") {
    const startDate = options.startDate?.trim() ?? "";
    const endDate = options.endDate?.trim() ?? "";
    if (!isIsoDate(startDate) || !isIsoDate(endDate)) {
      throw new ProductSummaryRequestError("自定义时间需要填写有效的开始和结束日期");
    }
    if (startDate > endDate) {
      throw new ProductSummaryRequestError("自定义时间的开始日期不能晚于结束日期");
    }
    return { range: "custom" as const, startDate, endDate };
  }

  if (!options.range && Number.isFinite(options.days)) {
    const windowDays = Math.max(7, Math.min(365, Math.trunc(options.days ?? 30)));
    const range = windowDays >= 180 ? "halfYear" : windowDays >= 90 ? "last90" : "last30";
    return {
      range,
      startDate: addDays(dataCutoffDate, -(windowDays - 1)),
      endDate: dataCutoffDate,
    };
  }

  const range = options.range ?? "last30";
  const windowDays = range === "halfYear" ? 183 : range === "last90" ? 90 : 30;
  return {
    range,
    startDate: addDays(dataCutoffDate, -(windowDays - 1)),
    endDate: dataCutoffDate,
  };
}

function summaryMetrics(items: ProductSummaryItem[]) {
  const grossSalesCents = items.reduce((sum, item) => sum + item.grossSalesCents, 0);
  const netSalesCents = items.reduce((sum, item) => sum + item.netSalesCents, 0);
  const grossProfitCents = items.reduce((sum, item) => sum + item.grossProfitCents, 0);
  const marginBuckets = {
    below35Count: 0,
    between35And40Count: 0,
    between40And45Count: 0,
    atLeast45Count: 0,
  };
  for (const item of items) {
    const margin = item.grossMarginRate;
    if (margin === null) continue;
    if (margin < 0.35) marginBuckets.below35Count += 1;
    else if (margin < 0.4) marginBuckets.between35And40Count += 1;
    else if (margin < 0.45) marginBuckets.between40And45Count += 1;
    else marginBuckets.atLeast45Count += 1;
  }
  return {
    skuCount: items.length,
    grossSalesCents,
    netSalesCents,
    grossProfitCents,
    grossMarginRate: rate(grossProfitCents, netSalesCents),
    lossSkuCount: items.filter((item) => item.netSalesCents > 0 && item.grossProfitCents < 0).length,
    stockedSkuCount: items.filter((item) => (item.availableQuantity ?? 0) > 0).length,
    marginBuckets,
  };
}

export async function getProductSummary(db: InventoryDatabase, optionsOrDays: ProductSummaryOptions | number = {}) {
  const options = typeof optionsOrDays === "number" ? { days: optionsOrDays } : optionsOrDays;
  const appliedFilters = normalizeFilters(options);
  const [salesBounds, latestSalesBatch, latestInventoryBatch] = await Promise.all([
    db.prepare("SELECT MIN(substr(ship_time, 1, 10)) AS start_date, MAX(substr(ship_time, 1, 10)) AS end_date FROM sales_order_lines WHERE TRIM(warehouse) <> '刷刷仓'")
      .first<{ start_date: string | null; end_date: string | null }>(),
    findLatestSalesImportBatch(db),
    findLatestInventoryImportBatch(db),
  ]);
  const dataCutoffDate = salesBounds?.end_date ?? null;

  if (!dataCutoffDate) {
    return {
      hasSales: false,
      range: options.range ?? "last30",
      sync: {
        salesThrough: null,
        salesWindowStart: null,
        dataStartDate: salesBounds?.start_date ?? null,
        dataCutoffDate: null,
        inventoryAsOf: latestInventoryBatch?.snapshotDate ?? null,
        latestSalesFile: latestSalesBatch?.fileName ?? null,
      },
      filters: { platforms: [] as string[], shops: [] as Array<{ key: string; platform: string; shop: string }> },
      filtersApplied: { platforms: appliedFilters.platforms, shops: [] as Array<{ key: string; platform: string; shop: string }> },
      metrics: summaryMetrics([]),
      items: [] as ProductSummaryItem[],
    };
  }

  const period = resolvePeriod(dataCutoffDate, options);
  const salesWindowStart = period.startDate;
  const salesThrough = period.endDate;
  const rangeStart = `${salesWindowStart} 00:00:00`;
  const rangeEndExclusive = `${addDays(salesThrough, 1)} 00:00:00`;
  const salesFilter = salesFilterClause(appliedFilters);

  const salesPromise = db.prepare(
    `SELECT
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
      AND TRIM(product_name) <> '补差价专用'${salesFilter.sql}
    GROUP BY product_code
    ORDER BY net_sales_cents DESC, product_code ASC`,
  ).bind(rangeStart, rangeEndExclusive, ...salesFilter.values).all<SalesRow>();

  const outletsPromise = db.prepare(
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
    GROUP BY product_code, platform, shop_name, channel
    ORDER BY product_code, platform, shop_name, channel`,
  ).bind(rangeStart, rangeEndExclusive, ...salesFilter.values).all<OutletRow>();

  const outletOptionsPromise = db.prepare(
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
    ORDER BY platform, shop_name, channel`,
  ).bind(rangeStart, rangeEndExclusive).all<OutletRow>();

  const stockPromise = latestInventoryBatch
    ? db.prepare(
      `SELECT
        product_code,
        MAX(NULLIF(brand, '')) AS brand,
        COALESCE(SUM(MAX(available_quantity, 0)), 0) AS available_quantity,
        COALESCE(SUM(CASE WHEN unit_cost_cents > 0 THEN MAX(available_quantity, 0) * unit_cost_cents ELSE 0 END), 0) AS stock_value_cents
      FROM inventory_stock_lines
      WHERE batch_id = ? AND TRIM(warehouse) <> '刷刷仓'
      GROUP BY product_code`,
    ).bind(latestInventoryBatch.id).all<StockRow>()
    : Promise.resolve({ results: [] as StockRow[] });

  const productMasterPromise = db.prepare(
    `SELECT product_code, product_name, brand, specification, category, supplier
     FROM erp_product_master`,
  ).all<ProductMasterDbRow>();

  const [salesResult, stockResult, outletsResult, productMasterResult, outletOptionsResult] = await Promise.all([
    salesPromise,
    stockPromise,
    outletsPromise,
    productMasterPromise,
    outletOptionsPromise,
  ]);
  const stockByProduct = new Map(stockResult.results.map((row) => [row.product_code, row]));
  const masterByProduct = new Map(productMasterResult.results.map((row) => [row.product_code, row]));
  const outletsByProduct = new Map<string, Array<{ platform: string; shop: string }>>();
  for (const row of outletsResult.results) {
    const outlets = outletsByProduct.get(row.product_code) ?? [];
    const outlet = canonicalizeShopIdentity(row.platform, row.shop_name, row.channel);
    if (!outlets.some((item) => shopFilterKey({ platform: item.platform, shopName: item.shop }) === shopFilterKey(outlet))) {
      outlets.push({ platform: outlet.platform, shop: outlet.shopName });
    }
    outletsByProduct.set(row.product_code, outlets);
  }
  const items = salesResult.results.map((row): ProductSummaryItem => {
    const netQuantity = Number(row.net_quantity ?? 0);
    const grossSalesCents = Number(row.gross_sales_cents ?? 0);
    const refundAmountCents = Number(row.refund_amount_cents ?? 0);
    const netSalesCents = Number(row.net_sales_cents ?? 0);
    const costCents = Number(row.cost_cents ?? 0);
    const feeCents = Number(row.fee_cents ?? 0);
    const grossProfitCents = Number(row.gross_profit_cents ?? 0);
    const absoluteQuantity = Number(row.absolute_quantity ?? 0);
    const absoluteCostCents = Number(row.absolute_cost_cents ?? 0);
    const stock = stockByProduct.get(row.product_code);
    const master = masterByProduct.get(row.product_code);
    return {
      productCode: row.product_code,
      productName: master?.product_name || row.product_name || row.product_code,
      brand: master?.brand || stock?.brand || "",
      supplierName: master?.supplier || row.supplier || "",
      specification: master?.specification || row.specification || "",
      category: master?.category || row.category || "未分类",
      outlets: outletsByProduct.get(row.product_code) ?? [],
      netQuantity,
      grossSalesCents,
      refundAmountCents,
      netSalesCents,
      costCents,
      feeCents,
      grossProfitCents,
      grossMarginRate: rate(grossProfitCents, netSalesCents),
      refundRate: rate(refundAmountCents, grossSalesCents) ?? 0,
      averageSalePriceCents: rate(netSalesCents, netQuantity),
      averageCostCents: rate(absoluteCostCents, absoluteQuantity),
      observedFeeRate: rate(Math.abs(feeCents), grossSalesCents),
      availableQuantity: stock ? Number(stock.available_quantity ?? 0) : null,
      stockValueCents: stock ? Number(stock.stock_value_cents ?? 0) : null,
    };
  });

  const outletOptionsByKey = new Map<string, CanonicalShopIdentity>();
  for (const row of outletOptionsResult.results) {
    const outlet = canonicalizeShopIdentity(row.platform, row.shop_name, row.channel);
    outletOptionsByKey.set(shopFilterKey(outlet), outlet);
  }
  const outletOptions = [...outletOptionsByKey.values()]
    .sort((left, right) => left.platform.localeCompare(right.platform, "zh-CN") || left.shopName.localeCompare(right.shopName, "zh-CN"));
  const platforms = [...new Set(outletOptions.map((outlet) => outlet.platform))].sort((left, right) => left.localeCompare(right, "zh-CN"));
  const shops = outletOptions.map((outlet) => ({
    key: shopFilterKey(outlet),
    platform: outlet.platform,
    shop: outlet.shopName,
  }));

  return {
    hasSales: true,
    range: period.range,
    sync: {
      salesThrough,
      salesWindowStart,
      dataStartDate: salesBounds?.start_date ?? null,
      dataCutoffDate,
      inventoryAsOf: latestInventoryBatch?.snapshotDate ?? null,
      latestSalesFile: latestSalesBatch?.fileName ?? null,
    },
    filters: { platforms, shops },
    filtersApplied: {
      platforms: appliedFilters.platforms,
      shops: appliedFilters.shops.map((outlet) => ({
        key: shopFilterKey(outlet),
        platform: outlet.platform,
        shop: outlet.shopName,
      })),
    },
    metrics: summaryMetrics(items),
    items,
  };
}
