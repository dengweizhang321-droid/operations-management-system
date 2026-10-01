import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeSalesPeriodsForRequest, type SalesPeriodsRequest } from "../lib/netshop/sales-periods-contract";
import { formatPanoramaErpPoint, panoramaErpPlotValue, panoramaErpSeriesRows } from "../app/netshop/panorama/ui-state";
function fixture(grain: "day" | "week" | "month") {
  const root = new URL("./fixtures/netshop-sales-period-series/", import.meta.url);
  const body = JSON.parse(readFileSync(new URL(`sales-series-${grain}.json`, root), "utf8"));
  const meta = JSON.parse(readFileSync(new URL(`sales-series-${grain}.meta.json`, root), "utf8"));
  return decodeSalesPeriodsForRequest(body, meta.request as SalesPeriodsRequest, "7:3");
}
test("ERP UI restores whole independent original windows and leaves missing records as chart gaps", () => {
  const owner = fixture("day"), identity = owner.series!.items[0].identityKey;
  const current = panoramaErpSeriesRows(owner, identity, "current")!, baseline = panoramaErpSeriesRows(owner, identity, "baseline")!;
  assert.equal(current.length, 9); assert.equal(baseline.length, 5);
  assert.equal(current[0].window.startDate, owner.periods.current.startDate);
  assert.equal(baseline.at(-1)!.window.endDate, owner.periods.baseline.endDate);
  const absent = current.find(row => !row.facts.rowPresence)!;
  assert.equal(panoramaErpPlotValue(absent, "netSalesCents"), null);
  assert.equal(panoramaErpPlotValue(absent, "rowCount"), null);
  assert.equal(formatPanoramaErpPoint(absent, "netSalesCents"), "—");
  assert.equal(absent.facts.observations.completeness, "unknown");
  assert.equal(panoramaErpSeriesRows(owner, "foreign-shop", "current"), null);
});
test("weekly ERP group mean uses the owning distinct denominator and missing-order reason", () => {
  const owner = fixture("week"), rows = panoramaErpSeriesRows(owner, owner.series!.items[0].identityKey, "current")!;
  assert.equal(rows[0].facts.orders.trustedOrderCount, 1);
  assert.equal(panoramaErpPlotValue(rows[0], "orderMean"), 3000);
  assert.equal(formatPanoramaErpPoint(rows[0], "orderMean"), "30.00 元/已导入订单组");
  assert.equal(rows[1].facts.orders.netAmountPerOrder.reasonCode, "missing_order_no");
  assert.equal(panoramaErpPlotValue(rows[1], "orderMean"), null);
  assert.equal(rows[0].facts.observations.observedDateCount, 2);
  assert.equal(rows[0].facts.observations.requestedDays, 6);
});
test("native signed quantity and unverified cost remain separate from generic counts and verified profit", () => {
  const owner = fixture("week"), rows = panoramaErpSeriesRows(owner, owner.series!.items[0].identityKey, "current")!;
  assert.equal(formatPanoramaErpPoint(rows[1], "netQuantity"), "-1 原生数量");
  assert.equal(formatPanoramaErpPoint(rows[0], "costCents"), "5.00 元");
  assert.equal(owner.series!.metricMetadata.cost.verification, "unverified_source");
  assert.equal(owner.series!.metricMetadata.cost.zeroCostVerification, "unknown");
});
test("opt-in month points stay in actual clipped source window; old no-series envelope is an explicit gap", () => {
  const owner = fixture("month"), rows = panoramaErpSeriesRows(owner, owner.series!.items[0].identityKey, "current")!;
  assert.equal(rows.length, 1); assert.equal(rows[0].window.startDate, "2026-09-01"); assert.equal(rows[0].window.endDate, "2026-09-09");
  assert.equal(panoramaErpSeriesRows({ ...owner, series: undefined }, owner.series!.items[0].identityKey, "current"), null);
});
