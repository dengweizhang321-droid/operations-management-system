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
  scope_type: "business" | "shop";
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
  returnRateBps: number;
  sellingExpenseCents: number;
  smallProfitCents: number;
  smallMarginBps: number;
  otherExpenseCents: number;
  profitCents: number;
  profitMarginBps: number;
  promotionExpenseCents: number;
  promotionFeeRatioBps: number;
};

export type FinanceAnalysisOptions = {
  requestedMonths?: string[];
  allMonths?: boolean;
  platformNames?: string[];
  shopNames?: string[];
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
  returnRateBps: 0,
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
  const grossSalesCents = amount("gross_sales");
  const returnAmountCents = amount("return_amount");
  const grossProfitCents = amount("gross_profit");
  const smallProfitCents = amount("small_profit");
  const otherExpenseCents = amount("other_expense_total");
  // Some WPS templates spell 利润 with the traditional character “潤”.
  // The report formula is small profit minus other expenses, so derive it
  // when an older imported month lacks the canonical metric key.
  const profitCents = values.has("profit") ? amount("profit") : smallProfitCents - otherExpenseCents;
  return {
    grossSalesCents,
    returnAmountCents,
    netSalesCents,
    netCostCents: amount("net_cost"),
    grossProfitCents,
    grossMarginBps: rate("gross_margin") || (netSalesCents === 0 ? 0 : Math.round(grossProfitCents / netSalesCents * 10_000)),
    returnRateBps: grossSalesCents === 0 ? 0 : Math.round(Math.abs(returnAmountCents) / Math.abs(grossSalesCents) * 10_000),
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
  total.returnRateBps = total.grossSalesCents === 0 ? 0 : Math.round(Math.abs(total.returnAmountCents) / Math.abs(total.grossSalesCents) * 10_000);
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

export async function getFinanceAnalysis(db: FinanceDatabase, options: FinanceAnalysisOptions = {}) {
  const monthResult = await db.prepare(
    `SELECT month, source_file_name, imported_at, shop_count, subject_count
     FROM finance_months WHERE status = 'completed' ORDER BY month`,
  ).all<FinanceMonthRow>();
  const months = monthResult.results;
  if (months.length === 0) {
    return {
      hasData: false,
      months: [],
      selectedMonth: null,
      selectedMonths: [],
      anomalies: [],
      expenses: [],
      shops: [],
      timeline: [],
      filters: { platforms: [], shops: [] },
    };
  }
  const monthKeys = months.map((item) => item.month);
  const requestedMonths = [...new Set(options.requestedMonths ?? [])]
    .filter((month) => monthKeys.includes(month))
    .sort();
  const selectedMonths = options.allMonths
    ? monthKeys
    : requestedMonths.length > 0
      ? requestedMonths
      : [monthKeys.at(-1)!];
  const selectedMonth = selectedMonths.at(-1)!;
  const firstSelectedMonth = selectedMonths[0];
  const previousPeriodMonths = Array.from(
    { length: selectedMonths.length },
    (_, index) => shiftMonth(firstSelectedMonth, index - selectedMonths.length),
  );
  const yearAgoMonths = selectedMonths.map((month) => shiftMonth(month, -12));
  const previousPeriodAvailable = previousPeriodMonths.every((month) => monthKeys.includes(month));
  const yearAgoPeriodAvailable = yearAgoMonths.every((month) => monthKeys.includes(month));
  const placeholders = monthKeys.map(() => "?").join(",");
  const summaryResult = await db.prepare(
    `SELECT month, metric_key, subject_name, scope_type, scope_name, group_name,
            amount_cents, rate_bps, sort_order
     FROM finance_lines
     WHERE section = 'summary' AND scope_type IN ('business', 'shop')
       AND metric_key IN (${metricKeys.map(() => "?").join(",")})
       AND month IN (${placeholders})
     ORDER BY month, scope_type, scope_name, sort_order`,
  ).bind(...metricKeys, ...monthKeys).all<FinanceLineRow>();
  const promotionResult = await db.prepare(
    `SELECT month, scope_type, scope_name, group_name,
            COALESCE(SUM(amount_cents), 0) AS amount_cents
     FROM finance_lines
     WHERE section = 'kingdee' AND scope_type IN ('business', 'shop')
       AND subject_name LIKE '销售费用_推广费用_%'
       AND month IN (${placeholders})
     GROUP BY month, scope_type, scope_name, group_name`,
  ).bind(...monthKeys).all<{
    month: string;
    scope_type: "business" | "shop";
    scope_name: string;
    group_name: string;
    amount_cents: number;
  }>();

  const shopOptionsByName = new Map<string, { name: string; platform: string }>();
  summaryResult.results.filter((row) => row.scope_type === "shop").forEach((row) => {
    if (!shopOptionsByName.has(row.scope_name)) {
      shopOptionsByName.set(row.scope_name, { name: row.scope_name, platform: row.group_name || "未分组" });
    }
  });
  const shopOptions = [...shopOptionsByName.values()].sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
  const platforms = [...new Set(shopOptions.map((item) => item.platform))].sort((left, right) => left.localeCompare(right, "zh-CN"));
  const shopFilter = new Set((options.shopNames ?? []).filter((name) => shopOptionsByName.has(name)));
  const platformFilter = new Set((options.platformNames ?? []).filter((name) => platforms.includes(name)));
  const hasDimensionFilter = shopFilter.size > 0 || platformFilter.size > 0;
  const matchesShop = (shopName: string, platformName: string) => (
    (shopFilter.size === 0 || shopFilter.has(shopName))
    && (platformFilter.size === 0 || platformFilter.has(platformName || "未分组"))
  );

  const businessRowsByMonth = new Map<string, FinanceLineRow[]>();
  const shopRowsByMonthAndName = new Map<string, FinanceLineRow[]>();
  summaryResult.results.forEach((row) => {
    if (row.scope_type === "business") {
      const items = businessRowsByMonth.get(row.month) ?? [];
      items.push(row);
      businessRowsByMonth.set(row.month, items);
      return;
    }
    const key = `${row.month}\u0000${row.scope_name}`;
    const items = shopRowsByMonthAndName.get(key) ?? [];
    items.push(row);
    shopRowsByMonthAndName.set(key, items);
  });

  const businessPromotions = new Map<string, number>();
  const shopPromotions = new Map<string, number>();
  promotionResult.results.forEach((row) => {
    if (row.scope_type === "business") {
      businessPromotions.set(row.month, (businessPromotions.get(row.month) ?? 0) + Number(row.amount_cents));
      return;
    }
    const key = `${row.month}\u0000${row.scope_name}`;
    shopPromotions.set(key, (shopPromotions.get(key) ?? 0) + Number(row.amount_cents));
  });

  const shopActualByMonthAndName = new Map<string, FinanceActualMetrics>();
  shopRowsByMonthAndName.forEach((rows, key) => {
    shopActualByMonthAndName.set(key, metricsFromRows(rows, shopPromotions.get(key) ?? 0));
  });

  const actualByMonth = new Map<string, FinanceActualMetrics>();
  monthKeys.forEach((month) => {
    if (!hasDimensionFilter) {
      actualByMonth.set(month, metricsFromRows(businessRowsByMonth.get(month) ?? [], businessPromotions.get(month) ?? 0));
      return;
    }
    const matching = shopOptions
      .filter((shop) => matchesShop(shop.name, shop.platform))
      .map((shop) => shopActualByMonthAndName.get(`${month}\u0000${shop.name}`))
      .filter((item): item is FinanceActualMetrics => Boolean(item));
    actualByMonth.set(month, sumMetrics(matching));
  });

  const sumPeriod = (periodMonths: string[]) => sumMetrics(periodMonths.map((month) => actualByMonth.get(month) ?? emptyMetrics()));
  const current = sumPeriod(selectedMonths);
  const previous = previousPeriodAvailable ? sumPeriod(previousPeriodMonths) : null;
  const yearAgo = yearAgoPeriodAvailable ? sumPeriod(yearAgoMonths) : null;
  const selectedYears = [...new Set(selectedMonths.map((month) => month.slice(0, 4)))];
  const selectedYear = selectedMonth.slice(0, 4);
  const yearMonths = monthKeys.filter((month) => month.startsWith(`${selectedYear}-`) && month <= selectedMonth);
  const yearToDate = sumPeriod(yearMonths);

  const targetResult = await db.prepare(
    `SELECT id, period_type, period_key, shop_name, category, manager,
            sales_target_cents, profit_target_cents, small_margin_bps,
            inventory_cleanup_target_cents, promotion_fee_ratio_bps,
            stagnant_inventory_target_cents, created_at, updated_at
     FROM finance_targets`,
  ).all<TargetRow>();
  const matchesTargetDimension = (target: FinanceTarget) => {
    if (!hasDimensionFilter) return true;
    if (!target.shopName) return false;
    const shop = shopOptionsByName.get(target.shopName);
    return Boolean(shop && matchesShop(shop.name, shop.platform));
  };
  const targets = targetResult.results.map(mapTarget);
  const monthlyTargetRows = targets.filter((item) => item.periodType === "month" && selectedMonths.includes(item.periodKey) && matchesTargetDimension(item));
  const annualTargetRows = targets.filter((item) => item.periodType === "year" && selectedYears.includes(item.periodKey) && matchesTargetDimension(item));
  const monthTargets = aggregateTargets(monthlyTargetRows);
  const yearTargets = aggregateTargets(annualTargetRows);

  const expenseResult = await db.prepare(
    `SELECT month, metric_key, subject_name, scope_type, scope_name, group_name,
            amount_cents, rate_bps, sort_order
     FROM finance_lines
     WHERE section = 'kingdee' AND scope_type IN ('business', 'shop')
       AND is_total = 0 AND month IN (${placeholders})
     ORDER BY month, scope_type, scope_name, sort_order`,
  ).bind(...monthKeys).all<FinanceLineRow>();
  const expenseTotals = (periodMonths: string[]) => {
    const period = new Set(periodMonths);
    const totals = new Map<string, { amount: number; sortOrder: number }>();
    expenseResult.results.forEach((row) => {
      if (!period.has(row.month)) return;
      if (hasDimensionFilter) {
        if (row.scope_type !== "shop" || !matchesShop(row.scope_name, row.group_name || "未分组")) return;
      } else if (row.scope_type !== "business") return;
      const existing = totals.get(row.subject_name) ?? { amount: 0, sortOrder: row.sort_order };
      existing.amount += Number(row.amount_cents ?? 0);
      existing.sortOrder = Math.min(existing.sortOrder, row.sort_order);
      totals.set(row.subject_name, existing);
    });
    return totals;
  };
  const currentExpenses = expenseTotals(selectedMonths);
  const previousExpenses = previousPeriodAvailable ? expenseTotals(previousPeriodMonths) : null;
  const yearAgoExpenses = yearAgoPeriodAvailable ? expenseTotals(yearAgoMonths) : null;
  const expenseNames = new Set([
    ...currentExpenses.keys(),
    ...(previousExpenses?.keys() ?? []),
    ...(yearAgoExpenses?.keys() ?? []),
  ]);
  const expenses = [...expenseNames].map((name) => {
    const currentAmount = currentExpenses.get(name)?.amount ?? 0;
    const previousAmount = previousExpenses ? previousExpenses.get(name)?.amount ?? 0 : null;
    const yearAgoAmount = yearAgoExpenses ? yearAgoExpenses.get(name)?.amount ?? 0 : null;
    const momRate = changeRate(currentAmount, previousAmount);
    return {
      name,
      current: currentAmount,
      previous: previousAmount,
      yearAgo: yearAgoAmount,
      sortOrder: currentExpenses.get(name)?.sortOrder ?? previousExpenses?.get(name)?.sortOrder ?? yearAgoExpenses?.get(name)?.sortOrder ?? 0,
      feeRateBps: current.netSalesCents === 0 ? 0 : Math.round(currentAmount / current.netSalesCents * 10_000),
      momRate,
      yoyRate: changeRate(currentAmount, yearAgoAmount),
      abnormal: previousAmount !== null
        && Math.abs(currentAmount - previousAmount) >= 100_000
        && Math.abs(momRate ?? 0) >= 0.3,
    };
  })
    .filter((item) => item.current !== 0 || item.previous !== null || item.yearAgo !== null)
    .sort((left, right) => Math.abs(right.current) - Math.abs(left.current));

  const shops = shopOptions.filter((shop) => matchesShop(shop.name, shop.platform)).map((shop) => {
    const actuals = selectedMonths
      .map((month) => shopActualByMonthAndName.get(`${month}\u0000${shop.name}`))
      .filter((item): item is FinanceActualMetrics => Boolean(item));
    const actual = sumMetrics(actuals);
    const targetRows = targets.filter((target) => target.periodType === "month" && selectedMonths.includes(target.periodKey) && target.shopName === shop.name);
    const target = aggregateTargets(targetRows);
    return {
      name: shop.name,
      groupName: shop.platform,
      manager: targetRows.find((item) => item.manager)?.manager ?? "",
      actual,
      target,
      progress: progress(actual, target),
    };
  }).filter((shop) => shop.actual.netSalesCents !== 0 || shop.actual.grossSalesCents !== 0 || shop.target.targetCount > 0)
    .sort((left, right) => right.actual.netSalesCents - left.actual.netSalesCents);

  const anomalies: Array<{ level: "critical" | "warning" | "info"; title: string; detail: string }> = [];
  if (current.profitCents < 0) anomalies.push({ level: "critical", title: "所选期间利润为负", detail: "建议优先检查销售费用、退货和异常成本科目。" });
  if (monthTargets.smallMarginBps > 0 && current.smallMarginBps < monthTargets.smallMarginBps) {
    anomalies.push({ level: "warning", title: "小毛利率低于目标", detail: `低于目标 ${((monthTargets.smallMarginBps - current.smallMarginBps) / 100).toFixed(1)} 个百分点。` });
  }
  const monthProgress = progress(current, monthTargets);
  if (monthProgress.sales !== null && monthProgress.sales < 0.9) {
    anomalies.push({ level: "warning", title: "销售目标完成度偏低", detail: `所选期间销售目标完成 ${(monthProgress.sales * 100).toFixed(1)}%。` });
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
  const periodLabel = selectedMonths.length === 1
    ? selectedMonth
    : `${selectedMonths[0]} 至 ${selectedMonths.at(-1)}（${selectedMonths.length}个月）`;
  const timelineMonths = selectedMonths.length === 1
    ? monthKeys.filter((month) => month <= selectedMonth)
    : selectedMonths;
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
    selectedMonths,
    periodLabel,
    previousMonth: previousPeriodAvailable && previousPeriodMonths.length === 1 ? previousPeriodMonths[0] : null,
    previousMonths: previousPeriodAvailable ? previousPeriodMonths : [],
    yearAgoMonth: yearAgoPeriodAvailable && yearAgoMonths.length === 1 ? yearAgoMonths[0] : null,
    yearAgoMonths: yearAgoPeriodAvailable ? yearAgoMonths : [],
    current,
    previous,
    yearAgo,
    yearToDate,
    timeline: timelineMonths.map((month) => ({ month, ...(actualByMonth.get(month) ?? emptyMetrics()) })),
    targets: { month: monthTargets, year: yearTargets, projects: targets.filter((item) => item.periodType === "project") },
    progress: { month: monthProgress, year: progress(yearToDate, yearTargets) },
    expenses,
    shops,
    anomalies,
    filters: { platforms, shops: shopOptions },
    selection: {
      allMonths: Boolean(options.allMonths),
      months: selectedMonths,
      platforms: [...platformFilter],
      shops: [...shopFilter],
    },
    sync: {
      dataCutoffMonth: selectedMonth,
      sourceFileName: selectedMonthMeta.source_file_name,
      importedAt: selectedMonthMeta.imported_at,
    },
  };
}
