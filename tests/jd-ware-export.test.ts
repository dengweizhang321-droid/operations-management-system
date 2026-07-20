import assert from "node:assert/strict";
import test from "node:test";
import {
  newestCompletedJdWareExportTask,
  newestUnseenJdWareExportTask,
  parseJdWareExportTaskRows,
  selectRecoverableJdWareExportTask,
  selectExistingJdWareExportTask,
  unseenJdWareExportTasks,
} from "../lib/jd/ware-export";
import { advanceWareExportAudit, createWareExportAudit, importSkuFile } from "../tools/jackyun-ware-export";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

test("parses the JD export record table without confusing product rows for tasks", () => {
  const tasks = parseJdWareExportTaskRows([
    "志高开水器\n商品编码：14577459490\n2026-07-18 10:03:17\n上架中",
    "2026-07-19 20:00:09\n9371817\n已完成\n成功：1453\n下载",
    "2026-07-19 20:03:11\n9371818\n处理中\n-",
  ]);

  assert.deepEqual(tasks.map((task) => ({
    taskId: task.taskId,
    status: task.status,
    successRows: task.successRows,
  })), [
    { taskId: "9371818", status: "pending", successRows: null },
    { taskId: "9371817", status: "completed", successRows: 1453 },
  ]);
});

test("chooses the newly created task rather than an older completed download", () => {
  const tasks = parseJdWareExportTaskRows([
    "2026-07-19 20:03:11\n9371818\n处理中\n-",
    "2026-07-19 20:00:09\n9371817\n已完成\n成功：1453\n下载",
  ]);

  assert.equal(newestUnseenJdWareExportTask(tasks, new Set(["9371817"]))?.taskId, "9371818");
  assert.equal(newestCompletedJdWareExportTask(tasks)?.taskId, "9371817");
  assert.deepEqual(unseenJdWareExportTasks(tasks, new Set()).map((task) => task.taskId), ["9371818", "9371817"]);
});

test("takes over exactly one pending task before considering an older completed task", () => {
  const tasks = [
    { taskId: "9371818", status: "pending" as const, createdAt: "2026-07-19 20:03:11", resultText: null, successRows: null, rowText: "pending" },
    { taskId: "9371817", status: "completed" as const, createdAt: "2026-07-19 20:00:09", resultText: null, successRows: 1453, rowText: "completed" },
  ];
  const selection = selectExistingJdWareExportTask(tasks, true);
  assert.equal(selection.kind, "pending");
  if (selection.kind === "pending") assert.equal(selection.task.taskId, "9371818");
});

test("does not create or reuse when multiple pending export tasks exist", () => {
  const tasks = [
    { taskId: "9371819", status: "pending" as const, createdAt: "2026-07-19 20:04:11", resultText: null, successRows: null, rowText: "pending" },
    { taskId: "9371818", status: "pending" as const, createdAt: "2026-07-19 20:03:11", resultText: null, successRows: null, rowText: "pending" },
    { taskId: "9371817", status: "completed" as const, createdAt: "2026-07-19 20:00:09", resultText: null, successRows: 1453, rowText: "completed" },
  ];
  const selection = selectExistingJdWareExportTask(tasks, false);
  assert.equal(selection.kind, "ambiguous_pending");
  if (selection.kind === "ambiguous_pending") assert.deepEqual(selection.tasks.map((task) => task.taskId), ["9371819", "9371818"]);
});

test("recovers the exact timed-out task after it becomes completed", () => {
  const tasks = [
    { taskId: "9371818", status: "completed" as const, createdAt: "2026-07-19 20:03:11", resultText: "成功：1453", successRows: 1453, rowText: "completed" },
    { taskId: "9371817", status: "completed" as const, createdAt: "2026-07-19 20:00:09", resultText: "成功：1450", successRows: 1450, rowText: "older" },
  ];
  const selection = selectRecoverableJdWareExportTask(tasks, {
    version: 1,
    baselineTaskIds: ["9371817"],
    taskId: "9371818",
    createdAt: "2026-07-19T12:03:10.000Z",
  });
  assert.equal(selection.kind, "task");
  if (selection.kind === "task") assert.equal(selection.task.taskId, "9371818");
});

test("recovers one post-baseline task when the process stopped before learning its id", () => {
  const tasks = [
    { taskId: "9371818", status: "pending" as const, createdAt: "2026-07-19 20:03:11", resultText: null, successRows: null, rowText: "pending" },
    { taskId: "9371817", status: "completed" as const, createdAt: "2026-07-19 20:00:09", resultText: "成功：1450", successRows: 1450, rowText: "older" },
  ];
  const selection = selectRecoverableJdWareExportTask(tasks, {
    version: 1,
    baselineTaskIds: ["9371817"],
    createdAt: "2026-07-19T12:03:10.000Z",
  });
  assert.equal(selection.kind, "task");
  if (selection.kind === "task") assert.equal(selection.task.taskId, "9371818");
});

test("stops when a baseline-only recovery has multiple candidate tasks", () => {
  const tasks = [
    { taskId: "9371819", status: "pending" as const, createdAt: "2026-07-19 20:04:11", resultText: null, successRows: null, rowText: "pending" },
    { taskId: "9371818", status: "completed" as const, createdAt: "2026-07-19 20:03:11", resultText: "成功：1453", successRows: 1453, rowText: "completed" },
    { taskId: "9371817", status: "completed" as const, createdAt: "2026-07-19 20:00:09", resultText: "成功：1450", successRows: 1450, rowText: "older" },
  ];
  const selection = selectRecoverableJdWareExportTask(tasks, {
    version: 1,
    baselineTaskIds: ["9371817"],
    createdAt: "2026-07-19T12:03:10.000Z",
  });
  assert.equal(selection.kind, "ambiguous");
});

test("preserves the task id in a timeout failure audit", () => {
  const running = advanceWareExportAudit(createWareExportAudit({ baseUrl: "http://localhost:3000", reuseLatest: false }), {
    stage: "wait_new_task", baselineTaskIds: ["9371817"], taskId: "9371818", taskStatus: "pending",
  });
  const failed = advanceWareExportAudit(running, { status: "failed", error: "等待京东导出任务 9371818 完成超时" });
  assert.deepEqual(
    { status: failed.status, stage: failed.stage, taskId: failed.taskId, baselineTaskIds: failed.baselineTaskIds },
    { status: "failed", stage: "wait_new_task", taskId: "9371818", baselineTaskIds: ["9371817"] },
  );
});

test("records an auto-import failure audit after a rejected connection without browser startup", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jd-ware-export-"));
  const workbook = path.join(directory, "task.xlsx");
  await writeFile(workbook, "not-a-real-workbook");
  const initial = createWareExportAudit({ baseUrl: "http://127.0.0.1:3000", reuseLatest: false });
  const ready = advanceWareExportAudit(initial, {
    stage: "auto_import",
    taskId: "9371818",
    taskStatus: "completed",
    savedPath: workbook,
  });
  await assert.rejects(
    importSkuFile("http://127.0.0.1:3000", workbook, async () => { throw new Error("connect ECONNREFUSED"); }),
    /ECONNREFUSED/,
  );
  const failed = advanceWareExportAudit(ready, { status: "failed", error: "connect ECONNREFUSED" });
  assert.deepEqual(
    { status: failed.status, stage: failed.stage, taskId: failed.taskId, savedPath: failed.savedPath, baseUrl: failed.baseUrl },
    { status: "failed", stage: "auto_import", taskId: "9371818", savedPath: workbook, baseUrl: "http://127.0.0.1:3000" },
  );
});

test("records an auto-import HTTP 500 failure audit without browser startup", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jd-ware-export-"));
  const workbook = path.join(directory, "task.xlsx");
  await writeFile(workbook, "not-a-real-workbook");
  await assert.rejects(
    importSkuFile("http://127.0.0.1:3000", workbook, async () => new Response(JSON.stringify({ message: "server failed" }), { status: 500 })),
    /server failed/,
  );
  const failed = advanceWareExportAudit(createWareExportAudit({ baseUrl: "http://127.0.0.1:3000", reuseLatest: false }), {
    status: "failed", stage: "auto_import", taskId: "9371818", savedPath: workbook, error: "server failed",
  });
  assert.equal(failed.stage, "auto_import");
  assert.equal(failed.error, "server failed");
});
