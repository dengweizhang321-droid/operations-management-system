import assert from "node:assert/strict";
import test from "node:test";
import { decodeStoreOverview, overviewMetricKeys, type OverviewMetrics, type OverviewComparisons, type StoreOverviewResponse } from "../lib/netshop/store-overview-contract";

const shopKey = "京东\u001f合成店A";
const units = { payment: "CNY_CENT", visitors: "COUNT", customers: "COUNT", spend: "CNY_CENT", promotionPayment: "CNY_CENT", spendRate: "RATIO", conversion: "RATIO", roas: "MULTIPLE", averageOrder: "CNY_CENT", uvValue: "CNY_CENT", paidVisitors: "COUNT", freeVisitors: "COUNT", b2bRate: "RATIO" } as const;
const date = (value: string, offset: number) => new Date(Date.parse(`${value}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
const window = (startDate: string, days: number) => ({ startDate, endDate: date(startDate, days - 1), endExclusive: date(startDate, days), days });

function fixture(days = 1, empty = false, selectedShops = 1): StoreOverviewResponse {
  const names = empty ? [] : Array.from({ length: selectedShops }, (_, i) => i === 0 ? "合成店A" : `合成店${i}`);
  const keys = names.map(name => `京东\u001f${name}`);
  const current = window("2026-09-28", days), previous = window(date(current.startDate, -days), days), yearAgo = window("2025-09-28", days);
  const metrics = (count: number, shops = names.length) => {
    const values = {} as OverviewMetrics;
    for (const key of overviewMetricKeys) values[key] = { value: null, unit: units[key], status: "unavailable", reasonCode: "unverified_source", basis: "unverified", sourceIds: [], aggregation: "source_value_only" };
    if (!empty) values.payment = { value: 100 * count * shops, unit: "CNY_CENT", status: "available", reasonCode: null, basis: "product_day_sum", sourceIds: ["jd_sku_daily"], aggregation: "sum", coverage: { coveredShopDatePairs: count * shops, expectedShopDatePairs: count * shops } };
    return values;
  };
  const comparisons = Object.fromEntries(overviewMetricKeys.map(key => [key, Object.fromEntries(["previous", "yearAgo"].map(kind => [kind, { value: null, method: units[key] === "RATIO" ? "percentage_points" : "relative_change", status: "unavailable", reasonCode: "incomplete_baseline" }]))])) as OverviewComparisons;
  const daily = Array.from({ length: days }, (_, i) => ({ startDate: date(current.startDate, i), endDate: date(current.startDate, i), days: 1, metrics: metrics(1), comparisons: structuredClone(comparisons), comparisonValues: { previous: { payment: null, spend: null }, yearAgo: { payment: null, spend: null } }, comparisonDates: { previous: window(date(previous.startDate, i), 1), yearAgo: window(date(yearAgo.startDate, i), 1) } }));
  const coverage = { expectedShopDatePairs: names.length * days, coveredShopDatePairs: names.length * days, complete: !empty, missingByShop: [], truncated: false };
  const sourceRevisions = Object.fromEntries([["netshop", "1:synthetic"], ["promotionManifest", "1:True"], ...keys.flatMap(key => [[`product:${key}`, "1"], [`promotion:${key}`, "1"]])]);
  return {
    schemaVersion: "netshop-store-overview-v1", requestId: "synthetic-decoder-test", scopeKey: "a".repeat(64), overviewToken: "b".repeat(64), sourceRevisions,
    filters: { platform: "京东", shopKeys: keys, periodKind: "rolling", trendGrain: "day", detailGrain: "day" },
    periods: { timezone: "Asia/Shanghai", rule: "紧邻之前的等长滚动区间", ruleVersion: "sales-period-v1", current, previous, yearAgo },
    freshness: [{ sourceId: "jd_sku_daily", dataThrough: empty ? null : current.endDate }], coverageBySource: { jd_sku_daily: coverage },
    summary: metrics(days), comparisons, daily, trend: structuredClone(daily), details: structuredClone(daily).reverse(),
    detailPagination: { page: 1, pageSize: 5, total: days, hasMore: false },
    shopOptions: names.map((shopName, i) => ({ shopKey: keys[i], shopName })), shops: names.slice(0, 10).map((shopName, i) => ({ shopKey: keys[i], shopName, metrics: metrics(days, 1), comparisons: structuredClone(comparisons) })),
    shopPagination: { page: 1, pageSize: 10, total: names.length, hasMore: names.length > 10 },
    movingAverage: daily.map(row => ({ date: row.startDate, paymentCents: null })), annotations: [],
  };
}

test("decoder accepts valid covered, empty-scope, partial additive and beyond-last-page responses", () => {
  for (const value of [fixture(), fixture(2), fixture(1, true)]) assert.equal(decodeStoreOverview(value), value);
  const partial = fixture(2);
  partial.summary.payment = { ...partial.summary.payment, value: 0, status: "partial", reasonCode: "missing_field", coverage: { coveredShopDatePairs: 1, expectedShopDatePairs: 2 } };
  partial.shops[0].metrics.payment = structuredClone(partial.summary.payment);
  partial.daily[0].metrics.payment.value = 0;
  partial.daily[1].metrics.payment = { ...partial.daily[1].metrics.payment, value: null, status: "unavailable", reasonCode: "missing_field", coverage: null };
  partial.trend = structuredClone(partial.daily); partial.details = structuredClone(partial.daily).reverse();
  assert.equal(decodeStoreOverview(partial).summary.payment.value, 0);
  const last = fixture(); last.shopPagination.page = 2; last.shops = []; last.detailPagination.page = 2; last.details = [];
  assert.equal(decodeStoreOverview(last), last);
});

test("decoder keeps real zero and legal rates above 100 percent", () => {
  const zero = fixture(); zero.summary.payment.value = 0;
  for (const row of [...zero.daily, ...zero.trend, ...zero.details, ...zero.shops]) row.metrics.payment.value = 0;
  assert.equal(decodeStoreOverview(zero).summary.payment.value, 0);
  const rate = fixture(); rate.coverageBySource.jd_promotion = structuredClone(rate.coverageBySource.jd_sku_daily);
  rate.freshness.push({ sourceId: "jd_promotion", dataThrough: rate.periods.current.endDate });
  rate.summary.spend = { ...rate.summary.payment, value: 150, basis: "platform_attributed", sourceIds: ["jd_promotion"] };
  rate.summary.spendRate = { value: 1.5, unit: "RATIO", status: "available", reasonCode: null, basis: "product_day_sum", sourceIds: ["jd_sku_daily", "jd_promotion"], aggregation: "ratio_of_sums" };
  for (const row of [...rate.daily, ...rate.trend, ...rate.details, ...rate.shops]) {
    row.metrics.spend = structuredClone(rate.summary.spend); row.metrics.spendRate = structuredClone(rate.summary.spendRate);
  }
  assert.equal(decodeStoreOverview(rate).summary.spendRate.value, 1.5);
});

const mutations: Array<[string, (value: StoreOverviewResponse) => void]> = [
  ["partial primary rate", p => { p.summary.spendRate = { value: 0.5, unit: "RATIO", status: "partial", reasonCode: "incomplete_coverage", basis: "product_day_sum", sourceIds: ["jd_promotion"], aggregation: "ratio_of_sums" }; }],
  ["foreign selected shop", p => { p.shops[0].shopKey = "京东\u001f合成店B"; p.shops[0].shopName = "合成店B"; }],
  ["cross-platform option", p => { p.shopOptions[0].shopKey = "天猫\u001f合成店A"; }],
  ["duplicate shop", p => { p.shops.push(structuredClone(p.shops[0])); }],
  ["complete without coverage", p => { p.coverageBySource.jd_sku_daily.coveredShopDatePairs = 0; }],
  ["unaccounted missing date", p => { p.coverageBySource.jd_sku_daily.complete = false; p.coverageBySource.jd_sku_daily.coveredShopDatePairs = 0; }],
  ["foreign missing shop", p => { p.coverageBySource.jd_sku_daily.complete = false; p.coverageBySource.jd_sku_daily.coveredShopDatePairs = 0; p.coverageBySource.jd_sku_daily.missingByShop = [{ shopKey: "京东\u001f合成店B", dates: [p.periods.current.startDate] }]; }],
  ["empty revisions", p => { p.sourceRevisions = {}; }],
  ["empty revision token", p => { p.sourceRevisions.netshop = ""; }],
  ["empty daily series", p => { p.daily = []; }],
  ["out-of-range day", p => { p.daily[0].startDate = "2026-10-01"; p.daily[0].endDate = "2026-10-01"; }],
  ["out-of-range detail", p => { p.details[0].startDate = "2026-10-01"; p.details[0].endDate = "2026-10-01"; }],
  ["misreported total", p => { p.shopPagination.total = 0; }],
  ["misreported hasMore", p => { p.detailPagination.hasMore = true; }],
  ["missing request identity", p => { p.requestId = ""; }],
  ["invalid period intent", p => { p.filters.periodKind = "unknown"; }],
  ["relative change on a rate", p => { p.comparisons.conversion.previous.method = "relative_change"; }],
  ["unexplained unavailable comparison", p => { p.comparisons.payment.previous.reasonCode = null; }],
];
for (const [name, mutate] of mutations) test(`decoder rejects ${name} from an otherwise valid response`, () => {
  const value = fixture(); decodeStoreOverview(value); mutate(value); assert.throws(() => decodeStoreOverview(value));
});
for (const pagination of ["shopPagination", "detailPagination"] as const) for (const field of ["page", "pageSize"] as const) test(`decoder rejects zero ${pagination}.${field}`, () => {
  const value = fixture(); decodeStoreOverview(value); value[pagination][field] = 0; assert.throws(() => decodeStoreOverview(value));
});
test("decoder rejects duplicate daily dates within a complete-sized sequence", () => {
  const value = fixture(2); decodeStoreOverview(value); value.daily[1] = structuredClone(value.daily[0]); assert.throws(() => decodeStoreOverview(value));
});
for (const shops of [25, 50]) test(`decoder accepts ${shops}-shop revision vectors and inherited shop-detail vector`, () => {
  const overview = fixture(1, false, shops);
  assert.equal(Object.keys(overview.sourceRevisions).length, 2 + 2 * shops);
  assert.equal(decodeStoreOverview(overview), overview);
  const detail = fixture(); detail.sourceRevisions = overview.sourceRevisions;
  assert.equal(decodeStoreOverview(detail), detail);
});
test("decoder accepts long exact shop identity keys within the reader vector budget", () => {
  const value = fixture(); value.sourceRevisions[`product:京东\u001f${"长".repeat(200)}`] = "1";
  assert.equal(decodeStoreOverview(value), value);
});
test("decoder refuses vectors beyond two global and fifty pairs of source revisions", () => {
  const value = fixture(1, false, 50); decodeStoreOverview(value); value.sourceRevisions.unexpectedExtra = "1";
  assert.throws(() => decodeStoreOverview(value));
});
