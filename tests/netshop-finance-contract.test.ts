import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeFinanceNetshop, validateFinanceNetshopRequest } from "../lib/netshop/finance-netshop-contract";

const root = process.env.TERUISI_FINANCE_NETSHOP_FIXTURE_ROOT ?? join(import.meta.dirname, "fixtures/netshop-finance");
function fixture(name = "finance-response.json") { return JSON.parse(readFileSync(join(root, name), "utf8")); }
function decode(v: ReturnType<typeof fixture>) { return decodeFinanceNetshop(v.response.data, v.request, v.owningRevision); }

test("actual private-PG native monthly and year progress retain original owner DTO and scope", () => {
  const data = fixture(), result = decode(data);
  assert.equal(result.monthly.data!.current.netSalesCents, 180000);
  assert.equal(result.monthly.currentMetricStates.netSalesCents.value, 180000);
  assert.equal(result.monthly.currentMetricStates.profitCents.value, 45000);
  assert.equal(result.monthly.currentMetricStates.grossMarginBps.reasonCode, "unverified_source");
  assert.equal((result.annual.data!.items as Array<Record<string, unknown>>)[0].salesProgress, .5);
  assert.equal(result.annual.rateFieldsVerification.grossMarginBps, "unverified_source");
  assert.deepEqual(result.monthly.data!.selectedMonths, ["2026-01", "2026-03"]);
});
test("missing month, native true zero omitted shop, missing cost and no target remain distinct", () => {
  const missing = decode(fixture("finance-missing-month-response.json"));
  assert.deepEqual(missing.monthly.actualMonths, ["2026-01", "2026-03"]);
  assert.equal(missing.monthly.currentMetricStates.netSalesCents.value, null);
  assert.equal(missing.monthly.currentMetricStates.netSalesCents.reasonCode, "missing_month");
  const zero = decode(fixture("finance-zero-missing-field-response.json"));
  assert.deepEqual(zero.monthly.data!.shops, []);
  assert.equal(zero.monthly.currentMetricStates.netSalesCents.value, 0);
  assert.equal(zero.monthly.currentMetricStates.netCostCents.reasonCode, "missing_field");
  assert.equal((zero.annual.data!.items as Array<Record<string, unknown>>)[0].target, null);
  const targetZero = decode(fixture("finance-zero-target-response.json"));
  const item = (targetZero.annual.data!.items as Array<Record<string, unknown>>)[0];
  assert.notEqual(item.target, null);
  assert.equal((item.target as Record<string, unknown>).salesTargetCents, 0);
  assert.equal(item.salesProgress, null);
});
test("only canonical original JSON pair and explicit bounded natural months/year are accepted", () => {
  for (const delta of [{ months: [] }, { shopKeys: [] }, { year: 2026 }, { sourceUrl: "http://127.0.0.1" },
    { sql: "SELECT" }, { expiresAtEpochMs: true }, { expectedRevision: "1:erp" }, { snapshotToken: 1 },
    { shopKeys: ['["京东", "同名店"]'] }, { months: ["2026-01", "2026-01"] }, { startDate: "2026-01-15" }]) {
    assert.throws(() => validateFinanceNetshopRequest({ ...fixture().request, ...delta }));
  }
});
test("financial header owning kind, scope, native actual months, units and complete carrier reject forgery", () => {
  for (const change of [
    (d: ReturnType<typeof fixture>) => { d.owningRevision = "2:aaaaaaaaaaaa"; },
    (d: ReturnType<typeof fixture>) => { d.response.data.sourceRevisions[0].kind = "sales_pair"; },
    (d: ReturnType<typeof fixture>) => { d.response.data.requestedScope.shopKeys = ['["天猫","同名店"]']; },
    (d: ReturnType<typeof fixture>) => { d.response.data.monthly.data.selectedMonths = ["2026-02"]; },
    (d: ReturnType<typeof fixture>) => { d.response.data.monthly.data.current.netSalesCents = true; },
    (d: ReturnType<typeof fixture>) => { delete d.response.data.monthly.data.timeline; },
    (d: ReturnType<typeof fixture>) => { d.response.data.monthly.currentMetricStates.netSalesCents.unit = "COUNT"; },
    (d: ReturnType<typeof fixture>) => { d.response.data.monthly.fieldEvidence[0].fields.net_sales.rows = true; },
    (d: ReturnType<typeof fixture>) => { d.response.data.monthly.fieldEvidence[0].shopKey = '["天猫","同名店"]'; },
    (d: ReturnType<typeof fixture>) => { d.response.data.monthly.fieldEvidence.pop(); },
    (d: ReturnType<typeof fixture>) => { d.response.data.monthly.fieldEvidence.push(d.response.data.monthly.fieldEvidence[0]); },
    (d: ReturnType<typeof fixture>) => { d.response.data.extra = false; },
    (d: ReturnType<typeof fixture>) => { d.response.data.metricSemantics.dailyAllocation = true; },
    (d: ReturnType<typeof fixture>) => { d.response.data.monthly.data.timeline = []; },
    (d: ReturnType<typeof fixture>) => { d.response.data.monthly.data.previousMonths = ["2025-12"]; },
    (d: ReturnType<typeof fixture>) => { d.response.data.monthly.comparisonMonthEvidence.pop(); },
    (d: ReturnType<typeof fixture>) => { d.response.data.annual.data.cutoffMonth = "2026-04"; },
    (d: ReturnType<typeof fixture>) => { d.response.data.annual.data.items[0].manager = [""]; },
    (d: ReturnType<typeof fixture>) => { d.response.data.annual.data.items[0].missingMonths = ["2025-02"]; },
  ]) { const d = fixture(); change(d); assert.throws(() => decode(d)); }
});
test("defaulted raw zero cannot acquire verified amount or promotion/rate state", () => {
  for (const change of [
    (d: ReturnType<typeof fixture>) => { d.response.data.monthly.currentMetricStates.netSalesCents.value = 0; },
    (d: ReturnType<typeof fixture>) => { d.response.data.monthly.currentMetricStates.grossMarginBps = { value: 0, status: "available", reasonCode: null, unit: "BASIS_POINT" }; },
    (d: ReturnType<typeof fixture>) => { d.response.data.monthly.currentMetricStates.promotionExpenseCents = { value: 0, status: "available", reasonCode: null, unit: "CNY_CENT" }; },
    (d: ReturnType<typeof fixture>) => { d.response.data.monthly.fieldEvidence[0].fields.net_sales.amountPresent = 0; },
    (d: ReturnType<typeof fixture>) => { d.response.data.monthly.monthEvidence[0].metadataVerified = false; },
  ]) { const d = fixture(); change(d); assert.throws(() => decode(d)); }
});
test("annual exact candidates, no target/zero target progress, whole-year identity and no monthly split enforce", () => {
  for (const change of [
    (d: ReturnType<typeof fixture>) => { d.response.data.annual.data.items[0].platform = "天猫"; },
    (d: ReturnType<typeof fixture>) => { d.response.data.annual.data.items[0].key = '["天猫","同名店"]'; },
    (d: ReturnType<typeof fixture>) => { d.response.data.annual.data.items[0].target.periodType = "month"; },
    (d: ReturnType<typeof fixture>) => { d.response.data.annual.data.items[0].target.salesTargetCents = 0; },
    (d: ReturnType<typeof fixture>) => { d.response.data.annual.data.items[0].salesProgress = 6; },
    (d: ReturnType<typeof fixture>) => { d.response.data.annual.data.pagination.truncated = true; },
    (d: ReturnType<typeof fixture>) => { d.response.data.annual.data.items.push(d.response.data.annual.data.items[0]); },
    (d: ReturnType<typeof fixture>) => { d.response.data.annual.rateFieldsVerification.grossMarginBps = "verified"; },
  ]) { const d = fixture(); change(d); assert.throws(() => decode(d)); }
  const missing = fixture("finance-zero-missing-field-response.json");
  missing.response.data.annual.data.items[0].salesProgress = 0;
  assert.throws(() => decode(missing));
});
test("2MiB, strict string and finite scalar budgets reject instead of truncating", () => {
  const large = fixture(); large.response.data.limitations = ["x".repeat(2 * 1024 * 1024)];
  assert.throws(() => decode(large));
  const unsafe = fixture(); unsafe.response.data.monthly.data.current.netSalesCents = Number.MAX_SAFE_INTEGER + 1;
  assert.throws(() => decode(unsafe));
});
test("all protocol enum/date/identity positions reject arrays objects and boolean coercions", () => {
  const paths: Array<Array<string | number>> = [
    ["schemaVersion"], ["operation"], ["scopeKey"], ["snapshotToken"],
    ["metricSemantics", "monthlyBasis"], ["metricSemantics", "nativeRatioUnit"],
    ["monthly", "state"], ["monthly", "monthEvidence", 0, "status"], ["monthly", "monthEvidence", 0, "month"],
    ["monthly", "fieldEvidence", 0, "shopKey"], ["monthly", "currentMetricStates", "netSalesCents", "unit"],
    ["monthly", "currentMetricStates", "netSalesCents", "status"], ["annual", "state"],
    ["annual", "data", "year"], ["annual", "data", "items", 0, "platform"],
  ];
  for (const path of paths) {
    for (const wrap of [(v: unknown) => [v], (v: unknown) => ({ value: v }), () => true]) {
      const data = fixture(); let node = data.response.data;
      for (const key of path.slice(0, -1)) node = node[key];
      const last = path.at(-1)!; node[last] = wrap(node[last]);
      assert.throws(() => decode(data));
    }
  }
  const data = fixture("finance-missing-month-response.json");
  data.response.data.monthly.monthEvidence[1].status = ["absent"];
  assert.throws(() => decode(data));
});
