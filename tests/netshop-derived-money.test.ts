import assert from "node:assert/strict";
import test from "node:test";
import { decodeMetric, decodeDerivedMoneyPerCount, compareDerivedMoneyPerCount, formatDerivedMoneyPerCount, type DerivedMoneyPerCountV1 } from "../lib/netshop/insights-contract";

function price(overrides: Partial<DerivedMoneyPerCountV1> = {}): DerivedMoneyPerCountV1 {
  return { metricSchemaVersion: "netshop-money-per-count-v1", unit: "CNY_CENT_PER_COUNT", denominatorKind: "clicks", aggregation: "ratio_of_sums", value: 101 / 3, numerator: 101, denominator: 3, status: "available", reasonCode: null, basis: "platform_attributed", sourceIds: ["jd_promotion"], coverageRef: "jd_promotion:current", ...overrides };
}
test("fractional-cent CPC is versioned and precise while amounts remain safe integer cents", () => {
  const p = price(); assert.deepEqual(decodeDerivedMoneyPerCount(p), p);
  assert.equal(formatDerivedMoneyPerCount(p), "0.3367 元/点击");
  assert.throws(() => decodeMetric({ ...p, unit: "CNY_CENT" }));
  assert.throws(() => decodeMetric({ ...p, unit: "COUNT" }));
  const zero = price({ value: 0, numerator: 0 });
  assert.equal(decodeDerivedMoneyPerCount(zero).value, 0); assert.equal(formatDerivedMoneyPerCount(zero), "0.00 元/点击");
  assert.equal(formatDerivedMoneyPerCount(price({ numerator: 1, denominator: 100000, value: .00001 })), "<0.0001 元/点击");
});
test("version, unit, aggregation and every exact operand are validated", () => {
  for (const invalid of [
    { metricSchemaVersion: "unversioned" }, { unit: "RATIO" }, { denominatorKind: "orders" },
    { aggregation: "sum" }, { aggregation: "source_value_only" }, { status: "partial", reasonCode: "incomplete_coverage" },
    { numerator: 1.5 }, { numerator: Number.MAX_SAFE_INTEGER + 1 }, { numerator: null },
    { denominator: .5 }, { denominator: Number.MAX_SAFE_INTEGER + 1 }, { denominator: 0 }, { denominator: -1 }, { denominator: null },
    { numerator: -101, value: -101 / 3 }, { value: Number.POSITIVE_INFINITY }, { value: Number.NaN },
    { value: .33 }, { sourceIds: [] }, { sourceIds: ["jd_promotion", "jd_promotion"] }, { basis: "unverified" },
  ]) assert.throws(() => decodeDerivedMoneyPerCount({ ...price(), ...invalid }));
  const missing = { ...price() } as Record<string, unknown>; delete missing.numerator;
  assert.throws(() => decodeDerivedMoneyPerCount(missing));
});
test("missing fields, missing dates and invalid denominators stay null with exact reasons", () => {
  for (const reasonCode of ["missing_field", "missing_day", "zero_denominator", "negative_denominator", "incomplete_coverage"] as const) {
    const p = price({ status: "unavailable", value: null, numerator: null, denominator: reasonCode === "zero_denominator" ? 0 : reasonCode === "negative_denominator" ? -1 : null, reasonCode });
    assert.equal(decodeDerivedMoneyPerCount(p).reasonCode, reasonCode); assert.equal(formatDerivedMoneyPerCount(p), "—");
    assert.throws(() => decodeDerivedMoneyPerCount({ ...p, value: 0 }));
  }
});
test("comparison preserves operand semantics, zero/negative/missing bases and exact source identity", () => {
  const a = price(), b = price({ value: 101 / 6, denominator: 6 });
  assert.equal(compareDerivedMoneyPerCount(a, b).value, 1);
  assert.equal(compareDerivedMoneyPerCount(a, price({ denominatorKind: "item_quantity" })).reasonCode, "not_applicable");
  assert.equal(compareDerivedMoneyPerCount(a, price({ sourceIds: ["tmall_promotion"] })).reasonCode, "not_applicable");
  assert.equal(compareDerivedMoneyPerCount(a, price({ value: 0, numerator: 0 })).reasonCode, "zero_denominator");
  const negative = price({ denominatorKind: "item_quantity", numerator: -101, value: -101 / 3, basis: "erp_net_sales" });
  assert.equal(compareDerivedMoneyPerCount({ ...negative, numerator: 101, value: 101 / 3 }, negative).reasonCode, "negative_baseline");
  assert.equal(compareDerivedMoneyPerCount(a, price({ value: null, numerator: null, denominator: null, status: "unavailable", reasonCode: "missing_day" })).reasonCode, "incomplete_baseline");
  assert.match(formatDerivedMoneyPerCount(price({ denominatorKind: "transaction_customers_sum" })), /成交客户累计$/);
  assert.match(formatDerivedMoneyPerCount(price({ denominatorKind: "product_day_visitors_sum" })), /商品访客累计$/);
});
test("sum of spend divided by sum of clicks is not the average daily CPC", () => {
  const weighted = price({ numerator: 101, denominator: 101, value: 1 });
  assert.equal(decodeDerivedMoneyPerCount(weighted).value, 1);
  const averagedDaily = (100 / 1 + 1 / 100) / 2;
  assert.notEqual(weighted.value, averagedDaily);
  assert.throws(() => decodeDerivedMoneyPerCount({ ...weighted, value: averagedDaily }));
});
