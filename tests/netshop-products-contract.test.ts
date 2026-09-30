import assert from "node:assert/strict";
import test from "node:test";
import { syntheticInsightsContext } from "../lib/netshop/insights-fixtures";
import { compareMetrics, type MetricValue } from "../lib/netshop/insights-contract";
import { decodeProductInsights, productMetricKeys, validateProductQuery } from "../app/netshop/products/contract";

const query = new URLSearchParams({ platform: "京东", outlet: "京东\u001f合成店A", startDate: "2026-09-01", endDate: "2026-09-01" });
function fixture() {
  const context = syntheticInsightsContext();
  const metrics = Object.fromEntries(productMetricKeys.map(key => [key, { value: key === "conversion" || key === "addCartRate" ? 0 : 0, unit: key === "payment" || key === "refundPayment" ? "CNY_CENT" : key === "conversion" || key === "addCartRate" ? "RATIO" : "COUNT", status: "available", reasonCode: null, basis: "product_day_sum", sourceIds: ["jd_sku_daily:spu_daily:京东"], aggregation: key === "conversion" || key === "addCartRate" ? "ratio_of_sums" : "sum", coverageRef: "jd_sku_daily:spu_daily:京东:current", ...(key === "conversion" || key === "addCartRate" ? { numerator: 0, denominator: 10 } : {}) }])) as Record<typeof productMetricKeys[number], MetricValue>;
  const comparisons = Object.fromEntries(productMetricKeys.map(key => [key, { previous: compareMetrics(metrics[key], metrics[key]), yearAgo: compareMetrics(metrics[key], metrics[key]) }]));
  const item = { identity: { platform: "京东", shopName: "合成店A", dimension: "spu", id: "P01" }, title: "合成商品", category: null, imageUrl: null, metrics, comparisons };
  const pagination = { page: 1, pageSize: 20, total: 1, returned: 1, hasMore: false, truncated: false };
  return { schemaVersion: "netshop-product-insights-v1", context, sectionToken: "a".repeat(64), tableScope: { q: "", category: "", sort: "payment_desc", page: 1, pageSize: 20 }, joinedSourceRevisions: context.sourceRevisions, consistency: "revision_vector_checked", sections: { summary: metrics, comparisons, items: [item], pagination, baselineReads: { previous: { state: "ready", data: metrics }, yearAgo: { state: "ready", data: metrics } }, growth: { state: "ready", data: { collection: "paired_full_set_before_pagination", items: [item], pagination } } } };
}
test("product decoder retains true zero and owning vectors containing the official shop separator", () => {
  const data = fixture(); assert.equal(decodeProductInsights(data, query, "1:aaaaaaaaaaaa").sections.summary.payment.value, 0);
});
test("request refuses unknown, duplicated, unsafe pagination and undocumented sorts", () => {
  for (const extra of ["page=0", "pageSize=101", "sort=growth", "q=a&q=b", "principal=admin", "section=daily"]) assert.throws(() => validateProductQuery(new URLSearchParams(query+"&"+extra)));
});
test("response cannot cross store, units, pagination, current scope or owning revisions", () => {
  const mutations = [
    (data: ReturnType<typeof fixture>) => { data.sections.items[0].identity.shopName = "其他店"; },
    (data: ReturnType<typeof fixture>) => { data.sections.summary.payment.unit = "COUNT"; },
    (data: ReturnType<typeof fixture>) => { data.sections.pagination.returned = 0; },
    (data: ReturnType<typeof fixture>) => { data.tableScope.q = "other"; },
    (data: ReturnType<typeof fixture>) => { data.joinedSourceRevisions = []; },
  ];
  for (const mutate of mutations) { const data = fixture(); mutate(data); assert.throws(() => decodeProductInsights(data, query, "1:aaaaaaaaaaaa")); }
  assert.throws(() => decodeProductInsights(fixture(), query, "2:bbbbbbbbbbbb"));
});
test("ordinary baseline service failure is separate from reliable current and cannot invent zero", () => {
  const data = fixture(); const failed = { state: "error", data: null, code: "service_unavailable", message: "基期读取失败" };
  const response = { ...data, sections: { ...data.sections, baselineReads: { previous: failed, yearAgo: data.sections.baselineReads.yearAgo } } };
  assert.equal(decodeProductInsights(response, query, "1:aaaaaaaaaaaa").sections.summary.payment.value, 0);
});
test("section token is bound to the exact requested token kind", () => {
  const request = new URLSearchParams(query); request.set("sectionToken", "b".repeat(64));
  assert.throws(() => decodeProductInsights(fixture(), request, "1:aaaaaaaaaaaa"));
});
