import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { decodePromotionDetailForQuery, decodePromotionInsightsForQuery } from "../lib/netshop/promotion-insights-contract";

function fixture(name: string) {
  return JSON.parse(fs.readFileSync(new URL(`./fixtures/netshop-promotion/response-${name}.json`, import.meta.url), "utf8"));
}
function request(value: ReturnType<typeof fixture>, detail = false) {
  const c = value.context, s = value.sections;
  const query = new URLSearchParams({ platform: c.requestedScope.platforms[0], dimension: c.requestedScope.dimension,
    startDate: c.periods.current.startDate, endDate: c.periods.current.endDate, periodKind: c.requestedScope.periodKind,
    trendGrain: s.trend.grain, objectKind: detail ? s.item.objectKind : s.listScope.objectKind });
  c.requestedScope.shopKeys.forEach((key: string) => query.append("outlet", key));
  if (detail) { query.set("shopKey", s.item.shopKey); query.set("objectId", s.item.rowKey); query.set("sectionToken", value.sectionToken); }
  else { query.set("page", String(s.pagination.page)); query.set("pageSize", String(s.pagination.pageSize)); query.set("q", s.listScope.q); }
  return { query, revision: c.sourceRevisions.find((r: { kind: string }) => r.kind === "owning_revision").revision as string };
}
function positive(name: string, detail = false) {
  const value = fixture(name), input = request(value, detail);
  const decode = detail ? decodePromotionDetailForQuery : decodePromotionInsightsForQuery;
  assert.equal(decode(value, input.query, input.revision).columnVersion, "netshop-promotion-v1", "The unchanged actual DTO must first pass");
  return { value, input };
}
for (const name of ["product", "plan", "partial-19-of-21", "misaligned", "missing-id", "detail"]) {
  test(`Q independent actual-reader positive control: ${name}`, () => { positive(name, name === "detail"); });
}
test("Q replay: partial auxiliary fee cannot become the requested whole fee", () => {
  const { value, input } = positive("partial-19-of-21");
  value.sections.summary.spendRate = structuredClone(value.sections.matchedRange.metrics.spendRate);
  assert.throws(() => decodePromotionInsightsForQuery(value, input.query, input.revision));
});
test("Q replay: coherent ROI and CPC operands cannot replace their sibling facts", () => {
  for (const key of ["roas", "cpc"]) {
    const { value, input } = positive("product"), metric = value.sections.summary[key];
    if (key === "roas") { metric.numerator = 900; metric.value = metric.numerator / metric.denominator; }
    else { metric.denominator = 50; metric.value = metric.numerator / metric.denominator; }
    assert.throws(() => decodePromotionInsightsForQuery(value, input.query, input.revision));
  }
});
test("Q replay: denominator product source and ERP basis cannot become promotion facts", () => {
  const { value, input } = positive("product");
  value.sections.summary.spend.sourceIds = ["jd_sku_daily"];
  value.sections.summary.spend.basis = "erp_net_sales";
  assert.throws(() => decodePromotionInsightsForQuery(value, input.query, input.revision));
  const aux = positive("partial-19-of-21");
  aux.value.sections.matchedRange.metrics.payment.sourceIds = ["jd_promotion"];
  assert.throws(() => decodePromotionInsightsForQuery(aux.value, aux.input.query, aux.input.revision));
});
test("Q replay: exact same-text SKU must not navigate to the SPU dimension", () => {
  const { value, input } = positive("product"), item = value.sections.items[0];
  item.mapping.status = "matched"; item.mapping.evidence = "exact_source_identity";
  item.mapping.linkIdentity = { platform: "京东", shopName: item.shopName, dimension: "spu", id: item.id };
  assert.throws(() => decodePromotionInsightsForQuery(value, input.query, input.revision));
});
test("Q replay: store shares cannot replace the complete denominator", () => {
  const { value, input } = positive("product"), share = value.sections.shops.items[0].spendShare;
  share.denominator = 10000; share.value = share.numerator / share.denominator;
  assert.throws(() => decodePromotionInsightsForQuery(value, input.query, input.revision));
});
test("Q replay: a real missing-ID bucket cannot acquire an entity comparison", () => {
  const { value, input } = positive("missing-id"), item = value.sections.items[0];
  assert.equal(item.id, null);
  item.comparisons.spend.previous = { value: 1, method: "relative_change", status: "available", reasonCode: null };
  assert.throws(() => decodePromotionInsightsForQuery(value, input.query, input.revision));
});
test("Q blocker: full-scope primary fee must agree with the same full matched amounts", () => {
  const { value, input } = positive("product"), primary = value.sections.summary.spendRate;
  const auxiliary = value.sections.matchedRange;
  const total = value.context.effectiveScope.shopKeys.length * value.context.periods.current.days;
  const own = value.sections.coverage[auxiliary.coverageRef];
  assert.equal(own.expectedShopDatePairs, total); assert.equal(own.coveredShopDatePairs, total);
  primary.denominator = auxiliary.metrics.payment.value / 2;
  primary.value = primary.numerator / primary.denominator;
  assert.notEqual(primary.value, auxiliary.metrics.spendRate.value);
  assert.throws(() => decodePromotionInsightsForQuery(value, input.query, input.revision), "Contradictory rates for the exact same complete scope must fail");
});
test("Q blocker: auxiliary dates cannot include a whole-pair gap merely by keeping their count", () => {
  const { value, input } = positive("partial-19-of-21"), auxiliary = value.sections.matchedRange;
  const whole = value.sections.coverage[value.sections.summary.spendRate.coverageRef];
  const gap = whole.missingByShop.find((row: { dates: string[] }) => row.dates.length > 0);
  const subset = auxiliary.shopDates.find((row: { shopKey: string }) => row.shopKey === gap.shopKey);
  assert.ok(gap); assert.ok(subset); assert.ok(!subset.dates.includes(gap.dates[0]));
  const originalCount = auxiliary.shopDates.reduce((n: number, row: { dates: string[] }) => n + row.dates.length, 0);
  subset.dates[0] = gap.dates[0]; subset.dates.sort();
  assert.equal(auxiliary.shopDates.reduce((n: number, row: { dates: string[] }) => n + row.dates.length, 0), originalCount);
  assert.throws(() => decodePromotionInsightsForQuery(value, input.query, input.revision), "A declared missing pair cannot simultaneously belong to the matched subset");
});
test("Q blocker: an actual-reader populated trend cannot silently lose all requested periods", () => {
  const { value, input } = positive("product");
  assert.ok(value.sections.trend.items.length > 0);
  value.sections.trend.items = [];
  assert.throws(() => decodePromotionInsightsForQuery(value, input.query, input.revision), "Missing trend periods must be an invalid DTO, not a successful empty chart");
});
