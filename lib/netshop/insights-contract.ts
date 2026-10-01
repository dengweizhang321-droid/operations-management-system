import { isNetshopIsoDate, netshopOutletKey, readNetshopOutletFilters, resolveNetshopQueryPeriod, NetshopQueryError } from "./query-contract";
import type { OverviewMetric, OverviewComparison, StoreOverviewResponse } from "./store-overview-contract";
import { decodeStoreOverview } from "./store-overview-contract";

export const INSIGHTS_SCHEMA = "netshop-insights-v1" as const;
export const insightBudget = { days: 366, shops: 50, pageSize: 20, maximumPageSize: 100, identities: 100, responseBytes: 2 * 1024 * 1024, readerDeadlineMs: 65_000, requestDeadlineMs: 90_000, attempts: 2 } as const;
export const periodKinds = ["today", "yesterday", "last7", "last15", "last30", "month", "quarter", "custom", "rolling", "all"] as const;
export type InsightPlatform = "京东" | "天猫";
export type ProductIdentity = { platform: InsightPlatform; shopName: string; dimension: "sku" | "spu"; id: string };
export type MetricBasis = "product_day_sum" | "platform_attributed" | "erp_net_sales" | "erp_order_margin" | "erp_large_margin" | "finance_month" | "current_snapshot" | "unverified";
export const metricReasons = ["no_records", "missing_day", "missing_field", "not_applicable", "unmapped", "ambiguous_mapping", "zero_denominator", "negative_denominator", "incomplete_baseline", "negative_baseline", "unverified_source", "attribution_window_unknown", "unsafe_integer", "incomplete_coverage", "no_comparable_date", "promotion_not_ready", "promotion_mismatch"] as const;
export type MetricReason = typeof metricReasons[number];
export type MetricValue = { value: number | null; unit: "CNY_CENT" | "COUNT" | "RATIO" | "MULTIPLE" | "SECONDS"; status: "available" | "partial" | "unavailable" | "invalid"; reasonCode: MetricReason | null; basis: MetricBasis; sourceIds: string[]; aggregation: "sum" | "ratio_of_sums" | "source_value_only"; coverageRef: string; numerator?: number | null; denominator?: number | null };
export type MetricComparison = OverviewComparison;
export const derivedMoneySchema = "netshop-money-per-count-v1" as const;
export const moneyDenominatorKinds = ["clicks", "item_quantity", "transaction_customers_sum", "product_day_visitors_sum"] as const;
export type DerivedMoneyPerCountV1 = Omit<MetricValue, "unit" | "aggregation" | "numerator" | "denominator" | "status"> & {
  metricSchemaVersion: typeof derivedMoneySchema; unit: "CNY_CENT_PER_COUNT"; aggregation: "ratio_of_sums";
  denominatorKind: typeof moneyDenominatorKinds[number]; numerator: number | null; denominator: number | null;
  status: "available" | "unavailable" | "invalid";
};
export type InsightWindow = { startDate: string; endDate: string; endExclusive: string; days: number };
export type InsightPeriods = { timezone: "Asia/Shanghai"; rule: string; ruleVersion: "sales-period-v1"; current: InsightWindow; previous: InsightWindow; yearAgo: InsightWindow };
export type SourceRevision = { domain: "netshop" | "sales" | "products" | "inventory" | "finance" | "erp_reference" | "workflow"; kind: string; scopeKey: string; revision: string };
export type SourceCoverage = { expectedShopDatePairs: number; coveredShopDatePairs: number; complete: boolean; missingByShop: Array<{ shopKey: string; dates: string[] }>; truncated: false };
export type InsightScope = { platforms: InsightPlatform[]; shopKeys: string[]; dimension: "sku" | "spu"; periodKind: typeof periodKinds[number] };
export type InsightsContext = {
  schemaVersion: typeof INSIGHTS_SCHEMA; requestId: string; scopeKey: string; snapshotToken: string;
  requestedScope: InsightScope; effectiveScope: InsightScope; periods: InsightPeriods;
  calendar: Array<{ date: string; previous: string | null; yearAgo: string | null }>;
  sourceRevisions: SourceRevision[]; coverageBySource: Record<string, SourceCoverage>;
  capabilities: Array<{ sourceId: string; period: "current" | "previous" | "yearAgo"; field: "payment" | "visitors" | "customers" | "quantity" | "addCartCustomers" | "spend" | "attributedPayment"; coverageRef: string; presentShopDatePairs: number; status: "available" | "unavailable"; reasonCode: "missing_field" | "missing_day" | "no_records" | null }>;
  freshness: Array<{ sourceId: string; dataThrough: string | null }>; limitations: string[];
};
export type InsightPagination = { page: number; pageSize: number; total: number; returned: number; hasMore: boolean; truncated: boolean };
export type InsightSections<T> = { context: InsightsContext; sections: T; pagination?: InsightPagination };

function fail(message: string): never { throw new NetshopQueryError("invalid_insights_contract", message); }
function record(v: unknown): Record<string, unknown> { if (!v || typeof v !== "object" || Array.isArray(v)) return fail("共享响应对象无效"); return v as Record<string, unknown>; }
function text(v: unknown, max = 200): v is string { return typeof v === "string" && v.trim().length > 0 && v.length <= max; }
function integer(v: unknown, max: number): v is number { return Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= max; }
function token(v: unknown): v is string { return typeof v === "string" && /^[a-f0-9]{64}$/.test(v); }
export function encodeProductIdentity(identity: ProductIdentity): string {
  if (!["京东", "天猫"].includes(identity.platform) || !["sku", "spu"].includes(identity.dimension) || identity.platform === "天猫" && identity.dimension === "sku" || !text(identity.id) || /[\u0000-\u001f\u007f]/.test(identity.id)) return fail("商品精确身份无效");
  const [outlet] = readNetshopOutletFilters([netshopOutletKey(identity.platform, identity.shopName)]);
  return JSON.stringify([outlet.platform, outlet.shopName, identity.dimension, identity.id]);
}
export function decodeMetric(value: unknown): MetricValue {
  const m = record(value);
  if (typeof m.unit !== "string" || typeof m.status !== "string" || typeof m.basis !== "string" || typeof m.aggregation !== "string" || !["CNY_CENT", "COUNT", "RATIO", "MULTIPLE", "SECONDS"].includes(m.unit) || !["available", "partial", "unavailable", "invalid"].includes(m.status) || !["product_day_sum", "platform_attributed", "erp_net_sales", "erp_order_margin", "erp_large_margin", "finance_month", "current_snapshot", "unverified"].includes(m.basis) || !["sum", "ratio_of_sums", "source_value_only"].includes(m.aggregation) || !text(m.coverageRef) || !Array.isArray(m.sourceIds) || m.sourceIds.length > 50 || !m.sourceIds.every(s => text(s)) || m.reasonCode !== null && !metricReasons.includes(m.reasonCode as MetricReason)) return fail("共享指标定义无效");
  if (m.status === "available" || m.status === "partial") {
    if (typeof m.value !== "number" || !Number.isFinite(m.value) || ["COUNT", "CNY_CENT"].includes(String(m.unit)) && !Number.isSafeInteger(m.value) || m.sourceIds.length === 0 || m.basis === "unverified") return fail("共享指标数值或来源无效");
  } else if (m.value !== null) return fail("不可用指标须为空");
  if (new Set(m.sourceIds as string[]).size !== (m.sourceIds as string[]).length) return fail("指标来源引用重复");
  if (m.status === "available" && m.reasonCode !== null || m.status !== "available" && m.reasonCode === null || m.status === "partial" && (m.aggregation !== "sum" || ["RATIO", "MULTIPLE"].includes(String(m.unit)))) return fail("指标四态与原因不一致");
  for (const key of ["numerator", "denominator"]) if (m[key] !== undefined && m[key] !== null && (typeof m[key] !== "number" || !Number.isFinite(m[key]))) return fail("比率输入无效");
  if (m.numerator !== undefined || m.denominator !== undefined) {
    if (m.aggregation !== "ratio_of_sums" || m.status === "available" && (typeof m.numerator !== "number" || typeof m.denominator !== "number" || m.denominator <= 0)) return fail("比率分子分母与可用状态不一致");
    if (m.status === "available") {
      const expected = Number(m.numerator)/Number(m.denominator);
      if (!Number.isFinite(expected) || Math.abs(expected-Number(m.value)) > 1e-12*Math.max(1, Math.abs(expected), Math.abs(Number(m.value)))) return fail("比率与已提供分子分母不一致");
    }
  }
  return m as MetricValue;
}
/** Derived monetary prices are versioned separately; transaction amounts and
 * COUNT retain their original safe-integer contract. No rounding precedes use.
 */
export function decodeDerivedMoneyPerCount(value: unknown): DerivedMoneyPerCountV1 {
  const m = record(value);
  if (m.metricSchemaVersion !== derivedMoneySchema || m.unit !== "CNY_CENT_PER_COUNT" || m.aggregation !== "ratio_of_sums" || typeof m.denominatorKind !== "string" || !moneyDenominatorKinds.includes(m.denominatorKind as typeof moneyDenominatorKinds[number]) || typeof m.status !== "string" || !["available", "unavailable", "invalid"].includes(m.status) || typeof m.basis !== "string" || !["product_day_sum", "platform_attributed", "erp_net_sales", "erp_order_margin", "erp_large_margin", "finance_month", "current_snapshot", "unverified"].includes(m.basis) || m.reasonCode !== null && (typeof m.reasonCode !== "string" || !metricReasons.includes(m.reasonCode as MetricReason)) || !("numerator" in m) || !("denominator" in m)) return fail("派生货币单价版本、单位或分母定义无效");
  for (const key of ["numerator", "denominator"]) if (m[key] !== null && !Number.isSafeInteger(m[key])) return fail("派生货币单价须以安全整数分和次数计算");
  if (m.status === "available" && (typeof m.numerator !== "number" || typeof m.denominator !== "number" || m.denominator <= 0 || m.denominatorKind === "clicks" && m.numerator < 0)) return fail("派生货币单价分子分母无效");
  // Reuse four-state/source/reason/ratio consistency checks without widening
  // decodeMetric's monetary unit. This validation proxy is never returned.
  decodeMetric({ ...m, unit: "RATIO" });
  if (m.status === "available" && m.value !== Number(m.numerator) / Number(m.denominator)) return fail("派生货币单价必须保留整数分/次数的未舍入商");
  return m as DerivedMoneyPerCountV1;
}
export function compareDerivedMoneyPerCount(current: DerivedMoneyPerCountV1, baseline: DerivedMoneyPerCountV1): MetricComparison {
  const a = decodeDerivedMoneyPerCount(current), b = decodeDerivedMoneyPerCount(baseline);
  const sameSources = JSON.stringify([...a.sourceIds].sort()) === JSON.stringify([...b.sourceIds].sort());
  const reason: MetricReason | null = a.metricSchemaVersion !== b.metricSchemaVersion || a.denominatorKind !== b.denominatorKind || a.basis !== b.basis || !sameSources ? "not_applicable" : a.status !== "available" || b.status !== "available" ? "incomplete_baseline" : b.value === 0 ? "zero_denominator" : Number(b.value) < 0 ? "negative_baseline" : null;
  const value = reason ? null : (Number(a.value) - Number(b.value)) / Number(b.value);
  return { method: "relative_change", value: value !== null && Number.isFinite(value) ? value : null, status: reason || value === null || !Number.isFinite(value) ? "unavailable" : "available", reasonCode: reason ?? (value === null || !Number.isFinite(value) ? "unsafe_integer" : null) };
}
export function formatDerivedMoneyPerCount(value: DerivedMoneyPerCountV1): string {
  const m = decodeDerivedMoneyPerCount(value);
  if (m.value === null) return "—";
  const labels = { clicks: "点击", item_quantity: "件", transaction_customers_sum: "成交客户累计", product_day_visitors_sum: "商品访客累计" };
  if (m.value !== 0 && Math.abs(m.value / 100) < .0001) return `${m.value > 0 ? "<0.0001" : ">-0.0001"} 元/${labels[m.denominatorKind]}`;
  return `${(m.value / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} 元/${labels[m.denominatorKind]}`;
}
/** Explicit overview adapter: validate the accepted DTO before adding refs. */
export function adaptOverview(response: unknown) {
  const overview = decodeStoreOverview(response);
  const metrics = Object.fromEntries(Object.entries(overview.summary).map(([key, metric]) => [key, adaptOverviewMetric(metric, `overview:${overview.scopeKey}:${key}`)]));
  return { overview, metrics } as { overview: StoreOverviewResponse; metrics: Record<keyof StoreOverviewResponse["summary"], MetricValue> };
}
export function adaptOverviewMetric(metric: OverviewMetric, coverageRef: string): MetricValue { return decodeMetric({ ...metric, coverageRef }); }
export function compareMetrics(currentValue: MetricValue, baselineValue: MetricValue): MetricComparison {
  const a = decodeMetric(currentValue), b = decodeMetric(baselineValue);
  const method = a.unit === "RATIO" ? "percentage_points" : "relative_change";
  const reason = a.unit !== b.unit || a.basis !== b.basis || JSON.stringify([...a.sourceIds].sort()) !== JSON.stringify([...b.sourceIds].sort()) ? "not_applicable" : a.status !== "available" || b.status !== "available" ? "incomplete_baseline" : method === "relative_change" && b.value === 0 ? "zero_denominator" : method === "relative_change" && Number(b.value) < 0 ? "negative_baseline" : null;
  const value = reason ? null : method === "percentage_points" ? (Number(a.value)-Number(b.value))*100 : (Number(a.value)-Number(b.value))/Number(b.value);
  if (value !== null && !Number.isFinite(value)) return { value: null, method, status: "unavailable", reasonCode: "unsafe_integer" };
  return { value, method, status: reason ? "unavailable" : "available", reasonCode: reason };
}
export function formatMetric(metric: MetricValue): string {
  const m = decodeMetric(metric); if (m.value === null) return "—";
  const v = m.unit === "CNY_CENT" ? m.value / 100 : m.unit === "RATIO" ? m.value * 100 : m.value;
  return `${v.toLocaleString("zh-CN", { maximumFractionDigits: m.unit === "COUNT" ? 0 : 2 })}${m.unit === "CNY_CENT" ? " 元" : m.unit === "RATIO" ? "%" : m.unit === "MULTIPLE" ? " 倍" : m.unit === "SECONDS" ? " 秒" : ""}`;
}
export function validateContextQuery(params: URLSearchParams) {
  const allowed = new Set(["platform", "outlet", "dimension", "startDate", "endDate", "periodKind", "snapshotToken"]);
  for (const key of params.keys()) if (!allowed.has(key) || !["platform", "outlet"].includes(key) && params.getAll(key).length !== 1) return fail("共享请求包含未知或重复参数");
  const platforms = params.getAll("platform"), outlets = params.getAll("outlet"), kind = params.get("periodKind") ?? "custom", dimension = params.get("dimension") ?? "spu";
  if (!platforms.length || platforms.length > 2 || new Set(platforms).size !== platforms.length || platforms.some(p => !["天猫", "京东"].includes(p)) || !periodKinds.includes(kind as typeof periodKinds[number]) || !["sku", "spu"].includes(dimension) || dimension === "sku" && platforms.includes("天猫") || new Set(outlets).size !== outlets.length) return fail("共享范围、日期意图或维度无效");
  const shops = readNetshopOutletFilters(outlets);
  if (shops.some(s => !platforms.includes(s.platform))) return fail("店铺不属于所选平台");
  const w = resolveNetshopQueryPeriod(params.get("startDate"), params.get("endDate"), insightBudget.days);
  if (!w || params.has("snapshotToken") && !token(params.get("snapshotToken"))) return fail("共享日期或版本无效");
  const presetDays = { today: 1, yesterday: 1, last7: 7, last15: 15, last30: 30 };
  if (kind in presetDays && w.days !== presetDays[kind as keyof typeof presetDays]) return fail("预设意图与日期不一致");
  return { platforms, shops, window: w, kind, dimension };
}
function windowValue(v: unknown, maximumDays = 366): InsightWindow {
  const w = record(v), actual = resolveNetshopQueryPeriod(String(w.startDate), String(w.endDate), maximumDays);
  if (!actual || actual.endExclusive !== w.endExclusive || actual.days !== w.days) return fail("共享比较日期无效");
  return w as InsightWindow;
}
function scopeValue(v: unknown): InsightScope {
  const s = record(v);
  if (!Array.isArray(s.platforms) || !s.platforms.length || s.platforms.length > 2 || new Set(s.platforms).size !== s.platforms.length || s.platforms.some(p => !["天猫", "京东"].includes(String(p))) || !Array.isArray(s.shopKeys) || s.shopKeys.length > 50 || new Set(s.shopKeys).size !== s.shopKeys.length || !s.shopKeys.every(k => typeof k === "string") || !["sku", "spu"].includes(String(s.dimension)) || s.dimension === "sku" && s.platforms.includes("天猫") || !periodKinds.includes(s.periodKind as typeof periodKinds[number])) return fail("共享响应范围无效");
  if (readNetshopOutletFilters(s.shopKeys as string[]).some(o => !(s.platforms as string[]).includes(o.platform))) return fail("店铺平台与范围不一致");
  return s as InsightScope;
}
export function decodeInsightsContext(v: unknown): InsightsContext {
  if (new TextEncoder().encode(JSON.stringify(v)).length > insightBudget.responseBytes) return fail("共享响应超出2MiB");
  const p = record(v);
  if (p.schemaVersion !== INSIGHTS_SCHEMA || !token(p.scopeKey) || !token(p.snapshotToken) || !text(p.requestId, 128)) return fail("共享协议或令牌无效");
  const requested = scopeValue(p.requestedScope), effective = scopeValue(p.effectiveScope), w = record(p.periods);
  if (requested.dimension !== effective.dimension || requested.periodKind !== effective.periodKind || requested.platforms.join() !== effective.platforms.join() || requested.shopKeys.length && requested.shopKeys.join() !== effective.shopKeys.join() || w.timezone !== "Asia/Shanghai" || w.ruleVersion !== "sales-period-v1" || !text(w.rule)) return fail("共享有效范围或规则无效");
  const windows = { current: windowValue(w.current), previous: windowValue(w.previous, 367), yearAgo: windowValue(w.yearAgo, 367) };
  if (!Array.isArray(p.calendar) || p.calendar.length !== windows.current.days) return fail("比较日历不完整");
  const used = { previous: new Set<string>(), yearAgo: new Set<string>() };
  for (const [i, raw] of p.calendar.entries()) {
    const row = record(raw), expected = new Date(Date.parse(windows.current.startDate+"T00:00:00Z")+i*86400000).toISOString().slice(0, 10);
    if (row.date !== expected) return fail("比较日历日期无效");
    for (const kind of ["previous", "yearAgo"] as const) if (row[kind] !== null) {
      if (typeof row[kind] !== "string" || !isNetshopIsoDate(row[kind]) || row[kind] < windows[kind].startDate || row[kind] > windows[kind].endDate || used[kind].has(row[kind])) return fail("比较日历重复或越界");
      used[kind].add(row[kind]);
    }
  }
  if (!Array.isArray(p.sourceRevisions) || !p.sourceRevisions.length || p.sourceRevisions.length > 105) return fail("来源向量超限");
  const revisionKeys = new Set<string>();
  const expectedRevisionKinds = ["owning_revision", ...effective.platforms.flatMap(platform => [platform+":promotionManifest", ...effective.shopKeys.filter(k => k.startsWith(platform+"\u001f")).flatMap(k => [platform+":product:"+k, platform+":promotion:"+k])])];
  if (p.sourceRevisions.length !== expectedRevisionKinds.length || record(p.sourceRevisions[0]).kind !== "owning_revision") return fail("拥有方来源向量不完整");
  for (const raw of p.sourceRevisions) {
    const r = record(raw), key = JSON.stringify([r.domain, r.kind, r.scopeKey]);
    const revisionValid = r.kind === "owning_revision" ? /^\d+:[a-f0-9]{12}$/.test(String(r.revision)) : String(r.kind).endsWith(":promotionManifest") ? r.revision === "absent" || /^\d+:(True|False)$/.test(String(r.revision)) : r.revision === "absent" || /^\d+$/.test(String(r.revision));
    if (r.domain !== "netshop" || !text(r.kind) || !expectedRevisionKinds.includes(r.kind) || !revisionValid || r.scopeKey !== p.scopeKey || revisionKeys.has(key)) return fail("来源向量重复、缺成员或跨范围"); revisionKeys.add(key);
  }
  const coverages = record(p.coverageBySource);
  const sources = effective.platforms.flatMap(platform => platform === "京东" ? [`jd_sku_daily:${effective.dimension}_daily:京东`, "jd_promotion:ad:京东"] : ["tmall_product_daily:spu_daily:天猫", "tmall_promotion:promotion_daily:天猫"]);
  const expectedRefs = sources.flatMap(source => ["current", "previous", "yearAgo"].map(kind => `${source}:${kind}`));
  if (Object.keys(coverages).length !== expectedRefs.length || expectedRefs.some(ref => !(ref in coverages))) return fail("覆盖来源不完整");
  for (const [ref, raw] of Object.entries(coverages)) {
    const c = record(raw), kind = ref.split(":").at(-1) as keyof typeof windows, expected = effective.shopKeys.filter(k => k.startsWith(ref.split(":")[2]+"\u001f")).length * (windows[kind]?.days ?? 0);
    if (!windows[kind] || c.expectedShopDatePairs !== expected || !integer(c.coveredShopDatePairs, expected) || c.truncated !== false || c.complete !== (expected > 0 && c.coveredShopDatePairs === expected) || !Array.isArray(c.missingByShop) || c.missingByShop.length > 50) return fail("来源覆盖统计无效");
    let missing = 0; const shops = new Set<string>();
    for (const rawMissing of c.missingByShop) {
      const m = record(rawMissing);
      if (typeof m.shopKey !== "string" || !m.shopKey.startsWith(ref.split(":")[2]+"\u001f") || !effective.shopKeys.includes(m.shopKey) || shops.has(m.shopKey) || !Array.isArray(m.dates) || !m.dates.length || m.dates.length > windows[kind].days || new Set(m.dates).size !== m.dates.length || !m.dates.every(d => typeof d === "string" && isNetshopIsoDate(d) && d >= windows[kind].startDate && d <= windows[kind].endDate)) return fail("逐店缺日无效");
      shops.add(m.shopKey); missing += m.dates.length;
    }
    if (expected-missing !== c.coveredShopDatePairs) return fail("缺日与覆盖不一致");
  }
  if (!Array.isArray(p.capabilities) || p.capabilities.length !== effective.platforms.length*21) return fail("字段能力不完整");
  const capabilities = new Set<string>();
  for (const raw of p.capabilities) {
    const c = record(raw), coverage = record(coverages[String(c.coverageRef)]), key = JSON.stringify([c.sourceId, c.period, c.field]);
    const fields = String(c.sourceId).includes("promotion") ? ["spend", "attributedPayment"] : ["payment", "visitors", "customers", "quantity", "addCartCustomers"];
    if (!text(c.sourceId) || !sources.includes(c.sourceId) || !["current", "previous", "yearAgo"].includes(String(c.period)) || !fields.includes(String(c.field)) || c.coverageRef !== `${c.sourceId}:${c.period}` || !integer(c.presentShopDatePairs, Number(coverage.coveredShopDatePairs)) || !["available", "unavailable"].includes(String(c.status)) || c.status === "available" && (c.reasonCode !== null || !coverage.complete || c.presentShopDatePairs !== coverage.expectedShopDatePairs) || c.status === "unavailable" && !["missing_field", "missing_day", "no_records"].includes(String(c.reasonCode)) || capabilities.has(key)) return fail("字段能力与覆盖不一致"); capabilities.add(key);
  }
  if (!Array.isArray(p.freshness) || p.freshness.length !== sources.length || new Set(p.freshness.map(raw => record(raw).sourceId)).size !== sources.length || !p.freshness.every(raw => { const r = record(raw); return typeof r.sourceId === "string" && sources.includes(r.sourceId) && (r.dataThrough === null || typeof r.dataThrough === "string" && isNetshopIsoDate(r.dataThrough)); }) || !Array.isArray(p.limitations) || p.limitations.length > 20 || !p.limitations.every(s => text(s, 500))) return fail("来源截止或限制无效");
  return p as InsightsContext;
}
/** Bind a successful, internally valid DTO to this request and owning header.
 * Snapshot strings are echoed only within this endpoint's token kind; owning
 * revision equality uses the explicitly typed netshop member instead.
 */
export function decodeInsightsContextForQuery(value: unknown, query: URLSearchParams, owningRevision: string | null): InsightsContext {
  const expected = validateContextQuery(query), p = decodeInsightsContext(value);
  const platforms = [...expected.platforms].sort(), shops = expected.shops.map(o => netshopOutletKey(o.platform, o.shopName)).sort();
  const sorted = (values: readonly string[]) => JSON.stringify([...values].sort());
  if (sorted(p.requestedScope.platforms) !== sorted(platforms) || sorted(p.requestedScope.shopKeys) !== sorted(shops) || p.requestedScope.dimension !== expected.dimension || p.requestedScope.periodKind !== expected.kind || p.periods.current.startDate !== expected.window.startDate || p.periods.current.endDate !== expected.window.endDate || p.periods.current.endExclusive !== expected.window.endExclusive || p.periods.current.days !== expected.window.days) return fail("共享响应不属于当前请求范围");
  if (query.has("snapshotToken") && p.snapshotToken !== query.get("snapshotToken")) return fail("共享响应令牌不属于原请求");
  const owning = p.sourceRevisions.find(r => r.domain === "netshop" && r.kind === "owning_revision");
  if (!owningRevision || owning?.revision !== owningRevision) return fail("共享响应拥有方版本与响应头不一致");
  return p;
}
/** Comparing opaque token strings across kinds is never a consistency check. */
export function sameRevisionVector(a: SourceRevision[], b: SourceRevision[]): boolean {
  const normalize = (v: SourceRevision[]) => v.map(r => JSON.stringify([r.domain, r.kind, r.scopeKey, r.revision])).sort();
  return a.length === b.length && new Set(normalize(a)).size === a.length && JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}
export function decodeInsightPagination(value: unknown): InsightPagination {
  const p = record(value);
  if (!integer(p.page, 10000) || Number(p.page) < 1 || !integer(p.pageSize, 100) || Number(p.pageSize) < 1 || !integer(p.total, Number.MAX_SAFE_INTEGER) || !integer(p.returned, Number(p.pageSize)) || typeof p.truncated !== "boolean" || p.hasMore !== ((Number(p.page)-1)*Number(p.pageSize)+Number(p.returned) < Number(p.total)) || Number(p.returned) > Math.max(0, Number(p.total)-(Number(p.page)-1)*Number(p.pageSize))) return fail("分页元数据无效");
  return p as InsightPagination;
}
/** AI projection keeps every scope/source/field/coverage entry, with lossless
 * consecutive missing-day ranges. It is not the daily comparison calendar.
 * The registry/handler remains I's single-write responsibility.
 */
export function compactInsightsContext(value: unknown, maximumCharacters = 40_000) {
  const p = decodeInsightsContext(value);
  const ranges = (dates: string[]) => {
    const result: Array<{ startDate: string; endDate: string; days: number }> = [];
    for (const day of [...dates].sort()) {
      const last = result.at(-1);
      if (last && Date.parse(day+"T00:00:00Z")-Date.parse(last.endDate+"T00:00:00Z") === 86400000) { last.endDate = day; last.days++; }
      else result.push({ startDate: day, endDate: day, days: 1 });
    }
    return result;
  };
  const projection = {
    schemaVersion: p.schemaVersion, projection: "complete_coverage_ranges_v1", requestId: p.requestId, scopeKey: p.scopeKey, snapshotToken: p.snapshotToken,
    requestedScope: p.requestedScope, effectiveScope: p.effectiveScope, periods: p.periods, sourceRevisions: p.sourceRevisions,
    coverageBySource: Object.fromEntries(Object.entries(p.coverageBySource).map(([ref, c]) => [ref, { ...c, missingByShop: c.missingByShop.map(s => ({ shopKey: s.shopKey, missingRanges: ranges(s.dates) })) }])),
    capabilities: p.capabilities, freshness: p.freshness, limitations: [...p.limitations, "此投影省略日历明细，未截断任何店铺、来源、字段或覆盖缺口"],
  };
  if (!Number.isSafeInteger(maximumCharacters) || maximumCharacters < 1 || maximumCharacters > 40000 || JSON.stringify(projection).length > maximumCharacters) throw new NetshopQueryError("insights_projection_too_large", "完整覆盖投影超出字符预算，请缩小店铺或日期范围");
  return projection;
}
export function pairExactProducts<T extends ProductIdentity>(current: T[], baseline: T[]): Array<{ current: T; baseline: T | null }> {
  const map = new Map<string, T>();
  for (const item of baseline) { const key = encodeProductIdentity(item); if (map.has(key)) return fail("基期身份重复"); map.set(key, item); }
  const seen = new Set<string>();
  return current.map(item => { const key = encodeProductIdentity(item); if (seen.has(key)) return fail("本期身份重复"); seen.add(key); return { current: item, baseline: map.get(key) ?? null }; });
}
