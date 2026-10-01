import assert from "node:assert/strict";
import test from "node:test";
import { decodeInsightsContext, adaptOverview, type InsightsContext } from "../lib/netshop/insights-contract";
import { syntheticInsightsContext } from "../lib/netshop/insights-fixtures";
import { decodeStoreOverview, overviewMetricKeys, type StoreOverviewResponse, type OverviewMetrics, type OverviewMetric } from "../lib/netshop/store-overview-contract";

const window = (startDate: string, endDate: string) => ({ startDate, endDate, endExclusive: new Date(Date.parse(endDate+"T00:00:00Z")+86400000).toISOString().slice(0, 10), days: (Date.parse(endDate+"T00:00:00Z")-Date.parse(startDate+"T00:00:00Z"))/86400000+1 });
const days = (start: string, count: number) => Array.from({ length: count }, (_, i) => new Date(Date.parse(start+"T00:00:00Z")+i*86400000).toISOString().slice(0, 10));
function longContext(): InsightsContext {
  const p = syntheticInsightsContext();
  p.periods.current = window("2025-02-28", "2026-02-28"); p.periods.previous = window("2024-02-28", "2025-02-27"); p.periods.yearAgo = window("2024-02-28", "2025-02-28"); p.periods.rule = "紧邻之前的等长区间";
  p.calendar = days(p.periods.current.startDate, 366).map(date => ({ date, previous: null, yearAgo: null }));
  for (const [ref, c] of Object.entries(p.coverageBySource)) {
    const kind = ref.split(":").at(-1) as "current" | "previous" | "yearAgo", w = p.periods[kind];
    c.expectedShopDatePairs = w.days; c.coveredShopDatePairs = 0; c.complete = false; c.missingByShop = [{ shopKey: p.effectiveScope.shopKeys[0], dates: days(w.startDate, w.days) }];
  }
  p.capabilities.forEach(c => { c.status = "unavailable"; c.reasonCode = "no_records"; c.presentShopDatePairs = 0; });
  return p;
}
function longOverview(): StoreOverviewResponse {
  const context = longContext();
  const units = { payment: "CNY_CENT", visitors: "COUNT", customers: "COUNT", spend: "CNY_CENT", promotionPayment: "CNY_CENT", spendRate: "RATIO", conversion: "RATIO", roas: "MULTIPLE", averageOrder: "CNY_CENT", uvValue: "CNY_CENT", paidVisitors: "COUNT", freeVisitors: "COUNT", b2bRate: "RATIO" } as const;
  const metric = (unit: OverviewMetric["unit"]): OverviewMetric => ({ value: null, unit, status: "unavailable", reasonCode: "no_records", basis: "unverified", sourceIds: [], aggregation: "source_value_only" });
  const metrics: OverviewMetrics = { payment: metric("CNY_CENT"), visitors: metric("COUNT"), customers: metric("COUNT"), spend: metric("CNY_CENT"), promotionPayment: metric("CNY_CENT"), spendRate: metric("RATIO"), conversion: metric("RATIO"), roas: metric("MULTIPLE"), averageOrder: metric("CNY_CENT"), uvValue: metric("CNY_CENT"), paidVisitors: metric("COUNT"), freeVisitors: metric("COUNT"), b2bRate: metric("RATIO") };
  const comparisons = Object.fromEntries(overviewMetricKeys.map(k => [k, Object.fromEntries(["previous", "yearAgo"].map(kind => [kind, { value: null, method: units[k] === "RATIO" ? "percentage_points" : "relative_change", status: "unavailable", reasonCode: "incomplete_baseline" }]))])) as StoreOverviewResponse["comparisons"];
  const daily = context.calendar.map(c => ({ startDate: c.date, endDate: c.date, days: 1, metrics, comparisons, comparisonDates: { previous: null, yearAgo: null }, comparisonValues: { previous: { payment: null, spend: null }, yearAgo: { payment: null, spend: null } } }));
  return { schemaVersion: "netshop-store-overview-v1", requestId: "synthetic-derived-367", scopeKey: "a".repeat(64), overviewToken: "b".repeat(64), sourceRevisions: { netshop: "1:aaaaaaaaaaaa", promotionManifest: "absent" }, filters: { platform: "京东", shopKeys: context.effectiveScope.shopKeys, periodKind: "custom", trendGrain: "day", detailGrain: "day" }, periods: context.periods, freshness: [], coverageBySource: { jd_sku_daily: context.coverageBySource["jd_sku_daily:spu_daily:京东:current"] }, summary: metrics, comparisons, daily, trend: daily, details: [...daily].reverse().slice(0, 5), detailPagination: { page: 1, pageSize: 5, total: 366, hasMore: true }, shopOptions: [{ shopKey: context.effectiveScope.shopKeys[0], shopName: "合成店A" }], shops: [{ shopKey: context.effectiveScope.shopKeys[0], shopName: "合成店A", metrics, comparisons }], shopPagination: { page: 1, pageSize: 10, total: 1, hasMore: false }, movingAverage: daily.map(r => ({ date: r.startDate, paymentCents: null })), annotations: [] };
}
test("366-day requested scope permits its real 367-day previous-year window without changing date rules", () => {
  const context = longContext(); assert.equal(context.periods.yearAgo.days, 367); decodeInsightsContext(context);
  const overview = longOverview(); decodeStoreOverview(overview); assert.equal(adaptOverview(overview).overview.periods.yearAgo.days, 367);
});
test("current 367 and derived 368 remain rejected by both decoders", () => {
  for (const [kind, end] of [["current", "2026-03-01"], ["yearAgo", "2025-03-01"]] as const) {
    const context = longContext(); context.periods[kind] = window(context.periods[kind].startDate, end); assert.throws(() => decodeInsightsContext(context));
    const overview = longOverview(); overview.periods[kind] = window(overview.periods[kind].startDate, end); assert.throws(() => decodeStoreOverview(overview));
  }
});
