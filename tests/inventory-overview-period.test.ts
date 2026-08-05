import assert from "node:assert/strict";
import test from "node:test";

import { resolveInventorySalesPeriod } from "../lib/inventory/sales-period";

test("inventory demand uses the selected global period within available sales coverage", () => {
  assert.deepEqual(resolveInventorySalesPeriod(
    { startDate: "2026-07-01", endDate: "2026-07-07" },
    { startDate: "2026-01-01", endDate: "2026-08-05" },
  ), {
    requestedStartDate: "2026-07-01",
    requestedEndDate: "2026-07-07",
    salesStartDate: "2026-07-01",
    salesEndDate: "2026-07-07",
    salesWindowDays: 7,
  });
});

test("inventory demand reports the actual overlap when selected dates exceed imported coverage", () => {
  assert.deepEqual(resolveInventorySalesPeriod(
    { startDate: "2026-06-25", endDate: "2026-07-10" },
    { startDate: "2026-07-01", endDate: "2026-07-05" },
  ), {
    requestedStartDate: "2026-06-25",
    requestedEndDate: "2026-07-10",
    salesStartDate: "2026-07-01",
    salesEndDate: "2026-07-05",
    salesWindowDays: 5,
  });
  assert.deepEqual(resolveInventorySalesPeriod(
    { startDate: "2026-08-01", endDate: "2026-08-03" },
    { startDate: "2026-07-01", endDate: "2026-07-31" },
  ), {
    requestedStartDate: "2026-08-01",
    requestedEndDate: "2026-08-03",
    salesStartDate: null,
    salesEndDate: null,
    salesWindowDays: 3,
  });
});

test("inventory demand keeps the legacy 30-day default and rejects unsafe date ranges", () => {
  assert.deepEqual(resolveInventorySalesPeriod({}, { startDate: "2026-01-01", endDate: "2026-08-05" }), {
    requestedStartDate: "2026-07-07",
    requestedEndDate: "2026-08-05",
    salesStartDate: "2026-07-07",
    salesEndDate: "2026-08-05",
    salesWindowDays: 30,
  });
  assert.throws(() => resolveInventorySalesPeriod(
    { startDate: "2026-02-30", endDate: "2026-03-01" },
    { startDate: "2026-01-01", endDate: "2026-08-05" },
  ), /日期格式无效/);
  assert.throws(() => resolveInventorySalesPeriod(
    { startDate: "2026-08-05", endDate: "2026-08-01" },
    { startDate: "2026-01-01", endDate: "2026-08-05" },
  ), /开始日期不能晚于结束日期/);
  assert.throws(() => resolveInventorySalesPeriod(
    { startDate: "2024-01-01", endDate: "2026-08-05" },
    { startDate: "2024-01-01", endDate: "2026-08-05" },
  ), /最多支持 730 天/);
});
