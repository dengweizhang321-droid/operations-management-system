import type { FinanceDatabase } from "./database";
import type { FinanceTarget } from "./types";

type FinanceMonthRow = {
  month: string;
  source_file_name: string;
  imported_at: string;
  shop_count: number;
  subject_count: number;
};

type FinanceLineRow = {
  month: string;
  metric_key: string;
  subject_name: string;
  scope_name: string;
  group_name: string;
  amount_cents: number | null;
  rate_bps: number | null;
  sort_order: number;
};

type TargetRow = {
  id: string;
  period_type: FinanceTarget["periodType"];
  period_key: string;
  shop_name: string;
  category: string;
  manager: string;
  sales_target_cents: number;
  profit_target_cents: number;
  small_margin_bps: number;
  inventory_cleanup_target_cents: number;
  promotion_fee_ratio_bps: number;
  stagnant_inventory_target_cents: number;
  created_at: string;
  updated_at: string;
};

export type FinanceActualMetrics = {
  grossSalesCents: number;
  returnAmountCents: number;
  netSalesCents: number;
  netCostCents: number;
  grossProfitCents: number;
  grossMarginBps: number;
  sellingExpenseCents: number;
  smallProfitCents: number;
  smallMarginBps: number;
  otherExpenseCents: number;
  profitCents: number;
  profitMarginBps: number;
  promotionExpenseCents: number;
  promotionFeeRatioBps: number;
};

export type FinanceTargetTotals = {
  salesTargetCents: number;
  profitTargetCents: number;
  smallMarginBps: number;
  inventoryCleanupTargetCents: number;
  promotionFeeRatioBps: number;
  stagnantInventoryTargetCents: number;
  targetCount: number;
};

const metricKeys = [
  "gross_sales", "return_amount", "net_sales", "net_cost", "gross_profit",
  "gross_margin", "selling_expense_total", "small_profit", "small_margin",
  "other_expense_total", "profit", "profit_margin",
] as const;

const emptyMetrics = (): FinanceActualMetrics => ({
  grossSalesCents: 0,
  returnAmountCents: 0,
  netSalesCents: 0,
  netCostCents: 0,
  grossProfitCents: 0,
  grossMarginBps: 0,
  sellingExpenseCents: 0,
  smallProfitCents: 0,
  smallMarginBps: 0,
  otherExpenseCents: 0,
  profitCents: 0,
  profitMarginBps: 0,
  promotionExpenseCents: 0,
  promotionFeeRatioBps: 0,
});

function shiftMonth(month: string, delta: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function changeRate(current: number, comparison: number | null) {
  if (comparison === null || comparison === 0) return null;
  return (current - comparison) / Math.abs(comparison);
}

function metricMap(rows: FinanceLineRow[]) {
  const values = new Map<string, { amount: number; rate: number }>();
  rows.forEach((row) => values.set(row.metric_key, {
    amount: Number(row.amount_cents ?? 0),
    rate: Number(row.rate_bps ?? 0),
  }));
  return values;
}

function metricsFromRows(rows: FinanceLineRow[], promotionExpenseCents = 0): FinanceActualMetrics {
  const values = metricMap(rows);
  const amount = (key: string) => values.get(key)?.amount ?? 0;
  const rate = (key: string) => values.get(key)?.rate ?? 0;
  const netSalesCents = amount("net_sales");
  const grossProfitCents = amount("gross_profit");
  const smallProfitCents = amount("small_profit");
  const otherExpenseCents = amount("other_expense_total");
  // Some WPS templates spell 利润 with the traditional character “潤”.
  // The report formula is small profit minus other expenses, so derive it
  // when an older imported month lacks the canonical metric key.
  const profitCents = values.has("profit") ? amount("profit") : smallProfitCents - otherExpenseCents;
  return {
    grossSalesCents: amount("gross_sales"),
    returnAmountCents: amount("return_amount"),
    netSalesCents,
    netCostCents: amount("net_cost"),
    grossProfitCents,
    grossMarginBps: rate("gross_margin") || (netSalesCents === 0 ? 0 : Math.round(grossProfitCents / netSalesCents * 10_000)),
    sellingExpenseCents: amount("selling_expense_total"),
    smallProfitCents,
    smallMarginBps: rate("small_margin") || (netSalesCents === 0 ? 0 : Math.round(smallProfitCents / netSalesCents * 10_000)),
    otherExpenseCents,
    profitCents,
    profitMarginBps: rate("profit_margin") || (netSalesCents === 0 ? 0 : Math.round(profitCents / netSalesCents * 10_000)),
    promotionExpenseCents,
    promotionFeeRatioBps: netSalesCents === 0 ? 0 : Math.round(promotionExpenseCents / netSalesCents * 10_000),
  };
}

function sumMetrics(items: FinanceActualMetrics[]) {
  const total = items.reduce((result, item) => {
    result.grossSalesCents += item.grossSalesCents;
    result.returnAmountCents += item.returnAmountCents;
    result.netSalesCents += item.netSalesCents;
    result.netCostCents += item.netCostCents;
    result.grossProfitCents += item.grossProfitCents;
    result.sellingExpenseCents += item.sellingExpenseCents;
    result.smallProfitCents += item.smallProfitCents;
    result.otherExpenseCents += item.otherExpenseCents;
    result.profitCents += item.profitCents;
    result.promotionExpenseCents += item.promotionExpenseCents;
    return result;
  }, emptyMetrics());
  total.grossMarginBps = total.netSalesCents === 0 ? 0 : Math.round(total.grossProfitCents / total.netSalesCents * 10_000);
  total.smallMarginBps = total.netSalesCents === 0 ? 0 : Math.round(total.smallProfitCents / total.netSalesCents * 10_000);
  total.profitMarginBps = total.netSalesCents === 0 ? 0 : Math.round(total.profitCents / total.netSalesCents * 10_000);
  total.promotionFeeRatioBps = total.netSalesCents === 0 ? 0 : Math.round(total.promotionExpenseCents / total.netSalesCents * 10_000);
  return total;
}

function mapTarget(row: TargetRow): FinanceTarget {
  return {
    id: row.id,
    periodType: row.period_type,
    periodKey: row.period_key,
    shopName: row.shop_name,
    category: row.category,
    manager: row.manager,
    salesTargetCents: Number(row.sales_target_cents),
    profitTargetCents: Number(row.profit_target_cents),
    smallMarginBps: Number(row.small_margin_bps),
    inventoryCleanupTargetCents: Number(row.inventory_cleanup_target_cents),
    promotionFeeRatioBps: Number(row.promotion_fee_ratio_bps),
    stagnantInventoryTargetCents: Number(row.stagnant_inventory_target_cents),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function aggregateTargets(targets: FinanceTarget[]): FinanceTargetTotals {
  const salesTargetCents = targets.reduce((sum, item) => sum + item.salesTargetCents, 0);
  const weightedRate = (key: "smallMarginBps" | "promotionFeeRatioBps") => {
    const weighted = targets.reduce((sum, item) => sum + item[key] * Math.max(0, item.salesTargetCents), 0);
    if (salesTargetCents > 0) return Math.round(weighted / salesTargetCents);
    const rates = targets.map((item) => item[key]).filter((value) => value !== 0);
    return rates.length ? Math.round(rates.reduce((sum, value) => sum + value, 0) / rates.length) : 0;
  };
  return {
    salesTargetCents,
    profitTargetCents: targets.reduce((sum, item) => sum + item.profitTargetCents, 0),
    smallMarginBps: weightedRate("smallMarginBps"),
    inventoryCleanupTargetCents: targets.reduce((sum, item) => sum + item.inventoryCleanupTargetCents, 0),
    promotionFeeRatioBps: weightedRate("promotionFeeRatioBps"),
    stagnantInventoryTargetCents: targets.reduce((sum, item) => sum + item.stagnantInventoryTargetCents, 0),
    targetCount: targets.length,
  };
}

function progress(actual: FinanceActualMetrics, target: FinanceTargetTotals) {
  return {
    sales: target.salesTargetCents > 0 ? actual.netSalesCents / target.salesTargetCents : null,
    profit: target.profitTargetCents > 0 ? actual.profitCents / target.profitTargetCents : null,
    smallMarginGapBps: target.smallMarginBps > 0 ? actual.smallMarginBps - target.smallMarginBps : null,
    promotionFeeGapBps: target.promotionFeeRatioBps > 0 ? actual.promotionFeeRatioBps - target.promotionFeeRatioBps : null,
  };
}

export async function getFinanceAnalysis(db: FinanceDatabase, requestedMonth?: string | null) {
  const monthResult = await db.prepare(
    `SELECT month, source_file_name, imported_at, shop_count, subject_count
     FROM finance_months WHERE status = 'completed' ORDER BY month`,
  ).all<FinanceMonthRow>();
  const months = monthResult.results;
  if (months.length === 0) {
    return { hasData: false, months: [], selectedMonth: null, anomalies: [], expenses: [], shops: [], timeline: [] };
  }
  const selectedMonth = months.some((item) => item.month === requestedMonth)
    ? String(requestedMonth)
    : months.at(-1)!.month;
  const previousMonth = shiftMonth(selectedMonth, -1);
  const yearAgoMonth = shiftMonth(selectedMonth, -12);
  const monthKeys = months.map((item) => item.month);
  const placeholders = monthKeys.map(() => "?").join(",");
  const summaryResult = await db.prepare(
    `SELECT month, metric_key, subject_name, scope_name, group_name,
            amount_cents, rate_bps, sort_order
     FROM finance_lines
     WHERE section = 'summary' AND scope_type = 'business'
       AND metric_key IN (${metricKeys.map(() => "?").join(",")})
       AND month IN (${placeholders})
     ORDER BY month, sort_order`,
  ).bind(...metricKeys, ...monthKeys).all<FinanceLineRow>();
  const promotionResult = await db.prepare(
    `SELECT month, COALESCE(SUM(amount_cents), 0) AS amount_cents
     FROM finance_lines
     WHERE section = 'kingdee' AND scope_type = 'business'
       AND subject_name LIKE '销售费用_推广费用_%'
       AND month IN (${placeholders})
     GROUP BY month`,
  ).bind(...monthKeys).all<{ month: string; amount_cents: number }>();
  const promotions = new Map(promotionResult.results.map((item) => [item.month, Number(item.amount_cents)]));
  const summaryByMonth = new Map<string, FinanceLineRow[]>();
  summaryResult.results.forEach((row) => {
    const items = summaryByMonth.get(row.month) ?? [];
    items.push(row);
    summaryByMonth.set(row.month, items);
  });
  const actualByMonth = new Map(monthKeys.map((month) => [
    month,
    metricsFromRows(summaryByMonth.get(month) ?? [], promotions.get(month) ?? 0),
  ]));
  const current = actualByMonth.get(selectedMonth) ?? emptyMetrics();
  const previous = actualByMonth.get(previousMonth) ?? null;
  const yearAgo = actualByMonth.get(yearAgoMonth) ?? null;
  const selectedYear = selectedMonth.slice(0, 4);
  const yearMonths = monthKeys.filter((month) => month.startsWith(`${selectedYear}-`) && month <= selectedMonth);
  const yearToDate = sumMetrics(yearMonths.map((month) => actualByMonth.get(month) ?? emptyMetrics()));

  const targetResult = await db.prepare(
    `SELECT id, period_type, period_key, shop_name, category, manager,
            sales_target_cents, profit_target_cents, small_margin_bps,
            inventory_cleanup_target_cents, promotion_fee_ratio_bps,
            stagnant_inventory_target_cents, created_at, updated_at
     FROM finance_targets WHERE (period_type = 'month' AND period_key = ?)
        OR (period_type = 'year' AND period_key = ?)
        OR period_type = 'project'`,
  ).bind(selectedMonth, selectedYear).all<TargetRow>();
  const targets = targetResult.results.map(mapTarget);
  const monthlyTargetRows = targets.filter((item) => item.periodType === "month" && item.periodKey === selectedMonth);
  const annualTargetRows = targets.filter((item) => item.periodType === "year" && item.periodKey === selectedYear);
  const monthTargets = aggregateTargets(monthlyTargetRows);
  const yearTargets = aggregateTargets(annualTargetRows);

  const compareMonths = [selectedMonth, previousMonth, yearAgoMonth];
  const comparePlaceholders = compareMonths.map(() => "?").join(",");
  const expenseResult = await db.prepare(
    `SELECT month, metric_key, subject_name, scope_name, group_name,
            amount_cents, rate_bps, sort_order
     FROM finance_lines
     WHERE section = 'kingdee' AND scope_type = 'business'
       AND is_total = 0 AND month IN (${comparePlaceholders})
     ORDER BY sort_order`,
  ).bind(...compareMonths).all<FinanceLineRow>();
  const expenseByName = new Map<string, { name: string; current: number; previous: number | null; yearAgo: number | null; sortOrder: number }>();
  expenseResult.results.forEach((row) => {
    const item = expenseByName.get(row.subject_name) ?? {
      name: row.subject_name,
      current: 0,
      previous: null,
      yearAgo: null,
      sortOrder: row.sort_order,
    };
    if (row.month === selectedMonth) item.current = Number(row.amount_cents ?? 0);
    if (row.month === previousMonth) item.previous = Number(row.amount_cents ?? 0);
    if (row.month === yearAgoMonth) item.yearAgo = Number(row.amount_cents ?? 0);
    expenseByName.set(row.subject_name, item);
  });
  const expenses = [...expenseByName.values()]
    .filter((item) => item.current !== 0 || item.previous !== null || item.yearAgo !== null)
    .map((item) => ({
      ...item,
      momRate: changeRate(item.current, item.previous),
      yoyRate: changeRate(item.current, item.yearAgo),
      abnormal: item.previous !== null
        && Math.abs(item.current - item.previous) >= 100_000
        && Math.abs(changeRate(item.current, item.previous) ?? 0) >= 0.3,
    }))
    .sort((left, right) => Math.abs(right.current) - Math.abs(left.current));

  const shopSummaryResult = await db.prepare(
    `SELECT month, metric_key, subject_name, scope_name, group_name,
            amount_cents, rate_bps, sort_order
     FROM finance_lines
     WHERE month = ? AND section = 'summary' AND scope_type = 'shop'
       AND metric_key IN (${metricKeys.map(() => "?").join(",")})
     ORDER BY scope_name, sort_order`,
  ).bind(selectedMonth, ...metricKeys).all<FinanceLineRow>();
  const shopPromotionResult = await db.prepare(
    `SELECT scope_name, COALESCE(SUM(amount_cents), 0) AS amount_cents
     FROM finance_lines
     WHERE month = ? AND section = 'kingdee' AND scope_type = 'shop'
       AND subject_name LIKE '销售费用_推广费用_%'
     GROUP BY scope_name`,
  ).bind(selectedMonth).all<{ scope_name: string; amount_cents: number }>();
  const shopPromotions = new Map(shopPromotionResult.results.map((item) => [item.scope_name, Number(item.amount_cents)]));
  const shopRows = new Map<string, FinanceLineRow[]>();
  shopSummaryResult.results.forEach((row) => {
    const items = shopRows.get(row.scope_name) ?? [];
    items.push(row);
    shopRows.set(row.scope_name, items);
  });
  const shops = [...shopRows.entries()].map(([name, rows]) => {
    const actual = metricsFromRows(rows, shopPromotions.get(name) ?? 0);
    const targetRows = monthlyTargetRows.filter((target) => target.shopName === name);
    const target = aggregateTargets(targetRows);
    return {
      name,
      groupName: rows[0]?.group_name ?? "",
      manager: targetRows.find((item) => item.manager)?.manager ?? "",
      actual,
      target,
      progress: progress(actual, target),
    };
  }).sort((left, right) => right.actual.netSalesCents - left.actual.netSalesCents);

  const anomalies: Array<{ level: "critical" | "warning" | "info"; title: string; detail: string }> = [];
  if (current.profitCents < 0) anomalies.push({ level: "critical", title: "本月利润为负", detail: "建议优先检查销售费用、退货和异常成本科目。" });
  if (monthTargets.smallMarginBps > 0 && current.smallMarginBps < monthTargets.smallMarginBps) {
    anomalies.push({ level: "warning", title: "小毛利率低于目标", detail: `低于目标 ${((monthTargets.smallMarginBps - current.smallMarginBps) / 100).toFixed(1)} 个百分点。` });
  }
  const monthProgress = progress(current, monthTargets);
  if (monthProgress.sales !== null && monthProgress.sales < 0.9) {
    anomalies.push({ level: "warning", title: "销售目标完成度偏低", detail: `本月销售目标完成 ${(monthProgress.sales * 100).toFixed(1)}%。` });
  }
  expenses.filter((item) => item.abnormal && item.momRate !== null).slice(0, 5).forEach((item) => {
    anomalies.push({
      level: item.momRate! > 0 ? "warning" : "info",
      title: `${item.name.replace(/^销售费用_/, "")}环比${item.momRate! > 0 ? "上升" : "下降"}`,
      detail: `较上月${item.momRate! > 0 ? "增加" : "减少"} ${(Math.abs(item.momRate!) * 100).toFixed(1)}%。`,
    });
  });
  if (anomalies.length === 0) anomalies.push({ level: "info", title: "暂未发现明显异常", detail: "当前月份利润、目标进度与费用波动均在规则阈值内。" });

  const selectedMonthMeta = months.find((item) => item.month === selectedMonth)!;
  return {
    hasData: true,
    months: months.map((item) => ({
      month: item.month,
      fileName: item.source_file_name,
      importedAt: item.imported_at,
      shopCount: Number(item.shop_count),
      subjectCount: Number(item.subject_count),
    })),
    selectedMonth,
    previousMonth: actualByMonth.has(previousMonth) ? previousMonth : null,
    yearAgoMonth: actualByMonth.has(yearAgoMonth) ? yearAgoMonth : null,
    current,
    previous,
    yearAgo,
    yearToDate,
    timeline: monthKeys.map((month) => ({ month, ...(actualByMonth.get(month) ?? emptyMetrics()) })),
    targets: { month: monthTargets, year: yearTargets, projects: targets.filter((item) => item.periodType === "project") },
    progress: { month: monthProgress, year: progress(yearToDate, yearTargets) },
    expenses,
    shops,
    anomalies,
    sync: {
      dataCutoffMonth: selectedMonth,
      sourceFileName: selectedMonthMeta.source_file_name,
      importedAt: selectedMonthMeta.imported_at,
    },
  };
}
