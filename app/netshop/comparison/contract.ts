import {
  decodeMetric, decodeDerivedMoneyPerCount, decodeInsightsContextForQuery, decodeInsightPagination,
  compareMetrics, compareDerivedMoneyPerCount, insightBudget, metricReasons, validateContextQuery,
  type MetricValue, type DerivedMoneyPerCountV1, type MetricComparison, type InsightsContext,
  type SourceRevision, type InsightPagination, type InsightPlatform, type MetricReason,
} from "@/lib/netshop/insights-contract";
import { NetshopQueryError, resolveNetshopQueryPeriod, readNetshopOutletFilters } from "@/lib/netshop/query-contract";
import type { CategoryEvidence, ContributionBucket } from "../products/contract";

export const COMPARISON_SCHEMA = "netshop-comparison-v1" as const;
export const comparisonMetricKeys = ["payment", "quantity", "visitors", "customers", "conversion", "visitorValue", "transactionOrders", "spend", "attributedPayment", "roas", "ctr", "cpc", "spendRate", "erpNetSales", "orderMargin", "largeMargin", "erpOrderCount", "averageOrderValue", "returnQuantity", "returnRate"] as const;
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
function exact(value: Record<string, unknown>, keys: string[]) { if (Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => !(key in value))) fail("对比参数字段不完整或未知"); }
function strings(value: unknown, maximum = 50, length = 500): string[] { if (!Array.isArray(value) || value.length > maximum || !value.every(v => text(v, length))) return fail("对比文本列表无效"); return value; }
function count(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number { if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > maximum) return fail("对比计数无效"); return Number(value); }
function token(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
export function decodeComparisonScope(value: unknown): ComparisonScope {
  const scope = object(value); exact(scope, ["schemaVersion", "mode", "metricSource", "category", "coverageFilter"]);
  if (scope.schemaVersion !== "comparison-scope-v1" || !["shop", "platform"].includes(String(scope.mode)) || !["platform", "erp"].includes(String(scope.metricSource)) || !["all", "complete", "partial"].includes(String(scope.coverageFilter))) fail("对比模式或覆盖筛选无效");
  const category = object(scope.category);
  if (category.mode === "all" || category.mode === "unknown") exact(category, ["mode"]);
  else if (category.mode === "label_only") {
    exact(category, ["mode", "platform", "sourceId", "label", "evidenceVersion"]);
    if (!["京东", "天猫"].includes(String(category.platform)) || !text(category.sourceId, 200) || !text(category.label, 120) || !text(category.evidenceVersion, 200)) fail("类目标签来源证据无效");
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
    const erpKeys = ["erpNetSales", "orderMargin", "largeMargin", "erpOrderCount", "averageOrderValue", "returnQuantity", "returnRate"];
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
    efficiency: { items: ComparisonRow[]; distribution: Array<{ objectKey: string; metric: ComparisonMetric; qualification: ComparisonQualification }>; definitions: string[] };
    trends: { grain: "day" | "week" | "month"; items: Array<{ objectKey: string; current: ComparisonTrendPoint[]; baseline: ComparisonTrendPoint[]; indexBasis: { status: "available" | "unavailable"; reasonCode: MetricReason | null; current: ComparisonMetric; baseline: ComparisonMetric } }>; definitions: string[] };
    structure: { items: Array<{ objectKey: string; current: ComparisonProductStructure; baseline: ComparisonProductStructure; counts: { current: ComparisonMetric; baseline: ComparisonMetric } }>; categoryBasis: "reference_current_cohort"; sameProduct: { status: "unavailable"; reasonCode: "unmapped" }; categoryOptions: CategoryEvidence[]; definitions: string[] };
    promotion: { items: ComparisonRow[]; sourceDefinitions: string[] };
    comparability: { items: ComparisonPopulationRow[]; counts: { candidates: number; currentComplete: number; baselineComplete: number; comparable: number; excluded: number }; periodRelationship: { sameLength: boolean; overlapDays: number }; limitations: string[]; population: "complete_authorized_candidate_union" };
  };
};
