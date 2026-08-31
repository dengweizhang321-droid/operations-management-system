import {
  findLatestSalesImportBatch,
  type SalesDatabase,
} from "@/lib/sales/database";
import {
  alignSalesSummaryPeriodToDataCutoff,
  type SalesSummaryPeriod,
} from "@/lib/sales/period";
import { parseProductQueriesStrict, resolveProductFilterCodes } from "@/lib/sales/product-query";
import {
  SALES_CATEGORY_EXPRESSION,
  SALES_CATEGORY_JOIN,
} from "@/lib/sales/category-resolution";

export const salesRanges = ["today", "yesterday", "last7", "last15", "month", "quarter", "custom", "all"] as const;
export type SalesRange = (typeof salesRanges)[number];
export type SalesSummaryProjection = "full" | "dashboard";
export const MAX_SALES_TREND_DAYS = 366;
export const MAX_SALES_GROUP_ROWS = 500;

type Period = SalesSummaryPeriod;

type MetricRow = {
  gross_sales_cents: number | null;
  refund_amount_cents: number | null;
  net_sales_excluding_accessories_cents: number | null;
  cost_amount_cents: number | null;
  gross_profit_cents: number | null;
  net_quantity: number | null;
  order_count: number;
  line_count: number;
};

type GroupRow = MetricRow & {
  group_key: string;
  name: string;
  platform: string | null;
  total_count: number;
  total_net_sales_cents: number;
};
type DailyRow = MetricRow & { date: string };
type FilterShopRow = { option_key: string; name: string; platform: string | null };
type FilterPlatformRow = { platform: string };
type FilterCategoryRow = { category: string };
export type SalesOutletFilter = { platform: string; shop: string };
type SalesPlatformFilter = string | string[];

export class SalesSummaryRequestError extends Error {}

export function isSalesRange(value: string): value is SalesRange {
  return salesRanges.includes(value as SalesRange);
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

function addMonths(value: string, months: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + months);
  return isoDate(date);
}

function addYears(value: string, years: number) {
  const [year, month, day] = value.split("-").map(Number);
  const targetYear = year + years;
  const lastDay = new Date(Date.UTC(targetYear, month, 0)).getUTCDate();
  return `${targetYear.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${Math.min(day, lastDay).toString().padStart(2, "0")}`;
}

function isIsoDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function dayDifference(start: string, end: string) {
  return Math.round(
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000,
  );
}

function shanghaiToday() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function periodFor(range: Exclude<SalesRange, "all" | "custom">, today: string): Period {
  if (range === "today") {
    const yesterday = addDays(today, -1);
    return {
      startDate: today,
      endDate: today,
      previousStartDate: yesterday,
      previousEndDate: yesterday,
    };
  }

  if (range === "yesterday") {
    const yesterday = addDays(today, -1);
    return {
      startDate: yesterday,
      endDate: yesterday,
      previousStartDate: addDays(today, -2),
      previousEndDate: addDays(today, -2),
    };
  }

  if (range === "last7") {
    return {
      startDate: addDays(today, -6),
      endDate: today,
      previousStartDate: addDays(today, -13),
      previousEndDate: addDays(today, -7),
    };
  }

  if (range === "last15") {
    return {
      startDate: addDays(today, -14),
      endDate: today,
      previousStartDate: addDays(today, -29),
      previousEndDate: addDays(today, -15),
    };
  }

  const [year, month] = today.split("-").map(Number);
  if (range === "month") {
    const startDate = `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-01`;
    const previousStartDate = addMonths(startDate, -1);
    return {
      startDate,
      endDate: today,
      previousStartDate,
      previousEndDate: [addDays(previousStartDate, dayDifference(startDate, today)), addDays(startDate, -1)].sort()[0],
    };
  }

  const quarterMonth = Math.floor((month - 1) / 3) * 3 + 1;
  const startDate = `${year.toString().padStart(4, "0")}-${quarterMonth.toString().padStart(2, "0")}-01`;
  const previousStartDate = addMonths(startDate, -3);
  return {
    startDate,
    endDate: today,
    previousStartDate,
    previousEndDate: [addDays(previousStartDate, dayDifference(startDate, today)), addDays(startDate, -1)].sort()[0],
  };
}

function customPeriod(startDate: string, endDate: string): Period {
  if (!isIsoDate(startDate) || !isIsoDate(endDate)) {
    throw new SalesSummaryRequestError("自定义统计周期需要有效的起止日期（YYYY-MM-DD）");
  }
  if (startDate > endDate) {
    throw new SalesSummaryRequestError("自定义统计周期的开始日期不能晚于结束日期");
  }

  const days = dayDifference(startDate, endDate) + 1;
  if (days > 366) throw new SalesSummaryRequestError("自定义统计周期最长支持 366 天");

  const previousEndDate = addDays(startDate, -1);
  return {
    startDate,
    endDate,
    previousStartDate: addDays(previousEndDate, -(days - 1)),
    previousEndDate,
  };
}

function bindPeriod(
  statement: ReturnType<SalesDatabase["prepare"]>,
  startDate: string,
  endDate: string,
  productCodes: string[] = [],
  platform?: SalesPlatformFilter,
  shop?: string,
  categories: string[] = [],
  outlets: SalesOutletFilter[] = [],
  extraBindings: unknown[] = [],
) {
  return statement.bind(
    startDate,
    addDays(endDate, 1),
    ...(productCodes.length > 0 ? [JSON.stringify(productCodes)] : []),
    ...outletBindings(platform, shop, outlets),
    ...(categories.length > 0 ? [JSON.stringify(categories)] : []),
    ...extraBindings,
  );
}

function productCodeClause(productCodes: string[]) {
  return productCodes.length > 0
    ? " AND s.product_code IN (SELECT CAST(value AS TEXT) FROM json_each(?))"
    : "";
}

function outletClause(platform?: SalesPlatformFilter, shop?: string, outlets: SalesOutletFilter[] = []) {
  const platformName = "COALESCE(NULLIF(s.platform, ''), '未分类')";
  const shopName = "COALESCE(NULLIF(s.shop_name, ''), NULLIF(s.channel, ''), NULLIF(s.platform, ''), '未分类')";
  const platformClause = Array.isArray(platform)
    ? ` AND ${platformName} IN (SELECT CAST(value AS TEXT) FROM json_each(?))`
    : platform ? ` AND ${platformName} = ?` : "";
  if (outlets.length > 0) {
    return `${platformClause} AND EXISTS (
      SELECT 1 FROM json_each(?) outlet
      WHERE ${platformName} = CAST(json_extract(outlet.value, '$.platform') AS TEXT)
        AND ${shopName} = CAST(json_extract(outlet.value, '$.shop') AS TEXT)
    )`;
  }
  return `${platformClause}${shop ? ` AND ${shopName} = ?` : ""}`;
}

function outletBindings(platform?: SalesPlatformFilter, shop?: string, outlets: SalesOutletFilter[] = []) {
  const platformBindings = Array.isArray(platform)
    ? [JSON.stringify(platform)]
    : platform ? [platform] : [];
  return [
    ...platformBindings,
    ...(outlets.length > 0 ? [JSON.stringify(outlets)] : shop ? [shop] : []),
  ];
}

function categoryClause(categories: string[]) {
  return categories.length > 0
    ? ` AND ${SALES_CATEGORY_EXPRESSION} IN (SELECT CAST(value AS TEXT) FROM json_each(?))`
    : "";
}

function normalizeProductCodes(values: string[] | undefined) {
  const normalized = [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
  if (normalized.length > 100 || normalized.some((value) => value.length > 200)) {
    throw new SalesSummaryRequestError("商品筛选最多 100 项，且每项不能超过 200 字。");
  }
  return normalized;
}

function normalizeCategories(values: string[] | undefined) {
  const normalized = [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
  if (normalized.length > 50 || normalized.some((value) => value.length > 100)) {
    throw new SalesSummaryRequestError("品类筛选最多 50 项，且每项不能超过 100 字。");
  }
  return normalized;
}

function normalizePlatforms(values: string[] | undefined) {
  const normalized = [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
  if (normalized.length > 50 || normalized.some((value) => value.length > 100)) {
    throw new SalesSummaryRequestError("平台筛选最多 50 项，且每项不能超过 100 字。");
  }
  return normalized;
}

function normalizeOutlets(values: SalesOutletFilter[] | undefined) {
  const outlets = (values ?? [])
    .map((value) => ({ platform: value.platform.trim(), shop: value.shop.trim() }))
    .filter((value) => value.platform && value.shop);
  const unique = [...new Map(outlets.map((value) => [`${value.platform}\u001f${value.shop}`, value])).values()];
  if (unique.length > 50 || unique.some((value) => value.platform.length > 100 || value.shop.length > 100)) {
    throw new SalesSummaryRequestError("outlet 筛选最多 50 项，且每项不能超过 100 字。");
  }
  return unique;
}

function metricsSql(productCodes: string[], platform?: SalesPlatformFilter, shop?: string, categories: string[] = [], outlets: SalesOutletFilter[] = []) {
  return `
  SELECT
    COALESCE(SUM(CASE WHEN s.allocated_amount_cents > 0 THEN s.allocated_amount_cents ELSE 0 END), 0) AS gross_sales_cents,
    COALESCE(SUM(CASE WHEN s.allocated_amount_cents < 0 THEN -s.allocated_amount_cents ELSE 0 END), 0) AS refund_amount_cents,
    COALESCE(SUM(CASE WHEN NULLIF(TRIM(s.category), '') IS NOT NULL AND TRIM(s.category) NOT IN ('配件', '赠品配件') THEN s.allocated_amount_cents ELSE 0 END), 0) AS net_sales_excluding_accessories_cents,
    COALESCE(SUM(s.cost_amount_cents), 0) AS cost_amount_cents,
    COALESCE(SUM(s.gross_profit_cents), 0) AS gross_profit_cents,
    COALESCE(SUM(CASE WHEN NULLIF(TRIM(s.category), '') IS NOT NULL AND TRIM(s.category) NOT IN ('配件', '赠品配件') AND s.product_code <> 'ERP_PRICE_ADJUSTMENT' AND TRIM(s.product_name) <> '补差价专用' THEN s.quantity ELSE 0 END), 0) AS net_quantity,
    COUNT(DISTINCT CASE
      WHEN s.order_no <> '' THEN s.order_no
      WHEN s.online_order_no <> '' THEN s.online_order_no
      ELSE s.source_line_key
    END) AS order_count,
    COUNT(*) AS line_count
  FROM sales_order_lines s
  ${SALES_CATEGORY_JOIN}
  WHERE s.ship_time >= ? AND s.ship_time < ?
    AND TRIM(s.warehouse) <> '刷刷仓'${productCodeClause(productCodes)}${outletClause(platform, shop, outlets)}${categoryClause(categories)}
`;
}

function metric(row: MetricRow | null) {
  const grossSalesCents = Number(row?.gross_sales_cents ?? 0);
  const refundAmountCents = Number(row?.refund_amount_cents ?? 0);
  const netSalesCents = grossSalesCents - refundAmountCents;
  const netSalesExcludingAccessoriesCents = Number(row?.net_sales_excluding_accessories_cents ?? 0);
  const costAmountCents = Number(row?.cost_amount_cents ?? 0);
  const grossProfitCents = Number(row?.gross_profit_cents ?? 0);
  const orderCount = Number(row?.order_count ?? 0);
  const netQuantity = Number(row?.net_quantity ?? 0);
  return {
    grossSalesCents,
    netSalesCents,
    netSalesExcludingAccessoriesCents,
    costAmountCents,
    grossProfitCents,
    refundAmountCents,
    orderCount,
    lineCount: Number(row?.line_count ?? 0),
    netQuantity,
    averageOrderValueCents: netQuantity === 0 ? 0 : netSalesExcludingAccessoriesCents / netQuantity,
    grossMarginRate: netSalesCents === 0 ? 0 : (netSalesCents - costAmountCents) / netSalesCents,
    refundRate: grossSalesCents === 0 ? 0 : refundAmountCents / grossSalesCents,
  };
}

async function groupedMetrics(
  db: SalesDatabase,
  dimension: "shop" | "channel" | "platform",
  period: Period,
  productCodes: string[],
  platform?: SalesPlatformFilter,
  shop?: string,
  categories: string[] = [],
  outlets: SalesOutletFilter[] = [],
  groupKeys: string[] = [],
) {
  const displayName = dimension === "shop"
    ? "COALESCE(NULLIF(s.shop_name, ''), NULLIF(s.channel, ''), NULLIF(s.platform, ''), '未分类')"
    : dimension === "channel"
      ? "COALESCE(NULLIF(s.channel, ''), NULLIF(s.platform, ''), '未分类')"
      : "COALESCE(NULLIF(s.platform, ''), NULLIF(s.channel, ''), '未分类')";
  // 店铺简称会在不同平台重复。网点页需要按“平台 + 店铺”分组，避免将
  // 京东、拼多多等同名店铺合并后错误归属到某一个平台。
  const groupKey = dimension === "shop"
    ? `COALESCE(NULLIF(s.platform, ''), '未分类') || char(31) || ${displayName}`
    : displayName;
  const statement = db.prepare(`
    WITH grouped AS (
    SELECT
      ${groupKey} AS group_key,
      ${displayName} AS name,
      MAX(NULLIF(s.platform, '')) AS platform,
      COALESCE(SUM(CASE WHEN s.allocated_amount_cents > 0 THEN s.allocated_amount_cents ELSE 0 END), 0) AS gross_sales_cents,
      COALESCE(SUM(CASE WHEN s.allocated_amount_cents < 0 THEN -s.allocated_amount_cents ELSE 0 END), 0) AS refund_amount_cents,
      COALESCE(SUM(CASE WHEN NULLIF(TRIM(s.category), '') IS NOT NULL AND TRIM(s.category) NOT IN ('配件', '赠品配件') THEN s.allocated_amount_cents ELSE 0 END), 0) AS net_sales_excluding_accessories_cents,
      COALESCE(SUM(s.cost_amount_cents), 0) AS cost_amount_cents,
      COALESCE(SUM(s.gross_profit_cents), 0) AS gross_profit_cents,
      COALESCE(SUM(CASE WHEN NULLIF(TRIM(s.category), '') IS NOT NULL AND TRIM(s.category) NOT IN ('配件', '赠品配件') AND s.product_code <> 'ERP_PRICE_ADJUSTMENT' AND TRIM(s.product_name) <> '补差价专用' THEN s.quantity ELSE 0 END), 0) AS net_quantity,
      COUNT(DISTINCT CASE WHEN s.order_no <> '' THEN s.order_no WHEN s.online_order_no <> '' THEN s.online_order_no ELSE s.source_line_key END) AS order_count,
      COUNT(*) AS line_count
    FROM sales_order_lines s
    ${SALES_CATEGORY_JOIN}
    WHERE s.ship_time >= ? AND s.ship_time < ?
      AND TRIM(s.warehouse) <> '刷刷仓'${productCodeClause(productCodes)}${outletClause(platform, shop, outlets)}${categoryClause(categories)}
    GROUP BY ${groupKey}
    )
    SELECT grouped.*,
      COUNT(*) OVER () AS total_count,
      SUM(gross_sales_cents - refund_amount_cents) OVER () AS total_net_sales_cents
    FROM grouped
    ${groupKeys.length ? "WHERE group_key IN (SELECT CAST(value AS TEXT) FROM json_each(?))" : ""}
    ORDER BY (gross_sales_cents - refund_amount_cents) DESC,
      name COLLATE BINARY ASC, group_key COLLATE BINARY ASC
    LIMIT ${MAX_SALES_GROUP_ROWS + 1}
  `);
  const result = await bindPeriod(
    statement,
    period.startDate,
    period.endDate,
    productCodes,
    platform,
    shop,
    categories,
    outlets,
    groupKeys.length ? [JSON.stringify(groupKeys)] : [],
  ).all<GroupRow>();
  const groupedRows = result.results.slice(0, MAX_SALES_GROUP_ROWS);
  const totalNet = Number(result.results[0]?.total_net_sales_cents ?? 0);

  const items = groupedRows.map((row) => {
    const values = metric(row);
    return {
      groupKey: row.group_key,
      name: row.name,
      platform: row.platform || (dimension === "platform" ? row.name : "未分类"),
      ...values,
      shareRate: totalNet === 0 ? 0 : values.netSalesCents / totalNet,
    };
  });
  const total = Number(result.results[0]?.total_count ?? 0);
  return {
    items,
    pagination: {
      total,
      returned: items.length,
      truncated: result.results.length > MAX_SALES_GROUP_ROWS,
    },
  };
}

async function groupedMetricsWithYearOverYear(
  db: SalesDatabase,
  dimension: "shop" | "channel" | "platform",
  period: Period,
  yearAgoPeriod: Pick<Period, "startDate" | "endDate">,
  productCodes: string[],
  platform?: SalesPlatformFilter,
  shop?: string,
  categories: string[] = [],
  outlets: SalesOutletFilter[] = [],
) {
  const current = await groupedMetrics(db, dimension, period, productCodes, platform, shop, categories, outlets);
  const yearAgo = await groupedMetrics(
    db,
    dimension,
    yearAgoPeriod,
    productCodes,
    platform,
    shop,
    categories,
    outlets,
    current.items.map((item) => item.groupKey),
  );
  const yearAgoByGroupKey = new Map(yearAgo.items.map((item) => [item.groupKey, item]));

  return {
    items: current.items.map((item) => {
    const yearAgoNetSalesCents = yearAgoByGroupKey.get(item.groupKey)?.netSalesCents ?? 0;
    return {
      ...item,
      yearAgoNetSalesCents,
      salesYearOverYearRate: yearAgoNetSalesCents === 0
        ? null
        : (item.netSalesCents - yearAgoNetSalesCents) / Math.abs(yearAgoNetSalesCents),
    };
    }),
    pagination: current.pagination,
  };
}

async function dailyMetrics(
  db: SalesDatabase,
  period: Pick<Period, "startDate" | "endDate">,
  productCodes: string[],
  platform?: SalesPlatformFilter,
  shop?: string,
  categories: string[] = [],
  outlets: SalesOutletFilter[] = [],
) {
  const dailyResult = await bindPeriod(
    db.prepare(`
      SELECT
        substr(s.ship_time, 1, 10) AS date,
        COALESCE(SUM(CASE WHEN s.allocated_amount_cents > 0 THEN s.allocated_amount_cents ELSE 0 END), 0) AS gross_sales_cents,
        COALESCE(SUM(CASE WHEN s.allocated_amount_cents < 0 THEN -s.allocated_amount_cents ELSE 0 END), 0) AS refund_amount_cents,
        COALESCE(SUM(CASE WHEN NULLIF(TRIM(s.category), '') IS NOT NULL AND TRIM(s.category) NOT IN ('配件', '赠品配件') THEN s.allocated_amount_cents ELSE 0 END), 0) AS net_sales_excluding_accessories_cents,
        COALESCE(SUM(s.cost_amount_cents), 0) AS cost_amount_cents,
        COALESCE(SUM(s.gross_profit_cents), 0) AS gross_profit_cents,
        COALESCE(SUM(CASE WHEN NULLIF(TRIM(s.category), '') IS NOT NULL AND TRIM(s.category) NOT IN ('配件', '赠品配件') AND s.product_code <> 'ERP_PRICE_ADJUSTMENT' AND TRIM(s.product_name) <> '补差价专用' THEN s.quantity ELSE 0 END), 0) AS net_quantity,
        COUNT(DISTINCT CASE WHEN s.order_no <> '' THEN s.order_no WHEN s.online_order_no <> '' THEN s.online_order_no ELSE s.source_line_key END) AS order_count,
        COUNT(*) AS line_count
      FROM sales_order_lines s
      ${SALES_CATEGORY_JOIN}
      WHERE s.ship_time >= ? AND s.ship_time < ?
        AND TRIM(s.warehouse) <> '刷刷仓'${productCodeClause(productCodes)}${outletClause(platform, shop, outlets)}${categoryClause(categories)}
      GROUP BY date
      ORDER BY date ASC
    `),
    period.startDate,
    period.endDate,
    productCodes,
    platform,
    shop,
    categories,
    outlets,
  ).all<DailyRow>();
  return dailyResult.results.map((row) => ({ date: row.date, ...metric(row) }));
}

async function filterOptions(
  db: SalesDatabase,
  period: Pick<Period, "startDate" | "endDate">,
  productCodes: string[],
) {
  const shopName = "COALESCE(NULLIF(s.shop_name, ''), NULLIF(s.channel, ''), NULLIF(s.platform, ''), '未分类')";
  const categoryOptions = productCodes.length === 0
    ? bindPeriod(db.prepare(`
        WITH available_categories AS (
          SELECT TRIM(category) AS category
          FROM erp_product_master
          WHERE NULLIF(TRIM(category), '') IS NOT NULL
          UNION
          SELECT ${SALES_CATEGORY_EXPRESSION} AS category
          FROM sales_order_lines s
          ${SALES_CATEGORY_JOIN}
          WHERE s.ship_time >= ? AND s.ship_time < ?
            AND TRIM(s.warehouse) <> '刷刷仓'
        )
        SELECT category
        FROM available_categories
        ORDER BY category COLLATE BINARY ASC
        LIMIT 200
      `), period.startDate, period.endDate).all<FilterCategoryRow>()
    : bindPeriod(
        db.prepare(`
          SELECT ${SALES_CATEGORY_EXPRESSION} AS category
          FROM sales_order_lines s
          ${SALES_CATEGORY_JOIN}
          WHERE s.ship_time >= ? AND s.ship_time < ?
            AND TRIM(s.warehouse) <> '刷刷仓'${productCodeClause(productCodes)}
          GROUP BY ${SALES_CATEGORY_EXPRESSION}
          ORDER BY ${SALES_CATEGORY_EXPRESSION} COLLATE BINARY ASC
          LIMIT 200
        `),
        period.startDate,
        period.endDate,
        productCodes,
      ).all<FilterCategoryRow>();
  const [shops, categories, platforms] = await Promise.all([
    bindPeriod(
      db.prepare(`
        SELECT
          COALESCE(NULLIF(s.platform, ''), '未分类') || char(31) || ${shopName} AS option_key,
          ${shopName} AS name,
          MAX(NULLIF(s.platform, '')) AS platform
        FROM sales_order_lines s
        WHERE s.ship_time >= ? AND s.ship_time < ?
          AND TRIM(s.warehouse) <> '刷刷仓'${productCodeClause(productCodes)}
        GROUP BY COALESCE(NULLIF(s.platform, ''), '未分类'), ${shopName}
        ORDER BY COALESCE(NULLIF(s.platform, ''), '未分类') COLLATE BINARY ASC,
          name COLLATE BINARY ASC
        LIMIT 500
      `),
      period.startDate,
      period.endDate,
      productCodes,
    ).all<FilterShopRow>(),
    categoryOptions,
    bindPeriod(
      db.prepare(`
        SELECT COALESCE(NULLIF(s.platform, ''), '未分类') AS platform
        FROM sales_order_lines s
        WHERE s.ship_time >= ? AND s.ship_time < ?
          AND TRIM(s.warehouse) <> '刷刷仓'${productCodeClause(productCodes)}
        GROUP BY COALESCE(NULLIF(s.platform, ''), '未分类')
        ORDER BY platform COLLATE BINARY ASC
        LIMIT 200
      `),
      period.startDate,
      period.endDate,
      productCodes,
    ).all<FilterPlatformRow>(),
  ]);
  return {
    shops: shops.results.map((item) => ({
      key: item.option_key,
      name: item.name,
      platform: item.platform || "未分类",
    })),
    platforms: platforms.results.map((item) => item.platform),
    categories: categories.results.map((item) => item.category),
  };
}

async function latestSalesDataDate(db: SalesDatabase) {
  const row = await db.prepare(
    `SELECT substr(ship_time, 1, 10) AS end_date
     FROM sales_order_lines
     WHERE TRIM(warehouse) <> '刷刷仓'
     ORDER BY ship_time DESC
     LIMIT 1`,
  ).first<{ end_date: string | null }>();
  return row?.end_date ?? null;
}

export async function getSalesSummary(
  db: SalesDatabase,
  input: { range: SalesRange; projection?: SalesSummaryProjection; startDate?: string; endDate?: string; productQueries?: string[]; productCodes?: string[]; platform?: string; platforms?: string[]; shop?: string; outlets?: SalesOutletFilter[]; categories?: string[] },
) {
  const dashboardProjection = input.projection === "dashboard";
  const today = shanghaiToday();
  let productQueries: string[];
  try {
    productQueries = parseProductQueriesStrict(input.productQueries ?? input.productCodes ?? []);
  } catch (error) {
    throw new SalesSummaryRequestError(error instanceof Error ? error.message : "商品筛选无效");
  }
  const [resolvedProductCodes, dataCutoffDate] = await Promise.all([
    resolveProductFilterCodes(db, productQueries),
    latestSalesDataDate(db),
  ]);
  const productCodes = normalizeProductCodes(resolvedProductCodes);
  const categories = normalizeCategories(input.categories);
  const platforms = normalizePlatforms([
    ...(input.platforms ?? []),
    ...(input.platform ? [input.platform] : []),
  ]);
  const platform: SalesPlatformFilter | undefined = platforms.length > 0 ? platforms : undefined;
  const shop = input.shop?.trim() || undefined;
  const outletFilters = normalizeOutlets(input.outlets);
  let requestedPeriod: Period;

  if (input.range === "all") {
    const bounds = await db
      .prepare(
        `SELECT MIN(substr(s.ship_time, 1, 10)) AS start_date, MAX(substr(s.ship_time, 1, 10)) AS end_date
         FROM sales_order_lines s
         ${SALES_CATEGORY_JOIN}
         WHERE TRIM(s.warehouse) <> '刷刷仓'${productCodeClause(productCodes)}${outletClause(platform, shop, outletFilters)}${categoryClause(categories)}`,
      )
      .bind(
        ...(productCodes.length > 0 ? [JSON.stringify(productCodes)] : []),
        ...outletBindings(platform, shop, outletFilters),
        ...(categories.length > 0 ? [JSON.stringify(categories)] : []),
      )
      .first<{ start_date: string | null; end_date: string | null }>();
    requestedPeriod = {
      startDate: bounds?.start_date ?? today,
      endDate: bounds?.end_date ?? today,
    };
  } else if (input.range === "custom") {
    requestedPeriod = customPeriod(input.startDate ?? "", input.endDate ?? "");
  } else {
    requestedPeriod = periodFor(input.range, today);
  }
  const alignment = alignSalesSummaryPeriodToDataCutoff(input.range, requestedPeriod, dataCutoffDate);
  const period = alignment.period;

  const currentPromise = bindPeriod(
    db.prepare(metricsSql(productCodes, platform, shop, categories, outletFilters)),
    period.startDate,
    period.endDate,
    productCodes,
    platform,
    shop,
    categories,
    outletFilters,
  ).first<MetricRow>();
  const previousPromise = period.previousStartDate && period.previousEndDate
    ? bindPeriod(
      db.prepare(metricsSql(productCodes, platform, shop, categories, outletFilters)),
      period.previousStartDate,
      period.previousEndDate,
      productCodes,
      platform,
      shop,
      categories,
      outletFilters,
    ).first<MetricRow>()
    : null;
  const yearAgoPeriod = {
    startDate: addYears(period.startDate, -1),
    endDate: addYears(period.endDate, -1),
  };
  const yearAgoPromise = bindPeriod(
    db.prepare(metricsSql(productCodes, platform, shop, categories, outletFilters)),
    yearAgoPeriod.startDate,
    yearAgoPeriod.endDate,
    productCodes,
    platform,
    shop,
    categories,
    outletFilters,
  ).first<MetricRow>();
  const previousPeriod = period.previousStartDate && period.previousEndDate
    ? { startDate: period.previousStartDate, endDate: period.previousEndDate }
    : null;
  const trendTruncated = dayDifference(period.startDate, period.endDate) + 1 > MAX_SALES_TREND_DAYS;
  const trendPeriod = trendTruncated
    ? { startDate: addDays(period.endDate, -(MAX_SALES_TREND_DAYS - 1)), endDate: period.endDate }
    : { startDate: period.startDate, endDate: period.endDate };
  const previousTrendPeriod = previousPeriod
    ? { startDate: previousPeriod.startDate, endDate: previousPeriod.endDate }
    : null;
  const yearAgoTrendPeriod = {
    startDate: addYears(trendPeriod.startDate, -1),
    endDate: addYears(trendPeriod.endDate, -1),
  };
  const extendedResultPromise = dashboardProjection
    ? Promise.resolve(null)
    : Promise.all([
      groupedMetricsWithYearOverYear(db, "channel", period, yearAgoPeriod, productCodes, platform, shop, categories, outletFilters),
      groupedMetricsWithYearOverYear(db, "platform", period, yearAgoPeriod, productCodes, platform, shop, categories, outletFilters),
      previousTrendPeriod ? dailyMetrics(db, previousTrendPeriod, productCodes, platform, shop, categories, outletFilters) : Promise.resolve([]),
      dailyMetrics(db, yearAgoTrendPeriod, productCodes, platform, shop, categories, outletFilters),
      filterOptions(db, period, productCodes),
    ] as const);
  const [currentRow, previousRow, yearAgoRow, outletResult, daily, latestBatch, extendedResult] = await Promise.all([
    currentPromise,
    previousPromise,
    yearAgoPromise,
    groupedMetricsWithYearOverYear(db, "shop", period, yearAgoPeriod, productCodes, platform, shop, categories, outletFilters),
    dailyMetrics(db, trendPeriod, productCodes, platform, shop, categories, outletFilters),
    findLatestSalesImportBatch(db),
    extendedResultPromise,
  ]);
  const channelResult = extendedResult?.[0] ?? { items: [], pagination: { total: 0, returned: 0, truncated: false } };
  const platformResult = extendedResult?.[1] ?? { items: [], pagination: { total: 0, returned: 0, truncated: false } };
  const previousDaily = extendedResult?.[2] ?? [];
  const yearAgoDaily = extendedResult?.[3] ?? [];
  const filterOptionsData = extendedResult?.[4] ?? { shops: [], platforms: [], categories: [] };

  return {
    projection: dashboardProjection ? "dashboard" as const : "full" as const,
    range: input.range,
    filters: {
      productQueries,
      productCodes,
      platform: platforms.length === 1 ? platforms[0] : null,
      platforms,
      shop: shop ?? null,
      outlets: outletFilters,
      categories,
    },
    filterOptions: filterOptionsData,
    ...period,
    requestedStartDate: requestedPeriod.startDate,
    requestedEndDate: requestedPeriod.endDate,
    dataCutoffDate,
    periodAdjustedToDataCutoff: alignment.adjusted,
    comparisonDayCount: dayDifference(period.startDate, period.endDate) + 1,
    current: metric(currentRow),
    ...(previousRow ? { previous: metric(previousRow) } : {}),
    yearAgo: metric(yearAgoRow),
    yearAgoStartDate: yearAgoPeriod.startDate,
    yearAgoEndDate: yearAgoPeriod.endDate,
    channels: platformResult.items,
    outlets: outletResult.items,
    shops: channelResult.items,
    platforms: platformResult.items,
    groupPagination: {
      outlets: outletResult.pagination,
      shops: channelResult.pagination,
      platforms: platformResult.pagination,
    },
    daily,
    previousDaily,
    yearAgoDaily,
    trendStartDate: trendPeriod.startDate,
    trendEndDate: trendPeriod.endDate,
    trendReturned: daily.length,
    trendTruncated,
    latestBatch,
  };
}
