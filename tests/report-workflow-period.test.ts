import assert from "node:assert/strict";
import test from "node:test";
import { reportWorkflowDates } from "../lib/ai/report-workflow-period";

test("report shortcuts use completed Shanghai days across UTC day and month boundaries", () => {
  const now = new Date("2026-09-30T16:00:00Z");
  assert.deepEqual(reportWorkflowDates("yesterday", now), { startDate: "2026-09-30", endDate: "2026-09-30" });
  assert.deepEqual(reportWorkflowDates("last7", now), { startDate: "2026-09-24", endDate: "2026-09-30" });
  assert.deepEqual(reportWorkflowDates("last30", now), { startDate: "2026-09-01", endDate: "2026-09-30" });
  assert.deepEqual(reportWorkflowDates("last7", new Date("2024-03-01T00:00:00Z")), { startDate: "2024-02-23", endDate: "2024-02-29" });
});
