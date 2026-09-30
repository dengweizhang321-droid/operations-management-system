import {
  decodeInsightPagination, decodeInsightsContextForQuery, decodeMetric,
  encodeProductIdentity, insightBudget, metricReasons, validateContextQuery,
  type InsightPagination, type InsightsContext, type MetricComparison,
  type MetricReason, type MetricValue, type ProductIdentity, type SourceRevision,
} from "@/lib/netshop/insights-contract";
import type { ProductInsightRow, ProductInsightsDTO, SourceSection } from "@/lib/netshop/insights-endpoints";
import { NetshopQueryError } from "@/lib/netshop/query-contract";

export const PRODUCT_SCHEMA = "netshop-product-insights-v1" as const;
export const productSorts = ["payment_desc", "payment_asc", "visitors_desc", "visitors_asc", "conversion_desc", "conversion_asc", "growth_desc", "decline_desc"] as const;
export type ProductSort = typeof productSorts[number];
export const productSections = ["overview", "trends", "daily", "catalog", "sku", "promotion", "erp"] as const;
export type ProductSection = typeof productSections[number];
export const productSources = ["platform", "promotion", "erp"] as const;
export type ProductSource = typeof productSources[number];
export const productMetricKeys = ["payment", "quantity", "visitors", "customers", "conversion", "addCartRate", "refundPayment"] as const;
export type ProductMetricKey = typeof productMetricKeys[number];
export type ProductMetrics = Record<ProductMetricKey, MetricValue>;
export type ProductComparisons = Record<ProductMetricKey, { previous: MetricComparison; yearAgo: MetricComparison }>;
export const extraMetricKeys = ["pageViews", "favorites", "addCartCustomers", "addCartQuantity", "orderCustomers", "orderQuantity", "orderPayment", "transactionOrders", "searchImpressions", "searchClicks", "searchClickRate", "searchVisitors", "searchCustomers", "visitorValue"] as const;
export type ProductExtraMetrics = Record<typeof extraMetricKeys[number], MetricValue>;
export type ProductTableScope = { q: string; category: string; sort: ProductSort; page: number; pageSize: number; section?: ProductSection; source?: ProductSource };

/** Label-only evidence never becomes an official or cross-platform taxonomy. */
export type CategoryEvidence = {
  status: "verified_id" | "label_only" | "unknown";
  sourceId: string | null; namespace: string | null; platform: "京东" | "天猫" | null;
  version: string | null; id: string | null; label: string | null; parentId: string | null;
  effectiveFrom: string | null; effectiveTo: string | null;
};
export type MappingEvidence = {
  status: "verified" | "unmapped" | "ambiguous" | "unverified";
  method: "exact_code_shop" | "historical_sku_spu" | "unverified";
  sourceId: string | null; version: string | null; code: string | null;
  effectiveFrom: string | null; effectiveTo: string | null; reasonCode: MetricReason | null;
};
export type ContributionBucket = { label: string; payment: MetricValue; share: MetricValue; products: MetricValue; categoryEvidence?: CategoryEvidence };
export type ProductStructure = {
  collection: "complete_global_filter_set"; denominator: MetricValue;
  top5Payment: MetricValue; top10Payment: MetricValue; top5Share: MetricValue; top10Share: MetricValue;
  categories: ContributionBucket[]; priceBands: ContributionBucket[];
  categoryBasis: "current_label_only" | "source_label_only" | "verified_historical" | "unverified";
  priceBasis: "transaction_mean" | "current_price";
  classification: { continuous: MetricValue; newlyTraded: MetricValue; noLongerTraded: MetricValue; unknownBaseline: MetricValue };
  qualification: { current: number; paired: number; missingPrevious: number; missingYearAgo: number; incomplete: number };
};
export type ProductEfficiency = {
  metrics: ProductExtraMetrics;
  rules: { id: string; minimumVisitors: number; maximumConversion: number; requireComplete: boolean };
  watchlist: ProductInsightRow[]; pagination: InsightPagination;
  scanned: number; qualified: number;
};
export const qualityKeys = ["missingImage", "missingCode", "missingCategory", "conflict", "stale", "unmapped"] as const;
export type ProductQuality = { counts: Record<typeof qualityKeys[number], MetricValue>; staleAfterDays: number; basis: "current_snapshot" };
export type ProductMetadata = {
  summaryScope: "global_category_filtered"; tableSearchScope: "identity_title_code_only";
  categoryBasis: ProductStructure["categoryBasis"]; priceBasis: ProductStructure["priceBasis"];
  limitations: string[]; categoryEvidence?: CategoryEvidence[];
};
export type ProductInsightsResponse = ProductInsightsDTO & {
  schemaVersion: typeof PRODUCT_SCHEMA; sectionToken: string; tableScope: ProductTableScope;
  joinedSourceRevisions: SourceRevision[]; consistency: "revision_vector_checked";
  sections: ProductInsightsDTO["sections"] & {
    baselineReads: { previous: SourceSection<ProductMetrics>; yearAgo: SourceSection<ProductMetrics> };
    counts?: { dataProducts: MetricValue; tradedProducts: MetricValue };
    structure?: ProductStructure; efficiency?: ProductEfficiency; dataQuality?: ProductQuality; metadata?: ProductMetadata;
  };
};
export type CatalogProfile = {
  identity: ProductIdentity; title: string; imageUrl: string | null; productUrl: string | null;
  skuId: string | null; spuId: string | null; merchantCode: string | null; erpCode: string | null;
  brand: string | null; category: string | null; specification: string | null; state: string | null;
  price: MetricValue; inventory: { total: MetricValue; available: MetricValue };
  snapshots: { master: string | null; image: string | null; price: string | null; inventory: string | null };
  mapping: MappingEvidence; categoryEvidence: CategoryEvidence; quality: string[];
};
export type PromotionMetrics = Record<"spend" | "attributedPayment" | "roas" | "clicks", MetricValue>;
export type ErpMetrics = Record<"netSales" | "cost" | "largeMarginRate" | "orderMargin" | "returnAmount" | "returnQuantity", MetricValue>;
export type LinkedPromotion = { metrics: PromotionMetrics; mapping: MappingEvidence; attributionWindow: string | null };
export type LinkedErp = { metrics: ErpMetrics; mapping: MappingEvidence };
export type ProductDailyRow = { date: string } & (
  { source: "platform"; metrics: ProductMetrics & ProductExtraMetrics }
  | { source: "promotion"; metrics: PromotionMetrics }
  | { source: "erp"; metrics: ErpMetrics }
);
export type ProductDailyData = { source: ProductSource; items: ProductDailyRow[]; pagination: InsightPagination; definitions: string[]; startDate: string; endDate: string; sourceRevisions: SourceRevision[] };
export type SkuContribution = { status: "available" | "unavailable"; reasonCode: MetricReason | null; basis: "historical_relation"; relationVersion: string | null; items: ProductInsightRow[]; pagination: InsightPagination };
export type ProductDetailResponse = {
  schemaVersion: typeof PRODUCT_SCHEMA; context: InsightsContext; sectionToken: string;
  tableScope: ProductTableScope; identity: ProductIdentity; joinedSourceRevisions: SourceRevision[]; consistency: "revision_vector_checked";
  sections: {
    performance: ProductInsightRow; baselineReads: ProductInsightsResponse["sections"]["baselineReads"];
    catalog: SourceSection<CatalogProfile | null>; extras?: ProductExtraMetrics;
    promotion: SourceSection<LinkedPromotion>; erp: SourceSection<LinkedErp>;
    daily?: SourceSection<ProductDailyData>; trends?: SourceSection<ProductDailyData>;
    skuContribution?: SkuContribution; metadata: ProductMetadata;
  };
};

const sharedKeys = new Set(["platform", "outlet", "dimension", "startDate", "endDate", "periodKind", "snapshotToken"]);
const ownKeys = new Set(["q", "category", "page", "pageSize", "sort", "productIdentity", "sectionToken", "section", "source"]);
const fail = (message: string): never => { throw new NetshopQueryError("invalid_product_insights_contract", message); };
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) return fail("商品响应对象无效"); return value as Record<string, unknown>; }
function text(value: unknown, maximum: number, empty = false): value is string { return typeof value === "string" && value.length <= maximum && (empty || value.trim().length > 0) && !/[\u0000-\u001f\u007f]/.test(value); }
function referenceText(value: unknown, maximum: number): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= maximum && !/[\u0000-\u001e\u007f]/.test(value); }
function token(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function count(value: unknown, maximum = Number.MAX_SAFE_INTEGER): value is number { return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= maximum; }
function pageNumber(value: string | null, fallback: number, maximum: number) { if (value === null) return fallback; if (!/^[1-9]\d*$/.test(value) || !count(Number(value), maximum)) return fail("商品分页参数无效"); return Number(value); }
export function productContextQuery(params: URLSearchParams) { const query = new URLSearchParams(); for (const [key, value] of params) if (sharedKeys.has(key)) query.append(key, value); return query; }
export function validateProductQuery(params: URLSearchParams, detail = false) {
  for (const key of params.keys()) if (!sharedKeys.has(key) && !ownKeys.has(key) || !["platform", "outlet"].includes(key) && params.getAll(key).length !== 1) return fail("商品请求包含未知或重复参数");
  const query = productContextQuery(params), shared = validateContextQuery(query);
  const q = (params.get("q") ?? "").trim(), category = (params.get("category") ?? "").trim(), sort = params.get("sort") ?? "payment_desc";
  if (!text(q, 120, true) || !text(category, 200, true) || !productSorts.includes(sort as ProductSort) || params.has("sectionToken") && !token(params.get("sectionToken"))) return fail("商品筛选或版本无效");
  const page = pageNumber(params.get("page"), 1, 10000), pageSize = pageNumber(params.get("pageSize"), 20, 100);
  const section = params.get("section") ?? "overview", source = params.get("source") ?? "platform";
  if (!productSections.includes(section as ProductSection) || !productSources.includes(source as ProductSource) || params.has("source") && !["daily", "trends"].includes(section) || !detail && (params.has("section") || params.has("source") || params.has("productIdentity"))) return fail("商品详情分区与来源组合无效");
  let identity: ProductIdentity | null = null;
  if (detail) {
    try { const raw = JSON.parse(params.get("productIdentity") ?? "null"); if (!Array.isArray(raw) || raw.length !== 4) return fail("详情须提供精确商品身份"); identity = { platform: raw[0], shopName: raw[1], dimension: raw[2], id: raw[3] }; encodeProductIdentity(identity); }
    catch { return fail("详情商品身份无效"); }
    if (shared.platforms.length !== 1 || shared.shops.length !== 1 || !shared.platforms.includes(identity.platform) || identity.dimension !== shared.dimension || !shared.shops.some(shop => shop.platform === identity!.platform && shop.shopName === identity!.shopName)) return fail("详情须只选择目标平台、店铺和维度");
  }
  return { query, shared, identity, tableScope: { q, category, sort: sort as ProductSort, page, pageSize, ...(detail ? { section: section as ProductSection, source: source as ProductSource } : {}) } };
}
function metricRecord(value: unknown, keys: readonly string[], core = false): Record<string, MetricValue> {
  const input = object(value), result: Record<string, MetricValue> = {};
  for (const key of keys) {
    const metric = decodeMetric(input[key]);
    if (core) { const expected = key === "payment" || key === "refundPayment" ? "CNY_CENT" : key === "conversion" || key === "addCartRate" ? "RATIO" : "COUNT"; if (metric.unit !== expected || !["product_day_sum", "unverified"].includes(metric.basis)) return fail("商品指标单位或来源口径不匹配"); }
    result[key] = metric;
  }
  return result;
}
function comparison(value: unknown, method: "relative_change" | "percentage_points"): MetricComparison {
  const input = object(value);
  if (input.method !== method || !["available", "unavailable"].includes(String(input.status)) || input.status === "available" && (typeof input.value !== "number" || !Number.isFinite(input.value) || input.reasonCode !== null) || input.status === "unavailable" && (input.value !== null || !metricReasons.includes(input.reasonCode as MetricReason))) return fail("商品比较状态无效");
  return input as MetricComparison;
}
function comparisons(value: unknown): ProductComparisons { const input = object(value); return Object.fromEntries(productMetricKeys.map(key => { const pair = object(input[key]), method = key === "conversion" || key === "addCartRate" ? "percentage_points" : "relative_change"; return [key, { previous: comparison(pair.previous, method), yearAgo: comparison(pair.yearAgo, method) }]; })) as ProductComparisons; }
function identity(value: unknown, context: InsightsContext): ProductIdentity {
  const input = object(value) as ProductIdentity; encodeProductIdentity(input);
  if (input.dimension !== context.effectiveScope.dimension || !context.effectiveScope.shopKeys.includes(`${input.platform}\u001f${input.shopName}`)) return fail("商品响应身份跨店或跨维度");
  return input;
}
function row(value: unknown, context: InsightsContext): ProductInsightRow {
  const input = object(value); identity(input.identity, context);
  if (!text(input.title, 2000) || input.category !== null && !text(input.category, 2000, true) || input.imageUrl !== null && !text(input.imageUrl, 8000)) return fail("商品身份资料无效");
  metricRecord(input.metrics, productMetricKeys, true); comparisons(input.comparisons);
  return input as ProductInsightRow;
}
function sourceSection<T>(value: unknown, decode: (value: unknown) => T): SourceSection<T> {
  const input = object(value);
  if (input.state === "ready") { decode(input.data); return input as SourceSection<T>; }
  if (input.state !== "error" || input.data !== null || !["access_denied", "service_unavailable", "insights_revision_changed"].includes(String(input.code)) || !text(input.message, 2000)) return fail("商品来源分区状态无效");
  return input as SourceSection<T>;
}
function envelope(value: unknown, params: URLSearchParams, revision: string | null | undefined, detail: boolean) {
  if (new TextEncoder().encode(JSON.stringify(value)).length > insightBudget.responseBytes) return fail("商品响应超出2MiB");
  const input = object(value), request = validateProductQuery(params, detail);
  if (input.schemaVersion !== PRODUCT_SCHEMA || !token(input.sectionToken) || input.consistency !== "revision_vector_checked") return fail("商品协议或令牌无效");
  const context = decodeInsightsContextForQuery(input.context, request.query, revision ?? null), scope = object(input.tableScope);
  for (const [key, expected] of Object.entries(request.tableScope)) if (scope[key] !== expected) return fail("商品列表或详情返回了其他筛选范围");
  if (params.has("sectionToken") && input.sectionToken !== params.get("sectionToken")) return fail("商品sectionToken跨范围或版本");
  if (!Array.isArray(input.joinedSourceRevisions) || input.joinedSourceRevisions.length > 255) return fail("商品参与来源向量无效");
  const joined = new Map<string, SourceRevision>();
  for (const raw of input.joinedSourceRevisions) { const r = object(raw) as SourceRevision, key = JSON.stringify([r.domain, r.kind, r.scopeKey]); if (!["netshop", "sales", "products", "inventory", "finance", "erp_reference", "workflow"].includes(r.domain) || !referenceText(r.kind, 200) || !referenceText(r.scopeKey, 1024) || !text(r.revision, 1024) || joined.has(key)) return fail("商品来源向量重复或定义无效"); joined.set(key, r); }
  for (const r of context.sourceRevisions) if (joined.get(JSON.stringify([r.domain, r.kind, r.scopeKey]))?.revision !== r.revision) return fail("商品参与向量缺少或混用了拥有方版本");
  return { input, context, request, sections: object(input.sections) };
}
export function decodeProductInsights(value: unknown, params: URLSearchParams, revision: string | null | undefined): ProductInsightsResponse {
  const { input, context, sections } = envelope(value, params, revision, false);
  metricRecord(sections.summary, productMetricKeys, true); comparisons(sections.comparisons);
  const pagination = decodeInsightPagination(sections.pagination);
  if (!Array.isArray(sections.items) || sections.items.length !== pagination.returned || sections.items.length > 100 || pagination.page !== object(input.tableScope).page || pagination.pageSize !== object(input.tableScope).pageSize) return fail("商品分页与回执不一致");
  const seen = new Set<string>(); for (const item of sections.items) { const decoded = row(item, context), key = encodeProductIdentity(decoded.identity); if (seen.has(key)) return fail("同页商品身份重复"); seen.add(key); }
  const baselines = object(sections.baselineReads); for (const kind of ["previous", "yearAgo"]) sourceSection(baselines[kind], v => metricRecord(v, productMetricKeys, true));
  sourceSection(sections.growth, v => { const growth = object(v), p = decodeInsightPagination(growth.pagination); if (growth.collection !== "paired_full_set_before_pagination" || !Array.isArray(growth.items) || growth.items.length !== p.returned || growth.items.length > 100) return fail("贡献排行必须完整配对后分页"); growth.items.forEach(item => row(item, context)); return growth; });
  if (sections.counts !== undefined) { const counts = metricRecord(sections.counts, ["dataProducts", "tradedProducts"]); for (const metric of Object.values(counts)) if (metric.unit !== "COUNT" || metric.value !== null && metric.value < 0) return fail("商品数口径无效"); }
  if (sections.efficiency !== undefined) { const e = object(sections.efficiency); metricRecord(e.metrics, extraMetricKeys); if (!Array.isArray(e.watchlist) || e.watchlist.length > 100 || !count(e.scanned) || !count(e.qualified)) return fail("关注清单无界或样本计数无效"); e.watchlist.forEach(item => row(item, context)); decodeInsightPagination(e.pagination); const rules = object(e.rules); if (!text(rules.id, 200) || !count(rules.minimumVisitors) || typeof rules.maximumConversion !== "number" || !Number.isFinite(rules.maximumConversion) || rules.maximumConversion < 0 || typeof rules.requireComplete !== "boolean") return fail("关注规则无效"); }
  if (sections.structure !== undefined) { const s = object(sections.structure); if (s.collection !== "complete_global_filter_set" || !["transaction_mean", "current_price"].includes(String(s.priceBasis)) || !["current_label_only", "source_label_only", "verified_historical", "unverified"].includes(String(s.categoryBasis))) return fail("商品结构集合或价格类目依据无效"); metricRecord(s, ["denominator", "top5Payment", "top10Payment", "top5Share", "top10Share"]); for (const key of ["categories", "priceBands"]) { if (!Array.isArray(s[key]) || s[key].length > 500) return fail("结构分组无界"); for (const raw of s[key]) { const b = object(raw); if (!text(b.label, 2000)) return fail("结构分组标签无效"); metricRecord(b, ["payment", "share", "products"]); } } }
  if (sections.dataQuality !== undefined) { const q = object(sections.dataQuality); if (q.basis !== "current_snapshot" || !count(q.staleAfterDays, 36600)) return fail("资料质量快照依据无效"); metricRecord(q.counts, qualityKeys); }
  return input as ProductInsightsResponse;
}
export function decodeProductDetail(value: unknown, params: URLSearchParams, revision: string | null | undefined): ProductDetailResponse {
  const { input, context, request, sections } = envelope(value, params, revision, true);
  const actual = identity(input.identity, context); if (encodeProductIdentity(actual) !== encodeProductIdentity(request.identity!)) return fail("详情返回了其他商品");
  const performance = row(sections.performance, context); if (encodeProductIdentity(performance.identity) !== encodeProductIdentity(actual)) return fail("详情经营身份不一致");
  const baselines = object(sections.baselineReads); for (const kind of ["previous", "yearAgo"]) sourceSection(baselines[kind], v => metricRecord(v, productMetricKeys, true));
  sourceSection(sections.catalog, v => { if (v === null) return null; const profile = object(v); if (encodeProductIdentity(identity(profile.identity, context)) !== encodeProductIdentity(actual) || !text(profile.title, 2000)) return fail("资料身份不一致"); decodeMetric(profile.price); metricRecord(profile.inventory, ["total", "available"]); return profile; });
  sourceSection(sections.promotion, v => metricRecord(object(v).metrics, ["spend", "attributedPayment", "roas", "clicks"]));
  sourceSection(sections.erp, v => metricRecord(object(v).metrics, ["netSales", "cost", "largeMarginRate", "orderMargin", "returnAmount", "returnQuantity"]));
  if (sections.extras !== undefined) metricRecord(sections.extras, extraMetricKeys);
  for (const kind of ["daily", "trends"]) if (sections[kind] !== undefined) sourceSection(sections[kind], v => { const data = object(v), p = decodeInsightPagination(data.pagination); if (!productSources.includes(data.source as ProductSource) || data.source !== request.tableScope.source || !Array.isArray(data.items) || data.items.length !== p.returned || data.items.length > 100 || data.startDate !== context.periods.current.startDate || data.endDate !== context.periods.current.endDate) return fail("单品来源明细范围或分页无效"); const seen = new Set<string>(); for (const raw of data.items) { const item = object(raw); if (typeof item.date !== "string" || item.date < String(data.startDate) || item.date > String(data.endDate) || !/^\d{4}-\d{2}-\d{2}$/.test(item.date) || seen.has(item.date) || item.source !== data.source) return fail("单品日期重复、越界或跨源"); seen.add(item.date); metricRecord(item.metrics, data.source === "platform" ? [...productMetricKeys, ...extraMetricKeys] : data.source === "promotion" ? ["spend", "attributedPayment", "roas", "clicks"] : ["netSales", "cost", "largeMarginRate", "orderMargin", "returnAmount", "returnQuantity"]); } return data; });
  if (sections.skuContribution !== undefined) { const sku = object(sections.skuContribution), p = decodeInsightPagination(sku.pagination); if (!["available", "unavailable"].includes(String(sku.status)) || sku.basis !== "historical_relation" || !Array.isArray(sku.items) || sku.items.length !== p.returned || sku.status === "unavailable" && (sku.items.length !== 0 || !metricReasons.includes(sku.reasonCode as MetricReason)) || sku.status === "available" && (sku.reasonCode !== null || !text(sku.relationVersion, 1024))) return fail("SKU历史关系贡献没有可靠依据"); }
  return input as ProductDetailResponse;
}
