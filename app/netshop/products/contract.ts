import {
  decodeInsightPagination, decodeInsightsContext, decodeInsightsContextForQuery, decodeMetric, decodeDerivedMoneyPerCount,
  encodeProductIdentity, insightBudget, metricReasons, validateContextQuery,
  type InsightPagination, type InsightsContext, type MetricComparison,
  type MetricReason, type MetricValue, type ProductIdentity, type SourceRevision, type DerivedMoneyPerCountV1,
} from "@/lib/netshop/insights-contract";
import type { ProductInsightRow, ProductInsightsDTO, SourceSection } from "@/lib/netshop/insights-endpoints";
import { isNetshopIsoDate, NetshopQueryError } from "@/lib/netshop/query-contract";

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
export const extraMetricKeys = ["pageViews", "favorites", "addCartCustomers", "addCartQuantity", "orderCustomers", "orderQuantity", "orderPayment", "transactionOrders", "searchImpressions", "searchClicks", "searchClickRate", "searchVisitors", "searchCustomers"] as const;
export type ProductExtraMetrics = Record<typeof extraMetricKeys[number], MetricValue>;
export type ProductRow = ProductInsightRow & {
  baselineMetrics: { previous: ProductMetrics; yearAgo: ProductMetrics };
  paymentDelta?: MetricValue; categoryEvidence?: CategoryEvidence;
};
export type ProductTableScope = { q: string; category: string; sort: ProductSort; page: number; pageSize: number; section?: ProductSection; source?: ProductSource };

/** Label-only evidence never becomes an official or cross-platform taxonomy. */
export type CategoryEvidence = {
  status: "verified_id" | "label_only" | "unknown";
  sourceId: string | null; namespace: string | null; platform: "京东" | "天猫" | null;
  version: string | null; id: string | null; label: string | null; parentId: string | null;
  effectiveFrom: string | null; effectiveTo: string | null;
  versionKind?: "import_snapshot" | "source_revision" | "vendor_taxonomy" | "unknown";
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
  changes?: Record<"pairedCurrentPayment" | "pairedPreviousPayment" | "growthPayment" | "declinePayment" | "netChange", MetricValue>;
};
export type ProductEfficiency = {
  metrics: ProductExtraMetrics;
  visitorValue?: DerivedMoneyPerCountV1;
  rules: { id: string; minimumVisitors: number; maximumConversion: number; requireComplete: boolean };
  watchlist: ProductRow[]; pagination: InsightPagination;
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
    items: ProductRow[];
    growth: SourceSection<{ collection: "paired_full_set_before_pagination"; items: ProductRow[]; pagination: InsightPagination }>;
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
export type ProductDailyRow = { date: string; visitorValue?: DerivedMoneyPerCountV1 } & (
  { source: "platform"; metrics: ProductMetrics & ProductExtraMetrics }
  | { source: "promotion"; metrics: PromotionMetrics }
  | { source: "erp"; metrics: ErpMetrics }
);
export type ProductDailyData = { source: ProductSource; items: ProductDailyRow[]; pagination: InsightPagination; definitions: string[]; startDate: string; endDate: string; sourceRevisions: SourceRevision[] };
export type SkuContribution = { status: "available" | "unavailable"; reasonCode: MetricReason | null; basis: "historical_relation"; relationVersion: string | null; parentIdentity?: ProductIdentity; context?: InsightsContext; items: ProductRow[]; pagination: InsightPagination };
export type ProductDetailResponse = {
  schemaVersion: typeof PRODUCT_SCHEMA; context: InsightsContext; sectionToken: string;
  tableScope: ProductTableScope; identity: ProductIdentity; joinedSourceRevisions: SourceRevision[]; consistency: "revision_vector_checked";
  sections: {
    performance: ProductRow; baselineReads: ProductInsightsResponse["sections"]["baselineReads"];
    catalog: SourceSection<CatalogProfile | null>; extras?: ProductExtraMetrics;
    visitorValue?: DerivedMoneyPerCountV1;
    promotion: SourceSection<LinkedPromotion>; erp: SourceSection<LinkedErp>;
    daily?: SourceSection<ProductDailyData>; trends?: SourceSection<ProductDailyData>;
    skuContribution?: SkuContribution; metadata: ProductMetadata;
  };
};

export class ProductResponseError extends Error {
  constructor(readonly status: 403 | 409, readonly code: "access_denied" | "insights_revision_changed", message: string) { super(message); }
}

const sharedKeys = new Set(["platform", "outlet", "dimension", "startDate", "endDate", "periodKind", "snapshotToken"]);
const ownKeys = new Set(["q", "category", "page", "pageSize", "sort", "productIdentity", "sectionToken", "section", "source"]);
const fail = (message: string): never => { throw new NetshopQueryError("invalid_product_insights_contract", message); };
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) return fail("商品响应对象无效"); return value as Record<string, unknown>; }
function text(value: unknown, maximum: number, empty = false): value is string { return typeof value === "string" && value.length <= maximum && (empty || value.trim().length > 0) && !/[\u0000-\u001f\u007f]/.test(value); }
function referenceText(value: unknown, maximum: number): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= maximum && !/[\u0000-\u001e\u007f]/.test(value); }
function displayText(value: unknown, maximum = 2000): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= maximum && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value); }
function nullableText(value: unknown, maximum = 2000): boolean { return value === null || displayText(value, maximum); }
function dateOrNull(value: unknown): boolean { return value === null || typeof value === "string" && isNetshopIsoDate(value); }
function strings(value: unknown, maximum = 50) { if (!Array.isArray(value) || value.length > maximum || !value.every(v => displayText(v))) return fail("商品文字列表无效或无界"); return value as string[]; }
function token(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function count(value: unknown, maximum = Number.MAX_SAFE_INTEGER): value is number { return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= maximum; }
function pageNumber(value: string | null, fallback: number, maximum: number) { if (value === null) return fallback; if (!/^[1-9]\d*$/.test(value) || !count(Number(value), maximum)) return fail("商品分页参数无效"); return Number(value); }
export function productContextQuery(params: URLSearchParams) { const query = new URLSearchParams(); for (const [key, value] of params) if (sharedKeys.has(key)) query.append(key, value); return query; }
export function validateProductQuery(params: URLSearchParams, detail = false) {
  for (const key of params.keys()) if (!sharedKeys.has(key) && !ownKeys.has(key) || !["platform", "outlet"].includes(key) && params.getAll(key).length !== 1) return fail("商品请求包含未知或重复参数");
  const query = productContextQuery(params), shared = validateContextQuery(query);
  const q = (params.get("q") ?? "").trim(), category = (params.get("category") ?? "").trim(), sort = params.get("sort") ?? "payment_desc";
  if (!text(q, 120, true) || !text(category, 120, true) || !productSorts.includes(sort as ProductSort) || params.has("sectionToken") && !token(params.get("sectionToken"))) return fail("商品筛选或版本无效");
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
function extraMetrics(value: unknown) {
  const result = metricRecord(value, extraMetricKeys);
  for (const [key, metric] of Object.entries(result)) if (metric.unit !== (key === "orderPayment" ? "CNY_CENT" : key === "searchClickRate" ? "RATIO" : "COUNT") || !["product_day_sum", "unverified"].includes(metric.basis)) return fail("平台专项指标单位或口径不匹配");
  return result;
}
function visitorValue(value: unknown) { const metric = decodeDerivedMoneyPerCount(value); if (metric.denominatorKind !== "product_day_visitors_sum" || !["product_day_sum", "unverified"].includes(metric.basis)) return fail("商品访客价值分母或口径不匹配"); return metric; }
function promotionMetrics(value: unknown) { const metrics = metricRecord(value, ["spend", "attributedPayment", "roas", "clicks"]); for (const [key, m] of Object.entries(metrics)) if (m.unit !== (key === "roas" ? "MULTIPLE" : key === "clicks" ? "COUNT" : "CNY_CENT") || !["platform_attributed", "unverified"].includes(m.basis)) return fail("广告指标单位或来源口径无效"); return metrics; }
function erpMetrics(value: unknown) { const metrics = metricRecord(value, ["netSales", "cost", "largeMarginRate", "orderMargin", "returnAmount", "returnQuantity"]); for (const [key, m] of Object.entries(metrics)) if (m.unit !== (key === "largeMarginRate" ? "RATIO" : key === "returnQuantity" ? "COUNT" : "CNY_CENT") || !["erp_net_sales", "erp_order_margin", "erp_large_margin", "unverified"].includes(m.basis)) return fail("ERP指标单位或来源口径无效"); return metrics; }
function categoryEvidence(value: unknown): CategoryEvidence {
  const e = object(value);
  if (!["verified_id", "label_only", "unknown"].includes(String(e.status)) || ![null, "京东", "天猫"].includes(e.platform as null | "京东" | "天猫") || !["sourceId", "namespace", "version", "id", "label", "parentId"].every(k => nullableText(e[k])) || !dateOrNull(e.effectiveFrom) || !dateOrNull(e.effectiveTo) || e.effectiveFrom !== null && e.effectiveTo !== null && String(e.effectiveFrom) > String(e.effectiveTo)) return fail("类目来源与有效期证据无效");
  if (e.versionKind !== undefined && !["import_snapshot", "source_revision", "vendor_taxonomy", "unknown"].includes(String(e.versionKind))) return fail("类目版本种类无效");
  if (e.status === "verified_id" && ["sourceId", "namespace", "version", "id"].some(k => !displayText(e[k])) || e.status === "verified_id" && e.platform === null || e.status !== "verified_id" && (e.id !== null || e.parentId !== null) || e.status === "label_only" && (!displayText(e.label) || e.effectiveFrom !== null || e.effectiveTo !== null)) return fail("类目标签不能冒充已验证分类或历史归属");
  return e as CategoryEvidence;
}
function mappingEvidence(value: unknown): MappingEvidence {
  const e = object(value);
  if (!["verified", "unmapped", "ambiguous", "unverified"].includes(String(e.status)) || !["exact_code_shop", "historical_sku_spu", "unverified"].includes(String(e.method)) || !["sourceId", "version", "code"].every(k => nullableText(e[k])) || !dateOrNull(e.effectiveFrom) || !dateOrNull(e.effectiveTo) || e.effectiveFrom !== null && e.effectiveTo !== null && String(e.effectiveFrom) > String(e.effectiveTo) || e.reasonCode !== null && !metricReasons.includes(e.reasonCode as MetricReason)) return fail("关联证据定义无效");
  if (e.status === "verified" && (e.reasonCode !== null || e.method === "unverified" || !displayText(e.sourceId) || !displayText(e.version) || e.method === "exact_code_shop" && !displayText(e.code)) || e.status !== "verified" && e.reasonCode === null) return fail("未核验关联不能声明已验证");
  return e as MappingEvidence;
}
function metadata(value: unknown): ProductMetadata {
  const m = object(value);
  if (m.summaryScope !== "global_category_filtered" || m.tableSearchScope !== "identity_title_code_only" || !["current_label_only", "source_label_only", "verified_historical", "unverified"].includes(String(m.categoryBasis)) || !["transaction_mean", "current_price"].includes(String(m.priceBasis))) return fail("商品汇总、搜索或分类价格依据无效");
  strings(m.limitations);
  if (m.categoryEvidence !== undefined) { if (!Array.isArray(m.categoryEvidence) || m.categoryEvidence.length > 500) return fail("类目来源证据无界"); m.categoryEvidence.forEach(categoryEvidence); }
  return m as ProductMetadata;
}
function revisionVector(value: unknown, context?: InsightsContext) {
  if (!Array.isArray(value) || value.length > 255) return fail("商品参与来源向量无效");
  const joined = new Map<string, SourceRevision>();
  for (const raw of value) { const r = object(raw) as SourceRevision, key = JSON.stringify([r.domain, r.kind, r.scopeKey]); if (!["netshop", "sales", "products", "inventory", "finance", "erp_reference", "workflow"].includes(r.domain) || !referenceText(r.kind, 200) || !referenceText(r.scopeKey, 1024) || !text(r.revision, 1024) || joined.has(key)) return fail("商品来源向量重复或定义无效"); joined.set(key, r); }
  if (context) for (const r of context.sourceRevisions) if (joined.get(JSON.stringify([r.domain, r.kind, r.scopeKey]))?.revision !== r.revision) return fail("商品参与向量缺少或混用了拥有方版本");
  return joined;
}
function catalogProfile(value: unknown, context: InsightsContext, expected: ProductIdentity) {
  if (value === null) return null;
  const p = object(value);
  if (encodeProductIdentity(identity(p.identity, context)) !== encodeProductIdentity(expected) || !displayText(p.title) || !["imageUrl", "productUrl", "skuId", "spuId", "merchantCode", "erpCode", "brand", "category", "specification", "state"].every(k => nullableText(p[k], 8000))) return fail("资料身份或字段定义不一致");
  const price = decodeMetric(p.price), inventory = metricRecord(p.inventory, ["total", "available"]);
  if (price.unit !== "CNY_CENT" || !["current_snapshot", "unverified"].includes(price.basis) || Object.values(inventory).some(m => m.unit !== "COUNT" || !["current_snapshot", "unverified"].includes(m.basis))) return fail("当前价格或库存不能冒历史经营指标");
  const snapshots = object(p.snapshots); if (!["master", "image", "price", "inventory"].every(k => dateOrNull(snapshots[k]))) return fail("资料各来源快照日期无效");
  mappingEvidence(p.mapping); categoryEvidence(p.categoryEvidence); strings(p.quality, 100);
  return p as CatalogProfile;
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
function row(value: unknown, context: InsightsContext): ProductRow {
  const input = object(value); identity(input.identity, context);
  if (!displayText(input.title) || input.category !== null && !displayText(input.category) || input.imageUrl !== null && !text(input.imageUrl, 8000)) return fail("商品身份资料无效");
  metricRecord(input.metrics, productMetricKeys, true); comparisons(input.comparisons);
  const baselines = object(input.baselineMetrics); metricRecord(baselines.previous, productMetricKeys, true); metricRecord(baselines.yearAgo, productMetricKeys, true);
  if (input.paymentDelta !== undefined) { const d = decodeMetric(input.paymentDelta); if (d.unit !== "CNY_CENT" || !["product_day_sum", "unverified"].includes(d.basis)) return fail("贡献变化须以安全整数分表示"); }
  if (input.categoryEvidence !== undefined) categoryEvidence(input.categoryEvidence);
  return input as ProductRow;
}
function sourceSection<T>(value: unknown, decode: (value: unknown) => T): SourceSection<T> {
  const input = object(value);
  if (input.state === "ready") { decode(input.data); return input as SourceSection<T>; }
  if (input.state !== "error" || input.data !== null || !["access_denied", "service_unavailable", "insights_revision_changed"].includes(String(input.code)) || !text(input.message, 2000)) return fail("商品来源分区状态无效");
  return input as SourceSection<T>;
}
function baselineReads(value: unknown) {
  const reads = object(value);
  for (const kind of ["previous", "yearAgo"]) {
    const section = sourceSection(reads[kind], v => metricRecord(v, productMetricKeys, true));
    if (section.state === "error" && section.code === "access_denied") throw new ProductResponseError(403, "access_denied", "基期读取权限失效，请重新读取当前授权范围");
    if (section.state === "error" && section.code === "insights_revision_changed") throw new ProductResponseError(409, "insights_revision_changed", "基期来源版本变化，请完整重读");
  }
  return reads;
}
function envelope(value: unknown, params: URLSearchParams, revision: string | null | undefined, detail: boolean) {
  if (new TextEncoder().encode(JSON.stringify(value)).length > insightBudget.responseBytes) return fail("商品响应超出2MiB");
  const input = object(value), request = validateProductQuery(params, detail);
  if (input.schemaVersion !== PRODUCT_SCHEMA || !token(input.sectionToken) || input.consistency !== "revision_vector_checked") return fail("商品协议或令牌无效");
  const context = decodeInsightsContextForQuery(input.context, request.query, revision ?? null), scope = object(input.tableScope);
  for (const [key, expected] of Object.entries(request.tableScope)) if (scope[key] !== expected) return fail("商品列表或详情返回了其他筛选范围");
  if (params.has("sectionToken") && input.sectionToken !== params.get("sectionToken")) return fail("商品sectionToken跨范围或版本");
  revisionVector(input.joinedSourceRevisions, context);
  return { input, context, request, sections: object(input.sections) };
}
export function decodeProductInsights(value: unknown, params: URLSearchParams, revision: string | null | undefined): ProductInsightsResponse {
  const { input, context, sections } = envelope(value, params, revision, false);
  metricRecord(sections.summary, productMetricKeys, true); comparisons(sections.comparisons);
  const pagination = decodeInsightPagination(sections.pagination);
  if (!Array.isArray(sections.items) || sections.items.length !== pagination.returned || sections.items.length > 100 || pagination.page !== object(input.tableScope).page || pagination.pageSize !== object(input.tableScope).pageSize) return fail("商品分页与回执不一致");
  const seen = new Set<string>(); for (const item of sections.items) { const decoded = row(item, context), key = encodeProductIdentity(decoded.identity); if (seen.has(key)) return fail("同页商品身份重复"); seen.add(key); }
  const baselines = baselineReads(sections.baselineReads);
  for (const kind of ["previous", "yearAgo"]) if (object(baselines[kind]).state === "error") for (const key of productMetricKeys) if (object(object(object(sections.comparisons)[key])[kind]).status === "available") return fail("失败基期不能提供可用的整期比较");
  sourceSection(sections.growth, v => { const growth = object(v), p = decodeInsightPagination(growth.pagination); if (growth.collection !== "paired_full_set_before_pagination" || !Array.isArray(growth.items) || growth.items.length !== p.returned || growth.items.length > 100) return fail("贡献排行必须完整配对后分页"); growth.items.forEach(item => row(item, context)); return growth; });
  if (sections.counts !== undefined) { const counts = metricRecord(sections.counts, ["dataProducts", "tradedProducts"]); for (const metric of Object.values(counts)) if (metric.unit !== "COUNT" || metric.value !== null && metric.value < 0) return fail("商品数口径无效"); }
  if (sections.efficiency !== undefined) { const e = object(sections.efficiency); extraMetrics(e.metrics); if (e.visitorValue !== undefined) visitorValue(e.visitorValue); if (!Array.isArray(e.watchlist) || e.watchlist.length > 100 || !count(e.scanned) || !count(e.qualified) || Number(e.qualified) > Number(e.scanned)) return fail("关注清单无界或样本计数无效"); e.watchlist.forEach(item => row(item, context)); const p = decodeInsightPagination(e.pagination); if (p.returned !== e.watchlist.length) return fail("关注清单回执数量不一致"); const rules = object(e.rules); if (!text(rules.id, 200) || !count(rules.minimumVisitors) || typeof rules.maximumConversion !== "number" || !Number.isFinite(rules.maximumConversion) || rules.maximumConversion < 0 || typeof rules.requireComplete !== "boolean") return fail("关注规则无效"); }
  if (sections.structure !== undefined) { const s = object(sections.structure); if (s.collection !== "complete_global_filter_set" || !["transaction_mean", "current_price"].includes(String(s.priceBasis)) || !["current_label_only", "source_label_only", "verified_historical", "unverified"].includes(String(s.categoryBasis))) return fail("商品结构集合或价格类目依据无效"); const m = metricRecord(s, ["denominator", "top5Payment", "top10Payment", "top5Share", "top10Share"]); for (const [k, v] of Object.entries(m)) if (v.unit !== (k.endsWith("Share") ? "RATIO" : "CNY_CENT")) return fail("集中度分子或完整分母单位无效"); const cls = metricRecord(s.classification, ["continuous", "newlyTraded", "noLongerTraded", "unknownBaseline"]); if (Object.values(cls).some(v => v.unit !== "COUNT")) return fail("成交资格分类必须是商品数"); const q = object(s.qualification); if (!["current", "paired", "missingPrevious", "missingYearAgo", "incomplete"].every(k => count(q[k]))) return fail("两期可比完整集合资格无效"); if (s.changes !== undefined) { const changes = metricRecord(s.changes, ["pairedCurrentPayment", "pairedPreviousPayment", "growthPayment", "declinePayment", "netChange"]); if (Object.values(changes).some(v => v.unit !== "CNY_CENT")) return fail("完整贡献金额单位无效"); } for (const key of ["categories", "priceBands"]) { if (!Array.isArray(s[key]) || s[key].length > 500) return fail("结构分组无界"); for (const raw of s[key]) { const b = object(raw); if (!displayText(b.label)) return fail("结构分组标签无效"); const metrics = metricRecord(b, ["payment", "share", "products"]); if (metrics.payment.unit !== "CNY_CENT" || metrics.share.unit !== "RATIO" || metrics.products.unit !== "COUNT") return fail("结构分组指标单位无效"); if (b.categoryEvidence !== undefined) categoryEvidence(b.categoryEvidence); } } }
  if (sections.dataQuality !== undefined) { const q = object(sections.dataQuality); if (q.basis !== "current_snapshot" || !count(q.staleAfterDays, 36600)) return fail("资料质量快照依据无效"); metricRecord(q.counts, qualityKeys); }
  if (sections.metadata !== undefined) metadata(sections.metadata);
  return input as ProductInsightsResponse;
}
export function decodeProductDetail(value: unknown, params: URLSearchParams, revision: string | null | undefined): ProductDetailResponse {
  const { input, context, request, sections } = envelope(value, params, revision, true);
  const actual = identity(input.identity, context); if (encodeProductIdentity(actual) !== encodeProductIdentity(request.identity!)) return fail("详情返回了其他商品");
  const performance = row(sections.performance, context); if (encodeProductIdentity(performance.identity) !== encodeProductIdentity(actual)) return fail("详情经营身份不一致");
  baselineReads(sections.baselineReads);
  sourceSection(sections.catalog, v => catalogProfile(v, context, actual));
  sourceSection(sections.promotion, v => { const data = object(v), metrics = promotionMetrics(data.metrics), mapping = mappingEvidence(data.mapping); if (!nullableText(data.attributionWindow)) return fail("广告归因窗口无效"); if (mapping.status !== "verified" && Object.values(metrics).some(m => m.value !== null)) return fail("未验证广告身份不得返回归因金额"); return data; });
  sourceSection(sections.erp, v => { const data = object(v), metrics = erpMetrics(data.metrics), mapping = mappingEvidence(data.mapping); if (mapping.status !== "verified" && Object.values(metrics).some(m => m.value !== null)) return fail("未验证ERP映射不得推断净额、成本或毛利"); return data; });
  if (sections.extras !== undefined) extraMetrics(sections.extras);
  if (sections.visitorValue !== undefined) visitorValue(sections.visitorValue);
  metadata(sections.metadata);
  for (const kind of ["daily", "trends"]) if (sections[kind] !== undefined) sourceSection(sections[kind], v => {
    const data = object(v), p = decodeInsightPagination(data.pagination);
    if (!productSources.includes(data.source as ProductSource) || data.source !== request.tableScope.source || !Array.isArray(data.items) || data.items.length !== p.returned || data.items.length > 100 || p.page !== request.tableScope.page || p.pageSize !== request.tableScope.pageSize || data.startDate !== context.periods.current.startDate || data.endDate !== context.periods.current.endDate) return fail("单品来源明细范围或分页无效");
    strings(data.definitions); revisionVector(data.sourceRevisions, context);
    const seen = new Set<string>();
    for (const raw of data.items) { const item = object(raw); if (typeof item.date !== "string" || !isNetshopIsoDate(item.date) || item.date < String(data.startDate) || item.date > String(data.endDate) || seen.has(item.date) || item.source !== data.source) return fail("单品日期重复、越界或跨源"); seen.add(item.date); if (data.source === "platform") { metricRecord(item.metrics, productMetricKeys, true); extraMetrics(item.metrics); if (item.visitorValue !== undefined) visitorValue(item.visitorValue); } else if (data.source === "promotion") promotionMetrics(item.metrics); else erpMetrics(item.metrics); }
    return data;
  });
  if (sections.skuContribution !== undefined) {
    const sku = object(sections.skuContribution), p = decodeInsightPagination(sku.pagination);
    if (!["available", "unavailable"].includes(String(sku.status)) || sku.basis !== "historical_relation" || !Array.isArray(sku.items) || sku.items.length !== p.returned || sku.items.length > 100 || sku.status === "unavailable" && (sku.items.length !== 0 || !metricReasons.includes(sku.reasonCode as MetricReason)) || sku.status === "available" && (sku.reasonCode !== null || !text(sku.relationVersion, 1024))) return fail("SKU历史关系贡献没有可靠依据");
    if (sku.status === "available") { if (encodeProductIdentity(identity(sku.parentIdentity, context)) !== encodeProductIdentity(actual)) return fail("SKU历史关系的父身份不一致"); const child = decodeInsightsContext(sku.context); if (actual.dimension !== "spu" || child.effectiveScope.dimension !== "sku" || child.effectiveScope.shopKeys.length !== 1 || child.effectiveScope.shopKeys[0] !== `${actual.platform}\u001f${actual.shopName}` || JSON.stringify(child.periods) !== JSON.stringify(context.periods) || child.sourceRevisions[0].revision !== context.sourceRevisions[0].revision) return fail("SKU历史关系范围或版本不一致"); sku.items.forEach(item => row(item, child)); }
  }
  return input as ProductDetailResponse;
}
