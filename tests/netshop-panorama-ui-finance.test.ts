import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeFinanceNetshop } from "../lib/netshop/finance-netshop-contract";
import { formatPanoramaFinanceState, panoramaFinanceAnnual, panoramaFinanceRead } from "../app/netshop/panorama/ui-state";
function fixture(name = "finance-response.json") {
  const raw = JSON.parse(readFileSync(new URL(`./fixtures/netshop-finance/${name}`, import.meta.url), "utf8"));
  return decodeFinanceNetshop(raw.response.data, raw.request, raw.owningRevision);
}
test("Finance UI uses the S period owning ref current state rather than native previous comparison", () => {
  const available = fixture(), missing = fixture("finance-missing-month-response.json");
  const reads = { owning: [available, missing], periodReadRefs: { current: 1, previous: 0, yearAgo: 0 } };
  assert.equal(panoramaFinanceRead(reads, "current").monthly.currentMetricStates.netSalesCents.reasonCode, "missing_month");
  assert.equal(panoramaFinanceRead(reads, "previous").monthly.currentMetricStates.netSalesCents.value, 180000);
  assert.equal(formatPanoramaFinanceState(panoramaFinanceRead(reads, "current").monthly.currentMetricStates.netSalesCents), "—");
});
test("Finance true zero and missing cost stay distinct; unverified rates do not become primary percentages", () => {
  const owner = fixture("finance-zero-missing-field-response.json");
  assert.equal(formatPanoramaFinanceState(owner.monthly.currentMetricStates.netSalesCents), "0.00 元");
  assert.equal(formatPanoramaFinanceState(owner.monthly.currentMetricStates.netCostCents), "—");
  assert.equal(owner.monthly.currentMetricStates.grossMarginBps.reasonCode, "unverified_source");
});
test("annual read preserves native original progress, available/missing months and actual cutoff", () => {
  const annual = panoramaFinanceAnnual(fixture())!;
  assert.equal(annual.items[0].salesProgress, .5); assert.equal(annual.items[0].profitProgress, .5);
  assert.equal(annual.cutoffMonth, "2026-03"); assert.deepEqual(annual.missingMonths, ["2026-02"]);
  assert.deepEqual(annual.items[0].availableMonths, ["2026-01", "2026-03"]);
});
test("unconfigured and real zero targets remain separate and never acquire fabricated progress", () => {
  const missing = panoramaFinanceAnnual(fixture("finance-zero-missing-field-response.json"))!, zero = panoramaFinanceAnnual(fixture("finance-zero-target-response.json"))!;
  assert.equal(missing.items[0].configured, false); assert.equal(missing.items[0].salesTargetCents, null);
  assert.equal(zero.items[0].configured, true); assert.equal(zero.items[0].salesTargetCents, 0); assert.equal(zero.items[0].salesProgress, null);
});
