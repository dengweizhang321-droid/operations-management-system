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
import {
  canonicalizeShopIdentity,
  parseShopFilterKey,
  shopFilterKey,
  type CanonicalShopIdentity,
} from "@/lib/sales/shop-identity";
import type { AppPrincipal } from "@/lib/auth/authorization";
import {
  createDjangoSalesConsumerReader,
  type SalesConsumerReader,
  type SalesConsumerResponseMap,
  type SalesProductAggregate,
} from "@/lib/django/sales-consumer-reader";
import { PublicApiError } from "@/lib/http/api-error";

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
  signal?: AbortSignal;
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

type ErpProductRow = {
  product_code: string;
  product_name: string;
  brand: string;
  specification: string;
  category: string;
  supplier: string;
};

type ProductStockRow = {
  product_code: string;
  brand: string | null;
  available_quantity: number;
  known_stock_value_cents: number;
  priced_available_quantity: number;
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

const PRODUCT_PERFORMANCE_PRODUCT_CHUNK_SIZE = 1_000;
const PRODUCT_PERFORMANCE_LIMIT = 5_000;
const MAX_LOCAL_PRODUCT_KEYS = 20_000;

function salesConsumerUnavailable(): PublicApiError {
  return new PublicApiError(
    503,
    "service_unavailable",
    "Django 销售读取服务返回的数据不完整，请稍后重试。",
  );
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isIsoDateOrNull(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

function assertFiniteNumber(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw salesConsumerUnavailable();
}

type SalesLatestBatch = SalesConsumerResponseMap["freshness"]["latestBatch"];

function validateLatestBatch(value: SalesLatestBatch) {
  if (value === null) return;
  if (!value || typeof value !== "object"
    || typeof value.id !== "string" || value.id.length === 0
    || typeof value.fileName !== "string" || value.fileName.length === 0
    || (value.completedAt !== null && typeof value.completedAt !== "string")
    || !Number.isSafeInteger(value.rowCount) || value.rowCount < 0) {
    throw salesConsumerUnavailable();
  }
}

function sameLatestBatch(left: SalesLatestBatch, right: SalesLatestBatch) {
  if (left === null || right === null) return left === right;
  return left.id === right.id
    && left.fileName === right.fileName
    && left.completedAt === right.completedAt
    && left.rowCount === right.rowCount;
}

function validateSalesProduct(row: SalesProductAggregate, requested: ReadonlySet<string>) {
  if (!row || typeof row.productCode !== "string" || !requested.has(row.productCode)
    || typeof row.productName !== "string" || typeof row.specification !== "string"
    || typeof row.category !== "string" || typeof row.supplier !== "string"
    || !Array.isArray(row.outlets)) {
    throw salesConsumerUnavailable();
  }
  for (const value of [
    row.netQuantity,
    row.grossSalesCents,
    row.refundAmountCents,
    row.netSalesCents,
    row.costCents,
    row.feeCents,
    row.grossProfitCents,
    row.absoluteQuantity,
    row.absoluteCostCents,
  ]) assertFiniteNumber(value);
  if (row.grossSalesCents < 0 || row.refundAmountCents < 0
    || row.absoluteQuantity < 0 || row.absoluteCostCents < 0) {
    throw salesConsumerUnavailable();
  }
  for (const outlet of row.outlets) {
    if (!outlet || typeof outlet.platform !== "string" || typeof outlet.shopName !== "string"
      || (outlet.channel !== undefined && outlet.channel !== null && typeof outlet.channel !== "string")) {
      throw salesConsumerUnavailable();
    }
  }
}

async function loadLocalProductDimensions(db: InventoryDatabase, inventoryBatchId: string | null) {
  const [erpResult, stockResult] = await Promise.all([
    db.prepare(
      `SELECT product_code, product_name, brand, specification, category, supplier
       FROM erp_product_master
       ORDER BY product_code
       LIMIT ?`,
    ).bind(MAX_LOCAL_PRODUCT_KEYS + 1).all<ErpProductRow>(),
    inventoryBatchId
      ? db.prepare(
        `SELECT
          product_code,
          MAX(NULLIF(brand, '')) AS brand,
          COALESCE(SUM(MAX(available_quantity, 0)), 0) AS available_quantity,
          COALESCE(SUM(CASE WHEN unit_cost_cents > 0 THEN MAX(available_quantity, 0) * unit_cost_cents ELSE 0 END), 0) AS known_stock_value_cents,
          COALESCE(SUM(CASE WHEN unit_cost_cents > 0 THEN MAX(available_quantity, 0) ELSE 0 END), 0) AS priced_available_quantity
         FROM inventory_stock_lines
         WHERE batch_id = ? AND TRIM(warehouse) <> '刷刷仓'
         GROUP BY product_code
         ORDER BY product_code
         LIMIT ?`,
      ).bind(inventoryBatchId, MAX_LOCAL_PRODUCT_KEYS + 1).all<ProductStockRow>()
      : Promise.resolve({ results: [] as ProductStockRow[] }),
  ]);
  if (erpResult.results.length > MAX_LOCAL_PRODUCT_KEYS || stockResult.results.length > MAX_LOCAL_PRODUCT_KEYS) {
    throw salesConsumerUnavailable();
  }
  const erp = new Map(erpResult.results.map((row) => [row.product_code, row]));
  const stock = new Map(stockResult.results.map((row) => [row.product_code, row]));
  const productCodes = [...new Set([...erp.keys(), ...stock.keys()])].filter(Boolean).sort(compareText);
  if (productCodes.length > MAX_LOCAL_PRODUCT_KEYS) throw salesConsumerUnavailable();
  return { productCodes, erp, stock };
}

async function readProductPerformance(
  reader: SalesConsumerReader,
  principal: AppPrincipal,
  input: {
    productCodes: string[];
    startDate: string;
    endDateExclusive: string;
    filters: ProductSummaryFilters;
    expectedRevision: string;
    expectedLatestBatch: SalesLatestBatch;
    signal?: AbortSignal;
  },
) {
  const rows = new Map<string, SalesProductAggregate>();
  const outletOptions = new Map<string, CanonicalShopIdentity>();
  const chunks: string[][] = [];
  for (let offset = 0; offset < input.productCodes.length; offset += PRODUCT_PERFORMANCE_PRODUCT_CHUNK_SIZE) {
    chunks.push(input.productCodes.slice(offset, offset + PRODUCT_PERFORMANCE_PRODUCT_CHUNK_SIZE));
  }
  for (let offset = 0; offset < chunks.length; offset += 4) {
    const group = chunks.slice(offset, offset + 4);
    const results = await Promise.all(group.map((productCodes) => reader.read(principal, {
      operation: "product_performance",
      startDate: input.startDate,
      endDate: input.endDateExclusive,
      platforms: input.filters.platforms,
      outlets: input.filters.shops.map((outlet) => ({ platform: outlet.platform, shopName: outlet.shopName })),
      productCodes,
      limit: PRODUCT_PERFORMANCE_LIMIT,
    }, { signal: input.signal })));
    for (let index = 0; index < results.length; index += 1) {
      const result = results[index];
      const requested = new Set(group[index]);
      if (!result || typeof result !== "object" || !result.data || typeof result.data !== "object"
        || result.revision !== input.expectedRevision
        || result.data.truncated !== false
        || !Array.isArray(result.data.rows)
        || !Array.isArray(result.data.outletOptions)
        || !isIsoDateOrNull(result.data.dataStartDate)
        || !isIsoDateOrNull(result.data.dataCutoffDate)) {
        throw salesConsumerUnavailable();
      }
      validateLatestBatch(result.data.latestBatch);
      if (!sameLatestBatch(result.data.latestBatch, input.expectedLatestBatch)) {
        throw salesConsumerUnavailable();
      }
      for (const row of result.data.rows) {
        validateSalesProduct(row, requested);
        if (rows.has(row.productCode)) throw salesConsumerUnavailable();
        rows.set(row.productCode, row);
      }
      for (const outlet of result.data.outletOptions) {
        if (!outlet || typeof outlet.platform !== "string" || typeof outlet.shopName !== "string"
          || (outlet.channel !== undefined && outlet.channel !== null && typeof outlet.channel !== "string")) {
          throw salesConsumerUnavailable();
        }
        const identity = canonicalizeShopIdentity(outlet.platform, outlet.shopName, outlet.channel);
        outletOptions.set(shopFilterKey(identity), identity);
      }
    }
  }
  return { rows, outletOptions };
}

function mergeProductRow(
  sales: SalesProductAggregate,
  erp: ErpProductRow | undefined,
  stock: ProductStockRow | undefined,
): ProductRow {
  const netSalesCents = Number(sales.netSalesCents);
  const grossSalesCents = Number(sales.grossSalesCents);
  const refundAmountCents = Number(sales.refundAmountCents);
  const availableQuantity = stock ? Number(stock.available_quantity) : null;
  const pricedAvailableQuantity = stock ? Number(stock.priced_available_quantity) : null;
  const knownStockValueCents = stock ? Number(stock.known_stock_value_cents) : null;
  return {
    product_code: sales.productCode,
    product_name: erp?.product_name || sales.productName || sales.productCode,
    brand: erp?.brand || stock?.brand || "",
    supplier_name: erp?.supplier || sales.supplier || "",
    specification: erp?.specification || sales.specification || "",
    category: erp?.category || sales.category || "未分类",
    net_quantity: Number(sales.netQuantity),
    gross_sales_cents: grossSalesCents,
    refund_amount_cents: refundAmountCents,
    net_sales_cents: netSalesCents,
    cost_cents: Number(sales.costCents),
    fee_cents: Number(sales.feeCents),
    gross_profit_cents: Number(sales.grossProfitCents),
    absolute_quantity: Number(sales.absoluteQuantity),
    absolute_cost_cents: Number(sales.absoluteCostCents),
    available_quantity: availableQuantity,
    stock_value_cents: availableQuantity !== null && pricedAvailableQuantity !== null
      && availableQuantity <= pricedAvailableQuantity ? knownStockValueCents : null,
    known_stock_value_cents: knownStockValueCents,
    priced_available_quantity: pricedAvailableQuantity,
    gross_margin_rate: rate(Number(sales.grossProfitCents), netSalesCents),
    refund_rate: rate(refundAmountCents, grossSalesCents) ?? 0,
  };
}

function matchesTextQuery(row: ProductRow, query: string) {
  if (!query) return true;
  const fields = [row.product_code, row.product_name, row.brand, row.supplier_name, row.specification, row.category]
    .map((value) => (value ?? "").toLowerCase());
  const keywords = uniqueStrings(query.split(/[\s,，;；]+/), 8).map((value) => value.toLowerCase());
  return keywords.some((keyword) => fields.some((field) => field.includes(keyword)));
}

function matchesMarginBands(row: ProductRow, bands: ProductMarginBand[]) {
  if (bands.length === 0) return true;
  const margin = row.gross_margin_rate;
  return bands.some((band) => {
    if (band === "unavailable") return margin === null;
    if (margin === null) return false;
    if (band === "below35") return margin < 0.35;
    if (band === "35to40") return margin >= 0.35 && margin < 0.4;
    if (band === "40to45") return margin >= 0.4 && margin < 0.45;
    return margin >= 0.45;
  });
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

export async function getProductSummary(
  db: InventoryDatabase,
  principal: AppPrincipal,
  optionsOrDays: ProductSummaryOptions | number = {},
  salesReader: SalesConsumerReader = createDjangoSalesConsumerReader(),
) {
  const options = typeof optionsOrDays === "number" ? { days: optionsOrDays } : optionsOrDays;
  const appliedFilters = normalizeFilters(options);
  const query = normalizeQuery(options);
  const pagination = normalizeProductSummaryPagination(options);
  const [freshness, latestInventoryBatch] = await Promise.all([
    salesReader.read(principal, { operation: "freshness" }, { signal: options.signal }),
    findLatestInventoryImportBatch(db),
  ]);
  if (!freshness || typeof freshness !== "object" || typeof freshness.revision !== "string"
    || !freshness.revision || freshness.revision.length > 128
    || !freshness.data
    || !isIsoDateOrNull(freshness.data.dataStartDate)
    || !isIsoDateOrNull(freshness.data.dataCutoffDate)) {
    throw salesConsumerUnavailable();
  }
  validateLatestBatch(freshness.data.latestBatch);
  const dataStartDate = freshness.data.dataStartDate;
  const dataCutoffDate = freshness.data.dataCutoffDate;
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
      latestSalesFile: freshness.data.latestBatch?.fileName ?? null,
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

  const local = await loadLocalProductDimensions(db, latestInventoryBatch?.id ?? null);
  if (local.productCodes.length === 0) return empty(period.range, period.requestedStartDate, period.requestedEndDate);
  const performance = await readProductPerformance(salesReader, principal, {
    productCodes: local.productCodes,
    startDate: period.startDate,
    endDateExclusive: addProductSummaryDays(period.endDate, 1),
    filters: appliedFilters,
    expectedRevision: freshness.revision,
    expectedLatestBatch: freshness.data.latestBatch,
    signal: options.signal,
  });
  const allRows = [...performance.rows.values()].map((sales) => mergeProductRow(
    sales,
    local.erp.get(sales.productCode),
    local.stock.get(sales.productCode),
  ));
  const facetRows = allRows.filter((row) => matchesTextQuery(row, query.query));
  const filteredRows = facetRows.filter((row) => (
    (query.categories.length === 0 || query.categories.includes(row.category || "未分类"))
    && matchesMarginBands(row, query.marginBands)
  ));
  const sortValue = (row: ProductRow) => {
    if (query.sortBy === "netSalesCents") return row.net_sales_cents;
    if (query.sortBy === "grossProfitCents") return row.gross_profit_cents;
    if (query.sortBy === "grossMarginRate") return row.gross_margin_rate;
    if (query.sortBy === "refundRate") return row.refund_rate;
    if (query.sortBy === "stockValueCents") return row.stock_value_cents;
    return row.net_quantity;
  };
  const orderedRows = [...filteredRows].sort((left, right) => {
    const leftValue = sortValue(left);
    const rightValue = sortValue(right);
    if (leftValue === null && rightValue !== null) return query.direction === "asc" ? -1 : 1;
    if (leftValue !== null && rightValue === null) return query.direction === "asc" ? 1 : -1;
    if (leftValue !== null && rightValue !== null && leftValue !== rightValue) {
      return query.direction === "asc" ? leftValue - rightValue : rightValue - leftValue;
    }
    return compareText(left.product_code, right.product_code);
  });
  const pageRows = orderedRows.slice(pagination.offset, pagination.offset + pagination.pageSize);
  const grossSalesCents = filteredRows.reduce((sum, row) => sum + Number(row.gross_sales_cents ?? 0), 0);
  const netSalesCents = filteredRows.reduce((sum, row) => sum + Number(row.net_sales_cents ?? 0), 0);
  const grossProfitCents = filteredRows.reduce((sum, row) => sum + Number(row.gross_profit_cents ?? 0), 0);
  const metrics = {
    skuCount: filteredRows.length,
    grossSalesCents,
    netSalesCents,
    grossProfitCents,
    grossMarginRate: rate(grossProfitCents, netSalesCents),
    lossSkuCount: filteredRows.filter((row) => Number(row.net_sales_cents ?? 0) > 0 && Number(row.gross_profit_cents ?? 0) < 0).length,
    stockedSkuCount: filteredRows.filter((row) => Number(row.available_quantity ?? 0) > 0).length,
    marginBuckets: {
      below35Count: filteredRows.filter((row) => row.gross_margin_rate !== null && row.gross_margin_rate < 0.35).length,
      between35And40Count: filteredRows.filter((row) => row.gross_margin_rate !== null && row.gross_margin_rate >= 0.35 && row.gross_margin_rate < 0.4).length,
      between40And45Count: filteredRows.filter((row) => row.gross_margin_rate !== null && row.gross_margin_rate >= 0.4 && row.gross_margin_rate < 0.45).length,
      atLeast45Count: filteredRows.filter((row) => row.gross_margin_rate !== null && row.gross_margin_rate >= 0.45).length,
    },
  };
  const outletOptions = [...performance.outletOptions.values()]
    .sort((left, right) => left.platform.localeCompare(right.platform, "zh-CN") || left.shopName.localeCompare(right.shopName, "zh-CN"));
  const total = filteredRows.length;
  const outletsByProduct = new Map<string, Array<{ platform: string; shop: string }>>();
  for (const [productCode, sales] of performance.rows) {
    const deduplicated = new Map<string, { platform: string; shop: string }>();
    for (const rawOutlet of sales.outlets) {
      const outlet = canonicalizeShopIdentity(rawOutlet.platform, rawOutlet.shopName, rawOutlet.channel);
      deduplicated.set(shopFilterKey(outlet), { platform: outlet.platform, shop: outlet.shopName });
    }
    outletsByProduct.set(productCode, [...deduplicated.values()]);
  }
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
      latestSalesFile: freshness.data.latestBatch?.fileName ?? null,
    },
    filters: {
      platforms: [...new Set(outletOptions.map((outlet) => outlet.platform))],
      shops: outletOptions.map((outlet) => ({ key: shopFilterKey(outlet), platform: outlet.platform, shop: outlet.shopName })),
      categories: [...new Set(facetRows.map((row) => row.category || "未分类"))].sort(compareText).slice(0, 500),
    },
    filtersApplied: {
      platforms: appliedFilters.platforms,
      shops: appliedShops,
      query: query.query,
      categories: query.categories,
      marginBands: query.marginBands,
    },
    sort: { by: query.sortBy, direction: query.direction },
    metrics,
    pagination: {
      page: pagination.page,
      pageSize: pagination.pageSize,
      total,
      returned: pageRows.length,
      totalPages: total === 0 ? 0 : Math.ceil(total / pagination.pageSize),
      truncated: pagination.offset + pageRows.length < total,
    },
    items: pageRows.map((row) => mapItem(row, outletsByProduct.get(row.product_code) ?? [])),
  };
}
