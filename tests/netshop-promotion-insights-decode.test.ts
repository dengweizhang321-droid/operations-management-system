import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { decodePromotionDetailForQuery, decodePromotionInsightsForQuery } from "../lib/netshop/promotion-insights-contract";

function fixture(name: string) { return JSON.parse(fs.readFileSync(new URL(`./fixtures/netshop-promotion/response-${name}.json`, import.meta.url), "utf8")); }
function args(value: ReturnType<typeof fixture>, detail = false) {
  const c = value.context, s = value.sections;
  const query = new URLSearchParams({ platform: c.requestedScope.platforms[0], dimension: c.requestedScope.dimension,
    startDate: c.periods.current.startDate, endDate: c.periods.current.endDate, periodKind: c.requestedScope.periodKind,
    trendGrain: s.trend.grain, objectKind: detail ? s.item.objectKind : s.listScope.objectKind });
  c.requestedScope.shopKeys.forEach((key: string) => query.append("outlet", key));
  if (detail) { query.set("shopKey", s.item.shopKey); query.set("objectId", s.item.rowKey); query.set("sectionToken", value.sectionToken); }
  else { query.set("page", String(s.pagination.page)); query.set("pageSize", String(s.pagination.pageSize)); query.set("q", s.listScope.q); }
  return { query, revision: c.sourceRevisions.find((r: { kind: string }) => r.kind === "owning_revision").revision as string };
}
for (const name of ["product", "plan", "partial-19-of-21", "misaligned", "missing-id"] as const) test(`actual isolated Python ${name} DTO obeys the consumer contract`, () => {
  const value = fixture(name), request = args(value);
  assert.equal(decodePromotionInsightsForQuery(value, request.query, request.revision).columnVersion, "netshop-promotion-v1");
});
test("actual isolated Python detail is bound to its exact object and version", () => {
  const value = fixture("detail"), request = args(value, true);
  assert.equal(decodePromotionDetailForQuery(value, request.query, request.revision).sections.item.rowKey, value.sections.item.rowKey);
});
test("cross-shop rows and foreign owning headers fail closed", () => {
  const value = fixture("product"), request = args(value);
  assert.throws(() => decodePromotionInsightsForQuery(value, request.query, "99:aaaaaaaaaaaa"));
  value.sections.items[0].shopKey = "京东\u001f未授权店";
  assert.throws(() => decodePromotionInsightsForQuery(value, request.query, request.revision));
});
test("search and object range cannot silently replace the requested complete summary", () => {
  const value = fixture("product"), request = args(value);
  value.sections.listScope.q = "wrong-search";
  assert.throws(() => decodePromotionInsightsForQuery(value, request.query, request.revision));
});
test("CPC cannot be an unversioned amount or use a fabricated mean", () => {
  const value = fixture("product"), request = args(value);
  value.sections.summary.cpc.unit = "CNY_CENT";
  assert.throws(() => decodePromotionInsightsForQuery(value, request.query, request.revision));
  const valid = fixture("product"), validRequest = args(valid);
  valid.sections.summary.cpc.value = 0.00001;
  assert.throws(() => decodePromotionInsightsForQuery(valid, validRequest.query, validRequest.revision));
});
test("no business identity and ambiguous product mapping cannot be made drillable", () => {
  const value = fixture("product"), request = args(value);
  value.sections.items[0].id = null; value.sections.items[0].drillable = true;
  assert.throws(() => decodePromotionInsightsForQuery(value, request.query, request.revision));
  const mapped = fixture("product"), mappedRequest = args(mapped);
  mapped.sections.items[0].mapping.status = "ambiguous";
  mapped.sections.items[0].mapping.linkIdentity = { platform: "京东", shopName: mapped.sections.items[0].shopName, dimension: "sku", id: mapped.sections.items[0].id };
  assert.throws(() => decodePromotionInsightsForQuery(mapped, mappedRequest.query, mappedRequest.revision));
});
test("ratio values cannot disagree with their source operands", () => {
  const value = fixture("product"), request = args(value);
  value.sections.summary.roas.value = 10000;
  assert.throws(() => decodePromotionInsightsForQuery(value, request.query, request.revision));
});
test("partial matched fees remain separate from the unavailable whole-period fee", () => {
  const value = fixture("partial-19-of-21"), request = args(value);
  const decoded = decodePromotionInsightsForQuery(value, request.query, request.revision);
  assert.equal(decoded.sections.summary.spendRate.value, null);
  assert.equal(decoded.sections.summary.spendRate.reasonCode, "incomplete_coverage");
  assert.equal(decoded.sections.matchedRange?.metrics.spendRate.value, 0.2);
  const own = decoded.sections.coverage[decoded.sections.matchedRange!.coverageRef];
  assert.equal(own.expectedShopDatePairs, 19); assert.equal(own.complete, true);
  const main = decoded.sections.coverage[decoded.sections.summary.spendRate.coverageRef];
  assert.equal(main.expectedShopDatePairs, 21); assert.equal(main.coveredShopDatePairs, 19); assert.equal(main.complete, false);
});
test("main fee cannot copy an available partial-subset fee", () => {
  const value = fixture("partial-19-of-21"), request = args(value);
  value.sections.summary.spendRate = value.sections.matchedRange.metrics.spendRate;
  assert.throws(() => decodePromotionInsightsForQuery(value, request.query, request.revision));
});
test("efficiency operands must come from sibling metrics and may not disappear", () => {
  for (const key of ["cpc", "roas", "ctr"]) {
    const value = fixture("product"), request = args(value), metric = value.sections.summary[key];
    metric.denominator = 50; metric.numerator = 100; metric.value = 2;
    assert.throws(() => decodePromotionInsightsForQuery(value, request.query, request.revision));
    const missing = fixture("product"), missingRequest = args(missing);
    delete missing.sections.summary[key].numerator; delete missing.sections.summary[key].denominator;
    assert.throws(() => decodePromotionInsightsForQuery(missing, missingRequest.query, missingRequest.revision));
  }
});
test("promotion and product-day monetary bases cannot replace each other", () => {
  const value = fixture("product"), request = args(value);
  value.sections.summary.spend.sourceIds = ["jd_sku_daily"]; value.sections.summary.spend.basis = "erp_net_sales";
  assert.throws(() => decodePromotionInsightsForQuery(value, request.query, request.revision));
  const aux = fixture("partial-19-of-21"), auxRequest = args(aux);
  aux.sections.matchedRange.metrics.payment.sourceIds = ["jd_promotion"];
  assert.throws(() => decodePromotionInsightsForQuery(aux, auxRequest.query, auxRequest.revision));
});
test("a JD follow-order SKU cannot drill into a same-text SPU identity", () => {
  const value = fixture("product"), request = args(value), item = value.sections.items[0];
  item.mapping.status = "matched"; item.mapping.evidence = "exact_source_identity";
  item.mapping.linkIdentity = { platform: "京东", shopName: item.shopName, dimension: "spu", id: item.id };
  assert.throws(() => decodePromotionInsightsForQuery(value, request.query, request.revision));
});
test("an unmatched store-day collection is a usable DTO with unavailable fees", () => {
  const value = fixture("misaligned"), request = args(value);
  const decoded = decodePromotionInsightsForQuery(value, request.query, request.revision);
  assert.equal(decoded.sections.summary.spendRate.value, null);
  assert.equal(decoded.sections.matchedRange!.metrics.spendRate.value, null);
  assert.equal(decoded.sections.coverage[decoded.sections.matchedRange!.coverageRef].complete, false);
  const main = decoded.sections.coverage[decoded.sections.summary.spendRate.coverageRef];
  assert.equal(main.coveredShopDatePairs, 0); assert.equal(main.expectedShopDatePairs, 2);
});
test("source rows without an ID remain visible but never become entity changes", () => {
  const value = fixture("missing-id"), request = args(value);
  const decoded = decodePromotionInsightsForQuery(value, request.query, request.revision), item = decoded.sections.items[0];
  assert.equal(item.id, null); assert.equal(item.drillable, false); assert.equal(item.mapping.followSkuId, null);
  assert.equal(item.changes.spend.previous.value, null); assert.equal(decoded.sections.contributions.comparedObjectCount, 0);
});
test("shop shares require the real own and complete total spends", () => {
  const value = fixture("product"), request = args(value), share = value.sections.shops.items[0].spendShare;
  share.denominator = 10000; share.value = share.numerator/10000;
  assert.throws(() => decodePromotionInsightsForQuery(value, request.query, request.revision));
  const source = fixture("product"), sourceRequest = args(source);
  source.sections.shops.items[0].spendShare.sourceIds = ["jd_sku_daily"];
  assert.throws(() => decodePromotionInsightsForQuery(source, sourceRequest.query, sourceRequest.revision));
});
test("contributions cannot use unknown identities or reverse the delta direction", () => {
  const value = fixture("product"), request = args(value), item = value.sections.items[0];
  value.sections.contributions.comparedObjectCount = 1;
  value.sections.contributions.previous.spendIncrease = [item];
  item.id = null; item.drillable = false; item.mapping.status = "unmapped"; item.mapping.evidence = "unverified"; item.mapping.linkIdentity = null; item.mapping.followSkuId = null;
  assert.throws(() => decodePromotionInsightsForQuery(value, request.query, request.revision));
  const reverse = fixture("product"), reverseRequest = args(reverse), known = reverse.sections.items[0];
  reverse.sections.contributions.comparedObjectCount = 1;
  known.changes.spend.previous = { ...known.changes.spend.previous, value: -100, status: "available", reasonCode: null };
  known.changes.attributedPayment.previous = { ...known.changes.attributedPayment.previous, value: 100, status: "available", reasonCode: null };
  reverse.sections.contributions.previous.spendIncrease = [known];
  assert.throws(() => decodePromotionInsightsForQuery(reverse, reverseRequest.query, reverseRequest.revision));
});
test("auxiliary matched scope cannot claim the whole period or mix monetary sources", () => {
  const value = fixture("partial-19-of-21"), request = args(value);
  value.sections.matchedRange.shopDates[0].dates.pop();
  assert.throws(() => decodePromotionInsightsForQuery(value, request.query, request.revision));
  const mixed = fixture("partial-19-of-21"), mixedRequest = args(mixed);
  mixed.sections.matchedRange.metrics.payment.coverageRef = mixed.sections.summary.spend.coverageRef;
  assert.throws(() => decodePromotionInsightsForQuery(mixed, mixedRequest.query, mixedRequest.revision));
});
