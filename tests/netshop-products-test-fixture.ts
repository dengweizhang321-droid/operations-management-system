/** Product-only synthetic additions for the final, complete v1 wire schema.
 * This helper is never imported by a production reader or UI component. */
import { compareDerivedMoneyPerCount, decodeDerivedMoneyPerCount, type MetricValue } from "../lib/netshop/insights-contract";
import { extraMetricKeys, qualityKeys } from "../app/netshop/products/contract";

export function completeProductSectionsFixture(metrics: Record<string, MetricValue>) {
  const count = (value: number | null, basis = "product_day_sum", reasonCode: string | null = null) => ({ ...metrics.quantity, value, unit: "COUNT", status: value === null ? "unavailable" : "available", reasonCode, basis, aggregation: "sum" });
  const money = { ...metrics.payment };
  const numerator = metrics.payment.value, denominator = metrics.visitors.value;
  const reasonCode = numerator === null || denominator === null ? "missing_field" : denominator === 0 ? "zero_denominator" : denominator < 0 ? "negative_denominator" : metrics.payment.status !== "available" || metrics.visitors.status !== "available" ? "incomplete_coverage" : null;
  const visitorValue = decodeDerivedMoneyPerCount({
    metricSchemaVersion: "netshop-money-per-count-v1", unit: "CNY_CENT_PER_COUNT", denominatorKind: "product_day_visitors_sum",
    value: reasonCode === null ? numerator! / denominator! : null, numerator, denominator,
    status: reasonCode === null ? "available" : "unavailable", reasonCode,
    basis: "product_day_sum", aggregation: "ratio_of_sums", sourceIds: metrics.payment.sourceIds, coverageRef: metrics.payment.coverageRef,
  });
  const share = { ...metrics.conversion, value: null, status: "unavailable", reasonCode: "zero_denominator", numerator: 0, denominator: 0 };
  const emptyExtra = (key: string) => ({ ...metrics.quantity, value: null, unit: key === "orderPayment" ? "CNY_CENT" : key === "searchClickRate" ? "RATIO" : "COUNT", status: "unavailable", reasonCode: "missing_field", aggregation: key === "searchClickRate" ? "source_value_only" : "sum" });
  return {
    counts: { dataProducts: count(1), tradedProducts: count(0) },
    structure: {
      collection: "complete_global_filter_set", denominator: money, top5Payment: money, top10Payment: money, top5Share: share, top10Share: share,
      categories: [{ label: "京东 / 未提供类目", payment: money, share, products: count(1) }],
      priceBands: [{ label: "价格未知", payment: money, share, products: count(1) }],
      categoryBasis: "source_label_only", priceBasis: "transaction_mean",
      classification: { continuous: count(0), newlyTraded: count(0), noLongerTraded: count(0), unknownBaseline: count(0) },
      qualification: { current: 1, paired: 1, missingPrevious: 0, missingYearAgo: 0, incomplete: 0 },
      changes: { pairedCurrentPayment: money, pairedPreviousPayment: money, growthPayment: money, declinePayment: money, netChange: money },
    },
    efficiency: {
      metrics: Object.fromEntries(extraMetricKeys.map(key => [key, emptyExtra(key)])), visitorValue,
      visitorValueComparisons: { previous: compareDerivedMoneyPerCount(visitorValue, visitorValue), yearAgo: compareDerivedMoneyPerCount(visitorValue, visitorValue) },
      rules: { id: "conversion-lt-1pct", minimumVisitors: 300, maximumConversion: .01, requireComplete: true },
      watchlist: [], pagination: { page: 1, pageSize: 20, total: 0, returned: 0, hasMore: false, truncated: false }, scanned: 1, qualified: 0,
    },
    dataQuality: { counts: Object.fromEntries(qualityKeys.map(key => [key, count(null, "current_snapshot", "unverified_source")])), staleAfterDays: 30, basis: "current_snapshot" },
    metadata: { summaryScope: "global_category_filtered", tableSearchScope: "identity_title_code_only", categoryBasis: "source_label_only", priceBasis: "transaction_mean", limitations: ["Synthetic test fixture; no source or mapping proof"], categoryEvidence: [] },
  };
}
