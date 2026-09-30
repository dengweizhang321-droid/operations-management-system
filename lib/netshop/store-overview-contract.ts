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
function text(value: unknown, limit = 200): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= limit;
}
function calendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("网店总览响应格式不完整");
  return value as Record<string, unknown>;
}
function metrics(value: unknown) {
  const record = object(value);
  if (Object.keys(record).length !== overviewMetricKeys.length) throw new Error("网店总览指标合同已变化");
  for (const key of overviewMetricKeys) {
    const m = object(record[key]);
    if (m.unit !== expectedUnits[key] || typeof m.status !== "string" || !statuses.has(m.status)
      || typeof m.basis !== "string" || !["product_day_sum", "platform_attributed", "unverified"].includes(m.basis)
      || typeof m.aggregation !== "string" || !["sum", "ratio_of_sums", "source_value_only"].includes(m.aggregation)
      || !Array.isArray(m.sourceIds) || m.sourceIds.length > 50 || !m.sourceIds.every(v => text(v))
      || !(m.reasonCode === null || text(m.reasonCode))
      || !(m.value === null || typeof m.value === "number" && Number.isFinite(m.value))
      || (m.unit === "CNY_CENT" || m.unit === "COUNT") && m.value !== null && !Number.isSafeInteger(m.value)
      || (m.status === "unavailable" || m.status === "invalid") && m.value !== null
      || (m.status === "available" || m.status === "partial") && m.value === null
      || m.status === "available" && (m.reasonCode !== null || m.sourceIds.length === 0 || m.basis === "unverified")
      || m.status !== "available" && !text(m.reasonCode)
      || m.status === "partial" && (m.aggregation !== "sum" || m.unit === "RATIO" || m.unit === "MULTIPLE")) throw new Error("网店总览指标无效");
    if (m.coverage !== undefined && m.coverage !== null) {
      const c = object(m.coverage);
      if (![c.coveredShopDatePairs, c.expectedShopDatePairs].every(v => Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= 18300)
        || Number(c.coveredShopDatePairs) > Number(c.expectedShopDatePairs)) throw new Error("网店总览指标覆盖无效");
    }
  }
}
function comparisons(value: unknown) {
  const record = object(value);
  for (const key of overviewMetricKeys) for (const kind of ["previous", "yearAgo"]) {
    const c = object(object(record[key])[kind]);
    if (c.method !== (expectedUnits[key] === "RATIO" ? "percentage_points" : "relative_change")
      || typeof c.status !== "string" || !["available", "unavailable"].includes(c.status)
      || !(c.reasonCode === null || text(c.reasonCode))
      || !(c.value === null || typeof c.value === "number" && Number.isFinite(c.value))
      || c.status === "available" && (c.value === null || c.reasonCode !== null)
      || c.status === "unavailable" && (c.value !== null || !text(c.reasonCode))) throw new Error("网店总览比较无效");
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
    || typeof f.periodKind !== "string" || !["today", "yesterday", "last7", "last15", "last30", "month", "quarter", "custom", "rolling", "all"].includes(f.periodKind)
    || !text(p.requestId, 128) || !text(periods.rule) || !text(periods.ruleVersion)
    || periods.timezone !== "Asia/Shanghai") throw new Error("网店总览范围无效");
  for (const k of ["current", "previous", "yearAgo"]) windowSpec(periods[k]);
  const current = object(periods.current), shopKeys = new Set(f.shopKeys);
  const withinCurrent = (start: unknown, end: unknown) => calendarDate(start) && calendarDate(end)
    && start >= String(current.startDate) && end <= String(current.endDate);
  metrics(p.summary); comparisons(p.comparisons);
  for (const k of ["daily", "trend", "details"]) {
    if (!Array.isArray(p[k]) || p[k].length > 366) throw new Error("网店总览序列超限");
    if (k === "daily" && p[k].length !== current.days) throw new Error("网店总览日序列不完整");
    const rowDates = new Set<string>();
    for (const row of p[k]) {
      const r = object(row); metrics(r.metrics); comparisons(r.comparisons);
      windowSpec({ ...r, endExclusive: new Date(Date.parse(`${r.endDate}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10) });
      if (!withinCurrent(r.startDate, r.endDate) || rowDates.has(String(r.startDate))
        || k === "daily" && (r.days !== 1 || r.startDate !== new Date(Date.parse(`${current.startDate}T00:00:00Z`) + rowDates.size * 86_400_000).toISOString().slice(0, 10))) throw new Error("网店总览序列范围无效");
      rowDates.add(String(r.startDate));
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
  for (const key of ["shops", "shopOptions"]) {
    const identities = new Set<string>();
    for (const row of p[key] as unknown[]) {
      const r = object(row);
      if (typeof r.shopKey !== "string" || !r.shopKey.startsWith(`${f.platform}\u001f`) || r.shopKey.split("\u001f").length !== 2
        || !text(r.shopName) || r.shopKey.split("\u001f")[1] !== r.shopName || identities.has(r.shopKey)
        || key === "shops" && !shopKeys.has(r.shopKey)) throw new Error("网店总览店铺范围无效");
      identities.add(r.shopKey);
      if (key === "shops") { metrics(r.metrics); comparisons(r.comparisons); }
    }
  }
  for (const key of ["shopPagination", "detailPagination"]) {
    const page = object(p[key]);
    if (![page.page, page.pageSize, page.total].every(v => Number.isSafeInteger(v)) || Number(page.page) < 1 || Number(page.page) > 10000
      || Number(page.pageSize) < 1 || Number(page.pageSize) > (key === "shopPagination" ? 20 : 366) || Number(page.total) < 0
      || Number(page.total) > (key === "shopPagination" ? 50 : 366) || typeof page.hasMore !== "boolean") throw new Error("网店总览分页无效");
    const total = key === "shopPagination" ? shopKeys.size : f.detailGrain === "day" ? Number(current.days) : Math.ceil(Number(current.days) / 7);
    const offset = (Number(page.page) - 1) * Number(page.pageSize);
    const rows = p[key === "shopPagination" ? "shops" : "details"] as unknown[];
    if (page.total !== total || rows.length !== Math.max(0, Math.min(Number(page.pageSize), total - offset))
      || page.hasMore !== (offset + Number(page.pageSize) < total)) throw new Error("网店总览分页与范围不一致");
  }
  if (!Array.isArray(p.freshness) || !Array.isArray(p.movingAverage) || !Array.isArray(p.annotations)) throw new Error("网店总览来源证据不完整");
  const revisions = object(p.sourceRevisions), coverages = object(p.coverageBySource);
  if (Object.keys(revisions).length === 0 || Object.keys(revisions).length > 50 || !Object.entries(revisions).every(([k, v]) => text(k) && text(v))) throw new Error("网店来源修订无效");
  if (Object.keys(coverages).length === 0 || Object.keys(coverages).length > 50) throw new Error("网店来源覆盖缺失");
  for (const item of Object.values(coverages)) {
    const c = object(item);
    if (![c.expectedShopDatePairs, c.coveredShopDatePairs].every(v => Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= 18300)
      || Number(c.coveredShopDatePairs) > Number(c.expectedShopDatePairs) || c.expectedShopDatePairs !== shopKeys.size * Number(current.days)
      || c.complete !== (Number(c.expectedShopDatePairs) > 0 && c.coveredShopDatePairs === c.expectedShopDatePairs)
      || c.truncated !== false || !Array.isArray(c.missingByShop) || c.missingByShop.length > 50) throw new Error("网店来源覆盖无效");
    const missingShops = new Set<string>(); let missingCount = 0;
    for (const item of c.missingByShop) {
      const m = object(item);
      if (typeof m.shopKey !== "string" || !shopKeys.has(m.shopKey) || missingShops.has(m.shopKey) || !Array.isArray(m.dates) || m.dates.length === 0
        || m.dates.length > Number(current.days) || new Set(m.dates).size !== m.dates.length || !m.dates.every(d => withinCurrent(d, d))) throw new Error("网店来源缺日范围无效");
      missingShops.add(m.shopKey); missingCount += m.dates.length;
    }
    if (missingCount !== Number(c.expectedShopDatePairs) - Number(c.coveredShopDatePairs)) throw new Error("网店来源覆盖计数不一致");
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
