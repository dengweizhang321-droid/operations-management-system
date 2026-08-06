import assert from "node:assert/strict";
import test from "node:test";
import { alignSalesSummaryPeriodToDataCutoff } from "../lib/sales/period";

test("month and rolling periods align their comparisons to the latest imported sales date", () => {
  assert.deepEqual(
    alignSalesSummaryPeriodToDataCutoff("month", {
      startDate: "2026-08-01",
      endDate: "2026-08-06",
      previousStartDate: "2026-07-01",
      previousEndDate: "2026-07-06",
    }, "2026-08-05"),
    {
      adjusted: true,
      period: {
        startDate: "2026-08-01",
        endDate: "2026-08-05",
        previousStartDate: "2026-07-01",
        previousEndDate: "2026-07-05",
      },
    },
  );

  assert.deepEqual(
    alignSalesSummaryPeriodToDataCutoff("last7", {
      startDate: "2026-07-31",
      endDate: "2026-08-06",
      previousStartDate: "2026-07-24",
      previousEndDate: "2026-07-30",
    }, "2026-08-05"),
    {
      adjusted: true,
      period: {
        startDate: "2026-07-30",
        endDate: "2026-08-05",
        previousStartDate: "2026-07-23",
        previousEndDate: "2026-07-29",
      },
    },
  );
});

test("custom periods drop an unsynced trailing day and rebuild an equal previous period", () => {
  assert.deepEqual(
    alignSalesSummaryPeriodToDataCutoff("custom", {
      startDate: "2026-08-01",
      endDate: "2026-08-06",
      previousStartDate: "2026-07-26",
      previousEndDate: "2026-07-31",
    }, "2026-08-05"),
    {
      adjusted: true,
      period: {
        startDate: "2026-08-01",
        endDate: "2026-08-05",
        previousStartDate: "2026-07-27",
        previousEndDate: "2026-07-31",
      },
    },
  );
});

test("fully covered and fixed calendar periods remain unchanged", () => {
  const historical = {
    startDate: "2025-08-01",
    endDate: "2025-08-06",
    previousStartDate: "2025-07-26",
    previousEndDate: "2025-07-31",
  };
  assert.deepEqual(
    alignSalesSummaryPeriodToDataCutoff("custom", historical, "2026-08-05"),
    { adjusted: false, period: historical },
  );
  const today = {
    startDate: "2026-08-06",
    endDate: "2026-08-06",
    previousStartDate: "2026-08-05",
    previousEndDate: "2026-08-05",
  };
  assert.deepEqual(
    alignSalesSummaryPeriodToDataCutoff("today", today, "2026-08-05"),
    { adjusted: false, period: today },
  );
});
