/** Isolated protocol/UI fixture. Production modules never import this file. */
import { compareMetrics, type MetricValue } from "../lib/netshop/insights-contract";
import { syntheticInsightsContext } from "../lib/netshop/insights-fixtures";
import { productMetricKeys, type ProductInsightsResponse } from "../app/netshop/products/contract";
import { panoramaCapabilityIds, panoramaSectionSources, panoramaSections, panoramaSourceKeys, type StorePanoramaResponse } from "../app/netshop/panorama/contract";
import { completeProductSectionsFixture } from "./netshop-products-test-fixture";

export const panoramaFixtureQuery = () => new URLSearchParams({ platform: "京东", outlet: "京东\u001f合成店A", startDate: "2026-09-01", endDate: "2026-09-01" });
export function panoramaFixture(withProducts = false): StorePanoramaResponse {
  const context = syntheticInsightsContext(), pending = { state: "unavailable", data: null, reasonCode: "dependency_pending", message: "隔离夹具：依赖待接线" } as const;
  const sources = Object.fromEntries(panoramaSourceKeys.map(key => [key, { ...pending }])) as StorePanoramaResponse["sources"];
  if (withProducts) {
    const metrics = Object.fromEntries(productMetricKeys.map(key => {
      const ratio = key === "conversion" || key === "addCartRate", value = key === "visitors" ? 10 : 0;
      return [key, { value, unit: key === "payment" || key === "refundPayment" ? "CNY_CENT" : ratio ? "RATIO" : "COUNT", status: "available", reasonCode: null, basis: "product_day_sum", sourceIds: ["jd_sku_daily:spu_daily:京东"], aggregation: ratio ? "ratio_of_sums" : "sum", coverageRef: "jd_sku_daily:spu_daily:京东:current", ...(ratio ? { numerator: 0, denominator: 10 } : {}) }];
    })) as Record<typeof productMetricKeys[number], MetricValue>;
    const comparisons = Object.fromEntries(productMetricKeys.map(key => [key, { previous: compareMetrics(metrics[key], metrics[key]), yearAgo: compareMetrics(metrics[key], metrics[key]) }]));
    const item = { identity: { platform: "京东", shopName: "合成店A", dimension: "spu", id: "P01" }, title: "合成商品", category: null, imageUrl: null, imageStatus: "unverified", metrics, comparisons, baselineMetrics: { previous: metrics, yearAgo: metrics } };
    const pagination = { page: 1, pageSize: 5, total: 1, returned: 1, hasMore: false, truncated: false };
    // Legacy fixture helpers intentionally use mutable scalar fields for negative
    // tests. Every consumer must run the production decoder before using them.
    const data = { schemaVersion: "netshop-product-insights-v1", context, sectionToken: "a".repeat(64), tableScope: { q: "", category: "", sort: "payment_desc", page: 1, pageSize: 5 }, joinedSourceRevisions: context.sourceRevisions, consistency: "revision_vector_checked", sections: { ...completeProductSectionsFixture(metrics), summary: metrics, comparisons, items: [item], pagination, baselineReads: { previous: { state: "ready", data: metrics }, yearAgo: { state: "ready", data: metrics } }, growth: { state: "ready", data: { collection: "paired_full_set_before_pagination", items: [item], pagination } } } } as unknown as ProductInsightsResponse;
    sources.products = { state: "ready", data };
  }
  const sections = Object.fromEntries(panoramaSections.map(key => {
    const states = panoramaSectionSources[key].map(source => sources[source].state);
    const state = states.every(s => s === "ready") ? "ready" : states.some(s => s === "ready") ? "partial" : "unavailable";
    return [key, { state, sources: [...panoramaSectionSources[key]], capabilities: panoramaCapabilityIds[key].map(id => ({ id, status: "unavailable", reasonCode: "unverified_source", message: "隔离夹具未核验能力" })) }];
  })) as StorePanoramaResponse["sections"];
  return { schemaVersion: "netshop-store-panorama-v1", context, sectionToken: "c".repeat(64), tableScope: { q: "", page: 1, pageSize: 5, section: "performance" }, joinedSourceRevisions: context.sourceRevisions, consistency: "revision_vector_checked", sources, sections, limitations: ["仅协议隔离夹具，不是业务或生产验收"] };
}
