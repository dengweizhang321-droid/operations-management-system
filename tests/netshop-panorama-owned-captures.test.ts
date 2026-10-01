import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeStorePanorama } from "../app/netshop/panorama/contract";

function fixture(name: string) {
  const value = JSON.parse(readFileSync(new URL(`./fixtures/netshop-panorama/response-${name}.json`, import.meta.url), "utf8"));
  const c = value.context, table = value.tableScope;
  const query = new URLSearchParams({ platform: c.requestedScope.platforms[0], outlet: c.requestedScope.shopKeys[0], dimension: c.requestedScope.dimension,
    startDate: c.periods.current.startDate, endDate: c.periods.current.endDate, periodKind: c.requestedScope.periodKind, ...Object.fromEntries(Object.entries(table).map(([key, field]) => [key, String(field)])) });
  const revision = c.sourceRevisions.find((ref: { kind: string }) => ref.kind === "owning_revision").revision;
  return { value, query, revision };
}
for (const name of ["sales", "sales-missing-order", "workflow"]) test(`unchanged private PG and owning HTTP ${name} capture is accepted by S`, () => {
  const { value, query, revision } = fixture(name), decoded = decodeStorePanorama(value, query, revision);
  assert.equal(decoded.schemaVersion, "netshop-store-panorama-v1");
  if (decoded.sources.sales.state === "ready") {
    assert.equal(decoded.sources.sales.data.periods.current.metrics.netQuantity.unit, "NATIVE_INTEGER_QUANTITY");
    assert.equal(decoded.sources.sales.data.periods.current.metrics.cost.value, null);
  }
});
test("native ERP amounts, trusted groups, units and raw cost restrictions cannot be fabricated in the display projection", () => {
  for (const kind of ["money", "quantity", "orders", "mean", "cost", "comparison", "fake-daily"] as const) {
    const { value, query, revision } = fixture("sales"), data = value.sources.sales.data, metrics = data.periods.current.metrics;
    if (kind === "money") metrics.netSales.value += 1;
    if (kind === "quantity") metrics.netQuantity.unit = "COUNT";
    if (kind === "orders") metrics.orders.value += 1;
    if (kind === "mean") metrics.orderAverageValue.value += .01;
    if (kind === "cost") { metrics.cost.value = 0; metrics.cost.status = "available"; metrics.cost.reasonCode = null; }
    if (kind === "comparison") data.comparisons.netSales.previous.status = ["available"];
    if (kind === "fake-daily") data.daily.push({ date: data.scope.startDate, metrics: { ...metrics } });
    assert.throws(() => decodeStorePanorama(value, query, revision));
  }
});
test("cost stored zero remains only owning evidence; missing order number never becomes a guessed average", () => {
  const { value, query, revision } = fixture("sales-missing-order"), decoded = decodeStorePanorama(value, query, revision);
  assert.equal(decoded.sources.sales.state, "ready");
  if (decoded.sources.sales.state === "ready") {
    const mean = decoded.sources.sales.data.periods.current.metrics.orderAverageValue;
    assert.equal(mean.value, null); assert.equal(mean.reasonCode, "missing_order_no");
  }
});
test("additive ERP trend capabilities accept a complete unavailable pair and reject invented series evidence", () => {
  const { value, query, revision } = fixture("sales");
  for (const id of ["erp_trend", "erp_detail"]) value.sections.performance.capabilities.push({ id, status: "unavailable", reasonCode: "not_applicable", message: "历史原始捕获未请求原生序列" });
  assert.equal(decodeStorePanorama(value, query, revision).sources.sales.state, "ready");
  const last = value.sections.performance.capabilities.at(-1);
  last.status = "available"; last.reasonCode = null;
  assert.throws(() => decodeStorePanorama(value, query, revision));
  value.sections.performance.capabilities.pop();
  assert.throws(() => decodeStorePanorama(value, query, revision));
});
