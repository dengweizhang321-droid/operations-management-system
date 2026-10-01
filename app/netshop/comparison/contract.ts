import {
  decodeMetric, decodeDerivedMoneyPerCount, decodeInsightsContextForQuery, decodeInsightPagination,
  compareMetrics, compareDerivedMoneyPerCount, insightBudget, metricReasons, validateContextQuery,
  type MetricValue, type DerivedMoneyPerCountV1, type MetricComparison, type InsightsContext,
  type SourceRevision, type SourceCoverage, type InsightPagination, type InsightPlatform, type MetricReason,
} from "@/lib/netshop/insights-contract";
import { NetshopQueryError, resolveNetshopQueryPeriod, readNetshopOutletFilters } from "@/lib/netshop/query-contract";
import type { CategoryEvidence, ContributionBucket } from "../products/contract";

export const COMPARISON_SCHEMA = "netshop-comparison-v1" as const;
export const comparisonMetricKeys = ["payment", "quantity", "visitors", "customers", "conversion", "visitorValue", "transactionOrders", "spend", "attributedPayment", "roas", "ctr", "cpc", "spendRate", "erpNetSales", "orderMargin", "largeMargin", "largeMarginAmount", "erpOrderCount", "averageOrderValue", "returnQuantity", "returnRate"] as const;
export type ComparisonMetricKey = typeof comparisonMetricKeys[number];
export const comparisonSorts = ["value_desc", "value_asc", "growth_desc", "decline_desc", "name_asc"] as const;
export type ComparisonSort = typeof comparisonSorts[number];
export type ComparisonMetric = MetricValue | DerivedMoneyPerCountV1;
export type ComparisonMetrics = Record<ComparisonMetricKey, ComparisonMetric>;
export type ComparisonComparisons = Record<ComparisonMetricKey, MetricComparison>;
export type ComparisonCategory = { mode: "all" | "unknown" } | { mode: "label_only"; platform: InsightPlatform; sourceId: string; label: string; evidenceVersion: string };
export type ComparisonScope = { schemaVersion: "comparison-scope-v1"; mode: "shop" | "platform"; metricSource: "platform" | "erp"; category: ComparisonCategory; coverageFilter: "all" | "complete" | "partial" };
export type SelectedBaseline = { kind: "previous" | "yearAgo" } | { kind: "custom"; startDate: string; endDate: string };
export type ComparisonIntent = ComparisonScope & { selectedBaseline: SelectedBaseline };
export type ComparisonPrefs = { schemaVersion: "comparison-ui-v1"; metricKey: ComparisonMetricKey; chartObjectKeys: string[]; columnKeys: string[]; sort: ComparisonSort };
export const defaultComparisonScope: ComparisonScope = { schemaVersion: "comparison-scope-v1", mode: "shop", metricSource: "platform", category: { mode: "all" }, coverageFilter: "all" };
export class ComparisonResponseError extends Error { readonly status = 502; readonly code = "invalid_comparison_contract"; }
function fail(message: string): never { throw new ComparisonResponseError(message); }
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) return fail("对比响应对象不完整"); return value as Record<string, unknown>; }
function text(value: unknown, maximum = 500): value is string { return typeof value === "string" && value.length > 0 && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value); }
function referenceText(value: unknown, maximum = 500): value is string { return typeof value === "string" && value.length > 0 && value.length <= maximum && !/[\u0000-\u001e\u007f]/.test(value); }
function exact(value: Record<string, unknown>, keys: string[]) { if (Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => !(key in value))) fail("对比参数字段不完整或未知"); }
function strings(value: unknown, maximum = 50, length = 500): string[] { if (!Array.isArray(value) || value.length > maximum || !value.every(v => text(v, length))) return fail("对比文本列表无效"); return value; }
function shopKeys(value: unknown): string[] { if (!Array.isArray(value) || value.length > 50 || !value.every(v => typeof v === "string")) return fail("店铺精确键无效"); readNetshopOutletFilters(value); if (new Set(value).size !== value.length) fail("店铺精确键重复"); return value; }
function count(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number { if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > maximum) return fail("对比计数无效"); return Number(value); }
function token(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function enumValue(value: unknown, values: readonly string[]): value is string { return typeof value === "string" && values.includes(value); }
export function decodeComparisonScope(value: unknown): ComparisonScope {
  const scope = object(value); exact(scope, ["schemaVersion", "mode", "metricSource", "category", "coverageFilter"]);
  if (scope.schemaVersion !== "comparison-scope-v1" || !enumValue(scope.mode, ["shop", "platform"]) || !enumValue(scope.metricSource, ["platform", "erp"]) || !enumValue(scope.coverageFilter, ["all", "complete", "partial"])) fail("对比模式或覆盖筛选无效");
  const category = object(scope.category);
  if (category.mode === "all" || category.mode === "unknown") exact(category, ["mode"]);
  else if (category.mode === "label_only") {
    exact(category, ["mode", "platform", "sourceId", "label", "evidenceVersion"]);
    if (!enumValue(category.platform, ["京东", "天猫"]) || !text(category.sourceId, 200) || !text(category.label, 120) || !text(category.evidenceVersion, 200)) fail("类目标签来源证据无效");
  } else fail("当前尚不支持未经验证的类目ID");
  return scope as ComparisonScope;
}
export function decodeSelectedBaseline(value: unknown): SelectedBaseline {
  const baseline = object(value);
  if (baseline.kind === "previous" || baseline.kind === "yearAgo") exact(baseline, ["kind"]);
  else if (baseline.kind === "custom") {
    exact(baseline, ["kind", "startDate", "endDate"]);
    if (typeof baseline.startDate !== "string" || typeof baseline.endDate !== "string" || !resolveNetshopQueryPeriod(baseline.startDate, baseline.endDate, insightBudget.days)) fail("自定义基期须为真实日期且不超过366天");
  } else fail("比较基期无效");
  return baseline as SelectedBaseline;
}
const sharedKeys = new Set(["platform", "outlet", "dimension", "startDate", "endDate", "periodKind", "snapshotToken"]);
const extraKeys = new Set(["comparisonScope", "selectedBaseline", "chartObjectKeys", "metricKey", "trendGrain", "page", "pageSize", "sort", "sectionToken"]);
export function comparisonContextQuery(params: URLSearchParams) { const result = new URLSearchParams(); for (const [key, value] of params) if (sharedKeys.has(key)) result.append(key, value); return result; }
export function validateComparisonQuery(params: URLSearchParams) {
  try {
    for (const key of params.keys()) if (!sharedKeys.has(key) && !extraKeys.has(key) || !["platform", "outlet"].includes(key) && params.getAll(key).length !== 1) fail("对比请求包含未知或重复参数");
    const shared = validateContextQuery(comparisonContextQuery(params));
    const scope = decodeComparisonScope(params.has("comparisonScope") ? JSON.parse(params.get("comparisonScope")!) : defaultComparisonScope);
    const baseline = decodeSelectedBaseline(params.has("selectedBaseline") ? JSON.parse(params.get("selectedBaseline")!) : { kind: "previous" });
    if (scope.category.mode === "label_only" && !shared.platforms.includes(scope.category.platform)) fail("类目不属于所选平台");
    const chartObjectKeys: string[] = params.has("chartObjectKeys") ? JSON.parse(params.get("chartObjectKeys")!) : [];
    validateObjectKeys(chartObjectKeys, 4);
    const metricKey = params.get("metricKey") ?? (scope.metricSource === "erp" ? "erpNetSales" : "payment"), sort = params.get("sort") ?? "value_desc", trendGrain = params.get("trendGrain") ?? "day";
    if (!(comparisonMetricKeys as readonly string[]).includes(metricKey) || !(comparisonSorts as readonly string[]).includes(sort) || !["day", "week", "month"].includes(trendGrain)) fail("对比指标、排序或粒度无效");
    const erpKeys = ["erpNetSales", "orderMargin", "largeMargin", "largeMarginAmount", "erpOrderCount", "averageOrderValue", "returnQuantity", "returnRate"];
    if (erpKeys.includes(metricKey) !== (scope.metricSource === "erp")) fail("对比指标与来源不一致");
    const positive = (key: string, fallback: number, max: number) => { const value = params.get(key); if (value === null) return fallback; if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > max) fail("分页无效"); return Number(value); };
    const page = positive("page", 1, 10000), pageSize = positive("pageSize", 20, 100);
    if (params.has("sectionToken") && !token(params.get("sectionToken"))) fail("对比分区令牌无效");
    return { shared, scope, baseline, chartObjectKeys, metricKey: metricKey as ComparisonMetricKey, sort: sort as ComparisonSort, trendGrain: trendGrain as "day" | "week" | "month", page, pageSize };
  } catch (error) { throw new NetshopQueryError("invalid_comparison_query", error instanceof Error ? error.message : "对比请求无效"); }
}
function validateObjectKeys(value: unknown, maximum: number): asserts value is string[] {
  if (!Array.isArray(value) || value.length > maximum || new Set(value).size !== value.length) fail("图表对象超过4个或重复");
  for (const key of value) {
    if (typeof key !== "string" || key.length > 210) fail("图表精确身份无效");
    if (key.startsWith("shop:")) readNetshopOutletFilters([key.slice(5)]);
    else if (!/^platform:(京东|天猫)$/.test(key)) fail("图表精确身份无效");
  }
}

export type ComparisonRow = { objectKey: string; kind: "shop" | "platform"; platform: InsightPlatform; shopName: string | null; shopKeys: string[]; current: ComparisonMetrics; baseline: ComparisonMetrics; comparisons: ComparisonComparisons; delta: ComparisonMetric; share: { current: ComparisonMetric; baseline: ComparisonMetric }; qualification: { currentComplete: boolean; baselineComplete: boolean; comparable: boolean }; exclusionReasons: string[] };
export type ComparisonTrendPoint = { date: string; bucketEnd: string; metric: ComparisonMetric };
export type ComparisonQualification = ComparisonRow["qualification"];
export type ComparisonPopulationRow = Pick<ComparisonRow, "objectKey" | "kind" | "platform" | "shopName" | "shopKeys" | "qualification" | "exclusionReasons"> & { currentPresence: boolean; baselinePresence: boolean };
export type ComparisonProductStructure = { collection: "complete_global_filter_set"; denominator: MetricValue; top5Payment: MetricValue; top10Payment: MetricValue; top5Share: MetricValue; top10Share: MetricValue; categories: ContributionBucket[]; priceBands: ContributionBucket[]; categoryBasis: "source_label_only"; priceBasis: "transaction_mean" };
export type ComparisonResponse = {
  schemaVersion: typeof COMPARISON_SCHEMA; currentContext: InsightsContext; baselineContext: InsightsContext;
  sectionToken: string; comparisonScope: ComparisonScope; selectedBaseline: SelectedBaseline;
  metricKey: ComparisonMetricKey; trendGrain: "day" | "week" | "month"; sort: ComparisonSort; chartObjectKeys: string[];
  joinedSourceRevisions: SourceRevision[]; consistency: "revision_vector_checked_non_atomic";
  sections: {
    scale: { metricKey: ComparisonMetricKey; summary: { current: ComparisonMetrics; baseline: ComparisonMetrics; comparisons: ComparisonComparisons; delta: ComparisonMetric }; items: ComparisonRow[]; pagination: InsightPagination; contributions: { continuousCurrent: ComparisonMetric; continuousBaseline: ComparisonMetric; continuousDelta: ComparisonMetric; scopeDelta: ComparisonMetric; status: "available" | "unavailable"; reasonCode: string | null } };
    efficiency: { items: string[]; distribution: Array<{ objectKey: string; metric: ComparisonMetric; qualification: ComparisonQualification }>; definitions: string[] };
    trends: { grain: "day" | "week" | "month"; items: Array<{ objectKey: string; current: ComparisonTrendPoint[]; baseline: ComparisonTrendPoint[]; indexBasis: { status: "available" | "unavailable"; reasonCode: MetricReason | null; current: ComparisonMetric; baseline: ComparisonMetric } }>; definitions: string[] };
    structure: { items: Array<{ objectKey: string; current: ComparisonProductStructure; baseline: ComparisonProductStructure; counts: { current: ComparisonMetric; baseline: ComparisonMetric } }>; categoryBasis: "reference_current_cohort"; sameProduct: { status: "unavailable"; reasonCode: "unmapped" }; categoryOptions: CategoryEvidence[]; definitions: string[] };
    promotion: { items: string[]; sourceDefinitions: string[]; sourceScopes: Array<{ period: "current" | "baseline"; scopeKey: string; snapshotToken: string; dimension: "sku" | "spu"; shopKeys: string[]; sourceRevisions: SourceRevision[]; coverageBySource: Record<string, SourceCoverage> }>; sourceStates: Array<{ period: "current" | "baseline"; platform: InsightPlatform; state: "ready" | "error" | "unavailable"; code: string | null }> };
    comparability: { items: ComparisonPopulationRow[]; counts: { candidates: number; currentComplete: number; baselineComplete: number; comparable: number; excluded: number }; periodRelationship: { sameLength: boolean; overlapDays: number }; limitations: string[]; population: "complete_authorized_candidate_union"; coverage: Record<string, SourceCoverage>; erpState: { state: "ready" | "error" | "unavailable" | "dependency_pending"; code: string | null } };
  };
};

function metric(value: unknown): ComparisonMetric { const m = object(value); return m.unit === "CNY_CENT_PER_COUNT" ? decodeDerivedMoneyPerCount(m) : decodeMetric(m); }
function metrics(value: unknown): ComparisonMetrics {
  const m = object(value); exact(m, [...comparisonMetricKeys]);
  for (const key of comparisonMetricKeys) {
    const v = metric(m[key]);
    const unit = ["visitorValue", "cpc", "averageOrderValue"].includes(key) ? "CNY_CENT_PER_COUNT" : ["payment", "spend", "attributedPayment", "erpNetSales", "orderMargin", "largeMarginAmount"].includes(key) ? "CNY_CENT" : key === "roas" ? "MULTIPLE" : ["conversion", "ctr", "spendRate", "largeMargin", "returnRate"].includes(key) ? "RATIO" : "COUNT";
    if (v.unit !== unit) fail("指标单位与定义不一致");
    const basis = key === "spendRate" || ["payment", "quantity", "visitors", "customers", "conversion", "visitorValue", "transactionOrders"].includes(key) ? "product_day_sum" : ["spend", "attributedPayment", "roas", "ctr", "cpc"].includes(key) ? "platform_attributed" : key === "orderMargin" ? "erp_order_margin" : ["largeMargin", "largeMarginAmount"].includes(key) ? "erp_large_margin" : "erp_net_sales";
    if (v.basis !== basis) fail("指标不能跨来源改称平台成交、ERP净额或毛利");
    if (key === "averageOrderValue" && v.status === "available") fail("当前协议尚无可信订单分母，不能把件均金额当客单价");
  }
  return m as ComparisonMetrics;
}
function compare(value: unknown, current: ComparisonMetric, baseline: ComparisonMetric): MetricComparison {
  const c = object(value), expected = current.unit === "CNY_CENT_PER_COUNT" && baseline.unit === "CNY_CENT_PER_COUNT" ? compareDerivedMoneyPerCount(current, baseline) : current.unit === "CNY_CENT_PER_COUNT" || baseline.unit === "CNY_CENT_PER_COUNT" ? null : compareMetrics(current, baseline);
  if (!expected || c.method !== expected.method || c.status !== expected.status || c.reasonCode !== expected.reasonCode || c.value !== expected.value) fail("比较结果与已验证分子分母或基期状态不一致");
  return c as MetricComparison;
}
function comparisons(value: unknown, current: ComparisonMetrics, baseline: ComparisonMetrics): ComparisonComparisons {
  const input = object(value); exact(input, [...comparisonMetricKeys]);
  return Object.fromEntries(comparisonMetricKeys.map(key => [key, compare(input[key], current[key], baseline[key])])) as ComparisonComparisons;
}
function deltaMetric(value: unknown, current: ComparisonMetric, baseline: ComparisonMetric) {
  const d = metric(value);
  if (d.unit !== current.unit || d.basis !== current.basis || stable(d.sourceIds) !== stable(current.sourceIds) || d.coverageRef !== current.coverageRef) fail("差额单位、来源和覆盖必须保留所选指标语义");
  if (current.unit === "CNY_CENT_PER_COUNT") { if (d.status !== "unavailable" || d.reasonCode !== "not_applicable") fail("派生单价差额没有合法分子分母时不能伪造"); return; }
  const compatible = current.unit === baseline.unit && current.basis === baseline.basis && stable([...current.sourceIds].sort()) === stable([...baseline.sourceIds].sort());
  const reason = !compatible ? "not_applicable" : current.status !== "available" || baseline.status !== "available" ? "incomplete_baseline" : null;
  const expected = reason ? null : Number(current.value) - Number(baseline.value), unsafe = expected !== null && Math.abs(expected) > Number.MAX_SAFE_INTEGER;
  if (d.value !== (unsafe ? null : expected) || d.status !== (unsafe ? "invalid" : reason ? "unavailable" : "available") || d.reasonCode !== (unsafe ? "unsafe_integer" : reason)) fail("差额与完整两期所选指标不一致");
}
function qualification(value: unknown): ComparisonQualification {
  const q = object(value); exact(q, ["currentComplete", "baselineComplete", "comparable"]);
  if (Object.values(q).some(v => typeof v !== "boolean") || q.comparable && (!q.currentComplete || !q.baselineComplete)) fail("对象资格与两期完整性不一致");
  return q as ComparisonQualification;
}
function populationRow(value: unknown, mode: ComparisonScope["mode"], candidateShopKeys: Set<string>): ComparisonPopulationRow {
  const row = object(value); validateObjectKeys([row.objectKey], 1);
  const shops = shopKeys(row.shopKeys);
  if (new Set(shops).size !== shops.length || shops.some(key => !candidateShopKeys.has(key) || !key.startsWith(row.platform + "\u001f")) || row.kind !== mode || !enumValue(row.platform, ["京东", "天猫"])) fail("对比对象不属于授权精确候选集");
  if (mode === "shop" ? !text(row.shopName, 100) || row.objectKey !== "shop:" + row.platform + "\u001f" + row.shopName || shops.length !== 1 || shops[0] !== row.platform + "\u001f" + row.shopName : row.shopName !== null || row.objectKey !== "platform:" + row.platform) fail("平台与子店不能混排或失去精确身份");
  qualification(row.qualification); strings(row.exclusionReasons, 30, 500);
  if (row.currentPresence !== undefined && typeof row.currentPresence !== "boolean" || row.baselinePresence !== undefined && typeof row.baselinePresence !== "boolean") fail("两期存在性无效");
  return row as ComparisonPopulationRow;
}
function fullRows(value: unknown, all: Map<string, ComparisonPopulationRow>, metricKey: ComparisonMetricKey): ComparisonRow[] {
  if (!Array.isArray(value) || value.length > 100) return fail("排名页无效");
  const used = new Set<string>();
  return value.map(raw => {
    const row = object(raw), reference = all.get(String(row.objectKey));
    if (!reference || used.has(String(row.objectKey))) fail("排名对象不在全集或身份重复"); used.add(String(row.objectKey));
    for (const key of ["kind", "platform", "shopName", "shopKeys", "qualification", "exclusionReasons"] as const) if (JSON.stringify(row[key]) !== JSON.stringify(reference[key])) fail("排名资格与完整候选证据不一致");
    const current = metrics(row.current), baseline = metrics(row.baseline); comparisons(row.comparisons, current, baseline); deltaMetric(row.delta, current[metricKey], baseline[metricKey]);
    const share = object(row.share); if (metric(share.current).unit !== "RATIO" || metric(share.baseline).unit !== "RATIO") fail("份额必须保留比例单位");
    return row as ComparisonRow;
  });
}
function categoryEvidence(value: unknown): CategoryEvidence {
  const c = object(value);
  if (!enumValue(c.status, ["label_only", "unknown"]) || c.namespace !== null || c.id !== null || c.parentId !== null || c.effectiveFrom !== null || c.effectiveTo !== null || c.platform !== null && !enumValue(c.platform, ["京东", "天猫"]) || c.status === "label_only" && (!text(c.label, 120) || !text(c.sourceId, 200) || !text(c.version, 200))) fail("类目证据不能提升为官方字典或历史映射");
  return c as CategoryEvidence;
}
function structure(value: unknown): ComparisonProductStructure {
  const s = object(value);
  if (s.collection !== "complete_global_filter_set" || s.categoryBasis !== "source_label_only" || s.priceBasis !== "transaction_mean") fail("商品结构范围或价格带定义无效");
  for (const key of ["denominator", "top5Payment", "top10Payment", "top5Share", "top10Share"]) decodeMetric(s[key]);
  for (const key of ["categories", "priceBands"]) {
    if (!Array.isArray(s[key]) || (s[key] as unknown[]).length > 500) fail("商品结构分组无效");
    for (const raw of s[key] as unknown[]) { const b = object(raw); if (!text(b.label, 200)) fail("结构名称无效"); decodeMetric(b.payment); decodeMetric(b.share); decodeMetric(b.products); if (b.categoryEvidence) categoryEvidence(b.categoryEvidence); }
  }
  return s as ComparisonProductStructure;
}
function stable(value: unknown): string { if (Array.isArray(value)) return JSON.stringify(value.map(v => JSON.parse(stable(v)))); if (value && typeof value === "object") return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, JSON.parse(stable(v))]))); return JSON.stringify(value); }

function coverageRecord(value: unknown, allowedShopKeys?: Set<string>, windows?: InsightsContext["periods"]): Record<string, SourceCoverage> {
  const result = object(value);
  for (const [ref, raw] of Object.entries(result)) {
    if (!referenceText(ref, 400)) fail("来源覆盖引用无效");
    const c = object(raw), expected = count(c.expectedShopDatePairs, 50 * 367), covered = count(c.coveredShopDatePairs, expected);
    if (c.complete !== (expected > 0 && covered === expected) || c.truncated !== false || !Array.isArray(c.missingByShop) || c.missingByShop.length > 50) fail("来源覆盖统计无效");
    let missing = 0; const used = new Set<string>();
    for (const rawMissing of c.missingByShop) { const m = object(rawMissing); readNetshopOutletFilters([String(m.shopKey)]); if (allowedShopKeys && !allowedShopKeys.has(String(m.shopKey)) || used.has(String(m.shopKey)) || !Array.isArray(m.dates) || !m.dates.length || m.dates.length > 367 || new Set(m.dates).size !== m.dates.length || !m.dates.every(date => typeof date === "string" && resolveNetshopQueryPeriod(date, date, 1))) fail("来源逐店缺日无效"); used.add(String(m.shopKey)); missing += m.dates.length;
      if (windows) { const matched = ref.match(/:(current|baseline|previous|yearAgo)(?:$|:)/)?.[1]; const period = (matched === "baseline" ? "current" : matched) as "current" | "previous" | "yearAgo" | undefined; if (!period || m.dates.some(date => String(date) < windows[period].startDate || String(date) > windows[period].endDate)) fail("覆盖缺日不属于真实所属日期窗口"); }
    }
    if (expected - covered !== missing) fail("来源覆盖与逐店缺口不一致");
  }
  return result as Record<string, SourceCoverage>;
}

/** Every successful response is bound to two complete F envelopes and this UI request. */
export function decodeComparisonInsights(value: unknown, params: URLSearchParams, owningRevision: string | null): ComparisonResponse {
  try {
    if (new TextEncoder().encode(JSON.stringify(value)).length > insightBudget.responseBytes) fail("对比响应超过2MiB，请缩小范围");
    const input = object(value), expected = validateComparisonQuery(params);
    if (input.schemaVersion !== COMPARISON_SCHEMA || !token(input.sectionToken) || input.consistency !== "revision_vector_checked_non_atomic") fail("对比协议或一致性说明无效");
    const current = decodeInsightsContextForQuery(input.currentContext, comparisonContextQuery(params), owningRevision);
    const baselineQuery = comparisonContextQuery(params); baselineQuery.delete("snapshotToken"); baselineQuery.set("periodKind", "custom");
    const window = expected.baseline.kind === "custom" ? expected.baseline : current.periods[expected.baseline.kind];
    baselineQuery.set("startDate", window.startDate); baselineQuery.set("endDate", window.endDate);
    const baseline = decodeInsightsContextForQuery(input.baselineContext, baselineQuery, owningRevision);
    const scope = decodeComparisonScope(input.comparisonScope), selected = decodeSelectedBaseline(input.selectedBaseline);
    if (stable(scope) !== stable(expected.scope) || stable(selected) !== stable(expected.baseline) || input.metricKey !== expected.metricKey || input.sort !== expected.sort || input.trendGrain !== expected.trendGrain) fail("对比响应不属于当前筛选");
    if (params.has("sectionToken") && input.sectionToken !== params.get("sectionToken")) fail("对比分区版本已变化");
    validateObjectKeys(input.chartObjectKeys, 4);
    if (expected.chartObjectKeys.length && stable(input.chartObjectKeys) !== stable(expected.chartObjectKeys)) fail("图表对象未按精确选择返回");
    if (!Array.isArray(input.joinedSourceRevisions) || input.joinedSourceRevisions.length > 630) fail("参与来源版本向量无效");
    const vectorKeys = new Set<string>();
    for (const raw of input.joinedSourceRevisions) {
      const r = object(raw), key = stable([r.domain, r.kind, r.scopeKey]);
      if (!enumValue(r.domain, ["netshop", "sales", "products", "inventory", "finance", "erp_reference", "workflow"]) || !referenceText(r.kind, 300) || !text(r.scopeKey, 200) || !text(r.revision, 200) || vectorKeys.has(key)) fail("参与来源重复或未明确版本类型"); vectorKeys.add(key);
    }
    const sections = object(input.sections); exact(sections, ["scale", "efficiency", "trends", "structure", "promotion", "comparability"]);
    const population = object(sections.comparability), candidateShopKeys = new Set([...current.effectiveScope.shopKeys, ...baseline.effectiveScope.shopKeys]);
    if (population.population !== "complete_authorized_candidate_union" || !Array.isArray(population.items) || population.items.length > 50) fail("对比候选集合不是完整授权两期集合");
    const all = new Map<string, ComparisonPopulationRow>();
    for (const raw of population.items) { const row = populationRow(raw, scope.mode, candidateShopKeys); if (all.has(row.objectKey) || typeof row.currentPresence !== "boolean" || typeof row.baselinePresence !== "boolean") fail("候选身份重复或两期存在性缺失"); all.set(row.objectKey, row); }
    const expectedObjects = scope.mode === "shop" ? [...candidateShopKeys].map(key => "shop:" + key) : [...new Set([...current.effectiveScope.platforms, ...baseline.effectiveScope.platforms])].map(platform => "platform:" + platform);
    if (all.size !== expectedObjects.length || expectedObjects.some(key => !all.has(key))) fail("两期完整候选遗漏对象，不能以当前排名页替代全集");
    if (scope.mode === "platform") for (const row of all.values()) { const keys = [...candidateShopKeys].filter(key => key.startsWith(row.platform + "\u001f")).sort(); if (stable([...row.shopKeys].sort()) !== stable(keys)) fail("平台遗漏精确子店，不能重复或漏累计"); }
    const counters = object(population.counts); for (const key of ["candidates", "currentComplete", "baselineComplete", "comparable", "excluded"]) count(counters[key], 50);
    if (counters.candidates !== all.size || counters.currentComplete !== [...all.values()].filter(r => r.qualification.currentComplete).length || counters.baselineComplete !== [...all.values()].filter(r => r.qualification.baselineComplete).length || counters.comparable !== [...all.values()].filter(r => r.qualification.comparable).length || counters.excluded !== all.size - Number(counters.comparable)) fail("完整候选资格计数不一致");
    const relationship = object(population.periodRelationship), overlapDays = Math.max(0, (Date.parse([current.periods.current.endDate, baseline.periods.current.endDate].sort()[0]) - Date.parse([current.periods.current.startDate, baseline.periods.current.startDate].sort()[1])) / 86400000 + 1);
    if (relationship.sameLength !== (current.periods.current.days === baseline.periods.current.days) || relationship.overlapDays !== overlapDays) fail("两期长度或重叠说明不一致"); strings(population.limitations, 50, 1000);
    const scale = object(sections.scale), page = decodeInsightPagination(scale.pagination), rows = fullRows(scale.items, all, expected.metricKey);
    if (scale.metricKey !== expected.metricKey || page.page !== expected.page || page.pageSize !== expected.pageSize || page.returned !== rows.length || page.truncated) fail("完整排名分页不一致");
    const filteredCandidates = [...all.values()].filter(row => scope.coverageFilter === "all" || (row.qualification.currentComplete && row.qualification.baselineComplete) === (scope.coverageFilter === "complete"));
    if (page.total !== filteredCandidates.length || page.returned !== Math.min(page.pageSize, Math.max(0, page.total - (page.page - 1) * page.pageSize))) fail("完整排名总数或返回数不能截断完整候选");
    const summary = object(scale.summary), cm = metrics(summary.current), bm = metrics(summary.baseline); comparisons(summary.comparisons, cm, bm); deltaMetric(summary.delta, cm[expected.metricKey], bm[expected.metricKey]);
    const contributions = object(scale.contributions); for (const key of ["continuousCurrent", "continuousBaseline", "continuousDelta", "scopeDelta"]) metric(contributions[key]);
    if (!enumValue(contributions.status, ["available", "unavailable"]) || contributions.status === "available" && contributions.reasonCode !== null || contributions.status === "unavailable" && !text(contributions.reasonCode)) fail("持续经营与统计范围拆分资格无效");
    const efficiency = object(sections.efficiency), promotion = object(sections.promotion), pageKeys = rows.map(row => row.objectKey);
    for (const section of [efficiency, promotion]) { validateObjectKeys(section.items, 100); if (stable(section.items) !== stable(pageKeys)) fail("效率与推广须精确引用同一服务端排名页"); }
    strings(efficiency.definitions, 30, 1000); strings(promotion.sourceDefinitions, 30, 1000);
    const coverage = coverageRecord(population.coverage, candidateShopKeys), erp = object(population.erpState);
    for (const [ref, cov] of Object.entries(coverage)) coverageRecord({ [ref]: cov }, candidateShopKeys, ref.startsWith("comparison:baseline:") ? baseline.periods : current.periods);
    if (!enumValue(erp.state, ["ready", "error", "unavailable", "dependency_pending"]) || erp.state === "ready" && erp.code !== null || erp.state !== "ready" && !text(erp.code, 200)) fail("ERP来源状态无效");
    if (!Array.isArray(promotion.sourceScopes) || promotion.sourceScopes.length > 4 || !Array.isArray(promotion.sourceStates) || promotion.sourceStates.length !== current.effectiveScope.platforms.length * 2) fail("推广所属范围或状态缺失");
    const coverageRefs = new Set([...Object.keys(current.coverageBySource), ...Object.keys(baseline.coverageBySource), ...Object.keys(coverage)]), sourceStateKeys = new Set<string>();
    const expectedVector = new Map<string, SourceRevision>();
    const sourceScopeKeys = new Set<string>();
    const addVector = (source: SourceRevision[]) => { for (const r of source) { const key = stable([r.domain, r.kind, r.scopeKey]); if (expectedVector.has(key) && expectedVector.get(key)!.revision !== r.revision) fail("同类同scope来源版本冲突"); expectedVector.set(key, r); } };
    addVector(current.sourceRevisions); addVector(baseline.sourceRevisions);
    for (const raw of promotion.sourceScopes) {
      const a = object(raw);
      if (!enumValue(a.period, ["current", "baseline"]) || !token(a.scopeKey) || !token(a.snapshotToken) || !enumValue(a.dimension, ["sku", "spu"]) || !Array.isArray(a.sourceRevisions) || !a.sourceRevisions.length) fail("推广所属两期范围无效");
      const keys = shopKeys(a.shopKeys), owner = a.period === "current" ? current : baseline;
      const entries = a.sourceRevisions.map(object), manifests = entries.filter(r => typeof r.kind === "string" && r.kind.endsWith(":promotionManifest"));
      if (manifests.length !== 1) fail("推广所属平台向量不完整"); const platform = String(manifests[0].kind).split(":")[0];
      const scopeMember = `${a.period}:${platform}`; if (sourceScopeKeys.has(scopeMember)) fail("推广所属两期平台scope重复"); sourceScopeKeys.add(scopeMember);
      if (!enumValue(platform, owner.effectiveScope.platforms) || (platform === "京东" ? a.dimension !== "sku" : a.dimension !== "spu") || stable([...keys].sort()) !== stable(owner.effectiveScope.shopKeys.filter(key => key.startsWith(platform + "\u001f")).sort())) fail("推广维度或授权精确店铺失配");
      const kinds = ["owning_revision", platform + ":promotionManifest", ...keys.flatMap(key => [platform + ":product:" + key, platform + ":promotion:" + key])], seenKinds = new Set<string>();
      if (entries.length !== kinds.length) fail("推广所属来源成员不完整");
      for (const r of entries) { if (r.domain !== "netshop" || r.scopeKey !== a.scopeKey || typeof r.kind !== "string" || !kinds.includes(r.kind) || seenKinds.has(r.kind) || (r.kind === "owning_revision" ? r.revision !== owningRevision : r.kind.endsWith(":promotionManifest") ? r.revision !== "absent" && !/^\d+:(True|False)$/.test(String(r.revision)) : r.revision !== "absent" && !/^\d+$/.test(String(r.revision)))) fail("推广版本向量成员、类型或拥有版本无效"); seenKinds.add(r.kind); }
      addVector(a.sourceRevisions as SourceRevision[]);
      Object.keys(coverageRecord(a.coverageBySource, new Set(keys), owner.periods)).forEach(ref => coverageRefs.add(ref));
    }
    if (input.joinedSourceRevisions.length !== expectedVector.size || (input.joinedSourceRevisions as SourceRevision[]).some(r => expectedVector.get(stable([r.domain, r.kind, r.scopeKey]))?.revision !== r.revision)) fail("参与向量必须完整等于双F及推广拥有方向量，不能裁剪或注入");
    const authorityCode = (code: unknown) => typeof code === "string" && (["access_denied", "authentication_required", "not_authenticated", "forbidden", "permission_denied"].includes(code) || code.endsWith("revision_changed"));
    for (const raw of promotion.sourceStates) { const s = object(raw), key = `${s.period}:${s.platform}`; if (!enumValue(s.period, ["current", "baseline"]) || !current.effectiveScope.platforms.includes(s.platform as InsightPlatform) || sourceStateKeys.has(key) || !enumValue(s.state, ["ready", "error", "unavailable"]) || s.state === "ready" && s.code !== null || s.state !== "ready" && !text(s.code, 200) || authorityCode(s.code) || (s.state === "ready") !== sourceScopeKeys.has(key)) fail("推广状态必须保留真实错误及权限失败关闭"); sourceStateKeys.add(key); }
    if (authorityCode(erp.code)) fail("ERP权限或版本失效须整体失败关闭");
    const verifyReferences = (raw: unknown) => { if (!raw || typeof raw !== "object") return; if (Array.isArray(raw)) { raw.forEach(verifyReferences); return; } const r = raw as Record<string, unknown>; if (typeof r.coverageRef === "string") { if (!coverageRefs.has(r.coverageRef)) fail("指标覆盖引用未指向真实两期来源"); const cov = coverage[r.coverageRef]; if (r.status === "available" && cov && !cov.complete) fail("覆盖不完整的指标不能冒充完整可用值"); } Object.values(r).forEach(verifyReferences); };
    verifyReferences(sections);
    const coverageFor = (ref: string, period: "current" | "baseline") => coverage[ref] ?? (period === "current" ? current : baseline).coverageBySource[ref] ?? (promotion.sourceScopes as ComparisonResponse["sections"]["promotion"]["sourceScopes"]).filter(scope => scope.period === period).map(scope => scope.coverageBySource[ref]).find(Boolean);
    const bindMetric = (m: ComparisonMetric, period: "current" | "baseline", keys: string[], window: { startDate: string; endDate: string }, metricKey?: ComparisonMetricKey) => {
      const cov = coverageFor(m.coverageRef, period), days = resolveNetshopQueryPeriod(window.startDate, window.endDate, 366)!.days;
      if (!cov) fail("指标覆盖未绑定所属两期范围");
      if (cov.missingByShop.some(item => !keys.includes(item.shopKey) || item.dates.some(date => date < window.startDate || date > window.endDate))) fail("指标覆盖不能引用其他店铺或日期");
      if (m.status === "available" && (!cov.complete || cov.expectedShopDatePairs !== keys.length * days)) fail("可用指标必须覆盖该对象全部店日范围");
      if (metricKey) {
        const platforms = [...new Set(keys.map(key => key.split("\u001f")[0]))], productSources = platforms.map(platform => platform === "京东" ? "jd_sku_daily" : "tmall_product_daily"), promotionSources = platforms.map(platform => platform === "京东" ? "jd_promotion" : "tmall_promotion");
        const productKeys = ["payment", "quantity", "visitors", "customers", "conversion", "visitorValue", "transactionOrders"], promotionKeys = ["spend", "attributedPayment", "roas", "ctr", "cpc"], expectedSources = productKeys.includes(metricKey) ? productSources : promotionKeys.includes(metricKey) ? promotionSources : metricKey === "spendRate" ? [...productSources, ...promotionSources] : [];
        if (m.status === "available" && stable([...m.sourceIds].sort()) !== stable([...expectedSources].sort())) fail("完整指标来源须与精确对象及拥有方匹配");
      }
    };
    for (const period of ["current", "baseline"] as const) {
      const ctx = period === "current" ? current : baseline;
      for (const key of comparisonMetricKeys) bindMetric((period === "current" ? cm : bm)[key], period, ctx.effectiveScope.shopKeys, ctx.periods.current, key);
      for (const row of rows) {
        for (const key of comparisonMetricKeys) bindMetric(row[period][key], period, row.shopKeys, ctx.periods.current, key);
        const selected = row[period][expected.metricKey]; if (row.qualification[period === "current" ? "currentComplete" : "baselineComplete"] !== (selected.status === "available")) fail("排名完整资格必须来自所选指标真实完整状态");
      }
    }
    if (!Array.isArray(efficiency.distribution) || efficiency.distribution.length !== all.size) fail("分布图未使用完整候选集合");
    const distributionKeys = new Set<string>(); for (const raw of efficiency.distribution) { const d = object(raw); if (!all.has(String(d.objectKey)) || distributionKeys.has(String(d.objectKey))) fail("分布图身份重复或不属于全集"); distributionKeys.add(String(d.objectKey)); metric(d.metric); if (stable(qualification(d.qualification)) !== stable(all.get(String(d.objectKey))!.qualification)) fail("分布资格与全集不一致"); }
    const charts = input.chartObjectKeys as string[]; if (charts.some(key => !all.has(key))) fail("主图对象不在完整候选集合");
    const trends = object(sections.trends); if (trends.grain !== expected.trendGrain || !Array.isArray(trends.items) || trends.items.length !== charts.length) fail("趋势粒度或图表对象无效"); strings(trends.definitions, 30, 1000);
    const seen = new Set<string>();
    for (const raw of trends.items) {
      const t = object(raw); if (!charts.includes(String(t.objectKey)) || seen.has(String(t.objectKey))) fail("趋势对象失配"); seen.add(String(t.objectKey));
      const index = object(t.indexBasis); metric(index.current); metric(index.baseline);
      if (!enumValue(index.status, ["available", "unavailable"]) || index.reasonCode !== null && !metricReasons.includes(index.reasonCode as MetricReason)) fail("指数基准说明无效");
      for (const [key, w] of [["current", current.periods.current], ["baseline", baseline.periods.current]] as const) {
        if (!Array.isArray(t[key]) || (t[key] as unknown[]).length > w.days) fail("趋势桶数量无效"); let last = "", cursor = 0;
        const calendar = (key === "current" ? current : baseline).calendar.map(day => day.date);
        for (const rawPoint of t[key] as unknown[]) { const p = object(rawPoint); if (typeof p.date !== "string" || typeof p.bucketEnd !== "string" || !resolveNetshopQueryPeriod(p.date, p.bucketEnd, 366) || p.date < w.startDate || p.bucketEnd > w.endDate || p.date <= last || p.date !== calendar[cursor]) fail("趋势日期重复、漏桶或越界");
          const end = calendar.indexOf(p.bucketEnd, cursor); if (end < cursor || expected.trendGrain === "day" && end !== cursor || expected.trendGrain === "week" && (p.date !== w.startDate && new Date(p.date + "T00:00:00Z").getUTCDay() !== 1 || p.bucketEnd !== w.endDate && new Date(p.bucketEnd + "T00:00:00Z").getUTCDay() !== 0) || expected.trendGrain === "month" && (p.date !== w.startDate && !p.date.endsWith("-01") || p.bucketEnd !== w.endDate && calendar[end + 1]?.slice(0, 7) === p.bucketEnd.slice(0, 7))) fail("趋势桶须保持共享自然日/周/月边界");
          cursor = end + 1; last = p.bucketEnd; const m = metric(p.metric); if (m.unit !== cm[expected.metricKey].unit || m.basis !== cm[expected.metricKey].basis) fail("趋势须保同一指标单位与来源口径"); bindMetric(m, key, all.get(String(t.objectKey))!.shopKeys, { startDate: p.date, endDate: p.bucketEnd }, expected.metricKey); }
        if (cursor !== calendar.length) fail("趋势必须保完整所属窗口，缺日用不可用桶保留");
        const first = (t[key] as unknown[])[0]; if (!first || stable(object(first).metric) !== stable(index[key])) fail("指数基准必须是首自然桶，不能跳过缺口");
      }
      if (index.status === "available" && (index.reasonCode !== null || [index.current, index.baseline].some(rawMetric => { const m = metric(rawMetric); return m.status !== "available" || m.value === null || m.value <= 0; }))) fail("0、负值或缺失基准不能生成指数");
    }
    const product = object(sections.structure); if (product.categoryBasis !== "reference_current_cohort" || !Array.isArray(product.items) || product.items.length !== charts.length || !Array.isArray(product.categoryOptions) || product.categoryOptions.length > 500) fail("商品结构图范围无效"); strings(product.definitions, 30, 1000); product.categoryOptions.forEach(categoryEvidence);
    seen.clear(); for (const raw of product.items) { const s = object(raw); if (!charts.includes(String(s.objectKey)) || seen.has(String(s.objectKey))) fail("商品结构对象失配"); seen.add(String(s.objectKey)); structure(s.current); structure(s.baseline); const counts = object(s.counts); metric(counts.current); metric(counts.baseline); }
    const same = object(product.sameProduct); if (same.status !== "unavailable" || same.reasonCode !== "unmapped") fail("无验证映射不能按名称配对同款");
    return input as ComparisonResponse;
  } catch (error) { if (error instanceof ComparisonResponseError) throw error; return fail(error instanceof Error ? error.message : "对比响应无法验证"); }
}
