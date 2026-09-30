import type { InsightsContext, InsightPagination, MetricComparison, MetricReason, MetricValue, ProductIdentity, SourceCoverage } from "./insights-contract";

export const PROMOTION_COLUMN_VERSION = "netshop-promotion-v1" as const;
export const PROMOTION_METRIC_KEYS = ["spend", "attributedPayment", "roas", "impressions", "clicks", "ctr", "cpc", "orders", "spendRate"] as const;
export const PROMOTION_OBJECT_KINDS = ["product", "plan", "unit", "keyword", "search_term"] as const;
export const PROMOTION_SORTS = ["spend_desc", "attributedPayment_desc", "roas_desc", "spend_change_desc", "spend_change_asc"] as const;
export type PromotionMetricKey = typeof PROMOTION_METRIC_KEYS[number];
export type PromotionObjectKind = typeof PROMOTION_OBJECT_KINDS[number];
export type PromotionSort = typeof PROMOTION_SORTS[number];

/** Structural wire type of I's explicitly approved monetary mean protocol.
 * Replace this alias with I's shared exported type when its implementation
 * reaches main. This module defines no competing formula or shared validator.
 */
export type PromotionCpc = {
  metricSchemaVersion: "netshop-money-per-count-v1";
  unit: "CNY_CENT_PER_COUNT"; aggregation: "ratio_of_sums";
  denominatorKind: "clicks"; numerator: number | null; denominator: number | null;
  value: number | null; status: "available" | "partial" | "unavailable" | "invalid";
  reasonCode: MetricReason | null; basis: MetricValue["basis"];
  sourceIds: string[]; coverageRef: string;
};
export type PromotionMetrics = Record<Exclude<PromotionMetricKey, "cpc">, MetricValue> & { cpc: PromotionCpc };
export type PromotionComparisons = Record<PromotionMetricKey, { previous: MetricComparison; yearAgo: MetricComparison }>;

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
  metrics: PromotionMetrics; comparisons: PromotionComparisons;
  spendShare: MetricValue; coverageRef: string;
};
export type PromotionObjectCapability = {
  status: "available" | "unavailable"; reasonCode: MetricReason | null;
  message: string; sourceIds: string[]; unidentifiedCount: number;
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
    summary: PromotionMetrics; comparisons: PromotionComparisons;
    attribution: {
      amountDefinition: "jd_total_order_amount" | "tmall_net_amount";
      orderDefinition: "jd_order_lines" | "tmall_net_transactions";
      window: string | null; roiDisplayLabel: "ROI";
    };
    matchedRange: PromotionMatchedRange | null;
    trend: { grain: "day" | "week" | "month"; items: PromotionTrendPoint[] };
    shops: { visible: boolean; items: PromotionShopRow[] };
    items: PromotionObjectRow[]; pagination: InsightPagination;
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
