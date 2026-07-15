import {
  findLatestSalesImportBatch,
  type SalesDatabase,
} from "@/lib/sales/database";

export const salesRanges = ["today", "yesterday", "last7", "last15", "month", "quarter", "custom", "all"] as const;
export type SalesRange = (typeof salesRanges)[number];

type Period = {
  startDate: string;
  endDate: string;
  previousStartDate?: string;
  previousEndDate?: string;
};

type MetricRow = {
  gross_sales_cents: number | null;
  refund_amount_cents: number | null;
  net_sales_excluding_accessories_cents: number | null;
  gross_profit_cents: number | null;
  net_quantity: number | null;
  order_count: number;
  line_count: number;
};

type GroupRow = MetricRow & { group_key: string; name: string; platform: string | null };
type DailyRow = MetricRow & { date: string };

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

function periodFor(range: Exclude<SalesRange, "all" | "custom">, today: string): Period {
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
      previousEndDate: addDays(previousStartDate, dayDifference(startDate, today)),
    };
  }

  const quarterMonth = Math.floor((month - 1) / 3) * 3 + 1;
  const startDate = `${year.toString().padStart(4, "0")}-${quarterMonth.toString().padStart(2, "0")}-01`;
  const previousStartDate = addMonths(startDate, -3);
  return {
    startDate,
    endDate: today,
    previousStartDate,
    previousEndDate: addDays(previousStartDate, dayDifference(startDate, today)),
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
  platform?: string,
  shop?: string,
) {
  return statement.bind(
    startDate,
    addDays(endDate, 1),
    ...productCodes,
    ...(platform ? [platform] : []),
    ...(shop ? [shop] : []),
  );
}

function productCodeClause(productCodes: string[]) {
  return productCodes.length > 0 ? ` AND product_code IN (${productCodes.map(() => "?").join(", ")})` : "";
}

function outletClause(platform?: string, shop?: string) {
  return `${platform ? " AND COALESCE(NULLIF(platform, ''), '未分类') = ?" : ""}${shop ? " AND COALESCE(NULLIF(shop_name, ''), NULLIF(channel, ''), NULLIF(platform, ''), '未分类') = ?" : ""}`;
}

function normalizeProductCodes(values: string[] | undefined) {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))].slice(0, 100);
}

function metricsSql(productCodes: string[], platform?: string, shop?: string) {
  return `
  SELECT
    COALESCE(SUM(CASE WHEN allocated_amount_cents > 0 THEN allocated_amount_cents ELSE 0 END), 0) AS gross_sales_cents,
    COALESCE(SUM(CASE WHEN allocated_amount_cents < 0 THEN -allocated_amount_cents ELSE 0 END), 0) AS refund_amount_cents,
    COALESCE(SUM(CASE WHEN NULLIF(TRIM(category), '') IS NOT NULL AND TRIM(category) NOT IN ('配件', '赠品配件') THEN allocated_amount_cents ELSE 0 END), 0) AS net_sales_excluding_accessories_cents,
    COALESCE(SUM(gross_profit_cents), 0) AS gross_profit_cents,
    COALESCE(SUM(CASE WHEN NULLIF(TRIM(category), '') IS NOT NULL AND TRIM(category) NOT IN ('配件', '赠品配件') AND product_code <> 'ERP_PRICE_ADJUSTMENT' AND TRIM(product_name) <> '补差价专用' THEN quantity ELSE 0 END), 0) AS net_quantity,
    COUNT(DISTINCT CASE
      WHEN order_no <> '' THEN order_no
      WHEN online_order_no <> '' THEN online_order_no
      ELSE source_line_key
    END) AS order_count,
    COUNT(*) AS line_count
  FROM sales_order_lines
  WHERE ship_time >= ? AND ship_time < ?
    AND TRIM(warehouse) <> '刷刷仓'${productCodeClause(productCodes)}${outletClause(platform, shop)}
`;
}

function metric(row: MetricRow | null) {
  const grossSalesCents = Number(row?.gross_sales_cents ?? 0);
  const refundAmountCents = Number(row?.refund_amount_cents ?? 0);
  const netSalesCents = grossSalesCents - refundAmountCents;
  const netSalesExcludingAccessoriesCents = Number(row?.net_sales_excluding_accessories_cents ?? 0);
  const grossProfitCents = Number(row?.gross_profit_cents ?? 0);
  const orderCount = Number(row?.order_count ?? 0);
  const netQuantity = Number(row?.net_quantity ?? 0);
  return {
    grossSalesCents,
    netSalesCents,
    netSalesExcludingAccessoriesCents,
    grossProfitCents,
    refundAmountCents,
    orderCount,
    lineCount: Number(row?.line_count ?? 0),
    netQuantity,
    averageOrderValueCents: netQuantity === 0 ? 0 : netSalesExcludingAccessoriesCents / netQuantity,
    grossMarginRate: netSalesCents === 0 ? 0 : grossProfitCents / netSalesCents,
    refundRate: grossSalesCents === 0 ? 0 : refundAmountCents / grossSalesCents,
  };
}

async function groupedMetrics(
  db: SalesDatabase,
  dimension: "shop" | "channel" | "platform",
  period: Period,
  productCodes: string[],
  platform?: string,
  shop?: string,
) {
  const displayName = dimension === "shop"
    ? "COALESCE(NULLIF(shop_name, ''), NULLIF(channel, ''), NULLIF(platform, ''), '未分类')"
    : dimension === "channel"
      ? "COALESCE(NULLIF(channel, ''), NULLIF(platform, ''), '未分类')"
      : "COALESCE(NULLIF(platform, ''), NULLIF(channel, ''), '未分类')";
  // 店铺简称会在不同平台重复。网点页需要按“平台 + 店铺”分组，避免将
  // 京东、拼多多等同名店铺合并后错误归属到某一个平台。
  const groupKey = dimension === "shop"
    ? `COALESCE(NULLIF(platform, ''), '未分类') || char(31) || ${displayName}`
    : displayName;
  const statement = db.prepare(`
    SELECT
      ${groupKey} AS group_key,
      ${displayName} AS name,
      MAX(NULLIF(platform, '')) AS platform,
      COALESCE(SUM(CASE WHEN allocated_amount_cents > 0 THEN allocated_amount_cents ELSE 0 END), 0) AS gross_sales_cents,
      COALESCE(SUM(CASE WHEN allocated_amount_cents < 0 THEN -allocated_amount_cents ELSE 0 END), 0) AS refund_amount_cents,
      COALESCE(SUM(CASE WHEN NULLIF(TRIM(category), '') IS NOT NULL AND TRIM(category) NOT IN ('配件', '赠品配件') THEN allocated_amount_cents ELSE 0 END), 0) AS net_sales_excluding_accessories_cents,
      COALESCE(SUM(gross_profit_cents), 0) AS gross_profit_cents,
      COALESCE(SUM(CASE WHEN NULLIF(TRIM(category), '') IS NOT NULL AND TRIM(category) NOT IN ('配件', '赠品配件') AND product_code <> 'ERP_PRICE_ADJUSTMENT' AND TRIM(product_name) <> '补差价专用' THEN quantity ELSE 0 END), 0) AS net_quantity,
      COUNT(DISTINCT CASE WHEN order_no <> '' THEN order_no WHEN online_order_no <> '' THEN online_order_no ELSE source_line_key END) AS order_count,
      COUNT(*) AS line_count
    FROM sales_order_lines
    WHERE ship_time >= ? AND ship_time < ?
      AND TRIM(warehouse) <> '刷刷仓'${productCodeClause(productCodes)}${outletClause(platform, shop)}
    GROUP BY ${groupKey}
    ORDER BY (gross_sales_cents - refund_amount_cents) DESC, name ASC
  `);
  const result = await bindPeriod(statement, period.startDate, period.endDate, productCodes, platform, shop).all<GroupRow>();
  const groupedRows = result.results;
  const totalNet = groupedRows.reduce(
    (sum, row) => sum + Number(row.gross_sales_cents ?? 0) - Number(row.refund_amount_cents ?? 0),
    0,
  );

  return groupedRows.map((row) => {
    const values = metric(row);
    return {
      groupKey: row.group_key,
      name: row.name,
      platform: row.platform || (dimension === "platform" ? row.name : "未分类"),
      ...values,
      shareRate: totalNet === 0 ? 0 : values.netSalesCents / totalNet,
    };
  });
}

async function groupedMetricsWithYearOverYear(
  db: SalesDatabase,
  dimension: "shop" | "channel" | "platform",
  period: Period,
  yearAgoPeriod: Pick<Period, "startDate" | "endDate">,
  productCodes: string[],
  platform?: string,
  shop?: string,
) {
  const [current, yearAgo] = await Promise.all([
    groupedMetrics(db, dimension, period, productCodes, platform, shop),
    groupedMetrics(db, dimension, yearAgoPeriod, productCodes, platform, shop),
  ]);
  const yearAgoByGroupKey = new Map(yearAgo.map((item) => [item.groupKey, item]));

  return current.map((item) => {
    const yearAgoNetSalesCents = yearAgoByGroupKey.get(item.groupKey)?.netSalesCents ?? 0;
    return {
      ...item,
      yearAgoNetSalesCents,
      salesYearOverYearRate: yearAgoNetSalesCents === 0
        ? null
        : (item.netSalesCents - yearAgoNetSalesCents) / Math.abs(yearAgoNetSalesCents),
    };
  });
}

async function dailyMetrics(
  db: SalesDatabase,
  period: Pick<Period, "startDate" | "endDate">,
  productCodes: string[],
  platform?: string,
  shop?: string,
) {
  const dailyResult = await bindPeriod(
    db.prepare(`
      SELECT
        substr(ship_time, 1, 10) AS date,
        COALESCE(SUM(CASE WHEN allocated_amount_cents > 0 THEN allocated_amount_cents ELSE 0 END), 0) AS gross_sales_cents,
        COALESCE(SUM(CASE WHEN allocated_amount_cents < 0 THEN -allocated_amount_cents ELSE 0 END), 0) AS refund_amount_cents,
        COALESCE(SUM(CASE WHEN NULLIF(TRIM(category), '') IS NOT NULL AND TRIM(category) NOT IN ('配件', '赠品配件') THEN allocated_amount_cents ELSE 0 END), 0) AS net_sales_excluding_accessories_cents,
        COALESCE(SUM(gross_profit_cents), 0) AS gross_profit_cents,
        COALESCE(SUM(CASE WHEN NULLIF(TRIM(category), '') IS NOT NULL AND TRIM(category) NOT IN ('配件', '赠品配件') AND product_code <> 'ERP_PRICE_ADJUSTMENT' AND TRIM(product_name) <> '补差价专用' THEN quantity ELSE 0 END), 0) AS net_quantity,
        COUNT(DISTINCT CASE WHEN order_no <> '' THEN order_no WHEN online_order_no <> '' THEN online_order_no ELSE source_line_key END) AS order_count,
        COUNT(*) AS line_count
      FROM sales_order_lines
      WHERE ship_time >= ? AND ship_time < ?
        AND TRIM(warehouse) <> '刷刷仓'${productCodeClause(productCodes)}${outletClause(platform, shop)}
      GROUP BY date
      ORDER BY date ASC
    `),
    period.startDate,
    period.endDate,
    productCodes,
    platform,
    shop,
  ).all<DailyRow>();
  return dailyResult.results.map((row) => ({ date: row.date, ...metric(row) }));
}

export async function getSalesSummary(
  db: SalesDatabase,
  input: { range: SalesRange; startDate?: string; endDate?: string; productCodes?: string[]; platform?: string; shop?: string },
) {
  const today = shanghaiToday();
  const productCodes = normalizeProductCodes(input.productCodes);
  const platform = input.platform?.trim() || undefined;
  const shop = input.shop?.trim() || undefined;
  let period: Period;

  if (input.range === "all") {
    const bounds = await db
      .prepare(
        `SELECT MIN(substr(ship_time, 1, 10)) AS start_date, MAX(substr(ship_time, 1, 10)) AS end_date
         FROM sales_order_lines
         WHERE TRIM(warehouse) <> '刷刷仓'${productCodeClause(productCodes)}${outletClause(platform, shop)}`,
      )
      .bind(...productCodes, ...(platform ? [platform] : []), ...(shop ? [shop] : []))
      .first<{ start_date: string | null; end_date: string | null }>();
    period = {
      startDate: bounds?.start_date ?? today,
      endDate: bounds?.end_date ?? today,
    };
  } else if (input.range === "custom") {
    period = customPeriod(input.startDate ?? "", input.endDate ?? "");
  } else {
    period = periodFor(input.range, today);
  }

  const currentRow = await bindPeriod(
    db.prepare(metricsSql(productCodes, platform, shop)),
    period.startDate,
    period.endDate,
    productCodes,
    platform,
    shop,
  ).first<MetricRow>();
  const previousRow = period.previousStartDate && period.previousEndDate
    ? await bindPeriod(
      db.prepare(metricsSql(productCodes, platform, shop)),
      period.previousStartDate,
      period.previousEndDate,
      productCodes,
      platform,
      shop,
    ).first<MetricRow>()
    : null;
  const yearAgoPeriod = {
    startDate: addYears(period.startDate, -1),
    endDate: addYears(period.endDate, -1),
  };
  const yearAgoRow = await bindPeriod(
    db.prepare(metricsSql(productCodes, platform, shop)),
    yearAgoPeriod.startDate,
    yearAgoPeriod.endDate,
    productCodes,
    platform,
    shop,
  ).first<MetricRow>();
  const previousPeriod = period.previousStartDate && period.previousEndDate
    ? { startDate: period.previousStartDate, endDate: period.previousEndDate }
    : null;
  const [outlets, shops, platforms, daily, previousDaily, yearAgoDaily] = await Promise.all([
    groupedMetricsWithYearOverYear(db, "shop", period, yearAgoPeriod, productCodes, platform, shop),
    groupedMetricsWithYearOverYear(db, "channel", period, yearAgoPeriod, productCodes, platform, shop),
    groupedMetricsWithYearOverYear(db, "platform", period, yearAgoPeriod, productCodes, platform, shop),
    dailyMetrics(db, period, productCodes, platform, shop),
    previousPeriod ? dailyMetrics(db, previousPeriod, productCodes, platform, shop) : Promise.resolve([]),
    dailyMetrics(db, yearAgoPeriod, productCodes, platform, shop),
  ]);
  const latestBatch = await findLatestSalesImportBatch(db);

  return {
    range: input.range,
    filters: { productCodes, platform: platform ?? null, shop: shop ?? null },
    ...period,
    current: metric(currentRow),
    ...(previousRow ? { previous: metric(previousRow) } : {}),
    yearAgo: metric(yearAgoRow),
    yearAgoStartDate: yearAgoPeriod.startDate,
    yearAgoEndDate: yearAgoPeriod.endDate,
    channels: platforms,
    outlets,
    shops,
    platforms,
    daily,
    previousDaily,
    yearAgoDaily,
    latestBatch,
  };
}
