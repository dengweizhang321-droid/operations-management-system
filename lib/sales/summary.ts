import {
  findLatestSalesImportBatch,
  type SalesDatabase,
} from "@/lib/sales/database";

export const salesRanges = ["today", "last7", "month", "quarter", "custom", "all"] as const;
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

type GroupRow = MetricRow & { name: string };
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

  if (range === "last7") {
    return {
      startDate: addDays(today, -6),
      endDate: today,
      previousStartDate: addDays(today, -13),
      previousEndDate: addDays(today, -7),
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
) {
  return statement.bind(startDate, addDays(endDate, 1));
}

const metricsSql = `
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
  WHERE sales_time >= ? AND sales_time < ?
`;

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
  dimension: "channel" | "platform",
  period: Period,
) {
  const fallback = dimension === "channel" ? "platform" : "channel";
  const statement = db.prepare(`
    SELECT
      COALESCE(NULLIF(${dimension}, ''), NULLIF(${fallback}, ''), '未分类') AS name,
      COALESCE(SUM(CASE WHEN allocated_amount_cents > 0 THEN allocated_amount_cents ELSE 0 END), 0) AS gross_sales_cents,
      COALESCE(SUM(CASE WHEN allocated_amount_cents < 0 THEN -allocated_amount_cents ELSE 0 END), 0) AS refund_amount_cents,
      COALESCE(SUM(CASE WHEN NULLIF(TRIM(category), '') IS NOT NULL AND TRIM(category) NOT IN ('配件', '赠品配件') THEN allocated_amount_cents ELSE 0 END), 0) AS net_sales_excluding_accessories_cents,
      COALESCE(SUM(gross_profit_cents), 0) AS gross_profit_cents,
      COALESCE(SUM(CASE WHEN NULLIF(TRIM(category), '') IS NOT NULL AND TRIM(category) NOT IN ('配件', '赠品配件') AND product_code <> 'ERP_PRICE_ADJUSTMENT' AND TRIM(product_name) <> '补差价专用' THEN quantity ELSE 0 END), 0) AS net_quantity,
      COUNT(DISTINCT CASE WHEN order_no <> '' THEN order_no WHEN online_order_no <> '' THEN online_order_no ELSE source_line_key END) AS order_count,
      COUNT(*) AS line_count
    FROM sales_order_lines
    WHERE sales_time >= ? AND sales_time < ?
    GROUP BY name
    ORDER BY (gross_sales_cents - refund_amount_cents) DESC, name ASC
  `);
  const result = await bindPeriod(statement, period.startDate, period.endDate).all<GroupRow>();
  const groupedRows = result.results;
  const totalNet = groupedRows.reduce(
    (sum, row) => sum + Number(row.gross_sales_cents ?? 0) - Number(row.refund_amount_cents ?? 0),
    0,
  );

  return groupedRows.map((row) => {
    const values = metric(row);
    return {
      name: row.name,
      ...values,
      shareRate: totalNet === 0 ? 0 : values.netSalesCents / totalNet,
    };
  });
}

export async function getSalesSummary(
  db: SalesDatabase,
  input: { range: SalesRange; startDate?: string; endDate?: string },
) {
  const today = shanghaiToday();
  let period: Period;

  if (input.range === "all") {
    const bounds = await db
      .prepare(
        "SELECT MIN(substr(sales_time, 1, 10)) AS start_date, MAX(substr(sales_time, 1, 10)) AS end_date FROM sales_order_lines",
      )
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
    db.prepare(metricsSql),
    period.startDate,
    period.endDate,
  ).first<MetricRow>();
  const previousRow = period.previousStartDate && period.previousEndDate
    ? await bindPeriod(
      db.prepare(metricsSql),
      period.previousStartDate,
      period.previousEndDate,
    ).first<MetricRow>()
    : null;
  const yearAgoPeriod = {
    startDate: addYears(period.startDate, -1),
    endDate: addYears(period.endDate, -1),
  };
  const yearAgoRow = await bindPeriod(
    db.prepare(metricsSql),
    yearAgoPeriod.startDate,
    yearAgoPeriod.endDate,
  ).first<MetricRow>();
  const shops = await groupedMetrics(db, "channel", period);
  const platforms = await groupedMetrics(db, "platform", period);
  const dailyResult = await bindPeriod(
    db.prepare(`
      SELECT
        substr(sales_time, 1, 10) AS date,
        COALESCE(SUM(CASE WHEN allocated_amount_cents > 0 THEN allocated_amount_cents ELSE 0 END), 0) AS gross_sales_cents,
        COALESCE(SUM(CASE WHEN allocated_amount_cents < 0 THEN -allocated_amount_cents ELSE 0 END), 0) AS refund_amount_cents,
        COALESCE(SUM(CASE WHEN NULLIF(TRIM(category), '') IS NOT NULL AND TRIM(category) NOT IN ('配件', '赠品配件') THEN allocated_amount_cents ELSE 0 END), 0) AS net_sales_excluding_accessories_cents,
        COALESCE(SUM(gross_profit_cents), 0) AS gross_profit_cents,
        COALESCE(SUM(CASE WHEN NULLIF(TRIM(category), '') IS NOT NULL AND TRIM(category) NOT IN ('配件', '赠品配件') AND product_code <> 'ERP_PRICE_ADJUSTMENT' AND TRIM(product_name) <> '补差价专用' THEN quantity ELSE 0 END), 0) AS net_quantity,
        COUNT(DISTINCT CASE WHEN order_no <> '' THEN order_no WHEN online_order_no <> '' THEN online_order_no ELSE source_line_key END) AS order_count,
        COUNT(*) AS line_count
      FROM sales_order_lines
      WHERE sales_time >= ? AND sales_time < ?
      GROUP BY date
      ORDER BY date ASC
    `),
    period.startDate,
    period.endDate,
  ).all<DailyRow>();
  const latestBatch = await findLatestSalesImportBatch(db);

  return {
    range: input.range,
    ...period,
    current: metric(currentRow),
    ...(previousRow ? { previous: metric(previousRow) } : {}),
    yearAgo: metric(yearAgoRow),
    yearAgoStartDate: yearAgoPeriod.startDate,
    yearAgoEndDate: yearAgoPeriod.endDate,
    channels: platforms,
    shops,
    platforms,
    daily: dailyResult.results.map((row) => ({ date: row.date, ...metric(row) })),
    latestBatch,
  };
}
