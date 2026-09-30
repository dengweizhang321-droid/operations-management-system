/** Owning reader DTO: cents, product × day counts, and ratios of sums. */
export const overviewMetricKeys = ["payment", "visitors", "customers", "spend", "promotionPayment", "spendRate", "conversion", "roas", "averageOrder", "uvValue", "paidVisitors", "freeVisitors", "b2bRate"] as const;
export type OverviewMetricKey = typeof overviewMetricKeys[number];
export type OverviewMetric = {
  value: number | null;
  coverage?: { coveredShopDatePairs: number; expectedShopDatePairs: number } | null;
  unit: "CNY_CENT" | "COUNT" | "RATIO" | "MULTIPLE";
  status: "available" | "partial" | "unavailable" | "invalid";
  reasonCode: string | null;
  basis: "product_day_sum" | "platform_attributed" | "unverified";
  sourceIds: string[];
  aggregation: "sum" | "ratio_of_sums" | "source_value_only";
};
export type OverviewMetrics = Record<OverviewMetricKey, OverviewMetric>;
export type OverviewWindow = { startDate: string; endDate: string; endExclusive: string; days: number };
export type OverviewComparison = {
  value: number | null; method: "relative_change" | "percentage_points";
  status: "available" | "unavailable"; reasonCode: string | null;
};
export type OverviewComparisons = Record<OverviewMetricKey, { previous: OverviewComparison; yearAgo: OverviewComparison }>;
export type OverviewRow = {
  startDate: string; endDate: string; days: number; metrics: OverviewMetrics;
  comparisons: OverviewComparisons;
  comparisonValues: { previous: { payment: number | null; spend: number | null }; yearAgo: { payment: number | null; spend: number | null } };
  comparisonDates: { previous: OverviewWindow | null; yearAgo: OverviewWindow | null };
};
export type OverviewCoverage = {
  expectedShopDatePairs: number; coveredShopDatePairs: number; complete: boolean;
  missingByShop: Array<{ shopKey: string; dates: string[] }>; truncated: boolean;
};
export type StoreOverviewResponse = {
  schemaVersion: "netshop-store-overview-v1";
  requestId: string; scopeKey: string; overviewToken: string;
  sourceRevisions: Record<string, string>;
  filters: { platform: "天猫" | "京东"; shopKeys: string[]; periodKind: string; trendGrain: "day" | "week" | "month"; detailGrain: "day" | "seven_days" };
  periods: { timezone: "Asia/Shanghai"; rule: string; ruleVersion: string; current: OverviewWindow; previous: OverviewWindow; yearAgo: OverviewWindow };
  freshness: Array<{ sourceId: string; dataThrough: string | null }>;
  coverageBySource: Record<string, OverviewCoverage>;
  summary: OverviewMetrics; comparisons: OverviewComparisons;
  daily: OverviewRow[]; trend: OverviewRow[];
  details: OverviewRow[];
  detailPagination: { page: number; pageSize: number; total: number; hasMore: boolean };
  shopOptions: Array<{ shopKey: string; shopName: string }>;
  shops: Array<{ shopKey: string; shopName: string; metrics: OverviewMetrics; comparisons: OverviewComparisons }>;
  shopPagination: { page: number; pageSize: number; total: number; hasMore: boolean };
  movingAverage: Array<{ date: string; paymentCents: number | null }>;
  annotations: Array<{ startDate: string; endDate: string; label: string; kind: "verified_event" | "statistical_change"; evidenceRef: string; ruleVersion: string | null }>;
};

const expectedUnits: Record<OverviewMetricKey, OverviewMetric["unit"]> = { payment: "CNY_CENT", visitors: "COUNT", customers: "COUNT", spend: "CNY_CENT", promotionPayment: "CNY_CENT", spendRate: "RATIO", conversion: "RATIO", roas: "MULTIPLE", averageOrder: "CNY_CENT", uvValue: "CNY_CENT", paidVisitors: "COUNT", freeVisitors: "COUNT", b2bRate: "RATIO" };
const statuses = new Set(["available", "partial", "unavailable", "invalid"]);
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("网店总览响应格式不完整");
  return value as Record<string, unknown>;
}
function metrics(value: unknown) {
  const record = object(value);
  if (Object.keys(record).length !== overviewMetricKeys.length) throw new Error("网店总览指标合同已变化");
  for (const key of overviewMetricKeys) {
    const m = object(record[key]);
    if (m.unit !== expectedUnits[key] || !statuses.has(String(m.status)) || !["CNY_CENT", "COUNT", "RATIO", "MULTIPLE"].includes(String(m.unit))
      || !["product_day_sum", "platform_attributed", "unverified"].includes(String(m.basis))
      || !["sum", "ratio_of_sums", "source_value_only"].includes(String(m.aggregation))
      || !Array.isArray(m.sourceIds) || !m.sourceIds.every(v => typeof v === "string")
      || !(m.reasonCode === null || typeof m.reasonCode === "string")
      || !(m.value === null || typeof m.value === "number" && Number.isFinite(m.value))
      || (m.unit === "CNY_CENT" || m.unit === "COUNT") && m.value !== null && !Number.isSafeInteger(m.value)
      || (m.status === "unavailable" || m.status === "invalid") && m.value !== null
      || (m.status === "available" || m.status === "partial") && m.value === null || m.status === "available" && m.reasonCode !== null) throw new Error("网店总览指标无效");
  }
}
function comparisons(value: unknown) {
  const record = object(value);
  for (const key of overviewMetricKeys) for (const kind of ["previous", "yearAgo"]) {
    const c = object(object(record[key])[kind]);
    if (!["relative_change", "percentage_points"].includes(String(c.method))
      || !["available", "unavailable"].includes(String(c.status))
      || !(c.value === null || typeof c.value === "number" && Number.isFinite(c.value))
      || c.status === "available" && c.value === null || c.status === "unavailable" && c.value !== null) throw new Error("网店总览比较无效");
  }
}
function windowSpec(value: unknown) {
  const w = object(value);
  if (![w.startDate, w.endDate, w.endExclusive].every(v => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v))
    || !Number.isInteger(w.days) || Number(w.days) < 1 || Number(w.days) > 366
    || ![w.startDate, w.endDate, w.endExclusive].every(v => { const t = Date.parse(`${v}T00:00:00Z`); return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === v; })
    || Date.parse(`${w.endExclusive}T00:00:00Z`) - Date.parse(`${w.endDate}T00:00:00Z`) !== 86_400_000
    || Date.parse(`${w.endExclusive}T00:00:00Z`) - Date.parse(`${w.startDate}T00:00:00Z`) !== Number(w.days) * 86_400_000) throw new Error("网店总览日期无效");
}
export function decodeStoreOverview(value: unknown): StoreOverviewResponse {
  const p = object(value);
  if (p.schemaVersion !== "netshop-store-overview-v1" || !/^[a-f0-9]{64}$/.test(String(p.overviewToken)) || !/^[a-f0-9]{64}$/.test(String(p.scopeKey))) throw new Error("网店总览版本合同无效");
  const f = object(p.filters), periods = object(p.periods);
  if (!["天猫", "京东"].includes(String(f.platform)) || !Array.isArray(f.shopKeys) || f.shopKeys.length > 50 || new Set(f.shopKeys).size !== f.shopKeys.length || !f.shopKeys.every(k => typeof k === "string" && k.startsWith(`${f.platform}\u001f`) && k.split("\u001f").length === 2 && k.split("\u001f")[1].trim())
    || !["day", "week", "month"].includes(String(f.trendGrain)) || !["day", "seven_days"].includes(String(f.detailGrain))
    || periods.timezone !== "Asia/Shanghai") throw new Error("网店总览范围无效");
  for (const k of ["current", "previous", "yearAgo"]) windowSpec(periods[k]);
  metrics(p.summary); comparisons(p.comparisons);
  for (const k of ["daily", "trend", "details"]) {
    if (!Array.isArray(p[k]) || p[k].length > 366) throw new Error("网店总览序列超限");
    for (const row of p[k]) {
      const r = object(row); metrics(r.metrics); comparisons(r.comparisons);
      windowSpec({ ...r, endExclusive: new Date(Date.parse(`${r.endDate}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10) });
      const dates = object(r.comparisonDates);
      for (const kind of ["previous", "yearAgo"]) if (dates[kind] !== null) windowSpec(dates[kind]);
      const values = object(r.comparisonValues);
      for (const kind of ["previous", "yearAgo"]) for (const key of ["payment", "spend"]) {
        const v = object(values[kind])[key];
        if (v !== null && !Number.isSafeInteger(v)) throw new Error("网店总览比较金额无效");
      }
    }
  }
  if (!Array.isArray(p.shops) || p.shops.length > 20 || !Array.isArray(p.shopOptions) || p.shopOptions.length > 50) throw new Error("网店总览店铺超限");
  for (const row of p.shops) { const r = object(row); metrics(r.metrics); comparisons(r.comparisons); }
  for (const key of ["shopPagination", "detailPagination"]) {
    const page = object(p[key]);
    if (![page.page, page.pageSize, page.total].every(v => Number.isSafeInteger(v) && Number(v) >= 0) || typeof page.hasMore !== "boolean") throw new Error("网店总览分页无效");
  }
  if (!Array.isArray(p.freshness) || !Array.isArray(p.movingAverage) || !Array.isArray(p.annotations)) throw new Error("网店总览来源证据不完整");
  const revisions = object(p.sourceRevisions), coverages = object(p.coverageBySource);
  if (!Object.values(revisions).every(v => typeof v === "string" && v.length <= 200)) throw new Error("网店来源修订无效");
  for (const item of Object.values(coverages)) {
    const c = object(item);
    if (![c.expectedShopDatePairs, c.coveredShopDatePairs].every(v => Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= 18300)
      || Number(c.coveredShopDatePairs) > Number(c.expectedShopDatePairs) || c.truncated !== false || typeof c.complete !== "boolean" || !Array.isArray(c.missingByShop)) throw new Error("网店来源覆盖无效");
  }
  for (const row of p.movingAverage) { const r = object(row); if (r.paymentCents !== null && !Number.isSafeInteger(r.paymentCents)) throw new Error("网店均线无效"); }
  return value as StoreOverviewResponse;
}

export const overviewReasons: Record<string, string> = {
  no_records: "尚未导入对应商品日或推广日数据", missing_field: "可信口径所需字段缺失或尚未完成映射", incomplete_coverage: "所选店铺日期覆盖不完整",
  unverified_source: "暂无可信来源", zero_denominator: "分母为零", negative_baseline: "负基期不提供普通相对增幅", incomplete_baseline: "比较期数据不完整", no_comparable_date: "日期无法一一对齐",
  unsafe_integer: "指标超出无损整数范围", promotion_not_ready: "推广聚合版本未就绪", promotion_mismatch: "推广来源与聚合校验不一致",
};
export function formatOverviewMetric(metric: OverviewMetric, money: "wan" | "yuan" = "wan") {
  if (metric.value === null) return "—";
  if (metric.unit === "CNY_CENT") return (metric.value / (money === "wan" ? 1_000_000 : 100)).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (metric.unit === "RATIO") return `${(metric.value * 100).toFixed(2)}%`;
  if (metric.unit === "MULTIPLE") return `${metric.value.toFixed(2)} 倍`;
  return metric.value.toLocaleString("zh-CN");
}
