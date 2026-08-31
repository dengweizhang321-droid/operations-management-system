import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  beginTemplateRequest,
  calendarDateWithOffset,
  createTemplateRequestLifecycle,
  isCurrentTemplateRequest,
  shanghaiDateWithOffset,
  validateOperationRecordDraft,
  validateTaskDraft,
  validateTaskTemplateDraft,
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

test("operation record editor reports actionable validation instead of silently disabling creation", async () => {
  const validDraft = {
    title: "大通量净水器新品上架",
    status: "待开始",
    platform: "京东",
    channel: "线上",
    shopName: "待确认",
    owner: "商品组",
    occurredAt: "2026-08-26T09:00",
    dueAt: "2026-08-30T18:00",
    content: "准备上架资料",
    referenceCode: "NEW-001",
    priority: "normal" as const,
  };
  assert.equal(validateOperationRecordDraft(validDraft), "");
  assert.match(validateOperationRecordDraft({ ...validDraft, title: "" }), /事项名称/);
  assert.match(validateOperationRecordDraft({ ...validDraft, shopName: "" }), /待确认/);
  assert.match(validateOperationRecordDraft({ ...validDraft, occurredAt: "" }), /发生时间/);
  assert.match(validateOperationRecordDraft({ ...validDraft, dueAt: "2026-08-25T18:00" }), /不能早于/);

  const operations = await source("../app/operations-view.tsx");
  assert.match(operations, /setEditorError\(messageOf\(reason, "记录保存失败，请稍后重试。"\)\)/);
  assert.match(operations, /className="workflow-edit-validation" role="alert"/);
  assert.match(operations, /type="submit" className="primary-button" disabled=\{saving\}/);
  assert.doesNotMatch(operations, /disabled=\{saving \|\| !draft\.title\.trim\(\) \|\| !draft\.shopName\.trim\(\) \|\| !draft\.occurredAt\}/);
});

test("all work-item and template creation entry points expose actionable validation", async () => {
  const taskDraft = {
    title: "检查新品资料",
    workContent: "核对主图与详情页",
    category: "新品上架",
    owner: "商品组",
    shopName: "待确认",
    startDate: "2026-08-26",
    due: "2026-08-28",
    priority: "normal" as const,
  };
  assert.equal(validateTaskDraft(taskDraft), "");
  assert.match(validateTaskDraft({ ...taskDraft, title: "" }), /工作事项/);
  assert.match(validateTaskDraft({ ...taskDraft, due: "2026-08-25" }), /不能早于/);

  const templateDraft = {
    name: "新品上架模板",
    description: "",
    title: "新品资料检查",
    workContent: "",
    category: "新品上架",
    owner: "",
    shopName: "",
    startOffsetDays: 0,
    dueOffsetDays: 3,
    priority: "normal" as const,
    active: true,
  };
  assert.equal(validateTaskTemplateDraft(templateDraft), "");
  assert.match(validateTaskTemplateDraft({ ...templateDraft, name: "" }), /模板名称/);
  assert.match(validateTaskTemplateDraft({ ...templateDraft, startOffsetDays: 366 }), /-365 至 365/);
  assert.match(validateTaskTemplateDraft({ ...templateDraft, dueOffsetDays: -1 }), /不能早于/);

  const operations = await source("../app/operations-view.tsx");
  assert.match(operations, /setTaskEditorError\(messageOf\(reason, "工作事项保存失败，请稍后重试。"\)\)/);
  assert.match(operations, /setEditorError\(messageOf\(reason, "模板保存失败，请稍后重试。"\)\)/);
  assert.match(operations, />填入工作项<\/button>/);
  assert.match(operations, /请核对后点击“添加工作项”/);
  assert.match(operations, /void submitComment\(\)/);
  assert.match(operations, /void submitReminder\(\)/);
  assert.match(operations, /void submitLink\(\)/);
  assert.match(operations, /"创建巡店记录"/);
  assert.match(operations, /"创建评价记录"/);
  assert.match(operations, /"创建新品项目"/);
  assert.doesNotMatch(operations, /disabled=\{saving \|\| !draft\.title\.trim\(\)\}/);
  assert.doesNotMatch(operations, /disabled=\{saving \|\| !draft\.name\.trim\(\)\}/);
  assert.doesNotMatch(operations, /disabled=\{saving \|\| !comment\.trim\(\)\}/);
  assert.doesNotMatch(operations, /disabled=\{saving \|\| !remindAt\}/);
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
  assert.match(operations, /if \(activeTab !== "plan"\) \{\s+taskGeneration\.current \+= 1;\s+return;/);
  assert.match(operations, /if \(activeTab !== "plan" && activeTab !== "variables"\) \{\s+cancelTemplateRequest\(lifecycle\);\s+return;/);
  assert.match(operations, /loadControllerRef\.current\?\.abort\(\)/);
  assert.match(operations, /generation !== loadGenerationRef\.current/);
  assert.match(operations, /collaboration`, \{ signal: controller\.signal \}/);
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
