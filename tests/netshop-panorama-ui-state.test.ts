import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeProductScopeSeries } from "../lib/netshop/product-scope-series-contract";
import { defaultShopLocationContext } from "../app/shell/shop-context";
import { panoramaChapter, panoramaChapters, panoramaDirectoryQuery, panoramaGrainChange, panoramaPageButtons, panoramaPageSize, panoramaPageSizeChange, panoramaPresentationScope, panoramaQuery, panoramaScrollStorageKey, panoramaSearchChange, panoramaSeriesChartPoints, panoramaSeriesRows, panoramaShop, panoramaShopChange, panoramaTokenFamily, decodePanoramaScroll } from "../app/netshop/panorama/ui-state";
import type { NetshopColumnProps } from "../app/netshop/shared/module-slots";

const context = { ...defaultShopLocationContext, platforms: ["京东" as const], outlets: ["京东\u001f甲店"], pageSize: 5 };
const scope = { context, startDate: "2026-09-01", endDate: "2026-09-29", periodKind: "custom" };

test("panorama has exactly the selected cockpit's eight content chapters", () => {
  assert.equal(panoramaChapters.length, 8);
  assert.equal(panoramaChapter("layout-2"), "performance");
  assert.equal(panoramaChapter("dataQuality"), "dataQuality");
});
test("single-shop selection rejects absent/multiple/cross-platform/illegal dimension instead of guessing", () => {
  assert.equal(panoramaShop({ ...context, outlets: [] }), null);
  assert.equal(panoramaShop({ ...context, outlets: ["京东\u001f甲店", "京东\u001f乙店"] }), null);
  assert.equal(panoramaShop({ ...context, outlets: ["天猫\u001f甲店"] }), null);
  assert.equal(panoramaShop({ platforms: ["天猫"], outlets: ["天猫\u001f甲店"], dimension: "sku" }), null);
  assert.equal(panoramaShop({ ...context, outlets: ["京东\u001f甲店\u001f乙店"] }), null);
  assert.equal(panoramaQuery({ ...scope, context: { ...context, outlets: [] } }), null);
  assert.deepEqual(panoramaShop(context), { platform: "京东", shopName: "甲店", key: "京东\u001f甲店" });
});
test("restricted shop discovery requests only the selected platform and never guesses two grants", () => {
  const user = { email: "viewer@example.invalid", displayName: "test", role: "viewer", roleLabel: "viewer", scopeRestricted: true } as NonNullable<NetshopColumnProps["currentUser"]>;
  assert.equal(panoramaDirectoryQuery({ ...scope, context: { ...defaultShopLocationContext }, currentUser: user }), null);
  assert.deepEqual(panoramaDirectoryQuery({ ...scope, currentUser: user })?.getAll("platform"), ["京东"]);
  assert.deepEqual(panoramaDirectoryQuery({ ...scope, context: { ...context, platforms: [] }, currentUser: user })?.getAll("platform"), ["京东"]);
  const unrestricted = panoramaDirectoryQuery({ ...scope, context: { ...defaultShopLocationContext }, currentUser: { ...user, scopeRestricted: false } });
  assert.deepEqual(unrestricted?.getAll("platform"), ["京东", "天猫"]);
  assert.equal(unrestricted?.get("outlet"), null);
  assert.equal(unrestricted?.get("dimension"), "spu");
});
test("search normalizes ID/title input and resets only the table presentation", () => {
  assert.deepEqual(panoramaSearchChange("  SKU-AbC  "), { q: "SKU-AbC", page: 1, section: "products", product: null });
  assert.deepEqual(panoramaSearchChange("商用开水设备"), { q: "商用开水设备", page: 1, section: "products", product: null });
  assert.equal(panoramaSearchChange("").q, "");
  assert.throws(() => panoramaSearchChange("x".repeat(121)));
  assert.throws(() => panoramaSearchChange("ID\u0000"));
  const next = { ...context, ...panoramaSearchChange("  设备  ") };
  const query = panoramaQuery({ ...scope, context: next })!;
  assert.equal(query.get("q"), "设备");
  assert.equal(query.get("outlet"), context.outlets[0]);
  assert.equal(query.get("startDate"), scope.startDate);
  assert.equal(query.get("endDate"), scope.endDate);
  assert.equal(query.get("page"), "1");
  assert.equal(panoramaQuery({ ...scope, context: { ...context, section: "promotion" } })?.toString(), panoramaQuery(scope)?.toString(), "chapter navigation changes presentation only");
});
test("shop and page size changes reset pagination and cannot retain a cross-shop product", () => {
  assert.deepEqual(panoramaShopChange("天猫\u001f乙店"), { platforms: ["天猫"], outlets: ["天猫\u001f乙店"], dimension: "spu", q: "", page: 1, product: null });
  assert.deepEqual(panoramaShopChange(""), { outlets: [], q: "", page: 1, product: null });
  assert.throws(() => panoramaShopChange("甲店"));
  assert.equal(panoramaPageSize(5), 5); assert.equal(panoramaPageSize(10), 10); assert.equal(panoramaPageSize(20), 20); assert.equal(panoramaPageSize(50), 5);
  assert.deepEqual(panoramaPageSizeChange(10), { pageSize: 10, page: 1, section: "products" });
  assert.throws(() => panoramaPageSizeChange(100));
});
test("page token family permits only page advancement; account/search/size/shop/date/dimension/section changes invalidate it", () => {
  const query = panoramaQuery(scope)!;
  const family = panoramaTokenFamily(query, "account-A");
  const page2 = new URLSearchParams(query); page2.set("page", "2"); page2.set("snapshotToken", "old"); page2.set("sectionToken", "old");
  assert.equal(panoramaTokenFamily(page2, "account-A"), family);
  assert.notEqual(panoramaTokenFamily(query, "account-B"), family);
  for (const [key, value] of [["q", "water"], ["pageSize", "10"], ["outlet", "京东\u001f乙店"], ["startDate", "2026-09-02"], ["dimension", "sku"], ["grain", "week"], ["section", "traffic"]]) {
    const next = new URLSearchParams(query); next.set(key, value);
    assert.notEqual(panoramaTokenFamily(next, "account-A"), family, key);
  }
});
function seriesFixture(name: string) {
  const envelope = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures/netshop-product-scope-series", name), "utf8"));
  return decodeProductScopeSeries(envelope.body, new URLSearchParams(envelope.query), envelope.owningRevision);
}
test("series grain travels through the canonical S request and resets page without changing table search", () => {
  assert.deepEqual(panoramaGrainChange("week"), { grain: "week", page: 1 });
  assert.throws(() => panoramaGrainChange("seven_days"));
  const next = { ...context, q: "设备", page: 3, ...panoramaGrainChange("month") };
  const query = panoramaQuery({ ...scope, context: next })!;
  assert.equal(query.get("grain"), "month"); assert.equal(query.get("page"), "1"); assert.equal(query.get("q"), "设备");
});
test("platform UI projects the complete owning current period and preserves a missing day as a gap", () => {
  const dto = seriesFixture("series-day-response.json");
  const rows = panoramaSeriesRows(dto, "current", ["payment", "quantity", "conversion"], "payment");
  assert.equal(rows.length, dto.series.current.length);
  assert.deepEqual(rows.map(row => [row.date, row.endDate]), dto.series.current.map(point => [point.date, point.endDate]));
  assert.equal(rows[0].metrics[0].metric.value, 31000);
  assert.equal(rows[1].metrics[0].metric.value, null); assert.equal(rows[1].coverage.complete, false);
  const chart = panoramaSeriesChartPoints(dto, "current", "payment");
  assert.equal(chart[1].values[0].value, null); assert.equal(chart[1].values[0].status, "unavailable");
  assert.deepEqual(rows[0].calendar, dto.context.calendar.find(day => day.date === rows[0].date));
});
test("natural-month baseline UI retains its own Jan31 / Feb28 bounds instead of current-period indexes", () => {
  const dto = seriesFixture("series-month-response.json");
  assert.equal(panoramaSeriesChartPoints(dto, "previous", "payment")[0].endDate, "2024-01-31");
  assert.equal(panoramaSeriesChartPoints(dto, "yearAgo", "payment")[0].endDate, "2023-02-28");
  assert.equal(panoramaSeriesRows(dto, "previous", ["payment"], "payment")[0].calendar, undefined);
});
test("UI shows the owning weighted weekly conversion and fractional visitor value without averaging daily percentages", () => {
  const dto = seriesFixture("series-week-response.json");
  const rows = panoramaSeriesRows(dto, "current", ["conversion", "visitorValue"], "conversion");
  assert.equal(rows[1].metrics[0].metric.value, 15 / 110);
  assert.equal(rows[1].metrics[1].metric.value, 1400 / 110);
  assert.equal(rows[1].metrics[1].metric.unit, "CNY_CENT_PER_COUNT");
  assert.equal(rows[1].calendar, undefined);
});
test("field coverage uses only the selected owning metric dependencies and genuine zero stays distinct", () => {
  const dto = seriesFixture("series-field-coverage-response.json");
  const payment = panoramaSeriesRows(dto, "current", ["payment", "conversion"], "payment")[0];
  const conversion = panoramaSeriesRows(dto, "current", ["payment", "conversion"], "conversion")[0];
  assert.equal(payment.coverage.complete, true); assert.equal(conversion.coverage.complete, false);
  assert.deepEqual(conversion.coverage.fields, ["customers", "visitors"]);
  assert.deepEqual(conversion.coverage.missingByShop[0].dates, ["2026-09-07"]);
  const zero = panoramaSeriesRows(seriesFixture("series-zero-response.json"), "current", ["payment", "quantity", "conversion"], "payment")[0];
  assert.equal(zero.metrics[0].metric.value, 0); assert.equal(zero.metrics[0].metric.status, "available");
  assert.equal(zero.metrics[1].metric.reasonCode, "missing_field"); assert.equal(zero.metrics[2].metric.reasonCode, "zero_denominator");
});
test("bottom page navigation stays bounded for a large result set and handles empty/out-of-range pages", () => {
  assert.deepEqual(panoramaPageButtons(1, 0, 5), [1]);
  assert.deepEqual(panoramaPageButtons(2, 18, 5), [1, 2, 3, 4]);
  assert.deepEqual(panoramaPageButtons(300, 4000, 5), [1, null, 299, 300, 301, null, 800]);
  assert.deepEqual(panoramaPageButtons(9, 18, 5), [1, null, 3, 4]);
  assert.deepEqual(panoramaPageButtons(1, 50001, 5), [1, 2, null, 10000]);
  assert.deepEqual(panoramaPageButtons(10001, 50001, 5), []);
  assert.deepEqual(panoramaPageButtons(1, 5, 0), []);
});
test("scroll restoration stores only a bounded coordinate, bound to account and complete presentation scope", () => {
  const user = { email: "user@example.invalid", displayName: "test", role: "viewer", roleLabel: "viewer" } as NonNullable<NetshopColumnProps["currentUser"]>;
  const key = panoramaScrollStorageKey({ ...scope, currentUser: user });
  assert.notEqual(key, panoramaScrollStorageKey({ ...scope, context: { ...context, page: 2 }, currentUser: user }));
  assert.notEqual(key, panoramaScrollStorageKey({ ...scope, currentUser: { ...user, email: "other@example.invalid" } }));
  assert.notEqual(key, panoramaScrollStorageKey({ ...scope, currentUser: { ...user, role: "operator" } }));
  const focusScope = panoramaPresentationScope({ ...scope, currentUser: user });
  assert.equal(focusScope, panoramaPresentationScope({ ...scope, context: { ...context, q: "ID", page: 2 }, currentUser: user }));
  assert.notEqual(focusScope, panoramaPresentationScope({ ...scope, context: { ...context, outlets: ["京东\u001f乙店"] }, currentUser: user }));
  assert.equal(decodePanoramaScroll("218.5"), 218.5);
  for (const value of [null, "", "-1", "NaN", "Infinity", "10000001", '{"result":"not allowed"}']) assert.equal(decodePanoramaScroll(value), null);
});
