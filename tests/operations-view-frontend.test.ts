import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { calendarDateWithOffset, shanghaiDateWithOffset } from "@/app/operations-view";

const source = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("task template dates use the Asia/Shanghai calendar across the UTC boundary", () => {
  const beforeShanghaiMidnight = new Date("2026-08-19T15:59:59.000Z");
  const afterShanghaiMidnight = new Date("2026-08-19T16:00:00.000Z");

  assert.equal(shanghaiDateWithOffset(0, beforeShanghaiMidnight), "2026-08-19");
  assert.equal(shanghaiDateWithOffset(0, afterShanghaiMidnight), "2026-08-20");
  assert.equal(shanghaiDateWithOffset(3, afterShanghaiMidnight), "2026-08-23");
  assert.equal(calendarDateWithOffset("2026-08-31", 1), "2026-09-01");
  assert.equal(calendarDateWithOffset("2028-02-28", 1), "2028-02-29");
});

test("operations work plan keeps the paged collaboration and concurrency contract", async () => {
  const operations = await source("../app/operations-view.tsx");

  assert.match(operations, /pageSize", String\(TASK_PAGE_SIZE\)/);
  assert.match(operations, /listParams\.append\("status", value\)/);
  assert.match(operations, /commonParams\.append\("priority", value\)/);
  assert.match(operations, /commonParams\.append\("owner", value\)/);
  assert.match(operations, /calendarDateWithOffset\(taskDueTo, 1\)/);
  assert.match(operations, /expectedVersion/);
  assert.match(operations, /payload\.summary \?\? fallbackSummary/);
  assert.match(operations, /requestGeneration/);
  assert.match(operations, /taskGeneration/);
  assert.match(operations, /downloadCsvFile/);
  assert.doesNotMatch(operations, /URL\.createObjectURL/);
});

test("work plan restores filters, analytics, timeline, source metadata, and nine-column mobile labels", async () => {
  const [operations, css] = await Promise.all([
    source("../app/operations-view.tsx"),
    source("../app/globals.css"),
  ]);

  for (const feature of [
    "workflow-summary-grid",
    "workflow-insight-grid",
    "workflow-task-buckets",
    "workflow-view-switch",
    "workflow-timeline",
    "MultiSelectFilter",
    "TaskTransitionActions",
    "formatRecordedAt",
  ]) assert.match(operations, new RegExp(feature));

  assert.match(operations, /<th>店铺 \/ 来源<\/th>/);
  assert.match(operations, /<th>截止 \/ 录入<\/th>/);
  assert.match(operations, /colSpan=\{9\}/);
  assert.match(css, /\.operations-plan-table td:nth-child\(9\)::before \{ content: "操作"; \}/);
  assert.match(css, /\.operations-plan-table td:nth-child\(8\)::before \{ content: "协作"; \}/);
  assert.match(css, /@media \(max-width: 960px\)/);
});
