import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  decodeProductScopeSeries, productSeriesColumns, restoreProductScopeSeriesMetric,
  validateProductScopeSeriesQuery, resolveProductScopeSeriesCoverage,
} from "../lib/netshop/product-scope-series-contract";

const root = process.env.TERUISI_PRODUCT_SERIES_PG_FIXTURE_ROOT ?? join(import.meta.dirname, "fixtures/netshop-product-scope-series");
function fixture(name = "series-day-response.json") {
  return JSON.parse(readFileSync(join(root, name), "utf8"));
}
function decode(data: ReturnType<typeof fixture>) {
  return decodeProductScopeSeries(data.body, new URLSearchParams(data.query), data.owningRevision);
}
test("real private PostgreSQL three-period projection restores all scalar and derived columns", () => {
  const data = fixture(), result = decode(data);
  const day = result.series.current[0], missing = result.series.current[1];
  assert.equal(result.columnDefinitions.length, 21);
  assert.equal(restoreProductScopeSeriesMetric(result, day, "payment").value, 31000);
  assert.equal(restoreProductScopeSeriesMetric(result, day, "conversion").value, .1);
  assert.equal(restoreProductScopeSeriesMetric(result, missing, "payment").value, null);
  assert.equal(resolveProductScopeSeriesCoverage(result, restoreProductScopeSeriesMetric(result, day, "payment").coverageRef).complete, true);
  assert.equal(resolveProductScopeSeriesCoverage(result, restoreProductScopeSeriesMetric(result, missing, "payment").coverageRef).complete, false);
  for (const key of productSeriesColumns) assert.doesNotThrow(() => restoreProductScopeSeriesMetric(result, day, key));
  assert.equal(result.context.calendar.length, 2);
  assert.equal(result.series.previous.length, 2);
  assert.equal(result.series.yearAgo.length, 2);
});
test("source numeric zero remains available; missing field and zero denominator remain different", () => {
  const result = decode(fixture("series-zero-response.json")), point = result.series.current[0];
  assert.equal(restoreProductScopeSeriesMetric(result, point, "payment").value, 0);
  assert.equal(restoreProductScopeSeriesMetric(result, point, "quantity").reasonCode, "missing_field");
  assert.equal(restoreProductScopeSeriesMetric(result, point, "conversion").reasonCode, "zero_denominator");
});
test("natural week uses actual clipped boundaries and summed operands", () => {
  const result = decode(fixture("series-week-response.json"));
  assert.deepEqual(result.series.current.map(p => [p.date, p.endDate]), [["2026-09-06", "2026-09-06"], ["2026-09-07", "2026-09-13"]]);
  assert.equal(restoreProductScopeSeriesMetric(result, result.series.current[1], "conversion").value, 15 / 110);
  assert.equal(restoreProductScopeSeriesMetric(result, result.series.current[1], "visitorValue").value, 1400 / 110);
});
test("month projection preserves Jan31 and non-leap Feb28 independent source periods", () => {
  const result = decode(fixture("series-month-response.json"));
  assert.equal(result.series.previous[0].endDate, "2024-01-31");
  assert.equal(result.series.yearAgo[0].endDate, "2023-02-28");
  assert.equal(result.context.periods.current.days, 29);
});
test("field resolver retains exact missing dates for only the participating weighted operands", () => {
  const result = decode(fixture("series-field-coverage-response.json")), point = result.series.current[0];
  const payment = resolveProductScopeSeriesCoverage(result, restoreProductScopeSeriesMetric(result, point, "payment").coverageRef);
  const conversion = resolveProductScopeSeriesCoverage(result, restoreProductScopeSeriesMetric(result, point, "conversion").coverageRef);
  assert.equal(payment.complete, true);
  assert.equal(conversion.coveredShopDatePairs, 1);
  assert.deepEqual(conversion.missingByShop[0].dates, ["2026-09-07"]);
  assert.deepEqual(conversion.fields, ["customers", "visitors"]);
  assert.throws(() => resolveProductScopeSeriesCoverage(result, point.coverageRef + "#01"));
  assert.throws(() => resolveProductScopeSeriesCoverage(result, point.coverageRef + "#21"));
});
test("closed query refuses implicit shops, page/search, duplicate grain and foreign scope", () => {
  for (const suffix of ["&q=P1", "&page=2", "&category=x", "&grain=day&grain=week", "&platform=天猫", "&outlet=京东%1FB", "&grain=seven_days"]) {
    assert.throws(() => validateProductScopeSeriesQuery(new URLSearchParams(fixture().query + suffix)));
  }
  const query = new URLSearchParams(fixture().query); query.delete("outlet");
  assert.throws(() => validateProductScopeSeriesQuery(query));
});
test("headers, owning scope, vector, date windows and projection version remain bound", () => {
  for (const mutate of [
    (d: ReturnType<typeof fixture>) => { d.owningRevision = "999:bbbbbbbbbbbb"; },
    (d: ReturnType<typeof fixture>) => { d.query += "&outlet=京东%1FB"; },
    (d: ReturnType<typeof fixture>) => { d.body.joinedSourceRevisions.pop(); },
    (d: ReturnType<typeof fixture>) => { d.body.projection = "pretend-full-P-DTO"; },
    (d: ReturnType<typeof fixture>) => { d.body.context.periods.previous.days = 1; },
    (d: ReturnType<typeof fixture>) => { d.body.series.previous[0].date = d.body.series.current[0].date; },
    (d: ReturnType<typeof fixture>) => { d.body.context.calendar.pop(); },
    (d: ReturnType<typeof fixture>) => { d.body.context.effectiveScope.shopKeys = ["京东\u001fB"]; },
  ]) { const data = fixture(); mutate(data); assert.throws(() => decode(data)); }
});
test("every point, column, closed cell and source-field coverage reference is mandatory", () => {
  for (const mutate of [
    (d: ReturnType<typeof fixture>) => { d.body.series.current.pop(); },
    (d: ReturnType<typeof fixture>) => { d.body.series.current[0].cells.pop(); },
    (d: ReturnType<typeof fixture>) => { d.body.series.current[0].cells[0].push(0); },
    (d: ReturnType<typeof fixture>) => { d.body.series.current[0].cells[0][3] = true; },
    (d: ReturnType<typeof fixture>) => { d.body.series.current[0].cells[0][3] = 1; },
    (d: ReturnType<typeof fixture>) => { d.body.series.current[0].coverageRef = d.body.series.previous[0].coverageRef; },
    (d: ReturnType<typeof fixture>) => { delete d.body.pointCoverage[d.body.series.current[0].coverageRef]; },
    (d: ReturnType<typeof fixture>) => { d.body.pointCoverage.extra = d.body.pointCoverage[d.body.series.current[0].coverageRef]; },
    (d: ReturnType<typeof fixture>) => { d.body.columnDefinitions[0].unit = "COUNT"; },
    (d: ReturnType<typeof fixture>) => { d.body.columnDefinitions[0].sourceIds = ["tmall_product_daily"]; },
    (d: ReturnType<typeof fixture>) => { d.body.columnDefinitions[0].fields = ["visitors"]; },
    (d: ReturnType<typeof fixture>) => { d.body.columnDefinitions[0].extra = true; },
    (d: ReturnType<typeof fixture>) => { d.body.coverageFields.reverse(); },
    (d: ReturnType<typeof fixture>) => { d.body.pointCoverage[d.body.series.current[0].coverageRef].presentCounts[0] = 32; },
    (d: ReturnType<typeof fixture>) => { d.body.pointCoverage[d.body.series.current[0].coverageRef].rows = true; },
    (d: ReturnType<typeof fixture>) => { d.body.pointCoverage[d.body.series.current[0].coverageRef].shopKey = "京东\u001fB"; },
    (d: ReturnType<typeof fixture>) => { d.body.pointCoverage[d.body.series.current[0].coverageRef].missingFieldDates.pop(); },
    (d: ReturnType<typeof fixture>) => { d.body.pointCoverage[d.body.series.current[0].coverageRef].missingFieldDates[0] = ["2025-09-01"]; },
    (d: ReturnType<typeof fixture>) => { d.body.pointCoverage[d.body.series.current[0].coverageRef].missingFieldDates[7] = []; },
  ]) { const data = fixture(); mutate(data); assert.throws(() => decode(data)); }
});
test("forged missing-day zero, missing-field zero, string counts and unweighted ratios reject", () => {
  for (const mutate of [
    (d: ReturnType<typeof fixture>) => { d.body.series.current[1].cells[0][0] = 0; d.body.series.current[1].cells[0][1] = "available"; d.body.series.current[1].cells[0][2] = null; },
    (d: ReturnType<typeof fixture>) => { d.body.series.current[0].cells[7][0] = 0; d.body.series.current[0].cells[7][1] = "available"; d.body.series.current[0].cells[7][2] = null; },
    (d: ReturnType<typeof fixture>) => { d.body.series.current[0].cells[0][0] = "31000"; },
    (d: ReturnType<typeof fixture>) => { d.body.series.current[0].cells[0][0] = true; },
    (d: ReturnType<typeof fixture>) => { d.body.series.current[0].cells[4][4] = 1; },
    (d: ReturnType<typeof fixture>) => { d.body.series.current[0].cells[4][0] = .10000000001; },
    (d: ReturnType<typeof fixture>) => { d.body.series.current[0].cells[20][5] = 1; },
  ]) { const data = fixture(); mutate(data); assert.throws(() => decode(data)); }
});
test("original UTF-8 response budget rejects explicit overflow", () => {
  const data = fixture(); data.body.limitations = ["x".repeat(2 * 1024 * 1024)];
  assert.throws(() => decode(data));
});
test("actual maximum private-PG payload retains 1099 points including derived367 and all21 columns", {
  skip: !process.env.TERUISI_PRODUCT_SERIES_PG_FIXTURE_ROOT && "Maximum DTO is external private-PG evidence, not committed synthetic bulky JSON",
}, () => {
  const data = fixture("series-max-response.json"), result = decode(data);
  assert.deepEqual(Object.values(result.series).map(v => v.length), [366, 366, 367]);
  assert.equal(result.series.yearAgo[366].date, "2025-02-28");
  assert.equal(new TextEncoder().encode(JSON.stringify(data.body)).byteLength <= 2 * 1024 * 1024, true);
  assert.equal(result.context.calendar.length, 366);
});
