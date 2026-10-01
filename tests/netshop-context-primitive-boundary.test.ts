import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { decodeInsightsContext } from "../lib/netshop/insights-contract";

const actual = JSON.parse(readFileSync(new URL("./fixtures/netshop-product-scope-series/series-day-response.json", import.meta.url), "utf8"));
const context = actual.body.context;
test("actual owned PG context keeps all primitive dates and capabilities", () => { assert.equal(decodeInsightsContext(context), context); });
for (const period of ["current", "previous", "yearAgo"]) for (const field of ["startDate", "endDate", "endExclusive"]) test(`actual context ${period}.${field} refuses an array that stringifies to the same date`, () => {
  const bad = structuredClone(context); bad.periods[period][field] = [bad.periods[period][field]];
  assert.throws(() => decodeInsightsContext(bad));
});
for (const field of ["period", "field", "status", "reasonCode"]) test(`actual context capability ${field} refuses coercible arrays`, () => {
  const bad = structuredClone(context), capability = bad.capabilities.find((value: { reasonCode: unknown }) => field !== "reasonCode" || value.reasonCode !== null)!;
  capability[field] = [capability[field]]; assert.throws(() => decodeInsightsContext(bad));
});
test("raw dimension and platforms cannot hide arrays in a valid source scope", () => {
  for (const scope of ["requestedScope", "effectiveScope"]) {
    const bad = structuredClone(context); bad[scope].dimension = [bad[scope].dimension]; assert.throws(() => decodeInsightsContext(bad));
    const other = structuredClone(context); other[scope].platforms = other[scope].platforms.map((value: string) => [value]); assert.throws(() => decodeInsightsContext(other));
  }
});
