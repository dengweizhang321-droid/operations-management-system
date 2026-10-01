import type { DerivedMoneyPerCountV1, InsightsContext, InsightPagination, MetricComparison, MetricReason, MetricValue, ProductIdentity, SourceCoverage } from "./insights-contract";
import { promotionPresentationSorts } from "../../app/shell/shop-promotion-prefs";

export const PROMOTION_COLUMN_VERSION = "netshop-promotion-v1" as const;
export const PROMOTION_METRIC_KEYS = ["spend", "attributedPayment", "roas", "impressions", "clicks", "ctr", "cpc", "orders", "spendRate"] as const;
export const PROMOTION_OBJECT_KINDS = ["product", "plan", "unit", "keyword", "search_term"] as const;
export const PROMOTION_SORTS = promotionPresentationSorts;
export type PromotionMetricKey = typeof PROMOTION_METRIC_KEYS[number];
export type PromotionObjectKind = typeof PROMOTION_OBJECT_KINDS[number];
export type PromotionSort = typeof PROMOTION_SORTS[number];

/** I's versioned monetary mean; CPC specifically counts real clicks. */
export type PromotionCpc = DerivedMoneyPerCountV1 & { denominatorKind: "clicks" };
export type PromotionMetrics = Record<Exclude<PromotionMetricKey, "cpc">, MetricValue> & { cpc: PromotionCpc };
export type PromotionComparisons = Record<PromotionMetricKey, { previous: MetricComparison; yearAgo: MetricComparison }>;
export type PromotionChanges = Record<"spend" | "attributedPayment", { previous: MetricValue; yearAgo: MetricValue }>;

export type PromotionObjectMapping = {
  status: "matched" | "unmapped" | "ambiguous" | "not_applicable";
  linkIdentity: ProductIdentity | null;
  evidence: "exact_source_identity" | "unverified";
  advertisedSkuId: string | null; triggerSkuId: string | null; followSkuId: string | null;
};
export type PromotionObjectRow = {
  /** Internal response row key; never presented as a missing business ID. */
  rowKey: string; id: string | null;
  platform: "京东" | "天猫"; shopKey: string; shopName: string;
  objectKind: PromotionObjectKind;
  identityKind: "follow_order_sku" | "promotion_product" | "plan" | "unit" | "keyword" | "search_term";
  title: string; planId: string | null; unitId: string | null; matchType: string | null;
  metrics: PromotionMetrics; comparisons: PromotionComparisons;
  spendShare: MetricValue; changes: PromotionChanges;
  observation?: Record<"current" | "previous" | "yearAgo", { observedDates: string[]; verifiedAbsentDates: string[] }>;
  coverageRef: string; mapping: PromotionObjectMapping;
  /** Reliable identity for this promotion domain's own detail only.
   * Product navigation separately requires matched mapping/linkIdentity. */
  drillable: boolean;
};
export type PromotionTrendPoint = {
  startDate: string; endDate: string; days: number;
  metrics: PromotionMetrics; coverageRef: string;
};
export type PromotionShopRow = {
  platform: "京东" | "天猫"; shopKey: string; shopName: string;
  metrics: PromotionMetrics; comparisons: PromotionComparisons; changes: PromotionChanges;
  spendShare: MetricValue; coverageRef: string;
};
export type PromotionObjectCapability = {
  /** Query eligibility does not prove the source fields have been read. */
  canQuery: boolean;
  status: "available" | "unavailable"; reasonCode: MetricReason | null;
  message: string; sourceIds: string[]; unidentifiedCount: number | null;
};
export type PromotionSourceMatrixEntry = {
  sourceId: string; label: string; coverageRef: string;
  fields: Array<{ field: string; status: "available" | "unavailable"; reasonCode: MetricReason | null }>;
  notes: string[];
};
export type PromotionMatchedRange = {
  scopeLabel: string; coverageRef: string;
  shopDates: Array<{ shopKey: string; dates: string[] }>;
  metrics: Record<"spend" | "payment" | "spendRate", MetricValue>;
};
export type PromotionListScope = {
  objectKind: PromotionObjectKind; q: string;
  objectStartDate: string; objectEndDate: string;
  comparisonDates: { previous: string[]; yearAgo: string[] };
  summaryUnaffectedBySearch: true;
  productFocus?: { identity: ProductIdentity; status: "available" | "unavailable"; reasonCode: "unmapped" | "ambiguous_mapping" | null; message: string } | null;
};
export type PromotionDiagnosticCapability = {
  status: "available" | "unavailable"; reasonCode: MetricReason | null;
  message: string; shopName: string | null; maximumDays: 7;
  paidModelAllowed: false; reportFormats: Array<"html" | "xlsx">;
};
export type PromotionInsightsResponse = {
  columnVersion: typeof PROMOTION_COLUMN_VERSION;
  context: InsightsContext; sectionToken: string;
  sections: {
    summary: PromotionMetrics; comparisons: PromotionComparisons; changes: PromotionChanges;
    attribution: {
      amountDefinition: "jd_total_order_amount" | "tmall_net_amount";
      orderDefinition: "jd_order_lines" | "tmall_net_transactions";
      window: string | null; roiDisplayLabel: "ROI";
    };
    matchedRange: PromotionMatchedRange | null;
    trend: { grain: "day" | "week" | "month"; items: PromotionTrendPoint[] };
    shops: { visible: boolean; items: PromotionShopRow[] };
    items: PromotionObjectRow[]; pagination: InsightPagination;
    contributions: {
      collection: "comparable_full_set_before_search_pagination";
      comparedObjectCount: number; excludedObjectCount: number;
      previous: Record<"spendIncrease" | "spendDecrease" | "attributedPaymentIncrease" | "attributedPaymentDecrease", PromotionObjectRow[]>;
    };
    listScope: PromotionListScope;
    objectCapabilities: Record<PromotionObjectKind, PromotionObjectCapability>;
    diagnostic: PromotionDiagnosticCapability;
    coverage: Record<string, SourceCoverage>;
    sourceMatrix: PromotionSourceMatrixEntry[]; limitations: string[];
  };
};
export type PromotionObjectRelation = {
  kind: "explicit_source_fields"; description: string; sourceFields: string[];
  targets: Array<{ objectKind: PromotionObjectKind; id: string | null; rowKey: string | null }>;
};
export type PromotionDetailResponse = {
  columnVersion: typeof PROMOTION_COLUMN_VERSION; context: InsightsContext; sectionToken: string;
  sections: {
    item: PromotionObjectRow;
    trend: { grain: "day" | "week" | "month"; items: PromotionTrendPoint[] };
    relations: PromotionObjectRelation[]; coverage: Record<string, SourceCoverage>;
    limitations: string[];
  };
};

export { decodePromotionInsightsForQuery, decodePromotionDetailForQuery } from "./promotion-insights-decode";
export { validatePromotionQuery } from "./promotion-insights-query";
