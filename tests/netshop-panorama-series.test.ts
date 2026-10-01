import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeStorePanorama, panoramaCapabilityIds, panoramaSectionSources, panoramaSections, panoramaSeriesQuery } from "../app/netshop/panorama/contract";
import { restoreProductScopeSeriesMetric } from "../lib/netshop/product-scope-series-contract";

/** Wrap an unchanged actual owning PG fixture, without manufacturing its cells. */
function fixture() {
  const series = JSON.parse(readFileSync(new URL("./fixtures/netshop-product-scope-series/series-day-response.json", import.meta.url), "utf8")).body;
  const c = series.context, query = new URLSearchParams({ platform: c.requestedScope.platforms[0], outlet: c.requestedScope.shopKeys[0], dimension: c.requestedScope.dimension, startDate: c.periods.current.startDate, endDate: c.periods.current.endDate, periodKind: c.requestedScope.periodKind, grain: series.grain });
  const pending = { state: "unavailable", data: null, reasonCode: "dependency_pending", message: "独立协议夹具：其他来源未接线" };
  const sources = { products: { ...pending }, productSeries: { state: "ready", data: series }, promotion: { ...pending }, sales: { ...pending }, finance: { ...pending }, workflow: { ...pending } };
  const sections = Object.fromEntries(panoramaSections.map(key => {
    const states = panoramaSectionSources[key].map(source => sources[source].state);
    return [key, { state: states.every(s => s === "ready") ? "ready" : states.includes("ready") ? "partial" : "unavailable", sources: [...panoramaSectionSources[key]], capabilities: panoramaCapabilityIds[key].map(id => ({ id, status: ["platform_trend", "platform_day_detail", "traffic_trend"].includes(id) ? "available" : "unavailable", reasonCode: ["platform_trend", "platform_day_detail", "traffic_trend"].includes(id) ? null : "dependency_pending", message: "使用完整拥有方字段投影，非商品页相加" })) }];
  }));
  const value = { schemaVersion: "netshop-store-panorama-v1", context: c, sectionToken: "d".repeat(64), consistency: "revision_vector_checked", tableScope: { q: "", page: 1, pageSize: 5, section: "performance", grain: series.grain }, sources, sections, joinedSourceRevisions: series.joinedSourceRevisions, limitations: ["独立协议组合，公共API与生产另验"] };
  return { value, query, revision: c.sourceRevisions.find((r: { kind: string }) => r.kind === "owning_revision").revision };
}
test("complete owning series keeps its actual windows, scalar cells and field coverage inside S", () => {
  const { value, query, revision } = fixture(), data = decodeStorePanorama(value, query, revision);
  assert.equal(data.sources.productSeries.state, "ready");
  if (data.sources.productSeries.state === "ready") {
    assert.equal(data.sources.productSeries.data.series.current.length, value.sources.productSeries.data.series.current.length);
    assert.deepEqual(data.sources.productSeries.data.context.periods, value.context.periods);
    const point = data.sources.productSeries.data.series.current[0]; assert.ok(restoreProductScopeSeriesMetric(data.sources.productSeries.data, point, "payment").coverageRef.endsWith("#0"));
  }
});
test("table ID/title search and pagination never enter the whole-shop series request", () => {
  const { query } = fixture(); query.set("q", "商品"); query.set("page", "4"); query.set("pageSize", "10");
  const series = panoramaSeriesQuery(query); assert.equal(series.has("q"), false); assert.equal(series.has("page"), false); assert.equal(series.has("pageSize"), false); assert.equal(series.get("grain"), "day");
});
test("series from another scope, stale token, wrong grain or fabricated point fields cannot be combined", () => {
  for (const kind of ["scope", "grain", "cell"] as const) {
    const { value, query, revision } = fixture();
    if (kind === "scope") value.sources.productSeries.data.context.effectiveScope.shopKeys = ["京东\u001f另一店"];
    if (kind === "grain") value.tableScope.grain = "week";
    if (kind === "cell") value.sources.productSeries.data.series.current[0].cells[0][3] = 1;
    assert.throws(() => decodeStorePanorama(value, query, revision));
  }
});
