import {
  decodeInsightsContextForQuery, decodeInsightPagination, decodeMetric,
  insightBudget, metricReasons, validateContextQuery,
  type InsightPagination, type InsightsContext, type MetricComparison,
  type MetricValue, type SourceRevision,
} from "@/lib/netshop/insights-contract";
import { isNetshopIsoDate, NetshopQueryError } from "@/lib/netshop/query-contract";
import { decodeProductInsights, ProductResponseError, type ProductInsightsResponse } from "../products/contract";
import { decodePromotionInsightsForQuery, type PromotionInsightsResponse } from "@/lib/netshop/promotion-insights-contract";
import { decodeProductScopeSeries, restoreProductScopeSeriesMetric, productSeriesColumns, type ProductScopeSeries } from "@/lib/netshop/product-scope-series-contract";
import { decodeSalesPeriodsForRequest, restoreSalesPeriodSeriesPoint, type RawSalesIdentity, type SalesPeriodsResponse } from "@/lib/netshop/sales-periods-contract";

export const PANORAMA_SCHEMA = "netshop-store-panorama-v1" as const;
export const panoramaSections = ["performance", "traffic", "products", "promotion", "margin", "customers", "targets", "dataQuality"] as const;
export type PanoramaSectionKey = typeof panoramaSections[number];
export const panoramaSourceKeys = ["products", "productSeries", "promotion", "sales", "finance", "workflow"] as const;
export type PanoramaSourceKey = typeof panoramaSourceKeys[number];
export type PanoramaReason = typeof metricReasons[number] | "dependency_pending";
export type PanoramaSource<T> =
  | { state: "ready"; data: T }
  | { state: "error"; data: null; code: "service_unavailable"; message: string }
  | { state: "unavailable"; data: null; reasonCode: PanoramaReason; message: string };
export type PanoramaCapability = {
  id: string; status: "available" | "unavailable";
  reasonCode: PanoramaReason | null; message: string;
};
export type PanoramaSection = {
  state: "ready" | "partial" | "unavailable" | "error";
  sources: PanoramaSourceKey[]; capabilities: PanoramaCapability[];
};
export const panoramaSectionSources: Record<PanoramaSectionKey, readonly PanoramaSourceKey[]> = {
  performance: ["products", "productSeries", "sales", "promotion"], traffic: ["products", "productSeries"], products: ["products"],
  promotion: ["promotion"], margin: ["sales"], customers: ["products"], targets: ["finance", "workflow"],
  dataQuality: ["products", "productSeries", "promotion", "sales", "finance", "workflow"],
};
export const panoramaCapabilityIds: Record<PanoramaSectionKey, readonly string[]> = {
  performance: ["platform_payment", "platform_quantity", "erp_net_sales", "orders", "order_average_value", "order_margin", "large_margin_rate", "platform_refund", "product_changes", "platform_trend", "platform_day_detail"],
  traffic: ["page_views", "visitors", "customers", "conversion", "visitor_value", "favorites", "add_cart_customers", "add_cart_quantity", "order_customers", "order_quantity", "order_payment", "transaction_orders", "search_impressions", "search_clicks", "search_click_rate", "search_visitors", "search_customers", "stay_time", "bounce_rate", "traffic_trend"],
  products: ["traded_products", "category_contribution", "top_concentration", "growth_decline", "product_detail", "inventory"],
  promotion: ["spend", "attributed_payment", "roas", "cpc", "spend_rate", "trend", "distribution", "promotion_detail"],
  margin: ["cost", "order_margin", "large_margin", "large_margin_rate", "return_amount", "return_quantity", "contribution"],
  customers: ["new_old_buyers", "b2b_payment", "b2b_orders", "b2b_quantity", "b2b_product_structure", "unique_customers", "repeat_purchase", "b2b_share"],
  targets: ["annual_target", "finance_month", "history", "events"],
  dataQuality: ["coverage", "field_availability", "source_freshness", "mapping", "comparability", "import_records"],
};
/** Additive native ERP series support; historical v1 captures retain their original capability list. */
const panoramaOptionalCapabilityIds: Partial<Record<PanoramaSectionKey, readonly string[]>> = { performance: ["erp_trend", "erp_detail"] };
export type PanoramaScope = {
  platform: "京东" | "天猫"; shopName: string;
  startDate: string; endDate: string;
};
export const salesMetricKeys = ["netSales", "cost", "netQuantity", "positiveQuantity", "returnAmount", "returnQuantity", "orderMargin", "largeMargin", "largeMarginRate", "orders", "orderAverageValue"] as const;
export type PanoramaNativeQuantity = Omit<MetricValue, "unit"> & { unit: "NATIVE_INTEGER_QUANTITY" };
export type PanoramaOrderMean = Omit<MetricValue, "unit" | "status" | "reasonCode"> & {
  unit: "CNY_CENT_PER_ORDER"; status: "available" | "unavailable";
  reasonCode: "no_records" | "missing_order_no" | "zero_denominator" | "not_applicable" | null;
  numerator: number | null; denominator: number | null;
};
export type PanoramaErpMetric = MetricValue | PanoramaNativeQuantity | PanoramaOrderMean;
export type PanoramaSalesMetrics = Record<Exclude<typeof salesMetricKeys[number], "netQuantity" | "positiveQuantity" | "returnQuantity" | "orderAverageValue">, MetricValue> & {
  netQuantity: PanoramaNativeQuantity; positiveQuantity: PanoramaNativeQuantity; returnQuantity: PanoramaNativeQuantity; orderAverageValue: PanoramaOrderMean;
};
/** Display projection of the owning sales consumer; never a second profit calculation. */
export type PanoramaSalesData = {
  schemaVersion: "netshop-panorama-sales-v1"; scope: PanoramaScope; channel: string | null;
  rawOutlets: RawSalesIdentity[];
  owning: { previous: SalesPeriodsResponse; yearAgo: SalesPeriodsResponse | null };
  sourceRevisions: SourceRevision[];
  periods: Record<"current" | "previous" | "yearAgo", { startDate: string; endDate: string; metrics: PanoramaSalesMetrics }>;
  comparisons: Record<typeof salesMetricKeys[number], { previous: MetricComparison; yearAgo: MetricComparison }>;
  daily: Array<{ date: string; metrics: PanoramaSalesMetrics }>;
  items: Array<{ id: string; title: string; category: string | null; metrics: PanoramaSalesMetrics }>;
  pagination: InsightPagination; limitations: string[];
};
export type PanoramaFinanceData = {
  schemaVersion: "netshop-panorama-finance-v1"; scope: PanoramaScope; sourceRevisions: SourceRevision[];
  months: Array<{ month: string; revenue: MetricValue; profit: MetricValue }>;
  annualTargets: Array<{ year: number; target: MetricValue; actual: MetricValue; progress: MetricValue }>;
  limitations: string[];
};
export type PanoramaWorkflowData = {
  schemaVersion: "netshop-panorama-workflow-v1"; scope: PanoramaScope; sourceRevisions: SourceRevision[];
  items: Array<{ id: string; occurredAt: string; title: string; status: string; eventType: string }>;
  pagination: InsightPagination; limitations: string[];
};
export type StorePanoramaResponse = {
  schemaVersion: typeof PANORAMA_SCHEMA; context: InsightsContext; sectionToken: string;
  tableScope: { q: string; page: number; pageSize: number; section: PanoramaSectionKey; grain: "day" | "week" | "month" };
  joinedSourceRevisions: SourceRevision[]; consistency: "revision_vector_checked";
  sources: {
    products: PanoramaSource<ProductInsightsResponse>;
    productSeries: PanoramaSource<ProductScopeSeries>;
    promotion: PanoramaSource<PromotionInsightsResponse>;
    sales: PanoramaSource<PanoramaSalesData>;
    finance: PanoramaSource<PanoramaFinanceData>;
    workflow: PanoramaSource<PanoramaWorkflowData>;
  };
  sections: Record<PanoramaSectionKey, PanoramaSection>;
  limitations: string[];
};
export class PanoramaResponseError extends Error {
  constructor(readonly status: 401 | 403 | 409, readonly code: string, message: string) { super(message); }
}

const sharedKeys = new Set(["platform", "outlet", "dimension", "startDate", "endDate", "periodKind", "snapshotToken"]);
const ownKeys = new Set(["q", "page", "pageSize", "section", "sectionToken", "grain"]);
const reject = (message: string): never => { throw new NetshopQueryError("invalid_store_panorama_contract", message); };
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return reject("全景响应对象无效");
  return value as Record<string, unknown>;
}
function text(value: unknown, maximum = 2000, empty = false): value is string {
  return typeof value === "string" && value.length <= maximum && (empty || value.trim().length > 0) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
}
function token(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function referenceText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum && !/[\u0000-\u001e\u007f]/.test(value);
}
function strings(value: unknown, maximum = 50): string[] {
  if (!Array.isArray(value) || value.length > maximum || !value.every(v => text(v))) return reject("全景说明列表无界或无效");
  return value;
}
function integer(value: unknown, maximum = Number.MAX_SAFE_INTEGER): value is number { return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= maximum; }
function enumValue(value: unknown, allowed: readonly string[]): value is string { return typeof value === "string" && allowed.includes(value); }
function page(value: string | null, fallback: number, maximum: number): number {
  if (value === null) return fallback;
  if (!/^[1-9]\d*$/.test(value) || !integer(Number(value), maximum)) return reject("全景分页无效");
  return Number(value);
}
export function panoramaContextQuery(params: URLSearchParams): URLSearchParams {
  const query = new URLSearchParams(); for (const [key, value] of params) if (sharedKeys.has(key)) query.append(key, value); return query;
}
export function validatePanoramaQuery(params: URLSearchParams) {
  for (const key of params.keys()) if ((!sharedKeys.has(key) && !ownKeys.has(key)) || params.getAll(key).length !== 1) return reject("全景请求包含未知或重复参数");
  const query = panoramaContextQuery(params), shared = validateContextQuery(query);
  if (shared.platforms.length !== 1 || shared.shops.length !== 1 || shared.shops[0].platform !== shared.platforms[0]) return reject("店铺全景须选择唯一平台与精确店铺");
  const rawQ = params.get("q") ?? "", q = rawQ.trim();
  if (rawQ.length > 120 || /[\u0000-\u001f\u007f]/.test(rawQ)) return reject("商品ID或标题搜索无效");
  const section = params.get("section") ?? "performance";
  const grain = params.get("grain") ?? "day";
  if (!["day", "week", "month"].includes(grain)) return reject("全景趋势粒度无效");
  if (!panoramaSections.includes(section as PanoramaSectionKey) || params.has("sectionToken") && !token(params.get("sectionToken"))) return reject("全景章节或来源令牌无效");
  return { query, shared, tableScope: { q, page: page(params.get("page"), 1, 10000), pageSize: page(params.get("pageSize"), 5, 100), section: section as PanoramaSectionKey, grain: grain as "day" | "week" | "month" } };
}
/** Each owning decoder receives its own request. S tokens never become A SKU tokens. */
export function panoramaProductQuery(params: URLSearchParams): URLSearchParams {
  const spec = validatePanoramaQuery(params), query = new URLSearchParams(spec.query);
  query.set("q", spec.tableScope.q); query.set("page", String(spec.tableScope.page)); query.set("pageSize", String(spec.tableScope.pageSize));
  query.set("sort", "payment_desc"); return query;
}
export function panoramaPromotionQuery(params: URLSearchParams): URLSearchParams {
  const spec = validatePanoramaQuery(params), query = new URLSearchParams(spec.query);
  query.delete("snapshotToken"); query.set("dimension", spec.shared.platforms[0] === "京东" ? "sku" : "spu");
  query.set("q", ""); query.set("page", "1"); query.set("pageSize", "5"); query.set("objectKind", "product"); query.set("sort", "spend_desc"); query.set("trendGrain", spec.tableScope.grain);
  return query;
}
export function panoramaSeriesQuery(params: URLSearchParams): URLSearchParams {
  const spec = validatePanoramaQuery(params), query = new URLSearchParams(spec.query); query.set("grain", spec.tableScope.grain); return query;
}
function revisions(value: unknown): Map<string, SourceRevision> {
  if (!Array.isArray(value) || value.length > 512) return reject("全景参与来源向量无界");
  const result = new Map<string, SourceRevision>();
  for (const raw of value) {
    const r = record(raw), key = JSON.stringify([r.domain, r.kind, r.scopeKey]);
    if (!enumValue(r.domain, ["netshop", "sales", "products", "inventory", "finance", "erp_reference", "workflow"]) || !referenceText(r.kind, 200) || !referenceText(r.scopeKey, 1024) || !text(r.revision, 1024) || result.has(key)) return reject("全景来源种类、范围或修订重复/无效");
    result.set(key, r as SourceRevision);
  }
  return result;
}
function includeRevisions(joined: Map<string, SourceRevision>, member: SourceRevision[]) {
  for (const r of member) if (joined.get(JSON.stringify([r.domain, r.kind, r.scopeKey]))?.revision !== r.revision) return reject("全景混用了参与来源版本");
}
function source<T>(value: unknown, decode: (value: unknown) => T): PanoramaSource<T> {
  const input = record(value);
  // A known authority failure wins over a malformed ordinary error payload.
  if (input.state === "error") {
    if (input.code === "access_denied" || input.code === "unauthenticated") throw new PanoramaResponseError(input.code === "unauthenticated" ? 401 : 403, input.code, "来源权限失效，请重新读取当前授权范围");
    if (input.code === "insights_revision_changed") throw new PanoramaResponseError(409, input.code, "参与来源版本已变化，请完整重读");
  }
  if (input.state === "ready") return { state: "ready", data: decode(input.data) };
  if (input.data !== null || !text(input.message)) return reject("全景非就绪来源须为空并带原因");
  if (input.state === "error") {
    if (input.code !== "service_unavailable") return reject("全景来源错误协议无效");
    return input as PanoramaSource<T>;
  }
  if (input.state !== "unavailable" || ![...metricReasons, "dependency_pending"].includes(input.reasonCode as PanoramaReason)) return reject("全景缺源或待接线状态无效");
  return input as PanoramaSource<T>;
}
function ownedScope(value: unknown, context: InsightsContext): PanoramaScope {
  const scope = record(value), shop = context.effectiveScope.shopKeys[0].split("\u001f"), current = context.periods.current;
  if (scope.platform !== shop[0] || scope.shopName !== shop[1] || scope.startDate !== current.startDate || scope.endDate !== current.endDate) return reject("跨域来源不是本店本期");
  return scope as PanoramaScope;
}
function comparison(value: unknown): MetricComparison {
  const v = record(value);
  if (!enumValue(v.method, ["relative_change", "percentage_points"]) || !enumValue(v.status, ["available", "unavailable"]) || v.status === "available" && (typeof v.value !== "number" || !Number.isFinite(v.value) || v.reasonCode !== null) || v.status === "unavailable" && (v.value !== null || !metricReasons.includes(v.reasonCode as typeof metricReasons[number]))) return reject("全景比较状态无效");
  return v as MetricComparison;
}
function salesMetrics(value: unknown): PanoramaSalesMetrics {
  const input = record(value), result = {} as PanoramaSalesMetrics;
  for (const key of salesMetricKeys) {
    const raw = record(input[key]);
    if (key === "orderAverageValue") {
      if (raw.unit !== "CNY_CENT_PER_ORDER" || !enumValue(raw.status, ["available", "unavailable"]) || raw.reasonCode !== null && !enumValue(raw.reasonCode, ["no_records", "missing_order_no", "zero_denominator", "not_applicable"]) || raw.basis !== "erp_net_sales" || raw.aggregation !== "ratio_of_sums" || !Object.hasOwn(raw, "numerator") || !Object.hasOwn(raw, "denominator") || [raw.numerator, raw.denominator].some(v => v !== null && !Number.isSafeInteger(v))) return reject("ERP订单组均值原生单位、分母或原因无效");
      if (raw.reasonCode === "not_applicable" && (raw.status !== "unavailable" || raw.value !== null || raw.numerator !== null || raw.denominator !== null)) return reject("ERP超限未请求基期不能伪装无记录或均值");
      const proxy = decodeMetric({ ...raw, unit: "RATIO", reasonCode: raw.reasonCode === "missing_order_no" ? "missing_field" : raw.reasonCode });
      if (proxy.status === "available" && (raw.denominator as number) <= 0) return reject("ERP订单组均值分母无效");
      result.orderAverageValue = raw as PanoramaOrderMean; continue;
    }
    const native = ["netQuantity", "positiveQuantity", "returnQuantity"].includes(key);
    if (native && raw.unit !== "NATIVE_INTEGER_QUANTITY") return reject("ERP原生整数数量不能冒充平台件数或通用COUNT");
    const metric = decodeMetric(native ? { ...raw, unit: "COUNT" } : raw), expectedUnit = key === "largeMarginRate" ? "RATIO" : native || key === "orders" ? "COUNT" : "CNY_CENT";
    const basis = key === "orderMargin" ? "erp_order_margin" : key === "largeMargin" || key === "largeMarginRate" ? "erp_large_margin" : "erp_net_sales";
    if (metric.unit !== expectedUnit || ![basis, "unverified"].includes(metric.basis)) return reject("ERP指标单位或口径无效");
    (result as Record<string, PanoramaErpMetric>)[key] = native ? raw as PanoramaNativeQuantity : metric;
  }
  return result;
}
function crossBase(value: unknown, schema: string, domain: string, context: InsightsContext, joined: Map<string, SourceRevision>) {
  const data = record(value); if (data.schemaVersion !== schema) return reject("跨域显示投影版本无效");
  ownedScope(data.scope, context); const own = revisions(data.sourceRevisions);
  if (!own.size || [...own.values()].some(r => r.domain !== domain)) return reject("跨域来源不能冒充其他域修订");
  includeRevisions(joined, [...own.values()]); strings(data.limitations); return data;
}
function decodeSales(value: unknown, context: InsightsContext, joined: Map<string, SourceRevision>, grain: "day" | "week" | "month"): PanoramaSalesData {
  const data = crossBase(value, "netshop-panorama-sales-v1", "sales", context, joined), periods = record(data.periods), pairs = record(data.comparisons);
  if (data.channel !== null && !text(data.channel, 200)) return reject("ERP渠道来源无效");
  if (!Array.isArray(data.rawOutlets) || !data.rawOutlets.length || data.rawOutlets.length > 50) return reject("ERP必须返回经拥有方解析的精确原始三元组");
  const owning = record(data.owning), expectedRefs: SourceRevision[] = [];
  const decodedOwners: Partial<Record<"previous" | "yearAgo", SalesPeriodsResponse>> = {};
  let previous: SalesPeriodsResponse | null = null;
  for (const kind of ["previous", "yearAgo"] as const) {
    if (kind === "yearAgo" && context.periods.yearAgo.days > 366) { if (owning.yearAgo !== null) return reject("ERP367日同比不能截断为366日或伪旧回执"); continue; }
    if (owning[kind] === null) return reject("已支持的ERP基期缺少完整拥有方信封");
    const envelope = record(owning[kind]), refs = revisions(envelope.sourceRevisions);
    const revision = [...refs.values()].find(r => r.domain === "sales" && r.kind === "sales_erp_revision_pair")?.revision ?? null;
    const hasSeries = Object.hasOwn(envelope, "series");
    const body = decodeSalesPeriodsForRequest(envelope, { operation: "netshop_periods_v1", current: { startDate: context.periods.current.startDate, endExclusive: context.periods.current.endExclusive }, baseline: { startDate: context.periods[kind].startDate, endExclusive: context.periods[kind].endExclusive }, rawOutlets: data.rawOutlets as RawSalesIdentity[], q: "", page: 1, pageSize: 20, ...(hasSeries ? { seriesGrain: grain, seriesOutlets: data.rawOutlets as RawSalesIdentity[] } : {}) }, revision);
    if (body.requestedScope.rawOutlets.some(r => r.platform !== context.effectiveScope.platforms[0])) return reject("ERP原始平台不是全景平台");
    if (previous && (previous.sourceRevisions[0].revision !== body.sourceRevisions[0].revision || JSON.stringify(previous.periodTotals.current) !== JSON.stringify(body.periodTotals.current))) throw new PanoramaResponseError(409, "insights_revision_changed", "ERP两次本期信封修订或事实不一致");
    if (previous?.series && body.series && JSON.stringify(previous.series.items.map(item => ({ identity: item.identity, current: item.current }))) !== JSON.stringify(body.series.items.map(item => ({ identity: item.identity, current: item.current })))) throw new PanoramaResponseError(409, "insights_revision_changed", "ERP两次本期序列事实不一致");
    decodedOwners[kind] = body; previous = body; expectedRefs.push(...body.sourceRevisions);
  }
  const uniqueExpected = new Map(expectedRefs.map(ref => [JSON.stringify([ref.domain, ref.kind, ref.scopeKey]), ref]));
  const declared = revisions(data.sourceRevisions), expected = revisions([...uniqueExpected.values()]);
  if (declared.size !== expected.size || [...expected.entries()].some(([key, ref]) => declared.get(key)?.revision !== ref.revision)) return reject("ERP参与修订不等于实际拥有方信封");
  const primaryMap = { netSales: "netSalesCents", netQuantity: "netQuantity", positiveQuantity: "positiveQuantity", returnAmount: "refundCents", returnQuantity: "returnQuantity" } as const;
  for (const kind of ["current", "previous", "yearAgo"] as const) {
    const period = record(periods[kind]); if (period.startDate !== context.periods[kind].startDate || period.endDate !== context.periods[kind].endDate) return reject("ERP比较日期不是实际基期");
    const metrics = salesMetrics(period.metrics);
    const owned = kind === "current" ? decodedOwners.previous?.periodTotals.current : decodedOwners[kind]?.periodTotals.baseline;
    if (!owned) { for (const metric of Object.values(metrics)) if (metric.value !== null || metric.status !== "unavailable" || metric.reasonCode !== "not_applicable") return reject("ERP未支持基期不能返回伪数或无记录"); continue; }
    for (const [key, rawKey] of Object.entries(primaryMap)) {
      const metric = metrics[key as keyof typeof primaryMap];
      if (metric.value !== owned.values[rawKey as typeof primaryMap[keyof typeof primaryMap]] || metric.status !== (owned.rowPresence ? "partial" : "unavailable") || metric.reasonCode !== (owned.rowPresence ? "incomplete_coverage" : "no_records")) return reject("ERP主净额与原生量须复制拥有方记录证据并保留未知完整性");
    }
    if (metrics.orders.value !== owned.orders.trustedOrderCount || metrics.orders.status !== (owned.rowPresence ? "partial" : "unavailable") || metrics.orders.reasonCode !== (owned.rowPresence ? "incomplete_coverage" : "no_records")) return reject("ERP可信订单组不能回退行数或伪完整");
    const mean = owned.orders.netAmountPerOrder;
    for (const key of ["unit", "status", "reasonCode", "value", "numerator", "denominator"] as const) if (metrics.orderAverageValue[key] !== mean[key]) return reject("ERP订单组原生均值与拥有方输入不一致");
    for (const key of ["cost", "orderMargin", "largeMargin", "largeMarginRate"] as const) if (metrics[key].status !== "unavailable" || metrics[key].value !== null || metrics[key].reasonCode !== (owned.rowPresence ? "unverified_source" : "no_records")) return reject("未知原始成本或毛利不能变成已验证主指标");
  }
  for (const key of salesMetricKeys) { const pair = record(pairs[key]); const method = key === "largeMarginRate" ? "percentage_points" : "relative_change"; for (const kind of ["previous", "yearAgo"] as const) { const c = comparison(pair[kind]); if (c.method !== method || c.status !== "unavailable") return reject("ERP记录覆盖未知，不可声明完整基期比较"); } }
  if (!Array.isArray(data.daily) || data.daily.length !== 0 || !Array.isArray(data.items) || data.items.length !== 0) return reject("ERP原始来源候选不能冒充商品贡献或逐日事实");
  const dates = new Set<string>(), ids = new Set<string>();
  for (const raw of data.daily) { const row = record(raw); if (typeof row.date !== "string" || !isNetshopIsoDate(row.date) || dates.has(row.date) || row.date < context.periods.current.startDate || row.date > context.periods.current.endDate) return reject("ERP明细日期重复或越界"); dates.add(row.date); salesMetrics(row.metrics); }
  for (const raw of data.items) { const row = record(raw); if (!text(row.id, 500) || ids.has(row.id) || !text(row.title) || row.category !== null && !text(row.category)) return reject("ERP商品贡献身份重复或无效"); ids.add(row.id); salesMetrics(row.metrics); }
  const pagination = decodeInsightPagination(data.pagination); if (pagination.returned !== data.items.length) return reject("ERP贡献分页不一致");
  return data as PanoramaSalesData;
}
function financeMetric(value: unknown, unit: string): MetricValue { const metric = decodeMetric(value); if (metric.unit !== unit || !["finance_month", "unverified"].includes(metric.basis)) return reject("财报或目标口径无效"); return metric; }
function decodeFinance(value: unknown, context: InsightsContext, joined: Map<string, SourceRevision>): PanoramaFinanceData {
  const data = crossBase(value, "netshop-panorama-finance-v1", "finance", context, joined);
  if (!Array.isArray(data.months) || data.months.length > 40 || !Array.isArray(data.annualTargets) || data.annualTargets.length > 3) return reject("财报月份或年度目标无界");
  const seen = new Set<string>();
  for (const raw of data.months) { const row = record(raw); if (typeof row.month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(row.month) || seen.has(row.month) || ![context.periods.current, context.periods.previous, context.periods.yearAgo].some(period => String(row.month) >= period.startDate.slice(0, 7) && String(row.month) <= period.endDate.slice(0, 7))) return reject("财报月份重复、无效或不属于当前比较范围"); seen.add(row.month); financeMetric(row.revenue, "CNY_CENT"); financeMetric(row.profit, "CNY_CENT"); }
  const years = new Set<number>();
  for (const raw of data.annualTargets) { const row = record(raw); if (!integer(row.year, 9999) || years.has(row.year) || row.year < Number(context.periods.current.startDate.slice(0, 4)) || row.year > Number(context.periods.current.endDate.slice(0, 4))) return reject("年度目标年份重复或不属于本期"); years.add(row.year); financeMetric(row.target, "CNY_CENT"); financeMetric(row.actual, "CNY_CENT"); financeMetric(row.progress, "RATIO"); }
  return data as PanoramaFinanceData;
}
function decodeWorkflow(value: unknown, context: InsightsContext, joined: Map<string, SourceRevision>): PanoramaWorkflowData {
  const data = crossBase(value, "netshop-panorama-workflow-v1", "workflow", context, joined);
  if (!Array.isArray(data.items) || data.items.length > 100) return reject("经营事件无界");
  const seen = new Set<string>();
  const start = Date.parse(`${context.periods.current.startDate}T00:00:00+08:00`), end = Date.parse(`${context.periods.current.endExclusive}T00:00:00+08:00`);
  for (const raw of data.items) { const row = record(raw), occurred = typeof row.occurredAt === "string" ? Date.parse(row.occurredAt) : NaN; if (!text(row.id, 200) || seen.has(String(row.id)) || !text(row.title) || !text(row.status, 80) || !text(row.eventType, 100) || typeof row.occurredAt !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(row.occurredAt) || !/(Z|[+-]\d{2}:\d{2})$/.test(row.occurredAt) || !Number.isFinite(occurred) || occurred < start || occurred >= end) return reject("经营事件身份或发生时间不属于本店本期"); seen.add(row.id as string); }
  const pagination = decodeInsightPagination(data.pagination); if (pagination.returned !== data.items.length) return reject("经营事件分页不一致");
  return data as PanoramaWorkflowData;
}
function capabilityHasSource(section: PanoramaSectionKey, id: string, sources: StorePanoramaResponse["sources"]): boolean {
  const p = sources.products.state === "ready" ? sources.products.data.sections : null;
  const a = sources.promotion.state === "ready" ? sources.promotion.data.sections : null;
  const sales = sources.sales.state === "ready" ? sources.sales.data : null;
  const finance = sources.finance.state === "ready" ? sources.finance.data : null;
  const workflow = sources.workflow.state === "ready" ? sources.workflow.data : null;
  const series = sources.productSeries.state === "ready" ? sources.productSeries.data : null;
  const available = (metric: { status: string } | null | undefined) => metric?.status === "available";
  if (section === "customers") return false; // No owning customer/B2B envelope exists in v1.
  if (id === "stay_time" || id === "bounce_rate" || id === "inventory" || id === "mapping") return false;
  const productMetric: Record<string, keyof ProductInsightsResponse["sections"]["summary"]> = { platform_payment: "payment", platform_quantity: "quantity", platform_refund: "refundPayment", visitors: "visitors", customers: "customers", conversion: "conversion" };
  if (id in productMetric) return available(p?.summary[productMetric[id]]);
  const extraMetric: Record<string, keyof ProductInsightsResponse["sections"]["efficiency"]["metrics"]> = { page_views: "pageViews", favorites: "favorites", add_cart_customers: "addCartCustomers", add_cart_quantity: "addCartQuantity", order_customers: "orderCustomers", order_quantity: "orderQuantity", order_payment: "orderPayment", transaction_orders: "transactionOrders", search_impressions: "searchImpressions", search_clicks: "searchClicks", search_click_rate: "searchClickRate", search_visitors: "searchVisitors", search_customers: "searchCustomers" };
  if (id in extraMetric) return available(p?.efficiency.metrics[extraMetric[id]]);
  const salesMetric: Record<string, keyof PanoramaSalesMetrics> = { erp_net_sales: "netSales", orders: "orders", order_average_value: "orderAverageValue", order_margin: "orderMargin", large_margin: "largeMargin", large_margin_rate: "largeMarginRate", cost: "cost", return_amount: "returnAmount", return_quantity: "returnQuantity" };
  if (id in salesMetric) return available(sales?.periods.current.metrics[salesMetric[id]]);
  const promotionMetric: Record<string, keyof PromotionInsightsResponse["sections"]["summary"]> = { spend: "spend", attributed_payment: "attributedPayment", roas: "roas", cpc: "cpc", spend_rate: "spendRate" };
  if (id in promotionMetric) return available(a?.summary[promotionMetric[id]]);
  if (id === "visitor_value") return available(p?.efficiency.visitorValue);
  if (id === "platform_trend" || id === "traffic_trend") return !!series && series.series.current.some(point => available(restoreProductScopeSeriesMetric(series, point, id === "platform_trend" ? "payment" : "visitors")));
  if (id === "platform_day_detail") return !!series && series.series.current.some(point => productSeriesColumns.some(column => ["available", "partial"].includes(restoreProductScopeSeriesMetric(series, point, column).status)));
  if (id === "erp_trend" || id === "erp_detail") return !!sales && [sales.owning.previous, sales.owning.yearAgo].some(owner => owner?.series?.items.some(item => item.current.some(point => restoreSalesPeriodSeriesPoint(point).facts.rowPresence)));
  if (id === "product_changes" || id === "growth_decline") return p?.growth.state === "ready" && available(p.comparisons.payment.previous);
  if (id === "traded_products") return available(p?.counts.tradedProducts);
  if (id === "category_contribution") return available(p?.structure.denominator);
  if (id === "top_concentration") return available(p?.structure.top5Share) && available(p?.structure.top10Share);
  if (id === "product_detail") return available(p?.counts.dataProducts) && Number(p?.counts.dataProducts.value) > 0;
  if (id === "trend" || id === "distribution") return available(a?.summary.spend);
  if (id === "promotion_detail") return !!a && a.items.some(row => row.drillable && row.id !== null && row.objectKind === "product");
  if (id === "contribution") return !!sales && sales.items.some(item => available(item.metrics.orderMargin));
  if (id === "annual_target") return !!finance && finance.annualTargets.some(row => available(row.target));
  if (id === "finance_month") return !!finance && finance.months.some(row => available(row.revenue) || available(row.profit));
  if (id === "history") return !!finance && finance.months.some(row => row.month < finance.scope.startDate.slice(0, 7) && (available(row.revenue) || available(row.profit)));
  if (id === "events") return !!workflow && workflow.items.length > 0;
  // Inspection/review operations are not import batches or n8n executions.
  if (id === "import_records") return false;
  if (["coverage", "field_availability", "source_freshness"].includes(id)) return Object.values(sources).some(source => source.state === "ready");
  if (id === "comparability") return available(p?.comparisons.payment.previous) || available(sales?.comparisons.netSales.previous);
  return false;
}
function decodeSections(value: unknown, sources: StorePanoramaResponse["sources"]): StorePanoramaResponse["sections"] {
  const sections = record(value);
  if (Object.keys(sections).length !== panoramaSections.length) return reject("全景必须提供且只提供八个内容章节");
  for (const key of panoramaSections) {
    const section = record(sections[key]);
    if (!enumValue(section.state, ["ready", "partial", "unavailable", "error"]) || !Array.isArray(section.sources) || !section.sources.length || section.sources.length > 6 || new Set(section.sources).size !== section.sources.length || !section.sources.every(s => panoramaSourceKeys.includes(s as PanoramaSourceKey)) || !Array.isArray(section.capabilities) || !section.capabilities.length || section.capabilities.length > 30) return reject("全景章节状态、来源或能力无效");
    const optional = panoramaOptionalCapabilityIds[key] ?? [];
    if (JSON.stringify(section.sources) !== JSON.stringify(panoramaSectionSources[key]) || ![panoramaCapabilityIds[key].length, panoramaCapabilityIds[key].length + optional.length].includes(section.capabilities.length)) return reject("全景章节引用或能力清单不符合固定八章合同");
    const ids = new Set<string>();
    for (const raw of section.capabilities) { const capability = record(raw); if (!text(capability.id, 100) || ids.has(capability.id) || !enumValue(capability.status, ["available", "unavailable"]) || !text(capability.message) || capability.status === "available" && capability.reasonCode !== null || capability.status === "unavailable" && ![...metricReasons, "dependency_pending"].includes(capability.reasonCode as PanoramaReason)) return reject("全景能力状态须提供明确原因"); if (capability.status === "available" && !capabilityHasSource(key, capability.id, sources)) return reject("全景能力缺少其所属可信来源或字段证明"); ids.add(capability.id); }
    if (panoramaCapabilityIds[key].some(id => !ids.has(id))) return reject("全景能力清单缺少合同字段");
    if ([...ids].some(id => !panoramaCapabilityIds[key].includes(id) && !optional.includes(id)) || optional.some(id => ids.has(id)) && optional.some(id => !ids.has(id))) return reject("全景可选能力必须完整声明且不得含未知字段");
    const states = section.sources.map(s => sources[s as PanoramaSourceKey].state);
    const expected = states.every(s => s === "ready") ? "ready" : states.some(s => s === "ready") ? "partial" : states.some(s => s === "error") ? "error" : "unavailable";
    if (section.state !== expected) return reject("全景章节状态与实际来源不一致");
    if (!states.includes("ready") && section.capabilities.some(c => record(c).status === "available")) return reject("无可信来源的章节不能声明可用能力");
  }
  return sections as StorePanoramaResponse["sections"];
}
export function decodeStorePanorama(value: unknown, params: URLSearchParams, revision: string | null | undefined): StorePanoramaResponse {
  if (new TextEncoder().encode(JSON.stringify(value)).length > insightBudget.responseBytes) return reject("全景完整响应超过2MiB");
  const input = record(value), request = validatePanoramaQuery(params);
  if (input.schemaVersion !== PANORAMA_SCHEMA || input.consistency !== "revision_vector_checked" || !token(input.sectionToken)) return reject("全景协议、修订检查或令牌无效");
  const context = decodeInsightsContextForQuery(input.context, request.query, revision ?? null), scope = record(input.tableScope);
  for (const [key, expected] of Object.entries(request.tableScope)) if (scope[key] !== expected) return reject("全景返回了其他搜索或分页范围");
  if (params.has("sectionToken") && input.sectionToken !== params.get("sectionToken")) throw new PanoramaResponseError(409, "insights_revision_changed", "全景范围或参与来源版本已变化");
  const joined = revisions(input.joinedSourceRevisions); includeRevisions(joined, context.sourceRevisions);
  const raw = record(input.sources);
  if (Object.keys(raw).length !== panoramaSourceKeys.length) return reject("全景来源集合不完整或包含未知来源");
  let products: StorePanoramaResponse["sources"]["products"];
  try { products = source(raw.products, data => decodeProductInsights(data, panoramaProductQuery(params), revision)); }
  catch (error) { if (error instanceof ProductResponseError) throw new PanoramaResponseError(error.status, error.code, error.message); throw error; }
  if (products.state === "ready") { if (products.data.context.snapshotToken !== context.snapshotToken) return reject("商品信封不是全景拥有方范围或版本"); includeRevisions(joined, products.data.joinedSourceRevisions); }
  const productSeries = source(raw.productSeries, data => decodeProductScopeSeries(data, panoramaSeriesQuery(params), revision ?? null));
  if (productSeries.state === "ready") { if (productSeries.data.context.snapshotToken !== context.snapshotToken) throw new PanoramaResponseError(409, "insights_revision_changed", "平台序列不是全景本店本期版本"); includeRevisions(joined, productSeries.data.joinedSourceRevisions); }
  const promotion = source(raw.promotion, data => decodePromotionInsightsForQuery(data, panoramaPromotionQuery(params), revision ?? null));
  if (promotion.state === "ready") {
    const own = promotion.data.context;
    if (JSON.stringify(own.effectiveScope.shopKeys) !== JSON.stringify(context.effectiveScope.shopKeys) || JSON.stringify(own.periods) !== JSON.stringify(context.periods)) return reject("推广不是本店同周期的独立信封");
    includeRevisions(joined, own.sourceRevisions);
  }
  const sources: StorePanoramaResponse["sources"] = {
    products, productSeries, promotion,
    sales: source(raw.sales, data => decodeSales(data, context, joined, request.tableScope.grain)),
    finance: source(raw.finance, data => decodeFinance(data, context, joined)),
    workflow: source(raw.workflow, data => decodeWorkflow(data, context, joined)),
  };
  const involved = new Set(context.sourceRevisions.map(r => JSON.stringify([r.domain, r.kind, r.scopeKey])));
  for (const key of panoramaSourceKeys) if (sources[key].state === "ready") {
    const data = sources[key].data;
    const refs = key === "products" ? (data as ProductInsightsResponse).joinedSourceRevisions : key === "productSeries" ? (data as ProductScopeSeries).joinedSourceRevisions : key === "promotion" ? (data as PromotionInsightsResponse).context.sourceRevisions : (data as PanoramaSalesData | PanoramaFinanceData | PanoramaWorkflowData).sourceRevisions;
    for (const r of refs) involved.add(JSON.stringify([r.domain, r.kind, r.scopeKey]));
  }
  if (joined.size !== involved.size) return reject("全景向量包含未参与读取的来源");
  const sections = decodeSections(input.sections, sources); strings(input.limitations);
  return { ...input, context, sources, sections } as StorePanoramaResponse;
}
