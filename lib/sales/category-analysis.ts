import type { AppPrincipal } from "@/lib/auth/authorization";
import type { SalesDatabase } from "@/lib/sales/database";
import { parseProductQueries, resolveProductFilterCodes } from "@/lib/sales/product-query";
import { SALES_CATEGORY_EXPRESSION, SALES_CATEGORY_JOIN } from "@/lib/sales/category-resolution";
import type { SalesOutletFilter } from "@/lib/sales/summary";
import { shopFilterKey } from "@/lib/sales/shop-identity";

export const salesCategoryGranularities = ["day", "week", "month"] as const;
export type SalesCategoryGranularity = (typeof salesCategoryGranularities)[number];

export const salesCategorySortKeys = [
  "netSalesCents",
  "shareRate",
  "netQuantity",
  "refundRate",
  "weekOverWeekRate",
  "yearOverYearRate",
  "positiveQuantity",
  "returnQuantity",
  "refundAmountCents",
  "grossProfitCents",
  "grossMarginRate",
  "productCount",
] as const;
export type SalesCategorySortKey = (typeof salesCategorySortKeys)[number];
export type SalesCategorySortDirection = "asc" | "desc";

export class SalesCategoryRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SalesCategoryRequestError";
  }
}

export class SalesCategoryAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SalesCategoryAccessError";
  }
}

export type SalesCategoryAnalysisInput = {
  startDate: string;
  endDate: string;
  level?: number;
  categories?: string[];
  channels?: string[];
  platforms?: string[];
  outlets?: SalesOutletFilter[];
  productQueries?: string[];
  granularity?: SalesCategoryGranularity;
  sortBy?: SalesCategorySortKey;
  direction?: SalesCategorySortDirection;
  page?: number;
  pageSize?: number;
};

export type SalesCategoryOutletBreakdownInput = Omit<
  SalesCategoryAnalysisInput,
  "level" | "categories" | "granularity" | "sortBy" | "direction" | "page" | "pageSize"
> & {
  category: string;
};

type NormalizedInput = {
  startDate: string;
  endDate: string;
  endExclusive: string;
  level: 1;
  categories: string[];
  channels: string[];
  platforms: string[];
  outlets: SalesOutletFilter[];
  productQueries: string[];
  productCodes: string[];
  granularity: SalesCategoryGranularity;
  sortBy: SalesCategorySortKey;
  direction: SalesCategorySortDirection;
  page: number;
  pageSize: number;
};

type CategoryRow = {
  category_key: string;
  gross_sales_cents: number;
  refund_amount_cents: number;
  net_sales_cents: number;
  cost_amount_cents: number;
  gross_profit_cents: number;
  positive_quantity: number;
  return_quantity: number;
  net_quantity: number;
  product_count: number;
  line_count: number;
  sales_rank: number;
  detail_position: number;
  total_count: number;
  total_gross_sales_cents: number;
  total_refund_amount_cents: number;
  total_net_sales_cents: number;
  total_cost_amount_cents: number;
  total_gross_profit_cents: number;
  total_positive_quantity: number;
  total_return_quantity: number;
  total_net_quantity: number;
  total_product_count: number;
  total_line_count: number;
  uncategorized_net_sales_cents: number;
  uncategorized_product_count: number;
  data_cutoff_date: string | null;
  current_week_net_sales_cents: number;
  previous_week_net_sales_cents: number;
  year_ago_net_sales_cents: number;
  week_over_week_rate: number | null;
  year_over_year_rate: number | null;
};

type TrendRow = {
  period_key: string;
  category_key: string;
  net_sales_cents: number;
  gross_profit_cents: number;
  positive_quantity: number;
  return_quantity: number;
  refund_amount_cents: number;
};

type OptionRow = {
  dimension: "category" | "channel" | "platform" | "outlet";
  option_value: string;
  option_label: string;
  option_platform: string;
  option_index: number;
  option_total: number;
};

type OutletBreakdownRow = {
  platform: string;
  shop_name: string;
  gross_sales_cents: number;
  refund_amount_cents: number;
  net_sales_cents: number;
  cost_amount_cents: number;
  gross_profit_cents: number;
  positive_quantity: number;
  return_quantity: number;
  net_quantity: number;
  product_count: number;
  line_count: number;
  total_net_sales_cents: number;
  total_count: number;
};

const CATEGORY_EXPRESSION = SALES_CATEGORY_EXPRESSION;
const SHOP_EXPRESSION = "COALESCE(NULLIF(TRIM(s.shop_name), ''), NULLIF(TRIM(s.channel), ''), NULLIF(TRIM(s.platform), ''), '未分类')";
const PLATFORM_EXPRESSION = "COALESCE(NULLIF(TRIM(s.platform), ''), '未分类')";
const OPTION_LIMIT = 200;
const TREND_CATEGORY_LIMIT = 8;
const MAX_PAGE_SIZE = 100;
const DETAIL_TREND_PERIOD_LIMIT = 24;
const DETAIL_TREND_ROW_LIMIT = MAX_PAGE_SIZE * DETAIL_TREND_PERIOD_LIMIT;
const MAX_FILTER_VALUES = 50;
const MAX_RANGE_DAYS = 366;

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function addYears(value: string, years: number): string {
  const [year, month, day] = value.split("-").map(Number);
  const targetYear = year + years;
  const lastDay = new Date(Date.UTC(targetYear, month, 0)).getUTCDate();
  return `${targetYear.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${Math.min(day, lastDay).toString().padStart(2, "0")}`;
}

function dayDifference(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
}

function comparisonPeriods(input: Pick<NormalizedInput, "startDate" | "endDate">) {
  return {
    weekOverWeek: {
      current: {
        startDate: addDays(input.endDate, -6),
        endDate: input.endDate,
      },
      previous: {
        startDate: addDays(input.endDate, -13),
        endDate: addDays(input.endDate, -7),
      },
    },
    yearAgo: {
      startDate: addYears(input.startDate, -1),
      endDate: addYears(input.endDate, -1),
    },
  };
}

function withPeriod(input: NormalizedInput, startDate: string, endDate: string): NormalizedInput {
  return { ...input, startDate, endDate, endExclusive: addDays(endDate, 1) };
}

function boundedList(values: readonly string[] | undefined, maximum = MAX_FILTER_VALUES, label = "筛选"): string[] {
  const normalized = [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
  if (normalized.length > maximum || normalized.some((value) => value.length > 100)) {
    throw new SalesCategoryRequestError(`${label}最多 ${maximum} 项，且每项不能超过 100 字。`);
  }
  return normalized;
}

function scopeList(values: readonly string[] | undefined): string[] {
  const normalized = [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
  if (normalized.length > 500 || normalized.some((value) => value.length > 100)) {
    throw new SalesCategoryAccessError("当前账号的销售数据范围超出安全上限");
  }
  return normalized;
}

function boundedPositiveInteger(value: number | undefined, fallback: number, maximum: number): number {
  if (!Number.isFinite(value) || Number(value) <= 0) return fallback;
  return Math.min(maximum, Math.trunc(Number(value)));
}

function normalizeOutlets(values: readonly SalesOutletFilter[] | undefined): SalesOutletFilter[] {
  const normalized = (values ?? [])
    .map((value) => ({ platform: value.platform.trim(), shop: value.shop.trim() }))
    .filter((value) => value.platform && value.shop);
  const unique = [...new Map(normalized.map((value) => [`${value.platform}\u001f${value.shop}`, value])).values()];
  if (unique.length > MAX_FILTER_VALUES || unique.some((value) => value.platform.length > 100 || value.shop.length > 100)) {
    throw new SalesCategoryRequestError(`outlet 筛选最多 ${MAX_FILTER_VALUES} 项，且每项不能超过 100 字。`);
  }
  return unique;
}

function normalizeInput(input: SalesCategoryAnalysisInput, productCodes: string[]): NormalizedInput {
  if (!isIsoDate(input.startDate) || !isIsoDate(input.endDate)) {
    throw new SalesCategoryRequestError("品类分析日期必须使用 YYYY-MM-DD");
  }
  if (input.startDate > input.endDate) throw new SalesCategoryRequestError("品类分析开始日期不能晚于结束日期");
  if (dayDifference(input.startDate, input.endDate) + 1 > MAX_RANGE_DAYS) {
    throw new SalesCategoryRequestError(`品类分析统计周期最长支持 ${MAX_RANGE_DAYS} 天`);
  }
  if (input.level !== undefined && input.level !== 1) {
    throw new SalesCategoryRequestError("当前商品主数据仅提供 1 层品类，level 只能为 1");
  }
  const granularity = salesCategoryGranularities.includes(input.granularity as SalesCategoryGranularity)
    ? input.granularity as SalesCategoryGranularity
    : "day";
  const sortBy = salesCategorySortKeys.includes(input.sortBy as SalesCategorySortKey)
    ? input.sortBy as SalesCategorySortKey
    : "netSalesCents";
  const direction = input.direction === "asc" ? "asc" : "desc";
  return {
    startDate: input.startDate,
    endDate: input.endDate,
    endExclusive: addDays(input.endDate, 1),
    level: 1,
    categories: boundedList(input.categories, MAX_FILTER_VALUES, "品类筛选"),
    channels: boundedList(input.channels, MAX_FILTER_VALUES, "渠道筛选"),
    platforms: boundedList(input.platforms, MAX_FILTER_VALUES, "平台筛选"),
    outlets: normalizeOutlets(input.outlets),
    productQueries: parseProductQueries(input.productQueries ?? []),
    productCodes: boundedList(productCodes, 100, "商品筛选"),
    granularity,
    sortBy,
    direction,
    page: boundedPositiveInteger(input.page, 1, 100_000),
    pageSize: boundedPositiveInteger(input.pageSize, 20, MAX_PAGE_SIZE),
  };
}

function scopeSql(principal: AppPrincipal): { clauses: string[]; bindings: string[]; mode: "unrestricted" | "restricted" } {
  if (principal.scope === null) return { clauses: [], bindings: [], mode: "unrestricted" };
  const warehouses = scopeList(principal.scope.warehouses);
  const channels = scopeList(principal.scope.channels);
  const platforms = scopeList(principal.scope.platforms);
  if (warehouses.length === 0 && channels.length === 0 && platforms.length === 0) {
    throw new SalesCategoryAccessError("当前账号没有可读取的销售数据范围");
  }
  const clauses: string[] = [];
  const bindings: string[] = [];
  if (warehouses.length > 0) {
    clauses.push("s.warehouse IN (SELECT CAST(value AS TEXT) FROM json_each(?))");
    bindings.push(JSON.stringify(warehouses));
  }
  const outletScope: string[] = [];
  if (channels.length > 0) {
    outletScope.push("s.channel IN (SELECT CAST(value AS TEXT) FROM json_each(?))");
    bindings.push(JSON.stringify(channels));
  }
  if (platforms.length > 0) {
    outletScope.push("s.platform IN (SELECT CAST(value AS TEXT) FROM json_each(?))");
    bindings.push(JSON.stringify(platforms));
  }
  if (outletScope.length > 0) clauses.push(`(${outletScope.join(" OR ")})`);
  return { clauses, bindings, mode: "restricted" };
}

function filteredSalesSql(input: NormalizedInput, principal: AppPrincipal) {
  const clauses = [
    "s.ship_time >= ?",
    "s.ship_time < ?",
    "TRIM(s.warehouse) <> '刷刷仓'",
  ];
  const bindings: unknown[] = [input.startDate, input.endExclusive];
  const scope = scopeSql(principal);
  clauses.push(...scope.clauses);
  bindings.push(...scope.bindings);
  if (input.productCodes.length > 0) {
    clauses.push("s.product_code IN (SELECT CAST(value AS TEXT) FROM json_each(?))");
    bindings.push(JSON.stringify(input.productCodes));
  }
  if (input.categories.length > 0) {
    clauses.push(`${CATEGORY_EXPRESSION} IN (SELECT CAST(value AS TEXT) FROM json_each(?))`);
    bindings.push(JSON.stringify(input.categories));
  }
  if (input.channels.length > 0) {
    clauses.push("s.channel IN (SELECT CAST(value AS TEXT) FROM json_each(?))");
    bindings.push(JSON.stringify(input.channels));
  }
  if (input.platforms.length > 0) {
    clauses.push("s.platform IN (SELECT CAST(value AS TEXT) FROM json_each(?))");
    bindings.push(JSON.stringify(input.platforms));
  }
  if (input.outlets.length > 0) {
    clauses.push(`EXISTS (
      SELECT 1 FROM json_each(?) outlet
      WHERE s.platform = CAST(json_extract(outlet.value, '$.platform') AS TEXT)
        AND ${SHOP_EXPRESSION} = CAST(json_extract(outlet.value, '$.shop') AS TEXT)
    )`);
    bindings.push(JSON.stringify(input.outlets));
  }
  return {
    sql: `
      SELECT
        ${CATEGORY_EXPRESSION} AS category_key,
        s.product_code,
        s.product_name,
        s.category AS source_category,
        s.source_line_key,
        s.order_no,
        s.online_order_no,
        s.channel,
        ${PLATFORM_EXPRESSION} AS platform,
        ${SHOP_EXPRESSION} AS shop_name,
        s.quantity,
        s.allocated_amount_cents,
        s.cost_amount_cents,
        s.gross_profit_cents,
        substr(s.ship_time, 1, 10) AS business_date
      FROM sales_order_lines s
      ${SALES_CATEGORY_JOIN}
      WHERE ${clauses.join(" AND ")}
    `,
    bindings,
    scopeMode: scope.mode,
  };
}

const groupedCategorySql = `
  SELECT
    category_key,
    COALESCE(SUM(CASE WHEN allocated_amount_cents > 0 THEN allocated_amount_cents ELSE 0 END), 0) AS gross_sales_cents,
    COALESCE(SUM(CASE WHEN allocated_amount_cents < 0 THEN -allocated_amount_cents ELSE 0 END), 0) AS refund_amount_cents,
    COALESCE(SUM(allocated_amount_cents), 0) AS net_sales_cents,
    COALESCE(SUM(cost_amount_cents), 0) AS cost_amount_cents,
    COALESCE(SUM(gross_profit_cents), 0) AS gross_profit_cents,
    COALESCE(SUM(CASE WHEN quantity > 0 AND product_code <> 'ERP_PRICE_ADJUSTMENT' THEN quantity ELSE 0 END), 0) AS positive_quantity,
    COALESCE(SUM(CASE WHEN quantity < 0 AND product_code <> 'ERP_PRICE_ADJUSTMENT' THEN -quantity ELSE 0 END), 0) AS return_quantity,
    COALESCE(SUM(CASE WHEN NULLIF(TRIM(source_category), '') IS NOT NULL AND TRIM(source_category) NOT IN ('配件', '赠品配件') AND product_code <> 'ERP_PRICE_ADJUSTMENT' AND TRIM(product_name) <> '补差价专用' THEN quantity ELSE 0 END), 0) AS net_quantity,
    COUNT(DISTINCT NULLIF(product_code, '')) AS product_count,
    COUNT(*) AS line_count,
    MAX(business_date) AS latest_business_date
  FROM scoped
  GROUP BY category_key
`;

const sortSql: Record<SalesCategorySortKey, string> = {
  netSalesCents: "net_sales_cents",
  shareRate: "net_sales_cents",
  netQuantity: "net_quantity",
  refundRate: "refund_rate",
  weekOverWeekRate: "week_over_week_rate",
  yearOverYearRate: "year_over_year_rate",
  positiveQuantity: "positive_quantity",
  returnQuantity: "return_quantity",
  refundAmountCents: "refund_amount_cents",
  grossProfitCents: "gross_profit_cents",
  grossMarginRate: "CASE WHEN net_sales_cents = 0 THEN 0.0 ELSE CAST(net_sales_cents - cost_amount_cents AS REAL) / net_sales_cents END",
  productCount: "product_count",
};

function metric(row: CategoryRow) {
  const grossSalesCents = Number(row.gross_sales_cents ?? 0);
  const refundAmountCents = Number(row.refund_amount_cents ?? 0);
  const netSalesCents = Number(row.net_sales_cents ?? 0);
  const costAmountCents = Number(row.cost_amount_cents ?? 0);
  const grossProfitCents = Number(row.gross_profit_cents ?? 0);
  return {
    category: row.category_key,
    grossSalesCents,
    refundAmountCents,
    netSalesCents,
    costAmountCents,
    shareRate: Number(row.total_net_sales_cents ?? 0) === 0 ? 0 : netSalesCents / Number(row.total_net_sales_cents),
    positiveQuantity: Number(row.positive_quantity ?? 0),
    returnQuantity: Number(row.return_quantity ?? 0),
    netQuantity: Number(row.net_quantity ?? 0),
    refundRate: grossSalesCents === 0 ? 0 : refundAmountCents / grossSalesCents,
    grossProfitCents,
    grossMarginRate: netSalesCents === 0 ? 0 : (netSalesCents - costAmountCents) / netSalesCents,
    productCount: Number(row.product_count ?? 0),
    lineCount: Number(row.line_count ?? 0),
    currentWeekNetSalesCents: Number(row.current_week_net_sales_cents ?? 0),
    previousWeekNetSalesCents: Number(row.previous_week_net_sales_cents ?? 0),
    yearAgoNetSalesCents: Number(row.year_ago_net_sales_cents ?? 0),
    weekOverWeekRate: row.week_over_week_rate === null || row.week_over_week_rate === undefined
      ? null
      : Number(row.week_over_week_rate),
    yearOverYearRate: row.year_over_year_rate === null || row.year_over_year_rate === undefined
      ? null
      : Number(row.year_over_year_rate),
  };
}

function emptySummary() {
  return {
    grossSalesCents: 0,
    refundAmountCents: 0,
    netSalesCents: 0,
    costAmountCents: 0,
    positiveQuantity: 0,
    returnQuantity: 0,
    netQuantity: 0,
    grossProfitCents: 0,
    grossMarginRate: 0,
    productCount: 0,
    lineCount: 0,
    categoryCount: 0,
  };
}

function summary(row: CategoryRow | undefined) {
  if (!row) return emptySummary();
  const netSalesCents = Number(row.total_net_sales_cents ?? 0);
  const costAmountCents = Number(row.total_cost_amount_cents ?? 0);
  const grossProfitCents = Number(row.total_gross_profit_cents ?? 0);
  const positiveQuantity = Number(row.total_positive_quantity ?? 0);
  const returnQuantity = Number(row.total_return_quantity ?? 0);
  return {
    grossSalesCents: Number(row.total_gross_sales_cents ?? 0),
    refundAmountCents: Number(row.total_refund_amount_cents ?? 0),
    netSalesCents,
    costAmountCents,
    positiveQuantity,
    returnQuantity,
    netQuantity: Number(row.total_net_quantity ?? 0),
    grossProfitCents,
    grossMarginRate: netSalesCents === 0 ? 0 : (netSalesCents - costAmountCents) / netSalesCents,
    productCount: Number(row.total_product_count ?? 0),
    lineCount: Number(row.total_line_count ?? 0),
    categoryCount: Number(row.total_count ?? 0),
  };
}

function trendPeriodExpression(granularity: SalesCategoryGranularity): string {
  if (granularity === "month") return "substr(business_date, 1, 7)";
  if (granularity === "week") return "date(business_date, '-' || ((CAST(strftime('%w', business_date) AS INTEGER) + 6) % 7) || ' days')";
  return "business_date";
}

async function readCategoryRows(db: SalesDatabase, input: NormalizedInput, principal: AppPrincipal) {
  const scoped = filteredSalesSql(input, principal);
  const comparisons = comparisonPeriods(input);
  const currentWeekScoped = filteredSalesSql(withPeriod(input, comparisons.weekOverWeek.current.startDate, comparisons.weekOverWeek.current.endDate), principal);
  const previousWeekScoped = filteredSalesSql(withPeriod(input, comparisons.weekOverWeek.previous.startDate, comparisons.weekOverWeek.previous.endDate), principal);
  const yearAgoScoped = filteredSalesSql(withPeriod(input, comparisons.yearAgo.startDate, comparisons.yearAgo.endDate), principal);
  const sort = sortSql[input.sortBy];
  const direction = input.direction.toUpperCase();
  const offset = (input.page - 1) * input.pageSize;
  const result = await db.prepare(`
    WITH scoped AS (${scoped.sql}),
    grouped AS (${groupedCategorySql}),
    current_week_scoped AS (${currentWeekScoped.sql}),
    current_week_grouped AS (${groupedCategorySql.replace(/\bscoped\b/g, "current_week_scoped")}),
    previous_week_scoped AS (${previousWeekScoped.sql}),
    previous_week_grouped AS (${groupedCategorySql.replace(/\bscoped\b/g, "previous_week_scoped")}),
    year_ago_scoped AS (${yearAgoScoped.sql}),
    year_ago_grouped AS (${groupedCategorySql.replace(/\bscoped\b/g, "year_ago_scoped")}),
    enriched AS (
      SELECT grouped.*,
        CASE WHEN grouped.gross_sales_cents = 0 THEN 0.0 ELSE CAST(grouped.refund_amount_cents AS REAL) / grouped.gross_sales_cents END AS refund_rate,
        COALESCE(current_week_grouped.net_sales_cents, 0) AS current_week_net_sales_cents,
        COALESCE(previous_week_grouped.net_sales_cents, 0) AS previous_week_net_sales_cents,
        COALESCE(year_ago_grouped.net_sales_cents, 0) AS year_ago_net_sales_cents,
        CASE WHEN COALESCE(previous_week_grouped.net_sales_cents, 0) = 0 THEN NULL
          ELSE CAST(COALESCE(current_week_grouped.net_sales_cents, 0) - previous_week_grouped.net_sales_cents AS REAL) / ABS(previous_week_grouped.net_sales_cents) END AS week_over_week_rate,
        CASE WHEN COALESCE(year_ago_grouped.net_sales_cents, 0) = 0 THEN NULL
          ELSE CAST(grouped.net_sales_cents - year_ago_grouped.net_sales_cents AS REAL) / ABS(year_ago_grouped.net_sales_cents) END AS year_over_year_rate
      FROM grouped
      LEFT JOIN current_week_grouped ON current_week_grouped.category_key = grouped.category_key
      LEFT JOIN previous_week_grouped ON previous_week_grouped.category_key = grouped.category_key
      LEFT JOIN year_ago_grouped ON year_ago_grouped.category_key = grouped.category_key
    ),
    ranked AS (
      SELECT enriched.*,
        ROW_NUMBER() OVER (ORDER BY net_sales_cents DESC, category_key ASC) AS sales_rank,
        ROW_NUMBER() OVER (ORDER BY ${sort} ${direction}, category_key ASC) AS detail_position,
        COUNT(*) OVER () AS total_count,
        SUM(gross_sales_cents) OVER () AS total_gross_sales_cents,
        SUM(refund_amount_cents) OVER () AS total_refund_amount_cents,
        SUM(net_sales_cents) OVER () AS total_net_sales_cents,
        SUM(cost_amount_cents) OVER () AS total_cost_amount_cents,
        SUM(gross_profit_cents) OVER () AS total_gross_profit_cents,
        SUM(positive_quantity) OVER () AS total_positive_quantity,
        SUM(return_quantity) OVER () AS total_return_quantity,
        SUM(net_quantity) OVER () AS total_net_quantity,
        SUM(product_count) OVER () AS total_product_count,
        SUM(line_count) OVER () AS total_line_count,
        SUM(CASE WHEN category_key = '未分类' THEN net_sales_cents ELSE 0 END) OVER () AS uncategorized_net_sales_cents,
        SUM(CASE WHEN category_key = '未分类' THEN product_count ELSE 0 END) OVER () AS uncategorized_product_count,
        MAX(latest_business_date) OVER () AS data_cutoff_date
      FROM enriched
    )
    SELECT * FROM ranked
    WHERE sales_rank <= ? OR (detail_position > ? AND detail_position <= ?)
    ORDER BY detail_position ASC
  `).bind(
    ...scoped.bindings,
    ...currentWeekScoped.bindings,
    ...previousWeekScoped.bindings,
    ...yearAgoScoped.bindings,
    10,
    offset,
    offset + input.pageSize,
  ).all<CategoryRow>();
  return { rows: result.results ?? [], scopeMode: scoped.scopeMode };
}

async function readTrend(db: SalesDatabase, input: NormalizedInput, principal: AppPrincipal) {
  const scoped = filteredSalesSql(input, principal);
  const periodExpression = trendPeriodExpression(input.granularity);
  const result = await db.prepare(`
    WITH scoped AS (${scoped.sql}),
    grouped AS (${groupedCategorySql}),
    top_categories AS (
      SELECT category_key
      FROM grouped
      ORDER BY net_sales_cents DESC, category_key ASC
      LIMIT ${TREND_CATEGORY_LIMIT}
    )
    SELECT
      ${periodExpression} AS period_key,
      scoped.category_key,
      COALESCE(SUM(scoped.allocated_amount_cents), 0) AS net_sales_cents,
      COALESCE(SUM(scoped.gross_profit_cents), 0) AS gross_profit_cents,
      COALESCE(SUM(CASE WHEN scoped.quantity > 0 AND scoped.product_code <> 'ERP_PRICE_ADJUSTMENT' THEN scoped.quantity ELSE 0 END), 0) AS positive_quantity,
      COALESCE(SUM(CASE WHEN scoped.quantity < 0 AND scoped.product_code <> 'ERP_PRICE_ADJUSTMENT' THEN -scoped.quantity ELSE 0 END), 0) AS return_quantity,
      COALESCE(SUM(CASE WHEN scoped.allocated_amount_cents < 0 THEN -scoped.allocated_amount_cents ELSE 0 END), 0) AS refund_amount_cents
    FROM scoped
    INNER JOIN top_categories ON top_categories.category_key = scoped.category_key
    GROUP BY period_key, scoped.category_key
    ORDER BY period_key ASC, net_sales_cents DESC, scoped.category_key ASC
    LIMIT 3000
  `).bind(...scoped.bindings).all<TrendRow>();
  return result.results ?? [];
}

async function readDetailTrend(
  db: SalesDatabase,
  input: NormalizedInput,
  principal: AppPrincipal,
  categories: string[],
) {
  if (categories.length === 0) return [];
  const scoped = filteredSalesSql(input, principal);
  const periodExpression = trendPeriodExpression(input.granularity);
  const result = await db.prepare(`
    WITH scoped AS (${scoped.sql}),
    aggregated AS (
      SELECT
        ${periodExpression} AS period_key,
        category_key,
        COALESCE(SUM(allocated_amount_cents), 0) AS net_sales_cents,
        COALESCE(SUM(gross_profit_cents), 0) AS gross_profit_cents,
        COALESCE(SUM(CASE WHEN quantity > 0 AND product_code <> 'ERP_PRICE_ADJUSTMENT' THEN quantity ELSE 0 END), 0) AS positive_quantity,
        COALESCE(SUM(CASE WHEN quantity < 0 AND product_code <> 'ERP_PRICE_ADJUSTMENT' THEN -quantity ELSE 0 END), 0) AS return_quantity,
        COALESCE(SUM(CASE WHEN allocated_amount_cents < 0 THEN -allocated_amount_cents ELSE 0 END), 0) AS refund_amount_cents
      FROM scoped
      WHERE category_key IN (SELECT CAST(value AS TEXT) FROM json_each(?))
      GROUP BY period_key, category_key
    ),
    recent_periods AS (
      SELECT period_key
      FROM aggregated
      GROUP BY period_key
      ORDER BY period_key DESC
      LIMIT ${DETAIL_TREND_PERIOD_LIMIT}
    )
    SELECT aggregated.*
    FROM aggregated
    INNER JOIN recent_periods ON recent_periods.period_key = aggregated.period_key
    ORDER BY aggregated.category_key ASC, aggregated.period_key ASC
    LIMIT ${DETAIL_TREND_ROW_LIMIT}
  `).bind(...scoped.bindings, JSON.stringify(categories)).all<TrendRow>();
  return result.results ?? [];
}

function categoryTrend(rows: TrendRow[]) {
  const points = rows.map((row) => ({
    period: row.period_key,
    netSalesCents: Number(row.net_sales_cents ?? 0),
  }));
  const first = points[0]?.netSalesCents;
  const last = points.at(-1)?.netSalesCents;
  const changeRate = points.length < 2 || first === undefined || last === undefined || first === 0
    ? null
    : (last - first) / Math.abs(first);
  return {
    points,
    changeRate,
    direction: changeRate === null ? "insufficient" as const : changeRate > 0 ? "up" as const : changeRate < 0 ? "down" as const : "flat" as const,
  };
}

async function readOptions(db: SalesDatabase, input: NormalizedInput, principal: AppPrincipal) {
  const optionInput = { ...input, categories: [], channels: [], platforms: [], outlets: [] };
  const scoped = filteredSalesSql(optionInput, principal);
  const result = await db.prepare(`
    WITH scoped AS (${scoped.sql}),
    raw_options AS (
      SELECT 'category' AS dimension, category_key AS option_value, category_key AS option_label, '' AS option_platform FROM scoped GROUP BY category_key
      UNION ALL
      SELECT 'channel', COALESCE(NULLIF(TRIM(channel), ''), '未分类'), COALESCE(NULLIF(TRIM(channel), ''), '未分类'), '' FROM scoped GROUP BY COALESCE(NULLIF(TRIM(channel), ''), '未分类')
      UNION ALL
      SELECT 'platform', platform, platform, '' FROM scoped GROUP BY platform
      UNION ALL
      SELECT 'outlet', platform || char(31) || shop_name, shop_name, platform FROM scoped GROUP BY platform, shop_name
    ),
    ranked_options AS (
      SELECT raw_options.*,
        ROW_NUMBER() OVER (PARTITION BY dimension ORDER BY option_label ASC, option_value ASC) AS option_index,
        COUNT(*) OVER (PARTITION BY dimension) AS option_total
      FROM raw_options
    )
    SELECT * FROM ranked_options WHERE option_index <= ? ORDER BY dimension, option_index
  `).bind(...scoped.bindings, OPTION_LIMIT).all<OptionRow>();
  const rows = result.results ?? [];
  const values = (dimension: OptionRow["dimension"]) => rows.filter((row) => row.dimension === dimension);
  const total = (dimension: OptionRow["dimension"]) => Number(values(dimension)[0]?.option_total ?? 0);
  return {
    categories: values("category").map((row) => row.option_value),
    channels: values("channel").map((row) => row.option_value),
    platforms: values("platform").map((row) => row.option_value),
    outlets: values("outlet").map((row) => ({
      key: shopFilterKey({ platform: row.option_platform, shopName: row.option_label }),
      platform: row.option_platform,
      name: row.option_label,
    })),
    totals: {
      categories: total("category"),
      channels: total("channel"),
      platforms: total("platform"),
      outlets: total("outlet"),
    },
    truncated: rows.some((row) => Number(row.option_total) > OPTION_LIMIT),
    limit: OPTION_LIMIT,
  };
}

function outletBreakdownMetric(row: OutletBreakdownRow, totalNetSalesCents: number) {
  const grossSalesCents = Number(row.gross_sales_cents ?? 0);
  const refundAmountCents = Number(row.refund_amount_cents ?? 0);
  const netSalesCents = Number(row.net_sales_cents ?? 0);
  const costAmountCents = Number(row.cost_amount_cents ?? 0);
  const grossProfitCents = Number(row.gross_profit_cents ?? 0);
  return {
    grossSalesCents,
    refundAmountCents,
    netSalesCents,
    costAmountCents,
    shareRate: totalNetSalesCents === 0 ? 0 : netSalesCents / totalNetSalesCents,
    positiveQuantity: Number(row.positive_quantity ?? 0),
    returnQuantity: Number(row.return_quantity ?? 0),
    netQuantity: Number(row.net_quantity ?? 0),
    refundRate: grossSalesCents === 0 ? 0 : refundAmountCents / grossSalesCents,
    grossProfitCents,
    grossMarginRate: netSalesCents === 0 ? 0 : (netSalesCents - costAmountCents) / netSalesCents,
    lineCount: Number(row.line_count ?? 0),
  };
}

export async function getSalesCategoryOutletBreakdown(
  db: SalesDatabase,
  rawInput: SalesCategoryOutletBreakdownInput,
  principal: AppPrincipal,
) {
  const category = boundedList([rawInput.category], 1, "品类")[0];
  if (!category) throw new SalesCategoryRequestError("category 不能为空");
  const productQueries = parseProductQueries(rawInput.productQueries ?? []);
  const productCodes = await resolveProductFilterCodes(db, productQueries);
  const input = normalizeInput({
    ...rawInput,
    categories: [category],
    productQueries,
    granularity: "day",
    sortBy: "netSalesCents",
    direction: "desc",
    page: 1,
    pageSize: 1,
  }, productCodes);
  const scoped = filteredSalesSql(input, principal);
  const result = await db.prepare(`
    WITH scoped AS (${scoped.sql}),
    grouped AS (
      SELECT
        platform,
        shop_name,
        COALESCE(SUM(CASE WHEN allocated_amount_cents > 0 THEN allocated_amount_cents ELSE 0 END), 0) AS gross_sales_cents,
        COALESCE(SUM(CASE WHEN allocated_amount_cents < 0 THEN -allocated_amount_cents ELSE 0 END), 0) AS refund_amount_cents,
        COALESCE(SUM(allocated_amount_cents), 0) AS net_sales_cents,
        COALESCE(SUM(cost_amount_cents), 0) AS cost_amount_cents,
        COALESCE(SUM(gross_profit_cents), 0) AS gross_profit_cents,
        COALESCE(SUM(CASE WHEN quantity > 0 AND product_code <> 'ERP_PRICE_ADJUSTMENT' THEN quantity ELSE 0 END), 0) AS positive_quantity,
        COALESCE(SUM(CASE WHEN quantity < 0 AND product_code <> 'ERP_PRICE_ADJUSTMENT' THEN -quantity ELSE 0 END), 0) AS return_quantity,
        COALESCE(SUM(CASE WHEN NULLIF(TRIM(source_category), '') IS NOT NULL AND TRIM(source_category) NOT IN ('配件', '赠品配件') AND product_code <> 'ERP_PRICE_ADJUSTMENT' AND TRIM(product_name) <> '补差价专用' THEN quantity ELSE 0 END), 0) AS net_quantity,
        COUNT(DISTINCT NULLIF(product_code, '')) AS product_count,
        COUNT(*) AS line_count
      FROM scoped
      GROUP BY platform, shop_name
    ),
    bounded AS (
      SELECT grouped.*,
        SUM(net_sales_cents) OVER () AS total_net_sales_cents,
        COUNT(*) OVER () AS total_count
      FROM grouped
    )
    SELECT * FROM bounded
    ORDER BY net_sales_cents DESC, platform ASC, shop_name ASC
    LIMIT 500
  `).bind(...scoped.bindings).all<OutletBreakdownRow>();
  const rows = result.results ?? [];
  const totalNetSalesCents = Number(rows[0]?.total_net_sales_cents ?? 0);
  const totalCount = Number(rows[0]?.total_count ?? 0);
  const platformMap = new Map<string, {
    platform: string;
    grossSalesCents: number;
    refundAmountCents: number;
    netSalesCents: number;
    costAmountCents: number;
    positiveQuantity: number;
    returnQuantity: number;
    netQuantity: number;
    grossProfitCents: number;
    lineCount: number;
    shops: Array<ReturnType<typeof outletBreakdownMetric> & { shop: string }>;
  }>();
  for (const row of rows) {
    const shop = outletBreakdownMetric(row, totalNetSalesCents);
    const platform = platformMap.get(row.platform) ?? {
      platform: row.platform,
      grossSalesCents: 0,
      refundAmountCents: 0,
      netSalesCents: 0,
      costAmountCents: 0,
      positiveQuantity: 0,
      returnQuantity: 0,
      netQuantity: 0,
      grossProfitCents: 0,
      lineCount: 0,
      shops: [],
    };
    platform.grossSalesCents += shop.grossSalesCents;
    platform.refundAmountCents += shop.refundAmountCents;
    platform.netSalesCents += shop.netSalesCents;
    platform.costAmountCents += shop.costAmountCents;
    platform.positiveQuantity += shop.positiveQuantity;
    platform.returnQuantity += shop.returnQuantity;
    platform.netQuantity += shop.netQuantity;
    platform.grossProfitCents += shop.grossProfitCents;
    platform.lineCount += shop.lineCount;
    platform.shops.push({ shop: row.shop_name, ...shop });
    platformMap.set(row.platform, platform);
  }
  const platforms = [...platformMap.values()]
    .map((platform) => ({
      ...platform,
      shareRate: totalNetSalesCents === 0 ? 0 : platform.netSalesCents / totalNetSalesCents,
      refundRate: platform.grossSalesCents === 0 ? 0 : platform.refundAmountCents / platform.grossSalesCents,
      grossMarginRate: platform.netSalesCents === 0 ? 0 : (platform.netSalesCents - platform.costAmountCents) / platform.netSalesCents,
      shopCount: platform.shops.length,
    }))
    .sort((left, right) => right.netSalesCents - left.netSalesCents || left.platform.localeCompare(right.platform, "zh-CN"));
  return {
    range: { startDate: input.startDate, endDate: input.endDate, endExclusive: input.endExclusive, timezone: "Asia/Shanghai" },
    category,
    totals: {
      netSalesCents: totalNetSalesCents,
      platformCount: platforms.length,
      shopCount: rows.length,
    },
    platforms,
    pagination: { total: totalCount, returned: rows.length, truncated: rows.length < totalCount, limit: 500 },
  };
}

export async function getSalesCategoryAnalysis(
  db: SalesDatabase,
  rawInput: SalesCategoryAnalysisInput,
  principal: AppPrincipal,
) {
  const productQueries = parseProductQueries(rawInput.productQueries ?? []);
  const productCodes = await resolveProductFilterCodes(db, productQueries);
  const input = normalizeInput({ ...rawInput, productQueries }, productCodes);
  const [categoryResult, trendRows, filterOptions] = await Promise.all([
    readCategoryRows(db, input, principal),
    readTrend(db, input, principal),
    readOptions(db, input, principal),
  ]);
  const first = categoryResult.rows[0];
  const total = Number(first?.total_count ?? 0);
  const offset = (input.page - 1) * input.pageSize;
  const detailRows = categoryResult.rows
    .filter((row) => Number(row.detail_position) > offset && Number(row.detail_position) <= offset + input.pageSize)
    .sort((left, right) => Number(left.detail_position) - Number(right.detail_position));
  const detailTrendRows = await readDetailTrend(db, input, principal, detailRows.map((row) => row.category_key));
  const detailTrendByCategory = new Map<string, TrendRow[]>();
  for (const row of detailTrendRows) {
    const rows = detailTrendByCategory.get(row.category_key) ?? [];
    rows.push(row);
    detailTrendByCategory.set(row.category_key, rows);
  }
  const details = detailRows.map((row) => ({
    ...metric(row),
    trend: categoryTrend(detailTrendByCategory.get(row.category_key) ?? []),
  }));
  const ranking = categoryResult.rows
    .filter((row) => Number(row.sales_rank) <= 10)
    .sort((left, right) => Number(left.sales_rank) - Number(right.sales_rank))
    .map((row) => ({ rank: Number(row.sales_rank), ...metric(row) }));
  const totals = summary(first);
  const comparisons = comparisonPeriods(input);
  const uncategorizedNetSalesCents = Number(first?.uncategorized_net_sales_cents ?? 0);
  const uncategorizedProductCount = Number(first?.uncategorized_product_count ?? 0);
  return {
    range: { startDate: input.startDate, endDate: input.endDate, endExclusive: input.endExclusive, timezone: "Asia/Shanghai" },
    comparisonPeriods: comparisons,
    dataCutoffDate: first?.data_cutoff_date ?? null,
    categoryHierarchy: {
      currentLevel: 1 as const,
      levels: [{ level: 1 as const, key: "category", label: "品类" }],
      supportsDrilldown: false,
      source: {
        primary: "erp_product_master.category",
        fallback: "sales_order_lines.category",
        joinKey: "product_code",
        unmatchedLabel: "未分类",
      },
    },
    filtersApplied: {
      level: input.level,
      categories: input.categories,
      channels: input.channels,
      platforms: input.platforms,
      outlets: input.outlets,
      productQueries: input.productQueries,
      productCodes: input.productCodes,
      dataScope: principal.scope === null
        ? { mode: "unrestricted" as const, warehouses: null, channels: null, platforms: null }
        : {
            mode: categoryResult.scopeMode,
            warehouses: scopeList(principal.scope.warehouses),
            channels: scopeList(principal.scope.channels),
            platforms: scopeList(principal.scope.platforms),
          },
    },
    summary: totals,
    uncategorized: {
      category: "未分类",
      productCount: uncategorizedProductCount,
      netSalesCents: uncategorizedNetSalesCents,
      shareRate: totals.netSalesCents === 0 ? 0 : uncategorizedNetSalesCents / totals.netSalesCents,
      visible: uncategorizedProductCount > 0 || uncategorizedNetSalesCents !== 0,
    },
    structure: {
      items: ranking,
      otherNetSalesCents: totals.netSalesCents - ranking.reduce((sum, item) => sum + item.netSalesCents, 0),
      otherShareRate: totals.netSalesCents === 0 ? 0 : (totals.netSalesCents - ranking.reduce((sum, item) => sum + item.netSalesCents, 0)) / totals.netSalesCents,
      contributionRateTotal: totals.netSalesCents === 0 ? 0 : 1,
    },
    ranking,
    trend: {
      granularity: input.granularity,
      categoryLimit: TREND_CATEGORY_LIMIT,
      returned: trendRows.length,
      truncated: trendRows.length >= 3000,
      items: trendRows.map((row) => ({
        period: row.period_key,
        category: row.category_key,
        netSalesCents: Number(row.net_sales_cents ?? 0),
        grossProfitCents: Number(row.gross_profit_cents ?? 0),
        positiveQuantity: Number(row.positive_quantity ?? 0),
        returnQuantity: Number(row.return_quantity ?? 0),
        refundAmountCents: Number(row.refund_amount_cents ?? 0),
      })),
    },
    details: {
      items: details,
      pagination: {
        page: input.page,
        pageSize: input.pageSize,
        total,
        returned: details.length,
        truncated: offset + details.length < total,
      },
      sort: { by: input.sortBy, direction: input.direction },
      trend: { granularity: input.granularity, periodLimit: DETAIL_TREND_PERIOD_LIMIT },
    },
    filterOptions,
  };
}
