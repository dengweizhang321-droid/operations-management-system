import assert from "node:assert/strict";
import test from "node:test";
import { decodeMetric } from "../lib/netshop/insights-contract";

const metric = { value: 0, unit: "COUNT", status: "available", reasonCode: null, basis: "product_day_sum", aggregation: "sum", sourceIds: ["synthetic"], coverageRef: "synthetic:current" };
test("all shared metric enum fields reject arrays and coercible objects without changing valid zero", () => {
  assert.equal(decodeMetric(metric).value, 0);
  for (const key of ["unit", "status", "basis", "aggregation"] as const) {
    for (const value of [[metric[key]], { toString: () => metric[key] }, null, true]) assert.throws(() => decodeMetric({ ...metric, [key]: value }));
  }
  assert.throws(() => decodeMetric({ ...metric, value: null, status: ["unavailable"], reasonCode: "missing_field" }));
});
