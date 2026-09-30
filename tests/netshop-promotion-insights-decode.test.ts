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
for (const name of ["product", "plan"] as const) test(`actual isolated Python ${name} DTO obeys the consumer contract`, () => {
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
