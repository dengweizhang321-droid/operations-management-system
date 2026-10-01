import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { decodePromotionInsightsForQuery } from "../lib/netshop/promotion-insights-contract";

function positive() {
  const value = JSON.parse(fs.readFileSync(new URL("./fixtures/netshop-promotion/response-product.json", import.meta.url), "utf8"));
  const c = value.context, s = value.sections;
  const q = new URLSearchParams({ platform: c.requestedScope.platforms[0], dimension: c.requestedScope.dimension,
    startDate: c.periods.current.startDate, endDate: c.periods.current.endDate, periodKind: c.requestedScope.periodKind,
    trendGrain: s.trend.grain, objectKind: s.listScope.objectKind, page: String(s.pagination.page), pageSize: String(s.pagination.pageSize), q: s.listScope.q });
  c.requestedScope.shopKeys.forEach((key: string) => q.append("outlet", key));
  const revision = c.sourceRevisions.find((r: { kind: string }) => r.kind === "owning_revision").revision;
  assert.equal(decodePromotionInsightsForQuery(value, q, revision).columnVersion, "netshop-promotion-v1");
  return { value, q, revision };
}
const cases: Array<[string, (value: ReturnType<typeof positive>["value"]) => void]> = [
  ["comparison", v => Object.assign(v.sections.comparisons.spend.previous, { status: ["available"], value: "untrusted", reasonCode: "anything" })],
  ["capability", v => Object.assign(v.sections.objectCapabilities.product, { status: ["available"], reasonCode: "anything" })],
  ["diagnostic-status", v => { v.sections.diagnostic.status = ["available"]; }],
  ["diagnostic-format", v => { v.sections.diagnostic.reportFormats = [["html"]]; }],
  ["mapping", v => Object.assign(v.sections.items[0].mapping, { status: ["matched"], linkIdentity: null })],
  ["field-status", v => Object.assign(v.sections.sourceMatrix[0].fields[0], { status: ["available"], reasonCode: "anything" })],
];
for (const [name, mutate] of cases) test(`Q replay I enum boundary: ${name}`, () => {
  const { value, q, revision } = positive();
  mutate(value);
  assert.throws(() => decodePromotionInsightsForQuery(value, q, revision));
});
