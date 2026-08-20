import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  beginTemplateRequest,
  calendarDateWithOffset,
  createTemplateRequestLifecycle,
  isCurrentTemplateRequest,
  shanghaiDateWithOffset,
} from "@/app/operations-view";

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
  assert.match(operations, /beginTemplateRequest\(templateRequestLifecycle\.current, requestKey\)/);
  assert.match(operations, /request\.controller\.signal/);
  assert.match(operations, /isCurrentTemplateRequest\(templateRequestLifecycle\.current, request\)/);
  assert.match(operations, /cancelTemplateRequest\(lifecycle\)/);
  assert.match(operations, /downloadCsvFile/);
  assert.doesNotMatch(operations, /URL\.createObjectURL/);
});

test("template loading ignores stale active-only success, error, and loading completion after the role gains write access", async () => {
  const lifecycle = createTemplateRequestLifecycle();
  let items = ["initial"];
  let loading = true;
  let error = "";

  const apply = async (request: ReturnType<typeof beginTemplateRequest>, outcome: Promise<string[]>) => {
    try {
      const nextItems = await outcome;
      if (!isCurrentTemplateRequest(lifecycle, request)) return;
      items = nextItems;
    } catch (reason) {
      if (!isCurrentTemplateRequest(lifecycle, request)) return;
      error = reason instanceof Error ? reason.message : "failed";
    } finally {
      if (isCurrentTemplateRequest(lifecycle, request)) loading = false;
    }
  };

  let rejectActiveOnly!: (reason: Error) => void;
  const activeOnlyFailure = new Promise<string[]>((_, reject) => { rejectActiveOnly = reject; });
  const activeOnlyRequest = beginTemplateRequest(lifecycle, "/api/workflow/templates");
  const activeOnlyCommit = apply(activeOnlyRequest, activeOnlyFailure);

  let resolveIncludeInactive!: (value: string[]) => void;
  const includeInactiveResponse = new Promise<string[]>((resolve) => { resolveIncludeInactive = resolve; });
  const includeInactiveRequest = beginTemplateRequest(lifecycle, "/api/workflow/templates?includeInactive=true");
  const includeInactiveCommit = apply(includeInactiveRequest, includeInactiveResponse);

  assert.equal(activeOnlyRequest.controller.signal.aborted, true);
  rejectActiveOnly(new Error("stale active-only failure"));
  await activeOnlyCommit;
  assert.equal(error, "");
  assert.equal(loading, true);

  resolveIncludeInactive(["active", "inactive"]);
  await includeInactiveCommit;
  assert.deepEqual(items, ["active", "inactive"]);
  assert.equal(loading, false);

  loading = true;
  let resolveLateActiveOnly!: (value: string[]) => void;
  const lateActiveOnlyResponse = new Promise<string[]>((resolve) => { resolveLateActiveOnly = resolve; });
  const lateActiveOnlyRequest = beginTemplateRequest(lifecycle, "/api/workflow/templates");
  const lateActiveOnlyCommit = apply(lateActiveOnlyRequest, lateActiveOnlyResponse);

  const latestIncludeInactiveRequest = beginTemplateRequest(lifecycle, "/api/workflow/templates?includeInactive=true");
  await apply(latestIncludeInactiveRequest, Promise.resolve(["new active", "new inactive"]));
  resolveLateActiveOnly(["stale active only"]);
  await lateActiveOnlyCommit;

  assert.equal(lateActiveOnlyRequest.controller.signal.aborted, true);
  assert.deepEqual(items, ["new active", "new inactive"]);
  assert.equal(loading, false);
  assert.equal(error, "");
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
