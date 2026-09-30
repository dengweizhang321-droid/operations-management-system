import type { InsightPagination, InsightSections, MetricComparison, MetricValue, ProductIdentity, SourceRevision } from "./insights-contract";

export type Comparisons<K extends string> = Record<K, { previous: MetricComparison; yearAgo: MetricComparison }>;
export type SourceSection<T> = { state: "ready"; data: T } | { state: "error"; data: null; code: "access_denied" | "service_unavailable" | "insights_revision_changed"; message: string };
export type MultiSourceInsightSections<T> = InsightSections<T> & { joinedSourceRevisions: SourceRevision[]; consistency: "revision_vector_checked"; sectionToken: string };
type ProductMetric = "payment" | "quantity" | "visitors" | "customers" | "conversion" | "addCartRate" | "refundPayment";
export type ProductInsightRow = { identity: ProductIdentity; title: string; category: string | null; imageUrl: string | null; metrics: Record<ProductMetric, MetricValue>; comparisons: Comparisons<ProductMetric> };
export type ProductInsightsDTO = InsightSections<{
  summary: Record<ProductMetric, MetricValue>; comparisons: Comparisons<ProductMetric>;
  items: ProductInsightRow[]; pagination: InsightPagination;
  growth: SourceSection<{ collection: "paired_full_set_before_pagination"; items: ProductInsightRow[]; pagination: InsightPagination }>;
}>;
type PromotionMetric = "spend" | "attributedPayment" | "roas" | "impressions" | "clicks" | "ctr" | "cpc" | "orders" | "spendRate";
export type PromotionInsightsDTO = InsightSections<{
  summary: Record<PromotionMetric, MetricValue>; comparisons: Comparisons<PromotionMetric>;
  attribution: { amountDefinition: "jd_total_order_amount" | "tmall_net_amount"; orderDefinition: "jd_order_lines" | "tmall_net_transactions"; window: string | null };
  matchedRange: { scopeLabel: string; metrics: Record<"spend" | "payment" | "spendRate", MetricValue>; coverageRef: string } | null;
  items: Array<{ platform: "京东" | "天猫"; shopKey: string; objectKind: "product" | "plan" | "unit" | "keyword" | "search_term"; id: string; title: string; metrics: Record<PromotionMetric, MetricValue> }>;
  pagination: InsightPagination;
}>;
export type StorePanoramaDTO = MultiSourceInsightSections<{
  performance: SourceSection<{ platformPayment: MetricValue; erpNetSales: MetricValue; erpOrderMargin: MetricValue; erpLargeMarginRate: MetricValue }>;
  traffic: SourceSection<Record<"visitors" | "customers" | "conversion" | "addCartRate", MetricValue>>;
  products: SourceSection<{ items: ProductInsightRow[]; pagination: InsightPagination }>;
  promotion: SourceSection<PromotionInsightsDTO["sections"]>;
  margin: SourceSection<Record<"erpNetSales" | "erpOrderMargin" | "erpLargeMarginRate" | "returnAmount", MetricValue>>;
  customers: SourceSection<Record<"b2bShare" | "repeatCustomers", MetricValue>>;
  targets: SourceSection<{ months: Array<{ month: string; actual: MetricValue; target: MetricValue }> }>;
  dataQuality: SourceSection<{ unmappedProductCount: MetricValue; snapshotDate: string | null }>;
}>;
export type ComparisonInsightsDTO = MultiSourceInsightSections<{
  mode: "shop" | "platform"; includedObjects: string[]; excludedObjects: Array<{ id: string; reasonCode: string }>;
  items: Array<{ id: string; label: string; platform: string | null; metrics: Record<"payment" | "erpNetSales" | "quantity" | "orders" | "erpLargeMarginRate" | "spend" | "roas", MetricValue> }>;
  pagination: InsightPagination;
}>;

/** Reserved wire names and public parameter sets, not callable handlers.
 * I alone registers each route/gateway/module after the owning implementation
 * and all real dependencies pass review. No production code calls these paths.
 */
export const reservedInsightEndpoints = {
  P: { owner: "P", path: "/api/netshop/product-insights", detailPath: "/api/netshop/product-insights/detail", state: "reserved_not_implemented", extraParameters: ["q", "category", "page", "pageSize", "sort", "productIdentity", "sectionToken"] },
  A: { owner: "A", path: "/api/netshop/promotion-insights", detailPath: "/api/netshop/promotion-insights/detail", state: "reserved_not_implemented", extraParameters: ["q", "objectKind", "objectId", "page", "pageSize", "sort", "sectionToken"] },
  S: { owner: "S", path: "/api/netshop/store-panorama", state: "reserved_not_implemented", extraParameters: ["section", "q", "page", "pageSize", "sectionToken"] },
  C: { owner: "C", path: "/api/netshop/comparison-insights", state: "reserved_not_implemented", extraParameters: ["mode", "category", "page", "pageSize", "sort", "sectionToken"] },
} as const;
